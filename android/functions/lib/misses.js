/**
 * Missed testing days: the pure arithmetic behind "the 3rd miss removes you".
 *
 * THE RULE
 * A commitment claimed with `allowedMisses` on it (every claim since the miss
 * rule landed) is removed as soon as it has missed MORE than that many days.
 * With a 16-day window, 14 required days and 2 allowed misses, the third miss
 * is exactly the moment the requirement can no longer be met - so removing
 * then, rather than waiting for the window to close, forfeits nothing a
 * tester could still have earned.
 *
 * WHAT COUNTS AS A MISS
 * A day D is missed when ALL of these hold:
 *   * D is an eligible day of the window (first..effective last, inclusive);
 *   * D is strictly BEFORE today in the pinned zone - today is still
 *     available, so it is never a miss yet, and future days never are;
 *   * no testing log exists for D;
 *   * D is not a declared outage day for this app.
 * Each day is judged once, from a set, so a day can never be counted twice.
 *
 * NOTHING HERE IS STORED OR TRUSTED FROM A CLIENT
 * The inputs are the pinned window, the server-derived day key and the
 * testing logs the server itself wrote. The count is re-derived on every
 * decision rather than cached, for the reason `creditedOutageDays` is never
 * stored either: a cached count goes stale at every local midnight, and a
 * stale count is precisely what a settlement must not act on.
 *
 * LEGACY COMMITMENTS
 * `missRuleApplies` is false for an assignment without an integer
 * `allowedMisses`. Such a commitment was claimed under the window-only rule
 * and keeps it for life; this module never judges it.
 */

const {
  addDays,
  daysBetween,
  dayKeyInZone,
  isValidDayKey,
  isValidTimeZone,
  startOfLocalDayMillis,
  testingLogId,
} = require("./testingDays");
const { effectiveLastEligibleDayKey } = require("./outages");

/** True when this assignment was claimed under the miss rule. */
function missRuleApplies(allowedMisses) {
  return Number.isInteger(allowedMisses) && allowedMisses >= 0;
}

/**
 * The eligible days that can have been missed by `todayKey`: every day from
 * the first eligible day through yesterday, or through the window's last day
 * if that came first. Empty before day 2. Null on malformed input.
 */
function pastEligibleDayKeys({ firstEligibleDayKey, lastEligibleDayKey, todayKey }) {
  if (
    !isValidDayKey(firstEligibleDayKey) ||
    !isValidDayKey(lastEligibleDayKey) ||
    !isValidDayKey(todayKey)
  ) {
    return null;
  }
  const yesterday = addDays(todayKey, -1);
  const end = daysBetween(yesterday, lastEligibleDayKey) < 0 ? lastEligibleDayKey : yesterday;
  const span = daysBetween(firstEligibleDayKey, end);
  if (span === null || span < 0) return [];
  return Array.from({ length: span + 1 }, (_, i) => addDays(firstEligibleDayKey, i));
}

/**
 * How many eligible days before today went unlogged, outage days excluded.
 *
 * `lastEligibleDayKey` must be the EFFECTIVE last day (outage credit already
 * applied), so days a declared outage added to the window are judged exactly
 * like the original ones.
 *
 * Returns null on malformed input; callers treat null as "cannot judge", which
 * never removes anyone.
 */
function countMissedDays({
  firstEligibleDayKey,
  lastEligibleDayKey,
  todayKey,
  loggedDayKeys,
  outageDayKeys = [],
}) {
  if (!Array.isArray(loggedDayKeys)) return null;
  const days = pastEligibleDayKeys({ firstEligibleDayKey, lastEligibleDayKey, todayKey });
  if (days === null) return null;

  const logged = new Set(loggedDayKeys);
  const outage = new Set(outageDayKeys || []);
  return days.filter((day) => !logged.has(day) && !outage.has(day)).length;
}

/**
 * Read which of the judged days have a testing log, for a commitment under
 * the miss rule. Returns null for a legacy commitment or a malformed window -
 * both mean "no miss verdict", which removes nobody.
 *
 * POINT READS, NOT A QUERY. Logs have deterministic ids
 * (`testingLogId(assignmentId, dayKey)`), so each judged day is read by id.
 * Inside a transaction that locks every one of those documents, INCLUDING the
 * ones that do not exist yet - so a check-in racing this read on a judged day
 * conflicts with it and one side retries, rather than being missed. It also
 * keeps the settlement transactions' existing count aggregate as the only
 * query they run, exactly as before the miss rule.
 *
 * I/O is injected (`read(path) -> snapshot`) so the same code serves a
 * transaction (`tx.get(db.doc(p))`) and a plain read.
 */
async function readMissEvidence({
  assignmentId,
  allowedMisses,
  timeZone,
  firstEligibleDayKey,
  lastEligibleDayKey,
  appId,
  outageRecords = [],
  nowMillis,
  read,
}) {
  if (!missRuleApplies(allowedMisses)) return null;
  if (!isValidTimeZone(timeZone) || !Number.isFinite(nowMillis)) return null;
  const todayKey = dayKeyInZone(nowMillis, timeZone);
  const effectiveLast = effectiveLastEligibleDayKey({
    firstEligibleDayKey,
    lastEligibleDayKey,
    appId,
    records: outageRecords,
  });
  const days = pastEligibleDayKeys({
    firstEligibleDayKey,
    lastEligibleDayKey: effectiveLast,
    todayKey,
  });
  if (days === null) return null;
  const snaps = await Promise.all(
    days.map((day) => read(`testingLogs/${testingLogId(assignmentId, day)}`)),
  );
  return days.filter((_, i) => snaps[i].exists);
}

/**
 * The earliest instant this commitment could possibly cross its miss limit,
 * assuming the tester never checks in again after `fromDayKey`.
 *
 * A LOWER BOUND, used only to find sweep candidates: `missedSoFar` misses have
 * accrued before `fromDayKey`, `fromDayKey` itself is treated as not missed
 * (it is today, or the claim day), and every later day is assumed missed. The
 * limit is crossed when misses reach `allowedMisses + 1`, which first happens
 * at the start of day `fromDayKey + (allowedMisses - missedSoFar) + 2`.
 * Outage days can only push the real moment LATER, never earlier, so the sweep
 * never misses a removal by trusting this; at worst it evaluates a candidate a
 * little early, and the settlement transaction then declines.
 */
function removalCheckAtMillis({ fromDayKey, missedSoFar = 0, allowedMisses, timeZone }) {
  if (!missRuleApplies(allowedMisses) || !isValidDayKey(fromDayKey)) return null;
  const missed = Number.isInteger(missedSoFar) && missedSoFar > 0 ? missedSoFar : 0;
  const offset = Math.max(1, allowedMisses - missed + 2);
  return startOfLocalDayMillis(addDays(fromDayKey, offset), timeZone);
}

module.exports = {
  missRuleApplies,
  pastEligibleDayKeys,
  countMissedDays,
  readMissEvidence,
  removalCheckAtMillis,
};

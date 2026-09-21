/**
 * Pure testing-day and commitment-window arithmetic.
 *
 * Side-effect free, like `lib/wallet.js` and `lib/commitments.js`, so every
 * rule that decides whether a testing day counts - and therefore whether 50
 * real coins come back or are forfeited - can be unit tested without
 * Firestore, the emulator or network access. The transactions live in
 * `testingDays.js`.
 *
 * THE PRODUCT CLOCK
 *
 *     14 qualifying days, inside an 18 calendar-day window.
 *     4 flex days. Missing one day is not a failure.
 *     The 14th qualifying day completes the commitment immediately.
 *     A window that closes below 14 forfeits the stake.
 *
 * WHY THE TIMEZONE IS PINNED, NOT DERIVED
 * A "testing day" is a LOCAL calendar day. If the boundary moved with the
 * device, a tester could roll their clock and manufacture days; if it were
 * UTC, an Indian tester's day would flip at 05:30 local, which is wrong for
 * the product and confusing besides. So the zone is captured once, at claim
 * time, stored on the assignment, and never consulted from the device again.
 * Every function here takes that pinned zone explicitly - none of them read a
 * system default, which is what makes them testable and what stops a server
 * in a different region from changing anyone's day boundary.
 *
 * WHY CIVIL-DATE ARITHMETIC IS DST-SAFE
 * A day key is a civil date (`yyyy-MM-dd`), not an instant. Adding days to a
 * civil date is exact regardless of DST, because no offset is involved - the
 * 25-hour and 23-hour days simply do not appear. DST only matters in two
 * places: turning an instant into a local day key (`dayKeyInZone`, which uses
 * Intl and is correct by construction), and turning a local midnight back into
 * an instant (`startOfLocalDayMillis`, which resolves the offset iteratively).
 * India has no DST today, but the engine is not allowed to assume that.
 */

const { COMMITMENT_DAYS_REQUIRED, COMMITMENT_WINDOW_DAYS } = require("./constants");

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a real IANA zone THIS runtime understands?
 *
 * Validated rather than trusted: a zone string is pinned for the whole life of
 * a commitment, so an unrecognised one would make every subsequent day
 * calculation throw and strand the tester's coins.
 */
function isValidTimeZone(tz) {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

/** Is this a well-formed `yyyy-MM-dd` civil date? */
function isValidDayKey(key) {
  if (typeof key !== "string" || !DAY_KEY_PATTERN.test(key)) return false;
  // Reject "2026-99-99": the pattern alone would accept it.
  const [y, m, d] = key.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * The local calendar day an instant falls on, in a given IANA zone.
 *
 * THE single definition of "today" in this system. `en-CA` is used because it
 * formats as `yyyy-MM-dd` natively; the parts are read individually anyway so
 * the locale cannot change the result.
 */
function dayKeyInZone(epochMillis, timeZone) {
  if (!Number.isFinite(epochMillis)) return null;
  if (!isValidTimeZone(timeZone)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(epochMillis));
  const get = (type) => parts.find((p) => p.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Civil date -> UTC-anchored millis, used only for exact day arithmetic. */
function dayKeyToUtcMillis(key) {
  if (!isValidDayKey(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/** UTC-anchored millis -> civil date. Inverse of `dayKeyToUtcMillis`. */
function utcMillisToDayKey(millis) {
  const d = new Date(millis);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * Add whole days to a civil date. Exact under DST - see the header.
 *
 * Returns null on a malformed input rather than a guess, so a corrupt stored
 * window fails closed instead of silently reading as open.
 */
function addDays(dayKey, days) {
  const base = dayKeyToUtcMillis(dayKey);
  if (base === null || !Number.isInteger(days)) return null;
  return utcMillisToDayKey(base + days * MILLIS_PER_DAY);
}

/** Whole days from `fromKey` to `toKey`. Negative when `toKey` is earlier. */
function daysBetween(fromKey, toKey) {
  const from = dayKeyToUtcMillis(fromKey);
  const to = dayKeyToUtcMillis(toKey);
  if (from === null || to === null) return null;
  return Math.round((to - from) / MILLIS_PER_DAY);
}

/** Zone offset in millis at a given instant (positive east of UTC). */
function zoneOffsetMillis(epochMillis, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(epochMillis));
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  // Second-resolution is enough; offsets are never sub-second.
  return asUtc - Math.floor(epochMillis / 1000) * 1000;
}

/**
 * The instant at which a local calendar day begins, in a given zone.
 *
 * Needed only so the window end can be stored as a real Timestamp that a
 * future scheduled evaluator can query on. Resolved in two passes: the first
 * applies the offset at the UTC-anchored guess, the second re-checks it at the
 * corrected instant, which is what makes a DST transition land correctly.
 */
function startOfLocalDayMillis(dayKey, timeZone) {
  const anchor = dayKeyToUtcMillis(dayKey);
  if (anchor === null || !isValidTimeZone(timeZone)) return null;
  let guess = anchor - zoneOffsetMillis(anchor, timeZone);
  guess = anchor - zoneOffsetMillis(guess, timeZone);
  return guess;
}

/**
 * Derive the whole commitment window from the moment of the claim.
 *
 * DAY 1 IS THE NEXT FULL LOCAL DAY. A tester who claims at 23:50 local has
 * fifty minutes of that day left; counting it as a full testing day would hand
 * out a free qualifying day and make the 14-day requirement mean something
 * different depending on the hour someone happened to tap a button. So the
 * claim day is explicitly excluded, and the window starts the following local
 * midnight.
 *
 * `creditedOutageDays` extends the window without touching its start. It is a
 * parameter rather than a constant so a future outage registry can widen an
 * affected commitment by recording a number on the assignment - no calculation
 * in this file needs to change for that to work.
 */
function deriveWindow({
  claimedAtMillis,
  timeZone,
  windowDays = COMMITMENT_WINDOW_DAYS,
  creditedOutageDays = 0,
}) {
  if (!isValidTimeZone(timeZone)) return null;
  const claimedDayKey = dayKeyInZone(claimedAtMillis, timeZone);
  if (claimedDayKey === null) return null;
  const days = Number.isInteger(windowDays) && windowDays > 0 ? windowDays : COMMITMENT_WINDOW_DAYS;
  const credited = Number.isInteger(creditedOutageDays) && creditedOutageDays > 0
    ? creditedOutageDays
    : 0;

  const firstEligibleDayKey = addDays(claimedDayKey, 1);
  // Inclusive: an 18-day window running from day 1 ends on day 18, which is
  // day1 + 17. Off-by-one here would silently give or steal a whole day.
  const lastEligibleDayKey = addDays(firstEligibleDayKey, days - 1 + credited);
  // The instant the window shuts: local midnight AFTER the last eligible day.
  const windowEndsAtMillis = startOfLocalDayMillis(
    addDays(lastEligibleDayKey, 1),
    timeZone,
  );

  return {
    timeZone,
    claimedDayKey,
    firstEligibleDayKey,
    lastEligibleDayKey,
    windowDays: days,
    creditedOutageDays: credited,
    windowEndsAtMillis,
  };
}

/**
 * How many qualifying days could possibly have been earned by `todayKey`.
 *
 * One per eligible local day, so the ceiling is simply how many eligible days
 * have begun. Used as a sanity bound: a stored `qualifyingDays` above this is
 * evidence of tampering or a bug, not something to build on.
 */
function maxPossibleQualifyingDays(firstEligibleDayKey, todayKey) {
  const elapsed = daysBetween(firstEligibleDayKey, todayKey);
  if (elapsed === null) return null;
  return Math.max(0, elapsed + 1);
}

/** True once the window has closed for the given local day. */
function isWindowClosed({ lastEligibleDayKey, todayKey }) {
  const diff = daysBetween(lastEligibleDayKey, todayKey);
  if (diff === null) return false;
  return diff > 0;
}

/**
 * Every value-derived precondition for recording a qualifying testing day.
 *
 * The caller supplies `todayKey` already derived from the SERVER clock and the
 * assignment's PINNED zone. Nothing here accepts a day key, a timezone or a
 * progress figure from a client - that is the whole point of the split.
 *
 * @returns {{ok: true, qualifyingDays: number, completes: boolean}
 *          | {ok: false, code: string, message: string, alreadyLogged?: boolean}}
 */
function checkTestingDayEligible({
  status,
  lockTxId,
  cycle,
  firstEligibleDayKey,
  lastEligibleDayKey,
  todayKey,
  qualifyingDays,
  daysRequired = COMMITMENT_DAYS_REQUIRED,
  alreadyLoggedToday,
}) {
  if (status === "completed" || status === "failed" || status === "missed" || status === "cancelled") {
    return {
      ok: false,
      code: "failed-precondition",
      message: `This commitment is already ${status}.`,
    };
  }
  // A reward-era assignment staked nothing. Letting one accrue qualifying days
  // would eventually route it into a settlement that returns coins nobody put
  // in, so it is refused here rather than at the money layer.
  if (!lockTxId) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "This assignment has no Testing Coin commitment behind it.",
    };
  }
  if (!Number.isInteger(cycle) || cycle < 1) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "This assignment is not a valid commitment cycle.",
    };
  }
  if (!isValidDayKey(firstEligibleDayKey) || !isValidDayKey(lastEligibleDayKey)) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "This commitment has no valid testing window.",
    };
  }
  if (!isValidDayKey(todayKey)) {
    return {
      ok: false,
      code: "internal",
      message: "Could not determine the current testing day.",
    };
  }

  // Before day 1. This is the claim-day case: the tester joined partway
  // through a local day, and that partial day is deliberately not a testing
  // day. It is a "not yet", not a failure.
  if (daysBetween(firstEligibleDayKey, todayKey) < 0) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "Your first testing day starts tomorrow.",
      notStarted: true,
    };
  }
  if (isWindowClosed({ lastEligibleDayKey, todayKey })) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "This commitment's testing window has closed.",
      windowClosed: true,
    };
  }

  // Idempotent, not an error: a double tap, a retried request or a flaky
  // network must not look like a failure to the tester, and must not create a
  // second day.
  if (alreadyLoggedToday) {
    return {
      ok: false,
      code: "alreadyLogged",
      message: "You have already recorded testing for today.",
      alreadyLogged: true,
    };
  }

  const current = Number.isInteger(qualifyingDays) && qualifyingDays > 0 ? qualifyingDays : 0;
  const required = Number.isInteger(daysRequired) && daysRequired > 0
    ? daysRequired
    : COMMITMENT_DAYS_REQUIRED;

  if (current >= required) {
    // Should be unreachable - reaching `required` completes the commitment in
    // the same transaction - so arriving here means stored state is wrong.
    return {
      ok: false,
      code: "failed-precondition",
      message: "This commitment has already met its requirement.",
    };
  }

  const ceiling = maxPossibleQualifyingDays(firstEligibleDayKey, todayKey);
  if (ceiling !== null && current >= ceiling) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "Recorded testing days already exceed the days elapsed.",
    };
  }

  const next = current + 1;
  return { ok: true, qualifyingDays: next, completes: next >= required };
}

/**
 * Whether a commitment's window has closed short, making it eligible for
 * forfeiture.
 *
 * Pure decision only. It moves no coins and writes nothing; the settlement
 * that acts on it lives in `commitments.js`, and the scheduled evaluator that
 * will call it belongs to a later batch. Keeping the decision here means that
 * evaluator cannot invent its own rule.
 *
 * Deliberately refuses when the requirement was met: a tester who did the work
 * is owed their coins back even if nobody settled it in time.
 */
function checkWindowExpired({
  status,
  lockTxId,
  lastEligibleDayKey,
  todayKey,
  qualifyingDays,
  daysRequired = COMMITMENT_DAYS_REQUIRED,
}) {
  if (status === "completed" || status === "failed" || status === "missed" || status === "cancelled") {
    return { expired: false, reason: "alreadySettled" };
  }
  if (!lockTxId) return { expired: false, reason: "noCommitment" };
  if (!isValidDayKey(lastEligibleDayKey) || !isValidDayKey(todayKey)) {
    return { expired: false, reason: "invalidWindow" };
  }
  if (!isWindowClosed({ lastEligibleDayKey, todayKey })) {
    return { expired: false, reason: "windowOpen" };
  }
  const days = Number.isInteger(qualifyingDays) && qualifyingDays > 0 ? qualifyingDays : 0;
  const required = Number.isInteger(daysRequired) && daysRequired > 0
    ? daysRequired
    : COMMITMENT_DAYS_REQUIRED;
  if (days >= required) {
    return { expired: false, reason: "requirementMet" };
  }
  return { expired: true, reason: "windowClosedShort", qualifyingDays: days, daysRequired: required };
}

/**
 * The instant a recorded testing day stops being "today", in the pinned zone.
 *
 * Local midnight AFTER `dayKey` - precisely the moment the next check-in
 * becomes available. It exists so the CLIENT never has to derive a local day.
 * Rendering "Logged today" used to mean comparing the server's day key against
 * a day key the device computed in UTC, which disagreed with the server for
 * the 5.5 hours between 00:00 and 05:30 IST: the server knew the tester had
 * already logged, the button looked available. Handing the device one
 * server-derived INSTANT removes the disagreement entirely, because comparing
 * two instants needs no timezone at all.
 *
 * Returns null on malformed input. A null renders as "not logged", which costs
 * a wasted round trip at worst and never a duplicate day - the server re-reads
 * the log and re-decides on every call.
 */
function nextCheckInAtMillis(dayKey, timeZone) {
  const nextDayKey = addDays(dayKey, 1);
  if (nextDayKey === null) return null;
  return startOfLocalDayMillis(nextDayKey, timeZone);
}

/**
 * Deterministic testing-log id.
 *
 * Built from the CYCLE-scoped assignment id, so a log from cycle 1 can never
 * be mistaken for progress on cycle 2 - the ids simply do not collide. Being
 * deterministic is also what makes `tx.create` the duplicate guard: a second
 * check-in on the same day fails at the storage layer, not on a read.
 */
function testingLogId(assignmentId, dayKey) {
  return `${assignmentId}__${dayKey}`;
}

/** Flex days left: window days not yet needed for the remaining requirement. */
function flexDaysRemaining({
  firstEligibleDayKey,
  lastEligibleDayKey,
  todayKey,
  qualifyingDays,
  daysRequired = COMMITMENT_DAYS_REQUIRED,
}) {
  const remainingRequired = Math.max(0, daysRequired - (qualifyingDays || 0));
  const from = daysBetween(firstEligibleDayKey, todayKey) < 0 ? firstEligibleDayKey : todayKey;
  const daysLeft = daysBetween(from, lastEligibleDayKey);
  if (daysLeft === null) return null;
  return Math.max(0, daysLeft + 1 - remainingRequired);
}

module.exports = {
  MILLIS_PER_DAY,
  isValidTimeZone,
  isValidDayKey,
  dayKeyInZone,
  addDays,
  daysBetween,
  zoneOffsetMillis,
  startOfLocalDayMillis,
  deriveWindow,
  maxPossibleQualifyingDays,
  isWindowClosed,
  checkTestingDayEligible,
  checkWindowExpired,
  testingLogId,
  flexDaysRemaining,
  nextCheckInAtMillis,
};

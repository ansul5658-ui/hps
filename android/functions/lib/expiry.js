/**
 * The pure expiry decision: may this commitment be forfeited yet?
 *
 * Side-effect free. It moves no coins, writes nothing and reads nothing - it
 * takes the assignment's stored state, the declared outage records and a
 * server instant, and returns a verdict. The transaction that acts on the
 * verdict lives in `expiry.js`, and it re-derives the decision itself rather
 * than trusting one passed in.
 *
 * THERE IS ONLY ONE WINDOW CALCULATION
 * This module deliberately adds none. The window is the one pinned at claim
 * time and evaluated by `checkWindowExpired` in `lib/testingDays.js`; the only
 * thing added here is crediting declared outage days, which is done by moving
 * the LAST ELIGIBLE DAY forward before that same function is asked. A second
 * implementation of "has the window closed" is exactly the bug class that
 * would let the check-in path and the forfeiture path disagree about whether a
 * tester still had time - one refusing a day the other then punishes them for
 * not having.
 *
 * WHY IT IS DELIBERATELY HARD TO GET A `true` OUT OF THIS
 * A `true` here destroys 50 of a tester's coins. So every uncertainty resolves
 * to "not expired": a missing timezone, a corrupt day key, a status that is
 * already terminal, an assignment with no stake, or a requirement that was
 * actually met. None of those forfeit. The cost of a wrong `false` is that a
 * commitment settles a day late; the cost of a wrong `true` is taking coins
 * from someone who did the work.
 */

const { COMMITMENT_DAYS_REQUIRED } = require("./constants");
const {
  dayKeyInZone,
  isValidDayKey,
  isValidTimeZone,
  checkWindowExpired,
  daysBetween,
} = require("./testingDays");
const { deriveEffectiveWindow } = require("./outages");

/**
 * Should this commitment be forfeited, as of `nowMillis`?
 *
 * `qualifyingDays` must be the SERVER's count - the caller recounts from the
 * logs inside the transaction. Passing the cached field would mean a stale
 * number could forfeit a tester who had actually finished.
 *
 * @returns {{expired: boolean, reason: string, todayKey?: string,
 *            effectiveLastEligibleDayKey?: string, creditedOutageDays?: number,
 *            outageDayKeys?: string[], qualifyingDays?: number,
 *            daysRequired?: number}}
 */
function checkCommitmentExpiry({
  status,
  lockTxId,
  appId,
  timeZone,
  firstEligibleDayKey,
  lastEligibleDayKey,
  qualifyingDays,
  daysRequired = COMMITMENT_DAYS_REQUIRED,
  outageRecords = [],
  nowMillis,
}) {
  // A zone that this runtime cannot read means no day boundary can be
  // derived. Refusing is the only safe answer - guessing UTC here would move
  // an Indian tester's deadline five and a half hours earlier.
  if (!isValidTimeZone(timeZone)) {
    return { expired: false, reason: "noTimeZone" };
  }
  if (!isValidDayKey(firstEligibleDayKey) || !isValidDayKey(lastEligibleDayKey)) {
    return { expired: false, reason: "invalidWindow" };
  }
  if (!Number.isFinite(nowMillis)) {
    return { expired: false, reason: "invalidClock" };
  }

  const todayKey = dayKeyInZone(nowMillis, timeZone);
  if (todayKey === null) {
    return { expired: false, reason: "invalidClock" };
  }

  // Outage credit, derived fresh every time - see `lib/outages.js` for why it
  // is never stored on the assignment.
  const effective = deriveEffectiveWindow({
    firstEligibleDayKey,
    lastEligibleDayKey,
    appId,
    records: outageRecords,
  });

  // THE single window check, reused. The outage credit reaches it only as a
  // later `lastEligibleDayKey`; the closing rule itself is untouched.
  const verdict = checkWindowExpired({
    status,
    lockTxId,
    lastEligibleDayKey: effective.effectiveLastEligibleDayKey,
    todayKey,
    qualifyingDays,
    daysRequired,
  });

  return {
    ...verdict,
    todayKey,
    timeZone,
    lastEligibleDayKey,
    effectiveLastEligibleDayKey: effective.effectiveLastEligibleDayKey,
    creditedOutageDays: effective.creditedOutageDays,
    outageDayKeys: effective.outageDayKeys,
  };
}

/**
 * Could this commitment possibly be expired by `nowMillis`, judging only by
 * its stored window?
 *
 * A cheap pre-filter for the sweep, so it does not recount logs for every
 * assignment it can see. It judges the commitment by its STORED window only,
 * ignoring outages and qualifying days, and everything it lets through is
 * re-decided by `checkCommitmentExpiry` inside the settlement transaction.
 *
 * Ignoring outages is safe in exactly one direction, and that direction is the
 * one that matters: outage credit only ever moves the last eligible day LATER,
 * so a commitment whose stored window is still open cannot be expired under
 * any set of declarations. The filter can therefore let through commitments
 * that an outage will later save - costing one wasted read each, which the
 * transaction then declines to forfeit - but it can never filter out one that
 * is genuinely expired.
 */
function couldBeExpired({ lastEligibleDayKey, timeZone, nowMillis }) {
  if (!isValidDayKey(lastEligibleDayKey) || !isValidTimeZone(timeZone)) return false;
  if (!Number.isFinite(nowMillis)) return false;
  const todayKey = dayKeyInZone(nowMillis, timeZone);
  const elapsed = daysBetween(lastEligibleDayKey, todayKey);
  if (elapsed === null) return false;
  // Strictly after: the last eligible day is itself still a testing day.
  return elapsed > 0;
}

module.exports = {
  checkCommitmentExpiry,
  couldBeExpired,
};

/**
 * Pure outage rules: which declared outage days protect which commitment.
 *
 * Side-effect free, like `lib/wallet.js`, `lib/commitments.js` and
 * `lib/testingDays.js`, so the decision that can hand a tester extra days -
 * and therefore decide whether 50 real coins are forfeited - is testable
 * without Firestore, the emulator or network access. The reads and the
 * transactions live in `systemHealth.js` and `expiry.js`.
 *
 * THE MODEL
 *
 *     systemHealth/{yyyy-MM-dd}   one declaration per calendar day
 *
 * A day is declared degraded by an admin. The document id IS the day key, so
 * a day cannot carry two conflicting declarations and nothing has to
 * de-duplicate them. A declaration is either global (every commitment) or
 * scoped to one app (only commitments on that app).
 *
 * WHY THE EXTENSION IS DERIVED, NEVER STORED
 * The obvious implementation writes a new `lastEligibleDayKey` onto the
 * assignment when an outage is declared. That is a worse design for three
 * reasons: it rewrites a field the whole system treats as immutable, it makes
 * the result depend on whether a backfill job ever ran, and a partial failure
 * leaves some testers extended and others not. Deriving the extension at
 * evaluation time instead means the answer is a pure function of the
 * assignment's pinned window and the declarations that exist - so running the
 * evaluator once, twice or ten times gives the same answer, and no migration
 * is ever needed.
 *
 * WHY OUTAGES ARE COUNTED ONLY INSIDE THE ORIGINAL WINDOW
 * Counting outages in the EXTENDED range too would be self-referential: each
 * extension could expose new outage days, which extend it further. That is
 * unbounded in principle and, worse, makes the answer depend on evaluation
 * order. So applicable days are counted strictly within the pinned
 * [firstEligibleDayKey, lastEligibleDayKey] range, which bounds the extension
 * by the window length and makes it a one-pass calculation.
 *
 * The known trade-off, stated rather than hidden: an outage falling on one of
 * the extension days does not itself extend the window further. A long outage
 * near the end of a window therefore protects less than a generous reading
 * would. Widening that is a policy decision, not a bug fix, and it belongs to
 * whoever owns the outage policy - not to this batch.
 */

const { addDays, daysBetween, isValidDayKey } = require("./testingDays");

/** Every commitment is affected. */
const OUTAGE_SCOPE_GLOBAL = "global";
/** Only commitments on the named app are affected. */
const OUTAGE_SCOPE_APP = "app";

const OUTAGE_SCOPES = [OUTAGE_SCOPE_GLOBAL, OUTAGE_SCOPE_APP];

/**
 * Hard ceiling on how many days an outage run may add to one window.
 *
 * Counting inside the original window already bounds this by the window
 * length, so reaching the cap means the stored data is wrong - a corrupt
 * window, or declarations that should never have been made. Capping rather
 * than trusting the count keeps a data error from turning into an
 * indefinitely un-expirable commitment holding someone's coins hostage.
 */
const MAX_OUTAGE_EXTENSION_DAYS = 30;

function isValidOutageScope(scope) {
  return OUTAGE_SCOPES.includes(scope);
}

/**
 * Does this declaration protect a commitment on `appId`?
 *
 * Fails CLOSED on anything malformed: a record with an unknown scope, a
 * missing day key or an app scope with no app protects nobody. An outage
 * record is admin-declared, so a malformed one is a mistake to surface, not a
 * reason to hand out free days.
 */
function outageApplies(record, appId) {
  if (!record || record.degraded !== true) return false;
  if (!isValidDayKey(record.dayKey)) return false;
  if (!isValidOutageScope(record.scope)) return false;
  if (record.scope === OUTAGE_SCOPE_GLOBAL) return true;
  // App-scoped: the ids must match exactly. An app-scoped declaration with no
  // appId names nothing and so protects nothing.
  if (typeof record.appId !== "string" || record.appId.length === 0) return false;
  return record.appId === appId;
}

/** Is `dayKey` inside [fromKey, toKey], inclusive? */
function isDayKeyWithin(dayKey, fromKey, toKey) {
  const fromDiff = daysBetween(fromKey, dayKey);
  const toDiff = daysBetween(dayKey, toKey);
  if (fromDiff === null || toDiff === null) return false;
  return fromDiff >= 0 && toDiff >= 0;
}

/**
 * The distinct day keys that both apply to this commitment and fall inside
 * its pinned window.
 *
 * De-duplicated on the day key, so even if a caller passes the same record
 * twice - a retried read, a merged list - a day can only ever be counted once.
 * Returned sorted so the result is stable and easy to assert on.
 */
function applicableOutageDayKeys(records, { firstEligibleDayKey, lastEligibleDayKey, appId }) {
  if (!isValidDayKey(firstEligibleDayKey) || !isValidDayKey(lastEligibleDayKey)) return [];
  const keys = new Set();
  for (const record of records || []) {
    if (!outageApplies(record, appId)) continue;
    if (!isDayKeyWithin(record.dayKey, firstEligibleDayKey, lastEligibleDayKey)) continue;
    keys.add(record.dayKey);
  }
  return [...keys].sort();
}

/** How many days this commitment's window is extended by. Never negative. */
function countApplicableOutageDays(records, window) {
  const days = applicableOutageDayKeys(records, window).length;
  return Math.min(days, MAX_OUTAGE_EXTENSION_DAYS);
}

/**
 * The last day that can still qualify, once declared outages are credited.
 *
 * Returns the ORIGINAL key unchanged when there is nothing to credit, so a
 * commitment with no applicable outage behaves exactly as it did before this
 * existed - which is what makes adding outage handling a no-op for every
 * commitment that was never affected by one.
 */
function effectiveLastEligibleDayKey({ firstEligibleDayKey, lastEligibleDayKey, appId, records }) {
  if (!isValidDayKey(lastEligibleDayKey)) return null;
  const credited = countApplicableOutageDays(records, {
    firstEligibleDayKey,
    lastEligibleDayKey,
    appId,
  });
  if (credited === 0) return lastEligibleDayKey;
  return addDays(lastEligibleDayKey, credited);
}

/**
 * The whole effective window, for callers that want to report it.
 *
 * `creditedOutageDays` is returned rather than written anywhere: it is a
 * derived figure, and storing it would reintroduce exactly the staleness this
 * module exists to avoid.
 */
function deriveEffectiveWindow({ firstEligibleDayKey, lastEligibleDayKey, appId, records }) {
  const dayKeys = applicableOutageDayKeys(records, {
    firstEligibleDayKey,
    lastEligibleDayKey,
    appId,
  });
  const credited = Math.min(dayKeys.length, MAX_OUTAGE_EXTENSION_DAYS);
  return {
    firstEligibleDayKey,
    lastEligibleDayKey,
    creditedOutageDays: credited,
    outageDayKeys: dayKeys,
    effectiveLastEligibleDayKey:
      credited === 0 ? lastEligibleDayKey : addDays(lastEligibleDayKey, credited),
  };
}

module.exports = {
  OUTAGE_SCOPE_GLOBAL,
  OUTAGE_SCOPE_APP,
  OUTAGE_SCOPES,
  MAX_OUTAGE_EXTENSION_DAYS,
  isValidOutageScope,
  outageApplies,
  isDayKeyWithin,
  applicableOutageDayKeys,
  countApplicableOutageDays,
  effectiveLastEligibleDayKey,
  deriveEffectiveWindow,
};

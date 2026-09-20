/**
 * Pure completion-verification rules.
 *
 * Side-effect free, like `lib/validation.js` and `lib/matching.js`, so every
 * precondition can be unit tested without Firestore, the emulator or network
 * access. The orchestration that reads documents lives in `completion.js`.
 *
 * NOTE ON WHAT IS NOT HERE
 * This module used to gate a completion REWARD, and validated a `coinReward`
 * amount to pay out. Under the commitment product there is no payout: Testing
 * Coins are staked, and completing returns the same coins rather than minting
 * new ones. The amount check is therefore gone, not relaxed - verification no
 * longer decides anything about money. Do not reintroduce an amount here; the
 * only place coins may move is `wallet.js`.
 */

const { VERIFIABLE_FROM_STATUSES } = require("./constants");

/**
 * Every value-derived precondition for verifying a completed assignment.
 *
 * Existence checks (assignment present, tester profile present) stay with the
 * caller, which is the only place that can read documents. Everything
 * decidable from plain values is decided here.
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
function checkCompletionEligible({ status, daysRequired, loggedDays }) {
  if (!VERIFIABLE_FROM_STATUSES.includes(status)) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `An assignment in "${status}" cannot be verified.`,
    };
  }

  // A missing or non-positive requirement would make any log count "enough",
  // so it fails hard instead of falling back to a default.
  if (!Number.isInteger(daysRequired) || daysRequired <= 0) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That assignment has no valid day requirement.",
    };
  }

  if (!Number.isInteger(loggedDays) || loggedDays < daysRequired) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `Only ${loggedDays} of ${daysRequired} testing days are logged.`,
    };
  }

  return { ok: true };
}

module.exports = { checkCompletionEligible };

/**
 * Pure completion-reward rules.
 *
 * Side-effect free, like `lib/validation.js` and `lib/matching.js`, so every
 * payment precondition can be unit tested without Firestore, the emulator or
 * network access. The orchestration that reads documents and writes the
 * ledger lives in `rewards.js`.
 */

const { VERIFIABLE_FROM_STATUSES, MAX_SINGLE_REWARD } = require("./constants");

/**
 * Deterministic ledger document id for an assignment's completion reward.
 *
 * This is the idempotency key for the entire payment path. Assignment ids are
 * themselves deterministic ("{appId}__{testerId}"), so one assignment can only
 * ever map to `done_{assignmentId}`, and `tx.create` makes a second one
 * impossible. This must never be random or time-derived: a generated id would
 * silently permit a second payment for the same work.
 */
function completionLedgerId(assignmentId) {
  return `done_${assignmentId}`;
}

/**
 * Every value-derived precondition for paying a completion reward.
 *
 * Existence checks (assignment present, tester profile present, ledger entry
 * already there) stay with the caller, which is the only place that can read
 * documents. Everything decidable from plain values is decided here.
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
function checkCompletionEligible({ status, daysRequired, loggedDays, coinReward }) {
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

  // No fallback to DEFAULT_COIN_REWARD: a corrupt or absent amount must stop
  // the payment, never quietly substitute one.
  if (!Number.isInteger(coinReward) || coinReward <= 0 || coinReward > MAX_SINGLE_REWARD) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That assignment has no valid reward amount.",
    };
  }

  return { ok: true };
}

module.exports = { completionLedgerId, checkCompletionEligible };

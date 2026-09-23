/**
 * Pure rules for retiring reward-era TEST assignments.
 *
 * WHAT THIS IS
 * Production still holds two assignments created by the retired push-matching
 * path during the 2026-09-19 end-to-end test, before any coin could be staked.
 * The commitment engine cannot settle them - every settlement path refuses an
 * assignment with no `lockTxId`, correctly - so they would sit in `ready` /
 * `inProgress` forever and block their testers from ever claiming that app.
 *
 * Closing one is DATA RETIREMENT, not a settlement. No coins were staked, so
 * no coins may move: this module decides nothing about money, and the
 * orchestration in `legacyCloseOut.js` never touches the wallet or the ledger.
 *
 * WHY IT IS AN ALLOW-LIST
 * The targets are named exactly, by assignment id AND app id. A general
 * "cancel anything without a lock" tool would be one bad query away from
 * cancelling a real tester's work, so there is no such tool: an id not on this
 * list is refused before anything else is looked at.
 */

const { TERMINAL_ASSIGNMENT_STATUSES } = require("./constants");

/** The placeholder app ("h" / com.j) created for the 2026-09-19 test run. */
const LEGACY_TEST_APP_ID = "cRpx5SzmATXpW6jVXiZ2";

/**
 * The only assignments this close-out may ever touch. Reward-era ids,
 * `{appId}__{testerId}`, with no cycle suffix.
 */
const LEGACY_CLOSE_OUT_ASSIGNMENT_IDS = Object.freeze([
  `${LEGACY_TEST_APP_ID}__03boqSxaUQVy1Nul8FSFDX2w7HL2`,
  `${LEGACY_TEST_APP_ID}__PVK6EF7YM5OLQrWjTe2v56fnySb2`,
]);

const LEGACY_CLOSE_OUT_REASON = "legacyTestDataRetirement";

/** Statuses a reward-era assignment could still be open in. */
const LEGACY_OPEN_STATUSES = ["ready", "inProgress", "waitingForVerification"];

/**
 * Commitment-era fields. The presence of ANY of them means the document is not
 * a reward-era record, whatever else it looks like, and must go through the
 * real settlement paths instead.
 */
const COMMITMENT_FIELDS = [
  "lockTxId",
  "commitmentAmount",
  "cycle",
  "settlementTxId",
  "timeZone",
  "firstEligibleDayKey",
  "lastEligibleDayKey",
  "windowEndsAt",
];

function isPresent(value) {
  return value !== undefined && value !== null && value !== "";
}

/**
 * Decide whether an assignment may be retired.
 *
 * `data` is the assignment document's fields (null if it does not exist).
 * `lockLedgerExists` says whether `users/{tester}/coinTransactions/lock_{id}`
 * exists - a stake recorded in the ledger even if the assignment forgot it.
 *
 * @returns {{ok: true} | {ok: false, alreadyClosed: true}
 *          | {ok: false, code: string, message: string}}
 */
function checkLegacyCloseOutEligible({
  assignmentId,
  data,
  lockLedgerExists = false,
  allowedIds = LEGACY_CLOSE_OUT_ASSIGNMENT_IDS,
  allowedAppId = LEGACY_TEST_APP_ID,
}) {
  if (!allowedIds.includes(assignmentId)) {
    return {
      ok: false,
      code: "permission-denied",
      message: "That assignment is not on the legacy close-out list.",
    };
  }
  if (!data) {
    return { ok: false, code: "not-found", message: "That assignment no longer exists." };
  }
  if (data.appId !== allowedAppId || !assignmentId.startsWith(`${allowedAppId}__`)) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That assignment does not belong to the legacy test app.",
    };
  }
  if (typeof data.testerId !== "string" || assignmentId !== `${allowedAppId}__${data.testerId}`) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That assignment does not have a reward-era id.",
    };
  }

  // Idempotency: our own earlier close-out. Checked before the commitment
  // fields so a repeat call is a clean no-op rather than an error.
  if (
    data.status === "cancelled" &&
    data.legacyCloseOut &&
    data.legacyCloseOut.reason === LEGACY_CLOSE_OUT_REASON
  ) {
    return { ok: false, alreadyClosed: true };
  }

  const commitmentField = COMMITMENT_FIELDS.find((f) => isPresent(data[f]));
  if (commitmentField) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `That assignment carries "${commitmentField}" - it is a commitment, not legacy data.`,
    };
  }
  if (lockLedgerExists) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "A coin lock exists for that assignment - it must be settled, not retired.",
    };
  }

  if (TERMINAL_ASSIGNMENT_STATUSES.includes(data.status)) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `That assignment is already "${data.status}".`,
    };
  }
  if (!LEGACY_OPEN_STATUSES.includes(data.status)) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `An assignment in "${data.status}" cannot be retired.`,
    };
  }

  return { ok: true };
}

module.exports = {
  LEGACY_TEST_APP_ID,
  LEGACY_CLOSE_OUT_ASSIGNMENT_IDS,
  LEGACY_CLOSE_OUT_REASON,
  LEGACY_OPEN_STATUSES,
  COMMITMENT_FIELDS,
  checkLegacyCloseOutEligible,
};

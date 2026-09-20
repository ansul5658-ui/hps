/**
 * Assignment completion verification.
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 * This module used to be `rewards.js`, and it was the only code in the project
 * that created coins: verifying an assignment paid the tester its `coinReward`
 * and incremented `users/{uid}.coinBalance`. That belonged to a reward product.
 *
 * Testing Coins are now a COMMITMENT device. A tester stakes coins on an
 * assignment; completing it returns the SAME coins. There is no +50, so
 * verification mints nothing. Both coin writes are gone - not disabled behind
 * a flag, removed - and this function no longer touches the wallet or the
 * ledger at all. It records that the work was verified, and nothing else.
 *
 * The unlock-on-completion path (returning the staked coins) is a later batch
 * and will live in `wallet.js`, where the invariant is enforced. Do not add
 * coin movement back into this file: verification runs under admin authority,
 * and money movement must stay in one auditable place.
 *
 * SECURITY MODEL
 *   * The caller supplies an assignment id and nothing else.
 *   * The day requirement is re-counted from `testingLogs` at verification
 *     time. The cached `daysCompleted` is for display; it is not authority.
 *   * An admin cannot verify their own assignment.
 *   * The status flip is a single transactional update, and an already
 *     completed assignment is a no-op rather than an error.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const { REGION } = require("./lib/constants");
const { checkCompletionEligible } = require("./lib/completion");
const { requireAuth, requireAdmin, requireDocId } = require("./lib/guards");
const { isValidDocId } = require("./lib/validation");

/**
 * Verify an assignment, atomically.
 *
 * Exported separately from the callable - the same split `runMatching` uses -
 * so the path can be tested without the Functions runtime.
 *
 * @returns {Promise<{assignmentId: string, verified: boolean, reason?: string,
 *                    testerId?: string}>}
 */
async function runCompletionVerification(db, { assignmentId, adminUid }) {
  const assignmentRef = db.doc(`testingAssignments/${assignmentId}`);

  return db.runTransaction(async (tx) => {
    // ---- reads: all of them, before any write ------------------------
    const assignment = await tx.get(assignmentRef);
    if (!assignment.exists) {
      throw new HttpsError("not-found", "That assignment no longer exists.");
    }

    const status = assignment.get("status");
    // Already verified on an earlier call, a retry, or a racing verification.
    // Returning rather than throwing keeps a repeat click harmless.
    if (status === "completed") {
      return { assignmentId, verified: false, reason: "alreadyCompleted" };
    }

    const testerId = assignment.get("testerId");
    if (!isValidDocId(testerId)) {
      throw new HttpsError("failed-precondition", "That assignment has no valid tester.");
    }

    // Separation of duties: an admin who is also the tester would otherwise be
    // verifying their own work. Mirrors adminSetUserSuspended and
    // adminGrantCoins refusing to act on the caller's own account.
    if (testerId === adminUid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot verify your own testing assignment.",
      );
    }

    const userRef = db.doc(`users/${testerId}`);
    const tester = await tx.get(userRef);
    if (!tester.exists) {
      throw new HttpsError("failed-precondition", "That tester no longer has a profile.");
    }
    // An absent field means "never suspended" - the same semantics guards.js
    // uses, and the reason security rules must read this field defensively.
    if (tester.get("isSuspended") === true) {
      throw new HttpsError("failed-precondition", "That tester's account is suspended.");
    }

    // Verification authority: the logs themselves, not the cached counter.
    const countSnap = await tx.get(
      db.collection("testingLogs").where("assignmentId", "==", assignmentId).count(),
    );
    const loggedDays = countSnap.data().count;

    const eligible = checkCompletionEligible({
      status,
      daysRequired: assignment.get("daysRequired"),
      loggedDays,
    });
    if (!eligible.ok) {
      throw new HttpsError(eligible.code, eligible.message);
    }

    // ---- write: the status flip, and nothing else --------------------
    // No ledger entry. No balance change. Verification is a record that the
    // work happened; it is not a payment event.
    tx.update(assignmentRef, {
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      verifiedBy: adminUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { assignmentId, verified: true, testerId };
  });
}

/**
 * Guard + verification, split out so the authorization wiring is testable too.
 */
async function verifyAssignmentCompletion(db, request) {
  const uid = requireAuth(request);
  await requireAdmin(db, uid);
  const assignmentId = requireDocId(
    request.data && request.data.assignmentId,
    "assignmentId",
  );

  const outcome = await runCompletionVerification(db, { assignmentId, adminUid: uid });

  if (outcome.verified) {
    logger.info(
      `admin ${uid} verified assignment ${assignmentId} for ${outcome.testerId} (no coins moved)`,
    );
  } else {
    logger.info(
      `admin ${uid} verified assignment ${assignmentId}: no-op (${outcome.reason})`,
    );
  }
  return outcome;
}

/**
 * Callable: verify a completed assignment.
 *
 * Input is `{ assignmentId }` only. There is deliberately no way for a caller
 * to influence the tester or the day count - and, now, nothing for an amount
 * to influence either.
 */
const adminVerifyAssignment = onCall({ region: REGION }, (request) =>
  verifyAssignmentCompletion(getFirestore(), request),
);

module.exports = {
  adminVerifyAssignment,
  verifyAssignmentCompletion,
  runCompletionVerification,
};

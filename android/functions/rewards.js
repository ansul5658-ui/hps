/**
 * Completion rewards — the only code in this project that creates coins.
 *
 * SECURITY MODEL
 *   * Coins are paid once per assignment, when an admin verifies a completed
 *     assignment. Daily `testingLogs` are evidence of progress and are never
 *     themselves a payment event.
 *   * The caller supplies an assignment id and nothing else. The amount is
 *     read from `testingAssignments/{id}.coinReward`, which no client can
 *     write (rules refuse `create` outright and restrict `update` to
 *     `status`/`updatedAt`), and is frozen again into the immutable ledger
 *     entry so later config changes cannot rewrite history.
 *   * The day requirement is re-counted from `testingLogs` at payment time.
 *     The cached `daysCompleted` is for display; it is not payment authority.
 *   * Idempotency is structural, not best-effort: the ledger id is derived
 *     from the assignment id, and `tx.create` refuses to overwrite it.
 *   * The status flip, the ledger entry and the balance increment commit in
 *     ONE transaction, so an assignment can never be completed-but-unpaid or
 *     paid-but-incomplete.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  COIN_KIND_EARN,
  COIN_SOURCE_ASSIGNMENT_COMPLETION,
} = require("./lib/constants");
const { completionLedgerId, checkCompletionEligible } = require("./lib/rewards");
const { requireAuth, requireAdmin, requireDocId } = require("./lib/guards");
const { isValidDocId } = require("./lib/validation");

/**
 * Verify an assignment and pay its completion reward, atomically.
 *
 * Exported separately from the callable — the same split `runMatching` uses —
 * so the payment path can be tested without the Functions runtime.
 *
 * @returns {Promise<{assignmentId: string, awarded: boolean, reason?: string,
 *                    amount?: number, testerId?: string}>}
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
    // Already paid on an earlier call, a retry, or a racing verification.
    // Returning rather than throwing keeps a repeat click harmless.
    if (status === "completed") {
      return { assignmentId, awarded: false, reason: "alreadyCompleted" };
    }

    const testerId = assignment.get("testerId");
    if (!isValidDocId(testerId)) {
      throw new HttpsError("failed-precondition", "That assignment has no valid tester.");
    }

    // Separation of duties: an admin who is also the tester would otherwise be
    // able to pay themselves. Mirrors adminSetUserSuspended refusing to act on
    // the caller's own account.
    if (testerId === adminUid) {
      throw new HttpsError(
        "failed-precondition",
        "You cannot verify your own testing assignment.",
      );
    }

    const ledgerRef = db.doc(
      `users/${testerId}/coinTransactions/${completionLedgerId(assignmentId)}`,
    );
    const ledger = await tx.get(ledgerRef);
    if (ledger.exists) {
      return { assignmentId, awarded: false, reason: "alreadyAwarded" };
    }

    const userRef = db.doc(`users/${testerId}`);
    const tester = await tx.get(userRef);
    if (!tester.exists) {
      throw new HttpsError("failed-precondition", "That tester no longer has a profile.");
    }
    // An absent field means "never suspended" — the same semantics guards.js
    // uses, and the reason security rules must read this field defensively.
    if (tester.get("isSuspended") === true) {
      throw new HttpsError("failed-precondition", "That tester's account is suspended.");
    }

    // Payment authority: the logs themselves, not the cached counter.
    const countSnap = await tx.get(
      db.collection("testingLogs").where("assignmentId", "==", assignmentId).count(),
    );
    const loggedDays = countSnap.data().count;

    const coinReward = assignment.get("coinReward");
    const eligible = checkCompletionEligible({
      status,
      daysRequired: assignment.get("daysRequired"),
      loggedDays,
      coinReward,
    });
    if (!eligible.ok) {
      throw new HttpsError(eligible.code, eligible.message);
    }

    // ---- writes: these three commit together or not at all -----------
    tx.update(assignmentRef, {
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      verifiedBy: adminUid,
      updatedAt: FieldValue.serverTimestamp(),
    });

    const appId = assignment.get("appId");
    // `create`, never `set`: an existing entry must fail the transaction
    // rather than be overwritten.
    tx.create(ledgerRef, {
      userId: testerId,
      amount: coinReward,
      kind: COIN_KIND_EARN,
      source: COIN_SOURCE_ASSIGNMENT_COMPLETION,
      reason: isValidDocId(appId)
        ? `Completed testing for ${appId}`
        : "Completed testing assignment",
      relatedAssignmentId: assignmentId,
      actorId: adminUid,
      recordedByAdmin: true,
      createdAt: FieldValue.serverTimestamp(),
    });

    // `increment` rather than read-modify-write: it is computed server-side at
    // commit, and treats a missing field as 0 — which matters because no
    // production user document carries `coinBalance` yet.
    tx.update(userRef, {
      coinBalance: FieldValue.increment(coinReward),
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { assignmentId, awarded: true, amount: coinReward, testerId };
  });
}

/**
 * Guard + payment, split out so the authorization wiring is testable too.
 *
 * `requireAdmin` re-reads the caller's role from Firestore on every call and
 * also refuses a suspended admin; nothing here trusts a client-supplied flag.
 */
async function verifyAssignmentCompletion(db, request) {
  const uid = requireAuth(request);
  await requireAdmin(db, uid);
  const assignmentId = requireDocId(
    request.data && request.data.assignmentId,
    "assignmentId",
  );

  const outcome = await runCompletionVerification(db, { assignmentId, adminUid: uid });

  if (outcome.awarded) {
    logger.info(
      `admin ${uid} verified assignment ${assignmentId}: paid ${outcome.amount} to ${outcome.testerId}`,
    );
  } else {
    logger.info(
      `admin ${uid} verified assignment ${assignmentId}: no-op (${outcome.reason})`,
    );
  }
  return outcome;
}

/**
 * Callable: verify a completed assignment and pay its reward.
 *
 * Input is `{ assignmentId }` only — there is deliberately no way for a caller
 * to influence the amount, the tester, or the day count.
 */
const adminVerifyAssignment = onCall({ region: REGION }, (request) =>
  verifyAssignmentCompletion(getFirestore(), request),
);

module.exports = {
  adminVerifyAssignment,
  verifyAssignmentCompletion,
  runCompletionVerification,
};

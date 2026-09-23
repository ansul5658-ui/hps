/**
 * One-off retirement of reward-era TEST assignments.
 *
 * NOT A CLOUD FUNCTION. Nothing here is exported from `index.js`, on purpose:
 * a deployed endpoint that can cancel assignments is standing attack surface
 * for a job that runs once. It is driven by `scripts/legacy-close-out.js`,
 * whose caller is authorized twice - by the Google credentials that let the
 * Admin SDK reach the project at all, and by `requireAdmin` below against the
 * operator uid that gets recorded as `cancelledBy`.
 *
 * NO COINS MOVE. These assignments predate the wallet; nothing was ever
 * locked, so there is nothing to return and nothing to forfeit. This module
 * does not import `wallet.js` and must never start to: no wallet document, no
 * ledger entry, no `settlementTxId`. The one ledger READ below exists only to
 * refuse if a stake turns out to exist after all.
 *
 * The assignment's testingLogs are left alone - they are the record of what
 * happened on the test run, and the new rules still let the tester read them.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { FieldValue } = require("firebase-admin/firestore");

const { requireAdmin } = require("./lib/guards");
const { activeClaimId, lockEntryId } = require("./lib/commitments");
const {
  checkLegacyCloseOutEligible,
  LEGACY_CLOSE_OUT_REASON,
} = require("./lib/legacyCloseOut");

/**
 * Retire one legacy assignment, atomically.
 *
 * @returns {Promise<{assignmentId: string, closed: boolean, reason?: string,
 *                    previousStatus?: string, claimRemoved?: boolean}>}
 */
async function runLegacyCloseOut(db, { assignmentId, adminUid, allowedIds, allowedAppId }) {
  if (typeof adminUid !== "string" || adminUid.length === 0) {
    throw new HttpsError("unauthenticated", "An operator admin uid is required.");
  }
  await requireAdmin(db, adminUid);

  const assignmentRef = db.doc(`testingAssignments/${assignmentId}`);

  return db.runTransaction(async (tx) => {
    // ---- reads: all of them, before any write ------------------------
    const snap = await tx.get(assignmentRef);
    const data = snap.exists ? snap.data() : null;

    // Only look further once the id is known to be on the list, so a refused
    // id never causes a read of anyone's ledger.
    let lockLedgerExists = false;
    let claimSnap = null;
    const precheck = checkLegacyCloseOutEligible({
      assignmentId,
      data,
      allowedIds,
      allowedAppId,
    });
    if (precheck.ok) {
      const testerId = data.testerId;
      const lockSnap = await tx.get(
        db.doc(`users/${testerId}/coinTransactions/${lockEntryId(assignmentId)}`),
      );
      lockLedgerExists = lockSnap.exists;
      claimSnap = await tx.get(db.doc(`activeClaims/${activeClaimId(data.appId, testerId)}`));
    }

    const eligible = checkLegacyCloseOutEligible({
      assignmentId,
      data,
      lockLedgerExists,
      allowedIds,
      allowedAppId,
    });
    if (eligible.alreadyClosed) {
      return { assignmentId, closed: false, reason: "alreadyClosed" };
    }
    if (!eligible.ok) {
      throw new HttpsError(eligible.code, eligible.message);
    }

    // ---- writes ------------------------------------------------------
    tx.update(assignmentRef, {
      status: "cancelled",
      cancelledAt: FieldValue.serverTimestamp(),
      cancelledBy: adminUid,
      legacyCloseOut: {
        reason: LEGACY_CLOSE_OUT_REASON,
        previousStatus: data.status,
        closedBy: adminUid,
        closedAt: FieldValue.serverTimestamp(),
      },
      updatedAt: FieldValue.serverTimestamp(),
    });

    // A reward-era assignment never had a claim, but if one exists for this
    // exact assignment it would otherwise block the tester's next commitment
    // forever. A claim naming any OTHER assignment is a live commitment and is
    // left strictly alone.
    let claimRemoved = false;
    if (claimSnap && claimSnap.exists && claimSnap.get("assignmentId") === assignmentId) {
      tx.delete(claimSnap.ref);
      claimRemoved = true;
    }

    return { assignmentId, closed: true, previousStatus: data.status, claimRemoved };
  });
}

module.exports = { runLegacyCloseOut };

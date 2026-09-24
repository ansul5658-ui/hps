/**
 * Developer testing setup, app readiness and join eligibility (Batch 9D).
 * See lib/setup.js for the product rule and for what is checked versus
 * self-confirmed.
 *
 * SECURITY MODEL
 *   * The setup links (`packageName`, `closedTestingUrl`, `playStoreUrl`) stay
 *     where they always were: owner-editable fields on the app, under the
 *     existing rules allow-list. That list does NOT include
 *     `setupConfirmation`, so a client cannot write a confirmation - for its
 *     own app or anyone's. Only `confirmAppTestingSetup` writes it, for the
 *     verified owner, and only after the server has checked the links.
 *   * A confirmation carries a fingerprint of exactly what was confirmed. The
 *     owner may still edit the links (they are theirs), but doing so makes the
 *     confirmation outdated and the app not ready until they confirm again -
 *     so an edit can never inherit a confirmation it did not get.
 *   * The confirmation is written with a last-update-time precondition: if the
 *     app changed between the server's check and its write, the write fails
 *     rather than stamping a confirmation onto values nobody checked.
 *   * Readiness is enforced where it matters - inside the claim transaction
 *     (commitments.js). The reads here only report it.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  OFFICIAL_GROUP_ID,
  OFFICIAL_GROUP_EMAIL,
  ACTIVE_CLAIMS_COLLECTION,
  DEFAULT_COMMITMENT_AMOUNT,
  REQUIRED_TESTER_COUNT,
  TERMINAL_ASSIGNMENT_STATUSES,
} = require("./lib/constants");
const {
  SETUP_CONFIRMATION_FIELD,
  SETUP_CONFIRMATION_KIND,
  appGroupId,
  setupFingerprint,
  checkAppReadiness,
  checkConfirmSetup,
} = require("./lib/setup");
const { activeClaimId } = require("./lib/commitments");
const { readWalletForUpdate } = require("./wallet");
const { requireAuth, requireDocId, requireNotSuspended, loadUser } = require("./lib/guards");

const FAILED_PRECONDITION = 9;

function millisOf(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  return null;
}

/** The email testers are told to join for `groupId`. */
async function readGroupEmail(db, groupId) {
  const snap = await db.doc(`groups/${groupId}`).get();
  const email = snap.exists ? snap.get("googleGroupEmail") : null;
  if (typeof email === "string" && email.trim()) return email.trim();
  return groupId === OFFICIAL_GROUP_ID ? OFFICIAL_GROUP_EMAIL : null;
}

// ---------------------------------------------------------------------------
// Developer: self-confirm the testing setup
// ---------------------------------------------------------------------------

async function runConfirmSetup(db, { callerId, appId, closedTestConfigured, googleGroupAdded }) {
  const ref = db.doc(`apps/${appId}`);
  const snap = await ref.get();
  const app = snap.exists ? snap.data() : null;

  const verdict = checkConfirmSetup({ callerId, app, closedTestConfigured, googleGroupAdded });
  if (!verdict.ok) {
    throw new HttpsError(verdict.code, verdict.message, {
      reason: verdict.reason,
      ...(verdict.gaps ? { gaps: verdict.gaps } : {}),
    });
  }

  const groupId = appGroupId(app);
  const groupEmail = await readGroupEmail(db, groupId);
  const confirmation = {
    kind: SETUP_CONFIRMATION_KIND,
    confirmedBy: callerId,
    confirmedAt: FieldValue.serverTimestamp(),
    // The exact values that were confirmed. Any later edit to them makes this
    // confirmation outdated - see `checkAppReadiness`.
    fingerprint: setupFingerprint(app),
    groupId,
    groupEmail,
    // What the developer stated. Recorded as statements, not facts: AppTesting
    // cannot see the Play Console or the group's membership.
    closedTestConfigured: true,
    googleGroupAdded: true,
  };

  try {
    await ref.update(
      { [SETUP_CONFIRMATION_FIELD]: confirmation, updatedAt: FieldValue.serverTimestamp() },
      { lastUpdateTime: snap.updateTime },
    );
  } catch (err) {
    if (err && (err.code === FAILED_PRECONDITION || err.code === "failed-precondition")) {
      throw new HttpsError(
        "aborted",
        "Your app changed while confirming. Check the details and confirm again.",
        { reason: "appChanged" },
      );
    }
    throw err;
  }

  return {
    confirmed: true,
    appId,
    kind: SETUP_CONFIRMATION_KIND,
    groupId,
    groupEmail,
    ready: checkAppReadiness({ ...app, [SETUP_CONFIRMATION_FIELD]: confirmation }).ready,
  };
}

async function confirmAppTestingSetupImpl(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");
  await requireNotSuspended(db, uid);
  const outcome = await runConfirmSetup(db, {
    callerId: uid,
    appId,
    closedTestConfigured: request.data.closedTestConfigured,
    googleGroupAdded: request.data.googleGroupAdded,
  });
  logger.info(`developer ${uid} self-confirmed the testing setup of ${appId}`);
  return outcome;
}

// ---------------------------------------------------------------------------
// Developer / admin: the readiness checklist
// ---------------------------------------------------------------------------

async function runAppReadiness(db, { callerId, appId }) {
  const snap = await db.doc(`apps/${appId}`).get();
  if (!snap.exists) throw new HttpsError("not-found", "That app does not exist.");
  const app = snap.data();
  if (app.ownerId !== callerId) {
    const caller = await loadUser(db, callerId);
    const isAdmin = caller.exists && caller.data.role === "admin" && caller.data.isSuspended !== true;
    if (!isAdmin) {
      throw new HttpsError("permission-denied", "Only the app's developer can see its setup.");
    }
  }
  const readiness = checkAppReadiness(app);
  const groupId = appGroupId(app);
  const c = app[SETUP_CONFIRMATION_FIELD];
  return {
    appId,
    ready: readiness.ready,
    gaps: readiness.gaps,
    groupId,
    groupEmail: await readGroupEmail(db, groupId),
    confirmation: c && typeof c === "object"
      ? {
        kind: c.kind || null,
        confirmedAtMillis: millisOf(c.confirmedAt),
        current: readiness.confirmed,
      }
      : null,
  };
}

async function getAppTestingReadinessImpl(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");
  return runAppReadiness(db, { callerId: uid, appId });
}

// ---------------------------------------------------------------------------
// Tester: may I join this app? Every blocker at once, nothing written.
// ---------------------------------------------------------------------------

/**
 * A preview of the claim's decision for the join screen. READ-ONLY and
 * ADVISORY: the claim transaction re-decides everything itself and never
 * consults this. It exists so the app can show the whole checklist instead of
 * discovering blockers one refused claim at a time.
 */
async function runJoinEligibility(db, { callerId, appId }) {
  return db.runTransaction(async (tx) => {
    const [appSnap, userSnap, claimSnap, ownAppsSnap, priorSnap] = await Promise.all([
      tx.get(db.doc(`apps/${appId}`)),
      tx.get(db.doc(`users/${callerId}`)),
      tx.get(db.doc(`${ACTIVE_CLAIMS_COLLECTION}/${activeClaimId(appId, callerId)}`)),
      tx.get(db.collection("apps").where("ownerId", "==", callerId)),
      tx.get(db.collection("testingAssignments").where("appId", "==", appId).where("testerId", "==", callerId)),
    ]);
    const app = appSnap.exists ? appSnap.data() : null;
    const groupId = appGroupId(app);
    const membershipSnap = await tx.get(db.doc(`users/${callerId}/memberships/${groupId}`));
    const { wallet } = await readWalletForUpdate(tx, db, callerId);

    const blockers = [];
    if (userSnap.exists && userSnap.get("isSuspended") === true) blockers.push("suspended");
    if (!app) blockers.push("appMissing");
    if (app && app.ownerId === callerId) blockers.push("ownApp");
    const open = priorSnap.docs.some((d) => !TERMINAL_ASSIGNMENT_STATUSES.includes(d.get("status")));
    if (claimSnap.exists || open) blockers.push("alreadyJoined");

    const target = checkAppReadiness(app);
    if (app && !target.ready) blockers.push("targetNotReady");
    const hasEligibleOwnApp = ownAppsSnap.docs.some((d) => checkAppReadiness(d.data()).ready);
    if (!hasEligibleOwnApp) blockers.push("noEligibleOwnApp");
    if (!membershipSnap.exists) blockers.push("groupNotJoined");

    const commitmentAmount = DEFAULT_COMMITMENT_AMOUNT;
    if (wallet.available < commitmentAmount) blockers.push("insufficientCoins");
    const taken = app && Number.isInteger(app.testerCount) ? app.testerCount : 0;
    if (app && taken >= REQUIRED_TESTER_COUNT) blockers.push("capacityFull");

    return {
      appId,
      canJoin: blockers.length === 0,
      blockers,
      targetGaps: app ? target.gaps : [],
      hasEligibleOwnApp,
      groupId,
      groupEmail: await readGroupEmail(db, groupId),
      groupJoinedSelfConfirmed: membershipSnap.exists,
      commitmentAmount,
      availableCoins: wallet.available,
      slotsLeft: app ? Math.max(0, REQUIRED_TESTER_COUNT - taken) : 0,
      capacity: REQUIRED_TESTER_COUNT,
    };
  }, { readOnly: true });
}

async function getJoinEligibilityImpl(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");
  return runJoinEligibility(db, { callerId: uid, appId });
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

/** Input `{ appId, closedTestConfigured: true, googleGroupAdded: true }`. Owner only. */
const confirmAppTestingSetup = onCall({ region: REGION }, (request) =>
  confirmAppTestingSetupImpl(getFirestore(), request),
);

/** Input `{ appId }`. Owner or admin. */
const getAppTestingReadiness = onCall({ region: REGION }, (request) =>
  getAppTestingReadinessImpl(getFirestore(), request),
);

/** Input `{ appId }`. The caller's own join checklist; advisory, writes nothing. */
const getJoinEligibility = onCall({ region: REGION }, (request) =>
  getJoinEligibilityImpl(getFirestore(), request),
);

module.exports = {
  confirmAppTestingSetup,
  getAppTestingReadiness,
  getJoinEligibility,
  // Exported for tests - no Functions runtime required.
  confirmAppTestingSetupImpl,
  getAppTestingReadinessImpl,
  getJoinEligibilityImpl,
  runConfirmSetup,
  runAppReadiness,
  runJoinEligibility,
};

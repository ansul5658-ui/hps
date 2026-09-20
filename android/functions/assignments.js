/**
 * Testing assignment creation + progress bookkeeping.
 *
 * `testingAssignments` documents are created here and nowhere else: security
 * rules deny `create` to every client, so the only way one comes into
 * existence is through this module running with Admin SDK credentials.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  OFFICIAL_GROUP_ID,
  REQUIRED_TESTER_COUNT,
  DEFAULT_DAYS_REQUIRED,
  DEFAULT_COMMITMENT_AMOUNT,
} = require("./lib/constants");
const { selectTesters, assignmentIdFor } = require("./lib/matching");
const { clampRequestedCount } = require("./lib/validation");
const {
  requireAuth,
  requireDocId,
  requireNotSuspended,
  loadUser,
} = require("./lib/guards");

/** Upper bound on how many group members we will consider in one pass. */
const CANDIDATE_SCAN_LIMIT = 500;

/** Firestore `getAll` is chunked to keep a single call bounded. */
const GET_ALL_CHUNK = 100;

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function millisOf(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  return 0;
}

/**
 * Core matching routine, shared by the callable and by app approval.
 *
 * Returns a summary rather than throwing when there is simply nothing to do,
 * so that approving an app never fails just because no testers are available.
 *
 * @returns {Promise<{appId: string, created: number, totalTesters: number,
 *                    slotsRemaining: number, skipped: Array}>}
 */
async function runMatching(db, { appId, requestedCount, groupIdOverride }) {
  const appRef = db.doc(`apps/${appId}`);
  const appSnap = await appRef.get();
  if (!appSnap.exists) {
    throw new HttpsError("not-found", "That app no longer exists.");
  }
  const app = appSnap.data();
  if (app.status !== "approved") {
    throw new HttpsError(
      "failed-precondition",
      "Only an approved app can receive testers.",
    );
  }

  const ownerId = app.ownerId;
  if (!ownerId) {
    throw new HttpsError("failed-precondition", "That app has no owner recorded.");
  }

  // Existing assignments decide both the remaining slots and who to skip.
  const existingSnap = await db
    .collection("testingAssignments")
    .where("appId", "==", appId)
    .get();
  const alreadyAssignedTesterIds = existingSnap.docs
    .map((doc) => doc.get("testerId"))
    .filter(Boolean);

  const slotsRemaining = Math.max(
    0,
    REQUIRED_TESTER_COUNT - alreadyAssignedTesterIds.length,
  );
  const maxThisRun = clampRequestedCount(requestedCount, REQUIRED_TESTER_COUNT);

  if (slotsRemaining === 0 || maxThisRun === 0) {
    return {
      appId,
      created: 0,
      totalTesters: alreadyAssignedTesterIds.length,
      slotsRemaining,
      skipped: [],
    };
  }

  // Candidate pool = members of the app's testing group. The group member
  // mirror under groups/{id}/members is maintained by syncGroupMemberCount.
  const groupId = groupIdOverride || app.activeGroupId || OFFICIAL_GROUP_ID;
  const memberSnap = await db
    .collection(`groups/${groupId}/members`)
    .orderBy("joinedAt", "asc")
    .limit(CANDIDATE_SCAN_LIMIT)
    .get();

  const memberIds = memberSnap.docs.map((doc) => doc.id);
  const joinedAtByUid = new Map(
    memberSnap.docs.map((doc) => [doc.id, millisOf(doc.get("joinedAt"))]),
  );

  // Suspension is read from the authoritative user documents, never inferred
  // from the membership mirror.
  const candidates = [];
  for (const ids of chunk(memberIds, GET_ALL_CHUNK)) {
    const refs = ids.map((uid) => db.doc(`users/${uid}`));
    const snaps = await db.getAll(...refs);
    for (const snap of snaps) {
      candidates.push({
        uid: snap.id,
        joinedAtMillis: joinedAtByUid.get(snap.id) || 0,
        isSuspended: snap.exists ? snap.get("isSuspended") === true : false,
        exists: snap.exists,
      });
    }
  }

  const { selected, skipped } = selectTesters({
    candidates,
    ownerId,
    alreadyAssignedTesterIds,
    remainingSlots: slotsRemaining,
    maxThisRun,
  });

  if (selected.length === 0) {
    return {
      appId,
      created: 0,
      totalTesters: alreadyAssignedTesterIds.length,
      slotsRemaining,
      skipped,
    };
  }

  // Deterministic ids + `create` mean a concurrent duplicate run fails loudly
  // instead of double-assigning a tester.
  const batch = db.batch();
  for (const testerId of selected) {
    const ref = db.doc(`testingAssignments/${assignmentIdFor(appId, testerId)}`);
    batch.create(ref, {
      appId,
      testerId,
      developerId: ownerId,
      groupId,
      daysRequired: DEFAULT_DAYS_REQUIRED,
      daysCompleted: 0,
      // Coins the tester STAKES on this assignment, snapshotted at creation.
      // This is not a payout: completing returns the same coins, failing
      // forfeits them. Replaces the reward-era `coinReward` field, which
      // existing assignment documents may still carry - nothing reads it any
      // more, and it is deliberately left in place rather than migrated.
      commitmentAmount: DEFAULT_COMMITMENT_AMOUNT,
      status: "ready",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }
  batch.update(appRef, {
    testerCount: alreadyAssignedTesterIds.length + selected.length,
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err) {
    if (err && err.code === 6) {
      // ALREADY_EXISTS — another run won the race. Safe to report as a no-op.
      logger.warn(`Assignment batch for ${appId} raced with another run`, err);
      return {
        appId,
        created: 0,
        totalTesters: alreadyAssignedTesterIds.length,
        slotsRemaining,
        skipped,
      };
    }
    throw err;
  }

  logger.info(`Created ${selected.length} assignment(s) for app ${appId}`);
  return {
    appId,
    created: selected.length,
    totalTesters: alreadyAssignedTesterIds.length + selected.length,
    slotsRemaining: slotsRemaining - selected.length,
    skipped,
  };
}

/**
 * Callable: create testing assignments for an approved app.
 *
 * Authorized callers: the app's owner (a developer asking for testers) or an
 * admin. Everyone else is rejected — and no client can write the collection
 * directly, so this is the only door.
 */
const createTestingAssignments = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const uid = requireAuth(request);
  await requireNotSuspended(db, uid);

  const appId = requireDocId(request.data && request.data.appId, "appId");
  const requestedCount = request.data ? request.data.count : undefined;

  const appSnap = await db.doc(`apps/${appId}`).get();
  if (!appSnap.exists) {
    throw new HttpsError("not-found", "That app no longer exists.");
  }

  const isOwner = appSnap.get("ownerId") === uid;
  if (!isOwner) {
    const caller = await loadUser(db, uid);
    const isAdmin = caller.exists && caller.data.role === "admin";
    if (!isAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Only the app owner or an admin can request testers.",
      );
    }
  }

  return runMatching(db, { appId, requestedCount });
});

/**
 * Trigger: keep `testingAssignments.daysCompleted` server-authoritative.
 *
 * The count is recomputed from the `testingLogs` collection rather than
 * incremented, so it cannot drift and cannot be nudged by a client write.
 * A `ready` assignment moves to `inProgress` on its first log.
 *
 * Completion verification and any coin/trust-score effect are deliberately NOT
 * handled here — that is a later batch.
 */
const syncAssignmentProgress = onDocumentCreated(
  { region: REGION, document: "testingLogs/{logId}" },
  async (event) => {
    const db = getFirestore();
    const snap = event.data;
    if (!snap) return;

    const assignmentId = snap.get("assignmentId");
    if (!assignmentId) return;

    const countSnap = await db
      .collection("testingLogs")
      .where("assignmentId", "==", assignmentId)
      .count()
      .get();
    const daysCompleted = countSnap.data().count;

    const ref = db.doc(`testingAssignments/${assignmentId}`);
    try {
      await db.runTransaction(async (tx) => {
        const assignment = await tx.get(ref);
        if (!assignment.exists) {
          logger.warn(`Log references missing assignment ${assignmentId}`);
          return;
        }
        const update = {
          daysCompleted,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (assignment.get("status") === "ready") {
          update.status = "inProgress";
        }
        tx.update(ref, update);
      });
    } catch (err) {
      logger.error(`Failed to sync progress for ${assignmentId}`, err);
    }
  },
);

module.exports = { createTestingAssignments, syncAssignmentProgress, runMatching };

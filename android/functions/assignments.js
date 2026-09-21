/**
 * Tester eligibility preview + assignment progress bookkeeping.
 *
 * WHAT THIS MODULE NO LONGER DOES
 * It used to CREATE testing assignments: an admin approved an app and the
 * server pushed assignments onto matched testers. Under the commitment product
 * that is unsafe, because such an assignment is a live tester obligation with
 * no coins staked behind it - the tester never agreed to it and never funded
 * it, yet it would look identical to a real commitment.
 *
 * There is now exactly ONE way a tester commitment comes into existence:
 * `joinTestingAssignment` in `commitments.js`, which validates eligibility,
 * verifies the balance, locks the coins, creates the cycle assignment and the
 * active claim, and commits all of it in one transaction. Nothing in this file
 * writes `testingAssignments` any more, and nothing here may start doing so
 * again - a creation path that bypassed the coin lock would reintroduce
 * exactly the inconsistency the commitment model exists to prevent.
 *
 * What survives is the part that was always useful: working out WHO is
 * eligible. `previewEligibleTesters` answers that question for the admin
 * console and for the app-approval log, and writes nothing at all.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  OFFICIAL_GROUP_ID,
  REQUIRED_TESTER_COUNT,
} = require("./lib/constants");
const { selectTesters } = require("./lib/matching");
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
 * Work out which testers are ELIGIBLE to claim this app. Writes nothing.
 *
 * This is what is left of the old push-matching routine. It performs exactly
 * the same reads and runs exactly the same eligibility predicates
 * (`selectTesters`), but it no longer creates anything: the returned list is
 * advisory. A tester becomes a tester by claiming and staking coins, not by
 * appearing here.
 *
 * `slotsRemaining` is still computed, because the tester cap it expresses is
 * real - `commitments.js` enforces it at claim time, where the app document is
 * read inside the transaction and so cannot be raced.
 *
 * Returns a summary rather than throwing when there is nothing to report, so
 * approving an app never fails just because no testers are available.
 *
 * @returns {Promise<{appId: string, eligible: Array<string>, eligibleCount: number,
 *                    totalTesters: number, slotsRemaining: number, skipped: Array}>}
 */
async function runEligibilityPreview(db, { appId, requestedCount, groupIdOverride }) {
  const appRef = db.doc(`apps/${appId}`);
  const appSnap = await appRef.get();
  if (!appSnap.exists) {
    throw new HttpsError("not-found", "That app no longer exists.");
  }
  const app = appSnap.data();
  if (app.status !== "approved") {
    throw new HttpsError(
      "failed-precondition",
      "Only an approved app can be tested.",
    );
  }

  const ownerId = app.ownerId;
  if (!ownerId) {
    throw new HttpsError("failed-precondition", "That app has no owner recorded.");
  }

  // Existing assignments decide both the remaining slots and who to skip. A
  // tester who already holds a commitment for this app is not eligible for a
  // second one, which is the same rule `checkClaimEligible` enforces.
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
      eligible: [],
      eligibleCount: 0,
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

  logger.info(
    `app ${appId}: ${selected.length} tester(s) eligible to claim, ` +
      `${slotsRemaining} slot(s) remaining`,
  );

  return {
    appId,
    eligible: selected,
    eligibleCount: selected.length,
    totalTesters: alreadyAssignedTesterIds.length,
    slotsRemaining,
    skipped,
  };
}

/**
 * Callable: report which testers are eligible to claim an approved app.
 *
 * READ-ONLY. This replaces the old `createTestingAssignments`, which pushed
 * assignments onto testers. It cannot create an assignment, and it must not be
 * given the ability to: a tester's obligation begins when they stake coins on
 * it, which only `joinTestingAssignment` can do.
 *
 * Authorized callers: the app's owner (a developer checking reach) or an
 * admin. Kept restricted even though it writes nothing, because the eligible
 * list is other users' identities.
 */
const previewEligibleTesters = onCall({ region: REGION }, async (request) => {
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
        "Only the app owner or an admin can see eligible testers.",
      );
    }
  }

  return runEligibilityPreview(db, { appId, requestedCount });
});

// `syncAssignmentProgress` lived here: an onDocumentCreated trigger on
// `testingLogs` that recomputed `daysCompleted` from a count. It was removed
// with the arrival of the testing engine. `recordTestingDay` is now the only
// creator of a testing log and it maintains `qualifyingDays` inside the same
// transaction, so the trigger would have been a second writer racing the
// first — and on the transaction that also returns 50 coins, that is not a
// race worth having. One authority, or the field is not authoritative.

module.exports = { previewEligibleTesters, runEligibilityPreview };

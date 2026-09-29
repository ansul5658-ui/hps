/**
 * Group membership.
 *
 * Source of truth for "am I in this group" stays at
 * `users/{uid}/memberships/{groupId}` — the client reads it directly with a
 * real-time listener. Writing it is server-only so that member cap,
 * suspension and duplicate checks cannot be bypassed by a direct Firestore
 * write from a modified client. Leaving stays a client self-delete of it.
 *
 * SEATS (Groups Phase 2). `groups/{groupId}/members/{uid}` is the member's
 * SEAT: the server-maintained mirror of the membership, used to enumerate
 * members cheaply (tester matching) and, with `groups/{groupId}.memberCount`,
 * to enforce the cap. The invariant, held by construction:
 *
 *     memberCount == number of seat documents
 *
 * because a seat is only ever created or deleted in the SAME transaction that
 * moves memberCount by exactly one, and every such transaction reads the
 * group document first. Firestore therefore serializes every seat change on
 * that one document, so `memberCount < memberCap` read in a join transaction
 * is authoritative: concurrent joins can never all see the same free seat.
 *
 * A seat is STALE when its membership is gone - the member left and the leave
 * trigger has not run (or never will). The membership is the source of truth,
 * so a stale seat never blocks anyone: a join that finds the group full
 * revalidates the seat holders and frees the stale seats, in its own
 * transaction, before deciding. No membership is ever deleted by the server.
 *
 * HONOR-SYSTEM LIMITATION (unchanged, documented deliberately): joining here
 * records that a user *claims* to have joined the external Google Group.
 * Nothing verifies it against the Google Groups API. Treat membership as
 * self-attested until that verification lands in a later batch.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  OFFICIAL_GROUP_ID,
  OFFICIAL_GROUP_NAME,
  OFFICIAL_GROUP_EMAIL,
} = require("./lib/constants");
const { requireAuth, requireDocId } = require("./lib/guards");
const { requireTermsAccepted } = require("./lib/terms");
const { evaluateJoin } = require("./lib/joinRules");

const ALREADY_EXISTS = 6;

/**
 * How many seat holders a full group's join revalidates when looking for
 * stale seats. A stale seat beyond this is not found by that join, which then
 * refuses as full - never admits over the cap - and the leave trigger still
 * frees it. Well above any cap in use.
 */
const STALE_SEAT_SCAN_LIMIT = 100;

const groupPath = (groupId) => `groups/${groupId}`;
const seatPath = (groupId, uid) => `groups/${groupId}/members/${uid}`;
const membershipPath = (uid, groupId) => `users/${uid}/memberships/${groupId}`;

/** memberCap from a group snapshot; 0 means "no cap". */
function capOf(groupSnap) {
  return groupSnap.exists ? Number(groupSnap.get("memberCap") || 0) : 0;
}

/** memberCount from a group snapshot; anything but a non-negative integer reads as 0. */
function countOf(groupSnap) {
  const n = groupSnap.exists ? groupSnap.get("memberCount") : 0;
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * The official group is the one the onboarding flow always points at. If it
 * has not been seeded yet we provision it with safe defaults rather than
 * failing onboarding — memberCap 0 means "no cap" (per-app tester limits are
 * enforced separately during matching).
 */
async function ensureOfficialGroup(db) {
  const ref = db.doc(groupPath(OFFICIAL_GROUP_ID));
  const snap = await ref.get();
  if (snap.exists) return snap;

  await ref.set(
    {
      name: OFFICIAL_GROUP_NAME,
      googleGroupEmail: OFFICIAL_GROUP_EMAIL,
      summary: "Official community testing group for all Android apps.",
      rules: "Participate in community app testing and provide constructive feedback.",
      status: "open",
      visibility: "open",
      memberCap: 0,
      memberCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: "system",
    },
    { merge: true },
  );
  logger.info(`Provisioned official group ${OFFICIAL_GROUP_ID}`);
  return ref.get();
}

/**
 * Seat holders of a group that LOOKS full, located by a plain query OUTSIDE
 * the join transaction. The query only finds ids: every one is point-read and
 * revalidated inside the transaction, so a stale or since-changed result can
 * never free a seat that is really held.
 */
async function locateSeatHolders(db, groupId, excludeUid) {
  const snap = await db
    .collection(`${groupPath(groupId)}/members`)
    .select()
    .limit(STALE_SEAT_SCAN_LIMIT)
    .get();
  return snap.docs.map((doc) => doc.id).filter((id) => id !== excludeUid);
}

/**
 * Join `groupId` as `uid`. Every decision and every write happens in one
 * transaction over point reads: the group (seat count and cap), the caller's
 * profile (suspension, Terms), their membership and their own seat.
 */
async function runJoinGroup(db, { uid, groupId }) {
  const groupRef = db.doc(groupPath(groupId));

  let preGroup = await groupRef.get();
  if (!preGroup.exists && groupId === OFFICIAL_GROUP_ID) {
    preGroup = await ensureOfficialGroup(db);
  }
  const preCap = capOf(preGroup);
  const candidates =
    preCap > 0 && countOf(preGroup) >= preCap ? await locateSeatHolders(db, groupId, uid) : [];

  const userRef = db.doc(`users/${uid}`);
  const membershipRef = db.doc(membershipPath(uid, groupId));
  const ownSeatRef = db.doc(seatPath(groupId, uid));

  try {
    return await db.runTransaction(async (tx) => {
      const [groupSnap, userSnap, membershipSnap, ownSeatSnap] = await tx.getAll(
        groupRef,
        userRef,
        membershipRef,
        ownSeatRef,
      );
      const memberCap = capOf(groupSnap);
      let seated = countOf(groupSnap);

      // A member who left and rejoins before the leave trigger ran still holds
      // their own seat: rejoining takes no new capacity.
      const keepsOwnSeat = ownSeatSnap.exists && !membershipSnap.exists;

      const decide = () =>
        evaluateJoin({
          groupExists: groupSnap.exists,
          groupStatus: groupSnap.exists ? groupSnap.get("status") : null,
          groupVisibility: groupSnap.exists ? groupSnap.get("visibility") : null,
          memberCap,
          memberCount: keepsOwnSeat ? seated - 1 : seated,
          alreadyMember: membershipSnap.exists,
          isSuspended: userSnap.exists && userSnap.get("isSuspended") === true,
        });

      let decision = decide();

      // Full: free any seat whose membership is gone, then decide again.
      const staleSeatRefs = [];
      if (decision.outcome === "full" && candidates.length > 0) {
        const pairs = candidates.map((id) => [db.doc(seatPath(groupId, id)), db.doc(membershipPath(id, groupId))]);
        const snaps = await tx.getAll(...pairs.flat());
        for (let i = 0; i < pairs.length; i += 1) {
          const seatSnap = snaps[2 * i];
          const holderMembership = snaps[2 * i + 1];
          if (seatSnap.exists && !holderMembership.exists) staleSeatRefs.push(pairs[i][0]);
        }
        seated -= staleSeatRefs.length;
        decision = decide();
      }

      if (!decision.allowed) {
        if (decision.outcome === "alreadyMember") {
          return { groupId, joined: false, alreadyMember: true };
        }
        // Refusals write nothing, stale-seat repairs included.
        throw new HttpsError(decision.code, decision.message);
      }
      // Joining is a self-confirmation made under the Terms. Checked after the
      // decision so its answers (suspended, closed, full, already a member)
      // are unchanged.
      requireTermsAccepted(userSnap.exists ? userSnap.data() : null);

      for (const ref of staleSeatRefs) tx.delete(ref);
      const joinedAt = FieldValue.serverTimestamp();
      tx.create(membershipRef, { groupId, userId: uid, joinedAt });
      tx.set(ownSeatRef, { userId: uid, groupId, joinedAt });
      tx.update(groupRef, { memberCount: keepsOwnSeat ? seated : seated + 1 });

      if (staleSeatRefs.length > 0) {
        logger.warn(`group ${groupId}: freed ${staleSeatRefs.length} stale seat(s) whose membership was gone`);
      }
      return { groupId, joined: true, alreadyMember: false };
    });
  } catch (err) {
    if (err && err.code === ALREADY_EXISTS) {
      // A concurrent join by the same user committed first; still the desired end state.
      return { groupId, joined: false, alreadyMember: true };
    }
    throw err;
  }
}

async function joinGroupImpl(db, request) {
  const uid = requireAuth(request);
  const groupId = requireDocId(request.data && request.data.groupId, "groupId");
  const outcome = await runJoinGroup(db, { uid, groupId });
  if (outcome.joined) logger.info(`user ${uid} joined group ${groupId}`);
  return outcome;
}

/**
 * Callable: join a testing group.
 *
 * Enforces, server-side: authentication, not-suspended, group exists, group is
 * in a joinable state, group is not private, member cap (atomically), Terms
 * acceptance, and no duplicate membership. Idempotent — calling it again for a
 * group you are already in succeeds without writing.
 */
exports.joinGroup = onCall({ region: REGION }, (request) => joinGroupImpl(getFirestore(), request));

/**
 * Bring `userId`'s seat in `groupId` into line with their membership, in one
 * transaction over point reads: a membership without a seat gets one (and one
 * count), a seat without a membership is freed (and one count released).
 * Anything else is already consistent and nothing is written - so a
 * redelivered, late or duplicate event can never count anyone twice.
 */
async function runSyncMembership(db, { userId, groupId }) {
  const groupRef = db.doc(groupPath(groupId));
  const membershipRef = db.doc(membershipPath(userId, groupId));
  const seatRef = db.doc(seatPath(groupId, userId));

  return db.runTransaction(async (tx) => {
    const [groupSnap, membershipSnap, seatSnap] = await tx.getAll(groupRef, membershipRef, seatRef);

    if (membershipSnap.exists && !seatSnap.exists) {
      // A membership the join did not seat (written before Groups Phase 2).
      tx.set(seatRef, {
        userId,
        groupId,
        joinedAt: membershipSnap.get("joinedAt") || FieldValue.serverTimestamp(),
      });
      if (groupSnap.exists) tx.update(groupRef, { memberCount: countOf(groupSnap) + 1 });
      return "seated";
    }
    if (!membershipSnap.exists && seatSnap.exists) {
      tx.delete(seatRef);
      if (groupSnap.exists) tx.update(groupRef, { memberCount: Math.max(0, countOf(groupSnap) - 1) });
      return "freed";
    }
    return "unchanged";
  });
}

/**
 * Trigger: keep seats and `groups/{groupId}.memberCount` in line with
 * memberships - in practice, free the seat of a member who left. It re-reads
 * the current state rather than trusting the event, so ordering and
 * redelivery do not matter.
 */
exports.syncGroupMemberCount = onDocumentWritten(
  { region: REGION, document: "users/{userId}/memberships/{groupId}" },
  async (event) => {
    const { userId, groupId } = event.params;
    try {
      const outcome = await runSyncMembership(getFirestore(), { userId, groupId });
      logger.log(`Group ${groupId} seat for ${userId}: ${outcome}`);
    } catch (err) {
      logger.error(`Failed to sync membership for group ${groupId}`, err);
    }
  },
);

exports.ensureOfficialGroup = ensureOfficialGroup;
exports.runJoinGroup = runJoinGroup;
exports.joinGroupImpl = joinGroupImpl;
exports.runSyncMembership = runSyncMembership;
exports.STALE_SEAT_SCAN_LIMIT = STALE_SEAT_SCAN_LIMIT;

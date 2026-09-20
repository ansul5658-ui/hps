/**
 * Group membership.
 *
 * Source of truth for "am I in this group" stays at
 * `users/{uid}/memberships/{groupId}` — the client reads it directly with a
 * real-time listener. Writing it is now server-only so that member cap,
 * suspension and duplicate checks cannot be bypassed by a direct Firestore
 * write from a modified client.
 *
 * `groups/{groupId}/members/{uid}` is a server-maintained mirror of the same
 * fact. It exists so that group membership can be enumerated cheaply (tester
 * matching needs exactly that) without a collection-group index.
 *
 * HONOR-SYSTEM LIMITATION (unchanged in this batch, documented deliberately):
 * joining here records that a user *claims* to have joined the external Google
 * Group. Nothing verifies it against the Google Groups API. Treat membership
 * as self-attested until that verification lands in a later batch.
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
const { requireAuth, requireDocId, loadUser } = require("./lib/guards");
const { evaluateJoin } = require("./lib/joinRules");

/**
 * The official group is the one the onboarding flow always points at. If it
 * has not been seeded yet we provision it with safe defaults rather than
 * failing onboarding — memberCap 0 means "no cap" (per-app tester limits are
 * enforced separately during matching).
 */
async function ensureOfficialGroup(db) {
  const ref = db.doc(`groups/${OFFICIAL_GROUP_ID}`);
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
 * Callable: join a testing group.
 *
 * Enforces, server-side: authentication, not-suspended, group exists, group is
 * in a joinable state, group is not private, member cap, and no duplicate
 * membership. Idempotent — calling it again for a group you are already in
 * succeeds without writing.
 */
exports.joinGroup = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const uid = requireAuth(request);
  const groupId = requireDocId(request.data && request.data.groupId, "groupId");

  const caller = await loadUser(db, uid);

  let groupSnap = await db.doc(`groups/${groupId}`).get();
  if (!groupSnap.exists && groupId === OFFICIAL_GROUP_ID) {
    groupSnap = await ensureOfficialGroup(db);
  }

  const membershipRef = db.doc(`users/${uid}/memberships/${groupId}`);
  const existing = await membershipRef.get();

  // Member count comes from the mirror, which syncGroupMemberCount maintains.
  // A burst of simultaneous joins could overshoot a cap by a small margin
  // before the mirror catches up; a hard guarantee would need a counter shard
  // or a queue. Acceptable at current scale, and documented as such.
  let memberCount = 0;
  const memberCap = groupSnap.exists ? Number(groupSnap.get("memberCap") || 0) : 0;
  if (memberCap > 0) {
    const countSnap = await db.collection(`groups/${groupId}/members`).count().get();
    memberCount = countSnap.data().count;
  }

  const decision = evaluateJoin({
    groupExists: groupSnap.exists,
    groupStatus: groupSnap.exists ? groupSnap.get("status") : null,
    groupVisibility: groupSnap.exists ? groupSnap.get("visibility") : null,
    memberCap,
    memberCount,
    alreadyMember: existing.exists,
    isSuspended: caller.exists && caller.data.isSuspended === true,
  });

  if (!decision.allowed) {
    if (decision.outcome === "alreadyMember") {
      return { groupId, joined: false, alreadyMember: true };
    }
    throw new HttpsError(decision.code, decision.message);
  }

  try {
    await membershipRef.create({
      groupId,
      userId: uid,
      joinedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    if (err && err.code === 6) {
      // ALREADY_EXISTS — a concurrent join won; still the desired end state.
      return { groupId, joined: false, alreadyMember: true };
    }
    throw err;
  }

  logger.info(`user ${uid} joined group ${groupId}`);
  return { groupId, joined: true, alreadyMember: false };
});

/**
 * Trigger: keep the member mirror and `groups/{groupId}.memberCount` in sync.
 *
 * memberCount is recomputed from the mirror rather than incremented, so it
 * cannot drift out of step with reality after a retry or a partial failure.
 */
exports.syncGroupMemberCount = onDocumentWritten(
  { region: REGION, document: "users/{userId}/memberships/{groupId}" },
  async (event) => {
    const db = getFirestore();
    const { userId, groupId } = event.params;
    const beforeExists = event.data ? event.data.before.exists : false;
    const afterExists = event.data ? event.data.after.exists : false;

    const groupRef = db.doc(`groups/${groupId}`);
    const mirrorRef = db.doc(`groups/${groupId}/members/${userId}`);

    try {
      if (afterExists) {
        await mirrorRef.set(
          {
            userId,
            groupId,
            joinedAt: event.data.after.get("joinedAt") || FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
      } else if (beforeExists) {
        await mirrorRef.delete();
      }

      const groupSnap = await groupRef.get();
      if (!groupSnap.exists) {
        logger.log(`Group ${groupId} does not exist, skipping memberCount sync.`);
        return;
      }

      const countSnap = await db.collection(`groups/${groupId}/members`).count().get();
      await groupRef.update({ memberCount: countSnap.data().count });
      logger.log(`Group ${groupId} memberCount synced to ${countSnap.data().count}`);
    } catch (err) {
      logger.error(`Failed to sync membership for group ${groupId}`, err);
    }
  },
);

exports.ensureOfficialGroup = ensureOfficialGroup;

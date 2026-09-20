/**
 * Privileged admin operations.
 *
 * These exist because security rules deliberately refuse the corresponding
 * client writes: no client — admin or not — can change `apps.status`,
 * `users.isSuspended`, or anything under `groups/`. Admin authority lives on
 * the server, and every function below re-verifies it against Firestore.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const { REGION, JOINABLE_GROUP_STATES } = require("./lib/constants");
const { checkAppTransition } = require("./lib/validation");
const {
  requireAuth,
  requireAdmin,
  requireDocId,
  requireBoolean,
  optionalString,
} = require("./lib/guards");
const { runMatching } = require("./assignments");

/**
 * Callable: approve / reject / archive an app.
 *
 * Only `status`, `updatedAt` and the review audit fields are written. Identity
 * fields (ownerId, packageName, appName, …) are never touched, so a status
 * change cannot be used to smuggle in an app rewrite.
 *
 * Approving also kicks off tester matching. That is best-effort: a matching
 * failure is logged and reported, but never rolls back the approval.
 */
exports.adminSetAppStatus = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const uid = requireAuth(request);
  await requireAdmin(db, uid);

  const appId = requireDocId(request.data && request.data.appId, "appId");
  const status = request.data && request.data.status;
  if (typeof status !== "string") {
    throw new HttpsError("invalid-argument", '"status" must be a string.');
  }

  const ref = db.doc(`apps/${appId}`);
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "That app no longer exists.");
    }
    const from = snap.get("status") || "pendingReview";
    const check = checkAppTransition(from, status);
    if (!check.ok) {
      throw new HttpsError("failed-precondition", check.reason);
    }
    if (check.noop) {
      return { changed: false, from, to: status };
    }
    tx.update(ref, {
      status,
      updatedAt: FieldValue.serverTimestamp(),
      reviewedBy: uid,
      reviewedAt: FieldValue.serverTimestamp(),
    });
    return { changed: true, from, to: status };
  });

  logger.info(
    `admin ${uid} set app ${appId} ${outcome.from} -> ${outcome.to} (changed=${outcome.changed})`,
  );

  let matching = null;
  if (status === "approved") {
    try {
      matching = await runMatching(db, { appId });
    } catch (err) {
      logger.error(`Matching after approval of ${appId} failed`, err);
      matching = { created: 0, error: err.message || "Matching failed." };
    }
  }

  return { appId, status, changed: outcome.changed, matching };
});

/**
 * Callable: suspend / unsuspend a user.
 *
 * Writes exactly two fields. A user can never flip their own flag: rules block
 * the client write, and this function refuses self-targeting outright.
 */
exports.adminSetUserSuspended = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const uid = requireAuth(request);
  await requireAdmin(db, uid);

  const userId = requireDocId(request.data && request.data.userId, "userId");
  const isSuspended = requireBoolean(
    request.data && request.data.isSuspended,
    "isSuspended",
  );

  if (userId === uid) {
    throw new HttpsError(
      "failed-precondition",
      "You cannot change your own suspension state.",
    );
  }

  const ref = db.doc(`users/${userId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new HttpsError("not-found", "That user no longer exists.");
    }
    if (snap.get("role") === "admin") {
      throw new HttpsError(
        "failed-precondition",
        "Admin accounts cannot be suspended from the console.",
      );
    }
    tx.update(ref, {
      isSuspended,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  logger.info(`admin ${uid} set user ${userId} isSuspended=${isSuspended}`);
  return { userId, isSuspended };
});

/**
 * Callable: create or update a testing group.
 *
 * Groups are server-only (rules: `allow write: if false`), so this is how the
 * official group gets seeded and edited without console access. `memberCount`
 * is never accepted from the caller — it is owned by syncGroupMemberCount.
 */
exports.adminUpsertGroup = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const uid = requireAuth(request);
  await requireAdmin(db, uid);

  const data = request.data || {};
  const groupId = requireDocId(data.groupId, "groupId");

  const name = optionalString(data.name, "name", 120);
  const googleGroupEmail = optionalString(data.googleGroupEmail, "googleGroupEmail", 200);
  const summary = optionalString(data.summary, "summary", 1000);
  const rules = optionalString(data.rules, "rules", 4000);
  const visibility = optionalString(data.visibility, "visibility", 40);
  const status = optionalString(data.status, "status", 40);

  if (visibility && !["open", "inviteOnly", "private"].includes(visibility)) {
    throw new HttpsError("invalid-argument", `Unknown visibility "${visibility}".`);
  }
  const knownStates = JOINABLE_GROUP_STATES.concat([
    "full",
    "completed",
    "archived",
    "cancelled",
  ]);
  if (status && !knownStates.includes(status)) {
    throw new HttpsError("invalid-argument", `Unknown group status "${status}".`);
  }

  let memberCap;
  if (data.memberCap !== undefined && data.memberCap !== null) {
    const cap = Number(data.memberCap);
    if (!Number.isFinite(cap) || cap < 0 || Math.floor(cap) !== cap) {
      throw new HttpsError("invalid-argument", '"memberCap" must be a non-negative integer.');
    }
    memberCap = cap;
  }

  const ref = db.doc(`groups/${groupId}`);
  const created = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const payload = { updatedAt: FieldValue.serverTimestamp() };
    if (name !== undefined) payload.name = name;
    if (googleGroupEmail !== undefined) payload.googleGroupEmail = googleGroupEmail;
    if (summary !== undefined) payload.summary = summary;
    if (rules !== undefined) payload.rules = rules;
    if (visibility !== undefined) payload.visibility = visibility;
    if (status !== undefined) payload.status = status;
    if (memberCap !== undefined) payload.memberCap = memberCap;

    if (!snap.exists) {
      payload.createdAt = FieldValue.serverTimestamp();
      payload.createdBy = uid;
      payload.memberCount = 0;
      if (payload.status === undefined) payload.status = "open";
      tx.set(ref, payload);
      return true;
    }
    tx.update(ref, payload);
    return false;
  });

  logger.info(`admin ${uid} ${created ? "created" : "updated"} group ${groupId}`);
  return { groupId, created };
});

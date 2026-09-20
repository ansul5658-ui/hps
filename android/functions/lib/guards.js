/**
 * Authentication / authorization guards for callable functions.
 *
 * Every privileged callable re-verifies the caller here. Nothing trusts a
 * client-supplied role, uid, or suspension flag: the uid comes from the
 * verified Firebase ID token (`request.auth`), and role/suspension are read
 * fresh from Firestore on each call.
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { isValidDocId } = require("./validation");

/** @returns {string} the verified caller uid */
function requireAuth(request) {
  const uid = request && request.auth && request.auth.uid;
  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  return uid;
}

/** Validate a caller-supplied document id and return it. */
function requireDocId(value, field) {
  if (!isValidDocId(value)) {
    throw new HttpsError("invalid-argument", `"${field}" is missing or invalid.`);
  }
  return value;
}

function requireBoolean(value, field) {
  if (typeof value !== "boolean") {
    throw new HttpsError("invalid-argument", `"${field}" must be true or false.`);
  }
  return value;
}

/** Optional trimmed string with a length ceiling. Returns undefined when absent. */
function optionalString(value, field, maxLength = 500) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `"${field}" must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpsError("invalid-argument", `"${field}" is too long.`);
  }
  return trimmed;
}

async function loadUser(db, uid) {
  const snap = await db.doc(`users/${uid}`).get();
  return { ref: snap.ref, exists: snap.exists, data: snap.exists ? snap.data() : null };
}

/**
 * The caller must be an admin. Admin state lives only in Firestore
 * (`users/{uid}.role`), which security rules make unwritable by any client,
 * so it cannot be self-granted from the app.
 */
async function requireAdmin(db, uid) {
  const user = await loadUser(db, uid);
  if (!user.exists || user.data.role !== "admin") {
    throw new HttpsError("permission-denied", "Admin privileges are required.");
  }
  if (user.data.isSuspended === true) {
    throw new HttpsError("permission-denied", "This admin account is suspended.");
  }
  return user;
}

/** The caller must not be suspended. A missing profile is treated as active. */
async function requireNotSuspended(db, uid) {
  const user = await loadUser(db, uid);
  if (user.exists && user.data.isSuspended === true) {
    throw new HttpsError(
      "permission-denied",
      "Your account is suspended. Contact support if you think this is a mistake.",
    );
  }
  return user;
}

module.exports = {
  requireAuth,
  requireDocId,
  requireBoolean,
  optionalString,
  loadUser,
  requireAdmin,
  requireNotSuspended,
};

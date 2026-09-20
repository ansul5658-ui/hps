/**
 * Pure input validation and state-transition rules.
 *
 * Everything in this module is side-effect free so it can be unit tested
 * without Firestore, the emulator, or network access.
 */

const { APP_STATUSES } = require("./constants");

/**
 * Firestore document id constraints we care about for user-supplied ids.
 * Rejecting these up front keeps a caller from steering a `db.doc()` path
 * somewhere it shouldn't go.
 */
function isValidDocId(id) {
  if (typeof id !== "string") return false;
  if (id.length === 0 || id.length > 1500) return false;
  if (id.includes("/")) return false;
  if (id === "." || id === "..") return false;
  if (id.startsWith("__") && id.endsWith("__")) return false;
  return true;
}

/**
 * Status changes an admin may make on an app.
 *
 * `pendingReview` is intentionally absent as a *target*: review is a one-way
 * door, an app never gets pushed back into the queue from the console.
 */
const ALLOWED_APP_TRANSITIONS = {
  pendingReview: ["approved", "rejected", "archived"],
  approved: ["rejected", "archived"],
  rejected: ["approved", "archived"],
  archived: ["approved", "rejected"],
};

function isValidAppStatus(status) {
  return APP_STATUSES.includes(status);
}

/**
 * @returns {{ok: boolean, reason?: string, noop?: boolean}}
 */
function checkAppTransition(from, to) {
  if (!isValidAppStatus(to)) {
    return { ok: false, reason: `Unknown target status "${to}".` };
  }
  if (to === "pendingReview") {
    return { ok: false, reason: "An app cannot be moved back to pendingReview." };
  }
  const current = isValidAppStatus(from) ? from : "pendingReview";
  if (current === to) {
    return { ok: true, noop: true };
  }
  const allowed = ALLOWED_APP_TRANSITIONS[current] || [];
  if (!allowed.includes(to)) {
    return { ok: false, reason: `Cannot move an app from ${current} to ${to}.` };
  }
  return { ok: true, noop: false };
}

/** Clamp a caller-supplied batch size into a sane range. */
function clampRequestedCount(raw, max) {
  if (raw === undefined || raw === null) return max;
  const n = Number(raw);
  if (!Number.isFinite(n)) return max;
  const floored = Math.floor(n);
  if (floored < 1) return 0;
  return Math.min(floored, max);
}

module.exports = {
  isValidDocId,
  isValidAppStatus,
  checkAppTransition,
  clampRequestedCount,
  ALLOWED_APP_TRANSITIONS,
};

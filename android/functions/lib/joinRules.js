/**
 * Group join decision — pure logic.
 *
 * Kept separate from the Firestore I/O in `groups.js` so the rules that
 * actually matter (cap, duplicates, suspension, group state) can be tested
 * deterministically without an emulator.
 */

const { JOINABLE_GROUP_STATES } = require("./constants");

/**
 * @param {Object} params
 * @param {boolean} params.groupExists
 * @param {string} params.groupStatus
 * @param {string} [params.groupVisibility]
 * @param {number} params.memberCap 0 means "no cap"
 * @param {number} params.memberCount current member count
 * @param {boolean} params.alreadyMember
 * @param {boolean} params.isSuspended
 * @returns {{allowed: boolean, outcome: string, code?: string, message?: string}}
 */
function evaluateJoin({
  groupExists,
  groupStatus,
  groupVisibility,
  memberCap,
  memberCount,
  alreadyMember,
  isSuspended,
}) {
  if (isSuspended) {
    return {
      allowed: false,
      outcome: "suspended",
      code: "permission-denied",
      message:
        "Your account is suspended. Contact support if you think this is a mistake.",
    };
  }
  if (!groupExists) {
    return {
      allowed: false,
      outcome: "missingGroup",
      code: "not-found",
      message: "That group no longer exists.",
    };
  }
  const status = groupStatus || "draft";
  if (!JOINABLE_GROUP_STATES.includes(status)) {
    return {
      allowed: false,
      outcome: "closedGroup",
      code: "failed-precondition",
      message: `This group is not accepting members (status: ${status}).`,
    };
  }
  if (groupVisibility === "private") {
    return {
      allowed: false,
      outcome: "private",
      code: "permission-denied",
      message: "This group is private.",
    };
  }
  // Idempotent: re-joining is a success that writes nothing, so a stale UI or
  // a double tap never produces a duplicate membership or an error.
  if (alreadyMember) {
    return { allowed: false, outcome: "alreadyMember" };
  }
  const cap = Number(memberCap || 0);
  if (cap > 0 && Number(memberCount || 0) >= cap) {
    return {
      allowed: false,
      outcome: "full",
      code: "resource-exhausted",
      message: "This group is full.",
    };
  }
  return { allowed: true, outcome: "joined" };
}

module.exports = { evaluateJoin };

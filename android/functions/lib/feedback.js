/**
 * Tester feedback: the pure rules behind feedback.js.
 *
 * THE PRODUCT RULE (Batch 9C)
 *   * One feedback per testing cycle: the record's id IS the assignment id, so
 *     "one per tester per app per cycle" is a property of the key, not a
 *     check that could race.
 *   * Any tester whose STAKED commitment has at least one recorded testing day
 *     may leave it - while testing, after completing, and after cancelling,
 *     forfeiting or being removed. Testers who drop out are exactly the ones
 *     whose reasons are worth hearing.
 *   * Content is a required 1-5 rating, an optional comment of at most
 *     FEEDBACK_COMMENT_MAX_LENGTH characters and an optional "found a bug"
 *     flag. Nothing else is accepted.
 *   * Immutable once submitted. There is no edit or delete path, for the
 *     tester or anyone else.
 *
 * FEEDBACK IS NOT PROGRESS
 * Nothing about feedback is read by any settlement, check-in, sweep or claim,
 * and the submission path writes exactly one document, in its own collection.
 * It therefore cannot unlock or lock coins, touch a wallet, record or remove a
 * testing day, change a status, capacity or testerCount, or affect the miss
 * rule. That separation is structural - see feedback.js - and the emulator
 * tests fingerprint every one of those documents around a submission.
 */

const { isValidDocId } = require("./validation");

const FEEDBACK_COLLECTION = "feedback";
const FEEDBACK_RATING_MIN = 1;
const FEEDBACK_RATING_MAX = 5;
/** Characters (Unicode code points) after normalization. */
const FEEDBACK_COMMENT_MAX_LENGTH = 1000;
/** Ceiling on one page of an app's feedback. */
const FEEDBACK_PAGE_MAX = 100;
const FEEDBACK_PAGE_DEFAULT = 50;

/** The only keys a submission may carry. Anything else is refused, not ignored. */
const SUBMISSION_KEYS = ["assignmentId", "rating", "comment", "foundBug"];

/**
 * Normalize a free-text comment.
 *
 * NFC-normalized, CRLF/CR folded to LF, control characters other than LF and
 * TAB removed (including C1 and bidi overrides, which can disguise text when
 * shown to the developer), runs of more than two blank lines collapsed, and
 * trimmed. Stored as text only; rendering is the client's job, and nothing
 * here is ever interpreted as markup.
 */
function normalizeComment(value) {
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    // C0 except TAB and LF, DEL, C1, and the bidi embedding/override/isolate controls.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Validate and normalize a submission payload.
 *
 * @returns {{ok: true, value: {assignmentId, rating, comment, foundBug}} |
 *           {ok: false, field: string, message: string}}
 */
function validateSubmission(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, field: "data", message: "Feedback is missing." };
  }
  const unknown = Object.keys(data).filter((k) => !SUBMISSION_KEYS.includes(k));
  if (unknown.length > 0) {
    return { ok: false, field: unknown[0], message: `"${unknown[0]}" is not a feedback field.` };
  }

  if (!isValidDocId(data.assignmentId)) {
    return { ok: false, field: "assignmentId", message: '"assignmentId" is missing or invalid.' };
  }

  const { rating } = data;
  if (
    !Number.isInteger(rating) ||
    rating < FEEDBACK_RATING_MIN ||
    rating > FEEDBACK_RATING_MAX
  ) {
    return {
      ok: false,
      field: "rating",
      message: `Choose a rating from ${FEEDBACK_RATING_MIN} to ${FEEDBACK_RATING_MAX}.`,
    };
  }

  let comment = null;
  if (data.comment !== undefined && data.comment !== null) {
    if (typeof data.comment !== "string") {
      return { ok: false, field: "comment", message: "The comment must be text." };
    }
    // Refuse an absurd payload before spending any work normalizing it.
    if (data.comment.length > FEEDBACK_COMMENT_MAX_LENGTH * 4) {
      return { ok: false, field: "comment", message: "The comment is too long." };
    }
    const normalized = normalizeComment(data.comment);
    if ([...normalized].length > FEEDBACK_COMMENT_MAX_LENGTH) {
      return {
        ok: false,
        field: "comment",
        message: `Keep the comment to ${FEEDBACK_COMMENT_MAX_LENGTH} characters.`,
      };
    }
    comment = normalized.length > 0 ? normalized : null;
  }

  let foundBug = false;
  if (data.foundBug !== undefined && data.foundBug !== null) {
    if (typeof data.foundBug !== "boolean") {
      return { ok: false, field: "foundBug", message: '"foundBug" must be true or false.' };
    }
    foundBug = data.foundBug;
  }

  return { ok: true, value: { assignmentId: data.assignmentId, rating, comment, foundBug } };
}

/**
 * May this caller leave feedback on this assignment?
 *
 * Every input is server-read. Deliberately the SAME refusal for "no such
 * assignment" and "someone else's assignment": ids are deterministic
 * (`{appId}__{testerId}__c{n}`), so distinguishing them would let anyone probe
 * whether a given user tested a given app.
 *
 * Monotonic by construction: testerId, developerId and lockTxId are written
 * once at claim and never change, and testing logs are never deleted - so an
 * assignment that is eligible now stays eligible, which is what lets the
 * submission skip a transaction on the assignment.
 */
function checkFeedbackEligible({ callerId, assignmentExists, testerId, developerId, lockTxId, qualifyingDays }) {
  if (!assignmentExists || !callerId || testerId !== callerId) {
    return { ok: false, code: "not-found", reason: "notYourAssignment", message: "We couldn't find that testing commitment." };
  }
  // Unreachable through a real claim (the owner is refused there); kept so
  // corrupt data can never let a developer review their own app.
  if (developerId && developerId === callerId) {
    return { ok: false, code: "permission-denied", reason: "ownApp", message: "You can't leave feedback on your own app." };
  }
  if (!lockTxId) {
    return { ok: false, code: "failed-precondition", reason: "noCommitment", message: "Feedback is for testing commitments." };
  }
  if (!Number.isInteger(qualifyingDays) || qualifyingDays < 1) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "noTestingDays",
      message: "Record at least one testing day before leaving feedback.",
    };
  }
  return { ok: true };
}

function millisOf(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  return null;
}

/** The tester's own view of their feedback. */
function shapeOwnFeedback(id, data) {
  return {
    assignmentId: id,
    appId: data.appId || null,
    cycle: Number.isInteger(data.cycle) ? data.cycle : null,
    rating: data.rating,
    comment: data.comment || null,
    foundBug: data.foundBug === true,
    submittedAtMillis: millisOf(data.submittedAt),
  };
}

/**
 * The developer's view: what was said and when, and nothing that identifies
 * who said it - no tester id, no assignment id (it embeds the tester id), no
 * cycle (which, with timing, narrows who it could be).
 */
function shapeDeveloperFeedback(data) {
  return {
    rating: data.rating,
    comment: data.comment || null,
    foundBug: data.foundBug === true,
    submittedAtMillis: millisOf(data.submittedAt),
  };
}

/** The admin's view: the full record. */
function shapeAdminFeedback(id, data) {
  return {
    ...shapeOwnFeedback(id, data),
    testerId: data.testerId || null,
    developerId: data.developerId || null,
  };
}

/** Clamp a requested page size; anything unusable becomes the default. */
function pageSize(requested) {
  if (!Number.isInteger(requested) || requested < 1) return FEEDBACK_PAGE_DEFAULT;
  return Math.min(requested, FEEDBACK_PAGE_MAX);
}

module.exports = {
  FEEDBACK_COLLECTION,
  FEEDBACK_RATING_MIN,
  FEEDBACK_RATING_MAX,
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_PAGE_MAX,
  FEEDBACK_PAGE_DEFAULT,
  SUBMISSION_KEYS,
  normalizeComment,
  validateSubmission,
  checkFeedbackEligible,
  shapeOwnFeedback,
  shapeDeveloperFeedback,
  shapeAdminFeedback,
  pageSize,
};

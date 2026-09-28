/**
 * Tester feedback (Batch 9C). See lib/feedback.js for the product rule.
 *
 * STORAGE
 * `feedback/{assignmentId}` - one document per testing cycle, keyed by the
 * cycle's own deterministic assignment id, written once with `create()` and
 * never again. Two simultaneous submissions for one cycle collide on the key
 * and exactly one lands; the other is told it already exists.
 *
 * SECURITY MODEL
 *   * The tester is the verified caller (`request.auth.uid`). The app, the
 *     developer and the cycle are copied from the stored assignment, never from
 *     the request, which carries only an assignment id and the content.
 *   * Eligibility is read server-side: the assignment's owner and stake, and a
 *     count of the testing logs the server itself wrote.
 *   * Rules refuse every client write to `feedback`, and there is no update or
 *     delete path here - feedback is immutable for everyone, its author included.
 *   * Reads go through these callables: the author reads their own, the app's
 *     developer reads an anonymous projection, an admin (role read fresh,
 *     suspension refused) reads the full record.
 *
 * NO TRANSACTION, ON PURPOSE
 * The submission reads the assignment and its log count and then creates one
 * document. Wrapping that in a transaction would lock the assignment, so every
 * feedback submission would contend with the check-ins and settlements that
 * move money. It is unnecessary because eligibility is monotonic (see
 * `checkFeedbackEligible`): nothing a concurrent writer can do makes an
 * eligible assignment ineligible. The only race that matters - two
 * submissions - is settled by `create()`.
 *
 * NO PATH TO MONEY OR PROGRESS
 * This module writes to `feedback` and nothing else. It does not import the
 * wallet, the settlements, the check-in or the sweep.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const { REGION } = require("./lib/constants");
const {
  FEEDBACK_COLLECTION,
  validateSubmission,
  checkFeedbackEligible,
  shapeOwnFeedback,
  shapeDeveloperFeedback,
  shapeAdminFeedback,
  pageSize,
} = require("./lib/feedback");
const { requireAuth, requireDocId, requireAdmin, requireNotSuspended } = require("./lib/guards");
const { requireTermsAccepted } = require("./lib/terms");

const ALREADY_EXISTS = 6;

function feedbackPath(assignmentId) {
  return `${FEEDBACK_COLLECTION}/${assignmentId}`;
}

async function countLogs(db, assignmentId) {
  const snap = await db
    .collection("testingLogs")
    .where("assignmentId", "==", assignmentId)
    .count()
    .get();
  return snap.data().count;
}

async function readEligibility(db, { callerId, assignmentId }) {
  const snap = await db.doc(`testingAssignments/${assignmentId}`).get();
  const qualifyingDays = snap.exists && snap.get("testerId") === callerId
    ? await countLogs(db, assignmentId)
    : 0;
  const eligible = checkFeedbackEligible({
    callerId,
    assignmentExists: snap.exists,
    testerId: snap.exists ? snap.get("testerId") : null,
    developerId: snap.exists ? snap.get("developerId") : null,
    lockTxId: snap.exists ? snap.get("lockTxId") : null,
    qualifyingDays,
  });
  return { snap, eligible };
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/**
 * Submit feedback for one testing cycle. `callerId` is the verified caller;
 * `input` is the raw request payload, validated here.
 */
async function runSubmitFeedback(db, { callerId, input }) {
  const valid = validateSubmission(input);
  if (!valid.ok) {
    throw new HttpsError("invalid-argument", valid.message, { field: valid.field });
  }
  const { assignmentId, rating, comment, foundBug } = valid.value;

  const { snap, eligible } = await readEligibility(db, { callerId, assignmentId });
  if (!eligible.ok) {
    throw new HttpsError(eligible.code, eligible.message, { reason: eligible.reason });
  }

  const record = {
    assignmentId,
    appId: snap.get("appId"),
    testerId: callerId,
    developerId: snap.get("developerId") || null,
    cycle: Number.isInteger(snap.get("cycle")) ? snap.get("cycle") : null,
    rating,
    comment,
    foundBug,
    submittedAt: FieldValue.serverTimestamp(),
  };

  try {
    await db.doc(feedbackPath(assignmentId)).create(record);
  } catch (err) {
    if (err && (err.code === ALREADY_EXISTS || err.code === "already-exists")) {
      throw new HttpsError(
        "already-exists",
        "You've already left feedback for this testing cycle.",
        { reason: "alreadySubmitted" },
      );
    }
    throw err;
  }

  return { submitted: true, assignmentId, appId: record.appId, cycle: record.cycle };
}

async function submitTestingFeedbackImpl(db, request) {
  const uid = requireAuth(request);
  // Validate before any read, so malformed input never reaches the database.
  const valid = validateSubmission(request.data);
  if (!valid.ok) {
    throw new HttpsError("invalid-argument", valid.message, { field: valid.field });
  }
  const caller = await requireNotSuspended(db, uid);
  requireTermsAccepted(caller.data);
  const outcome = await runSubmitFeedback(db, { callerId: uid, input: request.data });
  logger.info(`tester ${uid} left feedback on ${outcome.assignmentId}`);
  return outcome;
}

// ---------------------------------------------------------------------------
// Read: the author's own
// ---------------------------------------------------------------------------

/**
 * The caller's feedback for one of their cycles, or null - plus whether they
 * may still leave it, so the app can show the form or the submitted answer
 * without guessing. Another tester's assignment reads exactly like a missing
 * one.
 */
async function runGetMyFeedback(db, { callerId, assignmentId }) {
  const { eligible } = await readEligibility(db, { callerId, assignmentId });
  if (!eligible.ok && eligible.reason === "notYourAssignment") {
    throw new HttpsError(eligible.code, eligible.message, { reason: eligible.reason });
  }
  const fb = await db.doc(feedbackPath(assignmentId)).get();
  // Belt and braces: the key embeds the owner, but ownership is checked on data.
  const mine = fb.exists && fb.get("testerId") === callerId;
  return {
    assignmentId,
    feedback: mine ? shapeOwnFeedback(fb.id, fb.data()) : null,
    canSubmit: !mine && eligible.ok,
    reason: mine ? "alreadySubmitted" : (eligible.ok ? null : eligible.reason),
  };
}

async function getMyTestingFeedbackImpl(db, request) {
  const uid = requireAuth(request);
  const assignmentId = requireDocId(request.data && request.data.assignmentId, "assignmentId");
  return runGetMyFeedback(db, { callerId: uid, assignmentId });
}

// ---------------------------------------------------------------------------
// Read: an app's feedback, for its developer (anonymous) or an admin (full)
// ---------------------------------------------------------------------------

/** Newest first, `limit` at a time; `beforeMillis` continues a previous page. */
async function readAppFeedbackPage(db, { appId, limit, beforeMillis }) {
  let query = db
    .collection(FEEDBACK_COLLECTION)
    .where("appId", "==", appId)
    .orderBy("submittedAt", "desc");
  if (Number.isFinite(beforeMillis)) {
    query = query.where("submittedAt", "<", Timestamp.fromMillis(beforeMillis));
  }
  const size = pageSize(limit);
  const snap = await query.limit(size).get();
  const last = snap.docs[snap.docs.length - 1];
  return {
    docs: snap.docs,
    nextBeforeMillis: snap.docs.length === size && last && last.get("submittedAt")
      ? last.get("submittedAt").toMillis()
      : null,
  };
}

function readPaging(data) {
  const limit = data && data.limit;
  const beforeMillis = data && data.beforeMillis;
  if (limit !== undefined && limit !== null && !Number.isInteger(limit)) {
    throw new HttpsError("invalid-argument", '"limit" must be a whole number.');
  }
  if (beforeMillis !== undefined && beforeMillis !== null && !Number.isFinite(beforeMillis)) {
    throw new HttpsError("invalid-argument", '"beforeMillis" must be a number.');
  }
  return { limit, beforeMillis };
}

/**
 * The developer's feedback for their OWN app, anonymous. Refused for anyone
 * else - including an admin, who has `adminListFeedback`.
 */
async function runGetAppFeedback(db, { callerId, appId, limit, beforeMillis }) {
  const app = await db.doc(`apps/${appId}`).get();
  if (!app.exists) {
    throw new HttpsError("not-found", "That app does not exist.");
  }
  if (app.get("ownerId") !== callerId) {
    throw new HttpsError("permission-denied", "Only the app's developer can read its feedback.");
  }
  const page = await readAppFeedbackPage(db, { appId, limit, beforeMillis });
  return {
    appId,
    feedback: page.docs.map((d) => shapeDeveloperFeedback(d.data())),
    nextBeforeMillis: page.nextBeforeMillis,
  };
}

async function getAppFeedbackImpl(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");
  const paging = readPaging(request.data);
  return runGetAppFeedback(db, { callerId: uid, appId, ...paging });
}

async function adminListFeedbackImpl(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");
  const paging = readPaging(request.data);
  await requireAdmin(db, uid);
  const page = await readAppFeedbackPage(db, { appId, ...paging });
  return {
    appId,
    feedback: page.docs.map((d) => shapeAdminFeedback(d.id, d.data())),
    nextBeforeMillis: page.nextBeforeMillis,
  };
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

/** Input `{ assignmentId, rating, comment?, foundBug? }`. Immutable once written. */
const submitTestingFeedback = onCall({ region: REGION }, (request) =>
  submitTestingFeedbackImpl(getFirestore(), request),
);

/** Input `{ assignmentId }`. The caller's own feedback and whether they can still leave it. */
const getMyTestingFeedback = onCall({ region: REGION }, (request) =>
  getMyTestingFeedbackImpl(getFirestore(), request),
);

/** Input `{ appId, limit?, beforeMillis? }`. The owner's anonymous view. */
const getAppFeedback = onCall({ region: REGION }, (request) =>
  getAppFeedbackImpl(getFirestore(), request),
);

/** Input `{ appId, limit?, beforeMillis? }`. Admin-only, full records. */
const adminListFeedback = onCall({ region: REGION }, (request) =>
  adminListFeedbackImpl(getFirestore(), request),
);

module.exports = {
  submitTestingFeedback,
  getMyTestingFeedback,
  getAppFeedback,
  adminListFeedback,
  // Exported for tests - no Functions runtime required.
  submitTestingFeedbackImpl,
  getMyTestingFeedbackImpl,
  getAppFeedbackImpl,
  adminListFeedbackImpl,
  runSubmitFeedback,
  runGetMyFeedback,
  runGetAppFeedback,
  feedbackPath,
};

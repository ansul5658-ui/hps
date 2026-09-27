/**
 * Automatic expiry evaluation and forfeiture of commitments that ran out of
 * time.
 *
 * A commitment whose window closes below 14 qualifying days forfeits its 50
 * coins. Until now that could only happen because an admin asked for it; this
 * module is what makes it happen on its own.
 *
 * WHAT THIS MODULE DOES NOT CONTAIN
 * No wallet arithmetic. No ledger writes. No second definition of "the window
 * closed". The sweep's entire job is to decide WHICH assignments are worth
 * looking at and then hand each one to `runForfeitCommitment`, which re-derives
 * the decision inside its own transaction and owns every coin movement. That
 * split is deliberate: a scheduled job is the worst place to discover that a
 * settlement rule was duplicated slightly differently, because nobody is
 * watching when it runs.
 *
 * WHY A CANDIDATE QUERY AND NOT A FULL SCAN
 * Firestore cannot express "the local midnight after this document's pinned
 * day key has passed" - the boundary depends on a per-document timezone. So
 * the query narrows on what Firestore CAN answer (non-terminal status, a lock
 * present, a stored window end already behind us) and the precise local-day
 * decision is made per document afterwards. The query is therefore allowed to
 * be slightly too generous and never too strict: every candidate it returns is
 * re-judged, and a candidate it wrongly returns costs one read.
 *
 * SAFE TO RETRY, BY CONSTRUCTION
 * Cloud Functions retries, overlapping runs and a manual admin invocation all
 * converge on the same state, because forfeiture is keyed to the assignment:
 * the ledger entry id is `forfeit_{assignmentId}` and it is written with
 * `tx.create`. A second attempt does not write a second entry - it loses the
 * race and reports that the commitment was already settled.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  SCHEDULER_REGION,
  EXPIRY_SWEEP_SCHEDULE,
  EXPIRY_SWEEP_LIMIT,
  COMMITMENT_DAYS_REQUIRED,
  TERMINAL_ASSIGNMENT_STATUSES,
  ACTOR_KIND_SYSTEM,
  ACTOR_KIND_ADMIN,
} = require("./lib/constants");
const { forfeitEntryId } = require("./lib/commitments");
const { checkCommitmentExpiry, couldBeExpired } = require("./lib/expiry");
const { readMissEvidence } = require("./lib/misses");
const { runForfeitCommitment } = require("./commitments");
const { readOutageRecords } = require("./systemHealth");
const { requireAuth, requireAdmin, requireDocId } = require("./lib/guards");

/** Actor recorded on a ledger entry the scheduler produced. */
const SYSTEM_ACTOR_ID = "system:expirySweep";

/**
 * Read-only verdict for one assignment. Writes nothing, moves nothing.
 *
 * This is the reporting face of the same decision `runForfeitCommitment`
 * makes. It exists so an admin, a test or a dry run can ask "would this be
 * forfeited, and why" without risking a settlement - and deliberately does NOT
 * hand its answer to the settlement path, which re-derives it under
 * transaction isolation. A verdict computed outside a transaction is a
 * snapshot of the past by the time anyone could act on it.
 */
async function evaluateAssignmentExpiry(db, { assignmentId, nowMillis = Date.now() }) {
  const snap = await db.doc(`testingAssignments/${assignmentId}`).get();
  if (!snap.exists) {
    return { assignmentId, expired: false, reason: "missing" };
  }

  const firstEligibleDayKey = snap.get("firstEligibleDayKey");
  const lastEligibleDayKey = snap.get("lastEligibleDayKey");
  const outageRecords = await readOutageRecords(db, {
    fromDayKey: firstEligibleDayKey,
    toDayKey: lastEligibleDayKey,
  });

  // Counted from the logs, exactly as settlement does. Reading the cached
  // `qualifyingDays` here would make this report disagree with the decision it
  // is supposed to be previewing.
  const countSnap = await db
    .collection("testingLogs")
    .where("assignmentId", "==", assignmentId)
    .count()
    .get();
  const qualifyingDays = countSnap.data().count;

  // The miss rule's evidence, read exactly as the settlement reads it.
  const allowedMisses = snap.get("allowedMisses");
  const loggedDayKeys = await readMissEvidence({
    assignmentId,
    allowedMisses,
    timeZone: snap.get("timeZone"),
    firstEligibleDayKey,
    lastEligibleDayKey,
    appId: snap.get("appId"),
    outageRecords,
    nowMillis,
    read: (path) => db.doc(path).get(),
  });

  const verdict = checkCommitmentExpiry({
    status: snap.get("status"),
    lockTxId: snap.get("lockTxId"),
    appId: snap.get("appId"),
    timeZone: snap.get("timeZone"),
    firstEligibleDayKey,
    lastEligibleDayKey,
    qualifyingDays,
    daysRequired: snap.get("daysRequired") || COMMITMENT_DAYS_REQUIRED,
    outageRecords,
    nowMillis,
    allowedMisses,
    loggedDayKeys,
  });

  return {
    assignmentId,
    testerId: snap.get("testerId"),
    appId: snap.get("appId"),
    status: snap.get("status"),
    qualifyingDays,
    daysRequired: snap.get("daysRequired") || COMMITMENT_DAYS_REQUIRED,
    ...verdict,
  };
}

/**
 * Candidate assignments the sweep should examine.
 *
 * Narrowed on `status` and on `windowEndsAt`, both of which Firestore can
 * index. `windowEndsAt` is the real instant the pinned window closes, written
 * once at claim time, so "already behind us" is a sound coarse filter. It
 * cannot account for outage credit - that is per-document and derived - which
 * is precisely why this only produces CANDIDATES.
 *
 * The status filter uses the non-terminal statuses explicitly rather than
 * `not-in` the terminal ones, because `not-in` would also return documents
 * missing the field entirely.
 *
 * REQUIRES A COMPOSITE INDEX: (status ASC, windowEndsAt ASC), declared in
 * `firestore.indexes.json`. The emulator does not enforce indexes, so this is
 * the kind of query that passes every test and then fails only in production -
 * hence the index is committed alongside the query rather than discovered
 * later. Filtering status in memory instead would avoid the index but would
 * make every settled assignment ever created compete for the sweep's limit,
 * which gets slower forever.
 */
async function findExpiryCandidates(db, { nowMillis, limit = EXPIRY_SWEEP_LIMIT }) {
  const liveStatuses = ["ready", "inProgress", "waitingForVerification"];
  const snap = await db
    .collection("testingAssignments")
    .where("status", "in", liveStatuses)
    .where("windowEndsAt", "<=", new Date(nowMillis))
    .orderBy("windowEndsAt", "asc")
    .limit(limit)
    .get();

  // Commitments that may have crossed their miss limit before their window
  // closes. `removalCheckAt` exists only on commitments claimed under the miss
  // rule, so every legacy commitment is found by the window query above alone,
  // exactly as before. It is a lower bound (see `removalCheckAtMillis`), so
  // this can only over-select; the settlement transaction re-decides each one.
  //
  // REQUIRES A COMPOSITE INDEX: (status ASC, removalCheckAt ASC), declared in
  // `firestore.indexes.json` beside the windowEndsAt one.
  const removalSnap = await db
    .collection("testingAssignments")
    .where("status", "in", liveStatuses)
    .where("removalCheckAt", "<=", new Date(nowMillis))
    .orderBy("removalCheckAt", "asc")
    .limit(limit)
    .get();

  const windowIds = snap.docs
    .filter((doc) => {
      // A reward-era assignment staked nothing; forfeiting one would consume
      // coins that were never locked.
      if (!doc.get("lockTxId")) return false;
      if (TERMINAL_ASSIGNMENT_STATUSES.includes(doc.get("status"))) return false;
      // Cheap local-day pre-check, so obviously-open windows never reach the
      // transaction. Outages are ignored here on purpose - see `couldBeExpired`.
      return couldBeExpired({
        lastEligibleDayKey: doc.get("lastEligibleDayKey"),
        timeZone: doc.get("timeZone"),
        nowMillis,
      });
    })
    .map((doc) => doc.id);

  const removalIds = removalSnap.docs
    .filter((doc) => doc.get("lockTxId") && !TERMINAL_ASSIGNMENT_STATUSES.includes(doc.get("status")))
    .map((doc) => doc.id);

  // One evaluation per assignment even when both queries found it. Each is
  // settled in its own idempotent transaction regardless, so a duplicate would
  // only cost a refused attempt - but it would be reported as a skip.
  return [...new Set([...windowIds, ...removalIds])].slice(0, limit);
}

/** The refusals `runForfeitCommitment` throws on purpose, as HttpsError codes. */
const REFUSAL_CODES = new Set(["failed-precondition", "already-exists", "not-found"]);

/** gRPC ALREADY_EXISTS, as Firestore itself reports it (a number, not a string). */
const GRPC_ALREADY_EXISTS = 6;

/**
 * Is [err] a settlement the sweep should record as a skip rather than a
 * failure?
 *
 * Deliberate refusals, yes. From Firestore itself exactly one error is also
 * an expected outcome: raw ALREADY_EXISTS on THIS assignment's forfeiture
 * ledger entry. Its id is deterministic and written with `tx.create`, so a
 * collision there means a racing settlement already forfeited this very
 * commitment and this attempt committed nothing - the exactly-once backstop
 * doing its job. The error names the document ("Document already exists:
 * .../coinTransactions/forfeit_<id>" in production, "entity already exists:
 * EntityRef{..., path=/.../coinTransactions/forfeit_<id>}" on the emulator),
 * and the name is required: an ALREADY_EXISTS on any other document, or one
 * that names nothing, is not proven harmless and is reported as a failure.
 * Nor are Firestore's own raw FAILED_PRECONDITION (9) or NOT_FOUND (5) ever
 * skips - a missing index or a vanished document is a real failure, whatever
 * the HttpsError refusals with similar names mean.
 */
function isExpectedSettlementRefusal(assignmentId, err) {
  if (!err) return false;
  if (REFUSAL_CODES.has(err.code)) return true;
  if (err.code !== GRPC_ALREADY_EXISTS) return false;
  const ledgerDoc = `/coinTransactions/${forfeitEntryId(assignmentId)}`;
  const text = `${err.details || ""} ${err.message || ""}`;
  let at = text.indexOf(ledgerDoc);
  while (at !== -1) {
    // The id must end there: `forfeit_a1` is not `forfeit_a10`.
    const next = text.charAt(at + ledgerDoc.length);
    if (!/[A-Za-z0-9_-]/.test(next)) return true;
    at = text.indexOf(ledgerDoc, at + 1);
  }
  return false;
}

/**
 * Everything worth logging about a settlement the sweep could not complete:
 * the raw gRPC status (a number and its `details` text) or the HttpsError
 * code and HTTP status, plus the stack. The sweep's summary keeps only
 * code and message; without this the log of a failure has no trace at all
 * (Batch 9G). Logging only - never throws, never affects the outcome.
 */
function describeSettlementError(assignmentId, err) {
  if (!err || typeof err !== "object") return { assignmentId, message: String(err) };
  const status = err.httpErrorCode && err.httpErrorCode.status;
  return {
    assignmentId,
    message: err.message,
    code: err.code === undefined ? null : err.code,
    status: status === undefined ? null : status,
    details: err.details === undefined ? null : err.details,
    stack: typeof err.stack === "string" ? err.stack : null,
  };
}

/**
 * Evaluate and settle every expired commitment. The sweep.
 *
 * Each assignment is settled in its OWN transaction rather than one batch, so
 * a single bad document cannot roll back everyone else's settlement and a
 * long backlog does not build one enormous transaction. Failures are collected
 * and reported, never thrown: one tester's corrupt assignment must not stop
 * the sweep reaching the rest.
 *
 * `actorId`/`actorKind` mark who caused the movement, which is what makes an
 * automatic forfeiture distinguishable from an admin's in the ledger.
 */
async function runExpirySweep(
  db,
  {
    nowMillis = Date.now(),
    limit = EXPIRY_SWEEP_LIMIT,
    actorId = SYSTEM_ACTOR_ID,
    actorKind = ACTOR_KIND_SYSTEM,
  } = {},
) {
  const candidates = await findExpiryCandidates(db, { nowMillis, limit });

  const forfeited = [];
  const skipped = [];
  const failed = [];
  // Log-only detail for each `failed` entry. Kept apart so the returned
  // summary - which callers and tests compare - is unchanged.
  const failureDiagnostics = [];

  for (const assignmentId of candidates) {
    try {
      const outcome = await runForfeitCommitment(db, {
        assignmentId,
        actorId,
        actorKind,
        nowMillis,
      });
      forfeited.push({
        assignmentId,
        testerId: outcome.testerId,
        amount: outcome.amount,
        qualifyingDays: outcome.qualifyingDays,
        creditedOutageDays: outcome.creditedOutageDays,
        settlementTxId: outcome.settlementTxId,
      });
    } catch (err) {
      // Every refusal reaching here is `runForfeitCommitment` declining to
      // destroy coins - a window still open, an outage extension, a
      // requirement met, a settlement that already happened. Those are
      // expected outcomes of a deliberately generous candidate query, not
      // errors, so they are recorded and the sweep moves on.
      const code = err && err.code ? err.code : "internal";
      const entry = { assignmentId, code, message: err && err.message };
      // Including a racing settlement's commit colliding on this
      // assignment's deterministic ledger id - see
      // `isExpectedSettlementRefusal` for exactly what qualifies.
      if (isExpectedSettlementRefusal(assignmentId, err)) {
        skipped.push(entry);
      } else {
        failed.push(entry);
        failureDiagnostics.push(describeSettlementError(assignmentId, err));
      }
    }
  }

  const summary = {
    evaluated: candidates.length,
    forfeitedCount: forfeited.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    coinsForfeited: forfeited.reduce((sum, f) => sum + (f.amount || 0), 0),
    forfeited,
    skipped,
    failed,
  };

  logger.info(
    `expiry sweep: evaluated ${summary.evaluated}, forfeited ${summary.forfeitedCount} ` +
      `(${summary.coinsForfeited} coins), skipped ${summary.skippedCount}, ` +
      `failed ${summary.failedCount}`,
  );
  if (failed.length > 0) {
    logger.error(`expiry sweep could not settle ${failed.length} assignment(s)`, {
      failed,
      diagnostics: failureDiagnostics,
    });
  }

  return summary;
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

/**
 * Admin: preview one assignment's expiry verdict. READ-ONLY.
 *
 * Deliberately separate from the forfeiture callable. Asking "is this
 * expired?" is a support question people will ask often; it should not require
 * the permission to destroy coins, and it must not be the thing that decides.
 */
async function adminEvaluateExpiryImpl(db, request) {
  const uid = requireAuth(request);
  await requireAdmin(db, uid);
  const assignmentId = requireDocId(request.data && request.data.assignmentId, "assignmentId");
  return evaluateAssignmentExpiry(db, { assignmentId });
}

/**
 * Admin: run the sweep now.
 *
 * The same function the scheduler calls, exposed so a backlog can be cleared
 * without waiting for 03:30. It settles through `runForfeitCommitment` like
 * everything else, so running it by hand cannot produce an outcome the
 * schedule would not have.
 */
async function adminRunExpirySweepImpl(db, request) {
  const uid = requireAuth(request);
  await requireAdmin(db, uid);
  const limit = Number(request.data && request.data.limit) || EXPIRY_SWEEP_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > EXPIRY_SWEEP_LIMIT) {
    throw new HttpsError(
      "invalid-argument",
      `limit must be an integer between 1 and ${EXPIRY_SWEEP_LIMIT}.`,
    );
  }
  return runExpirySweep(db, { limit, actorId: uid, actorKind: ACTOR_KIND_ADMIN });
}

const adminEvaluateExpiry = onCall({ region: REGION }, (request) =>
  adminEvaluateExpiryImpl(getFirestore(), request),
);

const adminRunExpirySweep = onCall({ region: REGION }, (request) =>
  adminRunExpirySweepImpl(getFirestore(), request),
);

/**
 * Scheduled: settle expired commitments once a day.
 *
 * Daily rather than hourly - see `EXPIRY_SWEEP_SCHEDULE`. Nothing here is
 * time-critical: a commitment that expired at local midnight is no less
 * expired a few hours later, and the ledger entry records the assignment, not
 * the moment the sweep noticed it.
 */
const evaluateExpiredCommitments = onSchedule(
  // SCHEDULER_REGION, not REGION: Cloud Scheduler has no asia-south2 location.
  { region: SCHEDULER_REGION, schedule: EXPIRY_SWEEP_SCHEDULE, timeZone: "Asia/Kolkata" },
  async () => {
    await runExpirySweep(getFirestore());
  },
);

module.exports = {
  evaluateExpiredCommitments,
  adminEvaluateExpiry,
  adminRunExpirySweep,
  // Exported for tests - no Functions runtime required.
  adminEvaluateExpiryImpl,
  adminRunExpirySweepImpl,
  evaluateAssignmentExpiry,
  findExpiryCandidates,
  isExpectedSettlementRefusal,
  runExpirySweep,
  SYSTEM_ACTOR_ID,
};

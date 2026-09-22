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
  EXPIRY_SWEEP_SCHEDULE,
  EXPIRY_SWEEP_LIMIT,
  COMMITMENT_DAYS_REQUIRED,
  TERMINAL_ASSIGNMENT_STATUSES,
  ACTOR_KIND_SYSTEM,
  ACTOR_KIND_ADMIN,
} = require("./lib/constants");
const { checkCommitmentExpiry, couldBeExpired } = require("./lib/expiry");
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
  const snap = await db
    .collection("testingAssignments")
    .where("status", "in", ["ready", "inProgress", "waitingForVerification"])
    .where("windowEndsAt", "<=", new Date(nowMillis))
    .orderBy("windowEndsAt", "asc")
    .limit(limit)
    .get();

  return snap.docs
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
      if (code === "failed-precondition" || code === "already-exists" || code === "not-found") {
        skipped.push(entry);
      } else {
        failed.push(entry);
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
    logger.error(`expiry sweep could not settle ${failed.length} assignment(s)`, { failed });
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
  { region: REGION, schedule: EXPIRY_SWEEP_SCHEDULE },
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
  runExpirySweep,
  SYSTEM_ACTOR_ID,
};

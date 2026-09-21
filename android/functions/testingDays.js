/**
 * The 14-day testing engine: recording a qualifying day, and completing on the
 * fourteenth.
 *
 * WHY THIS IS A CALLABLE AND NOT A CLIENT WRITE
 * Testing days used to be written straight from the device, with security
 * rules re-deriving the day key from `request.time` to stop clock tampering.
 * That worked, but it forced the day boundary to be UTC, because rules cannot
 * see a tester's timezone - an Indian tester's day flipped at 05:30 local.
 * Moving the write behind this function is what buys a real local-midnight
 * boundary: the server knows the assignment's PINNED zone, so it can derive
 * the correct local day itself. Rules now refuse every client write to
 * `testingLogs`, and this is the only door.
 *
 * WHAT THE CLIENT MAY SEND
 * An assignment id. That is all. The day key, the timezone, the progress
 * count, the window and every coin movement are derived server-side. A request
 * carrying `dayKey`, `timeZone` or `qualifyingDays` is not rejected for
 * containing them - they are simply never read, which is stronger, because
 * there is no parsing path for an attacker to probe.
 *
 * THE FOURTEENTH DAY
 * Completion is not a separate step a scheduler performs later. Recording the
 * fourteenth qualifying day completes the commitment and returns the staked
 * coins in the SAME transaction as the log that earned it. There is therefore
 * no window in which an assignment is complete but the coins are still locked,
 * or the coins are unlocked but the assignment is still running.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const { REGION, COMMITMENT_DAYS_REQUIRED, ACTOR_KIND_USER } = require("./lib/constants");
const {
  dayKeyInZone,
  checkTestingDayEligible,
  checkWindowExpired,
  testingLogId,
  flexDaysRemaining,
  deriveWindow,
  nextCheckInAtMillis,
} = require("./lib/testingDays");
const { stageUnlockSettlement, assignmentPath } = require("./commitments");
const { requireAuth, requireDocId } = require("./lib/guards");

function logPath(logId) {
  return `testingLogs/${logId}`;
}

/**
 * Read the pinned commitment clock off an assignment.
 *
 * Falls back to re-deriving the window from `createdAt` for an assignment
 * written before the clock existed. That fallback is deliberately NOT a
 * silent guess: it only applies when the assignment has a pinned timezone
 * absent, and it uses the documented default, which is recorded on the
 * assignment the first time a day is logged so the window stops moving.
 */
function readCommitmentClock(assignmentSnap) {
  const timeZone = assignmentSnap.get("timeZone");
  const firstEligibleDayKey = assignmentSnap.get("firstEligibleDayKey");
  const lastEligibleDayKey = assignmentSnap.get("lastEligibleDayKey");
  if (timeZone && firstEligibleDayKey && lastEligibleDayKey) {
    return { timeZone, firstEligibleDayKey, lastEligibleDayKey, backfilled: null };
  }
  return { timeZone: null, firstEligibleDayKey: null, lastEligibleDayKey: null, backfilled: null };
}

/**
 * Record one qualifying testing day, and settle the commitment if it is the
 * fourteenth. Atomic.
 *
 * Exported separately from the callable - the same split every privileged path
 * in this project uses - so the whole engine can be tested without the
 * Functions runtime.
 *
 * @returns {Promise<{recorded: boolean, alreadyLogged?: boolean, dayKey: string,
 *                    qualifyingDays: number, daysRequired: number,
 *                    completed: boolean, settlementTxId?: string}>}
 */
async function runRecordTestingDay(db, { assignmentId, testerId, nowMillis = Date.now() }) {
  const assignmentRef = db.doc(assignmentPath(assignmentId));
  const userRef = db.doc(`users/${testerId}`);

  return db.runTransaction(async (tx) => {
    // ---- reads: all of them, before any write ------------------------
    const [assignmentSnap, userSnap] = await Promise.all([
      tx.get(assignmentRef),
      tx.get(userRef),
    ]);

    if (!assignmentSnap.exists) {
      throw new HttpsError("not-found", "That assignment no longer exists.");
    }
    // Ownership, checked against the VERIFIED uid rather than any field the
    // caller sent. Reported as not-found rather than permission-denied so the
    // collection cannot be probed for other testers' assignment ids.
    if (assignmentSnap.get("testerId") !== testerId) {
      throw new HttpsError("not-found", "That assignment no longer exists.");
    }
    if (userSnap.exists && userSnap.get("isSuspended") === true) {
      throw new HttpsError(
        "permission-denied",
        "Your account is suspended. Contact support if you think this is a mistake.",
      );
    }

    const clock = readCommitmentClock(assignmentSnap);
    if (!clock.timeZone) {
      // No pinned clock means this predates the engine, or was written by
      // something that bypassed the claim path. Either way it has no
      // authoritative day boundary, and inventing one now could shift a
      // deadline. Refuse rather than guess.
      throw new HttpsError(
        "failed-precondition",
        "This assignment has no testing window. It predates the testing engine.",
      );
    }

    // THE day key. Server clock, assignment's pinned zone. Nothing the client
    // sent participates in this.
    const todayKey = dayKeyInZone(nowMillis, clock.timeZone);
    const logId = testingLogId(assignmentId, todayKey);
    const logRef = db.doc(logPath(logId));
    const logSnap = await tx.get(logRef);

    const daysRequired = assignmentSnap.get("daysRequired") || COMMITMENT_DAYS_REQUIRED;
    const storedQualifying = assignmentSnap.get("qualifyingDays");

    const eligible = checkTestingDayEligible({
      status: assignmentSnap.get("status"),
      lockTxId: assignmentSnap.get("lockTxId"),
      cycle: assignmentSnap.get("cycle"),
      firstEligibleDayKey: clock.firstEligibleDayKey,
      lastEligibleDayKey: clock.lastEligibleDayKey,
      todayKey,
      qualifyingDays: storedQualifying,
      daysRequired,
      alreadyLoggedToday: logSnap.exists,
    });

    if (!eligible.ok) {
      // A repeat check-in on the same day is a no-op, not an error: a double
      // tap or a retried request must not look like a failure and must not
      // create a second day.
      if (eligible.alreadyLogged) {
        return {
          recorded: false,
          alreadyLogged: true,
          dayKey: todayKey,
          qualifyingDays: Number.isInteger(storedQualifying) ? storedQualifying : 0,
          daysRequired,
          completed: assignmentSnap.get("status") === "completed",
          // Returned on the no-op path as well, so a client that arrived here
          // because its stored value was stale learns the real boundary from
          // the same response that told it the day was already logged.
          nextCheckInAtMillis: nextCheckInAtMillis(todayKey, clock.timeZone),
        };
      }
      throw new HttpsError(eligible.code, eligible.message);
    }

    const nextQualifying = eligible.qualifyingDays;
    const completes = eligible.completes;

    // ---- settlement, in THIS transaction when the 14th day lands ------
    // Composed rather than run afterwards: a second transaction could
    // interleave and leave the assignment complete with the coins still
    // locked. `stageUnlockSettlement` performs its own reads, so it must be
    // called before any write is staged below.
    let settlement = null;
    if (completes) {
      settlement = await stageUnlockSettlement(tx, db, {
        assignmentSnap,
        qualifyingDays: nextQualifying,
        actorId: testerId,
        actorKind: ACTOR_KIND_USER,
      });
    }

    // ---- writes: all of them commit together or not at all ------------
    // `create`, not `set`: the deterministic id means a racing second check-in
    // for the same day collides here and loses, rather than overwriting.
    tx.create(logRef, {
      assignmentId,
      // The cycle is stamped on the log itself, so a log can never be counted
      // toward a different commitment cycle even if ids were ever reworked.
      cycle: assignmentSnap.get("cycle"),
      appId: assignmentSnap.get("appId"),
      testerId,
      date: todayKey,
      timeZone: clock.timeZone,
      createdAt: FieldValue.serverTimestamp(),
    });

    // The instant this logged day stops being "today" in the PINNED zone.
    // Stored as a real Timestamp so the client can render "Logged today" by
    // comparing its own clock against one server-derived instant, instead of
    // computing a local day key itself. This is what fixes the 00:00-05:30 IST
    // wobble: the device no longer has an opinion about where the day boundary
    // falls, so it cannot hold a different one from the server.
    const nextCheckInMillis = nextCheckInAtMillis(todayKey, clock.timeZone);

    const update = {
      qualifyingDays: nextQualifying,
      // Kept in step for the existing UI, which still reads daysCompleted.
      daysCompleted: nextQualifying,
      lastQualifyingDayKey: todayKey,
      // Null only if the day key or zone were corrupt, which the eligibility
      // check above already refuses - so in practice this is always set. A
      // null reads on the client as "not logged", costing a round trip that
      // the server then rejects idempotently, never a duplicate day.
      nextCheckInAt:
        nextCheckInMillis === null ? null : Timestamp.fromMillis(nextCheckInMillis),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (completes) {
      update.status = "completed";
      update.completedAt = FieldValue.serverTimestamp();
      update.settlementTxId = settlement ? settlement.settlementTxId : null;
    } else if (assignmentSnap.get("status") === "ready") {
      update.status = "inProgress";
    }
    tx.update(assignmentRef, update);

    return {
      recorded: true,
      dayKey: todayKey,
      qualifyingDays: nextQualifying,
      daysRequired,
      completed: completes,
      nextCheckInAtMillis: nextCheckInMillis,
      settlementTxId: settlement ? settlement.settlementTxId : null,
      unlockedAmount: settlement ? settlement.amount : 0,
      flexDaysRemaining: flexDaysRemaining({
        firstEligibleDayKey: clock.firstEligibleDayKey,
        lastEligibleDayKey: clock.lastEligibleDayKey,
        todayKey,
        qualifyingDays: nextQualifying,
        daysRequired,
      }),
    };
  });
}

/**
 * Guard + check-in, split out so the authorization wiring is testable too.
 *
 * The tester is the verified uid from the ID token. There is deliberately no
 * tester parameter in the request: a client naming another uid would otherwise
 * be recording testing days against someone else's commitment.
 */
async function recordTestingDayImpl(db, request) {
  const uid = requireAuth(request);
  const assignmentId = requireDocId(
    request.data && request.data.assignmentId,
    "assignmentId",
  );

  const outcome = await runRecordTestingDay(db, { assignmentId, testerId: uid });

  if (outcome.recorded) {
    logger.info(
      `tester ${uid} recorded ${outcome.dayKey} for ${assignmentId}: ` +
        `${outcome.qualifyingDays}/${outcome.daysRequired}` +
        (outcome.completed
          ? ` - COMPLETE, returned ${outcome.unlockedAmount} coins (${outcome.settlementTxId})`
          : ""),
    );
  } else {
    logger.info(`tester ${uid} re-sent ${outcome.dayKey} for ${assignmentId}: no-op`);
  }
  return outcome;
}

/**
 * Read-only: is this commitment's window closed short?
 *
 * The server-authoritative expiry calculation, exposed so the scheduled
 * evaluator in a later batch can call it without reimplementing the rule. It
 * decides nothing about money and writes nothing - the settlement it feeds is
 * `runForfeitCommitment` in `commitments.js`, which re-checks independently.
 */
async function evaluateWindowExpiry(db, { assignmentId, nowMillis = Date.now() }) {
  const snap = await db.doc(assignmentPath(assignmentId)).get();
  if (!snap.exists) return { assignmentId, expired: false, reason: "missing" };

  const timeZone = snap.get("timeZone");
  const lastEligibleDayKey = snap.get("lastEligibleDayKey");
  if (!timeZone || !lastEligibleDayKey) {
    return { assignmentId, expired: false, reason: "noWindow" };
  }

  const todayKey = dayKeyInZone(nowMillis, timeZone);
  const verdict = checkWindowExpired({
    status: snap.get("status"),
    lockTxId: snap.get("lockTxId"),
    lastEligibleDayKey,
    todayKey,
    qualifyingDays: snap.get("qualifyingDays"),
    daysRequired: snap.get("daysRequired") || COMMITMENT_DAYS_REQUIRED,
  });

  return { assignmentId, todayKey, timeZone, lastEligibleDayKey, ...verdict };
}

/**
 * Callable: record today's testing day.
 *
 * Input is `{ assignmentId }` only.
 */
const recordTestingDay = onCall({ region: REGION }, (request) =>
  recordTestingDayImpl(getFirestore(), request),
);

module.exports = {
  recordTestingDay,
  // Exported for tests and for the later scheduled evaluator - no Functions
  // runtime required.
  recordTestingDayImpl,
  runRecordTestingDay,
  evaluateWindowExpiry,
  readCommitmentClock,
  logPath,
  deriveWindow,
};

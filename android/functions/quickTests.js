/**
 * Quick Tests — lightweight discovery sessions, outside the coin economy.
 *
 * SECURITY MODEL
 *   * A Quick Test session exists only because this module created it.
 *     Security rules refuse `create`, `update` and `delete` on
 *     `quickTestSessions` to every client, so there is no way to manufacture
 *     a session, backdate one, or mark one complete from a device.
 *   * The caller supplies an app id and nothing else. The day key, every
 *     timestamp, and every counter come from the server.
 *   * Eligibility — approval, quick-test enablement, ownership, suspension,
 *     the daily limit and the per-app cooldown — is re-derived server-side on
 *     every call. No client flag participates.
 *   * The daily limit is enforced by READING a per-user-per-day counter inside
 *     the transaction. That read locks the counter document, so concurrent
 *     attempts serialize and the sixth cannot slip past while the fifth is in
 *     flight. An aggregate `count()` over the sessions collection would NOT
 *     give this: a count query inside a transaction does not lock the
 *     documents it matched, so two racing calls could both observe four.
 *   * Idempotency is structural: the session id is derived from
 *     (uid, appId, dayKey) and `tx.create` refuses to overwrite it.
 *
 * WHAT THIS MODULE DELIBERATELY CANNOT DO
 * It never writes `testingAssignments`, `testingLogs`, `coinBalance` or
 * `coinTransactions`, and a session document carries no `assignmentId` field.
 * Quick Tests therefore cannot become a source of qualifying testing days or
 * of coins — not by configuration, but because no such code path or field
 * exists.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  QUICK_TEST_POOL_DOC,
  QUICK_TEST_POOL_SIZE,
  QUICK_TEST_DAILY_LIMIT,
  QUICK_TEST_COOLDOWN_DAYS,
  QUICK_TEST_POOL_SCAN_LIMIT,
  QUICK_TEST_NOTE_MAX_LENGTH,
} = require("./lib/constants");
const {
  quickTestSessionId,
  utcDayKey,
  checkQuickTestEligible,
  selectPoolAppIds,
} = require("./lib/quickTests");
const {
  requireAuth,
  requireAdmin,
  requireDocId,
  optionalString,
} = require("./lib/guards");

/** Per-user daily counter. Reading it inside a transaction is the rate limit. */
function dayCounterPath(uid, dayKey) {
  return "users/" + uid + "/quickTestDays/" + dayKey;
}

/** Per-user-per-app cooldown marker. One read, no query, no index. */
function appMarkerPath(uid, appId) {
  return "users/" + uid + "/quickTestApps/" + appId;
}

function millisOf(timestamp) {
  if (!timestamp) return 0;
  if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
  return 0;
}

// ---------------------------------------------------------------------------
// Starting a session
// ---------------------------------------------------------------------------

/**
 * Start a Quick Test, atomically.
 *
 * Exported separately from the callable — the same split `runMatching` and
 * `runCompletionVerification` use — so the path can be exercised against the
 * emulator without the Functions runtime.
 *
 * Returns rather than throws for `alreadyToday`, so a double tap is harmless.
 * Every other refusal throws, because the user needs to know why.
 *
 * @returns {Promise<{started: boolean, sessionId: string, appId: string,
 *                    dayKey: string, reason?: string, remainingToday: number}>}
 */
async function runStartQuickTest(db, { uid, appId, now = Date.now() }) {
  const dayKey = utcDayKey(now);
  const sessionId = quickTestSessionId(uid, appId, dayKey);

  const sessionRef = db.doc("quickTestSessions/" + sessionId);
  const appRef = db.doc("apps/" + appId);
  const userRef = db.doc("users/" + uid);
  const dayRef = db.doc(dayCounterPath(uid, dayKey));
  const markerRef = db.doc(appMarkerPath(uid, appId));

  return db.runTransaction(async (tx) => {
    // ---- reads: all of them, before any write ------------------------
    const [session, app, user, day, marker] = await Promise.all([
      tx.get(sessionRef),
      tx.get(appRef),
      tx.get(userRef),
      tx.get(dayRef), // this read is the rate limit — it locks the counter
      tx.get(markerRef),
    ]);

    const usedToday = day.exists ? day.get("count") : 0;

    const eligible = checkQuickTestEligible({
      appExists: app.exists,
      appStatus: app.exists ? app.get("status") : undefined,
      // Absent on every app predating this feature — read defensively, the
      // same reasoning the rules' `.get(key, default)` calls document.
      quickTestEnabled: app.exists ? app.get("quickTestEnabled") === true : false,
      appOwnerId: app.exists ? app.get("ownerId") : undefined,
      uid,
      // An absent field means "never suspended", matching guards.js.
      isSuspended: user.exists ? user.get("isSuspended") === true : false,
      sessionExists: session.exists,
      sessionsToday: Number.isInteger(usedToday) ? usedToday : 0,
      lastSessionDayKey: marker.exists ? marker.get("lastSessionDayKey") : null,
      todayKey: dayKey,
    });

    if (!eligible.ok) {
      if (eligible.reason === "alreadyToday") {
        return {
          started: false,
          reason: "alreadyToday",
          sessionId,
          appId,
          dayKey,
          remainingToday: Math.max(0, QUICK_TEST_DAILY_LIMIT - (usedToday || 0)),
        };
      }
      throw new HttpsError(eligible.code, eligible.message);
    }

    // ---- writes: these three commit together or not at all -----------
    // `create`, never `set`: an existing session must fail the transaction
    // rather than be silently overwritten with a fresh openedAt.
    //
    // NOTE: there is deliberately no `assignmentId` field here. See the module
    // header — this absence is the structural guarantee that a Quick Test can
    // never be mistaken for, or converted into, commitment progress.
    tx.create(sessionRef, {
      uid,
      appId,
      dayKey,
      openedAt: FieldValue.serverTimestamp(),
      completedAt: null,
      feedbackId: null,
    });

    // `increment` rather than read-modify-write: computed server-side at
    // commit, and treats a missing field as 0 — which matters because no
    // counter document exists until a user's first Quick Test of the day.
    tx.set(
      dayRef,
      {
        dayKey,
        count: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      markerRef,
      {
        appId,
        lastSessionDayKey: dayKey,
        lastSessionAt: FieldValue.serverTimestamp(),
        sessionCount: FieldValue.increment(1),
      },
      { merge: true },
    );

    return {
      started: true,
      sessionId,
      appId,
      dayKey,
      remainingToday: Math.max(0, QUICK_TEST_DAILY_LIMIT - (usedToday || 0) - 1),
    };
  });
}

/** Guard + start, split out so the authorization wiring is testable too. */
async function startQuickTestSession(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");

  const outcome = await runStartQuickTest(db, { uid, appId });

  logger.info(
    "quick test start uid=" + uid + " app=" + appId +
      " started=" + outcome.started +
      (outcome.reason ? " reason=" + outcome.reason : ""),
  );
  return outcome;
}

// ---------------------------------------------------------------------------
// Completing a session
// ---------------------------------------------------------------------------

/**
 * Mark today's Quick Test for an app complete.
 *
 * `completedAt` is stamped server-side and only ever once — a second call is a
 * no-op rather than a way to rewrite the timestamp. The optional note is
 * length-capped and stored on the session itself; a richer feedback record
 * would live in its own collection, which this batch does not build (the
 * `feedbackId` field is reserved for it).
 */
async function runCompleteQuickTest(db, { uid, appId, note, now = Date.now() }) {
  const dayKey = utcDayKey(now);
  const sessionId = quickTestSessionId(uid, appId, dayKey);
  const sessionRef = db.doc("quickTestSessions/" + sessionId);

  return db.runTransaction(async (tx) => {
    const session = await tx.get(sessionRef);
    if (!session.exists) {
      throw new HttpsError(
        "not-found",
        "You haven't started a Quick Test for this app today.",
      );
    }
    // Ownership is implied by the deterministic id, but it is re-checked
    // rather than assumed: the id scheme is a convention, the field is data.
    if (session.get("uid") !== uid) {
      throw new HttpsError("permission-denied", "That session isn't yours.");
    }
    if (session.get("completedAt")) {
      return { completed: false, reason: "alreadyCompleted", sessionId, appId, dayKey };
    }

    const update = {
      completedAt: FieldValue.serverTimestamp(),
    };
    if (note) update.note = note;
    tx.update(sessionRef, update);

    return { completed: true, sessionId, appId, dayKey };
  });
}

async function completeQuickTestSession(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");
  const note = optionalString(
    request.data && request.data.note,
    "note",
    QUICK_TEST_NOTE_MAX_LENGTH,
  );

  return runCompleteQuickTest(db, { uid, appId, note });
}

// ---------------------------------------------------------------------------
// Discovery pool
// ---------------------------------------------------------------------------

/**
 * Rebuild the Quick Test discovery pool.
 *
 * The query is equality-only and unordered on purpose: adding an `orderBy`
 * would demand a composite index, and the candidate set is bounded by
 * QUICK_TEST_POOL_SCAN_LIMIT, so ordering in memory is both cheaper and one
 * less piece of deploy-time configuration to get wrong.
 *
 * Selected apps have `lastSurfacedAt` stamped, which is what pushes them to
 * the back of the next rotation.
 *
 * @returns {Promise<{appIds: Array<string>, candidates: number, poolSize: number}>}
 */
async function runPoolRefresh(db, { now = Date.now(), actorId = "system" } = {}) {
  const snap = await db
    .collection("apps")
    .where("status", "==", "approved")
    .where("quickTestEnabled", "==", true)
    .limit(QUICK_TEST_POOL_SCAN_LIMIT)
    .get();

  const candidates = snap.docs.map((doc) => ({
    appId: doc.id,
    lastSurfacedAtMillis: millisOf(doc.get("lastSurfacedAt")),
  }));

  const appIds = selectPoolAppIds({ candidates, poolSize: QUICK_TEST_POOL_SIZE });

  const batch = db.batch();
  batch.set(db.doc(QUICK_TEST_POOL_DOC), {
    appIds,
    size: appIds.length,
    candidateCount: candidates.length,
    refreshedAt: FieldValue.serverTimestamp(),
    refreshedBy: actorId,
  });
  for (const appId of appIds) {
    batch.set(
      db.doc("apps/" + appId),
      { lastSurfacedAt: new Date(now) },
      { merge: true },
    );
  }
  await batch.commit();

  logger.info(
    "quick test pool refreshed: " + appIds.length + " of " +
      candidates.length + " candidates",
  );
  return { appIds, candidates: candidates.length, poolSize: appIds.length };
}

// ---------------------------------------------------------------------------
// Exported callables / triggers
// ---------------------------------------------------------------------------

/**
 * Callable: start a Quick Test.
 *
 * Input is `{ appId }` only — there is deliberately no way for a caller to
 * influence the day key, the timestamps, their own limit, or their cooldown.
 */
const startQuickTest = onCall({ region: REGION }, (request) =>
  startQuickTestSession(getFirestore(), request),
);

/** Callable: mark today's Quick Test for an app complete. */
const completeQuickTest = onCall({ region: REGION }, (request) =>
  completeQuickTestSession(getFirestore(), request),
);

/** Admin-only manual pool refresh, for support and for seeding a new install. */
const adminRefreshQuickTestPool = onCall({ region: REGION }, async (request) => {
  const db = getFirestore();
  const uid = requireAuth(request);
  await requireAdmin(db, uid);
  return runPoolRefresh(db, { actorId: uid });
});

/**
 * Scheduled: rotate the pool hourly.
 *
 * Hourly rather than per-request because the pool is shared: recomputing it
 * per user would make "least recently surfaced" meaningless and would put a
 * scan on every Apps screen load.
 */
const refreshQuickTestPool = onSchedule(
  { region: REGION, schedule: "every 60 minutes" },
  async () => {
    await runPoolRefresh(getFirestore());
  },
);

module.exports = {
  startQuickTest,
  completeQuickTest,
  adminRefreshQuickTestPool,
  refreshQuickTestPool,
  // Exported for tests — no Functions runtime required.
  runStartQuickTest,
  startQuickTestSession,
  runCompleteQuickTest,
  completeQuickTestSession,
  runPoolRefresh,
  dayCounterPath,
  appMarkerPath,
};

/**
 * Read-only commitment status and member progress for the Android UI.
 *
 * WHY CALLABLES, NOT DIRECT READS
 * The assignment document alone cannot answer "how many days have I missed"
 * or "is this commitment still live": the miss count is deliberately never
 * stored while a commitment runs (it goes stale at every local midnight), and
 * a commitment past its third miss still reads `inProgress` until the sweep
 * settles it. Both answers need the testing logs, the declared outages and the
 * server clock - exactly what the settlements read. These callables run that
 * same derivation and return the result, so the app never has to compute an
 * authoritative number itself, and never shows "testing" for a commitment the
 * server has already judged lost.
 *
 * Member progress has a second reason: testers cannot read each other's
 * assignments or logs (see firestore.rules), and should not be able to. This
 * read returns a deliberately narrow, anonymous projection instead of widening
 * those rules.
 *
 * SECURITY MODEL
 *   * Read-only. Nothing here writes, so nothing here can move coins, record a
 *     day, change a status or touch capacity.
 *   * The subject is always the verified caller (`request.auth.uid`). There is
 *     no tester id in either request, so there is nothing to impersonate.
 *   * Every derived number comes from the same functions the settlements use:
 *     the log recount, `readMissEvidence` and `checkCommitmentExpiry`. A client
 *     value never reaches them - neither request carries one.
 *   * Member progress is refused unless the caller owns the app, currently
 *     holds one of its slots, or is an admin (role read fresh from Firestore).
 *
 * CONSISTENCY
 * Each read runs in a READ-ONLY transaction, so the assignment, its log count,
 * its miss evidence and the outage declarations all come from one snapshot. A
 * read-only transaction takes no locks: a check-in or a settlement racing this
 * read is never slowed or retried because of it.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore } = require("firebase-admin/firestore");

const { REGION, REQUIRED_TESTER_COUNT, COMMITMENT_DAYS_REQUIRED } = require("./lib/constants");
const { holdsCapacity } = require("./lib/commitments");
const { checkCommitmentExpiry } = require("./lib/expiry");
const { readMissEvidence } = require("./lib/misses");
const {
  isTerminalStatus,
  shapeCommitmentStatus,
  memberLabels,
  shapeMemberRow,
  canReadMemberProgress,
} = require("./lib/progress");
const { readOutageRecords } = require("./systemHealth");
const { requireAuth, requireDocId, loadUser } = require("./lib/guards");

function millisOf(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  return null;
}

/**
 * Derive one commitment's status inside an open read-only transaction.
 *
 * Mirrors `evaluateAssignmentExpiry` read for read - recounted logs, outages
 * over the stored window, miss evidence by point reads - so what the app shows
 * is what the next settlement would decide. A terminal commitment needs no
 * verdict: nothing can change it, and judging it against today's clock would
 * count every day since it ended as a miss.
 */
async function readCommitmentStatus(tx, db, snap, nowMillis) {
  const data = snap.data();
  const countSnap = await tx.get(
    db.collection("testingLogs").where("assignmentId", "==", snap.id).count(),
  );
  const qualifyingDays = countSnap.data().count;

  let verdict = null;
  if (!isTerminalStatus(data.status)) {
    const outageRecords = await readOutageRecords(db, {
      fromDayKey: data.firstEligibleDayKey,
      toDayKey: data.lastEligibleDayKey,
      tx,
    });
    const loggedDayKeys = await readMissEvidence({
      assignmentId: snap.id,
      allowedMisses: data.allowedMisses,
      timeZone: data.timeZone,
      firstEligibleDayKey: data.firstEligibleDayKey,
      lastEligibleDayKey: data.lastEligibleDayKey,
      appId: data.appId,
      outageRecords,
      nowMillis,
      read: (path) => tx.get(db.doc(path)),
    });
    verdict = checkCommitmentExpiry({
      status: data.status,
      lockTxId: data.lockTxId,
      appId: data.appId,
      timeZone: data.timeZone,
      firstEligibleDayKey: data.firstEligibleDayKey,
      lastEligibleDayKey: data.lastEligibleDayKey,
      qualifyingDays,
      daysRequired: data.daysRequired || COMMITMENT_DAYS_REQUIRED,
      outageRecords,
      nowMillis,
      allowedMisses: data.allowedMisses,
      loggedDayKeys,
    });
  }

  return shapeCommitmentStatus({
    assignmentId: snap.id,
    data,
    qualifyingDays,
    verdict,
    nowMillis,
  });
}

function readOnly(db, fn) {
  return db.runTransaction(fn, { readOnly: true });
}

// ---------------------------------------------------------------------------
// A. The caller's own commitment status
// ---------------------------------------------------------------------------

/**
 * With an `appId`: the caller's LATEST cycle for that app, live or settled, so
 * the app can show "completed" or "removed" rather than a stale "testing".
 * Null when the caller has never claimed it.
 *
 * Without one: every commitment of the caller's that is still open.
 *
 * `testerId` is the verified caller - the impl passes `request.auth.uid` and
 * nothing else.
 */
async function runCommitmentStatus(db, { testerId, appId = null, nowMillis = Date.now() }) {
  let query = db.collection("testingAssignments").where("testerId", "==", testerId);
  if (appId) query = query.where("appId", "==", appId);

  return readOnly(db, async (tx) => {
    const snap = await tx.get(query);
    if (appId) {
      const latest = snap.docs.reduce((best, d) => {
        if (!best) return d;
        const c = Number.isInteger(d.get("cycle")) ? d.get("cycle") : 0;
        const b = Number.isInteger(best.get("cycle")) ? best.get("cycle") : 0;
        return c > b ? d : best;
      }, null);
      return {
        commitment: latest ? await readCommitmentStatus(tx, db, latest, nowMillis) : null,
        serverNowMillis: nowMillis,
      };
    }

    const open = snap.docs
      .filter((d) => !isTerminalStatus(d.get("status")))
      .sort((x, y) => (millisOf(x.get("createdAt")) || 0) - (millisOf(y.get("createdAt")) || 0));
    const commitments = [];
    for (const d of open) commitments.push(await readCommitmentStatus(tx, db, d, nowMillis));
    return { commitments, serverNowMillis: nowMillis };
  });
}

async function getMyCommitmentStatusImpl(db, request) {
  const uid = requireAuth(request);
  const raw = request.data && request.data.appId;
  const appId = raw === undefined || raw === null ? null : requireDocId(raw, "appId");
  return runCommitmentStatus(db, { testerId: uid, appId });
}

// ---------------------------------------------------------------------------
// C. Member progress for one app's testing group
// ---------------------------------------------------------------------------

/**
 * Progress of every tester currently holding one of `appId`'s slots.
 *
 * The slot holders ARE the app's testing group (see REQUIRED_TESTER_COUNT):
 * a completed tester keeps their slot and stays listed; a cancelled or
 * forfeited one has given it back and does not.
 *
 * The authorization check runs before any member's progress is derived, and
 * a refusal is the same whether the app has members or not.
 */
async function runMemberProgress(db, { callerId, appId, nowMillis = Date.now() }) {
  const appSnap = await db.doc(`apps/${appId}`).get();
  if (!appSnap.exists) {
    throw new HttpsError("not-found", "That app does not exist.");
  }
  const caller = await loadUser(db, callerId);
  const isAdmin = caller.exists && caller.data.role === "admin" && caller.data.isSuspended !== true;

  const query = db.collection("testingAssignments").where("appId", "==", appId);

  return readOnly(db, async (tx) => {
    const snap = await tx.get(query);
    const members = snap.docs.filter((d) =>
      holdsCapacity({ capacityHeld: d.get("capacityHeld"), lockTxId: d.get("lockTxId") }),
    );

    const allowed = canReadMemberProgress({
      callerId,
      isAdmin,
      appOwnerId: appSnap.get("ownerId") || null,
      memberTesterIds: members.map((d) => d.get("testerId")),
    });
    if (!allowed) {
      throw new HttpsError(
        "permission-denied",
        "Only this app's developer and its current testers can see its progress.",
      );
    }

    const labels = memberLabels(members.map((d) => ({
      assignmentId: d.id,
      createdAtMillis: millisOf(d.get("createdAt")),
    })));

    const rows = [];
    for (const d of members) {
      const status = await readCommitmentStatus(tx, db, d, nowMillis);
      rows.push(shapeMemberRow({
        status,
        label: labels.get(d.id),
        isYou: d.get("testerId") === callerId,
      }));
    }
    rows.sort((x, y) => Number(x.label.slice(7)) - Number(y.label.slice(7)));

    return {
      appId,
      capacity: REQUIRED_TESTER_COUNT,
      memberCount: rows.length,
      members: rows,
      serverNowMillis: nowMillis,
    };
  });
}

async function getMemberProgressImpl(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");
  return runMemberProgress(db, { callerId: uid, appId });
}

/**
 * Callable: the caller's own commitment status. Input `{ appId? }`.
 */
const getMyCommitmentStatus = onCall({ region: REGION }, (request) =>
  getMyCommitmentStatusImpl(getFirestore(), request),
);

/**
 * Callable: anonymous progress of an app's current testers. Input `{ appId }`.
 */
const getMemberProgress = onCall({ region: REGION }, (request) =>
  getMemberProgressImpl(getFirestore(), request),
);

module.exports = {
  getMyCommitmentStatus,
  getMemberProgress,
  // Exported for tests - no Functions runtime required.
  getMyCommitmentStatusImpl,
  getMemberProgressImpl,
  runCommitmentStatus,
  runMemberProgress,
  readCommitmentStatus,
};

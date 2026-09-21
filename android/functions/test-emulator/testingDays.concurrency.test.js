/**
 * The 14-day testing engine, against a REAL Firestore.
 *
 * `test/testingDays.test.js` drives the same functions through a hand-written
 * fake. A fake can only prove the code matches my model of Firestore - it
 * cannot prove the model is right. These tests run the production check-in and
 * completion path against the emulator, so real transaction contention, real
 * document locking and real `tx.create` semantics are all exercised.
 *
 * The scenario that matters most is the FOURTEENTH day arriving twice at once.
 * That single request both records a day and returns 50 coins, so a race there
 * is the difference between a tester getting their stake back and getting it
 * back twice.
 *
 * Run with:
 *   firebase emulators:exec --only firestore --project apptesting-concurrency-test \
 *     "npm --prefix functions run test:emulator"
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const { runRecordTestingDay, evaluateWindowExpiry } = require("../testingDays");
const { runClaimCommitment, runForfeitCommitment } = require("../commitments");
const {
  cycleAssignmentId,
  activeClaimId,
  lockEntryId,
  unlockEntryId,
} = require("../lib/commitments");
const {
  dayKeyInZone,
  addDays,
  startOfLocalDayMillis,
  testingLogId,
  deriveWindow,
  nextCheckInAtMillis,
} = require("../lib/testingDays");
const { checkInvariants } = require("../lib/wallet");
const { COMMITMENT_DAYS_REQUIRED, COMMITMENT_WINDOW_DAYS } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const IST = "Asia/Kolkata";
const TESTER = "tester1";
const DEV = "dev1";
const APP = "appA";
const C1 = cycleAssignmentId(APP, TESTER, 1);

const walletPath = (uid = TESTER) => `users/${uid}/wallet/balance`;
const ledgerCollection = (uid = TESTER) => `users/${uid}/coinTransactions`;
const claimPath = (appId = APP, uid = TESTER) => `activeClaims/${activeClaimId(appId, uid)}`;
const assignmentPath = (id = C1) => `testingAssignments/${id}`;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.",
  );
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

async function clearFirestore() {
  const url =
    `http://${process.env.FIRESTORE_EMULATOR_HOST}` +
    `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear emulator: ${res.status}`);
}

/** A claimed commitment with a pinned IST window, `done` days already in. */
async function seedCommitment({ done = 0, status = "inProgress", available = 0, locked = 50 } = {}) {
  const window = deriveWindow({
    claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"),
    timeZone: IST,
  });
  const batch = db.batch();
  batch.set(db.doc(`users/${TESTER}`), { uid: TESTER });
  batch.set(db.doc(`users/${DEV}`), { uid: DEV });
  batch.set(db.doc(`apps/${APP}`), { ownerId: DEV, status: "approved", testerCount: 1 });
  batch.set(db.doc(assignmentPath()), {
    appId: APP,
    testerId: TESTER,
    developerId: DEV,
    cycle: 1,
    commitmentAmount: 50,
    daysRequired: COMMITMENT_DAYS_REQUIRED,
    windowDays: COMMITMENT_WINDOW_DAYS,
    timeZone: window.timeZone,
    timeZoneSource: "default",
    claimedDayKey: window.claimedDayKey,
    firstEligibleDayKey: window.firstEligibleDayKey,
    lastEligibleDayKey: window.lastEligibleDayKey,
    windowEndsAt: Timestamp.fromMillis(window.windowEndsAtMillis),
    creditedOutageDays: 0,
    qualifyingDays: done,
    daysCompleted: done,
    status,
    lockTxId: lockEntryId(C1),
    settlementTxId: null,
    createdAt: Timestamp.fromMillis(Date.parse("2026-03-01T06:00:00Z")),
  });
  batch.set(db.doc(claimPath()), {
    assignmentId: C1,
    appId: APP,
    testerId: TESTER,
    cycle: 1,
    commitmentAmount: 50,
  });
  batch.set(db.doc(walletPath()), {
    available,
    locked,
    forfeitedTotal: 0,
    purchasedTotal: 0,
    adjustmentNet: available + locked,
    ledgerCount: 2,
    schemaVersion: 2,
  });
  await batch.commit();
  return window;
}

/** Noon IST on the Nth eligible day (1-based). */
function atEligibleDay(n) {
  const window = deriveWindow({
    claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"),
    timeZone: IST,
  });
  const key = addDays(window.firstEligibleDayKey, n - 1);
  return startOfLocalDayMillis(key, IST) + 12 * 3600 * 1000;
}

const checkIn = (nowMillis, assignmentId = C1, testerId = TESTER) =>
  runRecordTestingDay(db, { assignmentId, testerId, nowMillis });

async function observe(uid = TESTER) {
  const [wallet, ledger, claims, assignment, logs] = await Promise.all([
    db.doc(walletPath(uid)).get(),
    db.collection(ledgerCollection(uid)).get(),
    db.collection("activeClaims").where("testerId", "==", uid).get(),
    db.doc(assignmentPath()).get(),
    db.collection("testingLogs").where("testerId", "==", uid).get(),
  ]);
  return {
    wallet: wallet.exists ? wallet.data() : null,
    ledgerIds: ledger.docs.map((d) => d.id).sort(),
    ledgerCount: ledger.size,
    claimCount: claims.size,
    status: assignment.get("status"),
    qualifyingDays: assignment.get("qualifyingDays"),
    settlementTxId: assignment.get("settlementTxId"),
    logIds: logs.docs.map((d) => d.id).sort(),
    logCount: logs.size,
  };
}

function assertInvariant(wallet, label = "") {
  const prefix = label ? `${label}: ` : "";
  assert.ok(wallet, `${prefix}wallet missing`);
  const check = checkInvariants({
    available: wallet.available,
    locked: wallet.locked,
    forfeitedTotal: wallet.forfeitedTotal,
    purchasedTotal: wallet.purchasedTotal,
    adjustmentNet: wallet.adjustmentNet,
  });
  assert.equal(check.ok, true, prefix + check.errors.join("; "));
}

async function settled(promises) {
  const results = await Promise.allSettled(promises);
  return {
    ok: results.filter((r) => r.status === "fulfilled"),
    recorded: results.filter((r) => r.status === "fulfilled" && r.value.recorded),
    completed: results.filter((r) => r.status === "fulfilled" && r.value.completed),
    rejected: results.filter((r) => r.status === "rejected"),
  };
}

test.beforeEach(clearFirestore);
test.after(async () => {
  await Promise.all(admin.apps.map((app) => app && app.delete()));
});

// ---------------------------------------------------------------------------
// The happy path, for real
// ---------------------------------------------------------------------------

test("a check-in creates one log bound to the cycle and advances progress", async () => {
  await seedCommitment();
  const out = await checkIn(atEligibleDay(1));

  assert.equal(out.recorded, true);
  assert.equal(out.qualifyingDays, 1);
  assert.equal(out.dayKey, "2026-03-02");

  const state = await observe();
  assert.deepEqual(state.logIds, [testingLogId(C1, "2026-03-02")]);
  assert.equal(state.qualifyingDays, 1);
  assert.equal(state.status, "inProgress");
  assert.equal(state.wallet.locked, 50, "coins stay committed mid-window");

  const log = await db.doc(`testingLogs/${testingLogId(C1, "2026-03-02")}`).get();
  assert.equal(log.get("cycle"), 1);
  assert.equal(log.get("timeZone"), IST);
  assert.ok(log.get("createdAt") instanceof Timestamp);
});

test("fourteen days complete the commitment and return exactly 50 coins", async () => {
  await seedCommitment();
  let last;
  for (let day = 1; day <= 14; day += 1) last = await checkIn(atEligibleDay(day));

  assert.equal(last.completed, true);
  assert.equal(last.unlockedAmount, 50);

  const state = await observe();
  assert.equal(state.logCount, 14);
  assert.equal(state.qualifyingDays, 14);
  assert.equal(state.status, "completed");
  assert.equal(state.settlementTxId, unlockEntryId(C1));
  assert.equal(state.claimCount, 0, "the active claim is released");
  assert.equal(state.wallet.available, 50, "the SAME coins, back");
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.wallet.adjustmentNet, 50, "no coins were created");
  assertInvariant(state.wallet);
  assert.deepEqual(state.ledgerIds, [unlockEntryId(C1)]);
});

// ---------------------------------------------------------------------------
// F. Concurrency
// ---------------------------------------------------------------------------

test("F: two simultaneous check-ins for the same day record exactly one", async () => {
  await seedCommitment();
  const { recorded } = await settled([checkIn(atEligibleDay(1)), checkIn(atEligibleDay(1))]);
  assert.equal(recorded.length, 1);

  const state = await observe();
  assert.equal(state.logCount, 1, "exactly one testing log");
  assert.equal(state.qualifyingDays, 1, "exactly one increment");
  assertInvariant(state.wallet);
});

test("F: ten concurrent duplicate calls produce one log, one increment, no settlement", async () => {
  await seedCommitment();
  const calls = Array.from({ length: 10 }, () => checkIn(atEligibleDay(1)));
  const { recorded } = await settled(calls);
  assert.equal(recorded.length, 1, "exactly one may report a recording");

  const state = await observe();
  assert.equal(state.logCount, 1);
  assert.equal(state.qualifyingDays, 1);
  assert.equal(state.ledgerCount, 0, "no coins move on a non-final day");
  assert.equal(state.wallet.locked, 50);
  assertInvariant(state.wallet);
});

test("F: two simultaneous FINAL-day calls unlock exactly once", async () => {
  await seedCommitment({ done: 13 });
  const { completed } = await settled([checkIn(atEligibleDay(14)), checkIn(atEligibleDay(14))]);
  assert.equal(completed.length, 1, "exactly one completion");

  const state = await observe();
  assert.equal(state.wallet.available, 50, "50, never 100");
  assert.equal(state.wallet.locked, 0, "and never negative");
  assert.equal(state.ledgerIds.filter((id) => id.startsWith("unlock_")).length, 1);
  assert.equal(state.qualifyingDays, 14);
  assert.equal(state.claimCount, 0);
  assertInvariant(state.wallet);
});

test("F: the final-day race holds across 10 independent rounds", async () => {
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 13 });

    const { completed } = await settled([
      checkIn(atEligibleDay(14)),
      checkIn(atEligibleDay(14)),
      checkIn(atEligibleDay(14)),
    ]);
    assert.equal(completed.length, 1, `round ${round}: more than one completion`);

    const state = await observe();
    assert.equal(state.wallet.available, 50, `round ${round}: balance drifted`);
    assert.equal(state.wallet.locked, 0, `round ${round}`);
    assert.equal(state.logCount, 1, `round ${round}: duplicate log`);
    assert.equal(
      state.ledgerIds.filter((id) => id.startsWith("unlock_")).length,
      1,
      `round ${round}: duplicate unlock`,
    );
    assertInvariant(state.wallet, `round ${round}`);
  }
});

test("F: ten concurrent FINAL-day calls still settle exactly once", async () => {
  await seedCommitment({ done: 13 });
  const calls = Array.from({ length: 10 }, () => checkIn(atEligibleDay(14)));
  const { completed } = await settled(calls);
  assert.equal(completed.length, 1);

  const state = await observe();
  assert.equal(state.wallet.available, 50);
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.ledgerCount, 1);
  assertInvariant(state.wallet);
});

test("F: completion racing a competing write to the assignment stays correct", async () => {
  await seedCommitment({ done: 13 });

  // Churn the assignment so the check-in transaction's read set goes stale and
  // Firestore has to abort and re-run it.
  const churn = [];
  for (let i = 0; i < 15; i += 1) {
    churn.push(db.doc(assignmentPath()).update({ churn: i }));
  }
  const [outcome] = await Promise.all([checkIn(atEligibleDay(14)), Promise.allSettled(churn)]);

  assert.equal(outcome.completed, true);
  const state = await observe();
  assert.equal(state.wallet.available, 50);
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.status, "completed");
  assertInvariant(state.wallet);
});

test("F: completion racing the forfeiture path leaves one valid terminal outcome", async () => {
  // The window has closed at 13 days, so forfeiture is legitimately available.
  // A final check-in is impossible then (the window is shut), so the race that
  // matters is completion-then-forfeit: whichever lands first must make the
  // other impossible, and the wallet must stay sound either way.
  await seedCommitment({ done: 13 });
  const afterWindow = startOfLocalDayMillis("2026-03-20", IST) + 3600 * 1000;

  // A check-in after the window is refused outright.
  await assert.rejects(checkIn(afterWindow), /window has closed/);

  // Forfeiture is then the only terminal move, and it happens exactly once.
  const results = await Promise.allSettled([
    runForfeitCommitment(db, { assignmentId: C1, actorId: "system", actorKind: "system" }),
    runForfeitCommitment(db, { assignmentId: C1, actorId: "system", actorKind: "system" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);

  const state = await observe();
  assert.equal(state.status, "failed");
  assert.equal(state.wallet.forfeitedTotal, 50, "50, never 100");
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.wallet.available, 0, "no partial refund");
  assert.equal(state.claimCount, 0);
  assertInvariant(state.wallet);
});

test("F: a completed commitment can never then be forfeited", async () => {
  await seedCommitment({ done: 13 });
  await checkIn(atEligibleDay(14));

  await assert.rejects(
    runForfeitCommitment(db, { assignmentId: C1, actorId: "system", actorKind: "system" }),
    /already been settled/,
  );

  const state = await observe();
  assert.equal(state.wallet.available, 50, "the returned coins stay returned");
  assert.equal(state.wallet.forfeitedTotal, 0);
  assertInvariant(state.wallet);
});

// ---------------------------------------------------------------------------
// G. Window behaviour against real data
// ---------------------------------------------------------------------------

test("G: a check-in on the claim day is refused — day 1 is the next full day", async () => {
  await seedCommitment();
  const onClaimDay = startOfLocalDayMillis("2026-03-01", IST) + 20 * 3600 * 1000;
  await assert.rejects(checkIn(onClaimDay), /starts tomorrow/);

  const state = await observe();
  assert.equal(state.logCount, 0);
  assert.equal(state.qualifyingDays, 0);
});

test("G: the last eligible day still works, the day after does not", async () => {
  await seedCommitment({ done: 5 });
  const lastDay = await checkIn(atEligibleDay(COMMITMENT_WINDOW_DAYS));
  assert.equal(lastDay.recorded, true);
  assert.equal(lastDay.dayKey, "2026-03-19");

  const afterWindow = startOfLocalDayMillis("2026-03-20", IST) + 3600 * 1000;
  await assert.rejects(checkIn(afterWindow), /window has closed/);
});

test("G: missing four days still completes — the flex budget is real", async () => {
  await seedCommitment();
  const skipped = new Set([2, 6, 10, 14]);
  let last;
  for (let day = 1; day <= 18; day += 1) {
    if (skipped.has(day)) continue;
    last = await checkIn(atEligibleDay(day));
  }
  assert.equal(last.completed, true);

  const state = await observe();
  assert.equal(state.logCount, 14);
  assert.equal(state.wallet.available, 50);
  assertInvariant(state.wallet);
});

test("G: 13 days across the whole window leaves the stake locked and expiry eligible", async () => {
  await seedCommitment();
  for (let day = 1; day <= 13; day += 1) await checkIn(atEligibleDay(day));

  const state = await observe();
  assert.equal(state.qualifyingDays, 13);
  assert.equal(state.status, "inProgress");
  assert.equal(state.wallet.locked, 50);

  const afterWindow = startOfLocalDayMillis("2026-03-21", IST);
  const verdict = await evaluateWindowExpiry(db, { assignmentId: C1, nowMillis: afterWindow });
  assert.equal(verdict.expired, true);
  assert.equal(verdict.reason, "windowClosedShort");
});

test("G: 14 days is never expiry-eligible, even long after the window", async () => {
  await seedCommitment({ done: 13 });
  await checkIn(atEligibleDay(14));

  const longAfter = startOfLocalDayMillis("2026-05-01", IST);
  const verdict = await evaluateWindowExpiry(db, { assignmentId: C1, nowMillis: longAfter });
  assert.equal(verdict.expired, false);
  assert.equal(verdict.reason, "alreadySettled");
});

test("G: the evaluator is read-only", async () => {
  await seedCommitment({ done: 2 });
  const before = await observe();
  const afterWindow = startOfLocalDayMillis("2026-03-25", IST);
  const verdict = await evaluateWindowExpiry(db, { assignmentId: C1, nowMillis: afterWindow });

  assert.equal(verdict.expired, true);
  const after = await observe();
  assert.deepEqual(after.wallet, before.wallet, "it moves no coins");
  assert.equal(after.status, before.status, "and changes no state");
});

// ---------------------------------------------------------------------------
// End-to-end: claim, test, complete, re-claim
// ---------------------------------------------------------------------------

test("a real claim pins a usable window and the cycle runs to completion", async () => {
  // Uses the production claim path rather than a hand-seeded assignment, so
  // the window this test exercises is the one the claim actually writes.
  const batch = db.batch();
  batch.set(db.doc(`users/${TESTER}`), { uid: TESTER });
  batch.set(db.doc(`users/${DEV}`), { uid: DEV });
  batch.set(db.doc(`apps/${APP}`), { ownerId: DEV, status: "approved", testerCount: 0 });
  batch.set(db.doc(walletPath()), {
    available: 50,
    locked: 0,
    forfeitedTotal: 0,
    purchasedTotal: 0,
    adjustmentNet: 50,
    ledgerCount: 1,
    schemaVersion: 2,
  });
  await batch.commit();

  const claim = await runClaimCommitment(db, { appId: APP, testerId: TESTER });
  const a = await db.doc(assignmentPath(claim.assignmentId)).get();
  const tz = a.get("timeZone");
  assert.equal(tz, "Asia/Kolkata", "the documented India-first default");
  assert.equal(a.get("timeZoneSource"), "default");

  const firstEligible = a.get("firstEligibleDayKey");
  const claimedDay = a.get("claimedDayKey");
  assert.equal(addDays(claimedDay, 1), firstEligible, "day 1 is the next full local day");

  // Walk the real window to completion.
  let last;
  for (let day = 0; day < COMMITMENT_DAYS_REQUIRED; day += 1) {
    const key = addDays(firstEligible, day);
    last = await runRecordTestingDay(db, {
      assignmentId: claim.assignmentId,
      testerId: TESTER,
      nowMillis: startOfLocalDayMillis(key, tz) + 9 * 3600 * 1000,
    });
  }
  assert.equal(last.completed, true);

  const wallet = (await db.doc(walletPath()).get()).data();
  assert.equal(wallet.available, 50, "the stake returns intact");
  assert.equal(wallet.locked, 0);
  assertInvariant(wallet);

  // And the app is free for a fresh cycle, which gets its own window.
  const second = await runClaimCommitment(db, { appId: APP, testerId: TESTER });
  assert.equal(second.cycle, 2);
  const b = await db.doc(assignmentPath(second.assignmentId)).get();
  assert.ok(b.get("firstEligibleDayKey"), "cycle 2 pins its own window");
  assert.equal(b.get("qualifyingDays"), 0, "and starts from zero");
});

test("a cycle-1 log never counts toward cycle 2", async () => {
  await seedCommitment({ done: 13 });
  await checkIn(atEligibleDay(14));

  // Re-claim for a second cycle.
  const second = await runClaimCommitment(db, { appId: APP, testerId: TESTER });
  const b = await db.doc(assignmentPath(second.assignmentId)).get();
  assert.equal(b.get("qualifyingDays"), 0);

  const firstEligible = b.get("firstEligibleDayKey");
  const out = await runRecordTestingDay(db, {
    assignmentId: second.assignmentId,
    testerId: TESTER,
    nowMillis: startOfLocalDayMillis(firstEligible, IST) + 9 * 3600 * 1000,
  });
  assert.equal(out.qualifyingDays, 1, "cycle 2 starts at one, not fifteen");

  // Both cycles' logs coexist, distinctly identified.
  const logs = await db.collection("testingLogs").where("testerId", "==", TESTER).get();
  const cycles = logs.docs.map((d) => d.get("cycle")).sort();
  assert.equal(cycles.filter((c) => c === 1).length, 1);
  assert.equal(cycles.filter((c) => c === 2).length, 1);
});

// ---------------------------------------------------------------------------
// N. The check-in boundary, against real Firestore
//
// The pure arithmetic is proven in test/testingDays.test.js. What only the
// emulator can prove is that the instant survives a real Timestamp round trip
// with no precision lost - the client reads this field to decide whether to
// render "Logged today", and a boundary off by even a second would put the
// button back on the wrong side of local midnight.
// ---------------------------------------------------------------------------

test("N: the check-in boundary round-trips as a real Firestore Timestamp", async () => {
  await seedCommitment();
  const out = await checkIn(atEligibleDay(1));
  assert.equal(out.dayKey, "2026-03-02");

  const assignment = await db.doc(`testingAssignments/${C1}`).get();
  const stored = assignment.get("nextCheckInAt");
  assert.ok(stored instanceof Timestamp, "it must be a real Timestamp, not a number");
  assert.equal(
    stored.toMillis(),
    nextCheckInAtMillis("2026-03-02", IST),
    "and survive the round trip exactly",
  );
  assert.equal(stored.toMillis(), out.nextCheckInAtMillis);

  // It is IST midnight opening the next day - 18:30 UTC, not 00:00 UTC.
  assert.equal(dayKeyInZone(stored.toMillis(), IST), "2026-03-03");
  assert.equal(dayKeyInZone(stored.toMillis() - 1, IST), "2026-03-02");
  assert.equal(stored.toMillis(), startOfLocalDayMillis("2026-03-03", IST));
});

test("N: the stored boundary is what makes 'logged today' survive UTC midnight", async () => {
  await seedCommitment();
  // Log at 22:00 IST on the first eligible day.
  await checkIn(startOfLocalDayMillis("2026-03-02", IST) + 22 * 3600 * 1000);

  const boundary = (await db.doc(`testingAssignments/${C1}`).get())
    .get("nextCheckInAt")
    .toMillis();

  // 02:00 IST the SAME local day the log belongs to is past UTC midnight but
  // before the boundary - so a client renders "Logged today", correctly.
  const sameIstDayPastUtcMidnight = startOfLocalDayMillis("2026-03-02", IST) + 2 * 3600 * 1000;
  assert.equal(dayKeyInZone(sameIstDayPastUtcMidnight, "UTC"), "2026-03-01", "UTC disagrees");
  assert.equal(dayKeyInZone(sameIstDayPastUtcMidnight, IST), "2026-03-02", "IST is authoritative");
  assert.ok(sameIstDayPastUtcMidnight < boundary, "the client must still show it as logged");

  // And the server agrees: a second call on that IST day changes nothing.
  const repeat = await checkIn(startOfLocalDayMillis("2026-03-02", IST) + 23 * 3600 * 1000);
  assert.equal(repeat.alreadyLogged, true, "duplicate protection stays server-side");
  assert.equal(repeat.nextCheckInAtMillis, boundary);

  const state = await observe();
  assert.equal(state.qualifyingDays, 1, "no double count");
  assert.equal(state.logCount, 1);
  assert.equal(state.wallet.locked, 50);
  assertInvariant(state.wallet);
});

test("N: each new day advances the stored boundary by exactly one local day", async () => {
  await seedCommitment();
  for (let day = 1; day <= 3; day += 1) {
    await checkIn(atEligibleDay(day));
    const key = addDays("2026-03-02", day - 1);
    const stored = (await db.doc(`testingAssignments/${C1}`).get()).get("nextCheckInAt");
    assert.equal(
      stored.toMillis(),
      nextCheckInAtMillis(key, IST),
      `after day ${day}, the boundary is local midnight after ${key}`,
    );
  }
  const state = await observe();
  assert.equal(state.qualifyingDays, 3);
  assert.equal(state.logCount, 3);
});

test("N: concurrent same-day check-ins leave exactly one boundary", async () => {
  await seedCommitment();
  const when = atEligibleDay(1);
  const outcome = await settled(Array.from({ length: 8 }, () => checkIn(when)));

  assert.equal(outcome.recorded.length, 1, "exactly one call records the day");
  const stored = (await db.doc(`testingAssignments/${C1}`).get()).get("nextCheckInAt");
  assert.equal(stored.toMillis(), nextCheckInAtMillis("2026-03-02", IST));

  const state = await observe();
  assert.equal(state.qualifyingDays, 1);
  assert.equal(state.logCount, 1);
  assertInvariant(state.wallet);
});

test("N: the completing 14th day stamps a boundary and returns exactly 50", async () => {
  await seedCommitment();
  let last;
  for (let day = 1; day <= 14; day += 1) last = await checkIn(atEligibleDay(day));

  assert.equal(last.completed, true);
  assert.equal(last.unlockedAmount, 50);
  const stored = (await db.doc(`testingAssignments/${C1}`).get()).get("nextCheckInAt");
  assert.equal(stored.toMillis(), nextCheckInAtMillis("2026-03-15", IST));

  const state = await observe();
  assert.equal(state.wallet.available, 50, "the SAME coins, back");
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.wallet.adjustmentNet, 50, "no coins were created");
  assertInvariant(state.wallet);
});

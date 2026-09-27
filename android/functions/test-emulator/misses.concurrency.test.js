/**
 * The Batch 9A product rules on a real Firestore: 16 slots, a 16-day window,
 * 14 required days, and removal at the third miss.
 *
 * Nothing here seeds an assignment. Every commitment is created by the real
 * claim transaction from a wallet funded by the real admin grant, so the
 * `windowDays`, `allowedMisses` and `removalCheckAt` under test are the ones
 * production code writes. Days are then recorded by the real check-in
 * callable impl, and settled by the real sweep, cancellation and forfeiture,
 * each run at a chosen SERVER clock (`nowMillis`) - the same parameter the
 * scheduler and callables pass, never a client value.
 *
 * Run through `firebase emulators:exec` - see README.md.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
// Pre-9D fixtures made join-ready the real way; see test/joinReady.js.
const { readyAppDoc, seedJoinReady } = require("../test/joinReady");

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const { runAdminGrant, runWalletReconciliation } = require("../wallet");
const { runClaimCommitment, runCancelCommitment } = require("../commitments");
const { runRecordTestingDay } = require("../testingDays");
const { runExpirySweep } = require("../expiry");
const { forfeitEntryId, cancelEntryId, unlockEntryId } = require("../lib/commitments");
const { addDays, startOfLocalDayMillis } = require("../lib/testingDays");
const { checkInvariants } = require("../lib/wallet");
const { REQUIRED_TESTER_COUNT } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const APP = "app1";
const DEV = "dev1";
const ADMIN = "admin1";
const TESTER = "tester1";
const HOUR = 3600 * 1000;

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

test.beforeEach(clearFirestore);

// ---------------------------------------------------------------------------
// Real setup: an admin, a developer's approved app, funded testers, claims
// ---------------------------------------------------------------------------

async function seedWorld({ testerCount = 0 } = {}) {
  await db.doc(`users/${ADMIN}`).set({ uid: ADMIN, role: "admin" });
  await db.doc(`users/${DEV}`).set({ uid: DEV });
  await db.doc(`apps/${APP}`).set(readyAppDoc(APP, { ownerId: DEV, status: "approved", testerCount }));
}

/** Fund a tester with a real admin grant - a ledger entry and a folded wallet. */
async function fund(uid, amount = 50) {
  await db.doc(`users/${uid}`).set({ uid });
  await seedJoinReady(db, uid);
  await runAdminGrant(db, {
    targetUserId: uid,
    amount,
    reason: "miss-rule emulator test",
    idempotencyKey: `seed_${uid}`,
    adminUid: ADMIN,
  });
}

/** Claim through the real transaction and return the assignment it wrote. */
async function claim(uid = TESTER) {
  const out = await runClaimCommitment(db, { appId: APP, testerId: uid });
  const snap = await db.doc(`testingAssignments/${out.assignmentId}`).get();
  return { id: out.assignmentId, a: snap.data() };
}

/** Local noon (or `hours`) on eligible day `n` of this commitment's pinned window. */
function clockFor(a) {
  const dayKey = (n) => addDays(a.firstEligibleDayKey, n - 1);
  return {
    dayKey,
    at: (n, hours = 12) => startOfLocalDayMillis(dayKey(n), a.timeZone) + hours * HOUR,
    startOf: (n) => startOfLocalDayMillis(dayKey(n), a.timeZone),
  };
}

const checkIn = (id, nowMillis, uid = TESTER) =>
  runRecordTestingDay(db, { assignmentId: id, testerId: uid, nowMillis });
const cancel = (id, nowMillis, uid = TESTER) =>
  runCancelCommitment(db, { assignmentId: id, actorId: uid, actorKind: "user", nowMillis });
const sweep = (nowMillis) => runExpirySweep(db, { nowMillis });

/** Check in on every eligible day in 1..`through` except `skip`. */
async function checkInDays(id, clock, through, skip = []) {
  for (let n = 1; n <= through; n += 1) {
    if (!skip.includes(n)) await checkIn(id, clock.at(n));
  }
}

async function observe(id, uid = TESTER) {
  const [a, wallet, app, ledger, claims] = await Promise.all([
    db.doc(`testingAssignments/${id}`).get(),
    db.doc(`users/${uid}/wallet/balance`).get(),
    db.doc(`apps/${APP}`).get(),
    db.collection(`users/${uid}/coinTransactions`).get(),
    db.collection("activeClaims").where("assignmentId", "==", id).get(),
  ]);
  return {
    a: a.data(),
    wallet: wallet.data(),
    testerCount: app.get("testerCount"),
    ledger: ledger.docs.map((d) => ({ id: d.id, ...d.data() })),
    claimCount: claims.size,
  };
}

async function assertReconciled(uid = TESTER, label = "") {
  const report = await runWalletReconciliation(db, { userId: uid });
  assert.equal(report.matches, true, `${label}: ${JSON.stringify(report.differences)}`);
  const w = (await db.doc(`users/${uid}/wallet/balance`).get()).data();
  assert.equal(checkInvariants(w).ok, true, `${label}: wallet invariant`);
}

const settledOnce = (ledger, kind) => ledger.filter((e) => e.kind === kind).length;

// ---------------------------------------------------------------------------
// 1-3. Capacity: 16 slots
// ---------------------------------------------------------------------------

test("1-2: the 16th real claim succeeds and the 17th is refused, taking nothing", async () => {
  assert.equal(REQUIRED_TESTER_COUNT, 16);
  await seedWorld();
  const testers = Array.from({ length: 17 }, (_, i) => `t${i + 1}`);
  for (const t of testers) await fund(t);

  for (const t of testers.slice(0, 16)) await claim(t);
  assert.equal((await db.doc(`apps/${APP}`).get()).get("testerCount"), 16);

  await assert.rejects(claim("t17"), /all the testers it needs/);
  assert.equal((await db.doc(`apps/${APP}`).get()).get("testerCount"), 16);
  const w17 = (await db.doc("users/t17/wallet/balance").get()).data();
  assert.equal(w17.available, 50);
  assert.equal(w17.locked, 0);
});

test("3: concurrent claims for the 16th slot admit exactly one, across 5 rounds", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await seedWorld({ testerCount: 15 });
    const racers = ["r1", "r2", "r3", "r4"];
    for (const r of racers) await fund(r);

    const results = await Promise.allSettled(racers.map((r) => claim(r)));
    const winners = results.filter((r) => r.status === "fulfilled");
    assert.equal(winners.length, 1, `round ${round}: one winner`);
    for (const r of results) {
      if (r.status === "rejected") assert.match(r.reason.message, /all the testers it needs/);
    }
    assert.equal((await db.doc(`apps/${APP}`).get()).get("testerCount"), 16, `round ${round}`);
  }
});

test("3b: eight racers for the last slot - every loser hears 'full' and keeps every coin", async () => {
  // Batch 9F. A losing racer used to fail, now and then, with the emulator's
  // "Transaction is invalid or closed" from a query inside the claim
  // transaction. The claim now reads by id only, so a loser must retry into the
  // real answer. Eight racers per round push contention well past test 3's four.
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await seedWorld({ testerCount: REQUIRED_TESTER_COUNT - 1 });
    const racers = Array.from({ length: 8 }, (_, i) => `x${i + 1}`);
    for (const r of racers) await fund(r);

    const results = await Promise.allSettled(racers.map((r) => claim(r)));
    const winners = racers.filter((_, i) => results[i].status === "fulfilled");
    assert.equal(winners.length, 1, `round ${round}: exactly one winner`);
    results.forEach((r, i) => {
      if (r.status === "rejected") {
        assert.match(r.reason.message, /all the testers it needs/, `round ${round}: ${racers[i]} got a business answer`);
      }
    });
    assert.equal(
      (await db.doc(`apps/${APP}`).get()).get("testerCount"),
      REQUIRED_TESTER_COUNT,
      `round ${round}: the cap holds exactly`,
    );

    for (const r of racers) {
      const w = (await db.doc(`users/${r}/wallet/balance`).get()).data();
      const won = r === winners[0];
      assert.equal(w.available, won ? 0 : 50, `round ${round}: ${r} available`);
      assert.equal(w.locked, won ? 50 : 0, `round ${round}: ${r} locked`);
      assert.equal(checkInvariants(w).ok, true, `round ${round}: ${r} wallet invariant`);
      // A loser leaves no lock entry and no active claim behind.
      const locks = await db.collection(`users/${r}/coinTransactions`).where("kind", "==", "lock").get();
      assert.equal(locks.size, won ? 1 : 0, `round ${round}: ${r} lock entries`);
    }
  }
});

// ---------------------------------------------------------------------------
// 4-7. Settlement outcomes and what they do to the slot
// ---------------------------------------------------------------------------

test("a real claim pins 16/14/2 on the emulator", async () => {
  await seedWorld();
  await fund(TESTER);
  const { a } = await claim();
  assert.equal(a.windowDays, 16);
  assert.equal(a.daysRequired, 14);
  assert.equal(a.allowedMisses, 2);
  assert.equal(addDays(a.firstEligibleDayKey, 15), a.lastEligibleDayKey);
  assert.equal(a.capacityHeld, true);
  assert.equal(
    a.removalCheckAt.toMillis(),
    startOfLocalDayMillis(addDays(a.firstEligibleDayKey, 3), a.timeZone),
  );
});

test("4: cancellation at 2 misses returns the stake and releases the slot", async () => {
  await seedWorld({ testerCount: 3 });
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  await checkInDays(id, clock, 6, [2, 5]);

  await cancel(id, clock.at(7));
  const o = await observe(id);
  assert.equal(o.a.status, "cancelled");
  assert.equal(o.testerCount, 3, "4 while held, back to 3");
  assert.equal(o.a.capacityHeld, false);
  assert.equal(o.wallet.available, 50);
  await assertReconciled(TESTER, "cancel");
});

test("5+7: the third miss forfeits exactly once and releases exactly one slot", async () => {
  await seedWorld({ testerCount: 7 });
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  // Days 3 and 5 missed, the tester stops after day 6, so day 7 is the third.
  await checkInDays(id, clock, 6, [3, 5]);
  assert.equal((await observe(id)).testerCount, 8);

  // Day 8: days 3, 5 and 7 have been missed.
  const summary = await sweep(clock.at(8));
  assert.equal(summary.forfeitedCount, 1);

  const o = await observe(id);
  assert.equal(o.a.status, "failed");
  assert.equal(o.a.failureReason, "tooManyMisses");
  assert.equal(o.a.missedDays, 3);
  assert.equal(o.a.qualifyingDays, 4);
  assert.equal(o.a.capacityHeld, false);
  assert.equal(o.testerCount, 7, "exactly one slot released");
  assert.equal(o.claimCount, 0, "the active claim is closed");
  assert.equal(settledOnce(o.ledger, "forfeit"), 1);
  assert.equal(o.wallet.locked, 0);
  assert.equal(o.wallet.forfeitedTotal, 50);
  await assertReconciled(TESTER, "third miss");
});

test("6: completion at 14 days with 2 misses keeps the slot", async () => {
  await seedWorld({ testerCount: 2 });
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  await checkInDays(id, clock, 16, [4, 11]);

  const o = await observe(id);
  assert.equal(o.a.status, "completed");
  assert.equal(o.a.qualifyingDays, 14);
  assert.equal(o.a.capacityHeld, true, "a finished tester keeps their slot");
  assert.equal(o.testerCount, 3);
  assert.equal(settledOnce(o.ledger, "unlock"), 1);
  assert.equal(o.wallet.available, 50);
  await assertReconciled(TESTER, "completion");

  // A later sweep never turns a completion into a failure.
  await sweep(clock.startOf(20));
  assert.equal((await observe(id)).a.status, "completed");
});

test("a freed slot from a third-miss removal can be taken by a new tester", async () => {
  await seedWorld({ testerCount: 15 });
  await fund(TESTER);
  await fund("replacement");
  const { id, a } = await claim();
  const clock = clockFor(a);
  assert.equal((await observe(id)).testerCount, 16);
  await assert.rejects(claim("replacement"), /all the testers it needs/);

  await sweep(clock.startOf(4)); // days 1-3 all missed
  assert.equal((await observe(id)).testerCount, 15);
  await claim("replacement");
  assert.equal((await db.doc(`apps/${APP}`).get()).get("testerCount"), 16);
});

// ---------------------------------------------------------------------------
// 8. Sweep vs check-in
// ---------------------------------------------------------------------------

test("8: at 2 misses, a check-in racing the sweep is recorded and nothing is forfeited (5 rounds)", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await seedWorld({ testerCount: 1 });
    await fund(TESTER);
    const { id, a } = await claim();
    const clock = clockFor(a);
    await checkInDays(id, clock, 5, [2, 4]);

    const [c, s] = await Promise.allSettled([checkIn(id, clock.at(6)), sweep(clock.at(6))]);
    assert.equal(c.status, "fulfilled", `round ${round}: check-in`);
    assert.equal(c.value.recorded, true);
    assert.equal(s.value.forfeitedCount, 0, `round ${round}: no forfeiture`);

    const o = await observe(id);
    assert.equal(o.a.status, "inProgress");
    assert.equal(o.a.qualifyingDays, 4);
    assert.equal(o.wallet.locked, 50);
  }
});

test("8: at 3 misses, a check-in racing the sweep is refused and the forfeit lands once (5 rounds)", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await seedWorld({ testerCount: 4 });
    await fund(TESTER);
    const { id, a } = await claim();
    const clock = clockFor(a);
    await checkInDays(id, clock, 6, [2, 4, 6]);

    const results = await Promise.allSettled([
      checkIn(id, clock.at(7)),
      sweep(clock.at(7)),
      sweep(clock.at(7)),
    ]);
    assert.equal(results[0].status, "rejected", `round ${round}: the check-in cannot revive it`);
    assert.match(results[0].reason.message, /missed more testing days|already failed/);

    const o = await observe(id);
    assert.equal(o.a.status, "failed");
    assert.equal(o.a.failureReason, "tooManyMisses");
    assert.equal(o.a.qualifyingDays, 3, `round ${round}: no day was added`);
    assert.equal(settledOnce(o.ledger, "forfeit"), 1, `round ${round}: one forfeit`);
    assert.equal(o.testerCount, 4, `round ${round}: one release`);
    await assertReconciled(TESTER, `round ${round}`);
  }
});

// ---------------------------------------------------------------------------
// 9. Third miss vs cancellation
// ---------------------------------------------------------------------------

test("9: after the third miss, racing cancels and sweeps always settle as ONE forfeit (5 rounds)", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await seedWorld({ testerCount: 6 });
    await fund(TESTER);
    const { id, a } = await claim();
    const clock = clockFor(a);
    await checkInDays(id, clock, 5, [1, 3, 5]);

    const results = await Promise.allSettled([
      cancel(id, clock.at(6)),
      sweep(clock.at(6)),
      cancel(id, clock.at(6, 18)),
      sweep(clock.at(6, 18)),
    ]);
    for (const i of [0, 2]) {
      assert.equal(results[i].status, "rejected", `round ${round}: a cancel escaped the forfeit`);
    }

    const o = await observe(id);
    assert.equal(o.a.status, "failed", `round ${round}`);
    assert.equal(settledOnce(o.ledger, "forfeit"), 1);
    assert.equal(o.ledger.some((e) => e.id === cancelEntryId(id)), false, "no refund entry");
    assert.equal(o.wallet.available, 0, "not a coin came back");
    assert.equal(o.testerCount, 6);
    await assertReconciled(TESTER, `round ${round}`);
  }
});

test("9: exactly at the third-miss midnight the cancel loses; a millisecond before it wins", async () => {
  await seedWorld({ testerCount: 1 });
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  // No check-ins: day 3 becomes the third miss at the start of day 4.
  await assert.rejects(cancel(id, clock.startOf(4)), /missed more testing days/);
  const out = await cancel(id, clock.startOf(4) - 1);
  assert.equal(out.cancelled, true);
  const o = await observe(id);
  assert.equal(o.wallet.available, 50);
  assert.equal(o.testerCount, 1, "seeded 1, +1 for the claim, -1 for the cancel");
  assert.equal(settledOnce(o.ledger, "forfeit"), 0);
});

// ---------------------------------------------------------------------------
// 10. Third miss vs completion
// ---------------------------------------------------------------------------

test("10: the 14th day with 2 misses, racing sweeps and a cancel, never ends as failed (5 rounds)", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await seedWorld({ testerCount: 1 });
    await fund(TESTER);
    const { id, a } = await claim();
    const clock = clockFor(a);
    await checkInDays(id, clock, 15, [5, 9]); // 13 logged, 2 missed

    await Promise.allSettled([
      checkIn(id, clock.at(16)),
      sweep(clock.at(16)),
      cancel(id, clock.at(16)),
      sweep(clock.at(16)),
    ]);

    const o = await observe(id);
    // Completion or cancellation may legitimately win the race; forfeiture may not.
    assert.ok(["completed", "cancelled"].includes(o.a.status), `round ${round}: ${o.a.status}`);
    assert.equal(settledOnce(o.ledger, "forfeit"), 0, `round ${round}: no forfeit`);
    const settlements = o.ledger.filter((e) => e.id === unlockEntryId(id) || e.id === cancelEntryId(id));
    assert.equal(settlements.length, 1, `round ${round}: exactly one terminal settlement`);
    assert.equal(o.wallet.available, 50, "the same coins came back once");
    assert.equal(o.a.failureReason, undefined);
    await assertReconciled(TESTER, `round ${round}`);
  }
});

// ---------------------------------------------------------------------------
// 11-13. Reconciliation, invariant, and scheduler idempotency
// ---------------------------------------------------------------------------

test("11-12: grant -> lock -> 3rd-miss forfeit -> reconcile, then a new cycle reconciles too", async () => {
  await seedWorld();
  await fund(TESTER, 100);
  const first = await claim();
  await sweep(clockFor(first.a).startOf(4));
  await assertReconciled(TESTER, "after the removal");

  const second = await claim();
  assert.equal(second.a.cycle, 2, "the removal freed the tester for a new cycle");
  const clock = clockFor(second.a);
  await checkInDays(second.id, clock, 14);
  const o = await observe(second.id);
  assert.equal(o.a.status, "completed");
  assert.equal(o.wallet.available, 50);
  assert.equal(o.wallet.forfeitedTotal, 50);
  assert.equal(o.wallet.locked, 0);
  await assertReconciled(TESTER, "after the second cycle");
});

test("13: ten concurrent sweeps settle a third-miss removal once", async () => {
  await seedWorld({ testerCount: 9 });
  await fund(TESTER);
  const { id, a } = await claim();
  const at = clockFor(a).startOf(5);

  const summaries = await Promise.all(Array.from({ length: 10 }, () => sweep(at)));
  assert.equal(summaries.reduce((n, s) => n + s.forfeitedCount, 0), 1);

  const o = await observe(id);
  assert.equal(settledOnce(o.ledger, "forfeit"), 1);
  assert.equal(o.ledger.some((e) => e.id === forfeitEntryId(id)), true);
  assert.equal(o.wallet.forfeitedTotal, 50, "never 500");
  assert.equal(o.testerCount, 9, "released once");
  await assertReconciled(TESTER, "ten sweeps");

  // And sequential re-runs later change nothing.
  for (let i = 0; i < 3; i += 1) assert.equal((await sweep(at + i * HOUR)).forfeitedCount, 0);
  assert.equal((await observe(id)).testerCount, 9);
});

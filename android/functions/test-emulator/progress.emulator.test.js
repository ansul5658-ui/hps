/**
 * Batch 9B on a real Firestore: commitment status and member progress.
 *
 * Every commitment is created by the real claim transaction from a wallet
 * funded by the real admin grant, days are recorded by the real check-in,
 * outages declared by the real admin path, and settlements made by the real
 * cancellation, completion and sweep. The reads under test are then asked at a
 * chosen SERVER clock (`nowMillis`) - never a client value - and must agree
 * with what those settlements decide.
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
const { runDeclareOutage } = require("../systemHealth");
const {
  runCommitmentStatus,
  runMemberProgress,
  getMyCommitmentStatusImpl,
  getMemberProgressImpl,
} = require("../progress");
const { addDays, startOfLocalDayMillis } = require("../lib/testingDays");
const { OUTAGE_SCOPE_GLOBAL } = require("../lib/outages");
const { COIN_KIND_FORFEIT } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const APP = "app1";
const APP2 = "app2";
const DEV = "dev1";
const DEV2 = "dev2";
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
// Real setup
// ---------------------------------------------------------------------------

async function seedWorld() {
  await db.doc(`users/${ADMIN}`).set({ uid: ADMIN, role: "admin" });
  await db.doc(`users/${DEV}`).set({ uid: DEV });
  await db.doc(`users/${DEV2}`).set({ uid: DEV2 });
  await db.doc(`apps/${APP}`).set(readyAppDoc(APP, { ownerId: DEV, status: "approved", testerCount: 0 }));
  await db.doc(`apps/${APP2}`).set(readyAppDoc(APP2, { ownerId: DEV2, status: "approved", testerCount: 0 }));
}

async function fund(uid, amount = 50) {
  await db.doc(`users/${uid}`).set({ uid });
  await seedJoinReady(db, uid);
  await runAdminGrant(db, {
    targetUserId: uid,
    amount,
    reason: "progress emulator test",
    idempotencyKey: `seed_${uid}`,
    adminUid: ADMIN,
  });
}

async function claim(uid = TESTER, appId = APP) {
  const out = await runClaimCommitment(db, { appId, testerId: uid });
  const snap = await db.doc(`testingAssignments/${out.assignmentId}`).get();
  return { id: out.assignmentId, a: snap.data() };
}

function clockFor(a) {
  const dayKey = (n) => addDays(a.firstEligibleDayKey, n - 1);
  return {
    dayKey,
    at: (n, hours = 12) => startOfLocalDayMillis(dayKey(n), a.timeZone) + hours * HOUR,
  };
}

const checkIn = (id, nowMillis, uid = TESTER) =>
  runRecordTestingDay(db, { assignmentId: id, testerId: uid, nowMillis });
const cancel = (id, nowMillis, uid = TESTER) =>
  runCancelCommitment(db, { assignmentId: id, actorId: uid, actorKind: "user", nowMillis });
const sweep = (nowMillis) => runExpirySweep(db, { nowMillis });
const status = (nowMillis, appId = APP, uid = TESTER) =>
  runCommitmentStatus(db, { testerId: uid, appId, nowMillis }).then((r) => r.commitment);
const members = (callerId, nowMillis, appId = APP) =>
  runMemberProgress(db, { callerId, appId, nowMillis });

async function checkInDays(id, clock, through, skip = [], uid = TESTER) {
  for (let n = 1; n <= through; n += 1) {
    if (!skip.includes(n)) await checkIn(id, clock.at(n), uid);
  }
}

/** Every document a read could conceivably disturb, with its update time. */
async function fingerprint(uid, id) {
  const docs = await Promise.all([
    db.doc(`testingAssignments/${id}`).get(),
    db.doc(`users/${uid}/wallet/balance`).get(),
    db.doc(`apps/${APP}`).get(),
  ]);
  const cols = await Promise.all([
    db.collection(`users/${uid}/coinTransactions`).get(),
    db.collection("testingLogs").get(),
    db.collection("activeClaims").get(),
  ]);
  return {
    docs: docs.map((d) => [d.ref.path, d.updateTime && d.updateTime.toMillis(), d.data()]),
    cols: cols.map((c) => c.docs.map((d) => [d.ref.path, d.updateTime.toMillis()]).sort()),
  };
}

// ---------------------------------------------------------------------------
// A + B. The caller's own status and misses
// ---------------------------------------------------------------------------

test("A: a fresh claim reads as testing with 0 of 14 days and 2 misses left", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();
  const s = await status(clockFor(a).at(1));
  assert.equal(s.assignmentId, id);
  assert.equal(s.appId, APP);
  assert.equal(s.cycle, 1);
  assert.equal(s.status, "ready");
  assert.equal(s.state, "testing");
  assert.equal(s.isActive, true);
  assert.equal(s.windowDays, 16);
  assert.equal(s.daysRequired, 14);
  assert.equal(s.qualifyingDays, 0);
  assert.equal(s.allowedMisses, 2);
  // Day 1 is today: today is never a miss.
  assert.equal(s.missedDays, 0);
  assert.equal(s.remainingMisses, 2);
  assert.equal(s.firstEligibleDayKey, a.firstEligibleDayKey);
  assert.equal(s.lastEligibleDayKey, a.lastEligibleDayKey);
  assert.equal(s.windowEndsAtMillis, a.windowEndsAt.toMillis());
  assert.equal(s.removalCheckAtMillis, a.removalCheckAt.toMillis());
  assert.equal(s.timeZone, a.timeZone);
  assert.equal(s.capacityHeld, true);
  assert.equal(s.stake, "locked");
  assert.equal(s.commitmentAmount, 50);
});

test("B: misses are derived from the logs - past unlogged days only, today excluded", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  await checkInDays(id, clock, 4, [2]);

  // Day 5, not yet checked in: day 2 is the one miss, day 5 is still open.
  let s = await status(clock.at(5));
  assert.equal(s.qualifyingDays, 3);
  assert.equal(s.missedDays, 1);
  assert.equal(s.remainingMisses, 1);
  assert.equal(s.loggedToday, false);
  assert.equal(s.todayKey, clock.dayKey(5));

  await checkIn(id, clock.at(5));
  s = await status(clock.at(5, 18));
  assert.equal(s.qualifyingDays, 4);
  assert.equal(s.missedDays, 1);
  assert.equal(s.loggedToday, true);
  assert.equal(s.state, "testing");
});

test("B: a declared outage day is not a miss and extends the effective window", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  await checkInDays(id, clock, 4, [2]);
  await runDeclareOutage(db, {
    dayKey: clock.dayKey(2),
    degraded: true,
    reason: "test outage",
    scope: OUTAGE_SCOPE_GLOBAL,
    adminUid: ADMIN,
  });

  const s = await status(clock.at(5));
  assert.equal(s.missedDays, 0);
  assert.equal(s.remainingMisses, 2);
  assert.equal(s.lastEligibleDayKey, a.lastEligibleDayKey);
  assert.equal(s.effectiveLastEligibleDayKey, addDays(a.lastEligibleDayKey, 1));
  assert.equal(
    s.effectiveWindowEndsAtMillis,
    startOfLocalDayMillis(addDays(a.lastEligibleDayKey, 2), a.timeZone),
  );
});

test("B: past the third miss, before the sweep, the read says awaitingSettlement - never testing", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);

  // Days 1-3 unlogged; on day 4 the third miss has landed.
  const s = await status(clock.at(4));
  assert.equal(s.status, "ready");
  assert.equal(s.state, "awaitingSettlement");
  assert.equal(s.endReason, "tooManyMisses");
  assert.equal(s.isActive, false);
  assert.equal(s.missedDays, 3);
  assert.equal(s.remainingMisses, 0);
  assert.equal(s.stake, "locked");

  // The read agrees with the settlement that follows it.
  await sweep(clock.at(4));
  const after = await status(clock.at(4, 13));
  assert.equal(after.status, "failed");
  assert.equal(after.state, "removedForMisses");
  assert.equal(after.endReason, "tooManyMisses");
  assert.equal(after.missedDays, 3);
  assert.equal(after.stake, "forfeited");
  assert.equal(after.capacityHeld, false);
  assert.equal(after.remainingMisses, null);
  assert.ok(after.forfeitedAtMillis > 0);

  // A settled commitment is not re-judged against a later clock.
  const muchLater = await status(clock.at(15));
  assert.equal(muchLater.missedDays, 3);
  assert.equal(muchLater.state, "removedForMisses");

  // And it is not "open" any more.
  const open = await runCommitmentStatus(db, { testerId: TESTER, nowMillis: clock.at(4, 13) });
  assert.deepEqual(open.commitments, []);
});

test("A: completion reads as completed, stake returned, slot kept", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  await checkInDays(id, clock, 14);
  const s = await status(clock.at(14, 20));
  assert.equal(s.state, "completed");
  assert.equal(s.qualifyingDays, 14);
  assert.equal(s.stake, "returned");
  assert.equal(s.capacityHeld, true);
  assert.ok(s.completedAtMillis > 0);
  assert.equal(s.isActive, false);
});

test("A: cancellation reads as cancelled; a new cycle then becomes the latest", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  await checkInDays(id, clock, 3);
  await cancel(id, clock.at(4));

  let s = await status(clock.at(4, 13));
  assert.equal(s.state, "cancelled");
  assert.equal(s.stake, "returned");
  assert.equal(s.capacityHeld, false);
  assert.equal(s.missedDays, null);

  // Read on the NEW cycle's own day 1: its window was pinned at its own claim,
  // so cycle 1's clock would count its unlogged days as misses - correctly.
  const again = await claim();
  s = await status(clockFor(again.a).at(1));
  assert.equal(s.assignmentId, again.id);
  assert.equal(s.cycle, 2);
  assert.equal(s.state, "testing");
});

test("A: without an appId, every open commitment of the caller's is listed, and only those", async () => {
  await seedWorld();
  await fund(TESTER, 100);
  await fund("other");
  const one = await claim(TESTER, APP);
  const two = await claim(TESTER, APP2);
  await claim("other", APP);

  const out = await runCommitmentStatus(db, { testerId: TESTER, nowMillis: clockFor(one.a).at(1) });
  assert.deepEqual(out.commitments.map((c) => c.assignmentId).sort(), [one.id, two.id].sort());

  const none = await runCommitmentStatus(db, { testerId: "nobody", appId: APP, nowMillis: Date.now() });
  assert.equal(none.commitment, null);
});

test("A: a legacy 18-day commitment reports no miss rule", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();
  // Reshape the real claim into a pre-miss-rule commitment, exactly the shape
  // those carry: no allowedMisses, no removalCheckAt, an 18-day window.
  await db.doc(`testingAssignments/${id}`).update({
    allowedMisses: admin.firestore.FieldValue.delete(),
    removalCheckAt: admin.firestore.FieldValue.delete(),
    windowDays: 18,
    lastEligibleDayKey: addDays(a.firstEligibleDayKey, 17),
  });
  // Five unlogged days would be a removal under the new rule - not here.
  const s = await status(clockFor(a).at(6));
  assert.equal(s.missRule, false);
  assert.equal(s.allowedMisses, null);
  assert.equal(s.missedDays, null);
  assert.equal(s.remainingMisses, null);
  assert.equal(s.state, "testing");
  assert.equal(s.windowDays, 18);
});

test("E: reading status and progress writes nothing at all", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();
  const clock = clockFor(a);
  await checkInDays(id, clock, 2);
  const before = await fingerprint(TESTER, id);
  for (let i = 0; i < 5; i += 1) {
    await status(clock.at(3));
    await status(clock.at(9)); // even a read that judges it lost
    await runCommitmentStatus(db, { testerId: TESTER, nowMillis: clock.at(9) });
    await members(TESTER, clock.at(9));
    await members(DEV, clock.at(9));
  }
  assert.deepEqual(await fingerprint(TESTER, id), before);
  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.matches, true);
});

// ---------------------------------------------------------------------------
// C + D. Member progress and who may read it
// ---------------------------------------------------------------------------

async function seedGroup() {
  await seedWorld();
  for (const t of ["t1", "t2", "t3", "gone"]) await fund(t);
  const c = {};
  for (const t of ["t1", "t2", "t3", "gone"]) c[t] = await claim(t);
  const clock = clockFor(c.t1.a);
  await checkInDays(c.t1.id, clock, 4, [], "t1");
  await checkInDays(c.t2.id, clock, 4, [2], "t2");
  await cancel(c.gone.id, clock.at(1), "gone");
  return { c, clock };
}

test("C: the developer sees one anonymous row per slot holder, with derived progress", async () => {
  const { clock } = await seedGroup();
  const out = await members(DEV, clock.at(5));
  assert.equal(out.appId, APP);
  assert.equal(out.capacity, 16);
  assert.equal(out.memberCount, 3);
  assert.deepEqual(out.members.map((m) => m.label), ["Tester 1", "Tester 2", "Tester 3"]);
  assert.ok(out.members.every((m) => m.isYou === false));

  const byDays = out.members.map((m) => [m.qualifyingDays, m.missedDays, m.remainingMisses, m.state]);
  // t1: 4 logged, 0 missed. t2: 3 logged, 1 missed. t3: nothing logged, day 5 -> 4 missed, lost.
  assert.deepEqual(byDays, [
    [4, 0, 2, "testing"],
    [3, 1, 1, "testing"],
    [0, 4, 0, "awaitingSettlement"],
  ]);
});

test("C: a member row exposes no uid, assignment id, stake or wallet", async () => {
  const { clock } = await seedGroup();
  const out = await members("t2", clock.at(5));
  const text = JSON.stringify(out);
  for (const secret of ["t1", "t2", "t3", "gone", DEV, "__c1", "lock_", "available", "wallet", "commitmentAmount"]) {
    assert.equal(text.includes(`"${secret}`) || text.includes(secret + '"'), false, `${secret} leaked`);
  }
  for (const row of out.members) {
    assert.deepEqual(Object.keys(row).sort(), [
      "allowedMisses", "daysRequired", "isYou", "label", "loggedToday",
      "missedDays", "qualifyingDays", "remainingMisses", "state",
    ]);
  }
  assert.equal(out.members.filter((m) => m.isYou).length, 1);
  assert.equal(out.members.find((m) => m.isYou).label, "Tester 2");
});

test("D: strangers, ex-members and other apps' testers are refused", async () => {
  const { clock } = await seedGroup();
  await fund("outsider");
  await claim("outsider", APP2);

  for (const caller of ["stranger", "gone", "outsider", DEV2]) {
    await assert.rejects(
      members(caller, clock.at(5)),
      (e) => e.code === "permission-denied",
      caller,
    );
  }
  // And the app2 tester cannot read app1 even though they are a member somewhere.
  const own = await members("outsider", clock.at(5), APP2);
  assert.equal(own.memberCount, 1);
});

test("D: an admin may read; a suspended admin may not", async () => {
  const { clock } = await seedGroup();
  const out = await members(ADMIN, clock.at(5));
  assert.equal(out.memberCount, 3);
  await db.doc(`users/${ADMIN}`).update({ isSuspended: true });
  await assert.rejects(members(ADMIN, clock.at(5)), (e) => e.code === "permission-denied");
});

test("D: a completed tester keeps their slot and still sees the group; a removed one does not", async () => {
  await seedWorld();
  for (const t of ["done", "lost"]) await fund(t);
  const done = await claim("done");
  const lost = await claim("lost");
  const clock = clockFor(done.a);
  await checkInDays(done.id, clock, 14, [], "done");
  await sweep(clock.at(14, 20)); // "lost" logged nothing: removed at the third miss

  const out = await members("done", clock.at(14, 21));
  assert.equal(out.memberCount, 1);
  assert.equal(out.members[0].state, "completed");
  assert.equal(out.members[0].isYou, true);
  assert.equal((await db.doc(`testingAssignments/${lost.id}`).get()).get("status"), "failed");
  await assert.rejects(members("lost", clock.at(14, 21)), (e) => e.code === "permission-denied");
});

test("D: a missing app is not-found; bad input never reaches the database", async () => {
  await seedWorld();
  await assert.rejects(members(DEV, Date.now(), "noSuchApp"), (e) => e.code === "not-found");
  await assert.rejects(
    getMemberProgressImpl(db, { auth: { uid: DEV }, data: { appId: "a/b" } }),
    (e) => e.code === "invalid-argument",
  );
  await assert.rejects(
    getMemberProgressImpl(db, { data: { appId: APP } }),
    (e) => e.code === "unauthenticated",
  );
});

test("D: the status read answers for the verified caller only - a named testerId is ignored", async () => {
  await seedWorld();
  await fund("victim");
  await claim("victim");
  const out = await getMyCommitmentStatusImpl(db, {
    auth: { uid: "attacker" },
    data: { testerId: "victim", appId: APP },
  });
  assert.equal(out.commitment, null);
  const list = await getMyCommitmentStatusImpl(db, {
    auth: { uid: "attacker" },
    data: { testerId: "victim", uid: "victim" },
  });
  assert.deepEqual(list.commitments, []);

  const mine = await getMyCommitmentStatusImpl(db, { auth: { uid: "victim" }, data: { appId: APP } });
  assert.equal(mine.commitment.appId, APP);
});

// ---------------------------------------------------------------------------
// Concurrency: reads racing the writes they describe
// ---------------------------------------------------------------------------

test("F: ten reads racing a check-in each see before or after it - never a torn state", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await seedWorld();
    await fund(TESTER);
    const { id, a } = await claim();
    const clock = clockFor(a);
    await checkInDays(id, clock, 3);
    const now = clock.at(4);

    const reads = Array.from({ length: 10 }, () => status(now));
    const [write, ...seen] = await Promise.all([checkIn(id, now), ...reads]);
    assert.equal(write.recorded, true, `round ${round}`);
    for (const s of seen) {
      // Before: 3 days, not logged today. After: 4 days, logged today.
      const before = s.qualifyingDays === 3 && s.loggedToday === false;
      const after = s.qualifyingDays === 4 && s.loggedToday === true;
      assert.ok(before || after, `round ${round}: ${JSON.stringify([s.qualifyingDays, s.loggedToday])}`);
      assert.equal(s.missedDays, 0);
      assert.equal(s.state, "testing");
    }
    const final = await status(now);
    assert.equal(final.qualifyingDays, 4);
  }
});

test("F: reads racing the third-miss sweep never report testing, and one forfeit lands", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await seedWorld();
    await fund(TESTER);
    const { a } = await claim();
    const now = clockFor(a).at(4);

    const results = await Promise.allSettled([
      sweep(now),
      sweep(now),
      ...Array.from({ length: 8 }, () => status(now)),
      ...Array.from({ length: 4 }, () => members(DEV, now)),
    ]);
    const reads = results.slice(2, 10);
    for (const r of reads) {
      assert.equal(r.status, "fulfilled", `round ${round}: read failed ${r.reason}`);
      const s = r.value;
      assert.ok(
        (s.state === "awaitingSettlement" && s.stake === "locked") ||
          (s.state === "removedForMisses" && s.stake === "forfeited"),
        `round ${round}: ${s.state}/${s.stake}`,
      );
      assert.equal(s.missedDays, 3);
    }
    for (const r of results.slice(10)) {
      assert.equal(r.status, "fulfilled", `round ${round}: member read failed ${r.reason}`);
      // Removal releases the slot, so the row is either still there (lost,
      // awaiting settlement) or gone - never "testing".
      for (const m of r.value.members) assert.equal(m.state, "awaitingSettlement");
    }

    // Some sweep may report a contended transaction; the outcome must still be one forfeit.
    await sweep(now);
    const ledger = await db.collection(`users/${TESTER}/coinTransactions`).get();
    assert.equal(ledger.docs.filter((d) => d.get("kind") === COIN_KIND_FORFEIT).length, 1, `round ${round}`);
    const s = await status(now);
    assert.equal(s.state, "removedForMisses");
    const report = await runWalletReconciliation(db, { userId: TESTER });
    assert.equal(report.matches, true, `round ${round}`);
  }
});

test("F: many concurrent member reads agree with each other exactly", async () => {
  const { clock } = await seedGroup();
  const outs = await Promise.all(Array.from({ length: 12 }, () => members(DEV, clock.at(5))));
  const first = JSON.stringify(outs[0].members);
  for (const o of outs) assert.equal(JSON.stringify(o.members), first);
});

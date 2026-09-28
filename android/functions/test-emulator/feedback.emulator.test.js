/**
 * Batch 9C on a real Firestore: tester feedback.
 *
 * Every commitment is created by the real claim transaction from a wallet
 * funded by the real admin grant; days are recorded by the real check-in and
 * commitments settled by the real cancellation, completion and sweep. The
 * feedback path is then driven through its callable impls, with a verified
 * `request.auth` exactly as the Functions runtime supplies it.
 *
 * Run through `firebase emulators:exec` - see README.md.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
// Pre-9D fixtures made join-ready the real way; see test/joinReady.js.
const { readyAppDoc, seedJoinReady, TERMS_ACCEPTED } = require("../test/joinReady");

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { configureFirestore } = require("../lib/firestore");

const { runAdminGrant, runWalletReconciliation } = require("../wallet");
const { runClaimCommitment, runCancelCommitment } = require("../commitments");
const { runRecordTestingDay } = require("../testingDays");
const { runExpirySweep } = require("../expiry");
const {
  submitTestingFeedbackImpl,
  getMyTestingFeedbackImpl,
  getAppFeedbackImpl,
  adminListFeedbackImpl,
} = require("../feedback");
const { addDays, startOfLocalDayMillis } = require("../lib/testingDays");
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
// The production transport (lib/firestore.js), or these tests would not
// exercise what production runs.
const db = configureFirestore(getFirestore());

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
  // Real signed-in users have accepted the Terms (release audit F2); see test/joinReady.js.
  await db.doc(`users/${DEV}`).set({ uid: DEV, ...TERMS_ACCEPTED });
  await db.doc(`users/${DEV2}`).set({ uid: DEV2, ...TERMS_ACCEPTED });
  await db.doc(`apps/${APP}`).set(readyAppDoc(APP, { ownerId: DEV, status: "approved", testerCount: 0 }));
  await db.doc(`apps/${APP2}`).set(readyAppDoc(APP2, { ownerId: DEV2, status: "approved", testerCount: 0 }));
}

async function fund(uid, amount = 50) {
  await db.doc(`users/${uid}`).set({ uid });
  await seedJoinReady(db, uid);
  await runAdminGrant(db, {
    targetUserId: uid,
    amount,
    reason: "feedback emulator test",
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
  return { at: (n, hours = 12) => startOfLocalDayMillis(dayKey(n), a.timeZone) + hours * HOUR };
}

const checkIn = (id, nowMillis, uid = TESTER) =>
  runRecordTestingDay(db, { assignmentId: id, testerId: uid, nowMillis });

async function checkInDays(id, clock, through, uid = TESTER) {
  for (let n = 1; n <= through; n += 1) await checkIn(id, clock.at(n), uid);
}

/** A funded tester with a claim and `days` recorded testing days. */
async function tested(uid = TESTER, days = 1, appId = APP) {
  await fund(uid);
  const c = await claim(uid, appId);
  const clock = clockFor(c.a);
  await checkInDays(c.id, clock, days, uid);
  return { ...c, clock };
}

const as = (uid, data) => ({ auth: { uid }, data });
const submit = (uid, data) => submitTestingFeedbackImpl(db, as(uid, data));
const valid = (assignmentId, extra = {}) => ({ assignmentId, rating: 4, ...extra });

const feedbackDocs = async () => (await db.collection("feedback").get()).docs;

/** Every money, progress and capacity document a submission could disturb. */
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
    db.collection("testingAssignments").get(),
  ]);
  return {
    docs: docs.map((d) => [d.ref.path, d.updateTime && d.updateTime.toMillis(), d.data()]),
    cols: cols.map((c) => c.docs.map((d) => [d.ref.path, d.updateTime.toMillis()]).sort()),
  };
}

// ---------------------------------------------------------------------------
// 1. Valid feedback
// ---------------------------------------------------------------------------

test("1: a tester with one recorded day leaves feedback; every link is server-derived", async () => {
  await seedWorld();
  const { id } = await tested();
  const out = await submit(TESTER, valid(id, { comment: "  Great flow, one crash. ", foundBug: true }));
  assert.deepEqual(out, { submitted: true, assignmentId: id, appId: APP, cycle: 1 });

  const snap = await db.doc(`feedback/${id}`).get();
  const f = snap.data();
  assert.equal(f.assignmentId, id);
  assert.equal(f.appId, APP);
  assert.equal(f.testerId, TESTER);
  assert.equal(f.developerId, DEV);
  assert.equal(f.cycle, 1);
  assert.equal(f.rating, 4);
  assert.equal(f.comment, "Great flow, one crash.");
  assert.equal(f.foundBug, true);
  assert.ok(f.submittedAt.toMillis() > 0);
  assert.deepEqual(Object.keys(f).sort(), [
    "appId", "assignmentId", "comment", "cycle", "developerId", "foundBug", "rating", "submittedAt", "testerId",
  ]);
});

test("1: feedback is allowed after completion, cancellation and third-miss removal alike", async () => {
  await seedWorld();
  const done = await tested("done", 14);
  const quit = await tested("quit", 2);
  await runCancelCommitment(db, { assignmentId: quit.id, actorId: "quit", actorKind: "user", nowMillis: quit.clock.at(3) });
  const lost = await tested("lost", 1);
  await runExpirySweep(db, { nowMillis: lost.clock.at(5) }); // days 2-4 missed

  assert.equal((await db.doc(`testingAssignments/${done.id}`).get()).get("status"), "completed");
  assert.equal((await db.doc(`testingAssignments/${quit.id}`).get()).get("status"), "cancelled");
  assert.equal((await db.doc(`testingAssignments/${lost.id}`).get()).get("failureReason"), "tooManyMisses");

  for (const [uid, c] of [["done", done], ["quit", quit], ["lost", lost]]) {
    const out = await submit(uid, valid(c.id, { rating: 2 }));
    assert.equal(out.submitted, true, uid);
  }
  assert.equal((await feedbackDocs()).length, 3);
});

// ---------------------------------------------------------------------------
// 2-5. Who may submit, and for what
// ---------------------------------------------------------------------------

test("2: an unauthenticated submission is refused and writes nothing", async () => {
  await seedWorld();
  const { id } = await tested();
  await assert.rejects(submitTestingFeedbackImpl(db, { data: valid(id) }), (e) => e.code === "unauthenticated");
  assert.equal((await feedbackDocs()).length, 0);
});

test("3: another tester cannot leave feedback on my assignment - and learns nothing", async () => {
  await seedWorld();
  const { id } = await tested();
  await fund("intruder");
  const theirs = await submit("intruder", valid(id)).catch((e) => e);
  const missing = await submit("intruder", valid(`${APP}__ghost__c1`)).catch((e) => e);
  assert.equal(theirs.code, "not-found");
  // A real-but-foreign assignment and a non-existent one are indistinguishable.
  assert.equal(theirs.message, missing.message);
  assert.equal(theirs.code, missing.code);
  assert.equal((await feedbackDocs()).length, 0);
});

test("3: the developer cannot leave feedback on their own app", async () => {
  await seedWorld();
  const { id } = await tested();
  const err = await submit(DEV, valid(id)).catch((e) => e);
  assert.equal(err.code, "not-found");
  assert.equal((await feedbackDocs()).length, 0);
});

test("3: a suspended tester is refused", async () => {
  await seedWorld();
  const { id } = await tested();
  await db.doc(`users/${TESTER}`).update({ isSuspended: true });
  await assert.rejects(submit(TESTER, valid(id)), (e) => e.code === "permission-denied");
  assert.equal((await feedbackDocs()).length, 0);
});

test("4: feedback for an app the tester never tested is refused", async () => {
  await seedWorld();
  await tested(); // tested app1 only
  await assert.rejects(submit(TESTER, valid(`${APP2}__${TESTER}__c1`)), (e) => e.code === "not-found");
  assert.equal((await feedbackDocs()).length, 0);
});

test("5: a wrong cycle of the right app is refused", async () => {
  await seedWorld();
  await tested();
  await assert.rejects(submit(TESTER, valid(`${APP}__${TESTER}__c2`)), (e) => e.code === "not-found");
  assert.equal((await feedbackDocs()).length, 0);
});

test("5: a claim with no recorded day yet is refused", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id } = await claim();
  const err = await submit(TESTER, valid(id)).catch((e) => e);
  assert.equal(err.code, "failed-precondition");
  assert.equal(err.details.reason, "noTestingDays");
  assert.equal((await feedbackDocs()).length, 0);
});

test("5: a legacy assignment with no stake is refused", async () => {
  await seedWorld();
  await db.doc(`users/${TESTER}`).set({ uid: TESTER, ...TERMS_ACCEPTED });
  await db.doc(`testingAssignments/${APP}__${TESTER}`).set({ appId: APP, testerId: TESTER, developerId: DEV, status: "inProgress" });
  await db.doc(`testingLogs/${APP}__${TESTER}__2026-03-02`).set({ assignmentId: `${APP}__${TESTER}`, testerId: TESTER });
  const err = await submit(TESTER, valid(`${APP}__${TESTER}`)).catch((e) => e);
  assert.equal(err.code, "failed-precondition");
  assert.equal(err.details.reason, "noCommitment");
});

// ---------------------------------------------------------------------------
// 6-7. One per cycle, even under a race
// ---------------------------------------------------------------------------

test("6: a second submission for the same cycle is refused and the first is untouched", async () => {
  await seedWorld();
  const { id } = await tested();
  await submit(TESTER, valid(id, { rating: 5, comment: "first" }));
  const before = await db.doc(`feedback/${id}`).get();

  const err = await submit(TESTER, valid(id, { rating: 1, comment: "second" })).catch((e) => e);
  assert.equal(err.code, "already-exists");
  assert.equal(err.details.reason, "alreadySubmitted");

  const after = await db.doc(`feedback/${id}`).get();
  assert.equal(after.get("rating"), 5);
  assert.equal(after.get("comment"), "first");
  assert.equal(after.updateTime.toMillis(), before.updateTime.toMillis());
});

test("6: a new cycle of the same app gets its own feedback", async () => {
  await seedWorld();
  const one = await tested(TESTER, 1);
  await submit(TESTER, valid(one.id));
  await runCancelCommitment(db, { assignmentId: one.id, actorId: TESTER, actorKind: "user", nowMillis: one.clock.at(2) });
  const two = await claim();
  await checkIn(two.id, clockFor(two.a).at(1));
  await submit(TESTER, valid(two.id, { rating: 2 }));
  assert.deepEqual((await feedbackDocs()).map((d) => d.id).sort(), [one.id, two.id].sort());
});

test("7: ten concurrent submissions create exactly one record, across 10 rounds", async () => {
  for (let round = 1; round <= 10; round += 1) {
    await clearFirestore();
    await seedWorld();
    const { id } = await tested();
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) => submit(TESTER, valid(id, { rating: (i % 5) + 1, comment: `racer ${i}` }))),
    );
    const won = results.filter((r) => r.status === "fulfilled");
    assert.equal(won.length, 1, `round ${round}: one winner`);
    for (const r of results) {
      if (r.status === "rejected") assert.equal(r.reason.code, "already-exists", `round ${round}: ${r.reason.message}`);
    }
    const docs = await feedbackDocs();
    assert.equal(docs.length, 1, `round ${round}`);
    // The stored record is exactly one racer's, whole - never a blend.
    const f = docs[0].data();
    const i = Number(f.comment.split(" ")[1]);
    assert.equal(f.rating, (i % 5) + 1, `round ${round}`);
  }
});

// ---------------------------------------------------------------------------
// 8-10. Malformed content never reaches the database
// ---------------------------------------------------------------------------

test("8-10: bad ratings, oversized or non-text comments and missing fields are refused", async () => {
  await seedWorld();
  const { id } = await tested();
  const bad = [
    valid(id, { rating: 0 }),
    valid(id, { rating: 6 }),
    valid(id, { rating: 3.5 }),
    valid(id, { rating: "5" }),
    { assignmentId: id },
    { rating: 4 },
    valid(id, { comment: "x".repeat(1001) }),
    valid(id, { comment: "x".repeat(200_000) }),
    valid(id, { comment: 42 }),
    valid(id, { foundBug: "yes" }),
    valid(id, { testerId: "someoneElse" }),
    valid(id, { appId: APP2 }),
  ];
  for (const data of bad) {
    await assert.rejects(submit(TESTER, data), (e) => e.code === "invalid-argument", JSON.stringify(data).slice(0, 80));
  }
  assert.equal((await feedbackDocs()).length, 0);
  // Boundary values are fine.
  await submit(TESTER, valid(id, { rating: 1, comment: "x".repeat(1000) }));
  assert.equal((await db.doc(`feedback/${id}`).get()).get("comment").length, 1000);
});

// ---------------------------------------------------------------------------
// 12-13. Reading feedback
// ---------------------------------------------------------------------------

async function seedFeedback() {
  await seedWorld();
  const ids = [];
  for (const [uid, rating] of [["t1", 5], ["t2", 3], ["t3", 1]]) {
    const c = await tested(uid);
    await submit(uid, valid(c.id, { rating, comment: `from ${uid}`, foundBug: rating === 1 }));
    ids.push(c.id);
  }
  return ids;
}

test("12: the developer reads their app's feedback anonymously, newest first", async () => {
  await seedFeedback();
  const out = await getAppFeedbackImpl(db, as(DEV, { appId: APP }));
  assert.deepEqual(out.feedback.map((f) => f.rating), [1, 3, 5]);
  const text = JSON.stringify(out);
  for (const secret of ["\"t1", "\"t2", "\"t3", "__c1", DEV, "testerId", "assignmentId", "cycle"]) {
    assert.equal(text.includes(secret), false, `${secret} leaked`);
  }
  for (const f of out.feedback) {
    assert.deepEqual(Object.keys(f).sort(), ["comment", "foundBug", "rating", "submittedAtMillis"]);
  }
});

test("12: the developer's read pages without repeats or gaps", async () => {
  await seedFeedback();
  const p1 = await getAppFeedbackImpl(db, as(DEV, { appId: APP, limit: 2 }));
  assert.equal(p1.feedback.length, 2);
  assert.ok(p1.nextBeforeMillis);
  const p2 = await getAppFeedbackImpl(db, as(DEV, { appId: APP, limit: 2, beforeMillis: p1.nextBeforeMillis }));
  assert.equal(p2.feedback.length, 1);
  assert.equal(p2.nextBeforeMillis, null);
  assert.deepEqual([...p1.feedback, ...p2.feedback].map((f) => f.rating), [1, 3, 5]);
});

test("12: testers, other developers and strangers cannot read an app's feedback", async () => {
  await seedFeedback();
  for (const uid of ["t1", DEV2, "stranger", ADMIN]) {
    await assert.rejects(
      getAppFeedbackImpl(db, as(uid, { appId: APP })),
      (e) => e.code === "permission-denied",
      uid,
    );
  }
  await assert.rejects(getAppFeedbackImpl(db, as(DEV, { appId: "nope" })), (e) => e.code === "not-found");
});

test("12: a normal user - even the developer - is refused the admin list", async () => {
  await seedFeedback();
  for (const uid of [DEV, "t1", "stranger"]) {
    await assert.rejects(
      adminListFeedbackImpl(db, as(uid, { appId: APP })),
      (e) => e.code === "permission-denied",
      uid,
    );
  }
});

test("13: an admin reads full records; a suspended admin is refused", async () => {
  const ids = await seedFeedback();
  const out = await adminListFeedbackImpl(db, as(ADMIN, { appId: APP }));
  assert.deepEqual(out.feedback.map((f) => f.testerId), ["t3", "t2", "t1"]);
  assert.deepEqual(out.feedback.map((f) => f.assignmentId).sort(), [...ids].sort());
  assert.ok(out.feedback.every((f) => f.developerId === DEV));

  await db.doc(`users/${ADMIN}`).update({ isSuspended: true });
  await assert.rejects(adminListFeedbackImpl(db, as(ADMIN, { appId: APP })), (e) => e.code === "permission-denied");
});

test("the author reads their own feedback and whether they can still leave it", async () => {
  await seedWorld();
  await fund(TESTER);
  const { id, a } = await claim();

  let mine = await getMyTestingFeedbackImpl(db, as(TESTER, { assignmentId: id }));
  assert.deepEqual(mine, { assignmentId: id, feedback: null, canSubmit: false, reason: "noTestingDays" });

  await checkIn(id, clockFor(a).at(1));
  mine = await getMyTestingFeedbackImpl(db, as(TESTER, { assignmentId: id }));
  assert.deepEqual(mine, { assignmentId: id, feedback: null, canSubmit: true, reason: null });

  await submit(TESTER, valid(id, { rating: 3, comment: "ok" }));
  mine = await getMyTestingFeedbackImpl(db, as(TESTER, { assignmentId: id }));
  assert.equal(mine.canSubmit, false);
  assert.equal(mine.reason, "alreadySubmitted");
  assert.equal(mine.feedback.rating, 3);
  assert.equal(mine.feedback.comment, "ok");

  // Someone else asking about it is told nothing.
  await assert.rejects(
    getMyTestingFeedbackImpl(db, as("intruder", { assignmentId: id })),
    (e) => e.code === "not-found",
  );
});

// ---------------------------------------------------------------------------
// 14-17. Feedback cannot touch money, capacity, days or status
// ---------------------------------------------------------------------------

test("14-17: a submission changes no wallet, ledger, capacity, day, claim or assignment", async () => {
  await seedWorld();
  const { id } = await tested(TESTER, 3);
  const before = await fingerprint(TESTER, id);
  await submit(TESTER, valid(id, { rating: 5, comment: "done", foundBug: true }));
  // Refused attempts must not either.
  await submit(TESTER, valid(id)).catch(() => {});
  await submit(TESTER, valid(id, { rating: 99 })).catch(() => {});
  assert.deepEqual(await fingerprint(TESTER, id), before);
  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.matches, true);
});

test("16-17: feedback does not rescue a commitment past its third miss", async () => {
  await seedWorld();
  const { id, clock } = await tested(TESTER, 1);
  await submit(TESTER, valid(id, { rating: 5, comment: "please keep me" }));
  // Days 2-4 missed; the sweep still removes it, feedback notwithstanding.
  await runExpirySweep(db, { nowMillis: clock.at(5) });
  const a = (await db.doc(`testingAssignments/${id}`).get()).data();
  assert.equal(a.status, "failed");
  assert.equal(a.failureReason, "tooManyMisses");
  const ledger = await db.collection(`users/${TESTER}/coinTransactions`).get();
  assert.equal(ledger.docs.filter((d) => d.get("kind") === COIN_KIND_FORFEIT).length, 1);
  assert.equal((await db.doc(`apps/${APP}`).get()).get("testerCount"), 0);
});

test("16-17: feedback does not complete a commitment or count as a testing day", async () => {
  await seedWorld();
  const { id, clock } = await tested(TESTER, 13);
  await submit(TESTER, valid(id, { rating: 5 }));
  let a = (await db.doc(`testingAssignments/${id}`).get()).data();
  assert.equal(a.status, "inProgress");
  assert.equal(a.qualifyingDays, 13);
  const logs = await db.collection("testingLogs").where("assignmentId", "==", id).get();
  assert.equal(logs.size, 13);
  // The 14th real day still completes it, exactly as before.
  await checkIn(id, clock.at(14));
  a = (await db.doc(`testingAssignments/${id}`).get()).data();
  assert.equal(a.status, "completed");
});

test("14-17: submissions racing check-ins and a cancellation leave both sides intact", async () => {
  await seedWorld();
  const { id, clock } = await tested(TESTER, 2);
  // Race 1: feedback against a check-in. Neither may block the other.
  const first = await Promise.allSettled([
    submit(TESTER, valid(id, { rating: 4 })),
    submit(TESTER, valid(id, { rating: 4 })),
    checkIn(id, clock.at(3)),
  ]);
  assert.equal(first.slice(0, 2).filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(first[2].status, "fulfilled", `check-in: ${first[2].reason}`);
  assert.equal((await db.doc(`testingAssignments/${id}`).get()).get("qualifyingDays"), 3);

  // Race 2: a (duplicate) feedback against a cancellation. The cancel lands.
  const second = await Promise.allSettled([
    submit(TESTER, valid(id, { rating: 1 })),
    runCancelCommitment(db, { assignmentId: id, actorId: TESTER, actorKind: "user", nowMillis: clock.at(3, 15) }),
  ]);
  assert.equal(second[0].reason.code, "already-exists");
  assert.equal(second[1].status, "fulfilled", `cancel: ${second[1].reason}`);
  const a = (await db.doc(`testingAssignments/${id}`).get()).data();
  assert.equal(a.status, "cancelled");
  assert.equal((await feedbackDocs()).length, 1);
  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.matches, true);
});

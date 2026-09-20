/**
 * Exactly-once proof for the completion reward, against a REAL Firestore.
 *
 * The Batch 5A tests drive `rewards.js` through a hand-written fake. A fake
 * can only prove the code is consistent with my model of Firestore — it cannot
 * prove the model is right. These tests run the same production functions
 * against the Firestore emulator, so real transaction contention, real
 * `tx.create` semantics, real `FieldValue.increment` and a real aggregate
 * query inside a transaction are all exercised.
 *
 * Run with:
 *   firebase emulators:exec --only firestore --project apptesting-concurrency-test \
 *     "npm --prefix functions run test:emulator"
 *
 * These live outside `test/` on purpose: `npm test` must stay fast and
 * emulator-free.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const { verifyAssignmentCompletion, runCompletionVerification } = require("../rewards");

const PROJECT_ID = "apptesting-concurrency-test";
const ASSIGNMENT_ID = "app1__tester1";
const ASSIGNMENT_PATH = `testingAssignments/${ASSIGNMENT_ID}`;
const LEDGER_COLLECTION = "users/tester1/coinTransactions";
const LEDGER_PATH = `${LEDGER_COLLECTION}/done_${ASSIGNMENT_ID}`;
const TESTER_PATH = "users/tester1";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.",
  );
}

admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

// ---------------------------------------------------------------------------
// Emulator helpers
// ---------------------------------------------------------------------------

async function clearFirestore() {
  const url =
    `http://${process.env.FIRESTORE_EMULATOR_HOST}` +
    `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear emulator: ${res.status}`);
}

/**
 * Seeds the shape production actually has: the tester document carries no
 * `coinBalance` and no `isSuspended`, because nothing has ever written them.
 */
async function seed({
  assignmentId = ASSIGNMENT_ID,
  status = "waitingForVerification",
  coinReward = 50,
  daysRequired = 14,
  logs = 14,
  testerId = "tester1",
  tester = { uid: "tester1" },
  adminDoc = { uid: "admin1", role: "admin" },
  ledgerEntry = null,
} = {}) {
  const batch = db.batch();
  batch.set(db.doc("users/admin1"), adminDoc);
  batch.set(db.doc(`users/${testerId}`), tester);
  batch.set(db.doc(`testingAssignments/${assignmentId}`), {
    appId: "app1",
    testerId,
    developerId: "dev1",
    groupId: "g1",
    daysRequired,
    daysCompleted: logs,
    coinReward,
    status,
  });
  for (let i = 0; i < logs; i += 1) {
    const day = `2026-09-${String(i + 1).padStart(2, "0")}`;
    batch.set(db.doc(`testingLogs/${assignmentId}__${day}`), {
      assignmentId,
      testerId,
      date: day,
      createdAt: Timestamp.now(),
    });
  }
  if (ledgerEntry) {
    batch.set(
      db.doc(`users/${testerId}/coinTransactions/done_${assignmentId}`),
      ledgerEntry,
    );
  }
  await batch.commit();
}

const request = (assignmentId = ASSIGNMENT_ID, uid = "admin1") => ({
  auth: { uid },
  data: { assignmentId },
});

const verify = (assignmentId, uid) =>
  verifyAssignmentCompletion(db, request(assignmentId, uid));

/** Full post-condition snapshot — this is what "exactly once" is measured on. */
async function observe(assignmentId = ASSIGNMENT_ID, testerId = "tester1") {
  const [assignment, tester, ledger] = await Promise.all([
    db.doc(`testingAssignments/${assignmentId}`).get(),
    db.doc(`users/${testerId}`).get(),
    db.collection(`users/${testerId}/coinTransactions`).get(),
  ]);
  return {
    status: assignment.get("status"),
    verifiedBy: assignment.get("verifiedBy"),
    completedAt: assignment.get("completedAt"),
    coinReward: assignment.get("coinReward"),
    balance: tester.get("coinBalance"),
    ledgerIds: ledger.docs.map((d) => d.id),
    ledgerCount: ledger.size,
    ledgerDocs: ledger.docs.map((d) => d.data()),
  };
}

async function settled(promises) {
  const results = await Promise.allSettled(promises);
  return {
    awarded: results.filter((r) => r.status === "fulfilled" && r.value.awarded),
    noops: results.filter((r) => r.status === "fulfilled" && !r.value.awarded),
    rejected: results.filter((r) => r.status === "rejected"),
  };
}

test.beforeEach(clearFirestore);
test.after(async () => {
  await Promise.all(admin.apps.map((app) => app && app.delete()));
});

// ---------------------------------------------------------------------------
// Concurrent verification
// ---------------------------------------------------------------------------

test("two simultaneous verifications award exactly once", async () => {
  await seed();

  const { awarded, noops, rejected } = await settled([verify(), verify()]);
  assert.equal(awarded.length, 1, "exactly one call may report a payment");
  assert.equal(awarded[0].value.amount, 50);
  assert.equal(noops.length + rejected.length, 1);

  const state = await observe();
  assert.equal(state.status, "completed");
  assert.equal(state.ledgerCount, 1, "exactly one ledger document");
  assert.deepEqual(state.ledgerIds, [`done_${ASSIGNMENT_ID}`]);
  assert.equal(state.balance, 50, "balance must be 50, never 100");
});

test("five simultaneous verifications still award exactly once", async () => {
  await seed();

  const { awarded } = await settled([verify(), verify(), verify(), verify(), verify()]);
  assert.equal(awarded.length, 1);

  const state = await observe();
  assert.equal(state.ledgerCount, 1);
  assert.equal(state.balance, 50);
  assert.equal(state.status, "completed");
});

test("exactly-once holds across 10 independent concurrent races", async () => {
  // Repetition matters: a single pass could pass by accident if the two calls
  // happened not to overlap. Each round uses a fresh assignment and tester.
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    const assignmentId = `app1__racer${round}`;
    const testerId = `racer${round}`;
    await seed({ assignmentId, testerId, tester: { uid: testerId } });

    const { awarded } = await settled([
      verify(assignmentId),
      verify(assignmentId),
      verify(assignmentId),
    ]);
    assert.equal(awarded.length, 1, `round ${round}: more than one payment`);

    const state = await observe(assignmentId, testerId);
    assert.equal(state.ledgerCount, 1, `round ${round}: duplicate ledger entry`);
    assert.equal(state.balance, 50, `round ${round}: balance drifted`);
    assert.equal(state.status, "completed");
  }
});

test("verification survives a storm of competing writes to the assignment", async () => {
  await seed();

  // Churn the version of a document the transaction reads, so its read set
  // goes stale and Firestore has to abort and re-run it.
  const churn = [];
  for (let i = 0; i < 25; i += 1) {
    churn.push(db.doc(ASSIGNMENT_PATH).update({ churn: i }));
  }
  const [outcome] = await Promise.all([verify(), Promise.allSettled(churn)]);

  assert.equal(outcome.awarded, true);
  const state = await observe();
  assert.equal(state.ledgerCount, 1);
  assert.equal(state.balance, 50);
  assert.equal(state.status, "completed");
});

// ---------------------------------------------------------------------------
// Check-in race — logs are evidence, never payment
// ---------------------------------------------------------------------------

test("a concurrent check-in cannot cause a second reward or corrupt completion", async () => {
  await seed();

  // A testing log lands while the completion transaction is in flight. The
  // aggregate count inside the transaction locks the documents it matched, so
  // this is a genuine contention point.
  const lateLog = db.doc(`testingLogs/${ASSIGNMENT_ID}__2026-09-20`).set({
    assignmentId: ASSIGNMENT_ID,
    testerId: "tester1",
    date: "2026-09-20",
    createdAt: Timestamp.now(),
  });

  const [outcome] = await Promise.all([verify(), lateLog]);
  assert.equal(outcome.awarded, true);

  const state = await observe();
  assert.equal(state.ledgerCount, 1, "a check-in must never mint a reward");
  assert.equal(state.balance, 50);
  assert.equal(state.status, "completed");

  // The log itself is intact — it is evidence, and completion does not erase it.
  const logs = await db
    .collection("testingLogs")
    .where("assignmentId", "==", ASSIGNMENT_ID)
    .get();
  assert.equal(logs.size, 15);

  // And verifying again after the extra log still pays nothing.
  const again = await verify();
  assert.equal(again.awarded, false);
  assert.equal((await observe()).balance, 50);
});

// ---------------------------------------------------------------------------
// Repeat verification and the ledger guard
// ---------------------------------------------------------------------------

test("repeat verification after completion is a no-op", async () => {
  await seed();
  assert.equal((await verify()).awarded, true);

  for (let i = 0; i < 3; i += 1) {
    const repeat = await verify();
    assert.equal(repeat.awarded, false);
    assert.equal(repeat.reason, "alreadyCompleted");
  }

  const state = await observe();
  assert.equal(state.ledgerCount, 1);
  assert.equal(state.balance, 50);
});

test("an existing ledger entry blocks a reward even if the status was rolled back", async () => {
  // The ledger is the payment record; the status is not. Even an assignment
  // pushed back to inProgress out-of-band must not pay twice.
  await seed({
    status: "inProgress",
    ledgerEntry: {
      userId: "tester1",
      amount: 50,
      kind: "earn",
      source: "assignmentCompletion",
      relatedAssignmentId: ASSIGNMENT_ID,
      createdAt: Timestamp.now(),
    },
  });

  const outcome = await verify();
  assert.equal(outcome.awarded, false);
  assert.equal(outcome.reason, "alreadyAwarded");

  const state = await observe();
  assert.equal(state.ledgerCount, 1);
  assert.equal(state.balance, undefined, "no balance may be created");
  assert.equal(state.status, "inProgress", "no status change without a payment");
});

// ---------------------------------------------------------------------------
// Balance arithmetic
// ---------------------------------------------------------------------------

test("a missing balance becomes exactly the reward", async () => {
  await seed();
  await verify();
  assert.equal((await observe()).balance, 50);
});

test("an existing balance of 25 becomes exactly 75", async () => {
  await seed({ tester: { uid: "tester1", coinBalance: 25 } });
  await verify();
  assert.equal((await observe()).balance, 75);
});

test("two verification attempts never produce a double increment", async () => {
  await seed({ tester: { uid: "tester1", coinBalance: 25 } });
  await settled([verify(), verify()]);
  const state = await observe();
  assert.equal(state.balance, 75, "must be 75, never 125");
  assert.equal(state.ledgerCount, 1);
});

// ---------------------------------------------------------------------------
// Ledger and assignment shape
// ---------------------------------------------------------------------------

test("the ledger entry is deterministic and carries the server's own values", async () => {
  // 75, not the 50 default, proves the amount is read from the assignment.
  await seed({ coinReward: 75 });
  const outcome = await verify();
  assert.equal(outcome.amount, 75);

  const state = await observe();
  assert.equal(state.ledgerCount, 1);
  assert.deepEqual(state.ledgerIds, [`done_${ASSIGNMENT_ID}`]);

  const entry = state.ledgerDocs[0];
  assert.equal(entry.amount, 75);
  assert.equal(entry.userId, "tester1");
  assert.equal(entry.relatedAssignmentId, ASSIGNMENT_ID);
  assert.equal(entry.kind, "earn");
  assert.equal(entry.source, "assignmentCompletion");
  assert.equal(entry.actorId, "admin1");
  assert.equal(entry.recordedByAdmin, true);
  assert.ok(entry.createdAt instanceof Timestamp, "createdAt must be a real timestamp");
  assert.equal(state.balance, 75);
});

test("the completed assignment carries correct audit fields and an untouched reward", async () => {
  await seed({ coinReward: 75 });
  await verify();

  const state = await observe();
  assert.equal(state.status, "completed");
  assert.equal(state.verifiedBy, "admin1");
  assert.ok(state.completedAt instanceof Timestamp);
  assert.equal(state.coinReward, 75, "the payment must not rewrite the reward");
});

test("a caller cannot supply an amount", async () => {
  await seed();
  const outcome = await verifyAssignmentCompletion(db, {
    auth: { uid: "admin1" },
    data: { assignmentId: ASSIGNMENT_ID, amount: 9999, coinReward: 9999 },
  });
  assert.equal(outcome.amount, 50);
  const state = await observe();
  assert.equal(state.ledgerDocs[0].amount, 50);
  assert.equal(state.balance, 50);
});

// ---------------------------------------------------------------------------
// No partial state
// ---------------------------------------------------------------------------

test("every rejected verification leaves no trace at all", async () => {
  const cases = [
    ["suspended tester", { tester: { uid: "tester1", isSuspended: true } }],
    ["not enough logged days", { logs: 13 }],
    ["reward above the safety bound", { coinReward: 1001 }],
    ["zero reward", { coinReward: 0 }],
    ["non-verifiable status", { status: "ready" }],
    ["invalid day requirement", { daysRequired: 0 }],
  ];

  for (const [label, overrides] of cases) {
    await clearFirestore();
    await seed(overrides);
    await assert.rejects(verify(), `${label}: should have been refused`);

    const state = await observe();
    assert.equal(state.ledgerCount, 0, `${label}: left a ledger entry`);
    assert.equal(state.balance, undefined, `${label}: created a balance`);
    assert.notEqual(state.status, "completed", `${label}: completed the assignment`);
    assert.equal(state.verifiedBy, undefined, `${label}: stamped an audit field`);
  }
});

test("an admin verifying their own assignment leaves no trace", async () => {
  await clearFirestore();
  await seed({ testerId: "admin1", tester: { uid: "admin1", role: "admin" } });
  await assert.rejects(verify(ASSIGNMENT_ID, "admin1"));

  const assignment = await db.doc(ASSIGNMENT_PATH).get();
  const ledger = await db.collection("users/admin1/coinTransactions").get();
  assert.equal(ledger.size, 0);
  assert.notEqual(assignment.get("status"), "completed");
});

test("a transaction that throws after staging writes commits nothing", async () => {
  // The guarantee the whole design rests on, asserted against real Firestore
  // rather than assumed: staged writes are discarded when the body throws.
  await seed();
  const marker = db.doc("testingAssignments/atomicity-probe");

  await assert.rejects(
    db.runTransaction(async (tx) => {
      await tx.get(db.doc(ASSIGNMENT_PATH));
      tx.update(db.doc(ASSIGNMENT_PATH), { status: "completed" });
      tx.create(marker, { staged: true });
      throw new Error("boom");
    }),
  );

  assert.equal((await marker.get()).exists, false);
  assert.equal((await db.doc(ASSIGNMENT_PATH).get()).get("status"), "waitingForVerification");
});

// ---------------------------------------------------------------------------
// Firestore primitives the design depends on
// ---------------------------------------------------------------------------

test("tx.create refuses to overwrite an existing document", async () => {
  await seed();
  const ref = db.doc(LEDGER_PATH);
  await ref.set({ amount: 50 });

  await assert.rejects(
    db.runTransaction(async (tx) => {
      tx.create(ref, { amount: 9999 });
    }),
    (err) => err.code === 6 || /ALREADY_EXISTS/i.test(String(err.message)),
  );
  assert.equal((await ref.get()).get("amount"), 50, "paid history must be untouched");
});

test("documents read inside a transaction are locked against concurrent writes", async () => {
  // Firestore's SERVER SDKs use pessimistic concurrency: `tx.get` takes a lock
  // and a competing write waits, rather than the optimistic abort-and-retry
  // the mobile/web SDKs use. This is why the recount and the reward cannot be
  // separated by a concurrent write — the guarantee is stronger than the
  // design assumed, not weaker.
  await seed();
  const ref = db.doc(ASSIGNMENT_PATH);

  let announceRead;
  const readDone = new Promise((resolve) => {
    announceRead = resolve;
  });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  let competingLanded = false;
  const held = db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    announceRead();
    await gate;
    tx.update(ref, { probe: (snap.get("probe") || 0) + 1 });
  });

  await readDone;
  const competing = db
    .doc(ASSIGNMENT_PATH)
    .update({ probe: 100 })
    .then(() => {
      competingLanded = true;
    });

  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(competingLanded, false, "a write to a locked document must wait");

  release();
  await Promise.all([held, competing]);
  assert.equal(competingLanded, true, "and must proceed once the lock is released");

  // Transaction committed first (probe -> 1), then the queued write (-> 100).
  assert.equal((await ref.get()).get("probe"), 100);
});

test("concurrent transactions on one document never lose an update", async () => {
  // Two read-modify-write transactions racing on the same document. Whether
  // Firestore serializes them by blocking or by aborting and re-running one,
  // the observable requirement is the same: both increments land exactly once.
  await seed();
  const ref = db.doc(ASSIGNMENT_PATH);
  let bodyRuns = 0;

  const bump = () =>
    db.runTransaction(async (tx) => {
      bodyRuns += 1;
      const snap = await tx.get(ref);
      await new Promise((resolve) => setTimeout(resolve, 50)); // widen the window
      tx.update(ref, { probe: (snap.get("probe") || 0) + 1 });
    });

  await Promise.all([bump(), bump(), bump()]);

  assert.equal((await ref.get()).get("probe"), 3, "an increment was lost");
  assert.ok(bodyRuns >= 3, `body ran ${bodyRuns} time(s)`);
  // Recorded rather than asserted: extra runs mean real contention retries
  // happened, which is environment-dependent.
  console.log(`      [contention] 3 racing transactions ran their body ${bodyRuns} time(s)`);
});

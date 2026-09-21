/**
 * Commitment lifecycle proofs against a REAL Firestore.
 *
 * `test/commitments.test.js` drives the same functions through a hand-written
 * fake. A fake can only prove the code matches my model of Firestore - it
 * cannot prove the model is right. These tests run the production claim,
 * settle and forfeit paths against the emulator, so real transaction
 * contention, real document locking, real transaction queries and real
 * `tx.create` semantics are all exercised.
 *
 * The five scenarios the specification calls out by name are marked
 * "Test A" ... "Test E". They are the reason this file exists: every one of
 * them is a way a tester could end up with coins they never had, or lose coins
 * twice, if the transaction boundaries were wrong.
 *
 * Run with:
 *   firebase emulators:exec --only firestore --project apptesting-concurrency-test \
 *     "npm --prefix functions run test:emulator"
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const {
  runClaimCommitment,
  joinTestingAssignmentImpl,
  runForfeitCommitment,
  adminForfeitCommitmentImpl,
} = require("../commitments");
const { runCompletionVerification } = require("../completion");
const {
  cycleAssignmentId,
  activeClaimId,
  lockEntryId,
  unlockEntryId,
  forfeitEntryId,
  MILLIS_PER_DAY,
} = require("../lib/commitments");
const { checkInvariants } = require("../lib/wallet");
const { COMMITMENT_DAYS_REQUIRED, COMMITMENT_WINDOW_DAYS } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const TESTER = "tester1";
const ADMIN = "admin1";
const DEV = "dev1";
const APP_A = "appA";
const APP_B = "appB";

const walletPath = (uid = TESTER) => `users/${uid}/wallet/balance`;
const ledgerCollection = (uid = TESTER) => `users/${uid}/coinTransactions`;
const claimPath = (appId, uid = TESTER) => `activeClaims/${activeClaimId(appId, uid)}`;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.",
  );
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
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
 * Seeds a tester with a sound wallet and two approved apps.
 *
 * The wallet is written exactly as the server would: the invariant holds, so
 * anything that breaks it later was broken by the code under test.
 */
async function seed({
  available = 50,
  locked = 0,
  forfeitedTotal = 0,
  tester = { uid: TESTER },
  adminDoc = { uid: ADMIN, role: "admin" },
  apps = [APP_A, APP_B],
  withWallet = true,
} = {}) {
  const batch = db.batch();
  batch.set(db.doc(`users/${ADMIN}`), adminDoc);
  batch.set(db.doc(`users/${DEV}`), { uid: DEV });
  batch.set(db.doc(`users/${TESTER}`), tester);
  for (const appId of apps) {
    batch.set(db.doc(`apps/${appId}`), {
      ownerId: DEV,
      status: "approved",
      appName: appId,
      packageName: `com.example.${appId}`,
    });
  }
  if (withWallet) {
    batch.set(db.doc(walletPath()), {
      available,
      locked,
      forfeitedTotal,
      purchasedTotal: 0,
      adjustmentNet: available + locked + forfeitedTotal,
      ledgerCount: 1,
      lastEntryId: "grant_seed",
      schemaVersion: 2,
    });
  }
  await batch.commit();
}

/**
 * Record `count` qualifying days for an assignment.
 *
 * Also advances `ready` -> `inProgress` and updates the cached counters,
 * because that is what the `syncAssignmentProgress` Firestore trigger does on
 * the first log in production. These tests run against the Firestore emulator
 * ONLY, so no trigger fires and the assignment would otherwise sit at `ready`
 * forever - which `checkCompletionEligible` correctly refuses to verify.
 *
 * Standing in for the trigger here, rather than relaxing that rule, is the
 * point: the cached counters this writes are deliberately NOT what settlement
 * trusts. Several tests below set them to a lie and prove the recount from
 * `testingLogs` still governs.
 */
async function seedLogs(assignmentId, count) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    const day = `2026-09-${String(i + 1).padStart(2, "0")}`;
    batch.set(db.doc(`testingLogs/${assignmentId}__${day}`), {
      assignmentId,
      testerId: TESTER,
      date: day,
      createdAt: Timestamp.now(),
    });
  }
  if (count > 0) {
    batch.update(db.doc(`testingAssignments/${assignmentId}`), {
      status: "inProgress",
      daysCompleted: count,
      qualifyingDays: count,
    });
  }
  await batch.commit();
}

async function observe(uid = TESTER) {
  const [wallet, ledger, claims, assignments] = await Promise.all([
    db.doc(walletPath(uid)).get(),
    db.collection(ledgerCollection(uid)).get(),
    db.collection("activeClaims").where("testerId", "==", uid).get(),
    db.collection("testingAssignments").where("testerId", "==", uid).get(),
  ]);
  return {
    wallet: wallet.exists ? wallet.data() : null,
    ledgerIds: ledger.docs.map((d) => d.id).sort(),
    ledgerCount: ledger.size,
    claimIds: claims.docs.map((d) => d.id).sort(),
    claimCount: claims.size,
    assignmentIds: assignments.docs.map((d) => d.id).sort(),
    assignmentCount: assignments.size,
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

const claim = (appId, uid = TESTER) => runClaimCommitment(db, { appId, testerId: uid });

async function settled(promises) {
  const results = await Promise.allSettled(promises);
  return {
    ok: results.filter((r) => r.status === "fulfilled"),
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

test("a claim locks 50 and creates assignment, claim and ledger entry", async () => {
  await seed({ available: 50 });
  const outcome = await claim(APP_A);

  const expectedId = cycleAssignmentId(APP_A, TESTER, 1);
  assert.equal(outcome.assignmentId, expectedId);
  assert.equal(outcome.cycle, 1);

  const state = await observe();
  assert.equal(state.wallet.available, 0);
  assert.equal(state.wallet.locked, 50);
  assert.equal(state.wallet.forfeitedTotal, 0);
  assertInvariant(state.wallet);

  assert.deepEqual(state.assignmentIds, [expectedId]);
  assert.deepEqual(state.claimIds, [activeClaimId(APP_A, TESTER)]);
  assert.deepEqual(state.ledgerIds, [lockEntryId(expectedId)]);

  const a = await db.doc(`testingAssignments/${expectedId}`).get();
  assert.equal(a.get("commitmentAmount"), 50);
  assert.equal(a.get("daysRequired"), COMMITMENT_DAYS_REQUIRED);
  assert.equal(a.get("windowDays"), COMMITMENT_WINDOW_DAYS);
  assert.equal(a.get("lockTxId"), lockEntryId(expectedId));
  assert.equal(a.get("settlementTxId"), null);
  assert.ok(a.get("createdAt") instanceof Timestamp);
});

// ---------------------------------------------------------------------------
// Test A / Test E — two concurrent claims against one 50-coin balance
// ---------------------------------------------------------------------------

test("Test A/E: concurrent claims on two apps with 50 coins — exactly one wins", async () => {
  await seed({ available: 50 });

  const { ok, rejected } = await settled([claim(APP_A), claim(APP_B)]);
  assert.equal(ok.length, 1, "exactly one claim may acquire the 50 coins");
  assert.equal(rejected.length, 1);

  const state = await observe();
  assert.equal(state.wallet.available, 0, "must be 0, never -50");
  assert.equal(state.wallet.locked, 50, "must be 50, never 100");
  assert.equal(state.ledgerCount, 1, "exactly one lock entry");
  assert.equal(state.assignmentCount, 1);
  assert.equal(state.claimCount, 1);
  assertInvariant(state.wallet);
});

test("Test A/E holds across 10 independent races", async () => {
  // A single pass could pass by luck if the two calls did not overlap.
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seed({ available: 50 });

    const { ok } = await settled([claim(APP_A), claim(APP_B)]);
    assert.equal(ok.length, 1, `round ${round}: more than one claim succeeded`);

    const state = await observe();
    assert.equal(state.wallet.available, 0, `round ${round}: available drifted`);
    assert.equal(state.wallet.locked, 50, `round ${round}: locked drifted`);
    assert.equal(state.ledgerCount, 1, `round ${round}: duplicate ledger entry`);
    assertInvariant(state.wallet, `round ${round}`);
  }
});

test("five concurrent claims across five apps with 50 coins admit exactly one", async () => {
  const apps = ["c1", "c2", "c3", "c4", "c5"];
  await seed({ available: 50, apps });

  const { ok } = await settled(apps.map((a) => claim(a)));
  assert.equal(ok.length, 1);

  const state = await observe();
  assert.equal(state.wallet.available, 0);
  assert.equal(state.wallet.locked, 50);
  assert.equal(state.assignmentCount, 1);
  assertInvariant(state.wallet);
});

test("with 100 coins exactly two concurrent claims succeed", async () => {
  // Proves the guard is the BALANCE, not a blanket one-at-a-time lock.
  const apps = ["d1", "d2", "d3", "d4"];
  await seed({ available: 100, apps });

  const { ok } = await settled(apps.map((a) => claim(a)));
  assert.equal(ok.length, 2, "100 coins funds exactly two 50-coin commitments");

  const state = await observe();
  assert.equal(state.wallet.available, 0);
  assert.equal(state.wallet.locked, 100);
  assert.equal(state.ledgerCount, 2);
  assertInvariant(state.wallet);
});

// ---------------------------------------------------------------------------
// Test B — double tap on the same app
// ---------------------------------------------------------------------------

test("Test B: two concurrent claims for the SAME app produce one commitment", async () => {
  await seed({ available: 200 });

  const { ok } = await settled([claim(APP_A), claim(APP_A)]);
  assert.equal(ok.length, 1, "a double tap must not create two commitments");

  const state = await observe();
  assert.equal(state.assignmentCount, 1, "one assignment cycle");
  assert.equal(state.claimCount, 1, "one active claim");
  assert.equal(state.ledgerCount, 1, "one lock transaction");
  assert.equal(state.wallet.locked, 50, "50 locked, never 100");
  assert.equal(state.wallet.available, 150);
  assertInvariant(state.wallet);
});

test("Test B holds across 10 independent double-tap races", async () => {
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seed({ available: 200 });

    const { ok } = await settled([claim(APP_A), claim(APP_A), claim(APP_A)]);
    assert.equal(ok.length, 1, `round ${round}: duplicate commitment`);

    const state = await observe();
    assert.equal(state.assignmentCount, 1, `round ${round}`);
    assert.equal(state.claimCount, 1, `round ${round}`);
    assert.equal(state.wallet.locked, 50, `round ${round}`);
    assertInvariant(state.wallet, `round ${round}`);
  }
});

test("ten sequential claims on the same app produce exactly one commitment", async () => {
  await seed({ available: 500 });
  await claim(APP_A);
  for (let i = 0; i < 9; i += 1) {
    await assert.rejects(claim(APP_A), /already have an active commitment/);
  }
  const state = await observe();
  assert.equal(state.assignmentCount, 1);
  assert.equal(state.wallet.locked, 50);
});

// ---------------------------------------------------------------------------
// Test C — insufficient balance
// ---------------------------------------------------------------------------

test("Test C: a claim with 49 coins fails and leaves absolutely no trace", async () => {
  await seed({ available: 49, forfeitedTotal: 0 });

  await assert.rejects(claim(APP_A), /available Testing Coins/);

  const state = await observe();
  assert.equal(state.wallet.available, 49, "balance untouched");
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.wallet.forfeitedTotal, 0);
  assert.equal(state.assignmentCount, 0, "no assignment");
  assert.equal(state.claimCount, 0, "no activeClaim");
  assert.equal(state.ledgerCount, 0, "no ledger entry");
  assertInvariant(state.wallet);
});

test("Test C: a zero balance and a missing wallet both fail cleanly", async () => {
  await seed({ available: 0 });
  await assert.rejects(claim(APP_A));
  let state = await observe();
  assert.equal(state.wallet.available, 0);
  assert.equal(state.assignmentCount, 0);

  await clearFirestore();
  await seed({ withWallet: false });
  await assert.rejects(claim(APP_A));
  state = await observe();
  assert.equal(state.wallet, null, "no wallet may be conjured by a failed claim");
  assert.equal(state.assignmentCount, 0);
  assert.equal(state.ledgerCount, 0);
});

test("Test C: concurrent claims with 49 coins all fail and nothing moves", async () => {
  await seed({ available: 49 });
  const { ok } = await settled([claim(APP_A), claim(APP_B)]);
  assert.equal(ok.length, 0);

  const state = await observe();
  assert.equal(state.wallet.available, 49);
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.ledgerCount, 0);
});

// ---------------------------------------------------------------------------
// Test D — an existing active claim
// ---------------------------------------------------------------------------

test("Test D: a second claim with one already active is refused, wallet unchanged", async () => {
  await seed({ available: 150 });
  await claim(APP_A);
  const before = (await observe()).wallet;

  await assert.rejects(claim(APP_A), /already have an active commitment/);

  const state = await observe();
  assert.deepEqual(state.wallet, before, "the wallet must not move");
  assert.equal(state.assignmentCount, 1);
  assert.equal(state.claimCount, 1);
  assert.equal(state.ledgerCount, 1);
});

test("Test D: a live commitment on app A does not block app B", async () => {
  await seed({ available: 150 });
  await claim(APP_A);
  await claim(APP_B);

  const state = await observe();
  assert.equal(state.assignmentCount, 2);
  assert.equal(state.claimCount, 2);
  assert.equal(state.wallet.available, 50);
  assert.equal(state.wallet.locked, 100);
  assertInvariant(state.wallet);
});

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

test("a completed cycle frees the app for a new, distinctly identified cycle", async () => {
  await seed({ available: 50 });
  const first = await claim(APP_A);
  await seedLogs(first.assignmentId, COMMITMENT_DAYS_REQUIRED);
  await runCompletionVerification(db, {
    assignmentId: first.assignmentId,
    adminUid: ADMIN,
  });

  // Coins came back, claim released.
  let state = await observe();
  assert.equal(state.wallet.available, 50);
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.claimCount, 0);

  // A brand new cycle, with its own id and its own ledger entries.
  const second = await claim(APP_A);
  assert.equal(second.cycle, 2);
  assert.equal(second.assignmentId, cycleAssignmentId(APP_A, TESTER, 2));

  state = await observe();
  assert.equal(state.assignmentCount, 2, "the first cycle is preserved as history");
  assert.equal(state.wallet.locked, 50);
  assert.equal(state.wallet.available, 0);
  assert.deepEqual(state.ledgerIds.sort(), [
    lockEntryId(first.assignmentId),
    lockEntryId(second.assignmentId),
    unlockEntryId(first.assignmentId),
  ].sort());
  assertInvariant(state.wallet);
});

test("a forfeited cycle also frees the app for a new cycle", async () => {
  await seed({ available: 50 });
  const first = await claim(APP_A);
  await db.doc(`testingAssignments/${first.assignmentId}`).update({
    createdAt: Timestamp.fromMillis(Date.now() - 30 * MILLIS_PER_DAY),
  });
  await runForfeitCommitment(db, {
    assignmentId: first.assignmentId,
    actorId: "system",
    actorKind: "system",
  });

  let state = await observe();
  assert.equal(state.wallet.forfeitedTotal, 50);
  assert.equal(state.wallet.available, 0);
  assert.equal(state.claimCount, 0);

  // No coins left, so the next cycle needs funding — proving forfeiture really
  // consumed them rather than parking them somewhere.
  await assert.rejects(claim(APP_A), /available Testing Coins/);
});

// ---------------------------------------------------------------------------
// Settlement: unlock
// ---------------------------------------------------------------------------

test("completion returns the same 50 coins, exactly once", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, COMMITMENT_DAYS_REQUIRED);

  const outcome = await runCompletionVerification(db, {
    assignmentId: c.assignmentId,
    adminUid: ADMIN,
  });
  assert.equal(outcome.settled, true);
  assert.equal(outcome.unlockedAmount, 50);

  const state = await observe();
  assert.equal(state.wallet.available, 50, "the same coins, back");
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.wallet.adjustmentNet, 50, "no coins were created");
  assert.equal(state.claimCount, 0, "claim released");
  assertInvariant(state.wallet);

  const a = await db.doc(`testingAssignments/${c.assignmentId}`).get();
  assert.equal(a.get("status"), "completed");
  assert.equal(a.get("settlementTxId"), unlockEntryId(c.assignmentId));
});

test("concurrent completions settle exactly once", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, COMMITMENT_DAYS_REQUIRED);

  const run = () =>
    runCompletionVerification(db, { assignmentId: c.assignmentId, adminUid: ADMIN });
  const { ok } = await settled([run(), run(), run()]);
  const reallySettled = ok.filter((r) => r.value.settled);
  assert.equal(reallySettled.length, 1, "exactly one settlement");

  const state = await observe();
  assert.equal(state.wallet.available, 50, "50, never 100 or 150");
  assert.equal(state.wallet.locked, 0);
  assert.equal(
    state.ledgerIds.filter((id) => id.startsWith("unlock_")).length,
    1,
    "exactly one unlock entry",
  );
  assertInvariant(state.wallet);
});

test("repeated completion after settlement never returns coins again", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, COMMITMENT_DAYS_REQUIRED);
  await runCompletionVerification(db, { assignmentId: c.assignmentId, adminUid: ADMIN });

  const after = (await observe()).wallet;
  for (let i = 0; i < 3; i += 1) {
    const repeat = await runCompletionVerification(db, {
      assignmentId: c.assignmentId,
      adminUid: ADMIN,
    });
    assert.equal(repeat.verified, false);
    assert.equal(repeat.reason, "alreadyCompleted");
  }
  assert.deepEqual((await observe()).wallet, after);
});

test("a completion short of the requirement moves nothing and keeps the claim", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, COMMITMENT_DAYS_REQUIRED - 1);

  await assert.rejects(
    runCompletionVerification(db, { assignmentId: c.assignmentId, adminUid: ADMIN }),
  );

  const state = await observe();
  assert.equal(state.wallet.available, 0);
  assert.equal(state.wallet.locked, 50, "coins stay committed");
  assert.equal(state.claimCount, 1, "claim survives a refused settlement");
  assert.equal(state.ledgerCount, 1, "no unlock entry");
});

// ---------------------------------------------------------------------------
// Settlement: forfeit
// ---------------------------------------------------------------------------

test("an expired short commitment forfeits the full stake, exactly once", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, 3);
  await db.doc(`testingAssignments/${c.assignmentId}`).update({
    createdAt: Timestamp.fromMillis(Date.now() - 30 * MILLIS_PER_DAY),
  });

  const outcome = await runForfeitCommitment(db, {
    assignmentId: c.assignmentId,
    actorId: "system",
    actorKind: "system",
  });
  assert.equal(outcome.forfeited, true);
  assert.equal(outcome.amount, 50);

  const state = await observe();
  assert.equal(state.wallet.available, 0, "no partial refund");
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.wallet.forfeitedTotal, 50);
  assert.equal(state.claimCount, 0);
  assertInvariant(state.wallet);

  const a = await db.doc(`testingAssignments/${c.assignmentId}`).get();
  assert.equal(a.get("status"), "failed");
  assert.equal(a.get("settlementTxId"), forfeitEntryId(c.assignmentId));
});

test("concurrent forfeitures consume the stake exactly once", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, 1);
  await db.doc(`testingAssignments/${c.assignmentId}`).update({
    createdAt: Timestamp.fromMillis(Date.now() - 30 * MILLIS_PER_DAY),
  });

  const run = () =>
    runForfeitCommitment(db, {
      assignmentId: c.assignmentId,
      actorId: "system",
      actorKind: "system",
    });
  const { ok } = await settled([run(), run(), run()]);
  assert.equal(ok.length, 1, "exactly one forfeiture");

  const state = await observe();
  assert.equal(state.wallet.forfeitedTotal, 50, "50, never 100 or 150");
  assert.equal(state.wallet.locked, 0);
  assertInvariant(state.wallet);
});

test("forfeiture is refused while the window is open, even for an admin", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, 1);

  await assert.rejects(
    adminForfeitCommitmentImpl(db, {
      auth: { uid: ADMIN },
      data: { assignmentId: c.assignmentId },
    }),
    /window has not closed/,
  );

  const state = await observe();
  assert.equal(state.wallet.locked, 50, "coins stay committed");
  assert.equal(state.wallet.forfeitedTotal, 0);
  assert.equal(state.claimCount, 1);
});

test("forfeiture is refused when the tester actually did the work", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, COMMITMENT_DAYS_REQUIRED);
  await db.doc(`testingAssignments/${c.assignmentId}`).update({
    createdAt: Timestamp.fromMillis(Date.now() - 30 * MILLIS_PER_DAY),
  });

  await assert.rejects(
    runForfeitCommitment(db, {
      assignmentId: c.assignmentId,
      actorId: "system",
      actorKind: "system",
    }),
    /completed, not forfeited/,
  );

  const state = await observe();
  assert.equal(state.wallet.forfeitedTotal, 0, "work that was done is never forfeited");
  assert.equal(state.wallet.locked, 50);

  // And it can still be completed properly.
  const done = await runCompletionVerification(db, {
    assignmentId: c.assignmentId,
    adminUid: ADMIN,
  });
  assert.equal(done.settled, true);
  assert.equal((await observe()).wallet.available, 50);
});

test("a settled commitment cannot then be forfeited, and vice versa", async () => {
  await seed({ available: 100 });
  // Completed, then forfeit attempted.
  const done = await claim(APP_A);
  await seedLogs(done.assignmentId, COMMITMENT_DAYS_REQUIRED);
  await runCompletionVerification(db, { assignmentId: done.assignmentId, adminUid: ADMIN });
  await db.doc(`testingAssignments/${done.assignmentId}`).update({
    createdAt: Timestamp.fromMillis(Date.now() - 30 * MILLIS_PER_DAY),
  });
  await assert.rejects(
    runForfeitCommitment(db, {
      assignmentId: done.assignmentId,
      actorId: "system",
      actorKind: "system",
    }),
    /already been settled/,
  );

  // Forfeited, then completion attempted.
  const lost = await claim(APP_B);
  await seedLogs(lost.assignmentId, 2);
  await db.doc(`testingAssignments/${lost.assignmentId}`).update({
    createdAt: Timestamp.fromMillis(Date.now() - 30 * MILLIS_PER_DAY),
  });
  await runForfeitCommitment(db, {
    assignmentId: lost.assignmentId,
    actorId: "system",
    actorKind: "system",
  });
  await assert.rejects(
    runCompletionVerification(db, { assignmentId: lost.assignmentId, adminUid: ADMIN }),
  );

  const state = await observe();
  assertInvariant(state.wallet);
  assert.equal(state.wallet.forfeitedTotal, 50, "exactly one forfeiture");
});

// ---------------------------------------------------------------------------
// Ledger immutability and blast radius
// ---------------------------------------------------------------------------

test("a lock entry cannot be overwritten, even by the server", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  const ref = db.doc(`${ledgerCollection()}/${lockEntryId(c.assignmentId)}`);

  await assert.rejects(
    db.runTransaction(async (tx) => {
      tx.create(ref, { amount: 9999, kind: "lock" });
    }),
    (err) => err.code === 6 || /ALREADY_EXISTS/i.test(String(err.message)),
  );
  assert.equal((await ref.get()).get("amount"), 50);
});

test("a claim touches only its own documents and the app's tester counter", async () => {
  await seed({ available: 50 });
  await db.doc("discovery/quickTestPool").set({ appIds: ["appA"] });

  const untouched = {};
  for (const p of ["users/tester1", "discovery/quickTestPool", `apps/${APP_B}`]) {
    untouched[p] = (await db.doc(p).get()).data();
  }
  const appBefore = (await db.doc(`apps/${APP_A}`).get()).data();

  await claim(APP_A);

  for (const [p, before] of Object.entries(untouched)) {
    assert.deepEqual((await db.doc(p).get()).data(), before, `${p} was modified`);
  }

  // The claimed app IS written — it owns the tester counter now that
  // push-matching is retired — but only that counter and `updatedAt`. Identity
  // fields must survive a claim untouched.
  const appAfter = (await db.doc(`apps/${APP_A}`).get()).data();
  assert.equal(appAfter.testerCount, 1);
  assert.equal(appAfter.ownerId, appBefore.ownerId);
  assert.equal(appAfter.status, appBefore.status);
  assert.equal(appAfter.appName, appBefore.appName);
  assert.equal(appAfter.packageName, appBefore.packageName);
});

test("the tester cap is enforced at claim time, transactionally", async () => {
  // Push-matching used to stop at REQUIRED_TESTER_COUNT before creating
  // assignments. That check now lives in the claim transaction, reading the
  // app document it also writes — so it cannot be raced past the cap.
  const { REQUIRED_TESTER_COUNT } = require("../lib/constants");
  await seed({ available: 500 });
  await db.doc(`apps/${APP_A}`).update({ testerCount: REQUIRED_TESTER_COUNT });

  await assert.rejects(claim(APP_A), /all the testers it needs/);

  const state = await observe();
  assert.equal(state.wallet.locked, 0, "no coins may be staked on a full app");
  assert.equal(state.assignmentCount, 0);
  assert.equal(state.claimCount, 0);

  // One slot free: exactly one of three concurrent claimants gets it.
  await db.doc(`apps/${APP_A}`).update({ testerCount: REQUIRED_TESTER_COUNT - 1 });
  const { ok } = await settled([
    runClaimCommitment(db, { appId: APP_A, testerId: "racer1" }),
    runClaimCommitment(db, { appId: APP_A, testerId: "racer2" }),
    runClaimCommitment(db, { appId: APP_A, testerId: "racer3" }),
  ]);
  assert.equal(ok.length, 0, "unfunded racers cannot claim the last slot either");
  assert.equal(
    (await db.doc(`apps/${APP_A}`).get()).get("testerCount"),
    REQUIRED_TESTER_COUNT - 1,
    "a refused claim must not advance the counter",
  );
});

test("the full lifecycle leaves a complete, auditable ledger", async () => {
  await seed({ available: 50 });
  const c = await claim(APP_A);
  await seedLogs(c.assignmentId, COMMITMENT_DAYS_REQUIRED);
  await runCompletionVerification(db, { assignmentId: c.assignmentId, adminUid: ADMIN });

  const ledger = await db.collection(ledgerCollection()).orderBy("createdAt", "asc").get();
  const kinds = ledger.docs.map((d) => d.get("kind"));
  assert.deepEqual(kinds, ["lock", "unlock"]);
  // Every entry names the assignment it belongs to, so the audit trail can be
  // reconstructed per commitment.
  for (const d of ledger.docs) {
    assert.equal(d.get("assignmentId"), c.assignmentId);
    assert.equal(d.get("appId"), APP_A);
    assert.equal(d.get("schemaVersion"), 2);
  }
});

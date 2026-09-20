/**
 * Testing Coin wallet proofs against a REAL Firestore.
 *
 * `test/wallet.test.js` drives the same functions through a hand-written fake.
 * A fake can only prove the code is consistent with my model of Firestore - it
 * cannot prove the model is right. These tests run the production grant path
 * against the emulator, so real transaction contention, real `tx.create`
 * semantics and real document locking are all exercised.
 *
 * What must hold, no matter how the calls interleave:
 *   * a duplicate idempotency key never grants twice
 *   * concurrent distinct grants never lose one and never double-count one
 *   * the invariant available+locked+forfeited == purchased+adjustment holds
 *     after every single operation
 *   * nothing outside the wallet and its ledger is ever written
 *
 * Run with:
 *   firebase emulators:exec --only firestore --project apptesting-concurrency-test \
 *     "npm --prefix functions run test:emulator"
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const { adminGrantCoinsImpl, runWalletReconciliation } = require("../wallet");
const { checkInvariants } = require("../lib/wallet");
const { MAX_ADMIN_GRANT_AMOUNT, WALLET_SCHEMA_VERSION } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const TESTER = "tester1";
const ADMIN = "admin1";
const TESTER_PATH = `users/${TESTER}`;
const WALLET_PATH = `users/${TESTER}/wallet/balance`;
const LEDGER_COLLECTION = `users/${TESTER}/coinTransactions`;

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
 * Production shape: an ordinary user document has no `isSuspended`, no `role`
 * and no wallet subcollection at all until something writes one.
 */
async function seed({
  tester = { uid: TESTER },
  adminDoc = { uid: ADMIN, role: "admin" },
  extra = {},
} = {}) {
  const batch = db.batch();
  batch.set(db.doc(`users/${ADMIN}`), adminDoc);
  batch.set(db.doc(TESTER_PATH), tester);
  for (const [path, data] of Object.entries(extra)) batch.set(db.doc(path), data);
  await batch.commit();
}

const grant = (amount, idempotencyKey, { uid = ADMIN, userId = TESTER, reason } = {}) =>
  adminGrantCoinsImpl(db, {
    auth: { uid },
    data: { userId, amount, idempotencyKey, reason },
  });

async function observe(userId = TESTER) {
  const [wallet, ledger, user] = await Promise.all([
    db.doc(`users/${userId}/wallet/balance`).get(),
    db.collection(`users/${userId}/coinTransactions`).get(),
    db.doc(`users/${userId}`).get(),
  ]);
  return {
    exists: wallet.exists,
    wallet: wallet.exists ? wallet.data() : null,
    ledgerIds: ledger.docs.map((d) => d.id).sort(),
    ledgerCount: ledger.size,
    ledgerDocs: ledger.docs.map((d) => d.data()),
    legacyCoinBalance: user.get("coinBalance"),
  };
}

/** The invariant, asserted on whatever is actually stored. */
function assertInvariant(wallet, label = "") {
  const check = checkInvariants({
    available: wallet.available,
    locked: wallet.locked,
    forfeitedTotal: wallet.forfeitedTotal,
    purchasedTotal: wallet.purchasedTotal,
    adjustmentNet: wallet.adjustmentNet,
  });
  assert.equal(check.ok, true, `${label}${label ? ": " : ""}${check.errors.join("; ")}`);
}

async function settled(promises) {
  const results = await Promise.allSettled(promises);
  return {
    granted: results.filter((r) => r.status === "fulfilled" && r.value.granted),
    duplicates: results.filter((r) => r.status === "fulfilled" && !r.value.granted),
    rejected: results.filter((r) => r.status === "rejected"),
  };
}

test.beforeEach(clearFirestore);
test.after(async () => {
  await Promise.all(admin.apps.map((app) => app && app.delete()));
});

// ---------------------------------------------------------------------------
// The zero state
// ---------------------------------------------------------------------------

test("a new user has no wallet document and no ledger", async () => {
  await seed();
  const state = await observe();
  assert.equal(state.exists, false);
  assert.equal(state.ledgerCount, 0);

  // And reconciliation reports that zero state truthfully rather than erroring.
  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.walletExists, false);
  assert.equal(report.derived.available, 0);
  assert.equal(report.derived.locked, 0);
  assert.equal(report.derived.forfeitedTotal, 0);
  assert.equal(report.matches, false, "a missing wallet differs from a derived zero wallet");
  assert.equal(report.repaired, false);
});

// ---------------------------------------------------------------------------
// The happy path, for real
// ---------------------------------------------------------------------------

test("an admin grant of 50 creates the wallet and exactly one ledger entry", async () => {
  await seed();
  const outcome = await grant(50, "k1");
  assert.equal(outcome.granted, true);

  const state = await observe();
  assert.equal(state.exists, true);
  assert.equal(state.wallet.available, 50);
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.wallet.forfeitedTotal, 0);
  assert.equal(state.wallet.purchasedTotal, 0);
  assert.equal(state.wallet.adjustmentNet, 50);
  assert.equal(state.wallet.ledgerCount, 1);
  assert.equal(state.wallet.lastEntryId, "grant_k1");
  assert.equal(state.wallet.schemaVersion, WALLET_SCHEMA_VERSION);
  assert.ok(state.wallet.updatedAt instanceof Timestamp, "updatedAt must be a real timestamp");
  assertInvariant(state.wallet);

  assert.deepEqual(state.ledgerIds, ["grant_k1"]);
  const entry = state.ledgerDocs[0];
  assert.equal(entry.kind, "adjustment");
  assert.equal(entry.source, "adminGrant");
  assert.equal(entry.amount, 50);
  assert.equal(entry.deltaAvailable, 50);
  assert.equal(entry.actorId, ADMIN);
  assert.equal(entry.actorKind, "admin");
  assert.equal(entry.paymentRef, null);
  assert.ok(entry.createdAt instanceof Timestamp);

  // Nothing leaked onto the user document.
  assert.equal(state.legacyCoinBalance, undefined);
});

// ---------------------------------------------------------------------------
// Idempotency under real contention
// ---------------------------------------------------------------------------

test("two simultaneous grants with the same key credit exactly once", async () => {
  await seed();
  const { granted, duplicates, rejected } = await settled([grant(50, "same"), grant(50, "same")]);

  assert.equal(granted.length, 1, "exactly one call may report a grant");
  assert.equal(duplicates.length + rejected.length, 1);

  const state = await observe();
  assert.equal(state.wallet.available, 50, "balance must be 50, never 100");
  assert.equal(state.ledgerCount, 1);
  assertInvariant(state.wallet);
});

test("exactly-once on a duplicate key holds across 10 independent races", async () => {
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seed();
    const { granted } = await settled([
      grant(50, `race${round}`),
      grant(50, `race${round}`),
      grant(50, `race${round}`),
    ]);
    assert.equal(granted.length, 1, `round ${round}: granted more than once`);

    const state = await observe();
    assert.equal(state.wallet.available, 50, `round ${round}: balance drifted`);
    assert.equal(state.ledgerCount, 1, `round ${round}: duplicate ledger entry`);
    assertInvariant(state.wallet, `round ${round}`);
  }
});

test("ten sequential replays of one key never pay twice", async () => {
  await seed();
  await grant(50, "once");
  for (let i = 0; i < 10; i += 1) {
    const repeat = await grant(50, "once");
    assert.equal(repeat.granted, false);
    assert.equal(repeat.reason, "duplicate");
  }
  const state = await observe();
  assert.equal(state.wallet.available, 50);
  assert.equal(state.ledgerCount, 1);
});

// ---------------------------------------------------------------------------
// Concurrent DISTINCT grants — the lost-update hazard
// ---------------------------------------------------------------------------

test("concurrent grants with distinct keys do not corrupt the wallet balance", async () => {
  await seed();

  // Ten different grants landing at once. Each reads the wallet and writes a
  // computed total, so a missing lock would silently lose updates.
  const amounts = [10, 20, 30, 40, 50, 5, 15, 25, 35, 45];
  const expected = amounts.reduce((a, b) => a + b, 0);

  const { granted, rejected } = await settled(
    amounts.map((amount, i) => grant(amount, `distinct${i}`)),
  );
  assert.equal(rejected.length, 0, "no grant should fail");
  assert.equal(granted.length, amounts.length);

  const state = await observe();
  assert.equal(state.wallet.available, expected, "an update was lost or double-counted");
  assert.equal(state.wallet.adjustmentNet, expected);
  assert.equal(state.wallet.ledgerCount, amounts.length);
  assert.equal(state.ledgerCount, amounts.length);
  assertInvariant(state.wallet);

  // And the ledger agrees with the cached wallet, which is the real test.
  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.matches, true, JSON.stringify(report.differences));
});

test("a storm of competing writes to the wallet document does not break it", async () => {
  await seed();
  await grant(50, "base");

  // Churn an unrelated field on the wallet while grants are in flight, so the
  // grant transactions have to contend for the document.
  const churn = [];
  for (let i = 0; i < 15; i += 1) churn.push(db.doc(WALLET_PATH).update({ churn: i }));
  const grants = [grant(10, "s1"), grant(10, "s2"), grant(10, "s3")];

  await Promise.all([Promise.allSettled(grants), Promise.allSettled(churn)]);

  const state = await observe();
  assert.equal(state.wallet.available, 80, "50 + 3x10");
  assert.equal(state.ledgerCount, 4);
  assertInvariant(state.wallet);
});

// ---------------------------------------------------------------------------
// Immutability of the ledger
// ---------------------------------------------------------------------------

test("a ledger entry cannot be overwritten, even by the server", async () => {
  await seed();
  await grant(50, "k1");
  const ref = db.doc(`${LEDGER_COLLECTION}/grant_k1`);

  await assert.rejects(
    db.runTransaction(async (tx) => {
      tx.create(ref, { amount: 9999, kind: "adjustment" });
    }),
    (err) => err.code === 6 || /ALREADY_EXISTS/i.test(String(err.message)),
  );

  const after = await ref.get();
  assert.equal(after.get("amount"), 50, "ledger history must be untouched");
});

test("a replay with a different amount cannot rewrite the stored entry", async () => {
  await seed();
  await grant(50, "k1");
  const replay = await grant(MAX_ADMIN_GRANT_AMOUNT, "k1");

  assert.equal(replay.granted, false);
  const state = await observe();
  assert.equal(state.ledgerDocs[0].amount, 50);
  assert.equal(state.wallet.available, 50);
});

// ---------------------------------------------------------------------------
// Rejections leave no trace
// ---------------------------------------------------------------------------

test("every rejected grant leaves no wallet and no ledger entry", async () => {
  const cases = [
    ["non-admin caller", () => grant(50, "x", { uid: TESTER })],
    ["zero amount", () => grant(0, "x")],
    ["negative amount", () => grant(-50, "x")],
    ["fractional amount", () => grant(1.5, "x")],
    ["over the ceiling", () => grant(MAX_ADMIN_GRANT_AMOUNT + 1, "x")],
    ["missing idempotency key", () => grant(50, undefined)],
    ["self-grant", () => grant(50, "x", { userId: ADMIN })],
    ["nonexistent user", () => grant(50, "x", { userId: "ghost" })],
  ];

  for (const [label, run] of cases) {
    await clearFirestore();
    await seed();
    await assert.rejects(run(), `${label}: should have been refused`);

    const state = await observe();
    assert.equal(state.exists, false, `${label}: created a wallet`);
    assert.equal(state.ledgerCount, 0, `${label}: created a ledger entry`);
  }
});

test("a suspended user cannot receive a grant and no trace is left", async () => {
  await seed({ tester: { uid: TESTER, isSuspended: true } });
  await assert.rejects(grant(50, "k1"), /suspended/);

  const state = await observe();
  assert.equal(state.exists, false);
  assert.equal(state.ledgerCount, 0);
});

test("a suspended admin cannot grant", async () => {
  await seed({ adminDoc: { uid: ADMIN, role: "admin", isSuspended: true } });
  await assert.rejects(grant(50, "k1"), /suspended/);
  assert.equal((await observe()).ledgerCount, 0);
});

// ---------------------------------------------------------------------------
// Reconciliation against real data
// ---------------------------------------------------------------------------

test("reconciliation matches after a sequence of real grants", async () => {
  await seed();
  await grant(50, "a");
  await grant(25, "b");
  await grant(5, "c");

  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.matches, true, JSON.stringify(report.differences));
  assert.equal(report.derived.available, 80);
  assert.equal(report.derived.adjustmentNet, 80);
  assert.equal(report.derived.ledgerCount, 3);
  assert.equal(report.legacyLedgerEntries.count, 0);
  assert.equal(report.repaired, false);
});

test("reconciliation reports out-of-band tampering and repairs nothing", async () => {
  await seed();
  await grant(50, "a");

  // Something writes a balance without a ledger entry — exactly the scenario
  // reconciliation exists to catch.
  await db.doc(WALLET_PATH).update({ available: 5000 });

  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.matches, false);
  assert.deepEqual(report.differences, [{ field: "available", cached: 5000, derived: 50 }]);
  assert.equal(report.repaired, false);

  // The tampered value is still there. Reconciliation reports; it does not fix.
  const after = await db.doc(WALLET_PATH).get();
  assert.equal(after.get("available"), 5000);
  // And the ledger is intact, so the truth is still recoverable.
  assert.equal((await observe()).ledgerCount, 1);
});

test("reward-era data is reported, never migrated into the balance", async () => {
  await seed({
    tester: { uid: TESTER, coinBalance: 150 },
    extra: {
      [`${LEDGER_COLLECTION}/done_app1__tester1`]: {
        userId: TESTER,
        amount: 50,
        kind: "earn",
        source: "assignmentCompletion",
        createdAt: Timestamp.now(),
      },
    },
  });
  await grant(20, "new1");

  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.legacyCoinBalance, 150, "the old balance must be reported");
  assert.equal(report.legacyLedgerEntries.count, 1);
  assert.equal(report.legacyLedgerEntries.totalAmount, 50);
  assert.equal(report.derived.available, 20, "only the v2 grant is spendable");
  assert.equal(report.matches, true, "the v2 wallet still agrees with the v2 ledger");
  assert.equal(report.repaired, false);

  // Nothing was deleted or rewritten.
  const legacy = await db.doc(`${LEDGER_COLLECTION}/done_app1__tester1`).get();
  assert.equal(legacy.get("amount"), 50);
  assert.equal((await db.doc(TESTER_PATH).get()).get("coinBalance"), 150);
});

// ---------------------------------------------------------------------------
// Blast radius
// ---------------------------------------------------------------------------

test("a grant writes nothing outside the wallet and its ledger", async () => {
  await seed({
    extra: {
      "apps/app1": { ownerId: "dev1", status: "approved" },
      "testingAssignments/app1__tester1": { testerId: TESTER, status: "ready" },
      "discovery/quickTestPool": { appIds: ["app1"] },
    },
  });

  const before = await Promise.all([
    db.doc(TESTER_PATH).get(),
    db.doc("apps/app1").get(),
    db.doc("testingAssignments/app1__tester1").get(),
    db.doc("discovery/quickTestPool").get(),
  ]);

  await grant(50, "k1");

  const after = await Promise.all([
    db.doc(TESTER_PATH).get(),
    db.doc("apps/app1").get(),
    db.doc("testingAssignments/app1__tester1").get(),
    db.doc("discovery/quickTestPool").get(),
  ]);

  for (let i = 0; i < before.length; i += 1) {
    assert.deepEqual(after[i].data(), before[i].data(), `document ${i} was modified`);
  }
});

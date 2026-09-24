/**
 * Wallet reconciliation across every commitment lifecycle, on a real Firestore.
 *
 * `adminReconcileWallet` folds a tester's ledger and compares it to the cached
 * wallet document. Until now it was only ever exercised after GRANTS, which
 * never touch `locked` or `forfeitedTotal` - so nothing proved that the three
 * settlements keep the cached wallet and the ledger in step.
 *
 * Every coin here moves through a production path, never a seeded balance:
 * the grant is `runAdminGrant`, the lock is `runClaimCommitment`, and the
 * settlements are fourteen real `runRecordTestingDay` check-ins, the
 * forfeiture transaction, and the cancellation transaction. A seeded wallet
 * would reconcile against no ledger at all and prove nothing.
 *
 * Each lifecycle is checked two ways: the production reconciliation report,
 * and an independent fold of the ledger read straight back from Firestore.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const { runAdminGrant, runWalletReconciliation, walletPath } = require("../wallet");
const {
  runClaimCommitment,
  runForfeitCommitment,
  runCancelCommitment,
} = require("../commitments");
const { runRecordTestingDay } = require("../testingDays");
const { foldLedger, diffWallets, checkInvariants } = require("../lib/wallet");
const { MILLIS_PER_DAY } = require("../lib/commitments");
const { addDays, startOfLocalDayMillis } = require("../lib/testingDays");
const { COMMITMENT_DAYS_REQUIRED } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const TESTER = "tester1";
const ADMIN = "admin1";
const DEV = "dev1";
const APP_A = "appA";
const APP_B = "appB";

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

/** Users and apps only. No wallet: every coin must arrive through a grant. */
async function seedWorld() {
  const batch = db.batch();
  batch.set(db.doc(`users/${ADMIN}`), { uid: ADMIN, role: "admin" });
  batch.set(db.doc(`users/${DEV}`), { uid: DEV });
  batch.set(db.doc(`users/${TESTER}`), { uid: TESTER });
  for (const appId of [APP_A, APP_B]) {
    batch.set(db.doc(`apps/${appId}`), { ownerId: DEV, status: "approved", appName: appId });
  }
  await batch.commit();
}

const grant = (amount, key) =>
  runAdminGrant(db, {
    targetUserId: TESTER,
    amount,
    reason: "reconciliation test",
    idempotencyKey: key,
    adminUid: ADMIN,
  });

const claim = (appId) => runClaimCommitment(db, { appId, testerId: TESTER });

/** Fourteen real check-ins, one per local day, at noon in the pinned zone. */
async function completeByCheckIns(assignmentId) {
  const a = (await db.doc(`testingAssignments/${assignmentId}`).get()).data();
  let outcome;
  for (let i = 0; i < COMMITMENT_DAYS_REQUIRED; i += 1) {
    const noon = startOfLocalDayMillis(addDays(a.firstEligibleDayKey, i), a.timeZone) +
      12 * 60 * 60 * 1000;
    outcome = await runRecordTestingDay(db, { assignmentId, testerId: TESTER, nowMillis: noon });
  }
  return outcome;
}

/** Forfeit once both deadlines have genuinely passed. */
const forfeitExpired = (assignmentId) =>
  runForfeitCommitment(db, {
    assignmentId,
    actorId: "system",
    actorKind: "system",
    nowMillis: Date.now() + 30 * MILLIS_PER_DAY,
  });

/** Cancel now: the claim above just opened this window. */
const cancelNow = (assignmentId) =>
  runCancelCommitment(db, { assignmentId, actorId: TESTER, actorKind: "user", isAdmin: false });

/**
 * The cached wallet must equal the ledger fold - according to the production
 * report AND to an independent fold of the ledger read back from Firestore -
 * and both must equal the totals the lifecycle should have produced.
 */
async function assertReconciles(expected, label) {
  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.matches, true, `${label}: ${JSON.stringify(report.differences)}`);
  assert.deepEqual(report.differences, []);
  assert.equal(report.legacyLedgerEntries.count, 0, `${label}: no reward-era entries`);
  assert.equal(report.unreadableLedgerEntries.count, 0, `${label}: every entry folded`);
  assert.equal(report.truncated, false);
  assert.equal(report.repaired, false, "reconciliation never writes");

  const cached = (await db.doc(walletPath(TESTER)).get()).data();
  const ledger = await db.collection(`users/${TESTER}/coinTransactions`).get();
  const { wallet: folded } = foldLedger(ledger.docs.map((d) => ({ id: d.id, ...d.data() })));
  const diff = diffWallets(cached, folded);
  assert.equal(diff.matches, true, `${label}: ${JSON.stringify(diff.differences)}`);

  for (const [field, value] of Object.entries(expected)) {
    assert.equal(cached[field], value, `${label}: cached ${field}`);
    assert.equal(folded[field], value, `${label}: folded ${field}`);
  }
  assert.equal(checkInvariants(cached).ok, true, `${label}: invariant`);
  return { cached, ledgerIds: ledger.docs.map((d) => d.id).sort() };
}

test.beforeEach(clearFirestore);
test.after(async () => {
  await Promise.all(admin.apps.map((app) => app && app.delete()));
});

test("grant -> lock -> unlock (14 real check-ins) -> reconcile", async () => {
  await seedWorld();
  await grant(50, "k1");
  const c = await claim(APP_A);
  await assertReconciles({ available: 0, locked: 50, forfeitedTotal: 0 }, "after lock");

  const last = await completeByCheckIns(c.assignmentId);
  assert.equal(last.completed, true, "the fourteenth day settles the commitment");

  const { ledgerIds } = await assertReconciles(
    { available: 50, locked: 0, forfeitedTotal: 0, adjustmentNet: 50, ledgerCount: 3 },
    "after unlock",
  );
  assert.deepEqual(ledgerIds, [`grant_k1`, `lock_${c.assignmentId}`, `unlock_${c.assignmentId}`].sort());
});

test("grant -> lock -> forfeit -> reconcile", async () => {
  await seedWorld();
  await grant(50, "k1");
  const c = await claim(APP_A);

  await forfeitExpired(c.assignmentId);

  const { ledgerIds } = await assertReconciles(
    { available: 0, locked: 0, forfeitedTotal: 50, adjustmentNet: 50, ledgerCount: 3 },
    "after forfeit",
  );
  assert.deepEqual(ledgerIds, [`forfeit_${c.assignmentId}`, `grant_k1`, `lock_${c.assignmentId}`].sort());
});

test("grant -> lock -> cancel -> reconcile", async () => {
  await seedWorld();
  await grant(50, "k1");
  const c = await claim(APP_A);

  await cancelNow(c.assignmentId);

  const { ledgerIds } = await assertReconciles(
    { available: 50, locked: 0, forfeitedTotal: 0, adjustmentNet: 50, ledgerCount: 3 },
    "after cancel",
  );
  assert.deepEqual(ledgerIds, [`cancel_${c.assignmentId}`, `grant_k1`, `lock_${c.assignmentId}`].sort());
});

test("all three settlements on one wallet, across cycles and apps, still reconcile", async () => {
  await seedWorld();
  await grant(100, "k1");

  // App A cycle 1 completes, cycle 2 is cancelled, cycle 3 forfeits;
  // App B stays live and locked throughout.
  const a1 = await claim(APP_A);
  const b1 = await claim(APP_B);
  await assertReconciles({ available: 0, locked: 100, forfeitedTotal: 0 }, "two live");

  await completeByCheckIns(a1.assignmentId);
  await assertReconciles({ available: 50, locked: 50, forfeitedTotal: 0 }, "a1 done");

  const a2 = await claim(APP_A);
  assert.equal(a2.cycle, 2);
  await cancelNow(a2.assignmentId);
  await assertReconciles({ available: 50, locked: 50, forfeitedTotal: 0 }, "a2 cancelled");

  const a3 = await claim(APP_A);
  assert.equal(a3.cycle, 3);
  await forfeitExpired(a3.assignmentId);

  await assertReconciles(
    { available: 0, locked: 50, forfeitedTotal: 50, adjustmentNet: 100, ledgerCount: 8 },
    "final",
  );
  assert.equal(
    (await db.doc(`testingAssignments/${b1.assignmentId}`).get()).get("status"),
    "ready",
    "the untouched commitment stayed live",
  );
});

test("a refused late cancellation leaves the wallet reconciled and untouched", async () => {
  await seedWorld();
  await grant(50, "k1");
  const c = await claim(APP_A);
  const before = await assertReconciles({ available: 0, locked: 50 }, "before");

  await assert.rejects(
    runCancelCommitment(db, {
      assignmentId: c.assignmentId,
      actorId: TESTER,
      actorKind: "user",
      nowMillis: Date.now() + 30 * MILLIS_PER_DAY,
    }),
    /closed short/,
  );

  const after = await assertReconciles({ available: 0, locked: 50 }, "after refusal");
  assert.deepEqual(after.ledgerIds, before.ledgerIds, "no entry written by a refusal");
});

/**
 * Retiring reward-era test assignments, against the real Firestore emulator.
 *
 * The point of this file is the NEGATIVE space: the close-out must end two
 * dead assignments and do nothing else. So besides checking the two status
 * flips, every test that closes something also proves that no wallet
 * document, no ledger entry and no testing log appeared or disappeared.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { configureFirestore } = require("../lib/firestore");

const { runLegacyCloseOut } = require("../legacyCloseOut");
const {
  LEGACY_TEST_APP_ID,
  LEGACY_CLOSE_OUT_ASSIGNMENT_IDS,
  LEGACY_CLOSE_OUT_REASON,
} = require("../lib/legacyCloseOut");
const { activeClaimId, lockEntryId } = require("../lib/commitments");
const { checkInvariants } = require("../lib/wallet");

const PROJECT_ID = "apptesting-concurrency-test";
const [A1, A2] = LEGACY_CLOSE_OUT_ASSIGNMENT_IDS;
const APP = LEGACY_TEST_APP_ID;
const T1 = A1.slice(APP.length + 2);
const T2 = A2.slice(APP.length + 2);
const DEV = "devLegacy";
const ADMIN = "adminLegacy";
const MEMBER = "memberLegacy";
const A1_LOG = `${A1}__2026-09-19`;
const CREATED = Timestamp.fromMillis(Date.parse("2026-09-19T08:06:05Z"));

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

/** Production as it stood on 2026-09-23, field for field. */
async function seedProduction() {
  const batch = db.batch();
  batch.set(db.doc(`users/${ADMIN}`), { uid: ADMIN, role: "admin" });
  batch.set(db.doc(`users/${MEMBER}`), { uid: MEMBER });
  batch.set(db.doc(`users/${T1}`), { uid: T1, role: "admin" });
  batch.set(db.doc(`users/${T2}`), { uid: T2 });
  batch.set(db.doc(`users/${DEV}`), { uid: DEV, role: "admin" });
  batch.set(db.doc(`apps/${APP}`), {
    appName: "h", ownerId: DEV, status: "approved", testerCount: 2,
  });
  const common = {
    appId: APP, developerId: DEV, groupId: "app_testing_official",
    coinReward: 50, daysRequired: 14, createdAt: CREATED, updatedAt: CREATED,
  };
  batch.set(db.doc(`testingAssignments/${A1}`), {
    ...common, testerId: T1, status: "inProgress", daysCompleted: 1,
  });
  batch.set(db.doc(`testingAssignments/${A2}`), {
    ...common, testerId: T2, status: "ready", daysCompleted: 0,
  });
  batch.set(db.doc(`testingLogs/${A1_LOG}`), {
    assignmentId: A1, testerId: T1, date: "2026-09-19", createdAt: CREATED,
  });
  await batch.commit();
}

async function countGroup(name) {
  return (await db.collectionGroup(name).count().get()).data().count;
}

/** Everything the close-out must never create or remove. */
async function snapshotUntouchables() {
  const [app, log, logs, wallets, ledger, claims] = await Promise.all([
    db.doc(`apps/${APP}`).get(),
    db.doc(`testingLogs/${A1_LOG}`).get(),
    db.collection("testingLogs").count().get(),
    countGroup("wallet"),
    countGroup("coinTransactions"),
    db.collection("activeClaims").count().get(),
  ]);
  return {
    app: app.data(),
    log: log.exists ? log.data() : null,
    logCount: logs.data().count,
    wallets,
    ledger,
    claims: claims.data().count,
  };
}

test.beforeEach(async () => {
  await clearFirestore();
  await seedProduction();
});

test("A1 and A2 both close, with ZERO wallet, ledger or log changes", async () => {
  const before = await snapshotUntouchables();

  const r1 = await runLegacyCloseOut(db, { assignmentId: A1, adminUid: ADMIN });
  const r2 = await runLegacyCloseOut(db, { assignmentId: A2, adminUid: ADMIN });
  assert.deepEqual(r1, { assignmentId: A1, closed: true, previousStatus: "inProgress", claimRemoved: false });
  assert.deepEqual(r2, { assignmentId: A2, closed: true, previousStatus: "ready", claimRemoved: false });

  for (const [id, prev] of [[A1, "inProgress"], [A2, "ready"]]) {
    const doc = (await db.doc(`testingAssignments/${id}`).get()).data();
    assert.equal(doc.status, "cancelled");
    assert.equal(doc.cancelledBy, ADMIN);
    assert.ok(doc.cancelledAt instanceof Timestamp);
    assert.equal(doc.legacyCloseOut.reason, LEGACY_CLOSE_OUT_REASON);
    assert.equal(doc.legacyCloseOut.previousStatus, prev);
    assert.equal(doc.legacyCloseOut.closedBy, ADMIN);
    // Retirement, not settlement: none of the money fields appear.
    for (const f of ["lockTxId", "commitmentAmount", "settlementTxId", "cycle"]) {
      assert.equal(doc[f], undefined, `${id} must not gain ${f}`);
    }
    // History fields survive untouched.
    assert.equal(doc.coinReward, 50);
    assert.equal(doc.daysCompleted, id === A1 ? 1 : 0);
  }

  const after = await snapshotUntouchables();
  assert.deepEqual(after, before);
  assert.equal(after.wallets, 0);
  assert.equal(after.ledger, 0);
  assert.equal(after.logCount, 1);
});

test("a second run is a no-op that writes nothing at all", async () => {
  await runLegacyCloseOut(db, { assignmentId: A1, adminUid: ADMIN });
  const first = (await db.doc(`testingAssignments/${A1}`).get());
  const before = await snapshotUntouchables();

  const again = await runLegacyCloseOut(db, { assignmentId: A1, adminUid: ADMIN });
  assert.deepEqual(again, { assignmentId: A1, closed: false, reason: "alreadyClosed" });

  const second = (await db.doc(`testingAssignments/${A1}`).get());
  assert.ok(second.updateTime.isEqual(first.updateTime), "document must not be rewritten");
  assert.deepEqual(await snapshotUntouchables(), before);
});

test("concurrent runs on one assignment close it exactly once", async () => {
  const outcomes = await Promise.all(
    Array.from({ length: 5 }, () => runLegacyCloseOut(db, { assignmentId: A2, adminUid: ADMIN })),
  );
  assert.equal(outcomes.filter((o) => o.closed).length, 1);
  assert.equal(outcomes.filter((o) => o.reason === "alreadyClosed").length, 4);
  assert.equal(await countGroup("coinTransactions"), 0);
  assert.equal(await countGroup("wallet"), 0);
});

test("a non-admin operator is refused and nothing changes", async () => {
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: A1, adminUid: MEMBER }),
    (err) => err.code === "permission-denied",
  );
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: A1, adminUid: "noProfile" }),
    (err) => err.code === "permission-denied",
  );
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: A1, adminUid: "" }),
    (err) => err.code === "unauthenticated",
  );
  assert.equal((await db.doc(`testingAssignments/${A1}`).get()).get("status"), "inProgress");
});

test("a suspended admin is refused", async () => {
  await db.doc(`users/${ADMIN}`).update({ isSuspended: true });
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: A2, adminUid: ADMIN }),
    (err) => err.code === "permission-denied",
  );
});

test("an assignment carrying lockTxId is refused", async () => {
  await db.doc(`testingAssignments/${A2}`).update({ lockTxId: lockEntryId(A2) });
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: A2, adminUid: ADMIN }),
    (err) => err.code === "failed-precondition" && /lockTxId/.test(err.message),
  );
  assert.equal((await db.doc(`testingAssignments/${A2}`).get()).get("status"), "ready");
});

test("an assignment carrying commitmentAmount is refused", async () => {
  await db.doc(`testingAssignments/${A2}`).update({ commitmentAmount: 50 });
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: A2, adminUid: ADMIN }),
    (err) => err.code === "failed-precondition" && /commitmentAmount/.test(err.message),
  );
});

test("a lock entry in the tester's ledger refuses the close-out", async () => {
  await db.doc(`users/${T2}/coinTransactions/${lockEntryId(A2)}`).set({ kind: "lock", amount: 50 });
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: A2, adminUid: ADMIN }),
    (err) => /coin lock/.test(err.message),
  );
  assert.equal((await db.doc(`testingAssignments/${A2}`).get()).get("status"), "ready");
});

test("an assignment that does not belong to the placeholder app is refused", async () => {
  await db.doc(`testingAssignments/${A2}`).update({ appId: "realApp" });
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: A2, adminUid: ADMIN }),
    (err) => /legacy test app/.test(err.message),
  );
  // And any id that is not on the allow-list, legacy-shaped or not.
  const other = `${APP}__someoneElse`;
  await db.doc(`testingAssignments/${other}`).set({
    appId: APP, testerId: "someoneElse", status: "ready", coinReward: 50,
  });
  await assert.rejects(
    runLegacyCloseOut(db, { assignmentId: other, adminUid: ADMIN }),
    (err) => err.code === "permission-denied",
  );
  assert.equal((await db.doc(`testingAssignments/${other}`).get()).get("status"), "ready");
});

test("a claim for this exact assignment is removed with it", async () => {
  const claimRef = db.doc(`activeClaims/${activeClaimId(APP, T2)}`);
  await claimRef.set({ assignmentId: A2, appId: APP, testerId: T2 });
  const r = await runLegacyCloseOut(db, { assignmentId: A2, adminUid: ADMIN });
  assert.equal(r.claimRemoved, true);
  assert.equal((await claimRef.get()).exists, false);
  assert.equal(await countGroup("coinTransactions"), 0);
});

test("a claim for a DIFFERENT (live) assignment and its wallet are left untouched", async () => {
  // T1 has since started a real commitment on the same app: cycle 1, 50 locked.
  const live = `${APP}__${T1}__c1`;
  const claimRef = db.doc(`activeClaims/${activeClaimId(APP, T1)}`);
  const walletRef = db.doc(`users/${T1}/wallet/balance`);
  const wallet = {
    available: 100, locked: 50, forfeitedTotal: 0, purchasedTotal: 0,
    adjustmentNet: 150, ledgerCount: 2, schemaVersion: 2,
  };
  await claimRef.set({ assignmentId: live, appId: APP, testerId: T1, cycle: 1, commitmentAmount: 50 });
  await walletRef.set(wallet);

  const r = await runLegacyCloseOut(db, { assignmentId: A1, adminUid: ADMIN });
  assert.equal(r.closed, true);
  assert.equal(r.claimRemoved, false);
  assert.equal((await claimRef.get()).get("assignmentId"), live);
  assert.deepEqual((await walletRef.get()).data(), wallet);
  assert.equal(checkInvariants(wallet).ok, true);
  assert.equal(await countGroup("coinTransactions"), 0);
});

test("the legacy testing log survives, byte for byte", async () => {
  const before = await db.doc(`testingLogs/${A1_LOG}`).get();
  await runLegacyCloseOut(db, { assignmentId: A1, adminUid: ADMIN });
  const after = await db.doc(`testingLogs/${A1_LOG}`).get();
  assert.ok(after.exists);
  assert.deepEqual(after.data(), before.data());
  assert.ok(after.updateTime.isEqual(before.updateTime));
});

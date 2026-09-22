/**
 * Automatic expiry under real Firestore concurrency.
 *
 * The pure decision is proven in test/expiry.test.js against a fake. What only
 * the emulator can prove is what happens when two transactions want mutually
 * exclusive outcomes at the same instant - because that is decided by
 * Firestore's transaction serialization, not by anything in this codebase.
 *
 * THE RACE THAT MATTERS
 *
 *     Process A: records the 14th qualifying day  -> completes, unlocks 50
 *     Process B: evaluates expiry                 -> forfeits, consumes 50
 *
 * Both are legitimate. Exactly one may win, and the loser must leave no trace.
 * The failure mode being guarded against is not "the wrong one won" - either
 * outcome is defensible - it is BOTH winning: 50 coins returned to the
 * tester's available balance AND 50 added to forfeitedTotal, from a stake of
 * 50. That mints coins, breaks the wallet invariant, and would be invisible
 * until someone reconciled the ledger.
 *
 * A single race proves nothing; a race that resolves correctly once can still
 * be a coin flip. So the decisive tests run many independent rounds.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const { runForfeitCommitment } = require("../commitments");
const { runRecordTestingDay } = require("../testingDays");
const { runExpirySweep, evaluateAssignmentExpiry } = require("../expiry");
const { runDeclareOutage } = require("../systemHealth");
const {
  cycleAssignmentId,
  activeClaimId,
  lockEntryId,
  unlockEntryId,
  forfeitEntryId,
} = require("../lib/commitments");
const {
  deriveWindow,
  addDays,
  startOfLocalDayMillis,
  testingLogId,
} = require("../lib/testingDays");
const { OUTAGE_SCOPE_GLOBAL, OUTAGE_SCOPE_APP } = require("../lib/outages");
const { checkInvariants } = require("../lib/wallet");
const { COMMITMENT_DAYS_REQUIRED, COMMITMENT_WINDOW_DAYS } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const IST = "Asia/Kolkata";
const APP = "app1";
const OTHER_APP = "app2";
const TESTER = "tester1";
const DEV = "dev1";
const C1 = cycleAssignmentId(APP, TESTER, 1);

const CLAIMED_AT = Date.parse("2026-03-01T06:00:00Z");
const W = deriveWindow({ claimedAtMillis: CLAIMED_AT, timeZone: IST });

const assignmentPath = (id = C1) => `testingAssignments/${id}`;
const claimPath = () => `activeClaims/${activeClaimId(APP, TESTER)}`;
const walletPath = () => `users/${TESTER}/wallet/balance`;
const ledgerPath = (id) => `users/${TESTER}/coinTransactions/${id}`;

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

/**
 * A live commitment with `done` qualifying days already logged.
 *
 * The logs are real documents, because settlement recounts from them rather
 * than trusting the cached figure - seeding only the counter would test a
 * state the system never actually reaches.
 */
async function seedCommitment({ done = 13, status = "inProgress", appId = APP } = {}) {
  const batch = db.batch();
  batch.set(db.doc(`users/${TESTER}`), { uid: TESTER });
  batch.set(db.doc(`users/${DEV}`), { uid: DEV });
  batch.set(db.doc(`apps/${appId}`), { ownerId: DEV, status: "approved", testerCount: 1 });
  batch.set(db.doc(assignmentPath()), {
    appId,
    testerId: TESTER,
    developerId: DEV,
    cycle: 1,
    commitmentAmount: 50,
    daysRequired: COMMITMENT_DAYS_REQUIRED,
    windowDays: COMMITMENT_WINDOW_DAYS,
    timeZone: W.timeZone,
    timeZoneSource: "default",
    claimedDayKey: W.claimedDayKey,
    firstEligibleDayKey: W.firstEligibleDayKey,
    lastEligibleDayKey: W.lastEligibleDayKey,
    windowEndsAt: Timestamp.fromMillis(W.windowEndsAtMillis),
    creditedOutageDays: 0,
    qualifyingDays: done,
    daysCompleted: done,
    status,
    lockTxId: lockEntryId(C1),
    settlementTxId: null,
    createdAt: Timestamp.fromMillis(CLAIMED_AT),
  });
  batch.set(db.doc(claimPath()), {
    assignmentId: C1,
    appId,
    testerId: TESTER,
    cycle: 1,
    commitmentAmount: 50,
  });
  batch.set(db.doc(walletPath()), {
    available: 0,
    locked: 50,
    forfeitedTotal: 0,
    purchasedTotal: 0,
    adjustmentNet: 50,
    ledgerCount: 1,
    schemaVersion: 2,
  });
  for (let i = 0; i < done; i += 1) {
    const key = addDays(W.firstEligibleDayKey, i);
    batch.set(db.doc(`testingLogs/${testingLogId(C1, key)}`), {
      assignmentId: C1,
      cycle: 1,
      appId,
      testerId: TESTER,
      date: key,
      timeZone: IST,
      createdAt: Timestamp.fromMillis(startOfLocalDayMillis(key, IST) + 3600000),
    });
  }
  await batch.commit();
}

/** The instant the pinned window shuts: IST midnight after the last day. */
const boundary = (lastKey = W.lastEligibleDayKey) =>
  startOfLocalDayMillis(addDays(lastKey, 1), IST);

/** Noon IST on the Nth eligible day (1-based). */
const atEligibleDay = (n) =>
  startOfLocalDayMillis(addDays(W.firstEligibleDayKey, n - 1), IST) + 12 * 3600 * 1000;

async function observe() {
  const [assignment, wallet, claims, logs, ledger] = await Promise.all([
    db.doc(assignmentPath()).get(),
    db.doc(walletPath()).get(),
    db.collection("activeClaims").where("assignmentId", "==", C1).get(),
    db.collection("testingLogs").where("assignmentId", "==", C1).get(),
    db.collection(`users/${TESTER}/coinTransactions`).get(),
  ]);
  return {
    status: assignment.get("status"),
    settlementTxId: assignment.get("settlementTxId"),
    qualifyingDays: assignment.get("qualifyingDays"),
    creditedOutageDays: assignment.get("creditedOutageDays"),
    wallet: wallet.data(),
    claimCount: claims.size,
    logCount: logs.size,
    ledgerIds: ledger.docs.map((d) => d.id).sort(),
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

/**
 * The invariant that this whole file exists to protect.
 *
 * A stake of 50 either comes back or is consumed. Both is impossible, neither
 * leaves it stranded, and the wallet must balance in every case.
 */
function assertExactlyOneTerminalOutcome(state, label = "") {
  const prefix = label ? `${label}: ` : "";
  const unlocked = state.ledgerIds.includes(unlockEntryId(C1));
  const forfeited = state.ledgerIds.includes(forfeitEntryId(C1));

  assert.ok(
    !(unlocked && forfeited),
    `${prefix}the stake was BOTH returned and consumed — 50 coins were minted`,
  );

  if (unlocked) {
    assert.equal(state.status, "completed", `${prefix}unlocked but not completed`);
    assert.equal(state.settlementTxId, unlockEntryId(C1));
    assert.equal(state.wallet.available, 50, `${prefix}the same 50 coins came back`);
    assert.equal(state.wallet.locked, 0);
    assert.equal(state.wallet.forfeitedTotal, 0, `${prefix}nothing may be forfeited too`);
  } else if (forfeited) {
    assert.equal(state.status, "failed", `${prefix}forfeited but not failed`);
    assert.equal(state.settlementTxId, forfeitEntryId(C1));
    assert.equal(state.wallet.available, 0, `${prefix}no partial refund`);
    assert.equal(state.wallet.locked, 0);
    assert.equal(state.wallet.forfeitedTotal, 50);
  }

  // Never more than one settlement entry of either kind.
  const settlements = state.ledgerIds.filter(
    (id) => id === unlockEntryId(C1) || id === forfeitEntryId(C1),
  );
  assert.ok(settlements.length <= 1, `${prefix}two settlements: ${settlements}`);

  assert.ok(state.wallet.locked >= 0, `${prefix}locked went negative`);
  assert.ok(state.wallet.available >= 0, `${prefix}available went negative`);
  assert.ok(state.wallet.forfeitedTotal >= 0, `${prefix}forfeitedTotal went negative`);
  assertInvariant(state.wallet, label);

  if (unlocked || forfeited) {
    assert.equal(state.claimCount, 0, `${prefix}a settled commitment left its claim behind`);
  }
}

async function settled(promises) {
  const results = await Promise.allSettled(promises);
  return {
    fulfilled: results.filter((r) => r.status === "fulfilled"),
    rejected: results.filter((r) => r.status === "rejected"),
  };
}

test.beforeEach(clearFirestore);
test.after(async () => {
  await Promise.all(admin.apps.map((app) => app && app.delete()));
});

// ---------------------------------------------------------------------------
// A. The happy path, for real
// ---------------------------------------------------------------------------

test("A: an expired short commitment is forfeited exactly once", async () => {
  await seedCommitment({ done: 3 });
  const summary = await runExpirySweep(db, { nowMillis: boundary() });

  assert.equal(summary.forfeitedCount, 1);
  assert.equal(summary.coinsForfeited, 50);

  const state = await observe();
  assert.equal(state.status, "failed");
  assert.equal(state.qualifyingDays, 3, "recounted from the logs");
  assert.deepEqual(state.ledgerIds, [forfeitEntryId(C1)]);
  assert.equal(state.claimCount, 0, "the active claim is released");
  assert.equal(state.logCount, 3, "the tester's work is not deleted");
  assertExactlyOneTerminalOutcome(state);
});

test("A: the sweep is a no-op while the window is still open", async () => {
  await seedCommitment({ done: 3 });
  const summary = await runExpirySweep(db, { nowMillis: boundary() - 1 });

  assert.equal(summary.evaluated, 0);
  const state = await observe();
  assert.equal(state.status, "inProgress");
  assert.equal(state.wallet.locked, 50);
  assert.deepEqual(state.ledgerIds, []);
});

// ---------------------------------------------------------------------------
// B. Idempotency
// ---------------------------------------------------------------------------

test("B: ten sequential sweeps settle once and move 50 coins once", async () => {
  await seedCommitment({ done: 3 });
  for (let i = 0; i < 10; i += 1) await runExpirySweep(db, { nowMillis: boundary() });

  const state = await observe();
  assert.deepEqual(state.ledgerIds, [forfeitEntryId(C1)], "never ten entries");
  assert.equal(state.wallet.forfeitedTotal, 50, "never 500");
  assertExactlyOneTerminalOutcome(state);
});

test("B: ten CONCURRENT sweeps settle exactly once", async () => {
  await seedCommitment({ done: 3 });
  await settled(
    Array.from({ length: 10 }, () => runExpirySweep(db, { nowMillis: boundary() })),
  );

  const state = await observe();
  assert.deepEqual(state.ledgerIds, [forfeitEntryId(C1)]);
  assert.equal(state.wallet.forfeitedTotal, 50);
  assertExactlyOneTerminalOutcome(state);
});

test("B: TWO concurrent forfeitures settle exactly once", async () => {
  // The minimal race, stated separately from the ten-way pile-up: two is the
  // smallest case that can double-settle, and it is the one that actually
  // happens in production when a retry overlaps the original invocation.
  await seedCommitment({ done: 3 });
  const outcome = await settled([
    runForfeitCommitment(db, {
      assignmentId: C1, actorId: "a", actorKind: "system", nowMillis: boundary(),
    }),
    runForfeitCommitment(db, {
      assignmentId: C1, actorId: "b", actorKind: "system", nowMillis: boundary(),
    }),
  ]);

  assert.equal(outcome.fulfilled.length, 1, "exactly one call may succeed");
  assert.equal(outcome.rejected.length, 1);

  const state = await observe();
  assert.deepEqual(state.ledgerIds, [forfeitEntryId(C1)], "one entry, never two");
  assert.equal(state.wallet.forfeitedTotal, 50, "never 100");
  assert.equal(state.wallet.locked, 0);
  assertExactlyOneTerminalOutcome(state);
});

test("B: the two-way race holds across 10 independent rounds", async () => {
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 3 });
    const outcome = await settled([
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "a", actorKind: "system", nowMillis: boundary(),
      }),
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "b", actorKind: "system", nowMillis: boundary(),
      }),
    ]);
    assert.equal(outcome.fulfilled.length, 1, `round ${round}: exactly one winner`);
    const state = await observe();
    assert.equal(state.wallet.forfeitedTotal, 50, `round ${round}`);
    assertExactlyOneTerminalOutcome(state, `round ${round}`);
  }
});

test("B: repeated SCHEDULED invocation after settlement is a clean no-op", async () => {
  // What a Cloud Functions retry, or an overlapping scheduled run, actually
  // looks like: the sweep fires again against an already-settled commitment.
  await seedCommitment({ done: 3 });
  const first = await runExpirySweep(db, { nowMillis: boundary() });
  assert.equal(first.forfeitedCount, 1);

  for (let i = 0; i < 5; i += 1) {
    const again = await runExpirySweep(db, { nowMillis: boundary() + i * 86400000 });
    assert.equal(again.forfeitedCount, 0, `re-run ${i} must settle nothing`);
    assert.equal(again.failedCount, 0, `re-run ${i}: already settled is not an error`);
  }

  const state = await observe();
  assert.deepEqual(state.ledgerIds, [forfeitEntryId(C1)]);
  assert.equal(state.wallet.forfeitedTotal, 50);
  assertExactlyOneTerminalOutcome(state);
});

test("B: ten concurrent DIRECT forfeitures settle exactly once", async () => {
  await seedCommitment({ done: 3 });
  const outcome = await settled(
    Array.from({ length: 10 }, () =>
      runForfeitCommitment(db, {
        assignmentId: C1,
        actorId: "system",
        actorKind: "system",
        nowMillis: boundary(),
      }),
    ),
  );

  assert.equal(outcome.fulfilled.length, 1, "exactly one call may succeed");
  assert.equal(outcome.rejected.length, 9);

  const state = await observe();
  assert.deepEqual(state.ledgerIds, [forfeitEntryId(C1)]);
  assert.equal(state.wallet.forfeitedTotal, 50);
  assertExactlyOneTerminalOutcome(state);
});

test("B: idempotency holds across 10 independent rounds", async () => {
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 2 });
    await settled([
      runExpirySweep(db, { nowMillis: boundary() }),
      runExpirySweep(db, { nowMillis: boundary() }),
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: boundary(),
      }),
    ]);
    const state = await observe();
    assert.equal(state.wallet.forfeitedTotal, 50, `round ${round}`);
    assertExactlyOneTerminalOutcome(state, `round ${round}`);
  }
});

// ---------------------------------------------------------------------------
// C. THE RACE: completion versus forfeiture
// ---------------------------------------------------------------------------

test("C: the 14th day racing the expiry sweep produces ONE terminal outcome", async () => {
  // Day 14 is still inside the window, and the sweep is evaluating at the
  // instant it shuts. Both paths have a legitimate claim on the same 50 coins.
  await seedCommitment({ done: 13 });

  await settled([
    runRecordTestingDay(db, {
      assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
    }),
    runExpirySweep(db, { nowMillis: boundary() }),
  ]);

  const state = await observe();
  assertExactlyOneTerminalOutcome(state);
  assert.ok(
    state.status === "completed" || state.status === "failed",
    `expected a terminal status, got ${state.status}`,
  );
});

test("C: the completion/forfeiture race holds across 20 independent rounds", async () => {
  // One race resolving correctly can still be luck. Twenty cannot.
  const outcomes = { completed: 0, failed: 0, neither: 0 };

  for (let round = 0; round < 20; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 13 });

    await settled([
      runRecordTestingDay(db, {
        assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
      }),
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: boundary(),
      }),
    ]);

    const state = await observe();
    assertExactlyOneTerminalOutcome(state, `round ${round}`);
    if (state.status === "completed") outcomes.completed += 1;
    else if (state.status === "failed") outcomes.failed += 1;
    else outcomes.neither += 1;
  }

  // Either outcome is defensible; both at once is not, and that is what
  // assertExactlyOneTerminalOutcome checked on every round.
  assert.equal(
    outcomes.completed + outcomes.failed,
    20,
    `every round must reach a terminal state: ${JSON.stringify(outcomes)}`,
  );
});

test("C: ten-way completion-versus-forfeiture pile-up still settles once", async () => {
  await seedCommitment({ done: 13 });

  await settled([
    ...Array.from({ length: 5 }, () =>
      runRecordTestingDay(db, {
        assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
      }),
    ),
    ...Array.from({ length: 5 }, () =>
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: boundary(),
      }),
    ),
  ]);

  const state = await observe();
  assertExactlyOneTerminalOutcome(state);
  assert.equal(state.logCount <= 14, true, "no duplicate testing day was created");
});

test("C: a commitment that completed FIRST can never then be forfeited", async () => {
  await seedCommitment({ done: 13 });
  const done = await runRecordTestingDay(db, {
    assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
  });
  assert.equal(done.completed, true);
  assert.equal(done.unlockedAmount, 50);

  // Long after the window shut, the sweep must leave it alone.
  const summary = await runExpirySweep(db, { nowMillis: boundary() + 30 * 86400000 });
  assert.equal(summary.forfeitedCount, 0);

  const state = await observe();
  assert.equal(state.status, "completed");
  assert.equal(state.wallet.available, 50, "the coins stay returned");
  assert.equal(state.wallet.forfeitedTotal, 0);
  assertExactlyOneTerminalOutcome(state);
});

test("C: a commitment that was forfeited FIRST can never then complete", async () => {
  await seedCommitment({ done: 13 });
  await runForfeitCommitment(db, {
    assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: boundary(),
  });

  // The tester tries to log day 14 after the window shut.
  await assert.rejects(
    runRecordTestingDay(db, {
      assignmentId: C1, testerId: TESTER, nowMillis: boundary() + 3600000,
    }),
  );

  const state = await observe();
  assert.equal(state.status, "failed");
  assert.equal(state.wallet.forfeitedTotal, 50);
  assert.equal(state.wallet.available, 0, "no coins may come back");
  assertExactlyOneTerminalOutcome(state);
});

// ---------------------------------------------------------------------------
// D. THE OUTAGE RACE
// ---------------------------------------------------------------------------

const declareGlobal = (dayKey) =>
  runDeclareOutage(db, {
    dayKey, degraded: true, reason: "emulator test",
    scope: OUTAGE_SCOPE_GLOBAL, appId: null, adminUid: "admin1",
  });

const declareForApp = (dayKey, appId) =>
  runDeclareOutage(db, {
    dayKey, degraded: true, reason: "emulator test",
    scope: OUTAGE_SCOPE_APP, appId, adminUid: "admin1",
  });

test("D: a global outage declared BEFORE the sweep protects the stake", async () => {
  await seedCommitment({ done: 3 });
  await declareGlobal("2026-03-10");

  const summary = await runExpirySweep(db, { nowMillis: boundary() });
  assert.equal(summary.forfeitedCount, 0);
  assert.equal(summary.skippedCount, 1, "a candidate, correctly declined");

  const state = await observe();
  assert.equal(state.status, "inProgress");
  assert.equal(state.wallet.forfeitedTotal, 0);
  assert.equal(state.wallet.locked, 50);
  assert.equal(state.claimCount, 1, "the claim stays live");
  assertInvariant(state.wallet);
});

test("D: a global outage declared CONCURRENTLY with the sweep is honoured or harmless", async () => {
  // The declaration and the evaluation land at the same instant. The outage
  // documents are read INSIDE the forfeiture transaction, so a declaration
  // that commits first forces the transaction to retry and see it. Whichever
  // order the two land in, the result must be consistent with the
  // declarations that exist afterwards - never a forfeiture that a visible
  // outage should have prevented.
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 3 });

    await settled([
      declareGlobal("2026-03-10"),
      runExpirySweep(db, { nowMillis: boundary() }),
    ]);

    const state = await observe();
    const health = await db.doc("systemHealth/2026-03-10").get();
    const outageVisible = health.exists && health.get("degraded") === true;

    assertInvariant(state.wallet, `round ${round}`);
    assert.ok(state.wallet.locked >= 0, `round ${round}: locked went negative`);

    if (state.status === "failed") {
      // A forfeiture is only defensible if it was decided before the
      // declaration was durable. Re-evaluating now must agree that, WITH the
      // outage, the window had not closed - and the stake must still have
      // moved exactly once.
      assert.equal(state.wallet.forfeitedTotal, 50, `round ${round}`);
      assert.deepEqual(state.ledgerIds, [forfeitEntryId(C1)], `round ${round}`);
    } else {
      assert.equal(state.wallet.forfeitedTotal, 0, `round ${round}: protected but charged`);
      assert.equal(state.wallet.locked, 50, `round ${round}`);
      assert.ok(outageVisible, `round ${round}: spared without a visible outage`);
    }
    assertExactlyOneTerminalOutcome(state, `round ${round}`);
  }
});

test("D: an outage declared while a forfeiture is in flight is not lost", async () => {
  // The declaration commits first, then the sweep runs. The sweep MUST see it.
  await seedCommitment({ done: 3 });
  await declareGlobal("2026-03-10");
  const summary = await runExpirySweep(db, { nowMillis: boundary() });

  assert.equal(summary.forfeitedCount, 0);
  const state = await observe();
  assert.equal(state.wallet.forfeitedTotal, 0);

  // And once the EXTENDED window shuts, it does forfeit - with the credit
  // recorded on the settled assignment.
  const after = await runExpirySweep(db, { nowMillis: boundary("2026-03-20") });
  assert.equal(after.forfeitedCount, 1);
  const settledState = await observe();
  assert.equal(settledState.creditedOutageDays, 1);
  assertExactlyOneTerminalOutcome(settledState);
});

test("D: an app-scoped outage on THIS app protects it", async () => {
  await seedCommitment({ done: 3 });
  await declareForApp("2026-03-10", APP);

  const summary = await runExpirySweep(db, { nowMillis: boundary() });
  assert.equal(summary.forfeitedCount, 0);
  const state = await observe();
  assert.equal(state.wallet.forfeitedTotal, 0);
  assert.equal(state.wallet.locked, 50);
});

test("D: an outage on an UNRELATED app does NOT protect it", async () => {
  await seedCommitment({ done: 3 });
  await declareForApp("2026-03-10", OTHER_APP);

  const summary = await runExpirySweep(db, { nowMillis: boundary() });
  assert.equal(summary.forfeitedCount, 1, "another app's outage is not this tester's excuse");

  const state = await observe();
  assert.equal(state.status, "failed");
  assert.equal(state.wallet.forfeitedTotal, 50);
  assert.equal(state.creditedOutageDays, 0);
  assertExactlyOneTerminalOutcome(state);
});

test("D: an unrelated-app outage racing the sweep still does not protect it", async () => {
  for (let round = 0; round < 5; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 3 });

    await settled([
      declareForApp("2026-03-10", OTHER_APP),
      runExpirySweep(db, { nowMillis: boundary() }),
    ]);

    const state = await observe();
    assert.equal(state.status, "failed", `round ${round}: it must still forfeit`);
    assert.equal(state.wallet.forfeitedTotal, 50, `round ${round}`);
    assertExactlyOneTerminalOutcome(state, `round ${round}`);
  }
});

test("D: an outage racing the 14th day still cannot produce two settlements", async () => {
  // The nastiest three-way: a check-in completing, a sweep forfeiting, and an
  // outage arriving to change the deadline underneath both.
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 13 });

    await settled([
      runRecordTestingDay(db, {
        assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
      }),
      declareGlobal("2026-03-10"),
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: boundary(),
      }),
    ]);

    const state = await observe();
    assertExactlyOneTerminalOutcome(state, `round ${round}`);
  }
});

// ---------------------------------------------------------------------------
// E. Check-in honours the outage extension too
// ---------------------------------------------------------------------------

test("E: an outage lets the tester check in on a day the raw window excluded", async () => {
  await seedCommitment({ done: 5 });
  await declareGlobal("2026-03-10");

  // 2026-03-20 is one day past the pinned window, inside the extension.
  const inExtension = startOfLocalDayMillis("2026-03-20", IST) + 12 * 3600 * 1000;
  const out = await runRecordTestingDay(db, {
    assignmentId: C1, testerId: TESTER, nowMillis: inExtension,
  });

  assert.equal(out.recorded, true, "the tester must not be refused a day the evaluator credits");
  assert.equal(out.dayKey, "2026-03-20");
  assert.equal(out.qualifyingDays, 6);
});

test("E: without an outage that same day is refused", async () => {
  await seedCommitment({ done: 5 });
  const inExtension = startOfLocalDayMillis("2026-03-20", IST) + 12 * 3600 * 1000;

  await assert.rejects(
    runRecordTestingDay(db, { assignmentId: C1, testerId: TESTER, nowMillis: inExtension }),
    /window has closed/,
  );
  const state = await observe();
  assert.equal(state.qualifyingDays, 5, "no day was recorded");
});

test("E: check-in and expiry agree about the same extended deadline", async () => {
  // The bug this prevents: the check-in path refusing a day that the expiry
  // path then counts the tester as having had - told the window had closed,
  // then punished for not testing in it.
  await seedCommitment({ done: 5 });
  await declareGlobal("2026-03-10");

  const inExtension = startOfLocalDayMillis("2026-03-20", IST) + 12 * 3600 * 1000;
  const recorded = await runRecordTestingDay(db, {
    assignmentId: C1, testerId: TESTER, nowMillis: inExtension,
  });
  assert.equal(recorded.recorded, true);

  // At that same instant, expiry must also say the window is open.
  const verdict = await evaluateAssignmentExpiry(db, {
    assignmentId: C1, nowMillis: inExtension,
  });
  assert.equal(verdict.expired, false);
  assert.equal(verdict.creditedOutageDays, 1);

  const summary = await runExpirySweep(db, { nowMillis: inExtension });
  assert.equal(summary.forfeitedCount, 0);
});

// ---------------------------------------------------------------------------
// F. After forfeiture
// ---------------------------------------------------------------------------

test("F: a forfeited cycle frees the app for a new, distinctly identified cycle", async () => {
  await seedCommitment({ done: 3 });
  await runExpirySweep(db, { nowMillis: boundary() });

  const after = await observe();
  assert.equal(after.claimCount, 0, "the claim is released");

  // The historical assignment survives, readable and intact.
  const old = await db.doc(assignmentPath()).get();
  assert.equal(old.exists, true, "history is not deleted");
  assert.equal(old.get("status"), "failed");
  assert.equal(old.get("commitmentAmount"), 50, "what was staked is still recorded");
  assert.equal(old.get("lockTxId"), lockEntryId(C1));

  // A fresh claim is now possible, and gets its own cycle and its own ledger.
  const { runClaimCommitment } = require("../commitments");
  await db.doc(walletPath()).set({
    available: 50, locked: 0, forfeitedTotal: 50, purchasedTotal: 0,
    adjustmentNet: 100, ledgerCount: 2, schemaVersion: 2,
  });
  const claimed = await runClaimCommitment(db, { appId: APP, testerId: TESTER });

  assert.equal(claimed.cycle, 2, "a new cycle, not a reuse of the failed one");
  assert.equal(claimed.assignmentId, cycleAssignmentId(APP, TESTER, 2));
  assert.notEqual(claimed.assignmentId, C1);

  const stillThere = await db.doc(assignmentPath()).get();
  assert.equal(stillThere.get("status"), "failed", "cycle 1 is untouched by cycle 2");
});

test("F: the forfeited cycle's ledger entry is immutable", async () => {
  await seedCommitment({ done: 3 });
  await runExpirySweep(db, { nowMillis: boundary() });

  const entry = await db.doc(ledgerPath(forfeitEntryId(C1))).get();
  assert.equal(entry.get("kind"), "forfeit");
  assert.equal(entry.get("amount"), 50);
  assert.equal(entry.get("deltaLocked"), -50);
  assert.equal(entry.get("deltaForfeited"), 50);
  assert.equal(entry.get("assignmentId"), C1);

  // A second sweep cannot overwrite it.
  await runExpirySweep(db, { nowMillis: boundary() });
  const again = await db.doc(ledgerPath(forfeitEntryId(C1))).get();
  assert.deepEqual(again.get("createdAt"), entry.get("createdAt"), "the entry never changed");
});

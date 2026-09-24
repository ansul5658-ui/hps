/**
 * Cancellation under real Firestore concurrency.
 *
 * The pure rules are proven in test/commitments.test.js against a fake. What
 * only the emulator can prove is what happens when two settlements want the
 * same stake at the same instant, because that is decided by Firestore's
 * transaction serialization rather than by anything in this codebase.
 *
 * THERE ARE NOW THREE WAYS A COMMITMENT CAN END
 *
 *     complete  locked -50, available +50     ledger "unlock_{id}"
 *     cancel    locked -50, available +50     ledger "cancel_{id}"
 *     forfeit   locked -50, forfeited +50     ledger "forfeit_{id}"
 *
 * Adding a third settlement adds three new races, and the dangerous one is not
 * cancel-vs-forfeit (whose outcomes visibly differ) but cancel-vs-complete:
 * both move 50 from locked to available, so if BOTH landed the wallet would
 * show 100 available against a 50 stake and still look superficially sane.
 * `locked` would go to -50, which the invariant catches - and proving that it
 * is caught, every time, is the point of this file.
 *
 * A race that resolves correctly once can still be a coin flip, so the
 * decisive tests run many independent rounds.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const { runForfeitCommitment, runCancelCommitment } = require("../commitments");
const { runRecordTestingDay } = require("../testingDays");
const { runExpirySweep } = require("../expiry");
const {
  cycleAssignmentId,
  activeClaimId,
  lockEntryId,
  unlockEntryId,
  forfeitEntryId,
  cancelEntryId,
} = require("../lib/commitments");
const {
  deriveWindow,
  addDays,
  startOfLocalDayMillis,
  testingLogId,
} = require("../lib/testingDays");
const { checkInvariants } = require("../lib/wallet");
const { COMMITMENT_DAYS_REQUIRED, LEGACY_COMMITMENT_WINDOW_DAYS } = require("../lib/constants");
// Fixtures in this file are commitments claimed BEFORE the miss rule: an 18-day
// window and no `allowedMisses`. Pinned explicitly so they keep proving the
// legacy rules are untouched; the miss rule has misses.concurrency.test.js.

const PROJECT_ID = "apptesting-concurrency-test";
const IST = "Asia/Kolkata";
const APP = "app1";
const TESTER = "tester1";
const DEV = "dev1";
const C1 = cycleAssignmentId(APP, TESTER, 1);

const CLAIMED_AT = Date.parse("2026-03-01T06:00:00Z");
const W = deriveWindow({ claimedAtMillis: CLAIMED_AT, timeZone: IST, windowDays: LEGACY_COMMITMENT_WINDOW_DAYS });

const assignmentPath = (id = C1) => `testingAssignments/${id}`;
const claimPath = () => `activeClaims/${activeClaimId(APP, TESTER)}`;
const walletPath = () => `users/${TESTER}/wallet/balance`;

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
 * The app's tester count at seed time. Deliberately above 1: releases floor at
 * zero, so from 1 a double decrement would be invisible. From 5, one release
 * reads 4 and two read 3.
 */
const SEEDED_TESTER_COUNT = 5;

/** A live commitment with `done` qualifying days really logged. */
async function seedCommitment({ done = 13, status = "inProgress", outageDayKeys = [] } = {}) {
  const batch = db.batch();
  batch.set(db.doc(`users/${TESTER}`), { uid: TESTER });
  batch.set(db.doc(`users/${DEV}`), { uid: DEV });
  batch.set(db.doc(`apps/${APP}`), {
    ownerId: DEV,
    status: "approved",
    testerCount: SEEDED_TESTER_COUNT,
  });
  for (const dayKey of outageDayKeys) {
    batch.set(db.doc(`systemHealth/${dayKey}`), {
      dayKey,
      degraded: true,
      scope: "global",
      appId: null,
      reason: "test outage",
    });
  }
  batch.set(db.doc(assignmentPath()), {
    appId: APP,
    testerId: TESTER,
    developerId: DEV,
    cycle: 1,
    commitmentAmount: 50,
    daysRequired: COMMITMENT_DAYS_REQUIRED,
    windowDays: LEGACY_COMMITMENT_WINDOW_DAYS,
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
    capacityHeld: true,
    createdAt: Timestamp.fromMillis(CLAIMED_AT),
  });
  batch.set(db.doc(claimPath()), {
    assignmentId: C1,
    appId: APP,
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
      appId: APP,
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

/**
 * Cancel as of `nowMillis` - by default noon on eligible day 10, well inside
 * the window. Cancellation is refused once a window has closed short, so a
 * cancel that should be live must say when it happens; the fixture window is
 * pinned to March 2026 and the real clock is long past it.
 */
const cancel = (actorId = TESTER, opts = {}) =>
  runCancelCommitment(db, {
    assignmentId: C1,
    actorId,
    actorKind: "user",
    isAdmin: false,
    nowMillis: atEligibleDay(10),
    ...opts,
  });

/** A cancel attempted once the window has already closed short. */
const lateCancel = (offsetMillis = 0) => cancel(TESTER, { nowMillis: boundary() + offsetMillis });

async function observe() {
  const [assignment, wallet, claims, ledger, app] = await Promise.all([
    db.doc(assignmentPath()).get(),
    db.doc(walletPath()).get(),
    db.collection("activeClaims").where("assignmentId", "==", C1).get(),
    db.collection(`users/${TESTER}/coinTransactions`).get(),
    db.doc(`apps/${APP}`).get(),
  ]);
  return {
    status: assignment.get("status"),
    settlementTxId: assignment.get("settlementTxId"),
    capacityHeld: assignment.get("capacityHeld"),
    testerCount: app.get("testerCount"),
    wallet: wallet.data(),
    claimCount: claims.size,
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
  // Stated explicitly as well as through checkInvariants, because this
  // equation is the thing the whole coin model rests on.
  assert.equal(
    wallet.available + wallet.locked + wallet.forfeitedTotal,
    wallet.purchasedTotal + wallet.adjustmentNet,
    `${prefix}available+locked+forfeited != purchased+adjustment`,
  );
}

/**
 * Exactly one of the THREE settlements may land, and it must be internally
 * consistent: status, settlement id, wallet and claim all agreeing.
 */
function assertExactlyOneTerminalOutcome(state, label = "") {
  const prefix = label ? `${label}: ` : "";
  const settlementIds = [unlockEntryId(C1), cancelEntryId(C1), forfeitEntryId(C1)];
  const landed = settlementIds.filter((id) => state.ledgerIds.includes(id));

  assert.ok(
    landed.length <= 1,
    `${prefix}${landed.length} settlements landed on one stake: ${landed}`,
  );

  if (landed.includes(unlockEntryId(C1))) {
    assert.equal(state.status, "completed", `${prefix}unlocked but not completed`);
    assert.equal(state.settlementTxId, unlockEntryId(C1));
    assert.equal(state.wallet.available, 50, `${prefix}the same 50 came back`);
    assert.equal(state.wallet.locked, 0);
    assert.equal(state.wallet.forfeitedTotal, 0);
  } else if (landed.includes(cancelEntryId(C1))) {
    assert.equal(state.status, "cancelled", `${prefix}cancelled entry but wrong status`);
    assert.equal(state.settlementTxId, cancelEntryId(C1));
    // Cancelling returns the stake, exactly as completing does.
    assert.equal(state.wallet.available, 50, `${prefix}the same 50 came back`);
    assert.equal(state.wallet.locked, 0);
    assert.equal(state.wallet.forfeitedTotal, 0, `${prefix}cancelling must not forfeit`);
  } else if (landed.includes(forfeitEntryId(C1))) {
    assert.equal(state.status, "failed", `${prefix}forfeited but not failed`);
    assert.equal(state.settlementTxId, forfeitEntryId(C1));
    assert.equal(state.wallet.available, 0, `${prefix}no partial refund`);
    assert.equal(state.wallet.locked, 0);
    assert.equal(state.wallet.forfeitedTotal, 50);
  }

  assert.ok(state.wallet.locked >= 0, `${prefix}locked went negative`);
  assert.ok(state.wallet.available >= 0, `${prefix}available went negative`);
  assert.ok(state.wallet.forfeitedTotal >= 0, `${prefix}forfeitedTotal went negative`);
  assertInvariant(state.wallet, label);

  if (landed.length === 1) {
    assert.equal(state.claimCount, 0, `${prefix}a settled commitment left its claim behind`);
  }

  // Capacity: cancellation and forfeiture release the slot exactly once;
  // completion keeps it; no settlement leaves it alone.
  const released = landed.includes(cancelEntryId(C1)) || landed.includes(forfeitEntryId(C1));
  assert.equal(
    state.testerCount,
    released ? SEEDED_TESTER_COUNT - 1 : SEEDED_TESTER_COUNT,
    `${prefix}testerCount ${state.testerCount} - a slot was released ` +
      `${released ? "other than exactly once" : "without a releasing settlement"}`,
  );
  assert.equal(state.capacityHeld, !released, `${prefix}capacityHeld disagrees with the outcome`);
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
// A: cancellation on its own
// ---------------------------------------------------------------------------

test("A: cancelling a live commitment returns the stake exactly once", async () => {
  await seedCommitment({ done: 5 });

  const outcome = await cancel();

  assert.equal(outcome.cancelled, true);
  assert.equal(outcome.amount, 50);
  const state = await observe();
  assert.equal(state.status, "cancelled");
  assert.equal(state.wallet.available, 50);
  assert.equal(state.wallet.locked, 0);
  assert.equal(state.claimCount, 0);
  assertExactlyOneTerminalOutcome(state, "A");
});

test("A: the active claim is removed exactly once, freeing the app", async () => {
  await seedCommitment({ done: 5 });
  assert.equal((await observe()).claimCount, 1);

  await cancel();

  const state = await observe();
  assert.equal(state.claimCount, 0);
  // The claim document itself is gone, not merely unqueryable.
  assert.equal((await db.doc(claimPath()).get()).exists, false);
});

// ---------------------------------------------------------------------------
// B: cancellation against itself
// ---------------------------------------------------------------------------

test("B: two simultaneous cancellations produce exactly one unlock", async () => {
  await seedCommitment({ done: 5 });

  const { fulfilled, rejected } = await settled([cancel(), cancel()]);

  assert.equal(fulfilled.length, 1, "exactly one cancellation may succeed");
  assert.equal(rejected.length, 1);
  const state = await observe();
  assert.equal(state.wallet.available, 50, "the stake came back once, not twice");
  assertExactlyOneTerminalOutcome(state, "B");
});

test("B: the two-way cancellation race holds across 10 independent rounds", async () => {
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 5 });

    const { fulfilled } = await settled([cancel(), cancel()]);

    assert.equal(fulfilled.length, 1, `round ${round}: exactly one winner`);
    const state = await observe();
    assert.equal(state.wallet.available, 50, `round ${round}: 50 back, once`);
    assertExactlyOneTerminalOutcome(state, `B round ${round}`);
  }
});

test("B: ten concurrent cancellations settle exactly once", async () => {
  await seedCommitment({ done: 5 });

  const attempts = Array.from({ length: 10 }, () => cancel());
  const { fulfilled } = await settled(attempts);

  assert.equal(fulfilled.length, 1);
  const state = await observe();
  assert.equal(state.wallet.available, 50);
  assert.equal(
    state.ledgerIds.filter((id) => id === cancelEntryId(C1)).length,
    1,
    "exactly one cancellation ledger entry",
  );
  assertExactlyOneTerminalOutcome(state, "B10");
});

test("B: a non-owner cannot win the race by flooding it", async () => {
  await seedCommitment({ done: 5 });

  // Ten simultaneous attempts from someone who does not own the commitment.
  // Volume must not turn a permission failure into a settlement.
  const { fulfilled } = await settled(
    Array.from({ length: 10 }, (_, i) => cancel(`intruder${i}`)),
  );

  assert.equal(fulfilled.length, 0, "no unauthorized cancellation may succeed");
  const state = await observe();
  assert.equal(state.status, "inProgress", "the commitment is untouched");
  assert.equal(state.wallet.locked, 50, "the stake is still locked");
  assert.equal(state.wallet.available, 0);
  assert.equal(state.ledgerIds.includes(cancelEntryId(C1)), false);
  assert.equal(state.claimCount, 1, "the claim survives a refused cancellation");
  assertInvariant(state.wallet, "B-intruder");
});

test("B: repeated sequential cancellation writes no duplicate ledger entry", async () => {
  await seedCommitment({ done: 5 });
  await cancel();
  const afterFirst = await observe();

  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(cancel(), /already been settled/);
  }

  const afterRepeats = await observe();
  assert.deepEqual(afterRepeats.wallet, afterFirst.wallet, "no further coin movement");
  assert.deepEqual(afterRepeats.ledgerIds, afterFirst.ledgerIds, "no duplicate entry");
  assertExactlyOneTerminalOutcome(afterRepeats, "B-repeat");
});

// ---------------------------------------------------------------------------
// C: cancellation versus completion
//
// The dangerous pair: both movements are locked -50 / available +50, so a
// double settlement would drive `locked` to -50 rather than producing an
// obviously wrong status.
// ---------------------------------------------------------------------------

test("C: the 14th day racing a cancellation produces ONE terminal outcome", async () => {
  await seedCommitment({ done: 13 });

  await settled([
    runRecordTestingDay(db, {
      assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
    }),
    cancel(),
  ]);

  const state = await observe();
  assert.ok(
    state.status === "completed" || state.status === "cancelled",
    `expected a terminal status, got ${state.status}`,
  );
  assertExactlyOneTerminalOutcome(state, "C");
});

test("C: the completion/cancellation race holds across 20 independent rounds", async () => {
  for (let round = 0; round < 20; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 13 });

    await settled([
      runRecordTestingDay(db, {
        assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
      }),
      cancel(),
    ]);

    const state = await observe();
    // Whichever won, the tester ends with exactly their stake back and
    // nothing forfeited — the two outcomes differ in status, not in coins.
    assert.equal(state.wallet.available, 50, `round ${round}: exactly 50 back`);
    assert.equal(state.wallet.locked, 0, `round ${round}: nothing left locked`);
    assertExactlyOneTerminalOutcome(state, `C round ${round}`);
  }
});

test("C: a completed commitment can never then be cancelled", async () => {
  await seedCommitment({ done: 13 });
  await runRecordTestingDay(db, {
    assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
  });
  const afterCompletion = await observe();
  assert.equal(afterCompletion.status, "completed");

  await assert.rejects(cancel(), /already been settled|cannot be/);

  const state = await observe();
  assert.deepEqual(state.wallet, afterCompletion.wallet, "no wallet change");
  assert.equal(state.ledgerIds.includes(cancelEntryId(C1)), false);
  assertExactlyOneTerminalOutcome(state, "C-after");
});

test("C: a cancelled commitment can never then complete", async () => {
  await seedCommitment({ done: 13 });
  await cancel();
  const afterCancel = await observe();
  assert.equal(afterCancel.status, "cancelled");

  await assert.rejects(
    runRecordTestingDay(db, {
      assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
    }),
    /.+/,
  );

  const state = await observe();
  assert.deepEqual(state.wallet, afterCancel.wallet, "no wallet change");
  assert.equal(state.ledgerIds.includes(unlockEntryId(C1)), false);
  assertExactlyOneTerminalOutcome(state, "C-reverse");
});

// ---------------------------------------------------------------------------
// D: cancellation versus forfeiture
// ---------------------------------------------------------------------------

/**
 * At an already-expired boundary the race has ONE legitimate winner. The
 * commitment was lost the moment the window shut short; a cancellation that
 * arrives in the gap before the sweep - however it interleaves - must be
 * refused, so the stake is forfeited, never returned.
 */
function assertForfeitedNotCancelled(state, label) {
  assert.equal(state.status, "failed", `${label}: a lost commitment was cancelled`);
  assert.equal(state.ledgerIds.includes(cancelEntryId(C1)), false, `${label}: cancel entry written`);
  assert.equal(state.wallet.available, 0, `${label}: the stake came back`);
  assert.equal(state.wallet.forfeitedTotal, 50);
  assertExactlyOneTerminalOutcome(state, label);
}

/** Every cancel must lose - to the closed window, or to a forfeit that landed first. */
function assertCancelsAllRefused(results, label) {
  for (const r of results) {
    assert.equal(r.status, "rejected", `${label}: a late cancellation succeeded`);
    assert.match(r.reason.message, /closed short|already been settled/, `${label}: ${r.reason.message}`);
  }
}

test("D: at the expired boundary a racing cancellation never beats the sweep", async () => {
  await seedCommitment({ done: 3 });

  const [cancelResult, sweepResult] = await Promise.allSettled([
    lateCancel(),
    runExpirySweep(db, { nowMillis: boundary() }),
  ]);

  assertCancelsAllRefused([cancelResult], "D");
  assert.equal(sweepResult.status, "fulfilled");
  assertForfeitedNotCancelled(await observe(), "D");
});

test("D: at the expired boundary cancellation loses in all 20 independent rounds", async () => {
  for (let round = 0; round < 20; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 3 });

    const [cancelResult, forfeitResult] = await Promise.allSettled([
      lateCancel(),
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "sweep", actorKind: "system", nowMillis: boundary(),
      }),
    ]);

    assertCancelsAllRefused([cancelResult], `D round ${round}`);
    assert.equal(forfeitResult.status, "fulfilled", `round ${round}: forfeiture must land`);
    assertForfeitedNotCancelled(await observe(), `D round ${round}`);
  }
});

test("D: ten-way late-cancellation-versus-forfeiture pile-up settles once, as a forfeit", async () => {
  await seedCommitment({ done: 3 });

  const cancels = [];
  const forfeits = [];
  for (let i = 0; i < 5; i += 1) {
    cancels.push(lateCancel(i * 60_000));
    forfeits.push(
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: `sweep${i}`, actorKind: "system", nowMillis: boundary(),
      }),
    );
  }
  const cancelResults = await Promise.allSettled(cancels);
  const forfeitResults = await Promise.allSettled(forfeits);

  assertCancelsAllRefused(cancelResults, "D10");
  assert.equal(
    forfeitResults.filter((r) => r.status === "fulfilled").length,
    1,
    "exactly one forfeiture may succeed",
  );
  assertForfeitedNotCancelled(await observe(), "D10");
});

// ---------------------------------------------------------------------------
// F: cancellation after the window has closed short, with no sweep yet
// ---------------------------------------------------------------------------

test("F: concurrent cancels after expiry are all refused and change nothing", async () => {
  await seedCommitment({ done: 3 });
  const before = await observe();

  // Ten attempts spread over the hours between IST midnight and the sweep.
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) => lateCancel(i * 20 * 60_000)),
  );
  for (const r of results) {
    assert.equal(r.status, "rejected", "a late cancellation succeeded");
    assert.match(r.reason.message, /closed short/);
  }

  const state = await observe();
  assert.deepEqual(state, before, "a refused cancellation must leave no trace");
  assert.equal(state.status, "inProgress", "still awaiting the sweep");
  assert.equal(state.wallet.locked, 50);
  assert.equal(state.claimCount, 1);
  assert.equal(state.testerCount, SEEDED_TESTER_COUNT, "no slot released by a refusal");

  // The sweep then settles it - as a forfeiture - releasing the slot once.
  const sweep = await runExpirySweep(db, { nowMillis: boundary() + 3.5 * 3600 * 1000 });
  assert.equal(sweep.forfeitedCount, 1);
  assertForfeitedNotCancelled(await observe(), "F-after-sweep");
});

test("F: late cancels and sweeps racing in a pile-up release capacity exactly once", async () => {
  await seedCommitment({ done: 3 });

  const attempts = [];
  for (let i = 0; i < 4; i += 1) {
    attempts.push(lateCancel(i * 60_000));
    attempts.push(runExpirySweep(db, { nowMillis: boundary() + i * 60_000 }));
  }
  await Promise.allSettled(attempts);

  const state = await observe();
  assert.equal(state.testerCount, SEEDED_TESTER_COUNT - 1, "released once, not per attempt");
  assertForfeitedNotCancelled(state, "F-pileup");
});

test("F: in-window cancels racing each other release capacity exactly once", async () => {
  await seedCommitment({ done: 5 });

  const { fulfilled } = await settled(Array.from({ length: 10 }, () => cancel()));
  assert.equal(fulfilled.length, 1);

  const state = await observe();
  assert.equal(state.testerCount, SEEDED_TESTER_COUNT - 1, "ten racing cancels, one release");
  assert.equal(state.capacityHeld, false);
  assertExactlyOneTerminalOutcome(state, "F-cancels");
});

test("F: a cancel inside an OUTAGE-EXTENDED window succeeds, and the sweep leaves it", async () => {
  // One declared outage day moves the deadline a day later. Noon on that extra
  // day is past the raw window - a late cancel without the outage - but still
  // live with it.
  await seedCommitment({ done: 3, outageDayKeys: [W.firstEligibleDayKey] });
  const extraDayNoon = boundary() + 12 * 3600 * 1000;

  const [cancelResult, sweepResult] = await Promise.allSettled([
    cancel(TESTER, { nowMillis: extraDayNoon }),
    runExpirySweep(db, { nowMillis: extraDayNoon }),
  ]);
  assert.equal(cancelResult.status, "fulfilled", "the extended window is still open");
  assert.equal(sweepResult.status, "fulfilled");
  assert.equal(sweepResult.value.forfeitedCount, 0, "an open window is never forfeited");

  const state = await observe();
  assert.equal(state.status, "cancelled");
  assert.equal(state.wallet.available, 50);
  assertExactlyOneTerminalOutcome(state, "F-outage");
});

test("F: the outage credit is one day - a cancel after it has run out is refused", async () => {
  await seedCommitment({ done: 3, outageDayKeys: [W.firstEligibleDayKey] });
  const extendedBoundary = boundary(addDays(W.lastEligibleDayKey, 1));

  await assert.rejects(cancel(TESTER, { nowMillis: extendedBoundary }), /closed short/);
  const state = await observe();
  assert.equal(state.status, "inProgress");
  assert.equal(state.testerCount, SEEDED_TESTER_COUNT);
});

test("D: a forfeited commitment can never then be cancelled", async () => {
  await seedCommitment({ done: 3 });
  await runForfeitCommitment(db, {
    assignmentId: C1, actorId: "sweep", actorKind: "system", nowMillis: boundary(),
  });
  const afterForfeit = await observe();
  assert.equal(afterForfeit.status, "failed");
  assert.equal(afterForfeit.wallet.forfeitedTotal, 50);

  await assert.rejects(cancel(), /already been settled/);

  const state = await observe();
  assert.deepEqual(state.wallet, afterForfeit.wallet, "no wallet change");
  assert.equal(state.ledgerIds.includes(cancelEntryId(C1)), false);
  assertExactlyOneTerminalOutcome(state, "D-after");
});

test("D: a cancelled commitment can never then be forfeited", async () => {
  await seedCommitment({ done: 3 });
  await cancel();
  const afterCancel = await observe();

  await assert.rejects(
    runForfeitCommitment(db, {
      assignmentId: C1, actorId: "sweep", actorKind: "system", nowMillis: boundary(),
    }),
    /already been settled/,
  );

  const state = await observe();
  assert.deepEqual(state.wallet, afterCancel.wallet, "no wallet change");
  assert.equal(state.wallet.forfeitedTotal, 0, "a returned stake was not then consumed");
  assert.equal(state.ledgerIds.includes(forfeitEntryId(C1)), false);
  assertExactlyOneTerminalOutcome(state, "D-reverse");
});

test("D: the expiry sweep skips a cancelled commitment entirely", async () => {
  await seedCommitment({ done: 3 });
  await cancel();

  const result = await runExpirySweep(db, { nowMillis: boundary() });

  // A cancelled assignment is terminal, so the sweep's candidate query must
  // not return it at all — it should cost nothing, not merely fail safely.
  assert.equal(result.forfeitedCount, 0);
  assert.equal((await observe()).wallet.forfeitedTotal, 0);
});

// ---------------------------------------------------------------------------
// E: three-way
// ---------------------------------------------------------------------------

test("E: completion, cancellation and forfeiture racing together settle once", async () => {
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seedCommitment({ done: 13 });

    await settled([
      runRecordTestingDay(db, {
        assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
      }),
      cancel(),
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "sweep", actorKind: "system", nowMillis: boundary(),
      }),
    ]);

    const state = await observe();
    assertExactlyOneTerminalOutcome(state, `E round ${round}`);
    assert.equal(state.claimCount, 0, `round ${round}: claim must be released`);
  }
});

test("E: the wallet invariant survives every settlement ordering", async () => {
  const orderings = [
    ["cancel", "complete"],
    ["complete", "cancel"],
    ["cancel", "forfeit"],
    ["forfeit", "cancel"],
  ];

  for (const [first, second] of orderings) {
    await clearFirestore();
    await seedCommitment({ done: 13 });

    const run = (which) => {
      if (which === "cancel") return cancel();
      if (which === "complete") {
        return runRecordTestingDay(db, {
          assignmentId: C1, testerId: TESTER, nowMillis: atEligibleDay(14),
        });
      }
      return runForfeitCommitment(db, {
        assignmentId: C1, actorId: "sweep", actorKind: "system", nowMillis: boundary(),
      });
    };

    await run(first).catch(() => {});
    await run(second).catch(() => {});

    const state = await observe();
    assertInvariant(state.wallet, `${first} then ${second}`);
    assertExactlyOneTerminalOutcome(state, `${first} then ${second}`);
  }
});

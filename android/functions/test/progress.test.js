/**
 * Batch 9B: the pure shaping behind commitment status and member progress.
 *
 * What is pinned here is what the app is told, not how it is derived - every
 * derived number is an input. The emulator suite drives the real derivation.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");

const {
  STATE_TESTING,
  STATE_AWAITING_SETTLEMENT,
  STATE_COMPLETED,
  STATE_CANCELLED,
  STATE_REMOVED_FOR_MISSES,
  STATE_FORFEITED,
  STATE_MISSED,
  commitmentState,
  remainingMisses,
  displayedMissedDays,
  shapeCommitmentStatus,
  memberLabels,
  shapeMemberRow,
  canReadMemberProgress,
} = require("../lib/progress");
const { getMyCommitmentStatusImpl, getMemberProgressImpl } = require("../progress");
const functions = require("../index");

const NOW = Date.parse("2026-03-06T06:30:00Z"); // 12:00 IST, 2026-03-06

function liveData(overrides = {}) {
  return {
    appId: "app1",
    testerId: "tester1",
    developerId: "dev1",
    groupId: "g1",
    cycle: 1,
    status: "inProgress",
    commitmentAmount: 50,
    daysRequired: 14,
    windowDays: 16,
    timeZone: "Asia/Kolkata",
    timeZoneSource: "default",
    claimedDayKey: "2026-03-01",
    firstEligibleDayKey: "2026-03-02",
    lastEligibleDayKey: "2026-03-17",
    windowEndsAt: Timestamp.fromMillis(Date.parse("2026-03-17T18:30:00Z")),
    allowedMisses: 2,
    removalCheckAt: Timestamp.fromMillis(Date.parse("2026-03-08T18:30:00Z")),
    lockTxId: "lock_x",
    settlementTxId: null,
    capacityHeld: true,
    createdAt: Timestamp.fromMillis(Date.parse("2026-03-01T06:00:00Z")),
    nextCheckInAt: Timestamp.fromMillis(Date.parse("2026-03-06T18:30:00Z")),
    ...overrides,
  };
}

function liveVerdict(overrides = {}) {
  return {
    expired: false,
    reason: "windowOpen",
    missedDays: 1,
    allowedMisses: 2,
    todayKey: "2026-03-06",
    effectiveLastEligibleDayKey: "2026-03-17",
    creditedOutageDays: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// State mapping
// ---------------------------------------------------------------------------

test("each stored status maps to exactly one display state", () => {
  assert.equal(commitmentState({ status: "completed" }), STATE_COMPLETED);
  assert.equal(commitmentState({ status: "cancelled" }), STATE_CANCELLED);
  assert.equal(commitmentState({ status: "missed" }), STATE_MISSED);
  assert.equal(
    commitmentState({ status: "failed", failureReason: "tooManyMisses" }),
    STATE_REMOVED_FOR_MISSES,
  );
  assert.equal(
    commitmentState({ status: "failed", failureReason: "windowClosedShort" }),
    STATE_FORFEITED,
  );
  // A legacy forfeiture predates failureReason; it was a window forfeiture.
  assert.equal(commitmentState({ status: "failed" }), STATE_FORFEITED);
  assert.equal(commitmentState({ status: "ready", verdict: liveVerdict() }), STATE_TESTING);
  assert.equal(commitmentState({ status: "inProgress", verdict: liveVerdict() }), STATE_TESTING);
});

test("a live commitment the server has judged lost is NEVER reported as testing", () => {
  for (const reason of ["tooManyMisses", "windowClosedShort"]) {
    for (const status of ["ready", "inProgress", "waitingForVerification"]) {
      assert.equal(
        commitmentState({ status, verdict: liveVerdict({ expired: true, reason }) }),
        STATE_AWAITING_SETTLEMENT,
        `${status}/${reason}`,
      );
    }
  }
});

test("a terminal status wins over any verdict", () => {
  const lost = liveVerdict({ expired: true, reason: "tooManyMisses" });
  assert.equal(commitmentState({ status: "completed", verdict: lost }), STATE_COMPLETED);
  assert.equal(commitmentState({ status: "cancelled", verdict: lost }), STATE_CANCELLED);
});

// ---------------------------------------------------------------------------
// Miss arithmetic for display
// ---------------------------------------------------------------------------

test("remaining misses counts down 2, 1, 0 and never goes negative", () => {
  assert.equal(remainingMisses(0, 2), 2);
  assert.equal(remainingMisses(1, 2), 1);
  assert.equal(remainingMisses(2, 2), 0);
  assert.equal(remainingMisses(3, 2), 0);
  assert.equal(remainingMisses(9, 2), 0);
});

test("remaining misses is null for a legacy commitment or an unknown count", () => {
  assert.equal(remainingMisses(1, null), null);
  assert.equal(remainingMisses(1, undefined), null);
  assert.equal(remainingMisses(null, 2), null);
  assert.equal(remainingMisses("1", 2), null);
});

test("a live commitment shows the re-derived miss count, never a stored one", () => {
  assert.equal(
    displayedMissedDays({ status: "inProgress", storedMissedDays: 0, verdict: liveVerdict({ missedDays: 2 }) }),
    2,
  );
  assert.equal(displayedMissedDays({ status: "inProgress", storedMissedDays: 2, verdict: null }), null);
});

test("a settled commitment shows only the count its settlement froze", () => {
  assert.equal(
    displayedMissedDays({ status: "failed", storedMissedDays: 3, verdict: liveVerdict({ missedDays: 9 }) }),
    3,
  );
  // Cancelled and completed never froze a count; today's clock must not invent one.
  assert.equal(
    displayedMissedDays({ status: "cancelled", storedMissedDays: undefined, verdict: liveVerdict({ missedDays: 9 }) }),
    null,
  );
  assert.equal(displayedMissedDays({ status: "completed", verdict: null }), null);
});

// ---------------------------------------------------------------------------
// The caller's own status shape
// ---------------------------------------------------------------------------

test("a live status carries the pinned clock, recounted progress and the miss verdict", () => {
  const s = shapeCommitmentStatus({
    assignmentId: "app1__tester1__c1",
    data: liveData(),
    qualifyingDays: 4,
    verdict: liveVerdict(),
    nowMillis: NOW,
  });
  assert.equal(s.assignmentId, "app1__tester1__c1");
  assert.equal(s.appId, "app1");
  assert.equal(s.groupId, "g1");
  assert.equal(s.cycle, 1);
  assert.equal(s.state, STATE_TESTING);
  assert.equal(s.isActive, true);
  assert.equal(s.endReason, null);
  assert.equal(s.timeZone, "Asia/Kolkata");
  assert.equal(s.claimedAtMillis, Date.parse("2026-03-01T06:00:00Z"));
  assert.equal(s.firstEligibleDayKey, "2026-03-02");
  assert.equal(s.lastEligibleDayKey, "2026-03-17");
  assert.equal(s.effectiveLastEligibleDayKey, "2026-03-17");
  assert.equal(s.windowEndsAtMillis, Date.parse("2026-03-17T18:30:00Z"));
  assert.equal(s.effectiveWindowEndsAtMillis, Date.parse("2026-03-17T18:30:00Z"));
  assert.equal(s.windowDays, 16);
  assert.equal(s.todayKey, "2026-03-06");
  assert.equal(s.daysRequired, 14);
  assert.equal(s.qualifyingDays, 4);
  assert.equal(s.loggedToday, true);
  assert.equal(s.missRule, true);
  assert.equal(s.allowedMisses, 2);
  assert.equal(s.missedDays, 1);
  assert.equal(s.remainingMisses, 1);
  assert.equal(s.removalCheckAtMillis, Date.parse("2026-03-08T18:30:00Z"));
  assert.equal(s.capacityHeld, true);
  assert.equal(s.commitmentAmount, 50);
  assert.equal(s.stake, "locked");
  assert.equal(s.serverNowMillis, NOW);
});

test("the status shape never carries ledger ids, uids or wallet data", () => {
  const s = shapeCommitmentStatus({
    assignmentId: "a",
    data: liveData({ cancelledBy: "admin1", status: "cancelled", settlementTxId: "cancel_x" }),
    qualifyingDays: 4,
    verdict: null,
    nowMillis: NOW,
  });
  for (const key of [
    "lockTxId", "settlementTxId", "developerId", "testerId", "cancelledBy",
    "wallet", "available", "locked", "forfeitedTotal", "timeZoneSource",
  ]) {
    assert.equal(key in s, false, `${key} must not be exposed`);
  }
  assert.equal(JSON.stringify(s).includes("admin1"), false);
  assert.equal(JSON.stringify(s).includes("dev1"), false);
  assert.equal(JSON.stringify(s).includes("lock_x"), false);
});

test("an outage-extended window reports the effective last day and its end instant", () => {
  const s = shapeCommitmentStatus({
    assignmentId: "a",
    data: liveData(),
    qualifyingDays: 4,
    verdict: liveVerdict({ effectiveLastEligibleDayKey: "2026-03-18", creditedOutageDays: 1 }),
    nowMillis: NOW,
  });
  assert.equal(s.lastEligibleDayKey, "2026-03-17");
  assert.equal(s.effectiveLastEligibleDayKey, "2026-03-18");
  assert.equal(s.effectiveWindowEndsAtMillis, Date.parse("2026-03-18T18:30:00Z"));
  assert.equal(s.windowEndsAtMillis, Date.parse("2026-03-17T18:30:00Z"));
});

test("a third-miss verdict on a live commitment reads as awaiting settlement, not active", () => {
  const s = shapeCommitmentStatus({
    assignmentId: "a",
    data: liveData(),
    qualifyingDays: 2,
    verdict: liveVerdict({ expired: true, reason: "tooManyMisses", missedDays: 3 }),
    nowMillis: NOW,
  });
  assert.equal(s.state, STATE_AWAITING_SETTLEMENT);
  assert.equal(s.endReason, "tooManyMisses");
  assert.equal(s.isActive, false);
  assert.equal(s.missedDays, 3);
  assert.equal(s.remainingMisses, 0);
  // Coins are still locked until the settlement actually lands.
  assert.equal(s.stake, "locked");
});

test("a third-miss removal reports removedForMisses, the frozen count and a forfeited stake", () => {
  const s = shapeCommitmentStatus({
    assignmentId: "a",
    data: liveData({
      status: "failed",
      failureReason: "tooManyMisses",
      missedDays: 3,
      settlementTxId: "forfeit_x",
      capacityHeld: false,
      effectiveLastEligibleDayKey: "2026-03-17",
      forfeitedAt: Timestamp.fromMillis(NOW),
    }),
    qualifyingDays: 1,
    verdict: null,
    nowMillis: NOW,
  });
  assert.equal(s.state, STATE_REMOVED_FOR_MISSES);
  assert.equal(s.endReason, "tooManyMisses");
  assert.equal(s.isActive, false);
  assert.equal(s.missedDays, 3);
  assert.equal(s.remainingMisses, null);
  assert.equal(s.removalCheckAtMillis, null);
  assert.equal(s.nextCheckInAtMillis, null);
  assert.equal(s.loggedToday, false);
  assert.equal(s.capacityHeld, false);
  assert.equal(s.stake, "forfeited");
  assert.equal(s.forfeitedAtMillis, NOW);
});

test("completed and cancelled report a returned stake", () => {
  const done = shapeCommitmentStatus({
    assignmentId: "a",
    data: liveData({ status: "completed", settlementTxId: "unlock_x", completedAt: Timestamp.fromMillis(NOW) }),
    qualifyingDays: 14,
    verdict: null,
    nowMillis: NOW,
  });
  assert.equal(done.state, STATE_COMPLETED);
  assert.equal(done.stake, "returned");
  assert.equal(done.completedAtMillis, NOW);
  // Completion keeps the slot (Batch 8A/9A semantics).
  assert.equal(done.capacityHeld, true);

  const gone = shapeCommitmentStatus({
    assignmentId: "a",
    data: liveData({ status: "cancelled", settlementTxId: "cancel_x", capacityHeld: false }),
    qualifyingDays: 3,
    verdict: null,
    nowMillis: NOW,
  });
  assert.equal(gone.state, STATE_CANCELLED);
  assert.equal(gone.stake, "returned");
  assert.equal(gone.capacityHeld, false);
  assert.equal(gone.missedDays, null);
});

test("a legacy commitment has no miss rule and no miss numbers", () => {
  const s = shapeCommitmentStatus({
    assignmentId: "a",
    data: liveData({ allowedMisses: undefined, windowDays: 18, removalCheckAt: undefined }),
    qualifyingDays: 4,
    verdict: liveVerdict({ missedDays: null, allowedMisses: null }),
    nowMillis: NOW,
  });
  assert.equal(s.missRule, false);
  assert.equal(s.allowedMisses, null);
  assert.equal(s.missedDays, null);
  assert.equal(s.remainingMisses, null);
  assert.equal(s.removalCheckAtMillis, null);
  assert.equal(s.windowDays, 18);
});

test("a reward-era assignment with no lock has no stake", () => {
  const s = shapeCommitmentStatus({
    assignmentId: "a",
    data: liveData({ lockTxId: undefined, capacityHeld: undefined, allowedMisses: undefined }),
    qualifyingDays: 0,
    verdict: liveVerdict({ reason: "noCommitment", missedDays: null }),
    nowMillis: NOW,
  });
  assert.equal(s.stake, "none");
  assert.equal(s.capacityHeld, false);
});

test("loggedToday follows the server boundary, not the day key", () => {
  const data = liveData();
  const before = shapeCommitmentStatus({ assignmentId: "a", data, qualifyingDays: 1, verdict: liveVerdict(), nowMillis: data.nextCheckInAt.toMillis() - 1 });
  const at = shapeCommitmentStatus({ assignmentId: "a", data, qualifyingDays: 1, verdict: liveVerdict(), nowMillis: data.nextCheckInAt.toMillis() });
  assert.equal(before.loggedToday, true);
  assert.equal(at.loggedToday, false);
  const never = shapeCommitmentStatus({ assignmentId: "a", data: liveData({ nextCheckInAt: undefined }), qualifyingDays: 0, verdict: liveVerdict(), nowMillis: NOW });
  assert.equal(never.loggedToday, false);
});

// ---------------------------------------------------------------------------
// Member rows
// ---------------------------------------------------------------------------

test("member labels follow claim order and are stable across input order", () => {
  const members = [
    { assignmentId: "app1__c__c1", createdAtMillis: 300 },
    { assignmentId: "app1__a__c1", createdAtMillis: 100 },
    { assignmentId: "app1__b__c1", createdAtMillis: 100 },
    { assignmentId: "app1__z__c1", createdAtMillis: null },
  ];
  const one = memberLabels(members);
  const two = memberLabels([...members].reverse());
  assert.deepEqual([...one.entries()].sort(), [...two.entries()].sort());
  assert.equal(one.get("app1__a__c1"), "Tester 1");
  assert.equal(one.get("app1__b__c1"), "Tester 2");
  assert.equal(one.get("app1__c__c1"), "Tester 3");
  assert.equal(one.get("app1__z__c1"), "Tester 4");
});

test("a member row carries progress only - no uid, assignment id, stake or clock", () => {
  const status = shapeCommitmentStatus({
    assignmentId: "app1__tester1__c1",
    data: liveData(),
    qualifyingDays: 4,
    verdict: liveVerdict(),
    nowMillis: NOW,
  });
  const row = shapeMemberRow({ status, label: "Tester 1", isYou: false });
  assert.deepEqual(Object.keys(row).sort(), [
    "allowedMisses", "daysRequired", "isYou", "label", "loggedToday",
    "missedDays", "qualifyingDays", "remainingMisses", "state",
  ]);
  const text = JSON.stringify(row);
  for (const secret of ["tester1", "app1__tester1__c1", "dev1", "lock_x", "Asia/Kolkata"]) {
    assert.equal(text.includes(secret), false, `${secret} leaked`);
  }
  assert.equal(row.qualifyingDays, 4);
  assert.equal(row.missedDays, 1);
  assert.equal(row.remainingMisses, 1);
});

test("member progress is readable by the owner, a current member and an admin only", () => {
  const base = { appOwnerId: "dev1", memberTesterIds: ["t1", "t2"] };
  assert.equal(canReadMemberProgress({ ...base, callerId: "dev1", isAdmin: false }), true);
  assert.equal(canReadMemberProgress({ ...base, callerId: "t2", isAdmin: false }), true);
  assert.equal(canReadMemberProgress({ ...base, callerId: "admin", isAdmin: true }), true);
  assert.equal(canReadMemberProgress({ ...base, callerId: "stranger", isAdmin: false }), false);
  assert.equal(canReadMemberProgress({ ...base, callerId: null, isAdmin: true }), false);
  assert.equal(canReadMemberProgress({ ...base, callerId: "", isAdmin: false }), false);
  // Admin must be exactly true; a truthy string is not an admin.
  assert.equal(canReadMemberProgress({ ...base, callerId: "x", isAdmin: "true" }), false);
  // No owner recorded never turns into "everyone is the owner".
  assert.equal(
    canReadMemberProgress({ appOwnerId: null, memberTesterIds: [], callerId: "x", isAdmin: false }),
    false,
  );
});

// ---------------------------------------------------------------------------
// Callable guards (no database reached)
// ---------------------------------------------------------------------------

const noDb = new Proxy({}, { get() { throw new Error("database must not be touched"); } });

test("both reads refuse an unauthenticated caller before touching the database", async () => {
  await assert.rejects(getMyCommitmentStatusImpl(noDb, { data: {} }), (e) => e.code === "unauthenticated");
  await assert.rejects(getMemberProgressImpl(noDb, { data: { appId: "app1" } }), (e) => e.code === "unauthenticated");
});

test("both reads validate appId before touching the database", async () => {
  const auth = { uid: "tester1" };
  for (const appId of ["", "a/b", 7, {}, "x".repeat(2000)]) {
    await assert.rejects(
      getMyCommitmentStatusImpl(noDb, { auth, data: { appId } }),
      (e) => e.code === "invalid-argument",
      JSON.stringify(appId),
    );
    await assert.rejects(
      getMemberProgressImpl(noDb, { auth, data: { appId } }),
      (e) => e.code === "invalid-argument",
      JSON.stringify(appId),
    );
  }
  await assert.rejects(getMemberProgressImpl(noDb, { auth, data: {} }), (e) => e.code === "invalid-argument");
});

test("both callables are exported and deployed in REGION", () => {
  for (const name of ["getMyCommitmentStatus", "getMemberProgress"]) {
    assert.ok(functions[name], name);
    assert.deepEqual(functions[name].__endpoint.region, ["asia-south2"]);
    assert.ok(functions[name].__endpoint.callableTrigger, `${name} is a callable`);
  }
});

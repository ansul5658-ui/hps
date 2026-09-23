/**
 * Pure decision table for retiring reward-era test assignments.
 *
 * Emulator behaviour (transactions, the untouched wallet, the preserved log)
 * lives in test-emulator/legacyCloseOut.emulator.test.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEGACY_TEST_APP_ID,
  LEGACY_CLOSE_OUT_ASSIGNMENT_IDS,
  LEGACY_CLOSE_OUT_REASON,
  COMMITMENT_FIELDS,
  checkLegacyCloseOutEligible,
} = require("../lib/legacyCloseOut");

const [A1, A2] = LEGACY_CLOSE_OUT_ASSIGNMENT_IDS;
const testerOf = (id) => id.slice(LEGACY_TEST_APP_ID.length + 2);

/** The exact field shape both production documents had on 2026-09-23. */
function legacyDoc(id, overrides = {}) {
  return {
    appId: LEGACY_TEST_APP_ID,
    testerId: testerOf(id),
    developerId: "dev",
    groupId: "app_testing_official",
    coinReward: 50,
    daysRequired: 14,
    daysCompleted: 0,
    status: "ready",
    ...overrides,
  };
}

test("the allow-list is exactly the two production test assignments", () => {
  assert.equal(LEGACY_CLOSE_OUT_ASSIGNMENT_IDS.length, 2);
  for (const id of LEGACY_CLOSE_OUT_ASSIGNMENT_IDS) {
    assert.ok(id.startsWith(`${LEGACY_TEST_APP_ID}__`));
    assert.doesNotMatch(id, /__c\d+$/, "reward-era ids carry no cycle suffix");
  }
  assert.ok(Object.isFrozen(LEGACY_CLOSE_OUT_ASSIGNMENT_IDS));
});

test("A1 (inProgress, one day logged) is eligible", () => {
  const v = checkLegacyCloseOutEligible({
    assignmentId: A1,
    data: legacyDoc(A1, { status: "inProgress", daysCompleted: 1 }),
  });
  assert.deepEqual(v, { ok: true });
});

test("A2 (ready, nothing logged) is eligible", () => {
  assert.deepEqual(
    checkLegacyCloseOutEligible({ assignmentId: A2, data: legacyDoc(A2) }),
    { ok: true },
  );
});

test("waitingForVerification is still an open legacy state", () => {
  const v = checkLegacyCloseOutEligible({
    assignmentId: A2,
    data: legacyDoc(A2, { status: "waitingForVerification" }),
  });
  assert.equal(v.ok, true);
});

test("our own earlier close-out reads as alreadyClosed, not an error", () => {
  const v = checkLegacyCloseOutEligible({
    assignmentId: A1,
    data: legacyDoc(A1, {
      status: "cancelled",
      legacyCloseOut: { reason: LEGACY_CLOSE_OUT_REASON },
    }),
  });
  assert.deepEqual(v, { ok: false, alreadyClosed: true });
});

test("a cancellation that is NOT ours is refused rather than treated as done", () => {
  const v = checkLegacyCloseOutEligible({
    assignmentId: A1,
    data: legacyDoc(A1, { status: "cancelled" }),
  });
  assert.equal(v.ok, false);
  assert.equal(v.alreadyClosed, undefined);
  assert.equal(v.code, "failed-precondition");
});

for (const status of ["completed", "failed", "missed"]) {
  test(`a terminal "${status}" assignment is refused`, () => {
    const v = checkLegacyCloseOutEligible({ assignmentId: A2, data: legacyDoc(A2, { status }) });
    assert.equal(v.ok, false);
    assert.equal(v.code, "failed-precondition");
  });
}

test("an unknown status is refused", () => {
  const v = checkLegacyCloseOutEligible({ assignmentId: A2, data: legacyDoc(A2, { status: "weird" }) });
  assert.equal(v.ok, false);
});

for (const field of COMMITMENT_FIELDS) {
  test(`an assignment carrying "${field}" is refused as a commitment`, () => {
    const v = checkLegacyCloseOutEligible({
      assignmentId: A2,
      data: legacyDoc(A2, { [field]: field === "cycle" ? 1 : "x" }),
    });
    assert.equal(v.ok, false);
    assert.equal(v.code, "failed-precondition");
    assert.match(v.message, new RegExp(field));
  });
}

test("a commitment field set to null or empty does not count as present", () => {
  const v = checkLegacyCloseOutEligible({
    assignmentId: A2,
    data: legacyDoc(A2, { settlementTxId: null, lockTxId: "" }),
  });
  assert.equal(v.ok, true);
});

test("a lock entry in the ledger refuses even when the assignment forgot it", () => {
  const v = checkLegacyCloseOutEligible({
    assignmentId: A2,
    data: legacyDoc(A2),
    lockLedgerExists: true,
  });
  assert.equal(v.ok, false);
  assert.match(v.message, /coin lock/);
});

test("an id not on the allow-list is refused before anything else", () => {
  const other = `${LEGACY_TEST_APP_ID}__someoneElse`;
  const v = checkLegacyCloseOutEligible({ assignmentId: other, data: legacyDoc(other) });
  assert.equal(v.code, "permission-denied");
});

test("an allow-listed id whose document names another app is refused", () => {
  const v = checkLegacyCloseOutEligible({
    assignmentId: A2,
    data: legacyDoc(A2, { appId: "realApp" }),
  });
  assert.equal(v.ok, false);
  assert.match(v.message, /legacy test app/);
});

test("an id whose tester does not match the document is refused", () => {
  const v = checkLegacyCloseOutEligible({
    assignmentId: A2,
    data: legacyDoc(A2, { testerId: "someoneElse" }),
  });
  assert.equal(v.ok, false);
  assert.match(v.message, /reward-era id/);
});

test("a missing document is not-found", () => {
  const v = checkLegacyCloseOutEligible({ assignmentId: A1, data: null });
  assert.equal(v.code, "not-found");
});

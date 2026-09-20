const test = require("node:test");
const assert = require("node:assert/strict");

const { evaluateJoin } = require("../lib/joinRules");

const OPEN_GROUP = {
  groupExists: true,
  groupStatus: "open",
  groupVisibility: "open",
  memberCap: 0,
  memberCount: 0,
  alreadyMember: false,
  isSuspended: false,
};

test("an eligible user can join an open group", () => {
  const result = evaluateJoin(OPEN_GROUP);
  assert.equal(result.allowed, true);
  assert.equal(result.outcome, "joined");
});

test("member cap is enforced", () => {
  const result = evaluateJoin({ ...OPEN_GROUP, memberCap: 20, memberCount: 20 });
  assert.equal(result.allowed, false);
  assert.equal(result.outcome, "full");
  assert.equal(result.code, "resource-exhausted");
});

test("the last free seat is still joinable", () => {
  const result = evaluateJoin({ ...OPEN_GROUP, memberCap: 20, memberCount: 19 });
  assert.equal(result.allowed, true);
});

test("a cap of zero means unlimited", () => {
  const result = evaluateJoin({ ...OPEN_GROUP, memberCap: 0, memberCount: 5000 });
  assert.equal(result.allowed, true);
});

test("duplicate membership is prevented, and reported as success not failure", () => {
  const result = evaluateJoin({ ...OPEN_GROUP, alreadyMember: true });
  assert.equal(result.allowed, false, "nothing is written");
  assert.equal(result.outcome, "alreadyMember");
  assert.equal(result.code, undefined, "idempotent, so not an error for the caller");
});

test("a suspended user cannot join", () => {
  const result = evaluateJoin({ ...OPEN_GROUP, isSuspended: true });
  assert.equal(result.allowed, false);
  assert.equal(result.outcome, "suspended");
  assert.equal(result.code, "permission-denied");
});

test("suspension is checked before anything else, even for an existing member", () => {
  const result = evaluateJoin({ ...OPEN_GROUP, isSuspended: true, alreadyMember: true });
  assert.equal(result.outcome, "suspended");
});

test("a missing group is rejected", () => {
  const result = evaluateJoin({ ...OPEN_GROUP, groupExists: false });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "not-found");
});

test("closed group states refuse new members", () => {
  for (const status of ["full", "completed", "archived", "cancelled"]) {
    const result = evaluateJoin({ ...OPEN_GROUP, groupStatus: status });
    assert.equal(result.allowed, false, status);
    assert.equal(result.outcome, "closedGroup", status);
  }
});

test("draft and active groups still accept members", () => {
  for (const status of ["draft", "open", "active"]) {
    assert.equal(evaluateJoin({ ...OPEN_GROUP, groupStatus: status }).allowed, true, status);
  }
});

test("a private group cannot be self-joined", () => {
  const result = evaluateJoin({ ...OPEN_GROUP, groupVisibility: "private" });
  assert.equal(result.allowed, false);
  assert.equal(result.outcome, "private");
});

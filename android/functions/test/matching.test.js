const test = require("node:test");
const assert = require("node:assert/strict");

const { selectTesters, assignmentIdFor } = require("../lib/matching");

function candidate(uid, overrides = {}) {
  return {
    uid,
    joinedAtMillis: 1_000,
    isSuspended: false,
    exists: true,
    ...overrides,
  };
}

const BASE = {
  ownerId: "owner",
  alreadyAssignedTesterIds: [],
  remainingSlots: 20,
  maxThisRun: 20,
};

test("matches eligible group members", () => {
  const { selected } = selectTesters({
    ...BASE,
    candidates: [candidate("a"), candidate("b")],
  });
  assert.deepEqual(selected, ["a", "b"]);
});

test("the app owner is never assigned to their own app", () => {
  const { selected, skipped } = selectTesters({
    ...BASE,
    candidates: [candidate("owner"), candidate("b")],
  });
  assert.deepEqual(selected, ["b"]);
  assert.deepEqual(skipped, [{ uid: "owner", reason: "appOwner" }]);
});

test("a suspended tester is never assigned", () => {
  const { selected, skipped } = selectTesters({
    ...BASE,
    candidates: [candidate("a", { isSuspended: true }), candidate("b")],
  });
  assert.deepEqual(selected, ["b"]);
  assert.deepEqual(skipped, [{ uid: "a", reason: "suspended" }]);
});

test("a membership with no user document is skipped", () => {
  const { selected, skipped } = selectTesters({
    ...BASE,
    candidates: [candidate("ghost", { exists: false }), candidate("b")],
  });
  assert.deepEqual(selected, ["b"]);
  assert.deepEqual(skipped, [{ uid: "ghost", reason: "noUserDocument" }]);
});

test("a tester already assigned to this app is not assigned twice", () => {
  const { selected, skipped } = selectTesters({
    ...BASE,
    alreadyAssignedTesterIds: ["a"],
    candidates: [candidate("a"), candidate("b")],
  });
  assert.deepEqual(selected, ["b"]);
  assert.deepEqual(skipped, [{ uid: "a", reason: "alreadyAssigned" }]);
});

test("a duplicated candidate collapses to a single assignment", () => {
  const { selected } = selectTesters({
    ...BASE,
    candidates: [candidate("a"), candidate("a"), candidate("b")],
  });
  assert.deepEqual(selected, ["a", "b"]);
});

test("selection never exceeds the app's remaining tester slots", () => {
  const candidates = ["a", "b", "c", "d"].map((uid) => candidate(uid));
  const { selected, skipped } = selectTesters({
    ...BASE,
    remainingSlots: 2,
    candidates,
  });
  assert.equal(selected.length, 2);
  assert.deepEqual(
    skipped.map((s) => s.reason),
    ["noSlotsRemaining", "noSlotsRemaining"],
  );
});

test("selection never exceeds the per-call maximum", () => {
  const candidates = ["a", "b", "c"].map((uid) => candidate(uid));
  const { selected } = selectTesters({ ...BASE, maxThisRun: 1, candidates });
  assert.deepEqual(selected, ["a"]);
});

test("no slots left means nothing is assigned", () => {
  const { selected } = selectTesters({
    ...BASE,
    remainingSlots: 0,
    candidates: [candidate("a")],
  });
  assert.deepEqual(selected, []);
});

test("ordering is deterministic: oldest membership first, uid as tiebreaker", () => {
  const candidates = [
    candidate("zeta", { joinedAtMillis: 500 }),
    candidate("beta", { joinedAtMillis: 100 }),
    candidate("alpha", { joinedAtMillis: 100 }),
  ];
  const first = selectTesters({ ...BASE, candidates });
  const second = selectTesters({ ...BASE, candidates: [...candidates].reverse() });

  assert.deepEqual(first.selected, ["alpha", "beta", "zeta"]);
  assert.deepEqual(second.selected, first.selected, "input order must not matter");
});

test("running twice over the same pool assigns nobody the second time", () => {
  const candidates = [candidate("a"), candidate("b")];
  const first = selectTesters({ ...BASE, candidates });
  const second = selectTesters({
    ...BASE,
    candidates,
    alreadyAssignedTesterIds: first.selected,
    remainingSlots: BASE.remainingSlots - first.selected.length,
  });
  assert.deepEqual(second.selected, []);
});

test("assignment ids are deterministic per app+tester", () => {
  assert.equal(assignmentIdFor("app1", "userA"), "app1__userA");
  assert.equal(assignmentIdFor("app1", "userA"), assignmentIdFor("app1", "userA"));
  assert.notEqual(assignmentIdFor("app1", "userA"), assignmentIdFor("app1", "userB"));
});

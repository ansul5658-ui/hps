const test = require("node:test");
const assert = require("node:assert/strict");

const {
  isValidDocId,
  isValidAppStatus,
  checkAppTransition,
  clampRequestedCount,
} = require("../lib/validation");

test("document ids: rejects anything that could steer a Firestore path", () => {
  assert.equal(isValidDocId("abc123"), true);
  assert.equal(isValidDocId("app_testing_official"), true);

  assert.equal(isValidDocId(""), false);
  assert.equal(isValidDocId("a/b"), false, "path traversal");
  assert.equal(isValidDocId("."), false);
  assert.equal(isValidDocId(".."), false);
  assert.equal(isValidDocId("__name__"), false, "reserved id");
  assert.equal(isValidDocId(null), false);
  assert.equal(isValidDocId(42), false);
  assert.equal(isValidDocId("x".repeat(1501)), false);
});

test("app status: only the four known values are valid", () => {
  for (const status of ["pendingReview", "approved", "rejected", "archived"]) {
    assert.equal(isValidAppStatus(status), true, status);
  }
  assert.equal(isValidAppStatus("Approved"), false, "case sensitive");
  assert.equal(isValidAppStatus("deleted"), false);
});

test("app transitions: admin can approve, reject and archive a pending app", () => {
  assert.deepEqual(checkAppTransition("pendingReview", "approved"), { ok: true, noop: false });
  assert.deepEqual(checkAppTransition("pendingReview", "rejected"), { ok: true, noop: false });
  assert.deepEqual(checkAppTransition("pendingReview", "archived"), { ok: true, noop: false });
});

test("app transitions: approved can be archived or rejected, and re-approved later", () => {
  assert.equal(checkAppTransition("approved", "archived").ok, true);
  assert.equal(checkAppTransition("approved", "rejected").ok, true);
  assert.equal(checkAppTransition("archived", "approved").ok, true);
  assert.equal(checkAppTransition("rejected", "approved").ok, true);
});

test("app transitions: an app is never pushed back into the review queue", () => {
  const result = checkAppTransition("approved", "pendingReview");
  assert.equal(result.ok, false);
  assert.match(result.reason, /pendingReview/);
});

test("app transitions: an unknown target status is refused", () => {
  const result = checkAppTransition("pendingReview", "deleted");
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unknown target status/);
});

test("app transitions: setting the status it already has is a no-op, not an error", () => {
  assert.deepEqual(checkAppTransition("approved", "approved"), { ok: true, noop: true });
});

test("app transitions: a missing/garbage current status is treated as pendingReview", () => {
  assert.equal(checkAppTransition(undefined, "approved").ok, true);
  assert.equal(checkAppTransition("nonsense", "approved").ok, true);
});

test("requested count is clamped into range and never trusted raw", () => {
  assert.equal(clampRequestedCount(undefined, 20), 20, "absent means 'fill the slots'");
  assert.equal(clampRequestedCount(5, 20), 5);
  assert.equal(clampRequestedCount(999, 20), 20, "cannot exceed the cap");
  assert.equal(clampRequestedCount(0, 20), 0);
  assert.equal(clampRequestedCount(-3, 20), 0, "negative cannot invert the cap");
  assert.equal(clampRequestedCount("7", 20), 7);
  assert.equal(clampRequestedCount("abc", 20), 20);
  assert.equal(clampRequestedCount(3.9, 20), 3);
});

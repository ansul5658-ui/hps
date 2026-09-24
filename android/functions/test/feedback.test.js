/**
 * Batch 9C: the pure rules behind tester feedback - validation, normalization,
 * eligibility and what each reader is shown. The emulator suite drives the
 * real submission against real claims and check-ins.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { Timestamp } = require("firebase-admin/firestore");

const {
  FEEDBACK_COMMENT_MAX_LENGTH,
  FEEDBACK_PAGE_MAX,
  FEEDBACK_PAGE_DEFAULT,
  normalizeComment,
  validateSubmission,
  checkFeedbackEligible,
  shapeOwnFeedback,
  shapeDeveloperFeedback,
  shapeAdminFeedback,
  pageSize,
} = require("../lib/feedback");
const {
  submitTestingFeedbackImpl,
  getMyTestingFeedbackImpl,
  getAppFeedbackImpl,
  adminListFeedbackImpl,
} = require("../feedback");
const functions = require("../index");

const A = "app1__tester1__c1";
const ok = (extra = {}) => ({ assignmentId: A, rating: 4, ...extra });

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("a minimal valid submission: rating only, comment null, foundBug false", () => {
  const v = validateSubmission(ok());
  assert.equal(v.ok, true);
  assert.deepEqual(v.value, { assignmentId: A, rating: 4, comment: null, foundBug: false });
});

test("a full valid submission keeps every field", () => {
  const v = validateSubmission(ok({ comment: "  Crashes on login.  ", foundBug: true }));
  assert.deepEqual(v.value, { assignmentId: A, rating: 4, comment: "Crashes on login.", foundBug: true });
});

test("rating boundaries: 1 and 5 accepted; 0, 6, fractions, strings, NaN refused", () => {
  assert.equal(validateSubmission(ok({ rating: 1 })).ok, true);
  assert.equal(validateSubmission(ok({ rating: 5 })).ok, true);
  for (const rating of [0, 6, -1, 4.5, "4", null, undefined, NaN, Infinity, true, [4], {}]) {
    const v = validateSubmission(ok({ rating }));
    assert.equal(v.ok, false, `rating ${String(rating)}`);
    assert.equal(v.field, "rating");
  }
});

test("a missing rating is refused - it is the one required field", () => {
  const v = validateSubmission({ assignmentId: A, comment: "hi" });
  assert.equal(v.ok, false);
  assert.equal(v.field, "rating");
});

test("assignmentId must be a real document id", () => {
  for (const assignmentId of [undefined, null, "", "a/b", "..", "__x__", 7, {}]) {
    const v = validateSubmission(ok({ assignmentId }));
    assert.equal(v.ok, false, JSON.stringify(assignmentId));
    assert.equal(v.field, "assignmentId");
  }
});

test("comment length: exactly the limit is accepted, one more is refused", () => {
  assert.equal(validateSubmission(ok({ comment: "x".repeat(FEEDBACK_COMMENT_MAX_LENGTH) })).ok, true);
  const over = validateSubmission(ok({ comment: "x".repeat(FEEDBACK_COMMENT_MAX_LENGTH + 1) }));
  assert.equal(over.ok, false);
  assert.equal(over.field, "comment");
});

test("comment length counts characters, not UTF-16 units", () => {
  // 1000 emoji are 2000 UTF-16 units but 1000 characters.
  assert.equal(validateSubmission(ok({ comment: "😀".repeat(FEEDBACK_COMMENT_MAX_LENGTH) })).ok, true);
  assert.equal(validateSubmission(ok({ comment: "😀".repeat(FEEDBACK_COMMENT_MAX_LENGTH + 1) })).ok, false);
});

test("an oversized payload is refused outright", () => {
  const v = validateSubmission(ok({ comment: "x".repeat(1_000_000) }));
  assert.equal(v.ok, false);
  assert.equal(v.field, "comment");
});

test("the limit applies AFTER normalization: stripped padding does not count", () => {
  const padded = `   ${"x".repeat(FEEDBACK_COMMENT_MAX_LENGTH)}   `;
  assert.equal(validateSubmission(ok({ comment: padded })).ok, true);
});

test("a blank comment is stored as no comment", () => {
  for (const comment of ["", "   ", "\n\n\t", "\u0000\u0007"]) {
    assert.equal(validateSubmission(ok({ comment })).value.comment, null, JSON.stringify(comment));
  }
  assert.equal(validateSubmission(ok({ comment: null })).value.comment, null);
});

test("a non-string comment and a non-boolean foundBug are refused", () => {
  for (const comment of [5, true, ["a"], { text: "a" }]) {
    assert.equal(validateSubmission(ok({ comment })).field, "comment");
  }
  for (const foundBug of ["true", 1, 0, "yes", {}]) {
    assert.equal(validateSubmission(ok({ foundBug })).field, "foundBug");
  }
});

test("unknown fields are refused, including ones that try to steer the record", () => {
  for (const key of ["testerId", "appId", "developerId", "cycle", "submittedAt", "status", "qualifyingDays", "coins"]) {
    const v = validateSubmission(ok({ [key]: "x" }));
    assert.equal(v.ok, false, key);
    assert.equal(v.field, key);
  }
});

test("a non-object payload is refused", () => {
  for (const data of [undefined, null, "x", 5, [ok()]]) {
    assert.equal(validateSubmission(data).ok, false, JSON.stringify(data));
  }
});

test("normalization: NFC, line endings, control and bidi characters, blank-line runs", () => {
  assert.equal(normalizeComment("é"), "é");
  assert.equal(normalizeComment("a\r\nb\rc"), "a\nb\nc");
  assert.equal(normalizeComment("a\u0000b\u0007c\u001bd\u007fe\u0085f"), "abcdef");
  assert.equal(normalizeComment("safe‮txt.exe"), "safetxt.exe");
  assert.equal(normalizeComment("a⁦b⁩c"), "abc");
  assert.equal(normalizeComment("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(normalizeComment("keep\ttabs\nand lines"), "keep\ttabs\nand lines");
  // Markup is stored as text, never interpreted.
  assert.equal(normalizeComment("<script>alert(1)</script>"), "<script>alert(1)</script>");
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

const eligibleBase = {
  callerId: "tester1",
  assignmentExists: true,
  testerId: "tester1",
  developerId: "dev1",
  lockTxId: "lock_x",
  qualifyingDays: 1,
};

test("a staked commitment with one recorded day is eligible", () => {
  assert.equal(checkFeedbackEligible(eligibleBase).ok, true);
  assert.equal(checkFeedbackEligible({ ...eligibleBase, qualifyingDays: 14 }).ok, true);
});

test("a missing assignment and someone else's read identically", () => {
  const missing = checkFeedbackEligible({ ...eligibleBase, assignmentExists: false, testerId: null });
  const theirs = checkFeedbackEligible({ ...eligibleBase, callerId: "intruder" });
  assert.deepEqual(missing, theirs);
  assert.equal(missing.code, "not-found");
  assert.equal(missing.reason, "notYourAssignment");
});

test("no caller is refused as not-yours", () => {
  assert.equal(checkFeedbackEligible({ ...eligibleBase, callerId: null }).reason, "notYourAssignment");
  assert.equal(checkFeedbackEligible({ ...eligibleBase, callerId: "", testerId: "" }).reason, "notYourAssignment");
});

test("zero recorded days is refused", () => {
  const v = checkFeedbackEligible({ ...eligibleBase, qualifyingDays: 0 });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "noTestingDays");
  assert.equal(checkFeedbackEligible({ ...eligibleBase, qualifyingDays: null }).reason, "noTestingDays");
});

test("an assignment with no stake is refused", () => {
  assert.equal(checkFeedbackEligible({ ...eligibleBase, lockTxId: null }).reason, "noCommitment");
});

test("the developer can never review their own app, even on corrupt data", () => {
  const v = checkFeedbackEligible({ ...eligibleBase, developerId: "tester1" });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "ownApp");
});

// ---------------------------------------------------------------------------
// What each reader sees
// ---------------------------------------------------------------------------

const stored = {
  assignmentId: A,
  appId: "app1",
  testerId: "tester1",
  developerId: "dev1",
  cycle: 1,
  rating: 3,
  comment: "Slow start-up",
  foundBug: true,
  submittedAt: Timestamp.fromMillis(1_000_000),
};

test("the developer's view carries no identity at all", () => {
  const v = shapeDeveloperFeedback(stored);
  assert.deepEqual(Object.keys(v).sort(), ["comment", "foundBug", "rating", "submittedAtMillis"]);
  const text = JSON.stringify(v);
  for (const secret of ["tester1", A, "dev1"]) assert.equal(text.includes(secret), false, secret);
});

test("the author's view carries their own record and nobody else's uid", () => {
  const v = shapeOwnFeedback(A, stored);
  assert.equal(v.assignmentId, A);
  assert.equal(v.rating, 3);
  assert.equal(v.foundBug, true);
  assert.equal(v.submittedAtMillis, 1_000_000);
  assert.equal("developerId" in v, false);
});

test("the admin's view is the full record", () => {
  const v = shapeAdminFeedback(A, stored);
  assert.equal(v.testerId, "tester1");
  assert.equal(v.developerId, "dev1");
  assert.equal(v.cycle, 1);
});

test("page size is clamped", () => {
  assert.equal(pageSize(undefined), FEEDBACK_PAGE_DEFAULT);
  assert.equal(pageSize(0), FEEDBACK_PAGE_DEFAULT);
  assert.equal(pageSize(-5), FEEDBACK_PAGE_DEFAULT);
  assert.equal(pageSize(10), 10);
  assert.equal(pageSize(10_000), FEEDBACK_PAGE_MAX);
});

// ---------------------------------------------------------------------------
// Callable guards (no database reached)
// ---------------------------------------------------------------------------

const noDb = new Proxy({}, { get() { throw new Error("database must not be touched"); } });

test("every feedback callable refuses an unauthenticated caller before any read", async () => {
  for (const impl of [submitTestingFeedbackImpl, getMyTestingFeedbackImpl, getAppFeedbackImpl, adminListFeedbackImpl]) {
    await assert.rejects(impl(noDb, { data: { assignmentId: A, appId: "app1", rating: 4 } }), (e) => e.code === "unauthenticated");
  }
});

test("malformed submissions are refused before any read", async () => {
  const auth = { uid: "tester1" };
  for (const data of [{}, ok({ rating: 9 }), ok({ comment: 5 }), ok({ testerId: "victim" }), ok({ assignmentId: "a/b" })]) {
    await assert.rejects(
      submitTestingFeedbackImpl(noDb, { auth, data }),
      (e) => e.code === "invalid-argument",
      JSON.stringify(data),
    );
  }
});

test("malformed reads are refused before any read", async () => {
  const auth = { uid: "u" };
  await assert.rejects(getMyTestingFeedbackImpl(noDb, { auth, data: {} }), (e) => e.code === "invalid-argument");
  await assert.rejects(getAppFeedbackImpl(noDb, { auth, data: { appId: "a/b" } }), (e) => e.code === "invalid-argument");
  await assert.rejects(getAppFeedbackImpl(noDb, { auth, data: { appId: "a", limit: "5" } }), (e) => e.code === "invalid-argument");
  await assert.rejects(adminListFeedbackImpl(noDb, { auth, data: { appId: "a", beforeMillis: "x" } }), (e) => e.code === "invalid-argument");
});

test("all four callables are exported and deployed in REGION", () => {
  for (const name of ["submitTestingFeedback", "getMyTestingFeedback", "getAppFeedback", "adminListFeedback"]) {
    assert.ok(functions[name], name);
    assert.deepEqual(functions[name].__endpoint.region, ["asia-south2"]);
    assert.ok(functions[name].__endpoint.callableTrigger, `${name} is a callable`);
  }
});

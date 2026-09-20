/**
 * Pure Quick Test rules. No Firestore, no emulator, no network.
 *
 * The orchestration in quickTests.js is proven against a real Firestore in
 * test-emulator/quickTests.concurrency.test.js; this file pins the decisions
 * that are decidable from plain values, which is where most of the eligibility
 * surface lives.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  quickTestSessionId,
  utcDayKey,
  daysBetweenDayKeys,
  checkQuickTestEligible,
  selectPoolAppIds,
} = require("../lib/quickTests");

/** Everything eligible; individual tests override one field at a time. */
function eligibleInput(overrides = {}) {
  return {
    appExists: true,
    appStatus: "approved",
    quickTestEnabled: true,
    appOwnerId: "dev1",
    uid: "tester1",
    isSuspended: false,
    sessionExists: false,
    sessionsToday: 0,
    lastSessionDayKey: null,
    todayKey: "2026-09-20",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Deterministic ids and day keys
// ---------------------------------------------------------------------------

test("the session id is deterministic in (uid, appId, dayKey)", () => {
  assert.equal(
    quickTestSessionId("tester1", "app1", "2026-09-20"),
    "tester1__app1__2026-09-20",
  );
  // The same inputs must always produce the same id — this is what makes
  // tx.create a duplicate-proof idempotency key rather than a hope.
  assert.equal(
    quickTestSessionId("tester1", "app1", "2026-09-20"),
    quickTestSessionId("tester1", "app1", "2026-09-20"),
  );
});

test("a different user, app or day produces a different session id", () => {
  const base = quickTestSessionId("tester1", "app1", "2026-09-20");
  assert.notEqual(base, quickTestSessionId("tester2", "app1", "2026-09-20"));
  assert.notEqual(base, quickTestSessionId("tester1", "app2", "2026-09-20"));
  assert.notEqual(base, quickTestSessionId("tester1", "app1", "2026-09-21"));
});

test("the day key is UTC and matches the Android and rules format", () => {
  assert.equal(utcDayKey(Date.parse("2026-09-20T00:00:00Z")), "2026-09-20");
  assert.equal(utcDayKey(Date.parse("2026-09-20T23:59:59Z")), "2026-09-20");
  assert.equal(utcDayKey(Date.parse("2026-09-21T00:00:00Z")), "2026-09-21");
  // Single-digit months and days stay zero-padded, or the string would not
  // match TimeProvider.todayKey() or serverDayKey() in the rules.
  assert.equal(utcDayKey(Date.parse("2026-01-02T12:00:00Z")), "2026-01-02");
});

test("day arithmetic spans months and years", () => {
  assert.equal(daysBetweenDayKeys("2026-09-13", "2026-09-20"), 7);
  assert.equal(daysBetweenDayKeys("2026-09-20", "2026-09-20"), 0);
  assert.equal(daysBetweenDayKeys("2026-01-28", "2026-02-04"), 7);
  assert.equal(daysBetweenDayKeys("2025-12-28", "2026-01-04"), 7);
});

test("unparseable day keys return null rather than a misleading number", () => {
  // A corrupt stored marker must fail a cooldown check closed, never read as
  // "long expired".
  assert.equal(daysBetweenDayKeys("garbage", "2026-09-20"), null);
  assert.equal(daysBetweenDayKeys(null, "2026-09-20"), null);
  assert.equal(daysBetweenDayKeys("2026-09-20", undefined), null);
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

test("an approved, quick-test-enabled app is eligible", () => {
  assert.deepEqual(checkQuickTestEligible(eligibleInput()), { ok: true });
});

test("a suspended user is refused before anything else is considered", () => {
  // Suspension is checked first on purpose: a suspended user should not learn
  // anything about the app from the error they get back.
  const result = checkQuickTestEligible(
    eligibleInput({ isSuspended: true, appExists: false, quickTestEnabled: false }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "suspended");
  assert.equal(result.code, "permission-denied");
});

test("a missing app is refused", () => {
  const result = checkQuickTestEligible(eligibleInput({ appExists: false }));
  assert.equal(result.reason, "missingApp");
  assert.equal(result.code, "not-found");
});

test("an unapproved app is refused in every non-approved state", () => {
  for (const status of ["pendingReview", "rejected", "archived", undefined]) {
    const result = checkQuickTestEligible(eligibleInput({ appStatus: status }));
    assert.equal(result.ok, false, "status " + status + " must be refused");
    assert.equal(result.reason, "notApproved");
  }
});

test("quickTestEnabled absent reads as disabled, never as enabled", () => {
  // Every app that predates this feature has no such field. Absent must be
  // the safe value or the pool would silently include the whole catalogue.
  for (const value of [undefined, null, false, 0, "", "true", 1]) {
    const result = checkQuickTestEligible(eligibleInput({ quickTestEnabled: value }));
    assert.equal(result.ok, false, JSON.stringify(value) + " must not enable");
    assert.equal(result.reason, "quickTestDisabled");
  }
});

test("a developer cannot Quick Test their own app", () => {
  const result = checkQuickTestEligible(
    eligibleInput({ appOwnerId: "tester1", uid: "tester1" }),
  );
  assert.equal(result.reason, "ownApp");
});

test("an existing session for today is reported as alreadyToday, not an error", () => {
  const result = checkQuickTestEligible(eligibleInput({ sessionExists: true }));
  assert.equal(result.reason, "alreadyToday");
});

test("the daily limit refuses the sixth Quick Test and allows the fifth", () => {
  assert.equal(checkQuickTestEligible(eligibleInput({ sessionsToday: 4 })).ok, true);
  const sixth = checkQuickTestEligible(eligibleInput({ sessionsToday: 5 }));
  assert.equal(sixth.ok, false);
  assert.equal(sixth.reason, "dailyLimit");
  assert.equal(sixth.code, "resource-exhausted");
});

test("a count already past the limit stays refused", () => {
  // Defensive: if a counter ever drifted above the limit, it must not wrap
  // around into "allowed" again.
  assert.equal(checkQuickTestEligible(eligibleInput({ sessionsToday: 99 })).reason, "dailyLimit");
});

test("a missing or malformed daily count is treated as zero", () => {
  for (const value of [undefined, null, "3", NaN]) {
    assert.equal(checkQuickTestEligible(eligibleInput({ sessionsToday: value })).ok, true);
  }
});

test("the cooldown blocks days 0 through 6 and clears on day 7", () => {
  const today = "2026-09-20";
  // Day 0 (same day) through day 6 are inside the 7-day cooldown.
  for (let daysAgo = 0; daysAgo < 7; daysAgo += 1) {
    const last = new Date(Date.parse(today + "T00:00:00Z") - daysAgo * 86400000)
      .toISOString()
      .slice(0, 10);
    const result = checkQuickTestEligible(
      eligibleInput({ lastSessionDayKey: last, todayKey: today }),
    );
    assert.equal(result.ok, false, daysAgo + " days ago must still be cooling down");
    assert.equal(result.reason, "cooldown");
  }
  // Exactly 7 days later clears it.
  assert.equal(
    checkQuickTestEligible(
      eligibleInput({ lastSessionDayKey: "2026-09-13", todayKey: today }),
    ).ok,
    true,
  );
  // And so does anything beyond.
  assert.equal(
    checkQuickTestEligible(
      eligibleInput({ lastSessionDayKey: "2026-08-01", todayKey: today }),
    ).ok,
    true,
  );
});

test("the cooldown message counts down the remaining days", () => {
  const oneLeft = checkQuickTestEligible(
    eligibleInput({ lastSessionDayKey: "2026-09-14", todayKey: "2026-09-20" }),
  );
  assert.match(oneLeft.message, /1 day\./);
  const threeLeft = checkQuickTestEligible(
    eligibleInput({ lastSessionDayKey: "2026-09-16", todayKey: "2026-09-20" }),
  );
  assert.match(threeLeft.message, /3 days\./);
});

test("a corrupt cooldown marker fails closed", () => {
  const result = checkQuickTestEligible(
    eligibleInput({ lastSessionDayKey: "not-a-date" }),
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "corruptCooldown");
});

test("no cooldown marker at all is the ordinary first-time case", () => {
  for (const value of [null, undefined, ""]) {
    assert.equal(checkQuickTestEligible(eligibleInput({ lastSessionDayKey: value })).ok, true);
  }
});

// ---------------------------------------------------------------------------
// Pool selection
// ---------------------------------------------------------------------------

function candidates(...specs) {
  return specs.map(([appId, lastSurfacedAtMillis]) => ({ appId, lastSurfacedAtMillis }));
}

test("the pool holds more than the five the screen promises", () => {
  const ten = Array.from({ length: 10 }, (_, i) => ["app" + i, i]);
  const pool = selectPoolAppIds({ candidates: candidates(...ten) });
  // 8, not 5: the client filters out its own apps and apps in cooldown, so a
  // pool of exactly 5 can render 2.
  assert.equal(pool.length, 8);
});

test("the pool survives the client filtering out three apps", () => {
  const ten = Array.from({ length: 10 }, (_, i) => ["app" + i, i]);
  const pool = selectPoolAppIds({ candidates: candidates(...ten) });
  const afterClientFilter = pool.filter((id) => !["app0", "app1", "app2"].includes(id));
  assert.ok(
    afterClientFilter.length >= 5,
    "after filtering 3, at least 5 must remain — got " + afterClientFilter.length,
  );
});

test("least-recently-surfaced sorts first", () => {
  const pool = selectPoolAppIds({
    candidates: candidates(["recent", 9000], ["older", 100], ["oldest", 1]),
    poolSize: 3,
  });
  assert.deepEqual(pool, ["oldest", "older", "recent"]);
});

test("a never-surfaced app sorts ahead of every surfaced one", () => {
  const pool = selectPoolAppIds({
    candidates: candidates(["surfaced", 1], ["brandNew", 0], ["alsoSurfaced", 2]),
    poolSize: 3,
  });
  assert.equal(pool[0], "brandNew");
});

test("rotation moves the pool on — the same apps are not returned forever", () => {
  // Ten candidates, pool of 8. After a refresh the chosen 8 are stamped with
  // "now", so the next refresh must prefer the two that were skipped.
  const now = 1_000_000;
  const first = selectPoolAppIds({
    candidates: candidates(
      ["a", 1], ["b", 2], ["c", 3], ["d", 4], ["e", 5],
      ["f", 6], ["g", 7], ["h", 8], ["i", 9], ["j", 10],
    ),
  });
  assert.deepEqual(first, ["a", "b", "c", "d", "e", "f", "g", "h"]);

  // Simulate the stamp the refresh applies to the selected apps.
  const second = selectPoolAppIds({
    candidates: candidates(
      ["a", now], ["b", now], ["c", now], ["d", now], ["e", now],
      ["f", now], ["g", now], ["h", now], ["i", 9], ["j", 10],
    ),
  });
  assert.equal(second[0], "i");
  assert.equal(second[1], "j");
  assert.notDeepEqual(first, second);
});

test("ties break on app id so the same input always gives the same pool", () => {
  const a = selectPoolAppIds({ candidates: candidates(["z", 0], ["a", 0], ["m", 0]), poolSize: 3 });
  const b = selectPoolAppIds({ candidates: candidates(["m", 0], ["z", 0], ["a", 0]), poolSize: 3 });
  assert.deepEqual(a, ["a", "m", "z"]);
  assert.deepEqual(a, b);
});

test("duplicate candidates collapse to one entry", () => {
  const pool = selectPoolAppIds({
    candidates: candidates(["dup", 1], ["dup", 2], ["other", 3]),
    poolSize: 8,
  });
  assert.deepEqual(pool, ["dup", "other"]);
});

test("fewer candidates than the pool size returns all of them", () => {
  const pool = selectPoolAppIds({ candidates: candidates(["a", 1], ["b", 2]) });
  assert.deepEqual(pool, ["a", "b"]);
});

test("no candidates returns an empty pool rather than throwing", () => {
  assert.deepEqual(selectPoolAppIds({ candidates: [] }), []);
  assert.deepEqual(selectPoolAppIds({ candidates: null }), []);
});

test("malformed candidates are skipped, not surfaced", () => {
  const pool = selectPoolAppIds({
    candidates: [null, { appId: "" }, { appId: "good", lastSurfacedAtMillis: 1 }, {}],
    poolSize: 8,
  });
  assert.deepEqual(pool, ["good"]);
});

test("a non-numeric lastSurfacedAt is treated as never surfaced", () => {
  const pool = selectPoolAppIds({
    candidates: [
      { appId: "broken", lastSurfacedAtMillis: undefined },
      { appId: "fresh", lastSurfacedAtMillis: 5 },
    ],
    poolSize: 2,
  });
  assert.deepEqual(pool, ["broken", "fresh"]);
});

/**
 * Deploy regions, read from the manifest each function carries (`__endpoint`).
 *
 * Two regions, on purpose. Everything runs in REGION (asia-south2, next to the
 * database) EXCEPT scheduled functions: Cloud Scheduler has no asia-south2
 * location and `onSchedule` puts its job in the function's own region, so a
 * scheduled function left in REGION fails to deploy. These tests pin both
 * halves - a scheduled function drifting back to REGION, or anything else
 * drifting out of it, is caught here rather than by a failed deploy.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { REGION, SCHEDULER_REGION } = require("../lib/constants");
const functions = require("../index");

const SCHEDULED = ["evaluateExpiredCommitments", "refreshQuickTestPool"];

test("the two regions are the intended ones", () => {
  assert.equal(REGION, "asia-south2");
  assert.equal(SCHEDULER_REGION, "asia-south1");
});

test("exactly the expected functions are scheduled", () => {
  const scheduled = Object.entries(functions)
    .filter(([, fn]) => fn.__endpoint && fn.__endpoint.scheduleTrigger)
    .map(([name]) => name)
    .sort();
  assert.deepEqual(scheduled, [...SCHEDULED].sort());
});

for (const name of SCHEDULED) {
  test(`${name} runs in SCHEDULER_REGION on Indian time`, () => {
    const endpoint = functions[name].__endpoint;
    assert.deepEqual(endpoint.region, [SCHEDULER_REGION]);
    assert.equal(endpoint.scheduleTrigger.timeZone, "Asia/Kolkata");
  });
}

test("every non-scheduled function stays in REGION", () => {
  const others = Object.entries(functions).filter(([name]) => !SCHEDULED.includes(name));
  assert.equal(others.length, 25);
  for (const [name, fn] of others) {
    assert.deepEqual(fn.__endpoint.region, [REGION], `${name} left ${REGION}`);
  }
});

// ---------------------------------------------------------------------------
// The deployed schedule, pinned LITERALLY.
//
// The tests above compare against the constants, so they would still pass if
// someone edited a constant. These state the production layout as plain
// strings: changing when money moves, or where a job runs, must mean changing
// a test that says so in words.
// ---------------------------------------------------------------------------

test("evaluateExpiredCommitments runs exactly once a day at 03:30 IST", () => {
  const trigger = functions.evaluateExpiredCommitments.__endpoint.scheduleTrigger;
  assert.equal(trigger.schedule, "every day 03:30");
  assert.equal(trigger.timeZone, "Asia/Kolkata");
});

test("refreshQuickTestPool runs exactly every 60 minutes, on IST", () => {
  const trigger = functions.refreshQuickTestPool.__endpoint.scheduleTrigger;
  assert.equal(trigger.schedule, "every 60 minutes");
  assert.equal(trigger.timeZone, "Asia/Kolkata");
});

test("the production region layout, stated literally", () => {
  for (const name of SCHEDULED) {
    assert.deepEqual(functions[name].__endpoint.region, ["asia-south1"], `${name} region`);
  }
  for (const [name, fn] of Object.entries(functions)) {
    if (SCHEDULED.includes(name)) continue;
    assert.deepEqual(fn.__endpoint.region, ["asia-south2"], `${name} region`);
    assert.equal(fn.__endpoint.scheduleTrigger, undefined, `${name} must not be scheduled`);
  }
  // The manual pool refresh is the callable twin of a scheduled job; it stays
  // with the other callables, not with the scheduler.
  const manual = functions.adminRefreshQuickTestPool.__endpoint;
  assert.ok(manual.callableTrigger, "adminRefreshQuickTestPool is still callable");
  assert.deepEqual(manual.region, ["asia-south2"]);
});

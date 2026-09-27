/**
 * Tests for the physical-device seed fixture's day arithmetic.
 *
 * The fixture is test-only code, but it decides what the phone displays during
 * a device smoke test, so a bug here does not fail loudly - it quietly makes
 * the smoke test prove something other than what it claims. That is worth
 * covering.
 *
 * WHAT THIS IS GUARDING
 * `--advance-to N` rewrites an assignment so that "today" is day N. Getting
 * `nextCheckInAt` wrong (or, as it originally did, not writing it at all)
 * produces a state the product cannot reach: the UI gates the check-in button
 * on that field, so a stale value renders "Logged today" on a day with no
 * testing log behind it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// The fixture refuses to load outside the emulators - deliberately, so it can
// never be pointed at production. Satisfy that guard for the import; nothing
// here connects to anything.
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const { advanceFields } = require("../test-emulator/seed-device-test");
const {
  addDays,
  startOfLocalDayMillis,
  dayKeyInZone,
} = require("../lib/testingDays");
const { COMMITMENT_WINDOW_DAYS } = require("../lib/constants");

const TZ = "Asia/Kolkata";
const TODAY = "2026-09-23";

const fields = (targetDay, timeZone = TZ) =>
  advanceFields({
    todayKey: TODAY,
    targetDay,
    windowDays: COMMITMENT_WINDOW_DAYS,
    timeZone,
  });

/**
 * The client's rule, reproduced exactly: `TestAssignment.hasLoggedTodayAt`
 * reports "logged today" while now is BEFORE the stored boundary.
 */
const rendersLoggedToday = (nextCheckInAtMillis, nowMillis) =>
  nowMillis < nextCheckInAtMillis;

test("the fixture never claims a day is logged when it seeded no log for it", () => {
  // The whole point of the fixture: day N is today, and today is NOT logged.
  for (let targetDay = 2; targetDay <= 14; targetDay += 1) {
    const f = fields(targetDay);

    // Today is genuinely absent from the seeded logs.
    assert.equal(
      f.logDayKeys.includes(TODAY),
      false,
      `day ${targetDay}: today must not be pre-logged`,
    );
    assert.equal(f.logDayKeys.length, targetDay - 1);

    // And the UI must therefore offer the check-in, at every instant of today.
    const startOfToday = startOfLocalDayMillis(TODAY, TZ);
    const endOfToday = startOfLocalDayMillis(addDays(TODAY, 1), TZ) - 1;
    for (const now of [startOfToday, startOfToday + 3600000, endOfToday]) {
      assert.equal(
        rendersLoggedToday(f.nextCheckInAtMillis, now),
        false,
        `day ${targetDay}: must not render "Logged today" at ${now}`,
      );
    }
  }
});

test("the check-in boundary is local midnight at the start of the simulated day", () => {
  const f = fields(7);
  assert.equal(f.nextCheckInAtMillis, startOfLocalDayMillis(TODAY, TZ));
  // Derived in the pinned zone, not UTC: IST is +05:30, so the boundary is
  // 18:30 the previous UTC day. Getting this wrong by a zone is precisely the
  // bug the server-side day engine exists to prevent.
  assert.equal(dayKeyInZone(f.nextCheckInAtMillis, TZ), TODAY);
});

test("the last qualifying day is the day before the simulated day", () => {
  for (let targetDay = 2; targetDay <= 14; targetDay += 1) {
    const f = fields(targetDay);
    assert.equal(f.lastQualifyingDayKey, addDays(TODAY, -1));
    // It is also the last day actually seeded, so the stored field and the
    // logs agree rather than merely both being plausible.
    assert.equal(f.logDayKeys[f.logDayKeys.length - 1], addDays(TODAY, -1));
  }
});

test("the seeded logs are exactly days 1..N-1, contiguous from the window start", () => {
  const f = fields(14);
  assert.equal(f.logDayKeys.length, 13);
  assert.equal(f.logDayKeys[0], f.firstEligibleDayKey);
  for (let i = 1; i < f.logDayKeys.length; i += 1) {
    assert.equal(f.logDayKeys[i], addDays(f.logDayKeys[i - 1], 1));
  }
  // No duplicates: a repeated key would silently reduce the real log count.
  assert.equal(new Set(f.logDayKeys).size, f.logDayKeys.length);
});

test("today is day N, counting from the rewritten window start", () => {
  for (const targetDay of [2, 5, 14]) {
    const f = fields(targetDay);
    assert.equal(addDays(f.firstEligibleDayKey, targetDay - 1), TODAY);
    // Eligibility starts the day after the claim, exactly as the real claim
    // path derives it.
    assert.equal(addDays(f.claimedDayKey, 1), f.firstEligibleDayKey);
  }
});

test("the rewritten window keeps its full length and stays open on the simulated day", () => {
  const f = fields(14);
  assert.equal(
    addDays(f.firstEligibleDayKey, COMMITMENT_WINDOW_DAYS - 1),
    f.lastEligibleDayKey,
  );
  // The window must not have closed on the day the fixture wants tested,
  // otherwise the check-in under test would be refused as expired.
  assert.ok(f.lastEligibleDayKey >= TODAY);
  assert.equal(
    f.windowEndsAtMillis,
    startOfLocalDayMillis(addDays(f.lastEligibleDayKey, 1), TZ),
  );
});

test("the derivation holds in a zone west of UTC too", () => {
  const f = fields(14, "America/Los_Angeles");
  assert.equal(
    f.nextCheckInAtMillis,
    startOfLocalDayMillis(TODAY, "America/Los_Angeles"),
  );
  assert.equal(f.logDayKeys.includes(TODAY), false);
  assert.equal(f.lastQualifyingDayKey, addDays(TODAY, -1));
});

// ---------------------------------------------------------------------------
// The fixture refuses to load unless BOTH emulator hosts are set (Batch 9F)
//
// It lists Auth users to find the phone's. With only the Firestore host set,
// firebase-admin would send that Auth call to the real project and read
// production accounts. Loaded in a child process with a controlled
// environment, so this file's own settings cannot mask a regression; the guard
// throws before firebase-admin is initialized, so nothing connects anywhere.
// ---------------------------------------------------------------------------

const SEED = path.join(__dirname, "..", "test-emulator", "seed-device-test.js");

function loadSeedWith(env) {
  const clean = { ...process.env };
  delete clean.FIRESTORE_EMULATOR_HOST;
  delete clean.FIREBASE_AUTH_EMULATOR_HOST;
  return spawnSync(process.execPath, ["-e", `require(${JSON.stringify(SEED)})`], {
    env: { ...clean, ...env },
    encoding: "utf8",
    timeout: 30000,
  });
}

test("the seed fixture refuses to load without the Auth emulator host", () => {
  const r = loadSeedWith({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FIREBASE_AUTH_EMULATOR_HOST not set/);
});

test("the seed fixture refuses to load without the Firestore emulator host", () => {
  const r = loadSeedWith({ FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FIRESTORE_EMULATOR_HOST not set/);
});

test("the seed fixture refuses to load with neither emulator host", () => {
  const r = loadSeedWith({});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST not set/);
});

test("the seed fixture loads (without running) when both emulator hosts are set", () => {
  // Requiring is not running: main() only starts when executed directly.
  const r = loadSeedWith({
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
  });
  assert.equal(r.status, 0, r.stderr);
});

/**
 * The miss rule, as pure decisions.
 *
 * A commitment claimed under the rule (16-day window, 14 required, 2 allowed
 * misses) is removed at the third missed day. These tests pin what a "miss"
 * is, when it becomes one, and that every decision point - the shared expiry
 * verdict, the check-in gate, the forfeiture gate and the cancellation gate -
 * agrees about it. The settlement side (coins, capacity, sweep) is exercised
 * in expiry.test.js section M and in the emulator suites.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { countMissedDays, missRuleApplies, removalCheckAtMillis } = require("../lib/misses");
const { checkCommitmentExpiry } = require("../lib/expiry");
const {
  deriveWindow,
  addDays,
  startOfLocalDayMillis,
  checkTestingDayEligible,
} = require("../lib/testingDays");
const {
  checkForfeitEligible,
  checkCancelEligible,
  lockEntryId,
  MILLIS_PER_DAY,
} = require("../lib/commitments");
const {
  COMMITMENT_WINDOW_DAYS,
  COMMITMENT_DAYS_REQUIRED,
  COMMITMENT_ALLOWED_MISSES,
  FAILURE_REASON_TOO_MANY_MISSES,
  FAILURE_REASON_WINDOW_CLOSED_SHORT,
} = require("../lib/constants");

const IST = "Asia/Kolkata";
const CLAIMED_AT = Date.parse("2026-03-01T06:00:00Z");
/** A NEW window: claimed 2026-03-01 IST, day 1 = 2026-03-02, day 16 = 2026-03-17. */
const W = deriveWindow({ claimedAtMillis: CLAIMED_AT, timeZone: IST });
const HOUR = 60 * 60 * 1000;

/** The day key of eligible day `n` (1-based). */
const day = (n) => addDays(W.firstEligibleDayKey, n - 1);
/** An instant `hours` into eligible day `n`, local time. */
const at = (n, hours = 12) => startOfLocalDayMillis(day(n), IST) + hours * HOUR;
/** Day keys for eligible days `from`..`to`, skipping any in `skip`. */
function logged(from, to, skip = []) {
  const out = [];
  for (let n = from; n <= to; n += 1) if (!skip.includes(n)) out.push(day(n));
  return out;
}

function expiry({ loggedDays, nowMillis, allowedMisses = 2, outageRecords = [], extra = {} }) {
  return checkCommitmentExpiry({
    status: "inProgress",
    lockTxId: "lock_x",
    appId: "app1",
    timeZone: IST,
    firstEligibleDayKey: W.firstEligibleDayKey,
    lastEligibleDayKey: W.lastEligibleDayKey,
    qualifyingDays: loggedDays.length,
    daysRequired: COMMITMENT_DAYS_REQUIRED,
    outageRecords,
    nowMillis,
    allowedMisses,
    loggedDayKeys: loggedDays,
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// The configuration
// ---------------------------------------------------------------------------

test("a new commitment's window is 16 days and 14 are required, leaving exactly 2 misses", () => {
  assert.equal(W.windowDays, 16);
  assert.equal(W.lastEligibleDayKey, "2026-03-17");
  assert.equal(COMMITMENT_WINDOW_DAYS, 16);
  assert.equal(COMMITMENT_DAYS_REQUIRED, 14);
  assert.equal(COMMITMENT_ALLOWED_MISSES, 2);
});

test("the miss rule applies only when allowedMisses is pinned on the assignment", () => {
  assert.equal(missRuleApplies(2), true);
  assert.equal(missRuleApplies(0), true);
  for (const legacy of [undefined, null, "2", 2.5, -1, NaN]) {
    assert.equal(missRuleApplies(legacy), false, `${String(legacy)} must not opt in`);
  }
});

// ---------------------------------------------------------------------------
// What counts as a miss
// ---------------------------------------------------------------------------

const count = (loggedDays, todayN, extra = {}) =>
  countMissedDays({
    firstEligibleDayKey: W.firstEligibleDayKey,
    lastEligibleDayKey: W.lastEligibleDayKey,
    todayKey: day(todayN),
    loggedDayKeys: loggedDays,
    ...extra,
  });

test("nothing is missed before day 1 or on day 1 itself", () => {
  assert.equal(
    countMissedDays({
      firstEligibleDayKey: W.firstEligibleDayKey,
      lastEligibleDayKey: W.lastEligibleDayKey,
      todayKey: W.claimedDayKey,
      loggedDayKeys: [],
    }),
    0,
  );
  assert.equal(count([], 1), 0, "today is still available, so it is never a miss");
});

test("today is never a miss and future days never are", () => {
  // Day 5, nothing logged at all: days 1-4 are missed, 5 is today, 6+ future.
  assert.equal(count([], 5), 4);
  // Logging today does not change the past.
  assert.equal(count([day(5)], 5), 4);
});

test("a logged day is not a miss, and each day is judged exactly once", () => {
  assert.equal(count(logged(1, 4), 5), 0);
  assert.equal(count(logged(1, 4, [2]), 5), 1);
  // A duplicated day key - a retried read, a merged list - counts once.
  assert.equal(count([day(1), day(1), day(3), day(3)], 5), 2);
});

test("a declared outage day is not a miss", () => {
  assert.equal(count(logged(1, 4, [2]), 5, { outageDayKeys: [day(2)] }), 0);
  assert.equal(count([], 5, { outageDayKeys: [day(1), day(3)] }), 2);
});

test("days after the window's last day are never misses", () => {
  // Well after the window closed, with everything logged: still 0.
  assert.equal(
    countMissedDays({
      firstEligibleDayKey: W.firstEligibleDayKey,
      lastEligibleDayKey: W.lastEligibleDayKey,
      todayKey: addDays(W.lastEligibleDayKey, 30),
      loggedDayKeys: logged(1, 16),
    }),
    0,
  );
});

test("malformed input cannot be judged, and says so with null", () => {
  assert.equal(count(null, 5), null);
  assert.equal(
    countMissedDays({ firstEligibleDayKey: "x", lastEligibleDayKey: W.lastEligibleDayKey, todayKey: day(5), loggedDayKeys: [] }),
    null,
  );
});

// ---------------------------------------------------------------------------
// The verdict: 0, 1, 2 misses live; the 3rd removes
// ---------------------------------------------------------------------------

test("0, 1 and 2 misses leave the commitment active", () => {
  for (const [misses, skip] of [[0, []], [1, [3]], [2, [3, 7]]]) {
    // Day 10, days 1-9 judged.
    const v = expiry({ loggedDays: logged(1, 9, skip), nowMillis: at(10) });
    assert.equal(v.expired, false, `${misses} miss(es) must not remove`);
    assert.equal(v.reason, "windowOpen");
    assert.equal(v.missedDays, misses);
  }
});

test("the 3rd miss produces tooManyMisses, before the window has closed", () => {
  const v = expiry({ loggedDays: logged(1, 9, [3, 5, 7]), nowMillis: at(10) });
  assert.equal(v.expired, true);
  assert.equal(v.reason, FAILURE_REASON_TOO_MANY_MISSES);
  assert.equal(v.missedDays, 3);
  assert.equal(v.qualifyingDays, 6);
});

test("the 3rd miss lands exactly at local midnight, not a millisecond before", () => {
  // Days 1, 2 and 3 all missed. Day 3 is a miss only once day 4 has begun.
  const boundary = startOfLocalDayMillis(day(4), IST);
  assert.equal(expiry({ loggedDays: [], nowMillis: boundary - 1 }).expired, false);
  const v = expiry({ loggedDays: [], nowMillis: boundary });
  assert.equal(v.expired, true);
  assert.equal(v.reason, FAILURE_REASON_TOO_MANY_MISSES);
  // UTC midnight in between decides nothing - the pinned zone does.
  assert.equal(expiry({ loggedDays: [], nowMillis: Date.parse(`${day(3)}T23:59:00Z`) }).missedDays, 3);
});

test("an outage day inside the window does not bring the removal forward", () => {
  const outageRecords = [{ dayKey: day(3), degraded: true, scope: "global" }];
  // Days 1, 2, 3 unlogged, but day 3 was an outage: two misses, still live.
  const v = expiry({ loggedDays: [], nowMillis: at(4), outageRecords });
  assert.equal(v.expired, false);
  assert.equal(v.missedDays, 2);
  // The next unlogged day is the third real miss.
  assert.equal(expiry({ loggedDays: [], nowMillis: at(5), outageRecords }).reason, FAILURE_REASON_TOO_MANY_MISSES);
});

test("14 qualifying days is never a removal, whatever the misses", () => {
  // Logged every day 1-14: the requirement is met.
  const v = expiry({ loggedDays: logged(1, 14), nowMillis: at(16) });
  assert.equal(v.expired, false);
});

test("a legacy commitment (no allowedMisses) is never judged on misses", () => {
  const v = expiry({ loggedDays: [], nowMillis: at(10), allowedMisses: null });
  assert.equal(v.expired, false, "nine unlogged days, but the legacy rule is window-only");
  assert.equal(v.reason, "windowOpen");
  assert.equal(v.missedDays, null);
});

test("allowedMisses without the logs fails closed - no miss verdict is guessed", () => {
  const v = expiry({ loggedDays: [], nowMillis: at(10), extra: { loggedDayKeys: null } });
  assert.equal(v.expired, false);
  assert.equal(v.missedDays, null);
});

test("a settled commitment is never re-judged on misses", () => {
  for (const status of ["completed", "failed", "cancelled", "missed"]) {
    const v = expiry({ loggedDays: [], nowMillis: at(10), extra: { status } });
    assert.equal(v.expired, false, status);
    assert.equal(v.reason, "alreadySettled");
  }
});

test("after the window closes, a commitment over the limit still records tooManyMisses", () => {
  const v = expiry({ loggedDays: logged(1, 16, [2, 4, 6]), nowMillis: at(16) + 13 * HOUR });
  assert.equal(v.expired, true);
  assert.equal(v.reason, FAILURE_REASON_TOO_MANY_MISSES, "the third miss is what ended it");
});

test("with outage credit, the misses are counted across the EXTENDED window", () => {
  const outageRecords = [
    { dayKey: day(5), degraded: true, scope: "global" },
    { dayKey: day(6), degraded: true, scope: "global" },
  ];
  // The outage extends the window by two days, to day 18.
  const afterExtended = startOfLocalDayMillis(addDays(W.lastEligibleDayKey, 3), IST);
  const v = expiry({
    loggedDays: logged(1, 18, [5, 6, 9, 10, 17, 18]),
    nowMillis: afterExtended,
    outageRecords,
  });
  assert.equal(v.missedDays, 4, "days 9, 10, 17 and 18 are misses; 5 and 6 are outages");
  assert.equal(v.expired, true);
  assert.equal(v.reason, FAILURE_REASON_TOO_MANY_MISSES);
});

test("for a NEW commitment, closing short always means the third miss already happened", () => {
  // logged + missed + unlogged-outage days == 16 + credit, and unlogged-outage
  // days <= credit, so at most 2 misses forces at least 14 logged days. Every
  // short close is therefore a tooManyMisses; windowClosedShort remains the
  // legacy commitments' reason. Checked across every placement of 3..6 misses.
  const afterClose = startOfLocalDayMillis(addDays(W.lastEligibleDayKey, 1), IST);
  for (let misses = 3; misses <= 6; misses += 1) {
    for (let start = 1; start + misses - 1 <= 16; start += 1) {
      const skip = Array.from({ length: misses }, (_, i) => start + i);
      const v = expiry({ loggedDays: logged(1, 16, skip), nowMillis: afterClose });
      assert.equal(v.reason, FAILURE_REASON_TOO_MANY_MISSES, `misses ${skip}`);
    }
  }
  // And with at most 2 misses the window cannot close short at all.
  for (const skip of [[], [1], [16], [1, 16], [8, 9]]) {
    const v = expiry({ loggedDays: logged(1, 16, skip), nowMillis: afterClose });
    assert.equal(v.expired, false, `misses ${skip}`);
  }
  // A legacy commitment closing short keeps its original reason.
  const legacy = expiry({ loggedDays: logged(1, 10), nowMillis: afterClose, allowedMisses: null });
  assert.equal(legacy.reason, FAILURE_REASON_WINDOW_CLOSED_SHORT);
});

// ---------------------------------------------------------------------------
// The check-in gate agrees
// ---------------------------------------------------------------------------

const checkIn = (overrides) =>
  checkTestingDayEligible({
    status: "inProgress",
    lockTxId: "lock_x",
    cycle: 1,
    firstEligibleDayKey: W.firstEligibleDayKey,
    lastEligibleDayKey: W.lastEligibleDayKey,
    todayKey: day(10),
    qualifyingDays: 6,
    daysRequired: 14,
    alreadyLoggedToday: false,
    ...overrides,
  });

test("a check-in is refused once the misses exceed the limit", () => {
  const r = checkIn({ missedDays: 3, allowedMisses: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.tooManyMisses, true);
  assert.match(r.message, /missed more testing days than allowed/);
});

test("a check-in at 2 misses is accepted", () => {
  assert.equal(checkIn({ missedDays: 2, allowedMisses: 2 }).ok, true);
});

test("a same-day repeat stays an idempotent no-op, not a removal error", () => {
  const r = checkIn({ missedDays: 3, allowedMisses: 2, alreadyLoggedToday: true });
  assert.equal(r.alreadyLogged, true);
});

test("a legacy check-in ignores misses entirely", () => {
  assert.equal(checkIn({ missedDays: 9, allowedMisses: null }).ok, true);
});

// ---------------------------------------------------------------------------
// The forfeiture and cancellation gates agree
// ---------------------------------------------------------------------------

const forfeitGate = (overrides) =>
  checkForfeitEligible({
    status: "inProgress",
    lockTxId: lockEntryId("a__t__c1"),
    createdAtMillis: CLAIMED_AT,
    windowDays: 16,
    daysRequired: 14,
    qualifyingDays: 6,
    nowMillis: at(10),
    ...overrides,
  });

test("early removal waives ONLY the elapsed-calendar gate", () => {
  assert.equal(forfeitGate({}).ok, false, "day 10 of 16: the calendar gate refuses");
  assert.equal(forfeitGate({ earlyRemoval: true }).ok, true);
  // Every other refusal still holds.
  assert.equal(forfeitGate({ earlyRemoval: true, status: "failed" }).ok, false);
  assert.equal(forfeitGate({ earlyRemoval: true, lockTxId: null }).ok, false);
  assert.equal(forfeitGate({ earlyRemoval: true, qualifyingDays: 14 }).ok, false);
  assert.equal(forfeitGate({ earlyRemoval: true, createdAtMillis: 0 }).ok, false);
});

test("a stored assignment missing windowDays falls back to the LONGER legacy window", () => {
  // 17 days after claim: past a 16-day window, inside an 18-day one.
  const r = forfeitGate({ windowDays: undefined, nowMillis: CLAIMED_AT + 17 * MILLIS_PER_DAY });
  assert.equal(r.ok, false, "a corrupt doc must never be forfeited sooner than its rules");
});

test("cancellation after the 3rd miss is refused with a reason that says so", () => {
  const v = expiry({ loggedDays: logged(1, 9, [3, 5, 7]), nowMillis: at(10) });
  const r = checkCancelEligible({ status: "inProgress", lockTxId: "lock_x", expiry: v });
  assert.equal(r.ok, false);
  assert.match(r.message, /missed more testing days than allowed/);
});

test("cancellation at 2 misses is still allowed", () => {
  const v = expiry({ loggedDays: logged(1, 9, [3, 7]), nowMillis: at(10) });
  assert.equal(checkCancelEligible({ status: "inProgress", lockTxId: "lock_x", expiry: v }).ok, true);
});

// ---------------------------------------------------------------------------
// The sweep-candidate hint
// ---------------------------------------------------------------------------

test("a fresh claim becomes a removal candidate at the start of day 4", () => {
  const t = removalCheckAtMillis({ fromDayKey: W.claimedDayKey, missedSoFar: 0, allowedMisses: 2, timeZone: IST });
  assert.equal(t, startOfLocalDayMillis(day(4), IST));
  // ...which is exactly the first instant the verdict can say tooManyMisses.
  assert.equal(expiry({ loggedDays: [], nowMillis: t }).reason, FAILURE_REASON_TOO_MANY_MISSES);
  assert.equal(expiry({ loggedDays: [], nowMillis: t - 1 }).expired, false);
});

test("after a check-in the hint moves to the earliest possible third miss", () => {
  // Checked in on day 5 with 1 miss so far: two more misses (days 6, 7) are
  // needed, so removal is possible from the start of day 8.
  const t = removalCheckAtMillis({ fromDayKey: day(5), missedSoFar: 1, allowedMisses: 2, timeZone: IST });
  assert.equal(t, startOfLocalDayMillis(day(8), IST));
  const loggedDays = logged(1, 5, [2]);
  assert.equal(expiry({ loggedDays, nowMillis: t }).reason, FAILURE_REASON_TOO_MANY_MISSES);
  assert.equal(expiry({ loggedDays, nowMillis: t - 1 }).expired, false);
});

test("the hint is a LOWER bound: an outage can only make the real removal later", () => {
  const t = removalCheckAtMillis({ fromDayKey: W.claimedDayKey, missedSoFar: 0, allowedMisses: 2, timeZone: IST });
  const outageRecords = [{ dayKey: day(2), degraded: true, scope: "global" }];
  assert.equal(expiry({ loggedDays: [], nowMillis: t, outageRecords }).expired, false);
});

test("no hint for a legacy commitment", () => {
  assert.equal(removalCheckAtMillis({ fromDayKey: W.claimedDayKey, allowedMisses: undefined, timeZone: IST }), null);
});

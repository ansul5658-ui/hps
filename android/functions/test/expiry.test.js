/**
 * Automatic expiry: the boundary, the outage credit, the sweep, and the
 * refusals.
 *
 * WHAT IS ACTUALLY BEING PROTECTED
 * Every `expired: true` in this file would destroy 50 of a tester's coins.
 * So the tests are weighted deliberately towards the refusals: a window that
 * is still open, a requirement that was met, an outage that applies, a missing
 * timezone, an assignment that staked nothing. Getting a `false` wrong settles
 * a commitment a day late; getting a `true` wrong takes money from someone who
 * did the work.
 *
 * THE BOUNDARY IS A LOCAL MIDNIGHT, NOT A UTC ONE
 * The window closes at midnight in the assignment's PINNED zone. For IST that
 * is 18:30 UTC the previous day, and the tests assert the instant rather than
 * the day string so a regression to UTC boundaries cannot pass. A DST zone is
 * included because a local day there is sometimes 23 or 25 hours long.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeJoinReady } = require("./joinReady");

const { checkCommitmentExpiry, couldBeExpired } = require("../lib/expiry");
const { OUTAGE_SCOPE_GLOBAL, OUTAGE_SCOPE_APP } = require("../lib/outages");
const {
  deriveWindow,
  startOfLocalDayMillis,
  addDays,
} = require("../lib/testingDays");
const { COMMITMENT_DAYS_REQUIRED, LEGACY_COMMITMENT_WINDOW_DAYS } = require("../lib/constants");
const { runExpirySweep, findExpiryCandidates, evaluateAssignmentExpiry } = require("../expiry");
const { runForfeitCommitment } = require("../commitments");
const { runDeclareOutage } = require("../systemHealth");
const { forfeitEntryId, lockEntryId, cycleAssignmentId, activeClaimId } = require("../lib/commitments");
const { checkInvariants } = require("../lib/wallet");

const IST = "Asia/Kolkata";
const LA = "America/Los_Angeles";
const APP = "app1";
const OTHER_APP = "app2";
const TESTER = "tester1";
const DEV = "dev1";
const C1 = cycleAssignmentId(APP, TESTER, 1);
const C1_PATH = `testingAssignments/${C1}`;
const WALLET_PATH = `users/${TESTER}/wallet/balance`;
const CLAIM_PATH = `activeClaims/${activeClaimId(APP, TESTER)}`;

/**
 * The window a claim on 2026-03-01 06:00 UTC pinned, in IST, BEFORE the miss
 * rule: an 18-day window and no `allowedMisses`. Every fixture in this file is
 * such a legacy commitment, which is exactly what proves those keep their
 * original rules. The miss rule has its own suite (misses.test.js).
 */
const W = deriveWindow({
  claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"),
  timeZone: IST,
  windowDays: LEGACY_COMMITMENT_WINDOW_DAYS,
});

const base = (over = {}) => ({
  status: "inProgress",
  lockTxId: lockEntryId(C1),
  appId: APP,
  timeZone: IST,
  firstEligibleDayKey: W.firstEligibleDayKey,
  lastEligibleDayKey: W.lastEligibleDayKey,
  qualifyingDays: 5,
  daysRequired: COMMITMENT_DAYS_REQUIRED,
  outageRecords: [],
  ...over,
});

/** The exact instant the pinned window shuts: local midnight after the last day. */
const boundaryMillis = (lastKey = W.lastEligibleDayKey, tz = IST) =>
  startOfLocalDayMillis(addDays(lastKey, 1), tz);

const globalOutage = (dayKey) => ({
  dayKey,
  degraded: true,
  scope: OUTAGE_SCOPE_GLOBAL,
  appId: null,
});
const appOutage = (dayKey, appId = APP) => ({
  dayKey,
  degraded: true,
  scope: OUTAGE_SCOPE_APP,
  appId,
});

// ---------------------------------------------------------------------------
// A. The boundary
// ---------------------------------------------------------------------------

test("A: the window is 2026-03-02..2026-03-19 and shuts at IST midnight", () => {
  assert.equal(W.firstEligibleDayKey, "2026-03-02");
  assert.equal(W.lastEligibleDayKey, "2026-03-19");
  // 00:00 IST on the 20th is 18:30 UTC on the 19th. If this ever equals
  // midnight UTC, the boundary has regressed to the wrong clock.
  assert.equal(boundaryMillis(), Date.parse("2026-03-19T18:30:00Z"));
  assert.notEqual(boundaryMillis(), Date.parse("2026-03-20T00:00:00Z"));
});

test("A: well before the final day is NOT expired", () => {
  const v = checkCommitmentExpiry(base({ nowMillis: startOfLocalDayMillis("2026-03-10", IST) }));
  assert.equal(v.expired, false);
  assert.equal(v.reason, "windowOpen");
});

test("A: DURING the final eligible day is NOT expired", () => {
  const noon = startOfLocalDayMillis("2026-03-19", IST) + 12 * 3600 * 1000;
  const v = checkCommitmentExpiry(base({ nowMillis: noon }));
  assert.equal(v.expired, false, "the last eligible day is itself a testing day");
  assert.equal(v.reason, "windowOpen");
});

test("A: one millisecond before the boundary is NOT expired", () => {
  const v = checkCommitmentExpiry(base({ nowMillis: boundaryMillis() - 1 }));
  assert.equal(v.expired, false);
  assert.equal(v.todayKey, "2026-03-19");
});

test("A: EXACTLY at the boundary is expired", () => {
  const v = checkCommitmentExpiry(base({ nowMillis: boundaryMillis() }));
  assert.equal(v.expired, true);
  assert.equal(v.reason, "windowClosedShort");
  assert.equal(v.todayKey, "2026-03-20", "a new local day has begun");
});

test("A: one second after the boundary is expired", () => {
  const v = checkCommitmentExpiry(base({ nowMillis: boundaryMillis() + 1000 }));
  assert.equal(v.expired, true);
});

test("A: the UTC midnight in between decides nothing", () => {
  // 00:00 UTC on the 20th is 05:30 IST on the 20th — already past the IST
  // boundary. But 20:00 UTC on the 19th (01:30 IST on the 20th) is ALSO past
  // it, while 18:00 UTC on the 19th (23:30 IST on the 19th) is not. A UTC
  // boundary would get both of those wrong.
  assert.equal(checkCommitmentExpiry(base({ nowMillis: Date.parse("2026-03-19T18:00:00Z") })).expired, false);
  assert.equal(checkCommitmentExpiry(base({ nowMillis: Date.parse("2026-03-19T20:00:00Z") })).expired, true);
  assert.equal(checkCommitmentExpiry(base({ nowMillis: Date.parse("2026-03-20T00:00:00Z") })).expired, true);
});

// ---------------------------------------------------------------------------
// B. The boundary in a DST zone
// ---------------------------------------------------------------------------

test("B: a DST spring-forward window shuts at the real local midnight", () => {
  // 2026-03-08 is the US spring-forward day; that local day is 23 hours long.
  const laWindow = deriveWindow({
    claimedAtMillis: Date.parse("2026-02-20T12:00:00Z"),
    timeZone: LA,
  });
  const la = base({
    timeZone: LA,
    firstEligibleDayKey: laWindow.firstEligibleDayKey,
    lastEligibleDayKey: laWindow.lastEligibleDayKey,
  });
  const shut = boundaryMillis(laWindow.lastEligibleDayKey, LA);

  assert.equal(checkCommitmentExpiry({ ...la, nowMillis: shut - 1 }).expired, false);
  assert.equal(checkCommitmentExpiry({ ...la, nowMillis: shut }).expired, true);

  // The window straddles the transition, so the two local midnights around it
  // are 23 hours apart rather than 24 — which is exactly what a naive
  // "add 24 hours per day" implementation would get wrong.
  const before = startOfLocalDayMillis("2026-03-07", LA);
  const after = startOfLocalDayMillis("2026-03-09", LA);
  assert.equal(after - before, 47 * 3600 * 1000, "two days spanning DST are 47 hours");
});

test("B: a DST fall-back day is 25 hours and still lands correctly", () => {
  // 2026-11-01 is the US fall-back day.
  const before = startOfLocalDayMillis("2026-11-01", LA);
  const after = startOfLocalDayMillis("2026-11-02", LA);
  assert.equal(after - before, 25 * 3600 * 1000);

  const la = base({
    timeZone: LA,
    firstEligibleDayKey: "2026-10-20",
    lastEligibleDayKey: "2026-11-01",
  });
  const shut = boundaryMillis("2026-11-01", LA);
  assert.equal(shut, after);
  assert.equal(checkCommitmentExpiry({ ...la, nowMillis: shut - 1 }).expired, false);
  assert.equal(checkCommitmentExpiry({ ...la, nowMillis: shut }).expired, true);
});

// ---------------------------------------------------------------------------
// C. 14 days must never forfeit
// ---------------------------------------------------------------------------

test("C: EXACTLY 14 qualifying days at the boundary must NOT forfeit", () => {
  const v = checkCommitmentExpiry(
    base({ qualifyingDays: COMMITMENT_DAYS_REQUIRED, nowMillis: boundaryMillis() }),
  );
  assert.equal(v.expired, false, "the tester did the work — completion must win");
  assert.equal(v.reason, "requirementMet");
});

test("C: 14 days stays safe however long after the window it is evaluated", () => {
  for (const days of [1, 7, 30, 365]) {
    const v = checkCommitmentExpiry(
      base({
        qualifyingDays: 14,
        nowMillis: boundaryMillis() + days * 24 * 3600 * 1000,
      }),
    );
    assert.equal(v.expired, false, `${days} days later it is still not forfeitable`);
    assert.equal(v.reason, "requirementMet");
  }
});

test("C: 13 days at the boundary DOES forfeit — one day short is short", () => {
  const v = checkCommitmentExpiry(base({ qualifyingDays: 13, nowMillis: boundaryMillis() }));
  assert.equal(v.expired, true);
  assert.equal(v.qualifyingDays, 13);
  assert.equal(v.daysRequired, 14);
});

test("C: an already-completed assignment is never expired", () => {
  const v = checkCommitmentExpiry(
    base({ status: "completed", qualifyingDays: 14, nowMillis: boundaryMillis() + 999999 }),
  );
  assert.equal(v.expired, false);
  assert.equal(v.reason, "alreadySettled");
});

test("C: an already-failed assignment is never expired again", () => {
  const v = checkCommitmentExpiry(base({ status: "failed", nowMillis: boundaryMillis() }));
  assert.equal(v.expired, false);
  assert.equal(v.reason, "alreadySettled");
});

test("C: EVERY terminal status is a no-op, including cancelled", () => {
  // Mirrors TERMINAL_ASSIGNMENT_STATUSES. `cancelled` has no writer today,
  // but it is in the terminal list, so a future one must not be able to
  // reach settlement through this path.
  for (const status of ["completed", "failed", "missed", "cancelled"]) {
    const v = checkCommitmentExpiry(
      base({ status, qualifyingDays: 1, nowMillis: boundaryMillis() + 1e9 }),
    );
    assert.equal(v.expired, false, `${status} must never forfeit`);
    assert.equal(v.reason, "alreadySettled");
  }
});

test("C: every NON-terminal status reaches the same verdict", () => {
  // The converse: being live is what matters, not which live status it is.
  for (const status of ["ready", "inProgress", "waitingForVerification"]) {
    const v = checkCommitmentExpiry(base({ status, qualifyingDays: 3, nowMillis: boundaryMillis() }));
    assert.equal(v.expired, true, `${status} must be evaluable`);
  }
});

// ---------------------------------------------------------------------------
// D. Refusals on missing or corrupt state
// ---------------------------------------------------------------------------

test("D: an assignment with no stake is never forfeited", () => {
  const v = checkCommitmentExpiry(base({ lockTxId: null, nowMillis: boundaryMillis() }));
  assert.equal(v.expired, false);
  assert.equal(v.reason, "noCommitment");
});

test("D: a missing or unreadable timezone refuses rather than guessing UTC", () => {
  for (const tz of [null, undefined, "", "Mars/Olympus", 42]) {
    const v = checkCommitmentExpiry(base({ timeZone: tz, nowMillis: boundaryMillis() + 1e9 }));
    assert.equal(v.expired, false, `${JSON.stringify(tz)} must refuse`);
    assert.equal(v.reason, "noTimeZone");
  }
});

test("D: a corrupt window key refuses", () => {
  assert.equal(
    checkCommitmentExpiry(base({ lastEligibleDayKey: "2026-99-99", nowMillis: Date.now() })).reason,
    "invalidWindow",
  );
  assert.equal(
    checkCommitmentExpiry(base({ firstEligibleDayKey: null, nowMillis: Date.now() })).reason,
    "invalidWindow",
  );
});

test("D: a nonsense clock refuses", () => {
  for (const now of [NaN, Infinity, null, undefined, "yesterday"]) {
    const v = checkCommitmentExpiry(base({ nowMillis: now }));
    assert.equal(v.expired, false);
    assert.equal(v.reason, "invalidClock");
  }
});

// ---------------------------------------------------------------------------
// E. Outage credit
// ---------------------------------------------------------------------------

test("E: a global outage inside the window pushes the boundary back a day", () => {
  const atOldBoundary = boundaryMillis();
  const withOutage = base({
    outageRecords: [globalOutage("2026-03-10")],
    nowMillis: atOldBoundary,
  });

  const v = checkCommitmentExpiry(withOutage);
  assert.equal(v.expired, false, "the outage bought the tester another day");
  assert.equal(v.reason, "windowOpen");
  assert.equal(v.creditedOutageDays, 1);
  assert.equal(v.effectiveLastEligibleDayKey, "2026-03-20");
  assert.equal(v.lastEligibleDayKey, "2026-03-19", "the stored window is untouched");

  // And it is expired one day later, at the NEW boundary.
  const v2 = checkCommitmentExpiry({ ...withOutage, nowMillis: boundaryMillis("2026-03-20") });
  assert.equal(v2.expired, true);
});

test("E: an app-scoped outage on THIS app protects it", () => {
  const v = checkCommitmentExpiry(
    base({ outageRecords: [appOutage("2026-03-10", APP)], nowMillis: boundaryMillis() }),
  );
  assert.equal(v.expired, false);
  assert.equal(v.creditedOutageDays, 1);
});

test("E: an outage on an UNRELATED app does NOT protect it", () => {
  const v = checkCommitmentExpiry(
    base({ outageRecords: [appOutage("2026-03-10", OTHER_APP)], nowMillis: boundaryMillis() }),
  );
  assert.equal(v.expired, true, "another app's outage is not this tester's excuse");
  assert.equal(v.creditedOutageDays, 0);
});

test("E: a withdrawn outage stops protecting immediately", () => {
  const withdrawn = { ...globalOutage("2026-03-10"), degraded: false };
  const v = checkCommitmentExpiry(base({ outageRecords: [withdrawn], nowMillis: boundaryMillis() }));
  assert.equal(v.expired, true);
  assert.equal(v.creditedOutageDays, 0);
});

test("E: four outage days buy four days, and the fifth closes it", () => {
  const records = ["2026-03-05", "2026-03-06", "2026-03-07", "2026-03-08"].map(globalOutage);
  const withOutage = base({ outageRecords: records });

  assert.equal(
    checkCommitmentExpiry({ ...withOutage, nowMillis: boundaryMillis("2026-03-22") }).expired,
    false,
    "still open on the fourth extra day",
  );
  const v = checkCommitmentExpiry({ ...withOutage, nowMillis: boundaryMillis("2026-03-23") });
  assert.equal(v.expired, true);
  assert.equal(v.creditedOutageDays, 4);
  assert.equal(v.effectiveLastEligibleDayKey, "2026-03-23");
});

test("E: a 14-day commitment is unforfeitable whether or not an outage applies", () => {
  const withOutage = base({
    qualifyingDays: 14,
    outageRecords: [globalOutage("2026-03-10")],
  });

  // At the original boundary the extended window has not closed, so the
  // window rule answers first. Either way the answer is: do not forfeit.
  const atOld = checkCommitmentExpiry({ ...withOutage, nowMillis: boundaryMillis() });
  assert.equal(atOld.expired, false);
  assert.equal(atOld.reason, "windowOpen");

  // Once the extended window HAS closed, the requirement is what saves it -
  // and that reason is permanent, where "windowOpen" was only "not yet".
  const atNew = checkCommitmentExpiry({ ...withOutage, nowMillis: boundaryMillis("2026-03-20") });
  assert.equal(atNew.expired, false);
  assert.equal(atNew.reason, "requirementMet");
});

test("E: the verdict reports which days were credited, for the audit trail", () => {
  const v = checkCommitmentExpiry(
    base({
      outageRecords: [globalOutage("2026-03-10"), appOutage("2026-03-12", APP)],
      nowMillis: boundaryMillis(),
    }),
  );
  assert.deepEqual(v.outageDayKeys, ["2026-03-10", "2026-03-12"]);
  assert.equal(v.creditedOutageDays, 2);
});

// ---------------------------------------------------------------------------
// F. The candidate pre-filter
// ---------------------------------------------------------------------------

test("F: the pre-filter lets through only windows whose stored end has passed", () => {
  const args = { lastEligibleDayKey: "2026-03-19", timeZone: IST };
  assert.equal(couldBeExpired({ ...args, nowMillis: boundaryMillis() - 1 }), false);
  assert.equal(couldBeExpired({ ...args, nowMillis: boundaryMillis() }), true);
  assert.equal(couldBeExpired({ ...args, nowMillis: boundaryMillis() + 1e9 }), true);
});

test("F: the pre-filter is safe in the only direction that matters", () => {
  // It ignores outages, which can only ever push the boundary LATER. So it may
  // admit a commitment an outage will save (one wasted read, then a refusal),
  // but it can never exclude one that is genuinely expired.
  const openWindow = couldBeExpired({
    lastEligibleDayKey: "2026-03-19",
    timeZone: IST,
    nowMillis: boundaryMillis() - 1,
  });
  assert.equal(openWindow, false);
  // Nothing an outage record could say would make the above expired.
  const v = checkCommitmentExpiry(
    base({ outageRecords: [globalOutage("2026-03-10")], nowMillis: boundaryMillis() - 1 }),
  );
  assert.equal(v.expired, false);
});

/**
 * THE PROOF OBLIGATION, checked exhaustively rather than argued.
 *
 * `couldBeExpired` is a pre-filter: the sweep never looks at an assignment it
 * rejects. A false POSITIVE is harmless - the transaction re-decides and
 * declines. A false NEGATIVE is not: it silently strands a commitment,
 * leaving a tester's 50 coins locked forever with no scheduled path to
 * settlement.
 *
 * So the required property is one-directional:
 *
 *     checkCommitmentExpiry(X).expired === true  =>  couldBeExpired(X) === true
 *
 * The argument is that outage credit is non-negative, so the effective
 * deadline is never EARLIER than the stored one, and a window closed against
 * the later deadline is necessarily closed against the earlier one. This
 * sweeps a grid rather than trusting that reasoning - including the cases
 * that would break it if credit could ever be negative, if the two functions
 * derived `todayKey` differently, or if the validity guards disagreed.
 *
 * This function was written incorrectly once during implementation. It gets a
 * proof, not a spot check.
 */
test("F: PROOF — a genuinely expired commitment is NEVER filtered out", () => {
  const zones = [IST, LA, "UTC", "Pacific/Kiritimati", "America/St_Johns"];
  const dayOffsets = [-40, -19, -5, -1, 0, 1, 2, 5, 19, 40, 400];
  const hours = [0, 1, 5, 12, 18, 23];
  // One non-terminal status is enough in the grid: `checkWindowExpired`
  // branches on TERMINALITY, not on which live status it is, so the other two
  // would multiply the runtime without reaching a new code path. The status
  // dimension is covered exhaustively in section C instead.
  const outageSets = [
    [],
    [globalOutage("2026-03-05")],
    [globalOutage("2026-03-05"), globalOutage("2026-03-06")],
    ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"].map(globalOutage),
    [appOutage("2026-03-07", APP)],
    [appOutage("2026-03-07", OTHER_APP)],
    [globalOutage("2026-02-01"), globalOutage("2026-05-01")],
    [globalOutage("2026-03-19")],
  ];
  const dayCounts = [0, 1, 13, 14, 15];
  const statuses = ["inProgress"];

  let expiredSeen = 0;
  let checked = 0;

  for (const timeZone of zones) {
    for (const offset of dayOffsets) {
      for (const hour of hours) {
        // An instant built from the LAST eligible day plus an offset, so the
        // grid lands densely on both sides of every boundary.
        const anchor = startOfLocalDayMillis(W.lastEligibleDayKey, timeZone);
        if (anchor === null) continue;
        const nowMillis = anchor + offset * 86400000 + hour * 3600000;

        for (const outageRecords of outageSets) {
          for (const qualifyingDays of dayCounts) {
            for (const status of statuses) {
              checked += 1;
              const args = base({
                status,
                timeZone,
                qualifyingDays,
                outageRecords,
                nowMillis,
              });
              const verdict = checkCommitmentExpiry(args);
              if (!verdict.expired) continue;
              expiredSeen += 1;
              assert.equal(
                couldBeExpired({
                  lastEligibleDayKey: args.lastEligibleDayKey,
                  timeZone,
                  nowMillis,
                }),
                true,
                "FALSE NEGATIVE: the pre-filter would strand a genuinely " +
                  `expired commitment (tz=${timeZone} offset=${offset} hour=${hour} ` +
                  `days=${qualifyingDays} outages=${outageRecords.length})`,
              );
            }
          }
        }
      }
    }
  }

  // A grid that never produced an expired case would pass vacuously.
  assert.ok(checked > 2000, `the grid must be substantial, checked ${checked}`);
  assert.ok(expiredSeen > 200, `the grid must actually reach expiry, saw ${expiredSeen}`);
});

test("F: PROOF — the monotonicity the argument rests on", () => {
  // The whole proof reduces to this: outage credit never moves the deadline
  // EARLIER. If that ever became false, the pre-filter could exclude a
  // commitment the real check would forfeit.
  for (const records of [
    [],
    [globalOutage("2026-03-05")],
    ["2026-03-02", "2026-03-10", "2026-03-19"].map(globalOutage),
    [appOutage("2026-03-07", OTHER_APP)],
    [{ dayKey: "2026-03-05", degraded: false, scope: OUTAGE_SCOPE_GLOBAL }],
    [{ garbage: true }, null, undefined],
  ]) {
    const v = checkCommitmentExpiry(base({ outageRecords: records, nowMillis: boundaryMillis() }));
    assert.ok(
      v.creditedOutageDays >= 0,
      `credit must never be negative, got ${v.creditedOutageDays}`,
    );
    assert.ok(
      v.effectiveLastEligibleDayKey >= v.lastEligibleDayKey,
      `the effective deadline must never precede the stored one: ` +
        `${v.effectiveLastEligibleDayKey} < ${v.lastEligibleDayKey}`,
    );
  }
});

test("F: PROOF — windowEndsAt is implied too, so the Firestore filter is safe", () => {
  // The sweep's query also narrows on `windowEndsAt <= now`. That is the
  // ORIGINAL window end, written once at claim time, so the same monotonicity
  // argument has to cover it or the query itself could strand a commitment.
  const windowEndsAtMillis = W.windowEndsAtMillis;
  for (const offset of [0, 1, 1000, 86400000, 40 * 86400000]) {
    const nowMillis = windowEndsAtMillis + offset;
    const v = checkCommitmentExpiry(base({ nowMillis, qualifyingDays: 3 }));
    if (v.expired) {
      assert.ok(
        windowEndsAtMillis <= nowMillis,
        "a genuinely expired commitment must satisfy the windowEndsAt filter",
      );
    }
  }
  // And one instant before it, nothing is expired - so the filter excludes
  // only commitments that are genuinely not expired yet.
  assert.equal(
    checkCommitmentExpiry(base({ nowMillis: windowEndsAtMillis - 1, qualifyingDays: 3 })).expired,
    false,
  );
});

test("F: the pre-filter refuses corrupt input rather than admitting it", () => {
  assert.equal(couldBeExpired({ lastEligibleDayKey: "nope", timeZone: IST, nowMillis: Date.now() }), false);
  assert.equal(couldBeExpired({ lastEligibleDayKey: "2026-03-19", timeZone: "X/Y", nowMillis: Date.now() }), false);
  assert.equal(couldBeExpired({ lastEligibleDayKey: "2026-03-19", timeZone: IST, nowMillis: NaN }), false);
});

// ---------------------------------------------------------------------------
// Fake Firestore — enough to run the sweep and the settlement
// ---------------------------------------------------------------------------

function snapshot(path, rec) {
  const data = rec ? rec.data : undefined;
  return {
    id: path.split("/").pop(),
    ref: { path },
    exists: data !== undefined,
    data: () => data,
    get: (field) => (data === undefined ? undefined : data[field]),
  };
}

function fakeDb(seed = {}) {
  const store = new Map();
  // Pre-9D fixtures: made join-ready the real way; see test/joinReady.js.
  for (const [path, data] of Object.entries(makeJoinReady(seed))) store.set(path, { data });
  const writes = [];

  function docsIn(collection) {
    const prefix = `${collection}/`;
    return [...store.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .map(([p, rec]) => ({ path: p, id: p.slice(prefix.length), rec }));
  }

  /** Applies the subset of query operators this codebase actually uses. */
  function runQuery({ collection, filters, limit }) {
    let rows = docsIn(collection);
    for (const [field, op, value] of filters) {
      rows = rows.filter(({ id, rec }) => {
        // `__name__` filters carry a DocumentReference; compare on the id.
        if (field === "__name__") {
          const other = (value && value.path ? value.path : String(value)).split("/").pop();
          if (op === ">=") return id >= other;
          if (op === "<=") return id <= other;
          return id === other;
        }
        const actual = rec.data[field];
        if (op === "in") return Array.isArray(value) && value.includes(actual);
        if (op === "<=") {
          const a = actual && actual.toMillis ? actual.toMillis() : actual;
          const b = value instanceof Date ? value.getTime() : value;
          return a !== undefined && a !== null && a <= b;
        }
        return actual === value;
      });
    }
    rows.sort((a, b) => (a.id < b.id ? -1 : 1));
    if (limit) rows = rows.slice(0, limit);
    return rows;
  }

  function collectionRef(name, filters = [], limit = null) {
    const ref = {
      __query: { collection: name, filters, limit },
      where: (f, op, v) => collectionRef(name, [...filters, [f, op, v]], limit),
      orderBy: () => ref,
      limit: (n) => collectionRef(name, filters, n),
      // Real Firestore returns an AggregateQuery that is BOTH awaitable via
      // `.get()` and usable as a transaction read target. The fake has to be
      // both too, or it only exercises one of the two call sites.
      count: () => ({
        __count: { collection: name, filters },
        get: async () => ({
          data: () => ({ count: runQuery({ collection: name, filters, limit: null }).length }),
        }),
      }),
      get: async () => {
        const rows = runQuery({ collection: name, filters, limit });
        return {
          empty: rows.length === 0,
          size: rows.length,
          docs: rows.map((r) => snapshot(r.path, r.rec)),
        };
      },
    };
    return ref;
  }

  const db = {
    doc: (path) => ({
      path,
      get: async () => snapshot(path, store.get(path)),
      set: async (data) => {
        writes.push({ op: "set", path, data });
        store.set(path, { data: { ...data } });
      },
    }),
    collection: collectionRef,
    async runTransaction(fn) {
      const staged = [];
      const tx = {
        get: async (target) => {
          if (target && target.__count) {
            return {
              data: () => ({
                count: runQuery({ ...target.__count, limit: null }).length,
              }),
            };
          }
          if (target && target.__query) {
            const rows = runQuery(target.__query);
            return {
              empty: rows.length === 0,
              size: rows.length,
              docs: rows.map((r) => snapshot(r.path, r.rec)),
            };
          }
          return snapshot(target.path, store.get(target.path));
        },
        create: (ref, data) => {
          if (store.has(ref.path)) {
            const err = new Error(`ALREADY_EXISTS: ${ref.path}`);
            err.code = "already-exists";
            throw err;
          }
          staged.push({ op: "create", path: ref.path, data });
        },
        set: (ref, data) => staged.push({ op: "set", path: ref.path, data }),
        update: (ref, data) => staged.push({ op: "update", path: ref.path, data }),
        delete: (ref) => staged.push({ op: "delete", path: ref.path }),
      };
      const result = await fn(tx);
      for (const w of staged) {
        writes.push(w);
        if (w.op === "delete") store.delete(w.path);
        else if (w.op === "create" || w.op === "set") store.set(w.path, { data: { ...w.data } });
        else store.set(w.path, { data: { ...(store.get(w.path) || { data: {} }).data, ...w.data } });
      }
      return result;
    },
  };

  db.__writes = writes;
  db.__read = (p) => (store.get(p) || {}).data;
  db.__has = (p) => store.has(p);
  db.__store = store;
  return db;
}

/** An expired commitment: window long shut, only `logs` qualifying days. */
function expiredWorld({ logs = 3, status = "inProgress", appId = APP, extra = {} } = {}) {
  const claimedAt = Date.parse("2026-03-01T06:00:00Z");
  const w = deriveWindow({
    claimedAtMillis: claimedAt,
    timeZone: IST,
    windowDays: LEGACY_COMMITMENT_WINDOW_DAYS,
  });
  const seed = {
    [`users/${TESTER}`]: { uid: TESTER },
    [`apps/${appId}`]: { ownerId: DEV, status: "approved", testerCount: 1 },
    [C1_PATH]: {
      appId,
      testerId: TESTER,
      developerId: DEV,
      cycle: 1,
      commitmentAmount: 50,
      daysRequired: COMMITMENT_DAYS_REQUIRED,
      windowDays: w.windowDays,
      timeZone: IST,
      claimedDayKey: w.claimedDayKey,
      firstEligibleDayKey: w.firstEligibleDayKey,
      lastEligibleDayKey: w.lastEligibleDayKey,
      windowEndsAt: { toMillis: () => w.windowEndsAtMillis },
      qualifyingDays: logs,
      daysCompleted: logs,
      status,
      lockTxId: lockEntryId(C1),
      settlementTxId: null,
      createdAt: { toMillis: () => claimedAt },
    },
    [CLAIM_PATH]: { assignmentId: C1, appId, testerId: TESTER, cycle: 1 },
    [WALLET_PATH]: {
      available: 0,
      locked: 50,
      forfeitedTotal: 0,
      purchasedTotal: 0,
      adjustmentNet: 50,
      ledgerCount: 1,
      schemaVersion: 2,
    },
    ...extra,
  };
  for (let i = 0; i < logs; i += 1) {
    const day = addDays(w.firstEligibleDayKey, i);
    seed[`testingLogs/${C1}__${day}`] = { assignmentId: C1, testerId: TESTER, date: day };
  }
  return seed;
}

/** Well past the IST boundary of the fixture window. */
const AFTER = startOfLocalDayMillis("2026-03-25", IST);

const assertWalletSound = (db) => {
  const w = db.__read(WALLET_PATH);
  assert.equal(checkInvariants(w).ok, true, `wallet invariant broken: ${JSON.stringify(w)}`);
};

// ---------------------------------------------------------------------------
// G. The sweep
// ---------------------------------------------------------------------------

test("G: the sweep forfeits an expired short commitment exactly once", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const summary = await runExpirySweep(db, { nowMillis: AFTER });

  assert.equal(summary.evaluated, 1);
  assert.equal(summary.forfeitedCount, 1);
  assert.equal(summary.coinsForfeited, 50);

  const a = db.__read(C1_PATH);
  assert.equal(a.status, "failed");
  assert.equal(a.settlementTxId, forfeitEntryId(C1));
  assert.equal(a.qualifyingDays, 3, "recounted from the logs");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.locked, 0);
  assert.equal(wallet.forfeitedTotal, 50);
  assert.equal(wallet.available, 0, "no partial refund");
  assertWalletSound(db);

  const entry = db.__read(`users/${TESTER}/coinTransactions/${forfeitEntryId(C1)}`);
  assert.equal(entry.kind, "forfeit");
  assert.equal(entry.amount, 50);
  assert.equal(entry.deltaLocked, -50);
  assert.equal(entry.deltaForfeited, 50);

  assert.equal(db.__has(CLAIM_PATH), false, "the active claim is released");
});

test("G: the wallet moves EXACTLY locked 50 -> forfeited 50, nothing else", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const before = { ...db.__read(WALLET_PATH) };
  assert.equal(before.available, 0);
  assert.equal(before.locked, 50);

  await runExpirySweep(db, { nowMillis: AFTER });
  const after = db.__read(WALLET_PATH);

  assert.equal(after.locked, 0, "locked becomes 0");
  assert.equal(after.forfeitedTotal, before.forfeitedTotal + 50, "forfeitedTotal +50");
  assert.equal(after.available, before.available, "available is UNCHANGED - no partial refund");
  assert.equal(after.purchasedTotal, before.purchasedTotal, "purchasedTotal untouched");
  assert.equal(after.adjustmentNet, before.adjustmentNet, "adjustmentNet untouched - no coins minted");
  assert.equal(after.ledgerCount, before.ledgerCount + 1, "exactly one ledger entry was added");
  assertWalletSound(db);
});

test("G: settlementTxId is set exactly once and never rewritten", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await runExpirySweep(db, { nowMillis: AFTER });
  const first = db.__read(C1_PATH).settlementTxId;
  assert.equal(first, forfeitEntryId(C1));

  for (let i = 0; i < 5; i += 1) await runExpirySweep(db, { nowMillis: AFTER });
  assert.equal(db.__read(C1_PATH).settlementTxId, first, "never rewritten");

  const updates = db.__writes.filter(
    (w) => w.path === C1_PATH && w.data && w.data.settlementTxId !== undefined,
  );
  assert.equal(updates.length, 1, "only one write ever set it");
});

/**
 * NO CONCURRENCY CONCLUSION MAY BE DRAWN FROM THIS FILE.
 *
 * The fake `runTransaction` applies staged writes when the callback returns
 * and performs no conflict detection, so two overlapping calls both read
 * pre-settlement state and both commit. Real Firestore refuses that - the
 * deterministic ledger id collides on `tx.create`, and the contended
 * documents force a retry - but the fake cannot model it, and a passing
 * single-winner assertion here would be measuring the harness rather than the
 * system.
 *
 * Every concurrency claim in Batch 5 is therefore proven in
 * test-emulator/expiry.concurrency.test.js against the real emulator. What
 * this file proves is SEQUENTIAL idempotency: repeated settlement attempts,
 * one after another, move the coins exactly once.
 */
test("G: sequential re-settlement attempts move coins exactly once", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const first = await runForfeitCommitment(db, {
    assignmentId: C1, actorId: "a", actorKind: "system", nowMillis: AFTER,
  });
  assert.equal(first.forfeited, true);

  for (let i = 0; i < 5; i += 1) {
    await assert.rejects(
      runForfeitCommitment(db, {
        assignmentId: C1, actorId: "b", actorKind: "system", nowMillis: AFTER,
      }),
      "a settled commitment must refuse every later attempt",
    );
  }

  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 50);
  assert.equal(db.__read(WALLET_PATH).locked, 0);
  const ledger = [...db.__store.keys()].filter((k) =>
    k.startsWith(`users/${TESTER}/coinTransactions/`),
  );
  assert.equal(ledger.length, 1);
  assertWalletSound(db);
});

test("G: the settled assignment records WHY the window ended when it did", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await runExpirySweep(db, { nowMillis: AFTER });
  const a = db.__read(C1_PATH);
  assert.equal(a.creditedOutageDays, 0);
  assert.equal(a.effectiveLastEligibleDayKey, "2026-03-19");
});

test("G: running the sweep ten times settles once and moves 50 coins once", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  for (let i = 0; i < 10; i += 1) await runExpirySweep(db, { nowMillis: AFTER });

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.forfeitedTotal, 50, "never 500");
  assert.equal(wallet.locked, 0);
  assert.ok(wallet.locked >= 0, "locked must never go negative");
  assertWalletSound(db);

  const ledger = [...db.__store.keys()].filter((k) =>
    k.startsWith(`users/${TESTER}/coinTransactions/`),
  );
  assert.deepEqual(ledger, [`users/${TESTER}/coinTransactions/${forfeitEntryId(C1)}`]);

  // Exactly one ledger CREATE ever reached the store.
  const creates = db.__writes.filter(
    (w) => w.op === "create" && w.path.includes("coinTransactions"),
  );
  assert.equal(creates.length, 1);
});

test("G: the second sweep reports a skip, not a failure", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const first = await runExpirySweep(db, { nowMillis: AFTER });
  const second = await runExpirySweep(db, { nowMillis: AFTER });

  assert.equal(first.forfeitedCount, 1);
  assert.equal(second.forfeitedCount, 0);
  assert.equal(second.failedCount, 0, "an already-settled commitment is not an error");
});

test("G: a commitment whose window is still open is not swept", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() - 1 });

  assert.equal(summary.evaluated, 0, "the candidate query excludes it");
  assert.equal(summary.forfeitedCount, 0);
  assert.equal(db.__read(C1_PATH).status, "inProgress");
  assert.equal(db.__read(WALLET_PATH).locked, 50, "coins stay committed");
  assert.deepEqual(db.__writes, [], "an open window writes nothing at all");
});

test("G: a commitment with 14 days is never swept, however late", async () => {
  const db = fakeDb(expiredWorld({ logs: 14 }));
  const summary = await runExpirySweep(db, { nowMillis: AFTER + 365 * 24 * 3600 * 1000 });

  assert.equal(summary.forfeitedCount, 0);
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0, "the tester did the work");
  assert.equal(db.__read(WALLET_PATH).locked, 50, "still awaiting completion, not forfeited");
});

test("G: a reward-era assignment is never swept", async () => {
  const seed = expiredWorld({ logs: 2 });
  delete seed[C1_PATH].lockTxId;
  const db = fakeDb(seed);
  const summary = await runExpirySweep(db, { nowMillis: AFTER });

  assert.equal(summary.evaluated, 0, "nothing was staked, so nothing can be consumed");
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0);
});

test("G: an assignment with no pinned zone is refused, not guessed at", async () => {
  const seed = expiredWorld({ logs: 2 });
  delete seed[C1_PATH].timeZone;
  const db = fakeDb(seed);
  const summary = await runExpirySweep(db, { nowMillis: AFTER });

  assert.equal(summary.forfeitedCount, 0);
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0, "fails closed");
});

test("G: a terminal assignment is excluded by the candidate query", async () => {
  for (const status of ["completed", "failed", "missed", "cancelled"]) {
    const db = fakeDb(expiredWorld({ logs: 3, status }));
    const summary = await runExpirySweep(db, { nowMillis: AFTER });
    assert.equal(summary.evaluated, 0, `${status} must not be a candidate`);
    assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0);
  }
});

test("G: the sweep respects its limit and the rest wait for the next run", async () => {
  const claimedAt = Date.parse("2026-03-01T06:00:00Z");
  const w = deriveWindow({
    claimedAtMillis: claimedAt,
    timeZone: IST,
    windowDays: LEGACY_COMMITMENT_WINDOW_DAYS,
  });
  const seed = {};
  for (let i = 0; i < 5; i += 1) {
    const tester = `t${i}`;
    const id = cycleAssignmentId(APP, tester, 1);
    seed[`testingAssignments/${id}`] = {
      appId: APP,
      testerId: tester,
      cycle: 1,
      commitmentAmount: 50,
      daysRequired: 14,
      windowDays: w.windowDays,
      timeZone: IST,
      firstEligibleDayKey: w.firstEligibleDayKey,
      lastEligibleDayKey: w.lastEligibleDayKey,
      windowEndsAt: { toMillis: () => w.windowEndsAtMillis },
      qualifyingDays: 1,
      status: "inProgress",
      lockTxId: lockEntryId(id),
      settlementTxId: null,
      createdAt: { toMillis: () => claimedAt },
    };
    seed[`activeClaims/${activeClaimId(APP, tester)}`] = { assignmentId: id, testerId: tester };
    seed[`users/${tester}/wallet/balance`] = {
      available: 0, locked: 50, forfeitedTotal: 0, purchasedTotal: 0,
      adjustmentNet: 50, ledgerCount: 1, schemaVersion: 2,
    };
  }
  const db = fakeDb(seed);

  const first = await runExpirySweep(db, { nowMillis: AFTER, limit: 2 });
  assert.equal(first.forfeitedCount, 2);

  const second = await runExpirySweep(db, { nowMillis: AFTER, limit: 10 });
  assert.equal(second.forfeitedCount, 3, "the backlog is picked up next run");

  for (let i = 0; i < 5; i += 1) {
    const wallet = db.__read(`users/t${i}/wallet/balance`);
    assert.equal(wallet.forfeitedTotal, 50);
    assert.equal(wallet.locked, 0);
    assert.equal(checkInvariants(wallet).ok, true);
  }
});

// ---------------------------------------------------------------------------
// H. Outage handling end to end
// ---------------------------------------------------------------------------

async function declare(db, { dayKey, scope = OUTAGE_SCOPE_GLOBAL, appId = null }) {
  return runDeclareOutage(db, {
    dayKey,
    degraded: true,
    reason: "test outage",
    scope,
    appId,
    adminUid: "admin1",
  });
}

test("H: a declared global outage stops the sweep forfeiting", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-03-10" });

  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() });
  assert.equal(summary.forfeitedCount, 0);
  assert.equal(summary.skippedCount, 1, "a candidate, correctly declined");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.forfeitedTotal, 0, "the outage protected the stake");
  assert.equal(wallet.locked, 50);
  assert.equal(db.__read(C1_PATH).status, "inProgress");
  assert.equal(db.__has(CLAIM_PATH), true, "and the claim stays live");
});

test("H: the protection lasts exactly as long as the credit", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-03-10" });

  // One extra day bought: still safe at the OLD boundary...
  assert.equal((await runExpirySweep(db, { nowMillis: boundaryMillis() })).forfeitedCount, 0);
  // ...and forfeited at the NEW one.
  const after = await runExpirySweep(db, { nowMillis: boundaryMillis("2026-03-20") });
  assert.equal(after.forfeitedCount, 1);
  assert.equal(db.__read(C1_PATH).creditedOutageDays, 1);
  assert.equal(db.__read(C1_PATH).effectiveLastEligibleDayKey, "2026-03-20");
});

test("H: an app-scoped outage on THIS app protects it", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-03-10", scope: OUTAGE_SCOPE_APP, appId: APP });

  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() });
  assert.equal(summary.forfeitedCount, 0);
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0);
});

test("H: an outage on an UNRELATED app does not protect it", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-03-10", scope: OUTAGE_SCOPE_APP, appId: OTHER_APP });

  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() });
  assert.equal(summary.forfeitedCount, 1, "another app's outage is not this tester's excuse");
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 50);
});

test("H: an outage outside the window does not protect it", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-02-20" });
  await declare(db, { dayKey: "2026-04-15" });

  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() });
  assert.equal(summary.forfeitedCount, 1);
  assert.equal(db.__read(C1_PATH).creditedOutageDays, 0);
});

test("H: withdrawing an outage re-exposes the commitment", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-03-10" });
  assert.equal((await runExpirySweep(db, { nowMillis: boundaryMillis() })).forfeitedCount, 0);

  // The day was declared in error and is withdrawn.
  await runDeclareOutage(db, {
    dayKey: "2026-03-10",
    degraded: false,
    reason: "declared in error",
    scope: OUTAGE_SCOPE_GLOBAL,
    appId: null,
    adminUid: "admin1",
  });

  const after = await runExpirySweep(db, { nowMillis: boundaryMillis() });
  assert.equal(after.forfeitedCount, 1);
});

test("H: declaring an outage writes NOTHING to any assignment", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const before = JSON.stringify(db.__read(C1_PATH));
  await declare(db, { dayKey: "2026-03-10" });

  assert.equal(JSON.stringify(db.__read(C1_PATH)), before, "no deadline was rewritten");
  const assignmentWrites = db.__writes.filter((w) => w.path.startsWith("testingAssignments/"));
  assert.deepEqual(assignmentWrites, [], "the extension is derived, never backfilled");
});

test("H: declaring the same outage twice is a no-op", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-03-10" });
  await declare(db, { dayKey: "2026-03-10" });
  await declare(db, { dayKey: "2026-03-10" });

  const health = [...db.__store.keys()].filter((k) => k.startsWith("systemHealth/"));
  assert.deepEqual(health, ["systemHealth/2026-03-10"], "one day, one document");

  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() });
  assert.equal(summary.forfeitedCount, 0);
  assert.equal(db.__read(C1_PATH).status, "inProgress");
});

test("H: a malformed declaration is refused", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const bad = [
    { dayKey: "not-a-day", scope: OUTAGE_SCOPE_GLOBAL },
    { dayKey: "2026-99-99", scope: OUTAGE_SCOPE_GLOBAL },
    { dayKey: "2026-03-10", scope: "everything" },
    { dayKey: "2026-03-10", scope: OUTAGE_SCOPE_APP, appId: null },
    { dayKey: "2026-03-10", scope: OUTAGE_SCOPE_GLOBAL, appId: APP },
  ];
  for (const args of bad) {
    await assert.rejects(
      runDeclareOutage(db, { degraded: true, reason: "x", adminUid: "admin1", ...args }),
      /invalid-argument|must/i,
      `${JSON.stringify(args)} must be refused`,
    );
  }
  const health = [...db.__store.keys()].filter((k) => k.startsWith("systemHealth/"));
  assert.deepEqual(health, [], "nothing was written");
});

test("H: a non-boolean degraded flag is refused", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  for (const degraded of ["true", 1, null, undefined]) {
    await assert.rejects(
      runDeclareOutage(db, {
        dayKey: "2026-03-10",
        degraded,
        scope: OUTAGE_SCOPE_GLOBAL,
        appId: null,
        adminUid: "admin1",
      }),
      /degraded must be/,
    );
  }
});

// ---------------------------------------------------------------------------
// I. The read-only evaluator
// ---------------------------------------------------------------------------

test("I: the read-only evaluator reports the verdict and writes nothing", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const verdict = await evaluateAssignmentExpiry(db, { assignmentId: C1, nowMillis: AFTER });

  assert.equal(verdict.expired, true);
  assert.equal(verdict.qualifyingDays, 3, "recounted, not read from the cache");
  assert.equal(verdict.daysRequired, 14);
  assert.deepEqual(db.__writes, [], "a preview must move nothing");
  assert.equal(db.__read(WALLET_PATH).locked, 50);
});

test("I: the evaluator agrees with what the sweep then does", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-03-10" });

  const preview = await evaluateAssignmentExpiry(db, { assignmentId: C1, nowMillis: boundaryMillis() });
  assert.equal(preview.expired, false);
  assert.equal(preview.creditedOutageDays, 1);

  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() });
  assert.equal(summary.forfeitedCount, 0, "the preview was not lying");
});

test("I: the evaluator reports a missing assignment rather than throwing", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const verdict = await evaluateAssignmentExpiry(db, { assignmentId: "nope__nobody__c9" });
  assert.equal(verdict.expired, false);
  assert.equal(verdict.reason, "missing");
});

// ---------------------------------------------------------------------------
// J. Direct forfeiture still refuses what it always refused
// ---------------------------------------------------------------------------

test("J: forfeiture refuses while the window is open, even called directly", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await assert.rejects(
    runForfeitCommitment(db, {
      assignmentId: C1,
      actorId: "system",
      actorKind: "system",
      nowMillis: boundaryMillis() - 1,
    }),
    /not closed yet|still open/,
  );
  assert.equal(db.__read(WALLET_PATH).locked, 50);
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0);
});

test("J: forfeiture refuses a commitment protected by an outage, with a useful message", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await declare(db, { dayKey: "2026-03-10" });

  await assert.rejects(
    runForfeitCommitment(db, {
      assignmentId: C1,
      actorId: "admin1",
      actorKind: "admin",
      nowMillis: boundaryMillis(),
    }),
    /declared outage day/,
    "the refusal must say WHY, or it gets debugged by removing the check",
  );
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0);
});

test("J: forfeiture refuses a tester who actually did the work", async () => {
  const db = fakeDb(expiredWorld({ logs: 14 }));
  await assert.rejects(
    runForfeitCommitment(db, {
      assignmentId: C1,
      actorId: "system",
      actorKind: "system",
      nowMillis: AFTER,
    }),
    /met its requirement/,
  );
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0);
});

test("J: a second direct forfeiture cannot move coins again", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await runForfeitCommitment(db, {
    assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: AFTER,
  });
  await assert.rejects(
    runForfeitCommitment(db, {
      assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: AFTER,
    }),
  );
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 50);
  assert.equal(db.__read(WALLET_PATH).locked, 0);
  assertWalletSound(db);
});

// ---------------------------------------------------------------------------
// K. After forfeiture
// ---------------------------------------------------------------------------

test("K: the forfeited assignment survives as historical data", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await runExpirySweep(db, { nowMillis: AFTER });

  const a = db.__read(C1_PATH);
  assert.ok(a, "the assignment is not deleted");
  assert.equal(a.appId, APP);
  assert.equal(a.testerId, TESTER);
  assert.equal(a.commitmentAmount, 50, "what was staked is still recorded");
  assert.equal(a.lockTxId, lockEntryId(C1), "and which entry locked it");
  assert.equal(a.status, "failed");

  // The logs the tester did earn are still there too.
  const logs = [...db.__store.keys()].filter((k) => k.startsWith("testingLogs/"));
  assert.equal(logs.length, 3, "historical progress is not deleted");
});

test("K: the released claim lets the tester start a fresh cycle", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  await runExpirySweep(db, { nowMillis: AFTER });

  assert.equal(db.__has(CLAIM_PATH), false, "the claim is gone...");
  assert.equal(db.__has(C1_PATH), true, "...but the assignment is not");
  // Which is what `nextCycle` needs in order to hand out cycle 2.
  const { cycleOf } = require("../lib/commitments");
  assert.equal(cycleOf(C1), 1);
});

// ---------------------------------------------------------------------------
// M. The miss rule, end to end through the real settlement paths
//
// Every fixture above is a LEGACY commitment. These are commitments claimed
// under the miss rule: a 16-day window, 14 required, `allowedMisses: 2`, and a
// `removalCheckAt` sweep hint - exactly the fields `runClaimCommitment` writes.
// ---------------------------------------------------------------------------

const { runCancelCommitment } = require("../commitments");
const { runRecordTestingDay } = require("../testingDays");
const { cancelEntryId } = require("../lib/commitments");
const { removalCheckAtMillis } = require("../lib/misses");
const { foldLedger } = require("../lib/wallet");

const NEW_CLAIMED_AT = Date.parse("2026-03-01T06:00:00Z");
const NW = deriveWindow({ claimedAtMillis: NEW_CLAIMED_AT, timeZone: IST });
const nDay = (n) => addDays(NW.firstEligibleDayKey, n - 1);
const nAt = (n, hours = 12) => startOfLocalDayMillis(nDay(n), IST) + hours * 60 * 60 * 1000;

/** A live commitment claimed under the miss rule, with logs on `loggedDays` (1-based). */
function missWorld({ loggedDays = [], testerCount = 1, extra = {} } = {}) {
  const seed = {
    [`users/${TESTER}`]: { uid: TESTER },
    [`apps/${APP}`]: { ownerId: DEV, status: "approved", testerCount },
    [C1_PATH]: {
      appId: APP,
      testerId: TESTER,
      developerId: DEV,
      cycle: 1,
      commitmentAmount: 50,
      daysRequired: 14,
      windowDays: NW.windowDays,
      allowedMisses: 2,
      removalCheckAt: {
        toMillis: () =>
          removalCheckAtMillis({ fromDayKey: NW.claimedDayKey, allowedMisses: 2, timeZone: IST }),
      },
      timeZone: IST,
      claimedDayKey: NW.claimedDayKey,
      firstEligibleDayKey: NW.firstEligibleDayKey,
      lastEligibleDayKey: NW.lastEligibleDayKey,
      windowEndsAt: { toMillis: () => NW.windowEndsAtMillis },
      qualifyingDays: loggedDays.length,
      daysCompleted: loggedDays.length,
      status: "inProgress",
      lockTxId: lockEntryId(C1),
      settlementTxId: null,
      capacityHeld: true,
      createdAt: { toMillis: () => NEW_CLAIMED_AT },
    },
    [CLAIM_PATH]: { assignmentId: C1, appId: APP, testerId: TESTER, cycle: 1 },
    [WALLET_PATH]: {
      available: 0,
      locked: 50,
      forfeitedTotal: 0,
      purchasedTotal: 0,
      adjustmentNet: 50,
      ledgerCount: 2,
      schemaVersion: 2,
    },
    // The grant that funded the stake and the lock itself, so the ledger
    // folds to the wallet before and after settlement.
    [`users/${TESTER}/coinTransactions/grant_seed`]: {
      kind: "adjustment", source: "adminGrant", amount: 50,
      deltaAvailable: 50, deltaLocked: 0, deltaForfeited: 0, schemaVersion: 2,
    },
    [`users/${TESTER}/coinTransactions/${lockEntryId(C1)}`]: {
      kind: "lock", source: "commitment", amount: 50,
      deltaAvailable: -50, deltaLocked: 50, deltaForfeited: 0, schemaVersion: 2,
    },
    ...extra,
  };
  for (const n of loggedDays) {
    const key = nDay(n);
    seed[`testingLogs/${C1}__${key}`] = { assignmentId: C1, testerId: TESTER, date: key, cycle: 1 };
  }
  return seed;
}

/** Eligible days `from`..`to` except those in `skip`. */
function days(from, to, skip = []) {
  const out = [];
  for (let n = from; n <= to; n += 1) if (!skip.includes(n)) out.push(n);
  return out;
}

function ledgerOf(db) {
  const prefix = `users/${TESTER}/coinTransactions/`;
  return [...db.__store.entries()]
    .filter(([p]) => p.startsWith(prefix))
    .map(([p, rec]) => ({ id: p.slice(prefix.length), ...rec.data }));
}

function assertReconciles(db) {
  const { wallet: folded } = foldLedger(ledgerOf(db));
  const w = db.__read(WALLET_PATH);
  for (const f of ["available", "locked", "forfeitedTotal"]) {
    assert.equal(folded[f], w[f], `ledger fold disagrees on ${f}`);
  }
}

test("M: the sweep removes a commitment at its 3rd miss, before the window closes", async () => {
  // Day 10; days 3, 5 and 7 were missed.
  const db = fakeDb(missWorld({ loggedDays: days(1, 9, [3, 5, 7]) }));
  assertReconciles(db);
  const summary = await runExpirySweep(db, { nowMillis: nAt(10) });

  assert.equal(summary.forfeitedCount, 1);
  const a = db.__read(C1_PATH);
  assert.equal(a.status, "failed");
  assert.equal(a.failureReason, "tooManyMisses");
  assert.equal(a.missedDays, 3);
  assert.equal(a.qualifyingDays, 6);
  assert.equal(a.settlementTxId, forfeitEntryId(C1));

  const w = db.__read(WALLET_PATH);
  assert.equal(w.locked, 0);
  assert.equal(w.forfeitedTotal, 50);
  assert.equal(w.available, 0);
  assertWalletSound(db);
  assertReconciles(db);

  assert.equal(db.__has(CLAIM_PATH), false, "the active claim is closed");
  assert.equal(db.__read(`apps/${APP}`).testerCount, 0, "exactly one slot released");
  assert.equal(a.capacityHeld, false);
});

test("M: 0, 1 and 2 misses survive the sweep untouched", async () => {
  for (const skip of [[], [3], [3, 7]]) {
    const db = fakeDb(missWorld({ loggedDays: days(1, 9, skip) }));
    const summary = await runExpirySweep(db, { nowMillis: nAt(10) });
    assert.equal(summary.forfeitedCount, 0, `misses ${skip}`);
    assert.equal(db.__read(C1_PATH).status, "inProgress");
    assert.equal(db.__read(WALLET_PATH).locked, 50);
    assert.equal(db.__read(`apps/${APP}`).testerCount, 1);
  }
});

test("M: a removal candidate is found by removalCheckAt, not only by the window's end", async () => {
  const db = fakeDb(missWorld({ loggedDays: [] }));
  // Start of day 4: the earliest possible third miss, twelve days before the window ends.
  const earliest = startOfLocalDayMillis(nDay(4), IST);
  assert.deepEqual(await findExpiryCandidates(db, { nowMillis: earliest }), [C1]);
  assert.deepEqual(await findExpiryCandidates(db, { nowMillis: earliest - 1 }), []);
  // Past the window's end it is found by BOTH queries - and evaluated once.
  assert.deepEqual(await findExpiryCandidates(db, { nowMillis: AFTER }), [C1]);
});

test("M: repeated sweeps settle once - one forfeit entry, one slot released", async () => {
  const db = fakeDb(missWorld({ loggedDays: [], testerCount: 5 }));
  for (let i = 0; i < 10; i += 1) await runExpirySweep(db, { nowMillis: nAt(6) + i });

  const forfeits = ledgerOf(db).filter((e) => e.kind === "forfeit");
  assert.equal(forfeits.length, 1);
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 50, "never 500");
  assert.equal(db.__read(`apps/${APP}`).testerCount, 4, "released once, not ten times");
  assertWalletSound(db);
  assertReconciles(db);
});

test("M: testerCount cannot go negative on removal", async () => {
  const db = fakeDb(missWorld({ loggedDays: [], testerCount: 0 }));
  await runExpirySweep(db, { nowMillis: nAt(6) });
  assert.equal(db.__read(C1_PATH).status, "failed");
  assert.equal(db.__read(`apps/${APP}`).testerCount, 0);
});

test("M: cancellation after the 3rd miss is refused, then the sweep forfeits", async () => {
  const db = fakeDb(missWorld({ loggedDays: days(1, 9, [3, 5, 7]) }));
  await assert.rejects(
    runCancelCommitment(db, { assignmentId: C1, actorId: TESTER, actorKind: "user", nowMillis: nAt(10) }),
    /missed more testing days than allowed/,
  );
  assert.equal(db.__read(C1_PATH).status, "inProgress");
  assert.equal(db.__read(WALLET_PATH).locked, 50, "the stake stays for forfeiture");
  assert.equal(db.__has(`users/${TESTER}/coinTransactions/${cancelEntryId(C1)}`), false);
  assert.equal(db.__read(`apps/${APP}`).testerCount, 1, "a refused cancel frees no slot");

  await runExpirySweep(db, { nowMillis: nAt(10) });
  assert.equal(db.__read(C1_PATH).failureReason, "tooManyMisses");
  assertWalletSound(db);
  assertReconciles(db);
});

test("M: cancellation at 2 misses still returns the stake", async () => {
  const db = fakeDb(missWorld({ loggedDays: days(1, 9, [3, 7]) }));
  const outcome = await runCancelCommitment(db, {
    assignmentId: C1, actorId: TESTER, actorKind: "user", nowMillis: nAt(10),
  });
  assert.equal(outcome.cancelled, true);
  assert.equal(db.__read(WALLET_PATH).available, 50);
  assert.equal(db.__read(`apps/${APP}`).testerCount, 0);
  assertWalletSound(db);
  assertReconciles(db);
});

test("M: a check-in after the 3rd miss is refused and cannot revive the commitment", async () => {
  const db = fakeDb(missWorld({ loggedDays: days(1, 9, [3, 5, 7]) }));
  await assert.rejects(
    runRecordTestingDay(db, { assignmentId: C1, testerId: TESTER, nowMillis: nAt(10) }),
    /missed more testing days than allowed/,
  );
  assert.equal(db.__has(`testingLogs/${C1}__${nDay(10)}`), false, "no log was written");
  assert.equal(db.__read(C1_PATH).qualifyingDays, 6);
});

test("M: a check-in at 2 misses records the day and moves the removal hint forward", async () => {
  const db = fakeDb(missWorld({ loggedDays: days(1, 9, [3, 7]) }));
  const outcome = await runRecordTestingDay(db, { assignmentId: C1, testerId: TESTER, nowMillis: nAt(10) });
  assert.equal(outcome.recorded, true);
  const a = db.__read(C1_PATH);
  assert.equal(a.qualifyingDays, 8);
  // 2 misses so far, day 10 logged: one more miss (day 11) removes, from day 12.
  assert.equal(a.removalCheckAt.toMillis(), startOfLocalDayMillis(nDay(12), IST));
  assert.equal(a.missedDays, undefined, "the live miss count is derived, never stored");
});

test("M: completion wins at 14 days with 2 misses, and the sweep then leaves it alone", async () => {
  // Days 1-15 with 3 and 7 missed = 13 logged; day 16 is the 14th.
  const db = fakeDb(missWorld({ loggedDays: days(1, 15, [3, 7]), testerCount: 3 }));
  const outcome = await runRecordTestingDay(db, { assignmentId: C1, testerId: TESTER, nowMillis: nAt(16) });
  assert.equal(outcome.completed, true);
  assert.equal(db.__read(C1_PATH).status, "completed");
  assert.equal(db.__read(WALLET_PATH).available, 50, "the same coins come back");

  const summary = await runExpirySweep(db, { nowMillis: AFTER });
  assert.equal(summary.forfeitedCount, 0);
  assert.equal(db.__read(C1_PATH).status, "completed", "never both completed and failed");
  assert.equal(db.__read(C1_PATH).failureReason, undefined);
  assert.equal(db.__read(`apps/${APP}`).testerCount, 3, "completion keeps its slot");
  assertWalletSound(db);
  assertReconciles(db);
});

test("M: a direct forfeiture of a live commitment at 2 misses is refused", async () => {
  const db = fakeDb(missWorld({ loggedDays: days(1, 9, [3, 7]) }));
  await assert.rejects(
    runForfeitCommitment(db, { assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: nAt(10) }),
    /not closed yet/,
  );
  assert.equal(db.__read(WALLET_PATH).locked, 50);
});

test("M: an outage day is not a miss - the removal waits for a real third miss", async () => {
  const outage = {
    [`systemHealth/${nDay(2)}`]: { dayKey: nDay(2), degraded: true, scope: "global" },
  };
  const db = fakeDb(missWorld({ loggedDays: [], extra: outage }));
  // Day 4: days 1 and 3 missed, day 2 an outage - only two misses.
  assert.equal((await runExpirySweep(db, { nowMillis: nAt(4) })).forfeitedCount, 0);
  // Day 4 then goes unlogged too: the third real miss.
  assert.equal((await runExpirySweep(db, { nowMillis: nAt(5) })).forfeitedCount, 1);
  assert.equal(db.__read(C1_PATH).missedDays, 3);
});

test("M: a LEGACY commitment with many unlogged days is not removed early", async () => {
  // The legacy fixture: 18-day window, no allowedMisses, only 3 days logged.
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const midWindow = startOfLocalDayMillis(addDays(W.firstEligibleDayKey, 12), IST);
  assert.equal((await runExpirySweep(db, { nowMillis: midWindow })).forfeitedCount, 0);
  assert.equal(db.__read(C1_PATH).status, "inProgress");
  // It still forfeits at its original 18-day close, with its original reason.
  await runExpirySweep(db, { nowMillis: AFTER });
  assert.equal(db.__read(C1_PATH).status, "failed");
  assert.equal(db.__read(C1_PATH).failureReason, "windowClosedShort");
  assert.equal(db.__read(C1_PATH).missedDays, undefined);
});

// ---------------------------------------------------------------------------
// Batch 9G: the sweep's settlements read by id only
//
// The sweep chooses candidates with plain queries OUTSIDE any transaction -
// allowed - and settles each through `runForfeitCommitment`, whose transaction
// must perform no query read at all. Under `forbidQueriesInTransactions` for
// both commitment shapes (legacy 18-day, current 16-day miss rule), and for
// every already-settled state. Concurrency and mid-flight changes need a fake
// that detects conflicts; those are in commitments.test.js.
// ---------------------------------------------------------------------------

const { forbidQueriesInTransactions } = require("./txGuard");

const guarded = (seed, opts) => forbidQueriesInTransactions(fakeDb(seed), opts);
const forfeitsIn = (db) => ledgerOf(db).filter((e) => e.kind === "forfeit");

test("9G sweep: a LEGACY 18-day commitment settles with no query read in its transaction", async () => {
  const db = guarded(expiredWorld({ logs: 3 }));
  assert.equal(db.__read(C1_PATH).windowDays, LEGACY_COMMITMENT_WINDOW_DAYS);
  const summary = await runExpirySweep(db, { nowMillis: AFTER });
  assert.equal(summary.forfeitedCount, 1);
  assert.equal(summary.failedCount, 0);
  assert.deepEqual(db.__queryViolations, []);
  const a = db.__read(C1_PATH);
  assert.equal(a.status, "failed");
  assert.equal(a.failureReason, "windowClosedShort");
  assert.equal(a.qualifyingDays, 3);
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 50);
  assertWalletSound(db);
  assert.equal(db.__read(`apps/${APP}`).testerCount, 0, "exactly one slot released");
});

test("9G sweep: a CURRENT 16-day commitment's 3rd-miss removal has no query read either", async () => {
  const db = guarded(missWorld({ loggedDays: days(1, 9, [3, 5, 7]) }));
  assert.equal(db.__read(C1_PATH).windowDays, 16);
  const summary = await runExpirySweep(db, { nowMillis: nAt(10) });
  assert.equal(summary.forfeitedCount, 1);
  assert.deepEqual(db.__queryViolations, []);
  const a = db.__read(C1_PATH);
  assert.equal(a.failureReason, "tooManyMisses");
  assert.equal(a.missedDays, 3);
  assert.equal(a.qualifyingDays, 6);
  assertWalletSound(db);
  assertReconciles(db);
  assert.equal(db.__read(`apps/${APP}`).testerCount, 0);
});

test("9G sweep: repeated sweeps settle once - one ledger entry, one slot, no query reads", async () => {
  const db = guarded(missWorld({ loggedDays: [], testerCount: 5 }));
  for (let i = 0; i < 5; i += 1) await runExpirySweep(db, { nowMillis: nAt(6) + i });
  assert.equal(forfeitsIn(db).length, 1);
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 50);
  assert.equal(db.__read(`apps/${APP}`).testerCount, 4);
  assertWalletSound(db);
  assertReconciles(db);
  assert.deepEqual(db.__queryViolations, []);
});

test("9G sweep: an outage record in the window is still credited - no forfeiture", async () => {
  // Half a day past the raw 18-day window; one declared day keeps it open.
  const day = W.firstEligibleDayKey;
  const db = guarded(
    expiredWorld({
      logs: 3,
      extra: { [`systemHealth/${day}`]: { dayKey: day, degraded: true, scope: OUTAGE_SCOPE_GLOBAL } },
    }),
  );
  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() + 12 * 60 * 60 * 1000 });
  assert.equal(summary.forfeitedCount, 0);
  assert.equal(db.__read(C1_PATH).status, "inProgress");
  assert.equal(db.__read(WALLET_PATH).locked, 50);
  assert.deepEqual(db.__queryViolations, []);

  // And without the declaration the same instant forfeits.
  const plain = guarded(expiredWorld({ logs: 3 }));
  const s2 = await runExpirySweep(plain, { nowMillis: boundaryMillis() + 12 * 60 * 60 * 1000 });
  assert.equal(s2.forfeitedCount, 1);
});

test("9G sweep: an outage on an UNRELATED app is not credited", async () => {
  const day = W.firstEligibleDayKey;
  const db = guarded(
    expiredWorld({
      logs: 3,
      extra: {
        [`systemHealth/${day}`]: { dayKey: day, degraded: true, scope: OUTAGE_SCOPE_APP, appId: OTHER_APP },
      },
    }),
  );
  const summary = await runExpirySweep(db, { nowMillis: boundaryMillis() + 12 * 60 * 60 * 1000 });
  assert.equal(summary.forfeitedCount, 1);
  assert.deepEqual(db.__queryViolations, []);
});

for (const status of ["completed", "cancelled", "failed"]) {
  test(`9G sweep: an already-${status} commitment is left alone`, async () => {
    const db = guarded(expiredWorld({ logs: 3, status }));
    const before = JSON.stringify(db.__read(WALLET_PATH));
    const summary = await runExpirySweep(db, { nowMillis: AFTER });
    assert.equal(summary.forfeitedCount, 0);
    assert.equal(summary.failedCount, 0);
    assert.equal(JSON.stringify(db.__read(WALLET_PATH)), before, "no coin moved");
    assert.equal(db.__read(C1_PATH).status, status);
    assert.equal(forfeitsIn(db).length, 0);
    // Even forced straight at the primitive, it refuses without a query read.
    await assert.rejects(
      runForfeitCommitment(db, { assignmentId: C1, actorId: "system", actorKind: "system", nowMillis: AFTER }),
    );
    assert.deepEqual(db.__queryViolations, []);
  });
}

test("9G sweep: a commitment that met its requirement is not forfeited", async () => {
  const db = guarded(expiredWorld({ logs: 14 }));
  const summary = await runExpirySweep(db, { nowMillis: AFTER });
  assert.equal(summary.forfeitedCount, 0);
  assert.equal(db.__read(WALLET_PATH).locked, 50);
  assert.deepEqual(db.__queryViolations, []);
});

test("9G: the range-query outage reader refuses to run inside a transaction", async () => {
  const { readOutageRecords } = require("../systemHealth");
  const db = fakeDb({});
  await assert.rejects(
    readOutageRecords(db, { fromDayKey: W.firstEligibleDayKey, toDayKey: W.lastEligibleDayKey, tx: {} }),
    /readOutageRecordsInTx/,
  );
});

test("9G: point-read outage records equal the range query's, day for day", async () => {
  const { readOutageRecords, readOutageRecordsInTx } = require("../systemHealth");
  const inside = addDays(W.firstEligibleDayKey, 3);
  const edge = W.lastEligibleDayKey;
  const db = fakeDb({
    [`systemHealth/${W.firstEligibleDayKey}`]: { dayKey: W.firstEligibleDayKey, degraded: true, scope: OUTAGE_SCOPE_GLOBAL },
    [`systemHealth/${inside}`]: { dayKey: inside, degraded: false, scope: OUTAGE_SCOPE_APP, appId: APP, reason: "cleared" },
    [`systemHealth/${edge}`]: { dayKey: edge, degraded: true, scope: OUTAGE_SCOPE_APP, appId: OTHER_APP },
    // Outside the window on both sides: neither reader may return these.
    [`systemHealth/${addDays(W.firstEligibleDayKey, -1)}`]: { degraded: true, scope: OUTAGE_SCOPE_GLOBAL },
    [`systemHealth/${addDays(edge, 1)}`]: { degraded: true, scope: OUTAGE_SCOPE_GLOBAL },
  });
  const range = { fromDayKey: W.firstEligibleDayKey, toDayKey: W.lastEligibleDayKey };
  const byQuery = await readOutageRecords(db, range);
  const byId = await db.runTransaction((tx) => readOutageRecordsInTx(tx, db, range));
  assert.equal(byQuery.length, 3);
  assert.deepEqual(byId, byQuery);
});

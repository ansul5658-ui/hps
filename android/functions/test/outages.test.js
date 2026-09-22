/**
 * The outage rules: which declared days protect which commitment.
 *
 * WHY THIS FILE IS PARANOID ABOUT `false`
 * An outage day is free time. A tester who could manufacture one could escape
 * a commitment they were about to fail, so every test here that asserts a
 * record does NOT apply is guarding real coins. The malformed-record cases
 * matter most: those are the shapes a bug or a partial write produces, and
 * "unknown shape" must never resolve to "everybody gets a free day".
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  OUTAGE_SCOPE_GLOBAL,
  OUTAGE_SCOPE_APP,
  MAX_OUTAGE_EXTENSION_DAYS,
  isValidOutageScope,
  outageApplies,
  isDayKeyWithin,
  applicableOutageDayKeys,
  countApplicableOutageDays,
  effectiveLastEligibleDayKey,
  deriveEffectiveWindow,
} = require("../lib/outages");

const APP = "app1";
const OTHER_APP = "app2";

/** The pinned window used throughout: day 1 is 2026-03-02, 18 days long. */
const WINDOW = {
  firstEligibleDayKey: "2026-03-02",
  lastEligibleDayKey: "2026-03-19",
  appId: APP,
};

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
// Scope
// ---------------------------------------------------------------------------

test("scope: only the two documented scopes are valid", () => {
  assert.equal(isValidOutageScope(OUTAGE_SCOPE_GLOBAL), true);
  assert.equal(isValidOutageScope(OUTAGE_SCOPE_APP), true);
  for (const bad of ["Global", "APP", "", null, undefined, 0, {}, "everything"]) {
    assert.equal(isValidOutageScope(bad), false, `${JSON.stringify(bad)} must not be a scope`);
  }
});

test("a global outage applies to every app", () => {
  assert.equal(outageApplies(globalOutage("2026-03-05"), APP), true);
  assert.equal(outageApplies(globalOutage("2026-03-05"), OTHER_APP), true);
  assert.equal(outageApplies(globalOutage("2026-03-05"), "anything-at-all"), true);
});

test("an app outage applies ONLY to the named app", () => {
  const record = appOutage("2026-03-05", APP);
  assert.equal(outageApplies(record, APP), true);
  assert.equal(outageApplies(record, OTHER_APP), false, "an unrelated app gets no free day");
  assert.equal(outageApplies(record, ""), false);
  assert.equal(outageApplies(record, null), false);
});

test("a cleared day protects nobody", () => {
  // `degraded: false` is how a mis-declared day is withdrawn. It must stop
  // applying immediately, not linger as a record that still counts.
  assert.equal(outageApplies({ ...globalOutage("2026-03-05"), degraded: false }, APP), false);
  assert.equal(outageApplies({ ...appOutage("2026-03-05"), degraded: false }, APP), false);
});

test("malformed records fail CLOSED", () => {
  const cases = [
    [null, "null"],
    [undefined, "undefined"],
    [{}, "empty object"],
    [{ dayKey: "2026-03-05" }, "no degraded flag"],
    [{ dayKey: "2026-03-05", degraded: "yes", scope: OUTAGE_SCOPE_GLOBAL }, "degraded not boolean"],
    [{ dayKey: "2026-13-45", degraded: true, scope: OUTAGE_SCOPE_GLOBAL }, "impossible date"],
    [{ dayKey: "not-a-day", degraded: true, scope: OUTAGE_SCOPE_GLOBAL }, "unparseable date"],
    [{ dayKey: "2026-03-05", degraded: true }, "no scope"],
    [{ dayKey: "2026-03-05", degraded: true, scope: "whatever" }, "unknown scope"],
    [{ dayKey: "2026-03-05", degraded: true, scope: OUTAGE_SCOPE_APP }, "app scope, no appId"],
    [{ dayKey: "2026-03-05", degraded: true, scope: OUTAGE_SCOPE_APP, appId: "" }, "app scope, blank appId"],
  ];
  for (const [record, label] of cases) {
    assert.equal(outageApplies(record, APP), false, `${label} must not apply`);
  }
});

test("degraded must be exactly true, not merely truthy", () => {
  // A truthy check here would make `degraded: "false"` — a plausible bad
  // write — hand out a free day to everyone.
  for (const truthy of [1, "true", "false", {}, []]) {
    assert.equal(
      outageApplies({ ...globalOutage("2026-03-05"), degraded: truthy }, APP),
      false,
      `degraded: ${JSON.stringify(truthy)} must not count`,
    );
  }
});

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

test("range membership is inclusive at both ends", () => {
  assert.equal(isDayKeyWithin("2026-03-02", "2026-03-02", "2026-03-19"), true, "first day");
  assert.equal(isDayKeyWithin("2026-03-19", "2026-03-02", "2026-03-19"), true, "last day");
  assert.equal(isDayKeyWithin("2026-03-10", "2026-03-02", "2026-03-19"), true, "middle");
  assert.equal(isDayKeyWithin("2026-03-01", "2026-03-02", "2026-03-19"), false, "day before");
  assert.equal(isDayKeyWithin("2026-03-20", "2026-03-02", "2026-03-19"), false, "day after");
});

test("an outage outside the window credits nothing", () => {
  const before = globalOutage("2026-02-28");
  const after = globalOutage("2026-04-01");
  assert.deepEqual(applicableOutageDayKeys([before, after], WINDOW), []);
  assert.equal(countApplicableOutageDays([before, after], WINDOW), 0);
});

test("an outage on the claim day, before day 1, credits nothing", () => {
  // The claim day is deliberately not a testing day, so an outage on it took
  // nothing away from the tester.
  assert.deepEqual(applicableOutageDayKeys([globalOutage("2026-03-01")], WINDOW), []);
});

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

test("applicable days are de-duplicated and sorted", () => {
  const records = [
    globalOutage("2026-03-10"),
    globalOutage("2026-03-05"),
    // The same day twice — a merged read, a retry. It must count once.
    globalOutage("2026-03-05"),
    appOutage("2026-03-05", APP),
  ];
  assert.deepEqual(applicableOutageDayKeys(records, WINDOW), ["2026-03-05", "2026-03-10"]);
  assert.equal(countApplicableOutageDays(records, WINDOW), 2);
});

test("global and app outages both count, unrelated ones do not", () => {
  const records = [
    globalOutage("2026-03-04"),
    appOutage("2026-03-06", APP),
    appOutage("2026-03-07", OTHER_APP),
  ];
  assert.deepEqual(applicableOutageDayKeys(records, WINDOW), ["2026-03-04", "2026-03-06"]);
  assert.equal(countApplicableOutageDays(records, WINDOW), 2);
});

test("no records at all is zero, not an error", () => {
  assert.equal(countApplicableOutageDays([], WINDOW), 0);
  assert.equal(countApplicableOutageDays(null, WINDOW), 0);
  assert.equal(countApplicableOutageDays(undefined, WINDOW), 0);
});

test("a corrupt window credits nothing rather than guessing", () => {
  const records = [globalOutage("2026-03-05")];
  assert.deepEqual(
    applicableOutageDayKeys(records, { ...WINDOW, firstEligibleDayKey: "nope" }),
    [],
  );
  assert.deepEqual(
    applicableOutageDayKeys(records, { ...WINDOW, lastEligibleDayKey: "2026-99-99" }),
    [],
  );
});

test("the extension is capped even if the data is absurd", () => {
  // Every day of a very long range declared degraded. The cap is what stops a
  // data error turning into a commitment that can never expire.
  const records = [];
  for (let i = 0; i < 400; i += 1) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000);
    records.push(globalOutage(d.toISOString().slice(0, 10)));
  }
  const huge = {
    firstEligibleDayKey: "2026-01-01",
    lastEligibleDayKey: "2026-12-31",
    appId: APP,
  };
  assert.equal(countApplicableOutageDays(records, huge), MAX_OUTAGE_EXTENSION_DAYS);
});

// ---------------------------------------------------------------------------
// Effective window
// ---------------------------------------------------------------------------

test("no applicable outage leaves the window EXACTLY as it was", () => {
  // The property that makes adding outage handling a no-op for every
  // commitment that was never affected by one.
  assert.equal(
    effectiveLastEligibleDayKey({ ...WINDOW, records: [] }),
    "2026-03-19",
  );
  assert.equal(
    effectiveLastEligibleDayKey({ ...WINDOW, records: [appOutage("2026-03-05", OTHER_APP)] }),
    "2026-03-19",
  );
});

test("one outage day moves the deadline exactly one day", () => {
  assert.equal(
    effectiveLastEligibleDayKey({ ...WINDOW, records: [globalOutage("2026-03-05")] }),
    "2026-03-20",
  );
});

test("three outage days move it three, and across a month boundary", () => {
  const records = [
    globalOutage("2026-03-05"),
    globalOutage("2026-03-06"),
    appOutage("2026-03-07", APP),
  ];
  assert.equal(effectiveLastEligibleDayKey({ ...WINDOW, records }), "2026-03-22");

  const lateWindow = {
    firstEligibleDayKey: "2026-03-14",
    lastEligibleDayKey: "2026-03-31",
    appId: APP,
  };
  assert.equal(
    effectiveLastEligibleDayKey({ ...lateWindow, records: [globalOutage("2026-03-20")] }),
    "2026-04-01",
    "civil-date arithmetic rolls the month correctly",
  );
});

test("an outage on the LAST eligible day still counts", () => {
  assert.equal(
    effectiveLastEligibleDayKey({ ...WINDOW, records: [globalOutage("2026-03-19")] }),
    "2026-03-20",
  );
});

test("outages on the EXTENSION days do not cascade", () => {
  // Documented, deliberate: applicable days are counted strictly inside the
  // original window. Without this the extension would be self-referential —
  // each new day exposing more outage days — and the answer would depend on
  // when it was evaluated rather than on what was declared.
  const records = [
    globalOutage("2026-03-19"), // inside — credits one day, to 2026-03-20
    globalOutage("2026-03-20"), // on the extension day — must NOT credit again
    globalOutage("2026-03-21"),
  ];
  assert.equal(effectiveLastEligibleDayKey({ ...WINDOW, records }), "2026-03-20");
  assert.equal(countApplicableOutageDays(records, WINDOW), 1);
});

test("the derived window reports its working, and stores nothing", () => {
  const records = [globalOutage("2026-03-05"), appOutage("2026-03-09", APP)];
  const derived = deriveEffectiveWindow({ ...WINDOW, records });

  assert.equal(derived.firstEligibleDayKey, "2026-03-02", "the start never moves");
  assert.equal(derived.lastEligibleDayKey, "2026-03-19", "the original is preserved");
  assert.equal(derived.creditedOutageDays, 2);
  assert.deepEqual(derived.outageDayKeys, ["2026-03-05", "2026-03-09"]);
  assert.equal(derived.effectiveLastEligibleDayKey, "2026-03-21");
});

test("the derivation is deterministic and order-independent", () => {
  const records = [
    appOutage("2026-03-09", APP),
    globalOutage("2026-03-05"),
    appOutage("2026-03-11", OTHER_APP),
  ];
  const shuffled = [records[2], records[0], records[1]];

  const a = deriveEffectiveWindow({ ...WINDOW, records });
  const b = deriveEffectiveWindow({ ...WINDOW, records: shuffled });
  // Running it ten times must give the same answer ten times — this is what
  // lets the evaluator re-derive instead of storing a credited figure.
  for (let i = 0; i < 10; i += 1) {
    assert.deepEqual(deriveEffectiveWindow({ ...WINDOW, records }), a);
  }
  assert.deepEqual(a, b);
});

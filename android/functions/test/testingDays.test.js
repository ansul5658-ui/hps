/**
 * The 14-day testing engine.
 *
 * Two halves, same shape as the other money-path suites:
 *
 *   1. The pure clock in `lib/testingDays.js` - timezone day boundaries, DST,
 *      window derivation, the qualifying-day decision table and the expiry
 *      decision. These decide whether 50 real coins come back, so every branch
 *      is exercised directly.
 *
 *   2. The transaction in `testingDays.js`, driven through a fake Firestore
 *      that models document versions, `create` refusing to overwrite,
 *      transaction queries and retries.
 *
 * The emulator counterpart proves the same things against a real Firestore.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { FieldValue } = require("firebase-admin/firestore");

const {
  isValidTimeZone,
  isValidDayKey,
  dayKeyInZone,
  addDays,
  daysBetween,
  startOfLocalDayMillis,
  deriveWindow,
  maxPossibleQualifyingDays,
  isWindowClosed,
  checkTestingDayEligible,
  checkWindowExpired,
  testingLogId,
  flexDaysRemaining,
  nextCheckInAtMillis,
} = require("../lib/testingDays");
const { runRecordTestingDay, recordTestingDayImpl, evaluateWindowExpiry } = require("../testingDays");
const { runClaimCommitment } = require("../commitments");
const { cycleAssignmentId, activeClaimId, lockEntryId, unlockEntryId } = require("../lib/commitments");
const { checkInvariants } = require("../lib/wallet");
const {
  COMMITMENT_DAYS_REQUIRED,
  COMMITMENT_WINDOW_DAYS,
  DEFAULT_COMMITMENT_TIMEZONE,
} = require("../lib/constants");

const IST = "Asia/Kolkata";
const APP = "app1";
const TESTER = "tester1";
const DEV = "dev1";
const C1 = cycleAssignmentId(APP, TESTER, 1);
const C1_PATH = `testingAssignments/${C1}`;
const WALLET_PATH = `users/${TESTER}/wallet/balance`;
const CLAIM_PATH = `activeClaims/${activeClaimId(APP, TESTER)}`;

// ---------------------------------------------------------------------------
// A. Timezone
// ---------------------------------------------------------------------------

test("A: the testing day rolls at LOCAL midnight, not UTC midnight", () => {
  // 18:45 UTC on 1 March is 00:15 IST on 2 March. UTC still says the 1st.
  const justAfterIstMidnight = Date.parse("2026-03-01T18:45:00Z");
  assert.equal(new Date(justAfterIstMidnight).toISOString().slice(0, 10), "2026-03-01");
  assert.equal(dayKeyInZone(justAfterIstMidnight, IST), "2026-03-02");

  // 17:00 UTC is 22:30 IST — still the 1st in both, for contrast.
  const beforeIstMidnight = Date.parse("2026-03-01T17:00:00Z");
  assert.equal(dayKeyInZone(beforeIstMidnight, IST), "2026-03-01");

  // The exact boundary: 18:30 UTC is 00:00 IST.
  assert.equal(dayKeyInZone(Date.parse("2026-03-01T18:29:59Z"), IST), "2026-03-01");
  assert.equal(dayKeyInZone(Date.parse("2026-03-01T18:30:00Z"), IST), "2026-03-02");
});

test("A: a UTC day key would give a different answer, which is the whole point", () => {
  const t = Date.parse("2026-03-01T20:00:00Z");
  assert.equal(dayKeyInZone(t, "UTC"), "2026-03-01");
  assert.equal(dayKeyInZone(t, IST), "2026-03-02");
  assert.notEqual(dayKeyInZone(t, "UTC"), dayKeyInZone(t, IST));
});

test("A: DST is handled even though India has none", () => {
  const NY = "America/New_York";
  // 2026-03-08 is the US spring-forward. Local midnight before it is 05:00Z,
  // after it 04:00Z. Getting this wrong shifts a deadline by an hour.
  assert.equal(new Date(startOfLocalDayMillis("2026-03-07", NY)).toISOString(), "2026-03-07T05:00:00.000Z");
  assert.equal(new Date(startOfLocalDayMillis("2026-03-09", NY)).toISOString(), "2026-03-09T04:00:00.000Z");
  // And autumn fall-back.
  assert.equal(new Date(startOfLocalDayMillis("2026-10-31", NY)).toISOString(), "2026-10-31T04:00:00.000Z");
  assert.equal(new Date(startOfLocalDayMillis("2026-11-02", NY)).toISOString(), "2026-11-02T05:00:00.000Z");
});

test("A: civil-date arithmetic crosses a DST boundary without drifting", () => {
  // 18 days from 2026-03-01 is 2026-03-19 regardless of any offset change.
  assert.equal(addDays("2026-03-01", 18), "2026-03-19");
  assert.equal(daysBetween("2026-03-01", "2026-03-19"), 18);
  // Month and year boundaries, and a leap day.
  assert.equal(addDays("2026-12-25", 10), "2027-01-04");
  assert.equal(addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
});

test("A: only real IANA zones are accepted", () => {
  assert.equal(isValidTimeZone(IST), true);
  assert.equal(isValidTimeZone("UTC"), true);
  assert.equal(isValidTimeZone("America/New_York"), true);
  for (const bad of ["Mars/Olympus", "", null, undefined, 42, "GMT+5:30", "x".repeat(100)]) {
    assert.equal(isValidTimeZone(bad), false, String(bad));
  }
});

test("A: malformed day keys are rejected rather than coerced", () => {
  for (const bad of ["2026-99-99", "2026-13-01", "2026-02-30", "26-01-01", "", null, "2026-1-1"]) {
    assert.equal(isValidDayKey(bad), false, String(bad));
  }
  assert.equal(isValidDayKey("2026-02-28"), true);
  assert.equal(isValidDayKey("2028-02-29"), true);
});

test("A: the project default zone is the documented India-first one", () => {
  assert.equal(DEFAULT_COMMITMENT_TIMEZONE, "Asia/Kolkata");
  assert.equal(isValidTimeZone(DEFAULT_COMMITMENT_TIMEZONE), true);
});

// ---------------------------------------------------------------------------
// G. Window
// ---------------------------------------------------------------------------

test("G: day 1 is the NEXT full local day, never the partial claim day", () => {
  // 23:50 IST — fifty minutes left. Counting it would be a free day.
  const lateClaim = Date.parse("2026-03-01T18:20:00Z"); // 23:50 IST on the 1st
  const w = deriveWindow({ claimedAtMillis: lateClaim, timeZone: IST });
  assert.equal(w.claimedDayKey, "2026-03-01");
  assert.equal(w.firstEligibleDayKey, "2026-03-02", "the claim day is excluded");

  // 00:10 IST — almost a whole day left. Still excluded, for the same reason:
  // the rule must not depend on the hour someone tapped a button.
  const earlyClaim = Date.parse("2026-03-01T18:40:00Z"); // 00:10 IST on the 2nd
  const w2 = deriveWindow({ claimedAtMillis: earlyClaim, timeZone: IST });
  assert.equal(w2.claimedDayKey, "2026-03-02");
  assert.equal(w2.firstEligibleDayKey, "2026-03-03");
});

test("G: the window is 18 inclusive calendar days", () => {
  const w = deriveWindow({ claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"), timeZone: IST });
  assert.equal(w.firstEligibleDayKey, "2026-03-02");
  assert.equal(w.lastEligibleDayKey, "2026-03-19");
  assert.equal(
    daysBetween(w.firstEligibleDayKey, w.lastEligibleDayKey) + 1,
    COMMITMENT_WINDOW_DAYS,
    "day1..last inclusive must be exactly the window length",
  );
  assert.equal(w.windowDays, 18);
});

test("G: the window ends at local midnight after the last eligible day", () => {
  const w = deriveWindow({ claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"), timeZone: IST });
  // 2026-03-20 00:00 IST == 2026-03-19 18:30 UTC.
  assert.equal(new Date(w.windowEndsAtMillis).toISOString(), "2026-03-19T18:30:00.000Z");
});

test("G: 4 flex days — 18 days to earn 14", () => {
  const w = deriveWindow({ claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"), timeZone: IST });
  const span = daysBetween(w.firstEligibleDayKey, w.lastEligibleDayKey) + 1;
  assert.equal(span - COMMITMENT_DAYS_REQUIRED, 4);
  // On day 1 with nothing recorded, all four are still available.
  assert.equal(
    flexDaysRemaining({
      firstEligibleDayKey: w.firstEligibleDayKey,
      lastEligibleDayKey: w.lastEligibleDayKey,
      todayKey: w.firstEligibleDayKey,
      qualifyingDays: 0,
    }),
    4,
  );
  // Four days in with nothing recorded, they are all spent.
  assert.equal(
    flexDaysRemaining({
      firstEligibleDayKey: w.firstEligibleDayKey,
      lastEligibleDayKey: w.lastEligibleDayKey,
      todayKey: addDays(w.firstEligibleDayKey, 4),
      qualifyingDays: 0,
    }),
    0,
  );
});

test("G: outage credit extends the window without moving its start", () => {
  const base = deriveWindow({ claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"), timeZone: IST });
  const credited = deriveWindow({
    claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"),
    timeZone: IST,
    creditedOutageDays: 3,
  });
  assert.equal(credited.firstEligibleDayKey, base.firstEligibleDayKey, "start must not move");
  assert.equal(credited.lastEligibleDayKey, addDays(base.lastEligibleDayKey, 3));
  assert.equal(credited.creditedOutageDays, 3);
});

test("G: the window closes strictly after the last eligible day", () => {
  const last = "2026-03-19";
  assert.equal(isWindowClosed({ lastEligibleDayKey: last, todayKey: "2026-03-18" }), false);
  assert.equal(isWindowClosed({ lastEligibleDayKey: last, todayKey: last }), false, "the last day is still open");
  assert.equal(isWindowClosed({ lastEligibleDayKey: last, todayKey: "2026-03-20" }), true);
});

test("G: qualifying days can never exceed the eligible days elapsed", () => {
  assert.equal(maxPossibleQualifyingDays("2026-03-02", "2026-03-02"), 1);
  assert.equal(maxPossibleQualifyingDays("2026-03-02", "2026-03-05"), 4);
  assert.equal(maxPossibleQualifyingDays("2026-03-02", "2026-03-01"), 0, "before day 1");
});

// ---------------------------------------------------------------------------
// C/D. The qualifying-day decision table
// ---------------------------------------------------------------------------

const eligibleBase = {
  status: "inProgress",
  lockTxId: lockEntryId(C1),
  cycle: 1,
  firstEligibleDayKey: "2026-03-02",
  lastEligibleDayKey: "2026-03-19",
  todayKey: "2026-03-05",
  qualifyingDays: 3,
  daysRequired: 14,
  alreadyLoggedToday: false,
};

test("C: a well-formed check-in is eligible and increments by exactly one", () => {
  const r = checkTestingDayEligible(eligibleBase);
  assert.equal(r.ok, true);
  assert.equal(r.qualifyingDays, 4);
  assert.equal(r.completes, false);
});

test("C: before day 1 is a 'not yet', not a failure", () => {
  const r = checkTestingDayEligible({ ...eligibleBase, todayKey: "2026-03-01", qualifyingDays: 0 });
  assert.equal(r.ok, false);
  assert.equal(r.notStarted, true);
  assert.match(r.message, /starts tomorrow/);
});

test("C: after the window closes, a check-in is refused", () => {
  const r = checkTestingDayEligible({ ...eligibleBase, todayKey: "2026-03-20" });
  assert.equal(r.ok, false);
  assert.equal(r.windowClosed, true);
});

test("C: a same-day repeat is idempotent, not an error", () => {
  const r = checkTestingDayEligible({ ...eligibleBase, alreadyLoggedToday: true });
  assert.equal(r.ok, false);
  assert.equal(r.alreadyLogged, true);
});

test("C: a terminal assignment cannot accrue more days", () => {
  for (const status of ["completed", "failed", "missed", "cancelled"]) {
    assert.equal(checkTestingDayEligible({ ...eligibleBase, status }).ok, false, status);
  }
});

test("C: an assignment with no coin commitment cannot accrue days", () => {
  // A reward-era document. Letting it accrue would eventually route it into a
  // settlement that returns coins nobody staked.
  const r = checkTestingDayEligible({ ...eligibleBase, lockTxId: null });
  assert.equal(r.ok, false);
  assert.match(r.message, /no Testing Coin commitment/);
});

test("C: an assignment with no valid cycle is refused", () => {
  for (const cycle of [0, -1, undefined, null, "1", 1.5]) {
    assert.equal(checkTestingDayEligible({ ...eligibleBase, cycle }).ok, false, String(cycle));
  }
});

test("C: a corrupt window is refused rather than guessed at", () => {
  assert.equal(checkTestingDayEligible({ ...eligibleBase, firstEligibleDayKey: "nope" }).ok, false);
  assert.equal(checkTestingDayEligible({ ...eligibleBase, lastEligibleDayKey: null }).ok, false);
});

test("D: qualifyingDays cannot exceed the days actually elapsed", () => {
  // Day 1, but the record claims 5 days already done.
  const r = checkTestingDayEligible({
    ...eligibleBase,
    todayKey: "2026-03-02",
    qualifyingDays: 5,
  });
  assert.equal(r.ok, false);
  assert.match(r.message, /exceed the days elapsed/);
});

test("D: the 14th qualifying day completes, the 13th does not", () => {
  const thirteenth = checkTestingDayEligible({
    ...eligibleBase,
    todayKey: "2026-03-16",
    qualifyingDays: 12,
  });
  assert.equal(thirteenth.qualifyingDays, 13);
  assert.equal(thirteenth.completes, false);

  const fourteenth = checkTestingDayEligible({
    ...eligibleBase,
    todayKey: "2026-03-17",
    qualifyingDays: 13,
  });
  assert.equal(fourteenth.qualifyingDays, 14);
  assert.equal(fourteenth.completes, true, "the 14th day completes immediately");
});

test("D: qualifyingDays can never exceed daysRequired", () => {
  const r = checkTestingDayEligible({ ...eligibleBase, todayKey: "2026-03-18", qualifyingDays: 14 });
  assert.equal(r.ok, false, "already at the requirement — should have completed");
});

// ---------------------------------------------------------------------------
// Expiry decision
// ---------------------------------------------------------------------------

test("expiry: a window closed short is eligible for forfeiture", () => {
  const v = checkWindowExpired({
    status: "inProgress",
    lockTxId: lockEntryId(C1),
    lastEligibleDayKey: "2026-03-19",
    todayKey: "2026-03-20",
    qualifyingDays: 9,
  });
  assert.equal(v.expired, true);
  assert.equal(v.reason, "windowClosedShort");
});

test("expiry: 14 qualifying days is NEVER eligible for forfeiture", () => {
  // The tester did the work. Even if nobody settled it in time, they are owed
  // their coins — this is the single most important refusal in the file.
  const v = checkWindowExpired({
    status: "inProgress",
    lockTxId: lockEntryId(C1),
    lastEligibleDayKey: "2026-03-19",
    todayKey: "2026-03-25",
    qualifyingDays: 14,
  });
  assert.equal(v.expired, false);
  assert.equal(v.reason, "requirementMet");
});

test("expiry: an open window, a settled assignment and a stake-less one are all refused", () => {
  const base = {
    status: "inProgress",
    lockTxId: lockEntryId(C1),
    lastEligibleDayKey: "2026-03-19",
    todayKey: "2026-03-10",
    qualifyingDays: 2,
  };
  assert.equal(checkWindowExpired(base).reason, "windowOpen");
  assert.equal(checkWindowExpired({ ...base, status: "completed" }).reason, "alreadySettled");
  assert.equal(checkWindowExpired({ ...base, status: "failed" }).reason, "alreadySettled");
  assert.equal(checkWindowExpired({ ...base, lockTxId: null }).reason, "noCommitment");
  assert.equal(
    checkWindowExpired({ ...base, lastEligibleDayKey: "garbage" }).reason,
    "invalidWindow",
  );
});

test("expiry: missing one day does not expire anything", () => {
  // The flex-day guarantee, stated as a test: a gap mid-window changes nothing.
  const v = checkWindowExpired({
    status: "inProgress",
    lockTxId: lockEntryId(C1),
    lastEligibleDayKey: "2026-03-19",
    todayKey: "2026-03-11",
    qualifyingDays: 5,
  });
  assert.equal(v.expired, false);
});

test("log ids are cycle-scoped, so cycle 1 can never count toward cycle 2", () => {
  const c1 = testingLogId(cycleAssignmentId(APP, TESTER, 1), "2026-03-05");
  const c2 = testingLogId(cycleAssignmentId(APP, TESTER, 2), "2026-03-05");
  assert.notEqual(c1, c2);
  assert.equal(c1, "app1__tester1__c1__2026-03-05");
});

// ---------------------------------------------------------------------------
// Fake Firestore
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

function fakeDb(seed = {}, opts = {}) {
  const store = new Map();
  for (const [path, data] of Object.entries(seed)) store.set(path, { data, version: 1 });
  const committed = [];
  const state = { attempts: 0 };

  function bump(path, data) {
    const rec = store.get(path);
    store.set(path, { data: { ...(rec ? rec.data : {}), ...data }, version: (rec ? rec.version : 0) + 1 });
  }
  function matchingDocs(collection, filters) {
    const prefix = `${collection}/`;
    return [...store.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .filter(([, rec]) => filters.every(([f, v]) => rec.data[f] === v))
      .map(([p, rec]) => ({ path: p, id: p.slice(prefix.length), rec }));
  }
  function collectionRef(name, filters = []) {
    return {
      __query: { collection: name, filters },
      where: (f, op, v) => collectionRef(name, [...filters, [f, v]]),
      count: () => ({ __count: { collection: name, filters } }),
    };
  }

  const db = {
    doc: (path) => ({ path, get: async () => snapshot(path, store.get(path)) }),
    collection: (name) => collectionRef(name),
    async runTransaction(fn) {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        state.attempts += 1;
        const reads = new Map();
        const writes = [];
        const tx = {
          async get(target) {
            if (target && target.__count) {
              return { data: () => ({ count: matchingDocs(target.__count.collection, target.__count.filters).length }) };
            }
            if (target && target.__query) {
              const rows = matchingDocs(target.__query.collection, target.__query.filters);
              for (const r of rows) reads.set(r.path, r.rec.version);
              return { empty: rows.length === 0, size: rows.length, docs: rows.map((r) => snapshot(r.path, r.rec)) };
            }
            const rec = store.get(target.path);
            reads.set(target.path, rec ? rec.version : 0);
            return snapshot(target.path, rec);
          },
          create: (ref, data) => writes.push({ kind: "create", path: ref.path, data }),
          set: (ref, data) => writes.push({ kind: "set", path: ref.path, data }),
          update: (ref, data) => writes.push({ kind: "update", path: ref.path, data }),
          delete: (ref) => writes.push({ kind: "delete", path: ref.path }),
        };
        const result = await fn(tx);
        if (opts.beforeCommit) opts.beforeCommit({ attempt, bump, store });
        const conflicted = [...reads].some(([p, v]) => (store.get(p) ? store.get(p).version : 0) !== v);
        if (conflicted) continue;
        for (const w of writes) {
          if (w.kind === "create" && store.has(w.path)) {
            const err = new Error(`ALREADY_EXISTS: ${w.path}`);
            err.code = 6;
            throw err;
          }
        }
        for (const w of writes) {
          const rec = store.get(w.path);
          if (w.kind === "delete") store.delete(w.path);
          else if (w.kind === "create" || w.kind === "set") store.set(w.path, { data: { ...w.data }, version: (rec ? rec.version : 0) + 1 });
          else store.set(w.path, { data: { ...(rec ? rec.data : {}), ...w.data }, version: (rec ? rec.version : 0) + 1 });
          committed.push({ kind: w.kind, path: w.path, data: w.data });
        }
        return result;
      }
      const err = new Error("ABORTED: too much contention");
      err.code = 10;
      throw err;
    },
  };
  db.__store = store;
  db.__committed = committed;
  db.__state = state;
  db.__read = (p) => (store.get(p) ? store.get(p).data : undefined);
  db.__has = (p) => store.has(p);
  return db;
}

/** A live commitment with a pinned IST window, `done` days already recorded. */
function committedWorld({ done = 0, status = "inProgress", locked = 50, available = 0, extra = {} } = {}) {
  const w = deriveWindow({ claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"), timeZone: IST });
  return {
    [`users/${TESTER}`]: { uid: TESTER },
    [`users/${DEV}`]: { uid: DEV },
    [`apps/${APP}`]: { ownerId: DEV, status: "approved", testerCount: 1 },
    [C1_PATH]: {
      appId: APP,
      testerId: TESTER,
      developerId: DEV,
      cycle: 1,
      commitmentAmount: 50,
      daysRequired: COMMITMENT_DAYS_REQUIRED,
      windowDays: COMMITMENT_WINDOW_DAYS,
      timeZone: w.timeZone,
      timeZoneSource: "default",
      claimedDayKey: w.claimedDayKey,
      firstEligibleDayKey: w.firstEligibleDayKey,
      lastEligibleDayKey: w.lastEligibleDayKey,
      creditedOutageDays: 0,
      qualifyingDays: done,
      daysCompleted: done,
      status,
      lockTxId: lockEntryId(C1),
      settlementTxId: null,
    },
    [CLAIM_PATH]: { assignmentId: C1, appId: APP, testerId: TESTER, cycle: 1 },
    [WALLET_PATH]: {
      available,
      locked,
      forfeitedTotal: 0,
      purchasedTotal: 0,
      adjustmentNet: available + locked,
      ledgerCount: 2,
      schemaVersion: 2,
    },
    ...extra,
  };
}

/** Noon IST on the Nth eligible day (1-based). */
function atEligibleDay(n) {
  const w = deriveWindow({ claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"), timeZone: IST });
  const key = addDays(w.firstEligibleDayKey, n - 1);
  return startOfLocalDayMillis(key, IST) + 12 * 3600 * 1000;
}

const checkIn = (db, nowMillis, assignmentId = C1, testerId = TESTER) =>
  runRecordTestingDay(db, { assignmentId, testerId, nowMillis });

async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err.code;
  }
}

// ---------------------------------------------------------------------------
// B. Check-in authorization
// ---------------------------------------------------------------------------

test("B: an unauthenticated caller is rejected", async () => {
  const db = fakeDb(committedWorld());
  assert.equal(await codeOf(recordTestingDayImpl(db, { data: { assignmentId: C1 } })), "unauthenticated");
  assert.equal(db.__committed.length, 0);
});

test("B: a suspended tester is rejected and writes nothing", async () => {
  const db = fakeDb(committedWorld({ extra: { [`users/${TESTER}`]: { uid: TESTER, isSuspended: true } } }));
  assert.equal(await codeOf(checkIn(db, atEligibleDay(1))), "permission-denied");
  assert.equal(db.__committed.length, 0);
});

test("B: another tester cannot record a day on someone else's assignment", async () => {
  const db = fakeDb(committedWorld({ extra: { "users/intruder": { uid: "intruder" } } }));
  // Reported as not-found so the collection cannot be probed for ids.
  assert.equal(await codeOf(checkIn(db, atEligibleDay(1), C1, "intruder")), "not-found");
  assert.equal(db.__committed.length, 0);
  assert.equal(db.__read(C1_PATH).qualifyingDays, 0);
});

test("B: a missing assignment is rejected", async () => {
  const db = fakeDb(committedWorld());
  assert.equal(await codeOf(checkIn(db, atEligibleDay(1), "nope__nobody__c1")), "not-found");
});

test("B: a malformed assignment id is rejected before any read", async () => {
  const db = fakeDb(committedWorld());
  for (const assignmentId of [undefined, null, "", 42, "a/b", "..", "__x__"]) {
    assert.equal(
      await codeOf(recordTestingDayImpl(db, { auth: { uid: TESTER }, data: { assignmentId } })),
      "invalid-argument",
      String(assignmentId),
    );
  }
});

test("B: an assignment with no pinned window is refused rather than guessed at", async () => {
  const seed = committedWorld();
  delete seed[C1_PATH].timeZone;
  delete seed[C1_PATH].firstEligibleDayKey;
  delete seed[C1_PATH].lastEligibleDayKey;
  const db = fakeDb(seed);
  assert.equal(await codeOf(checkIn(db, atEligibleDay(1))), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

// ---------------------------------------------------------------------------
// C. Check-in integrity
// ---------------------------------------------------------------------------

test("C: the first check-in records one day and one log", async () => {
  const db = fakeDb(committedWorld());
  const out = await checkIn(db, atEligibleDay(1));

  assert.equal(out.recorded, true);
  assert.equal(out.qualifyingDays, 1);
  assert.equal(out.completed, false);
  assert.equal(out.dayKey, "2026-03-02");

  const logPath = `testingLogs/${testingLogId(C1, "2026-03-02")}`;
  const log = db.__read(logPath);
  assert.ok(log, "a testing log must exist");
  assert.equal(log.assignmentId, C1);
  assert.equal(log.cycle, 1, "the log is bound to the cycle");
  assert.equal(log.testerId, TESTER);
  assert.equal(log.date, "2026-03-02");
  assert.equal(log.timeZone, IST);
  const write = db.__committed.find((w) => w.path === logPath);
  assert.equal(write.kind, "create", "logs are created, never set");

  assert.equal(db.__read(C1_PATH).qualifyingDays, 1);
  assert.equal(db.__read(C1_PATH).status, "inProgress");
});

test("C: a duplicate same-day check-in is idempotent", async () => {
  const db = fakeDb(committedWorld());
  const first = await checkIn(db, atEligibleDay(1));
  const second = await checkIn(db, atEligibleDay(1) + 3600 * 1000);

  assert.equal(first.recorded, true);
  assert.equal(second.recorded, false);
  assert.equal(second.alreadyLogged, true);
  assert.equal(db.__read(C1_PATH).qualifyingDays, 1, "must not double-count");
  const logs = [...db.__store.keys()].filter((k) => k.startsWith("testingLogs/"));
  assert.equal(logs.length, 1);
});

test("C: a check-in on the claim day itself is refused — day 1 is tomorrow", async () => {
  const db = fakeDb(committedWorld());
  // Noon IST on the claim day.
  const onClaimDay = startOfLocalDayMillis("2026-03-01", IST) + 12 * 3600 * 1000;
  assert.equal(await codeOf(checkIn(db, onClaimDay)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("C: a check-in after the window closes is refused", async () => {
  const db = fakeDb(committedWorld({ done: 5 }));
  const afterWindow = startOfLocalDayMillis("2026-03-20", IST) + 3600 * 1000;
  assert.equal(await codeOf(checkIn(db, afterWindow)), "failed-precondition");
  assert.equal(db.__read(C1_PATH).qualifyingDays, 5);
});

/**
 * A commitment whose window contains the real present.
 *
 * `recordTestingDayImpl` reads the wall clock, so tests that exercise the
 * callable wrapper (rather than injecting `nowMillis`) need a live window.
 */
function liveWorld(done = 0) {
  const todayKey = dayKeyInZone(Date.now(), IST);
  const seed = committedWorld({ done });
  seed[C1_PATH] = {
    ...seed[C1_PATH],
    claimedDayKey: addDays(todayKey, -1),
    firstEligibleDayKey: todayKey,
    lastEligibleDayKey: addDays(todayKey, COMMITMENT_WINDOW_DAYS - 1),
  };
  return seed;
}

test("C: a client-supplied dayKey, timezone and progress are all ignored", async () => {
  const db = fakeDb(liveWorld());
  const serverToday = dayKeyInZone(Date.now(), IST);
  const out = await recordTestingDayImpl(db, {
    auth: { uid: TESTER },
    data: {
      assignmentId: C1,
      // Everything a hostile client might try.
      dayKey: "2026-03-19",
      date: "2026-03-19",
      timeZone: "Pacific/Kiritimati",
      qualifyingDays: 13,
      daysRequired: 1,
      completed: true,
    },
  });
  assert.equal(out.dayKey, serverToday, "the server's day, not the caller's");
  assert.notEqual(out.dayKey, "2026-03-19", "the caller's dayKey had no effect");
  assert.equal(out.qualifyingDays, 1, "the server's count, not the caller's");
  assert.equal(out.completed, false);
  // Pacific/Kiritimati is UTC+14 — far enough from IST that using it would
  // change the day key on most of the clock. The stored zone is still IST.
  assert.equal(db.__read(`testingLogs/${testingLogId(C1, serverToday)}`).timeZone, IST);
});

test("C: a device clock cannot buy a day — the server clock decides", async () => {
  // Two check-ins an hour apart but on the same local day: still one day, no
  // matter what any device believes.
  const db = fakeDb(committedWorld());
  await checkIn(db, atEligibleDay(1));
  await checkIn(db, atEligibleDay(1) + 6 * 3600 * 1000);
  assert.equal(db.__read(C1_PATH).qualifyingDays, 1);
});

test("C: a log from cycle 1 does not count toward cycle 2", async () => {
  const c2 = cycleAssignmentId(APP, TESTER, 2);
  const w = deriveWindow({ claimedAtMillis: Date.parse("2026-03-01T06:00:00Z"), timeZone: IST });
  const seed = committedWorld({ done: 0, status: "completed" });
  seed[`testingAssignments/${c2}`] = {
    ...seed[C1_PATH],
    cycle: 2,
    status: "inProgress",
    qualifyingDays: 0,
    lockTxId: lockEntryId(c2),
    firstEligibleDayKey: w.firstEligibleDayKey,
    lastEligibleDayKey: w.lastEligibleDayKey,
  };
  // A cycle-1 log for the same date already exists.
  seed[`testingLogs/${testingLogId(C1, "2026-03-02")}`] = { assignmentId: C1, cycle: 1, date: "2026-03-02" };
  const db = fakeDb(seed);

  const out = await checkIn(db, atEligibleDay(1), c2);
  assert.equal(out.recorded, true, "cycle 2 gets its own log for the same date");
  assert.equal(out.qualifyingDays, 1);
  assert.ok(db.__has(`testingLogs/${testingLogId(c2, "2026-03-02")}`));
  // The cycle-1 log is untouched.
  assert.ok(db.__has(`testingLogs/${testingLogId(C1, "2026-03-02")}`));
});

// ---------------------------------------------------------------------------
// D/E. Progress and the completion settlement
// ---------------------------------------------------------------------------

test("D/E: the 14th qualifying day completes and returns the SAME 50 coins", async () => {
  const db = fakeDb(committedWorld({ done: 13, locked: 50, available: 0 }));
  const out = await checkIn(db, atEligibleDay(14));

  assert.equal(out.recorded, true);
  assert.equal(out.qualifyingDays, 14);
  assert.equal(out.completed, true);
  assert.equal(out.unlockedAmount, 50);

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 50, "the stake comes back");
  assert.equal(wallet.locked, 0);
  assert.equal(wallet.forfeitedTotal, 0);
  assert.equal(wallet.adjustmentNet, 50, "no coins were created");
  assert.equal(checkInvariants(wallet).ok, true);

  const a = db.__read(C1_PATH);
  assert.equal(a.status, "completed");
  assert.equal(a.qualifyingDays, 14);
  assert.equal(a.settlementTxId, unlockEntryId(C1));

  assert.equal(db.__has(CLAIM_PATH), false, "the active claim is released");

  const entry = db.__read(`users/${TESTER}/coinTransactions/${unlockEntryId(C1)}`);
  assert.equal(entry.kind, "unlock");
  assert.equal(entry.source, "completion");
  assert.equal(entry.deltaAvailable, 50);
  assert.equal(entry.deltaLocked, -50);
});

test("D/E: exactly one unlock entry, and no reward or bonus entry", async () => {
  const db = fakeDb(committedWorld({ done: 13 }));
  await checkIn(db, atEligibleDay(14));

  const ledger = [...db.__store.keys()].filter((k) => k.startsWith(`users/${TESTER}/coinTransactions/`));
  assert.equal(ledger.length, 1);
  const kinds = ledger.map((k) => db.__read(k).kind);
  assert.deepEqual(kinds, ["unlock"]);
  assert.equal(kinds.includes("earn"), false, "there is no reward under this model");
});

test("D: the 13th day does NOT complete", async () => {
  const db = fakeDb(committedWorld({ done: 12 }));
  const out = await checkIn(db, atEligibleDay(13));
  assert.equal(out.qualifyingDays, 13);
  assert.equal(out.completed, false);

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.locked, 50, "coins stay committed");
  assert.equal(wallet.available, 0);
  assert.equal(db.__read(C1_PATH).status, "inProgress");
  assert.equal(db.__has(CLAIM_PATH), true);
});

test("E: a completed commitment cannot be checked into again", async () => {
  const db = fakeDb(committedWorld({ done: 13 }));
  await checkIn(db, atEligibleDay(14));
  const after = { ...db.__read(WALLET_PATH) };

  assert.equal(await codeOf(checkIn(db, atEligibleDay(15))), "failed-precondition");
  assert.deepEqual(db.__read(WALLET_PATH), after, "no second unlock");
  assert.equal(db.__read(WALLET_PATH).available, 50, "50, never 100");
});

test("E: fourteen sequential days complete exactly once, end to end", async () => {
  const db = fakeDb(committedWorld({ done: 0 }));
  let last;
  for (let day = 1; day <= 14; day += 1) {
    last = await checkIn(db, atEligibleDay(day));
  }
  assert.equal(last.completed, true);
  assert.equal(last.qualifyingDays, 14);

  const logs = [...db.__store.keys()].filter((k) => k.startsWith("testingLogs/"));
  assert.equal(logs.length, 14, "one log per day");
  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 50);
  assert.equal(wallet.locked, 0);
  assert.equal(checkInvariants(wallet).ok, true);
});

test("E: flex days absorb gaps — 14 days inside 18 still completes", async () => {
  const db = fakeDb(committedWorld({ done: 0 }));
  // Skip eligible days 3, 7, 11 and 15: four misses, exactly the flex budget.
  const skipped = new Set([3, 7, 11, 15]);
  let last;
  for (let day = 1; day <= 18; day += 1) {
    if (skipped.has(day)) continue;
    last = await checkIn(db, atEligibleDay(day));
  }
  assert.equal(last.completed, true, "missing four days must still complete");
  assert.equal(db.__read(WALLET_PATH).available, 50);
});

test("E: 13 days inside the window leaves the commitment eligible for failure", async () => {
  const db = fakeDb(committedWorld({ done: 0 }));
  for (let day = 1; day <= 13; day += 1) await checkIn(db, atEligibleDay(day));

  assert.equal(db.__read(C1_PATH).qualifyingDays, 13);
  assert.equal(db.__read(C1_PATH).status, "inProgress");
  assert.equal(db.__read(WALLET_PATH).locked, 50, "coins still committed");

  const verdict = checkWindowExpired({
    status: "inProgress",
    lockTxId: lockEntryId(C1),
    lastEligibleDayKey: db.__read(C1_PATH).lastEligibleDayKey,
    todayKey: addDays(db.__read(C1_PATH).lastEligibleDayKey, 1),
    qualifyingDays: 13,
  });
  assert.equal(verdict.expired, true);
});

test("E: the check-in transaction touches only its own documents", async () => {
  const db = fakeDb(committedWorld({ done: 13 }));
  await checkIn(db, atEligibleDay(14));
  const paths = [...new Set(db.__committed.map((w) => w.path))].sort();
  assert.deepEqual(
    paths,
    [
      `testingLogs/${testingLogId(C1, addDays("2026-03-02", 13))}`,
      C1_PATH,
      WALLET_PATH,
      `users/${TESTER}/coinTransactions/${unlockEntryId(C1)}`,
      CLAIM_PATH,
    ].sort(),
  );
});

// ---------------------------------------------------------------------------
// F. Concurrency (fake-level; the emulator suite proves it for real)
// ---------------------------------------------------------------------------

test("F: two simultaneous check-ins for the same day record exactly one", async () => {
  const db = fakeDb(committedWorld({ done: 0 }));
  const results = await Promise.allSettled([checkIn(db, atEligibleDay(1)), checkIn(db, atEligibleDay(1))]);
  const recorded = results.filter((r) => r.status === "fulfilled" && r.value.recorded);
  assert.equal(recorded.length, 1);
  assert.equal(db.__read(C1_PATH).qualifyingDays, 1);
});

test("F: two simultaneous FINAL-day check-ins unlock exactly once", async () => {
  const db = fakeDb(committedWorld({ done: 13 }));
  const results = await Promise.allSettled([checkIn(db, atEligibleDay(14)), checkIn(db, atEligibleDay(14))]);
  const completed = results.filter((r) => r.status === "fulfilled" && r.value.completed);
  assert.equal(completed.length, 1, "exactly one completion");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 50, "50, never 100");
  assert.equal(wallet.locked, 0);
  assert.equal(checkInvariants(wallet).ok, true);
  const unlocks = [...db.__store.keys()].filter((k) => k.includes("/coinTransactions/unlock_"));
  assert.equal(unlocks.length, 1);
});

test("F: a racing writer forces a retry and the outcome stays correct", async () => {
  let injected = false;
  const db = fakeDb(committedWorld({ done: 13 }), {
    beforeCommit: ({ bump }) => {
      if (injected) return;
      injected = true;
      bump(C1_PATH, { updatedAt: "racing" });
    },
  });
  const out = await checkIn(db, atEligibleDay(14));
  assert.equal(out.completed, true);
  assert.ok(db.__state.attempts >= 2, "the transaction must actually have retried");
  assert.equal(db.__read(WALLET_PATH).available, 50);
  assert.equal(checkInvariants(db.__read(WALLET_PATH)).ok, true);
});

// ---------------------------------------------------------------------------
// I. Legacy compatibility
// ---------------------------------------------------------------------------

test("I: a reward-era assignment cannot record a testing day", async () => {
  const legacyId = `${APP}__${TESTER}`;
  const db = fakeDb({
    [`users/${TESTER}`]: { uid: TESTER },
    [`testingAssignments/${legacyId}`]: {
      appId: APP,
      testerId: TESTER,
      daysRequired: 14,
      daysCompleted: 3,
      status: "inProgress",
      coinReward: 50,
    },
  });
  // No pinned window, so it is refused before any coin logic is reachable.
  assert.equal(await codeOf(checkIn(db, Date.now(), legacyId)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("I: an assignment with a window but no lock still cannot accrue days", async () => {
  const seed = committedWorld();
  seed[C1_PATH].lockTxId = null;
  const db = fakeDb(seed);
  assert.equal(await codeOf(checkIn(db, atEligibleDay(1))), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

// ---------------------------------------------------------------------------
// Claim pins the clock
// ---------------------------------------------------------------------------

function claimWorld(available = 50) {
  return {
    [`users/${TESTER}`]: { uid: TESTER },
    [`users/${DEV}`]: { uid: DEV },
    [`apps/${APP}`]: { ownerId: DEV, status: "approved", testerCount: 0 },
    [WALLET_PATH]: {
      available,
      locked: 0,
      forfeitedTotal: 0,
      purchasedTotal: 0,
      adjustmentNet: available,
      ledgerCount: 1,
      schemaVersion: 2,
    },
  };
}

test("claim pins a timezone and a full window onto the assignment", async () => {
  const db = fakeDb(claimWorld());
  const out = await runClaimCommitment(db, { appId: APP, testerId: TESTER });

  const a = db.__read(`testingAssignments/${out.assignmentId}`);
  assert.equal(a.timeZone, DEFAULT_COMMITMENT_TIMEZONE);
  assert.equal(a.timeZoneSource, "default");
  assert.ok(isValidDayKey(a.claimedDayKey));
  assert.ok(isValidDayKey(a.firstEligibleDayKey));
  assert.ok(isValidDayKey(a.lastEligibleDayKey));
  assert.equal(daysBetween(a.claimedDayKey, a.firstEligibleDayKey), 1, "day 1 is tomorrow");
  assert.equal(
    daysBetween(a.firstEligibleDayKey, a.lastEligibleDayKey) + 1,
    COMMITMENT_WINDOW_DAYS,
  );
  assert.equal(a.creditedOutageDays, 0);
  assert.equal(a.qualifyingDays, 0);
  assert.ok(a.windowEndsAt, "an auditable window end must be stored");
});

test("a tester may state their own IANA zone once, at claim", async () => {
  const db = fakeDb(claimWorld());
  const out = await runClaimCommitment(db, {
    appId: APP,
    testerId: TESTER,
    requestedTimeZone: "America/New_York",
  });
  const a = db.__read(`testingAssignments/${out.assignmentId}`);
  assert.equal(a.timeZone, "America/New_York");
  assert.equal(a.timeZoneSource, "tester");
});

test("a bogus timezone falls back to the documented default, never to a guess", async () => {
  for (const bad of ["Mars/Olympus", "", null, 42, "GMT+5:30"]) {
    const db = fakeDb(claimWorld());
    const out = await runClaimCommitment(db, { appId: APP, testerId: TESTER, requestedTimeZone: bad });
    const a = db.__read(`testingAssignments/${out.assignmentId}`);
    assert.equal(a.timeZone, DEFAULT_COMMITMENT_TIMEZONE, String(bad));
    assert.equal(a.timeZoneSource, "default", String(bad));
  }
});

test("evaluateWindowExpiry reports without writing anything", async () => {
  const db = fakeDb(committedWorld({ done: 3 }));
  const afterWindow = startOfLocalDayMillis("2026-03-21", IST);
  const verdict = await evaluateWindowExpiry(db, { assignmentId: C1, nowMillis: afterWindow });

  assert.equal(verdict.expired, true);
  assert.equal(verdict.reason, "windowClosedShort");
  assert.equal(db.__committed.length, 0, "the evaluator must be read-only");
  assert.equal(db.__read(WALLET_PATH).locked, 50, "it moves no coins");
});

// ---------------------------------------------------------------------------
// N. The check-in boundary instant
//
// The client used to render "Logged today" by comparing the server's
// `lastQualifyingDayKey` against a day key it computed in UTC. For an Indian
// tester those two disagreed for five and a half hours every night: the server
// knew the day was logged, the button looked available. The server now stamps
// the INSTANT the logged day ends, in the commitment's pinned zone, so the
// device compares two instants and needs no timezone of its own.
// ---------------------------------------------------------------------------

test("N: the boundary is local midnight AFTER the logged day, in the pinned zone", () => {
  // 2026-03-05 in IST ends at 00:00 IST on the 6th, which is 18:30 UTC on the
  // 5th. If this were UTC-based it would land at 00:00 UTC on the 6th - the
  // 5.5 hour error the whole change exists to remove.
  const boundary = nextCheckInAtMillis("2026-03-05", IST);
  assert.equal(boundary, Date.parse("2026-03-05T18:30:00Z"));
  assert.notEqual(boundary, Date.parse("2026-03-06T00:00:00Z"));
  assert.equal(boundary, startOfLocalDayMillis("2026-03-06", IST));
});

test("N: an instant before the boundary is still the logged local day", () => {
  const boundary = nextCheckInAtMillis("2026-03-05", IST);

  // 03:00 IST on the 5th. UTC calls this the 4th; IST calls it the 5th. This
  // is exactly the window in which the old UTC comparison went wrong.
  const threeAmIst = Date.parse("2026-03-04T21:30:00Z");
  assert.equal(dayKeyInZone(threeAmIst, IST), "2026-03-05", "IST says the 5th");
  assert.equal(dayKeyInZone(threeAmIst, "UTC"), "2026-03-04", "UTC says the 4th");
  assert.ok(threeAmIst < boundary, "and the boundary correctly says: still logged");

  // 23:59 IST on the 5th is the last instant inside the logged day.
  assert.ok(Date.parse("2026-03-05T18:29:00Z") < boundary);
  // 00:00 IST on the 6th is the boundary itself - a new day has begun.
  assert.ok(!(boundary < boundary));
  assert.ok(Date.parse("2026-03-05T18:30:01Z") > boundary);
});

test("N: the boundary is DST-correct in a zone that actually has DST", () => {
  // 2026-03-08 is the US spring-forward day; that local day is 23 hours long.
  // The boundary must be the real local midnight opening the 9th, not 24 hours
  // after the previous one.
  const zone = "America/Los_Angeles";
  const boundary = nextCheckInAtMillis("2026-03-08", zone);
  assert.equal(boundary, startOfLocalDayMillis("2026-03-09", zone));
  assert.equal(dayKeyInZone(boundary, zone), "2026-03-09");
  assert.equal(dayKeyInZone(boundary - 1, zone), "2026-03-08", "one ms earlier is still the 8th");

  const previous = nextCheckInAtMillis("2026-03-07", zone);
  assert.equal(boundary - previous, 23 * 3600 * 1000, "the spring-forward day is 23 hours");
});

test("N: a malformed day key or zone yields null rather than a guess", () => {
  assert.equal(nextCheckInAtMillis("2026-99-99", IST), null);
  assert.equal(nextCheckInAtMillis("not-a-day", IST), null);
  assert.equal(nextCheckInAtMillis(null, IST), null);
  assert.equal(nextCheckInAtMillis("2026-03-05", "Mars/Olympus"), null);
});

test("N: recording a day stamps the boundary on the assignment", async () => {
  const db = fakeDb(committedWorld());
  const out = await checkIn(db, atEligibleDay(1));

  assert.equal(out.dayKey, "2026-03-02");
  const expected = nextCheckInAtMillis("2026-03-02", IST);
  assert.equal(out.nextCheckInAtMillis, expected, "the callable returns it");

  const stored = db.__read(C1_PATH).nextCheckInAt;
  assert.ok(stored, "and it is written to the assignment");
  assert.equal(stored.toMillis(), expected);
  assert.equal(
    stored.toMillis(),
    startOfLocalDayMillis("2026-03-03", IST),
    "local midnight opening the next eligible day",
  );
});

test("N: the stamped boundary moves forward with each new day logged", async () => {
  const db = fakeDb(committedWorld());

  for (const day of [1, 2, 3]) {
    await checkIn(db, atEligibleDay(day));
    const key = addDays("2026-03-02", day - 1);
    assert.equal(
      db.__read(C1_PATH).nextCheckInAt.toMillis(),
      nextCheckInAtMillis(key, IST),
      `after day ${day} the boundary is local midnight after ${key}`,
    );
  }
  assert.equal(db.__read(C1_PATH).qualifyingDays, 3);
});

test("N: an idempotent repeat returns the boundary without moving it", async () => {
  const db = fakeDb(committedWorld());
  await checkIn(db, atEligibleDay(1));
  const after = db.__read(C1_PATH).nextCheckInAt.toMillis();

  // A double tap three hours later, still the same IST day.
  const repeat = await checkIn(db, atEligibleDay(1) + 3 * 3600 * 1000);
  assert.equal(repeat.recorded, false);
  assert.equal(repeat.alreadyLogged, true);
  assert.equal(repeat.nextCheckInAtMillis, after, "the no-op path reports the same boundary");
  assert.equal(db.__read(C1_PATH).nextCheckInAt.toMillis(), after, "and does not move it");
});

test("N: the boundary is what a client needs to survive UTC midnight", async () => {
  // The scenario from the device: the tester logs at 22:00 IST, then opens the
  // app at 02:00 IST - after UTC midnight, still the same IST day.
  const db = fakeDb(committedWorld());
  const loggedAt = startOfLocalDayMillis("2026-03-02", IST) + 22 * 3600 * 1000;
  await checkIn(db, loggedAt);

  const boundary = db.__read(C1_PATH).nextCheckInAt.toMillis();
  const reopenedAt = startOfLocalDayMillis("2026-03-02", IST) + 26 * 3600 * 1000; // 02:00 IST on the 3rd

  // Careful: 02:00 IST on the 3rd is a NEW IST day, so the button SHOULD be
  // available - and the boundary agrees.
  assert.ok(reopenedAt >= boundary, "a new IST day really has begun");

  // Whereas 02:00 IST on the SAME day as the log is not.
  const sameDayAfterUtcMidnight = startOfLocalDayMillis("2026-03-02", IST) + 2 * 3600 * 1000;
  assert.equal(dayKeyInZone(sameDayAfterUtcMidnight, "UTC"), "2026-03-01", "UTC disagrees");
  assert.equal(dayKeyInZone(sameDayAfterUtcMidnight, IST), "2026-03-02", "IST is authoritative");

  // And the server refuses a second log on that same IST day regardless.
  const repeat = await checkIn(db, startOfLocalDayMillis("2026-03-02", IST) + 23 * 3600 * 1000);
  assert.equal(repeat.alreadyLogged, true, "duplicate protection stays server-side");
  assert.equal(db.__read(C1_PATH).qualifyingDays, 1);
});

test("N: the completing 14th day also stamps a boundary", async () => {
  const db = fakeDb(committedWorld({ done: 13 }));
  const out = await checkIn(db, atEligibleDay(14));

  assert.equal(out.completed, true);
  assert.equal(out.qualifyingDays, 14);
  assert.equal(out.unlockedAmount, 50, "exactly the 50 committed coins come back");
  assert.equal(
    db.__read(C1_PATH).nextCheckInAt.toMillis(),
    nextCheckInAtMillis("2026-03-15", IST),
  );
  assert.equal(db.__read(WALLET_PATH).available, 50);
  assert.equal(db.__read(WALLET_PATH).locked, 0);
});

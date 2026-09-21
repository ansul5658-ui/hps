/**
 * Proof that the legacy push-matching allocation path is retired.
 *
 * WHY THIS FILE EXISTS SEPARATELY
 * The other suites prove the new commitment path is correct. This one proves
 * the OLD path is gone — a different question, and one that is easy to lose
 * silently. If someone reintroduces a way to create a tester assignment
 * without locking coins, every other test in the project still passes; these
 * fail.
 *
 * The hazard being guarded against is specific: an assignment created outside
 * the coin-locking transaction is a live tester obligation with nothing staked
 * behind it. It looks identical to a real commitment in the database, in the
 * UI, and to the settlement path — which would then try to "return" coins that
 * were never taken.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const assignments = require("../assignments");
const matching = require("../lib/matching");
const commitments = require("../commitments");
const index = require("../index");
const {
  cycleAssignmentId,
  activeClaimId,
  lockEntryId,
  cycleOf,
} = require("../lib/commitments");
const { checkInvariants } = require("../lib/wallet");
const { DEFAULT_COMMITMENT_AMOUNT } = require("../lib/constants");

const APP = "app1";
const TESTER = "tester1";
const DEV = "dev1";
const GROUP = "app_testing_official";

// ---------------------------------------------------------------------------
// Fake Firestore — records every write so "wrote nothing" is provable
// ---------------------------------------------------------------------------

function snapshot(path, data) {
  return {
    id: path.split("/").pop(),
    ref: { path },
    exists: data !== undefined,
    data: () => data,
    get: (field) => (data === undefined ? undefined : data[field]),
  };
}

function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed));
  const writes = [];

  function matchingDocs(collection, filters) {
    const prefix = `${collection}/`;
    return [...store.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .filter(([, data]) => filters.every(([f, v]) => data[f] === v))
      .map(([p, data]) => ({ path: p, data }));
  }

  function collectionRef(name, filters = []) {
    const ref = {
      __query: { collection: name, filters },
      where: (f, op, v) => collectionRef(name, [...filters, [f, v]]),
      count: () => ({ __count: { collection: name, filters } }),
      orderBy: () => ref,
      limit: () => ref,
      get: async () => {
        const rows = matchingDocs(name, filters);
        return { empty: rows.length === 0, size: rows.length, docs: rows.map((r) => snapshot(r.path, r.data)) };
      },
    };
    return ref;
  }

  const db = {
    doc: (path) => ({ path, get: async () => snapshot(path, store.get(path)) }),
    collection: collectionRef,
    getAll: async (...refs) => refs.map((r) => snapshot(r.path, store.get(r.path))),
    // Any write at all is recorded. A batch or transaction that touches
    // `testingAssignments` outside the claim path shows up here.
    batch: () => ({
      create: (ref, data) => writes.push({ op: "create", path: ref.path, data }),
      set: (ref, data) => writes.push({ op: "set", path: ref.path, data }),
      update: (ref, data) => writes.push({ op: "update", path: ref.path, data }),
      commit: async () => {
        for (const w of writes) store.set(w.path, { ...(store.get(w.path) || {}), ...w.data });
      },
    }),
    async runTransaction(fn) {
      const staged = [];
      const tx = {
        get: async (target) => {
          if (target && target.__count) {
            return { data: () => ({ count: matchingDocs(target.__count.collection, target.__count.filters).length }) };
          }
          if (target && target.__query) {
            const rows = matchingDocs(target.__query.collection, target.__query.filters);
            return { empty: rows.length === 0, size: rows.length, docs: rows.map((r) => snapshot(r.path, r.data)) };
          }
          return snapshot(target.path, store.get(target.path));
        },
        create: (ref, data) => staged.push({ op: "create", path: ref.path, data }),
        set: (ref, data) => staged.push({ op: "set", path: ref.path, data }),
        update: (ref, data) => staged.push({ op: "update", path: ref.path, data }),
        delete: (ref) => staged.push({ op: "delete", path: ref.path }),
      };
      const result = await fn(tx);
      for (const w of staged) {
        writes.push(w);
        if (w.op === "delete") store.delete(w.path);
        else if (w.op === "create" || w.op === "set") store.set(w.path, { ...w.data });
        else store.set(w.path, { ...(store.get(w.path) || {}), ...w.data });
      }
      return result;
    },
  };

  db.__writes = writes;
  db.__read = (p) => store.get(p);
  db.__has = (p) => store.has(p);
  db.__store = store;
  return db;
}

/** An approved app with a populated testing group and a funded tester. */
function world({ available = 50, extra = {} } = {}) {
  return {
    [`users/${DEV}`]: { uid: DEV },
    [`users/${TESTER}`]: { uid: TESTER },
    "users/tester2": { uid: "tester2" },
    [`apps/${APP}`]: { ownerId: DEV, status: "approved", appName: "App One", testerCount: 0 },
    [`groups/${GROUP}/members/${TESTER}`]: { joinedAt: { toMillis: () => 1000 } },
    [`groups/${GROUP}/members/tester2`]: { joinedAt: { toMillis: () => 2000 } },
    [`users/${TESTER}/wallet/balance`]: {
      available,
      locked: 0,
      forfeitedTotal: 0,
      purchasedTotal: 0,
      adjustmentNet: available,
      ledgerCount: 1,
      schemaVersion: 2,
    },
    ...extra,
  };
}

const assignmentWrites = (db) =>
  db.__writes.filter((w) => w.path.startsWith("testingAssignments/"));

// ---------------------------------------------------------------------------
// Test 1 — legacy matching cannot create a coin-backed commitment
// ---------------------------------------------------------------------------

test("Test 1: the legacy allocation callable no longer exists", () => {
  // The old names are gone from every surface, not merely unused. A caller
  // that still invokes `createTestingAssignments` gets a missing-function
  // error rather than silently creating an unfunded assignment.
  assert.equal(assignments.runMatching, undefined, "runMatching must be gone");
  assert.equal(
    assignments.createTestingAssignments,
    undefined,
    "createTestingAssignments must be gone",
  );
  assert.equal(index.createTestingAssignments, undefined, "must not be deployed");
  assert.equal(typeof index.previewEligibleTesters, "function", "replaced by a read-only preview");
});

test("Test 1: the eligibility preview writes absolutely nothing", async () => {
  const db = fakeDb(world());
  const result = await assignments.runEligibilityPreview(db, { appId: APP });

  // It still does the useful work — it identifies eligible testers.
  assert.ok(result.eligibleCount >= 1, "the preview must still find eligible testers");
  assert.ok(result.eligible.includes(TESTER));
  assert.equal(result.slotsRemaining > 0, true);

  // And it creates nothing whatsoever.
  assert.deepEqual(db.__writes, [], "the preview must not write any document");
  assert.deepEqual(assignmentWrites(db), [], "no assignment may be created");
  assert.equal(db.__has(`testingAssignments/${APP}__${TESTER}`), false);
  assert.equal(db.__has(`testingAssignments/${cycleAssignmentId(APP, TESTER, 1)}`), false);
});

test("Test 1: the preview leaves the wallet and the tester count untouched", async () => {
  const db = fakeDb(world({ available: 500 }));
  const walletBefore = { ...db.__read(`users/${TESTER}/wallet/balance`) };
  const appBefore = { ...db.__read(`apps/${APP}`) };

  await assignments.runEligibilityPreview(db, { appId: APP });

  assert.deepEqual(db.__read(`users/${TESTER}/wallet/balance`), walletBefore);
  assert.deepEqual(db.__read(`apps/${APP}`), appBefore, "testerCount must not move");
  assert.equal(db.__has(`activeClaims/${activeClaimId(APP, TESTER)}`), false);
  assert.equal(
    db.__has(`users/${TESTER}/coinTransactions/${lockEntryId(cycleAssignmentId(APP, TESTER, 1))}`),
    false,
    "no lock ledger entry",
  );
});

test("Test 1: running the preview repeatedly still creates nothing", async () => {
  const db = fakeDb(world());
  for (let i = 0; i < 5; i += 1) await assignments.runEligibilityPreview(db, { appId: APP });
  assert.deepEqual(db.__writes, []);
});

// ---------------------------------------------------------------------------
// Test 2 — no live commitment without joinTestingAssignment
// ---------------------------------------------------------------------------

test("Test 2: the claim path is the only exported way to create an assignment", () => {
  // Every module that could plausibly own assignment creation is checked, so
  // adding a second creator somewhere obvious trips this.
  const callables = Object.keys(index).filter((k) => typeof index[k] === "function" || index[k]);
  const creators = callables.filter((name) =>
    /^(create|assign|match|allocate)/i.test(name),
  );
  assert.deepEqual(creators, [], `no allocation-style callable may be exported: ${creators}`);
  assert.equal(
    typeof index.joinTestingAssignment,
    "function",
    "the claim callable is exported",
  );
});

test("Test 2: the preview produces no assignment the settlement path could settle", async () => {
  const db = fakeDb(world());
  await assignments.runEligibilityPreview(db, { appId: APP });

  // Nothing to settle, because nothing was created — the specific failure this
  // guards against is settlement "returning" coins that were never staked.
  const all = [...db.__store.keys()].filter((k) => k.startsWith("testingAssignments/"));
  assert.deepEqual(all, []);
});

test("Test 2: a commitment only appears after the claim path runs", async () => {
  const db = fakeDb(world({ available: 50 }));

  // Preview first: still nothing.
  await assignments.runEligibilityPreview(db, { appId: APP });
  assert.equal(db.__read(`users/${TESTER}/wallet/balance`).locked, 0);

  // Claim: now, and only now, a commitment exists and coins move.
  const outcome = await commitments.runClaimCommitment(db, { appId: APP, testerId: TESTER });
  assert.equal(outcome.claimed, true);
  assert.equal(db.__read(`users/${TESTER}/wallet/balance`).locked, 50);
  assert.equal(db.__read(`users/${TESTER}/wallet/balance`).available, 0);
});

// ---------------------------------------------------------------------------
// Test 3 — every new cycle assignment is fully coin-backed
// ---------------------------------------------------------------------------

test("Test 3: a claimed assignment has a cycle id, stake, lock, claim and ledger entry", async () => {
  const db = fakeDb(world({ available: 50 }));
  const outcome = await commitments.runClaimCommitment(db, { appId: APP, testerId: TESTER });

  const assignmentId = outcome.assignmentId;
  const a = db.__read(`testingAssignments/${assignmentId}`);

  // (a) cycle-scoped id
  assert.equal(assignmentId, cycleAssignmentId(APP, TESTER, 1));
  assert.equal(cycleOf(assignmentId), 1);
  assert.equal(a.cycle, 1);

  // (b) commitmentAmount = 50
  assert.equal(a.commitmentAmount, DEFAULT_COMMITMENT_AMOUNT);
  assert.equal(a.commitmentAmount, 50);

  // (c) lockTxId
  assert.equal(a.lockTxId, lockEntryId(assignmentId));
  assert.equal(a.settlementTxId, null);

  // (d) a corresponding activeClaim
  const claim = db.__read(`activeClaims/${activeClaimId(APP, TESTER)}`);
  assert.ok(claim, "an active claim must exist");
  assert.equal(claim.assignmentId, assignmentId);
  assert.equal(claim.testerId, TESTER);
  assert.equal(claim.cycle, 1);

  // (e) a corresponding immutable lock ledger entry
  const entry = db.__read(`users/${TESTER}/coinTransactions/${a.lockTxId}`);
  assert.ok(entry, "a lock ledger entry must exist");
  assert.equal(entry.kind, "lock");
  assert.equal(entry.source, "commitment");
  assert.equal(entry.amount, 50);
  assert.equal(entry.deltaAvailable, -50);
  assert.equal(entry.deltaLocked, 50);
  assert.equal(entry.assignmentId, assignmentId);
  const entryWrite = db.__writes.find((w) => w.path.endsWith(a.lockTxId));
  assert.equal(entryWrite.op, "create", "the ledger entry must be immutable (create, not set)");

  // and the wallet is sound afterwards
  assert.equal(checkInvariants(db.__read(`users/${TESTER}/wallet/balance`)).ok, true);
});

test("Test 3: every assignment that exists after a claim is coin-backed", async () => {
  const db = fakeDb(world({ available: 100 }));
  await commitments.runClaimCommitment(db, { appId: APP, testerId: TESTER });

  // The invariant this whole change protects: no assignment without a lock.
  const all = [...db.__store.entries()].filter(([k]) => k.startsWith("testingAssignments/"));
  assert.equal(all.length, 1);
  for (const [id, data] of all) {
    assert.ok(data.lockTxId, `${id} must carry a lock transaction`);
    assert.ok(data.commitmentAmount > 0, `${id} must carry a stake`);
    assert.ok(
      db.__has(`users/${data.testerId}/coinTransactions/${data.lockTxId}`),
      `${id}'s lock entry must actually exist`,
    );
  }
});

// ---------------------------------------------------------------------------
// Test 4 — legacy assignments stay readable but inert
// ---------------------------------------------------------------------------

const LEGACY_ID = `${APP}__${TESTER}`;

function legacyWorld(extra = {}) {
  return world({
    available: 0,
    extra: {
      // Exactly what push-matching used to write: no lockTxId, no cycle.
      [`testingAssignments/${LEGACY_ID}`]: {
        appId: APP,
        testerId: TESTER,
        developerId: DEV,
        daysRequired: 14,
        daysCompleted: 14,
        commitmentAmount: 50,
        status: "inProgress",
      },
      ...extra,
    },
  });
}

test("Test 4: a legacy assignment is still readable and keeps its data", async () => {
  const db = fakeDb(legacyWorld());
  const legacy = db.__read(`testingAssignments/${LEGACY_ID}`);
  assert.ok(legacy, "legacy documents remain in place");
  assert.equal(legacy.commitmentAmount, 50);
  assert.equal(legacy.lockTxId, undefined, "but it never had a lock");
  assert.equal(cycleOf(LEGACY_ID), 0, "and reads as cycle 0");
});

test("Test 4: a legacy assignment cannot unlock coins on completion", async () => {
  const { runCompletionVerification } = require("../completion");
  const db = fakeDb(
    legacyWorld({
      "users/admin1": { uid: "admin1", role: "admin" },
      ...Object.fromEntries(
        Array.from({ length: 14 }, (_, i) => [
          `testingLogs/${LEGACY_ID}__2026-09-${String(i + 1).padStart(2, "0")}`,
          { assignmentId: LEGACY_ID, testerId: TESTER },
        ]),
      ),
    }),
  );

  const outcome = await runCompletionVerification(db, {
    assignmentId: LEGACY_ID,
    adminUid: "admin1",
  });

  assert.equal(outcome.verified, true, "it still completes as a record of work");
  assert.equal(outcome.settled, false, "but settles no coins");
  assert.equal(outcome.unlockedAmount, 0);

  const wallet = db.__read(`users/${TESTER}/wallet/balance`);
  assert.equal(wallet.available, 0, "nothing was returned, because nothing was staked");
  assert.equal(wallet.locked, 0);
  const ledger = [...db.__store.keys()].filter((k) =>
    k.startsWith(`users/${TESTER}/coinTransactions/`),
  );
  assert.deepEqual(ledger, [], "no unlock entry may be minted for a legacy assignment");
});

test("Test 4: a legacy assignment cannot be forfeited", async () => {
  const db = fakeDb(legacyWorld());
  await assert.rejects(
    commitments.runForfeitCommitment(db, {
      assignmentId: LEGACY_ID,
      actorId: "system",
      actorKind: "system",
    }),
    /no committed coins to forfeit/,
  );
  assert.equal(db.__read(`users/${TESTER}/wallet/balance`).forfeitedTotal, 0);
});

test("Test 4: a legacy assignment blocks a new claim while it is open, then yields", async () => {
  // Open: it is an unfinished obligation, so a second live commitment on the
  // same app must not start.
  const open = fakeDb(legacyWorld());
  open.__store.set(`users/${TESTER}/wallet/balance`, {
    available: 50, locked: 0, forfeitedTotal: 0, purchasedTotal: 0,
    adjustmentNet: 50, ledgerCount: 1, schemaVersion: 2,
  });
  await assert.rejects(
    commitments.runClaimCommitment(open, { appId: APP, testerId: TESTER }),
    /unfinished assignment/,
  );

  // Closed: it must NOT block a fresh cycle, and the fresh cycle gets cycle 1
  // because the legacy id reads as cycle 0.
  const closed = fakeDb(legacyWorld());
  closed.__store.set(`testingAssignments/${LEGACY_ID}`, {
    ...closed.__read(`testingAssignments/${LEGACY_ID}`),
    status: "completed",
  });
  closed.__store.set(`users/${TESTER}/wallet/balance`, {
    available: 50, locked: 0, forfeitedTotal: 0, purchasedTotal: 0,
    adjustmentNet: 50, ledgerCount: 1, schemaVersion: 2,
  });
  const outcome = await commitments.runClaimCommitment(closed, { appId: APP, testerId: TESTER });
  assert.equal(outcome.cycle, 1);
  assert.equal(outcome.assignmentId, cycleAssignmentId(APP, TESTER, 1));
  // The legacy document is untouched history.
  assert.equal(closed.__read(`testingAssignments/${LEGACY_ID}`).status, "completed");
});

// ---------------------------------------------------------------------------
// Test 5 — the eligibility predicates survived, and still mean the same thing
// ---------------------------------------------------------------------------

test("Test 5: selectTesters survived and still encodes the four eligibility rules", () => {
  // Kept rather than deleted: these are the same predicates
  // `checkClaimEligible` enforces at claim time.
  assert.equal(typeof matching.selectTesters, "function");
  const { selected, skipped } = matching.selectTesters({
    candidates: [
      { uid: "ok", joinedAtMillis: 1, isSuspended: false, exists: true },
      { uid: "ghost", joinedAtMillis: 2, isSuspended: false, exists: false },
      { uid: "banned", joinedAtMillis: 3, isSuspended: true, exists: true },
      { uid: DEV, joinedAtMillis: 4, isSuspended: false, exists: true },
      { uid: "taken", joinedAtMillis: 5, isSuspended: false, exists: true },
    ],
    ownerId: DEV,
    alreadyAssignedTesterIds: ["taken"],
    remainingSlots: 10,
    maxThisRun: 10,
  });
  assert.deepEqual(selected, ["ok"]);
  assert.deepEqual(
    skipped.map((s) => s.reason).sort(),
    ["alreadyAssigned", "appOwner", "noUserDocument", "suspended"],
  );
});

test("Test 5: the legacy id generator is gone from the matching module", () => {
  assert.equal(matching.assignmentIdFor, undefined);
  assert.deepEqual(Object.keys(matching), ["selectTesters"]);
});

test("Test 5: the tester cap survived the retirement and is enforced at claim time", async () => {
  // Push-matching used to enforce REQUIRED_TESTER_COUNT before creating
  // assignments. With it gone, losing the cap silently would let unlimited
  // testers stake coins on one app.
  const { REQUIRED_TESTER_COUNT } = require("../lib/constants");
  const db = fakeDb(
    world({
      available: 500,
      extra: {
        [`apps/${APP}`]: {
          ownerId: DEV,
          status: "approved",
          appName: "App One",
          testerCount: REQUIRED_TESTER_COUNT,
        },
      },
    }),
  );

  await assert.rejects(
    commitments.runClaimCommitment(db, { appId: APP, testerId: TESTER }),
    /all the testers it needs/,
  );
  assert.equal(db.__read(`users/${TESTER}/wallet/balance`).locked, 0, "no coins may be staked");
  assert.deepEqual(assignmentWrites(db), []);
});

test("Test 5: a successful claim advances the app's tester count", async () => {
  const db = fakeDb(world({ available: 50 }));
  assert.equal(db.__read(`apps/${APP}`).testerCount, 0);
  await commitments.runClaimCommitment(db, { appId: APP, testerId: TESTER });
  assert.equal(
    db.__read(`apps/${APP}`).testerCount,
    1,
    "the counter push-matching used to own is now maintained by the claim",
  );
});

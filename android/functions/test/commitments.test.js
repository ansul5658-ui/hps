/**
 * Commitment lifecycle tests.
 *
 * Two halves:
 *
 *   1. The pure decision table in `lib/commitments.js` - cycle identity,
 *      claim eligibility, unlock eligibility, forfeit eligibility. These are
 *      the rules that decide whether real coins move, so every branch is
 *      exercised directly rather than only through the transaction.
 *
 *   2. The transactions in `commitments.js`, driven through a fake Firestore
 *      that models document versions, optimistic-concurrency retries, `create`
 *      refusing to overwrite, transaction queries and a real aggregate count.
 *      A test that cannot fail when the transaction is wrong would be worse
 *      than no test on a money path.
 *
 * The emulator counterpart (test-emulator/commitments.concurrency.test.js)
 * runs the same production functions against a real Firestore, because a fake
 * can only prove the code matches my model of Firestore, not that the model is
 * right.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { FieldValue } = require("firebase-admin/firestore");

const {
  runClaimCommitment,
  joinTestingAssignmentImpl,
  runForfeitCommitment,
  adminForfeitCommitmentImpl,
} = require("../commitments");
const {
  cycleAssignmentId,
  activeClaimId,
  lockEntryId,
  unlockEntryId,
  forfeitEntryId,
  cycleOf,
  nextCycle,
  isTerminalStatus,
  checkClaimEligible,
  checkUnlockEligible,
  checkForfeitEligible,
  windowDeadlineMillis,
  MILLIS_PER_DAY,
} = require("../lib/commitments");
const { runCompletionVerification } = require("../completion");
const { checkInvariants } = require("../lib/wallet");
const {
  DEFAULT_COMMITMENT_AMOUNT,
  COMMITMENT_DAYS_REQUIRED,
  COMMITMENT_WINDOW_DAYS,
  MAX_COMMITMENT_AMOUNT,
} = require("../lib/constants");

const APP = "app1";
const TESTER = "tester1";
const ADMIN = "admin1";
const DEV = "dev1";
const WALLET_PATH = `users/${TESTER}/wallet/balance`;
const CLAIM_PATH = `activeClaims/${activeClaimId(APP, TESTER)}`;
const C1 = cycleAssignmentId(APP, TESTER, 1);
const C1_PATH = `testingAssignments/${C1}`;
const LOCK_PATH = `users/${TESTER}/coinTransactions/${lockEntryId(C1)}`;

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
    store.set(path, {
      data: { ...(rec ? rec.data : {}), ...data },
      version: (rec ? rec.version : 0) + 1,
    });
  }

  function matching(collection, filters) {
    const prefix = `${collection}/`;
    return [...store.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
      .filter(([, rec]) => filters.every(([field, value]) => rec.data[field] === value))
      .map(([p, rec]) => ({ path: p, id: p.slice(prefix.length), rec }));
  }

  function collectionRef(name, filters = []) {
    return {
      __query: { collection: name, filters },
      where(field, op, value) {
        return collectionRef(name, [...filters, [field, value]]);
      },
      count() {
        return { __count: { collection: name, filters } };
      },
    };
  }

  const db = {
    doc: (path) => ({
      path,
      get: async () => snapshot(path, store.get(path)),
    }),
    collection: (name) => collectionRef(name),

    async runTransaction(fn) {
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        state.attempts += 1;
        const reads = new Map();
        const writes = [];

        const tx = {
          async get(target) {
            if (target && target.__count) {
              const { collection, filters } = target.__count;
              return { data: () => ({ count: matching(collection, filters).length }) };
            }
            if (target && target.__query) {
              const { collection, filters } = target.__query;
              const rows = matching(collection, filters);
              // A transaction query locks what it matched.
              for (const r of rows) reads.set(r.path, r.rec.version);
              return {
                empty: rows.length === 0,
                size: rows.length,
                docs: rows.map((r) => snapshot(r.path, r.rec)),
              };
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

        // A throw here escapes before anything is applied — no partial writes.
        const result = await fn(tx);

        if (opts.beforeCommit) opts.beforeCommit({ attempt, bump, store });

        const conflicted = [...reads].some(([path, version]) => {
          const rec = store.get(path);
          return (rec ? rec.version : 0) !== version;
        });
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
          if (w.kind === "delete") {
            store.delete(w.path);
          } else if (w.kind === "create" || w.kind === "set") {
            store.set(w.path, { data: { ...w.data }, version: (rec ? rec.version : 0) + 1 });
          } else {
            store.set(w.path, {
              data: { ...(rec ? rec.data : {}), ...w.data },
              version: (rec ? rec.version : 0) + 1,
            });
          }
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
  db.__read = (path) => {
    const rec = store.get(path);
    return rec ? rec.data : undefined;
  };
  db.__has = (path) => store.has(path);
  return db;
}

/** A tester with `available` coins, an approved app, and no claim. */
function world({ available = 50, locked = 0, forfeitedTotal = 0, extra = {} } = {}) {
  const seed = {
    [`users/${ADMIN}`]: { uid: ADMIN, role: "admin" },
    [`users/${TESTER}`]: { uid: TESTER },
    [`users/${DEV}`]: { uid: DEV },
    "apps/app1": { ownerId: DEV, status: "approved", appName: "App One" },
    ...extra,
  };
  if (available !== null) {
    seed[WALLET_PATH] = {
      available,
      locked,
      forfeitedTotal,
      purchasedTotal: 0,
      adjustmentNet: available + locked + forfeitedTotal,
      ledgerCount: 1,
      lastEntryId: "grant_seed",
      schemaVersion: 2,
    };
  }
  return seed;
}

const claim = (db, { appId = APP, testerId = TESTER } = {}) =>
  runClaimCommitment(db, { appId, testerId });

async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err.code;
  }
}

function assertWalletSound(db, path = WALLET_PATH) {
  const w = db.__read(path);
  assert.ok(w, "wallet must exist");
  const check = checkInvariants(w);
  assert.equal(check.ok, true, check.errors.join("; "));
}

// ---------------------------------------------------------------------------
// Pure: cycle identity
// ---------------------------------------------------------------------------

test("assignment ids are cycle-scoped and deterministic", () => {
  assert.equal(cycleAssignmentId("app1", "t1", 1), "app1__t1__c1");
  assert.equal(cycleAssignmentId("app1", "t1", 2), "app1__t1__c2");
  // The claim id is deliberately NOT cycle-scoped — it is the uniqueness guard.
  assert.equal(activeClaimId("app1", "t1"), "app1__t1");
});

test("ledger ids are namespaced per movement and per cycle", () => {
  assert.equal(lockEntryId("app1__t1__c1"), "lock_app1__t1__c1");
  assert.equal(unlockEntryId("app1__t1__c1"), "unlock_app1__t1__c1");
  assert.equal(forfeitEntryId("app1__t1__c1"), "forfeit_app1__t1__c1");
  // A second cycle gets entirely distinct ids, which is the whole point.
  assert.notEqual(lockEntryId("app1__t1__c1"), lockEntryId("app1__t1__c2"));
});

test("a reward-era id reads as cycle 0 so the first commitment is cycle 1", () => {
  assert.equal(cycleOf("app1__t1"), 0);
  assert.equal(cycleOf("app1__t1__c3"), 3);
  assert.equal(cycleOf(undefined), 0);
  assert.equal(nextCycle([]), 1);
  assert.equal(nextCycle(["app1__t1"]), 1, "a legacy doc must not collide with cycle 1");
});

test("the next cycle is always above every existing one", () => {
  assert.equal(nextCycle(["app1__t1__c1"]), 2);
  assert.equal(nextCycle(["app1__t1__c1", "app1__t1__c2"]), 3);
  // Out of order, and with a legacy document mixed in.
  assert.equal(nextCycle(["app1__t1__c2", "app1__t1", "app1__t1__c1"]), 3);
});

test("terminal statuses are exactly the settled ones", () => {
  for (const s of ["completed", "failed", "missed", "cancelled"]) {
    assert.equal(isTerminalStatus(s), true, s);
  }
  for (const s of ["ready", "inProgress", "waitingForVerification", undefined]) {
    assert.equal(isTerminalStatus(s), false, String(s));
  }
});

// ---------------------------------------------------------------------------
// Pure: claim eligibility
// ---------------------------------------------------------------------------

const claimBase = {
  appExists: true,
  appStatus: "approved",
  appOwnerId: DEV,
  testerId: TESTER,
  isSuspended: false,
  hasActiveClaim: false,
  openAssignmentStatus: null,
  availableCoins: 50,
  commitmentAmount: 50,
};

test("a well-formed claim is eligible", () => {
  assert.equal(checkClaimEligible(claimBase).ok, true);
});

test("claim is refused for suspension, missing app, unapproved app and self-test", () => {
  assert.equal(checkClaimEligible({ ...claimBase, isSuspended: true }).code, "permission-denied");
  assert.equal(checkClaimEligible({ ...claimBase, appExists: false }).code, "not-found");
  for (const status of ["pendingReview", "rejected", "archived", undefined]) {
    assert.equal(
      checkClaimEligible({ ...claimBase, appStatus: status }).code,
      "failed-precondition",
      String(status),
    );
  }
  assert.equal(
    checkClaimEligible({ ...claimBase, appOwnerId: TESTER }).code,
    "failed-precondition",
    "a developer must not stake coins on their own app",
  );
});

test("claim is refused when a claim or an unfinished assignment already exists", () => {
  assert.equal(checkClaimEligible({ ...claimBase, hasActiveClaim: true }).code, "already-exists");
  for (const status of ["ready", "inProgress", "waitingForVerification"]) {
    assert.equal(
      checkClaimEligible({ ...claimBase, openAssignmentStatus: status }).code,
      "already-exists",
      status,
    );
  }
  // A finished cycle must NOT block a new one.
  for (const status of ["completed", "failed", "missed", "cancelled"]) {
    assert.equal(
      checkClaimEligible({ ...claimBase, openAssignmentStatus: status }).ok,
      true,
      status,
    );
  }
});

test("claim is refused below the commitment amount, and allowed exactly at it", () => {
  assert.equal(checkClaimEligible({ ...claimBase, availableCoins: 49 }).ok, false);
  assert.equal(checkClaimEligible({ ...claimBase, availableCoins: 0 }).ok, false);
  assert.equal(checkClaimEligible({ ...claimBase, availableCoins: 50 }).ok, true);
  assert.equal(checkClaimEligible({ ...claimBase, availableCoins: 51 }).ok, true);
  // Non-integers are refused rather than coerced.
  for (const bad of [undefined, null, "50", 50.5, NaN]) {
    assert.equal(checkClaimEligible({ ...claimBase, availableCoins: bad }).ok, false, String(bad));
  }
});

test("an absurd commitment amount is refused", () => {
  for (const bad of [0, -50, 1.5, MAX_COMMITMENT_AMOUNT + 1, "50", undefined]) {
    assert.equal(
      checkClaimEligible({ ...claimBase, commitmentAmount: bad }).ok,
      false,
      String(bad),
    );
  }
});

// ---------------------------------------------------------------------------
// Pure: unlock eligibility
// ---------------------------------------------------------------------------

test("unlock requires a lock, a live status and the full day count", () => {
  const base = { status: "inProgress", daysRequired: 14, qualifyingDays: 14, lockTxId: "lock_x" };
  assert.equal(checkUnlockEligible(base).ok, true);

  for (const status of ["completed", "failed", "missed", "cancelled"]) {
    assert.equal(checkUnlockEligible({ ...base, status }).ok, false, status);
  }
  assert.equal(
    checkUnlockEligible({ ...base, lockTxId: null }).ok,
    false,
    "nothing to return when nothing was staked",
  );
  assert.equal(checkUnlockEligible({ ...base, qualifyingDays: 13 }).ok, false);
  assert.equal(checkUnlockEligible({ ...base, qualifyingDays: 15 }).ok, true);
  assert.equal(checkUnlockEligible({ ...base, daysRequired: 0 }).ok, false);
});

// ---------------------------------------------------------------------------
// Pure: forfeit eligibility — the narrowest gate in the system
// ---------------------------------------------------------------------------

const DAY0 = 1_700_000_000_000;
const forfeitBase = {
  status: "inProgress",
  lockTxId: "lock_x",
  createdAtMillis: DAY0,
  windowDays: COMMITMENT_WINDOW_DAYS,
  daysRequired: COMMITMENT_DAYS_REQUIRED,
  qualifyingDays: 3,
  nowMillis: DAY0 + 19 * MILLIS_PER_DAY,
};

test("an expired, short commitment may be forfeited", () => {
  assert.equal(checkForfeitEligible(forfeitBase).ok, true);
});

test("forfeiture is refused before the window has actually elapsed", () => {
  // One millisecond early is still early.
  const deadline = windowDeadlineMillis(DAY0, COMMITMENT_WINDOW_DAYS);
  assert.equal(checkForfeitEligible({ ...forfeitBase, nowMillis: deadline - 1 }).ok, false);
  assert.equal(checkForfeitEligible({ ...forfeitBase, nowMillis: deadline }).ok, true);
  assert.equal(checkForfeitEligible({ ...forfeitBase, nowMillis: DAY0 }).ok, false);
});

test("forfeiture is refused when the requirement was actually met", () => {
  // The tester did the work and nobody settled it. They are owed their coins,
  // not a forfeiture — even though the window has closed.
  const met = { ...forfeitBase, qualifyingDays: COMMITMENT_DAYS_REQUIRED };
  assert.equal(met.nowMillis > windowDeadlineMillis(DAY0, COMMITMENT_WINDOW_DAYS), true);
  assert.equal(checkForfeitEligible(met).ok, false);
  assert.match(checkForfeitEligible(met).message, /completed, not forfeited/);
});

test("forfeiture is refused for terminal, unlocked or undated assignments", () => {
  for (const status of ["completed", "failed", "missed", "cancelled"]) {
    assert.equal(checkForfeitEligible({ ...forfeitBase, status }).ok, false, status);
  }
  assert.equal(checkForfeitEligible({ ...forfeitBase, lockTxId: null }).ok, false);
  assert.equal(checkForfeitEligible({ ...forfeitBase, createdAtMillis: 0 }).ok, false);
});

test("forfeiture takes no input a failed request or an offline device could set", () => {
  // The contract, asserted structurally: the decision function's parameters
  // are exactly the assignment's own recorded state plus the server clock.
  // If someone adds "clientSaysMissed" or "requestFailed" here, this fails.
  const allowed = [
    "status",
    "lockTxId",
    "createdAtMillis",
    "windowDays",
    "daysRequired",
    "qualifyingDays",
    "nowMillis",
  ].sort();
  assert.deepEqual(Object.keys(forfeitBase).sort(), allowed);
});

// ---------------------------------------------------------------------------
// Claim transaction
// ---------------------------------------------------------------------------

test("a claim locks exactly the commitment amount and writes five documents", async () => {
  const db = fakeDb(world({ available: 50 }));
  const outcome = await claim(db);

  assert.equal(outcome.claimed, true);
  assert.equal(outcome.assignmentId, C1);
  assert.equal(outcome.cycle, 1);
  assert.equal(outcome.commitmentAmount, DEFAULT_COMMITMENT_AMOUNT);

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 0, "available must drop by exactly the stake");
  assert.equal(wallet.locked, 50);
  assert.equal(wallet.forfeitedTotal, 0);
  assertWalletSound(db);

  // Five, not four: the app's tester counter moved here when push-matching was
  // retired, because the claim path is now the only place that knows a tester
  // joined — and reading that counter inside this transaction is what enforces
  // the tester cap.
  const paths = [...new Set(db.__committed.map((w) => w.path))].sort();
  assert.deepEqual(
    paths,
    [CLAIM_PATH, C1_PATH, LOCK_PATH, WALLET_PATH, `apps/${APP}`].sort(),
  );
  assert.equal(db.__read(`apps/${APP}`).testerCount, 1);
});

test("the assignment records the full commitment contract", async () => {
  const db = fakeDb(world());
  await claim(db);

  const a = db.__read(C1_PATH);
  assert.equal(a.appId, APP);
  assert.equal(a.testerId, TESTER);
  assert.equal(a.developerId, DEV);
  assert.equal(a.cycle, 1);
  assert.equal(a.commitmentAmount, 50);
  assert.equal(a.daysRequired, COMMITMENT_DAYS_REQUIRED);
  assert.equal(a.windowDays, COMMITMENT_WINDOW_DAYS);
  assert.equal(a.qualifyingDays, 0);
  assert.equal(a.status, "ready");
  assert.equal(a.lockTxId, lockEntryId(C1));
  assert.equal(a.settlementTxId, null);
  assert.deepStrictEqual(a.createdAt, FieldValue.serverTimestamp());
});

test("the lock ledger entry carries derived deltas and full provenance", async () => {
  const db = fakeDb(world());
  await claim(db);

  const e = db.__read(LOCK_PATH);
  assert.equal(e.kind, "lock");
  assert.equal(e.source, "commitment");
  assert.equal(e.amount, 50);
  assert.equal(e.deltaAvailable, -50);
  assert.equal(e.deltaLocked, 50);
  assert.equal(e.deltaForfeited, 0);
  assert.equal(e.assignmentId, C1);
  assert.equal(e.appId, APP);
  assert.equal(e.actorId, TESTER);
  assert.equal(e.actorKind, "user");
  assert.equal(e.paymentRef, null);
  assert.equal(e.schemaVersion, 2);

  const write = db.__committed.find((w) => w.path === LOCK_PATH);
  assert.equal(write.kind, "create", "an immutable entry must never be written with set");
});

test("the active claim is created, not set, so a racing claim collides", async () => {
  const db = fakeDb(world());
  await claim(db);
  const write = db.__committed.find((w) => w.path === CLAIM_PATH);
  assert.equal(write.kind, "create");
  assert.equal(db.__read(CLAIM_PATH).assignmentId, C1);
});

test("a claim with exactly 49 coins is refused and leaves no trace", async () => {
  const db = fakeDb(world({ available: 49 }));
  assert.equal(await codeOf(claim(db)), "failed-precondition");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 49, "balance must be untouched");
  assert.equal(wallet.locked, 0);
  assert.equal(wallet.forfeitedTotal, 0);
  assert.equal(db.__has(C1_PATH), false, "no assignment");
  assert.equal(db.__has(CLAIM_PATH), false, "no active claim");
  assert.equal(db.__has(LOCK_PATH), false, "no ledger entry");
  assert.equal(db.__committed.length, 0);
});

test("a claim with no wallet at all is refused", async () => {
  const db = fakeDb(world({ available: null }));
  assert.equal(await codeOf(claim(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("a second claim while one is active is refused", async () => {
  const db = fakeDb(world({ available: 100 }));
  await claim(db);
  assert.equal(await codeOf(claim(db)), "already-exists");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 50, "the second claim must not lock more");
  assert.equal(wallet.locked, 50);
  assert.equal(db.__has(cycleAssignmentId(APP, TESTER, 2)), false);
});

test("an unfinished assignment blocks a claim even with the claim doc missing", async () => {
  // Defence in depth: if the active claim were ever lost, a live assignment
  // must still stop a second commitment.
  const db = fakeDb(
    world({
      available: 100,
      extra: {
        [C1_PATH]: { appId: APP, testerId: TESTER, status: "inProgress", lockTxId: "lock_x" },
      },
    }),
  );
  assert.equal(await codeOf(claim(db)), "already-exists");
  assert.equal(db.__committed.length, 0);
});

test("a finished cycle does not block the next one, which gets a new id", async () => {
  const db = fakeDb(
    world({
      available: 50,
      extra: {
        [C1_PATH]: {
          appId: APP,
          testerId: TESTER,
          status: "completed",
          lockTxId: lockEntryId(C1),
          settlementTxId: unlockEntryId(C1),
        },
      },
    }),
  );
  const outcome = await claim(db);
  assert.equal(outcome.cycle, 2);
  assert.equal(outcome.assignmentId, cycleAssignmentId(APP, TESTER, 2));
  // The first cycle's history is untouched.
  assert.equal(db.__read(C1_PATH).status, "completed");
  assertWalletSound(db);
});

test("a reward-era assignment does not collide with cycle 1", async () => {
  const db = fakeDb(
    world({
      available: 50,
      extra: {
        [`testingAssignments/${APP}__${TESTER}`]: {
          appId: APP,
          testerId: TESTER,
          status: "completed",
          coinReward: 50,
        },
      },
    }),
  );
  const outcome = await claim(db);
  assert.equal(outcome.cycle, 1, "a legacy doc is cycle 0, so the first real cycle is 1");
  assert.equal(db.__has(C1_PATH), true);
});

test("a suspended tester cannot claim", async () => {
  const db = fakeDb(world({ extra: { [`users/${TESTER}`]: { uid: TESTER, isSuspended: true } } }));
  assert.equal(await codeOf(claim(db)), "permission-denied");
  assert.equal(db.__committed.length, 0);
});

test("a developer cannot claim their own app", async () => {
  const db = fakeDb(
    world({ extra: { [`users/${DEV}`]: { uid: DEV } , [`users/${DEV}/wallet/balance`]: {
      available: 100, locked: 0, forfeitedTotal: 0, purchasedTotal: 0, adjustmentNet: 100,
      ledgerCount: 1, schemaVersion: 2,
    } } }),
  );
  assert.equal(await codeOf(claim(db, { testerId: DEV })), "failed-precondition");
});

test("an unapproved app cannot be claimed", async () => {
  for (const status of ["pendingReview", "rejected", "archived"]) {
    const db = fakeDb(world({ extra: { "apps/app1": { ownerId: DEV, status } } }));
    assert.equal(await codeOf(claim(db)), "failed-precondition", status);
    assert.equal(db.__committed.length, 0);
  }
});

test("the caller cannot supply the amount, the tester or the deltas", async () => {
  const db = fakeDb(world({ available: 50 }));
  const outcome = await joinTestingAssignmentImpl(db, {
    auth: { uid: TESTER },
    data: {
      appId: APP,
      commitmentAmount: 1,
      amount: 1,
      testerId: ADMIN,
      deltaAvailable: 1000,
      deltaLocked: -1000,
      cycle: 99,
      lockTxId: "forged",
    },
  });
  assert.equal(outcome.commitmentAmount, 50, "the server's amount, not the caller's");
  assert.equal(outcome.cycle, 1, "the server's cycle, not the caller's");
  assert.equal(outcome.assignmentId, C1);

  const e = db.__read(LOCK_PATH);
  assert.equal(e.deltaAvailable, -50);
  assert.equal(e.deltaLocked, 50);
  assert.equal(e.userId, TESTER, "the verified uid, never a field in the request");
  assert.equal(db.__read(WALLET_PATH).locked, 50);
});

test("an unauthenticated caller cannot claim", async () => {
  const db = fakeDb(world());
  assert.equal(await codeOf(joinTestingAssignmentImpl(db, { data: { appId: APP } })), "unauthenticated");
  assert.equal(db.__committed.length, 0);
});

test("a malformed appId is rejected before anything is read", async () => {
  const db = fakeDb(world());
  for (const appId of [undefined, null, "", 42, "a/b", "..", "__x__"]) {
    assert.equal(
      await codeOf(joinTestingAssignmentImpl(db, { auth: { uid: TESTER }, data: { appId } })),
      "invalid-argument",
      String(appId),
    );
  }
  assert.equal(db.__committed.length, 0);
});

test("two sequential claims on one balance: the second is refused", async () => {
  const db = fakeDb(world({ available: 50, extra: { "apps/app2": { ownerId: DEV, status: "approved" } } }));
  await claim(db, { appId: APP });
  assert.equal(await codeOf(claim(db, { appId: "app2" })), "failed-precondition");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 0);
  assert.equal(wallet.locked, 50, "only one commitment may hold the 50");
  assertWalletSound(db);
});

// ---------------------------------------------------------------------------
// Completion / unlock
// ---------------------------------------------------------------------------

/** A claimed commitment with `logs` qualifying days recorded. */
function claimedWorld({ logs = 14, status = "inProgress", available = 0, locked = 50 } = {}) {
  const seed = world({ available, locked });
  seed[C1_PATH] = {
    appId: APP,
    testerId: TESTER,
    developerId: DEV,
    cycle: 1,
    commitmentAmount: 50,
    daysRequired: COMMITMENT_DAYS_REQUIRED,
    windowDays: COMMITMENT_WINDOW_DAYS,
    qualifyingDays: logs,
    daysCompleted: logs,
    status,
    lockTxId: lockEntryId(C1),
    settlementTxId: null,
    createdAt: { toMillis: () => DAY0 },
  };
  seed[CLAIM_PATH] = { assignmentId: C1, appId: APP, testerId: TESTER, cycle: 1 };
  for (let i = 0; i < logs; i += 1) {
    const day = `2026-09-${String(i + 1).padStart(2, "0")}`;
    seed[`testingLogs/${C1}__${day}`] = { assignmentId: C1, testerId: TESTER, date: day };
  }
  return seed;
}

const verify = (db, assignmentId = C1) =>
  runCompletionVerification(db, { assignmentId, adminUid: ADMIN });

test("completing a commitment returns the SAME coins and adds nothing", async () => {
  const db = fakeDb(claimedWorld({ logs: 14 }));
  const outcome = await verify(db);

  assert.equal(outcome.verified, true);
  assert.equal(outcome.settled, true);
  assert.equal(outcome.unlockedAmount, 50);

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 50, "the stake comes back");
  assert.equal(wallet.locked, 0);
  assert.equal(wallet.forfeitedTotal, 0);
  // The decisive assertion: no coins were created.
  assert.equal(wallet.adjustmentNet, 50);
  assert.equal(wallet.purchasedTotal, 0);
  assertWalletSound(db);
});

test("completion writes an unlock entry, stamps settlement and drops the claim", async () => {
  const db = fakeDb(claimedWorld());
  await verify(db);

  const unlockPath = `users/${TESTER}/coinTransactions/${unlockEntryId(C1)}`;
  const e = db.__read(unlockPath);
  assert.equal(e.kind, "unlock");
  assert.equal(e.source, "completion");
  assert.equal(e.deltaAvailable, 50);
  assert.equal(e.deltaLocked, -50);
  assert.equal(e.assignmentId, C1);

  const a = db.__read(C1_PATH);
  assert.equal(a.status, "completed");
  assert.equal(a.settlementTxId, unlockEntryId(C1));
  assert.equal(a.qualifyingDays, 14);

  assert.equal(db.__has(CLAIM_PATH), false, "the claim must be released");
});

test("a repeated completion never returns the coins twice", async () => {
  const db = fakeDb(claimedWorld());
  await verify(db);
  const after = db.__read(WALLET_PATH);

  for (let i = 0; i < 3; i += 1) {
    const repeat = await verify(db);
    assert.equal(repeat.verified, false);
    assert.equal(repeat.reason, "alreadyCompleted");
  }
  assert.deepEqual(db.__read(WALLET_PATH), after, "the wallet must not move again");
  assert.equal(db.__read(WALLET_PATH).available, 50, "50, never 100");
});

test("completion is refused short of the requirement, and nothing moves", async () => {
  const db = fakeDb(claimedWorld({ logs: 13 }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 0);
  assert.equal(wallet.locked, 50, "the coins stay committed");
  assert.equal(db.__has(CLAIM_PATH), true, "the claim survives a refused settlement");
  assert.equal(db.__read(C1_PATH).status, "inProgress");
});

test("a cached qualifyingDays cannot buy a settlement the logs do not support", async () => {
  const seed = claimedWorld({ logs: 2 });
  // The cached counter lies; the logs are the authority.
  seed[C1_PATH].qualifyingDays = 14;
  seed[C1_PATH].daysCompleted = 14;
  const db = fakeDb(seed);

  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__read(WALLET_PATH).locked, 50);
});

test("a reward-era assignment still completes with no coin movement", async () => {
  // Batch 2 behaviour, preserved: no lockTxId means nothing was staked.
  const legacyId = `${APP}__${TESTER}`;
  const seed = world({ available: 0, locked: 0 });
  seed[`testingAssignments/${legacyId}`] = {
    appId: APP,
    testerId: TESTER,
    daysRequired: 14,
    status: "waitingForVerification",
    coinReward: 50,
  };
  for (let i = 0; i < 14; i += 1) {
    const day = `2026-09-${String(i + 1).padStart(2, "0")}`;
    seed[`testingLogs/${legacyId}__${day}`] = { assignmentId: legacyId, testerId: TESTER, date: day };
  }
  const db = fakeDb(seed);

  const outcome = await verify(db, legacyId);
  assert.equal(outcome.verified, true);
  assert.equal(outcome.settled, false, "nothing was staked, so nothing is returned");
  assert.equal(outcome.unlockedAmount, 0);
  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 0);
  assert.equal(wallet.locked, 0);
});

// ---------------------------------------------------------------------------
// Forfeit
// ---------------------------------------------------------------------------

/** A commitment whose window has closed with only `logs` days recorded. */
function expiredWorld({ logs = 3 } = {}) {
  const seed = claimedWorld({ logs, available: 0, locked: 50 });
  // Started long enough ago that the 18-day window has certainly elapsed.
  seed[C1_PATH].createdAt = { toMillis: () => Date.now() - 30 * MILLIS_PER_DAY };
  return seed;
}

const forfeit = (db, assignmentId = C1) =>
  runForfeitCommitment(db, { assignmentId, actorId: "system", actorKind: "system" });

test("an expired short commitment forfeits the whole stake", async () => {
  const db = fakeDb(expiredWorld({ logs: 3 }));
  const outcome = await forfeit(db);

  assert.equal(outcome.forfeited, true);
  assert.equal(outcome.amount, 50);

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 0, "no partial refund");
  assert.equal(wallet.locked, 0);
  assert.equal(wallet.forfeitedTotal, 50);
  assertWalletSound(db);

  const e = db.__read(`users/${TESTER}/coinTransactions/${forfeitEntryId(C1)}`);
  assert.equal(e.kind, "forfeit");
  assert.equal(e.source, "failure");
  assert.equal(e.deltaLocked, -50);
  assert.equal(e.deltaForfeited, 50);

  const a = db.__read(C1_PATH);
  assert.equal(a.status, "failed");
  assert.equal(a.settlementTxId, forfeitEntryId(C1));
  assert.equal(db.__has(CLAIM_PATH), false, "the claim must be released");
});

test("forfeiture is refused while the window is still open", async () => {
  const seed = claimedWorld({ logs: 1 });
  seed[C1_PATH].createdAt = { toMillis: () => Date.now() - 2 * MILLIS_PER_DAY };
  const db = fakeDb(seed);

  assert.equal(await codeOf(forfeit(db)), "failed-precondition");
  assert.equal(db.__read(WALLET_PATH).locked, 50, "the coins stay committed");
  assert.equal(db.__committed.length, 0);
});

test("forfeiture is refused when the tester actually met the requirement", async () => {
  const db = fakeDb(expiredWorld({ logs: 14 }));
  assert.equal(await codeOf(forfeit(db)), "failed-precondition");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.locked, 50);
  assert.equal(wallet.forfeitedTotal, 0, "work that was done must never be forfeited");
});

test("a cached qualifyingDays of 0 cannot force a forfeiture the logs disprove", async () => {
  const seed = expiredWorld({ logs: 14 });
  seed[C1_PATH].qualifyingDays = 0;
  seed[C1_PATH].daysCompleted = 0;
  const db = fakeDb(seed);

  assert.equal(await codeOf(forfeit(db)), "failed-precondition");
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0);
});

test("a forfeited commitment cannot be forfeited again", async () => {
  const db = fakeDb(expiredWorld({ logs: 2 }));
  await forfeit(db);
  const after = db.__read(WALLET_PATH);

  assert.equal(await codeOf(forfeit(db)), "failed-precondition");
  assert.deepEqual(db.__read(WALLET_PATH), after, "the wallet must not move twice");
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 50, "50, never 100");
});

test("a completed commitment cannot then be forfeited", async () => {
  const db = fakeDb(claimedWorld({ logs: 14 }));
  await verify(db);
  assert.equal(await codeOf(forfeit(db)), "failed-precondition");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 50);
  assert.equal(wallet.forfeitedTotal, 0);
});

test("a non-admin cannot forfeit", async () => {
  const db = fakeDb(expiredWorld({ logs: 1 }));
  await assert.rejects(
    adminForfeitCommitmentImpl(db, { auth: { uid: TESTER }, data: { assignmentId: C1 } }),
    /Admin privileges are required/,
  );
  assert.equal(db.__read(WALLET_PATH).locked, 50);
  assert.equal(db.__committed.length, 0);
});

test("an admin cannot forfeit a commitment that is not genuinely expired", async () => {
  // Admin authority does not override the state check.
  const seed = claimedWorld({ logs: 1 });
  seed[C1_PATH].createdAt = { toMillis: () => Date.now() };
  const db = fakeDb(seed);

  await assert.rejects(
    adminForfeitCommitmentImpl(db, { auth: { uid: ADMIN }, data: { assignmentId: C1 } }),
    /window has not closed/,
  );
  assert.equal(db.__read(WALLET_PATH).forfeitedTotal, 0);
});

// ---------------------------------------------------------------------------
// The invariant across the whole lifecycle
// ---------------------------------------------------------------------------

test("the wallet invariant holds after claim, and after each settlement", async () => {
  // Success path.
  const ok = fakeDb(world({ available: 50 }));
  await claim(ok);
  assertWalletSound(ok);

  const done = fakeDb(claimedWorld({ logs: 14 }));
  await verify(done);
  assertWalletSound(done);

  // Failure path.
  const lost = fakeDb(expiredWorld({ logs: 2 }));
  await forfeit(lost);
  assertWalletSound(lost);
});

test("locked always equals the stake of the one live commitment", async () => {
  const db = fakeDb(world({ available: 50 }));
  await claim(db);
  assert.equal(db.__read(WALLET_PATH).locked, db.__read(C1_PATH).commitmentAmount);

  // And drops to zero once the commitment is no longer live.
  const settled = fakeDb(claimedWorld({ logs: 14 }));
  await verify(settled);
  assert.equal(settled.__read(WALLET_PATH).locked, 0);
  assert.equal(settled.__has(CLAIM_PATH), false);
});

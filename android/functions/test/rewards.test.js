/**
 * Completion-reward tests.
 *
 * This is the only code path in the project that creates coins, so the fake
 * below models the parts of Firestore the payment actually depends on —
 * document versions, optimistic-concurrency retries, and `create` refusing to
 * overwrite — rather than just recording calls. A test that cannot fail when
 * the transaction is wrong would be worse than no test here.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { FieldValue } = require("firebase-admin/firestore");

const {
  runCompletionVerification,
  verifyAssignmentCompletion,
} = require("../rewards");
const { completionLedgerId, checkCompletionEligible } = require("../lib/rewards");
const { MAX_SINGLE_REWARD } = require("../lib/constants");

const ASSIGNMENT_ID = "app1__tester1";
const ASSIGNMENT_PATH = `testingAssignments/${ASSIGNMENT_ID}`;
const LEDGER_PATH = `users/tester1/coinTransactions/done_${ASSIGNMENT_ID}`;
const TESTER_PATH = "users/tester1";

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

/**
 * @param seed  map of document path -> data
 * @param opts.beforeCommit  hook run after the transaction body and before the
 *        conflict check, so a test can simulate a racing writer
 */
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

  const db = {
    doc(path) {
      return {
        path,
        // Non-transactional read — this is what lib/guards.js uses.
        async get() {
          return snapshot(path, store.get(path));
        },
      };
    },

    collection(name) {
      return {
        where(field, op, value) {
          return { count: () => ({ __count: { collection: name, field, value } }) };
        },
      };
    },

    async runTransaction(fn) {
      const maxAttempts = 5;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        state.attempts += 1;

        const reads = new Map();
        const writes = [];
        const tx = {
          async get(target) {
            if (target && target.__count) {
              const { collection, field, value } = target.__count;
              let count = 0;
              for (const [path, rec] of store) {
                if (path.startsWith(`${collection}/`) && rec.data[field] === value) count += 1;
              }
              return { data: () => ({ count }) };
            }
            const rec = store.get(target.path);
            reads.set(target.path, rec ? rec.version : 0);
            return snapshot(target.path, rec);
          },
          create(ref, data) {
            writes.push({ kind: "create", path: ref.path, data });
          },
          update(ref, data) {
            writes.push({ kind: "update", path: ref.path, data });
          },
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
          if (w.kind === "create") {
            store.set(w.path, { data: { ...w.data }, version: 1 });
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
  db.__bump = bump;
  return db;
}

/**
 * The realistic production shape: the tester's document has NO `isSuspended`
 * and NO `coinBalance`, because nothing has ever written them (verified
 * against live data). The reward must work anyway.
 */
function world({
  status = "waitingForVerification",
  coinReward = 50,
  daysRequired = 14,
  daysCompleted = 14,
  logs = 14,
  tester = { uid: "tester1" },
  assignmentOverrides = {},
  extra = {},
} = {}) {
  const seed = {
    "users/admin1": { uid: "admin1", role: "admin" },
    [TESTER_PATH]: tester,
    [ASSIGNMENT_PATH]: {
      appId: "app1",
      testerId: "tester1",
      developerId: "dev1",
      groupId: "g1",
      daysRequired,
      daysCompleted,
      coinReward,
      status,
      ...assignmentOverrides,
    },
    ...extra,
  };
  for (let i = 0; i < logs; i += 1) {
    const day = `2026-09-${String(i + 1).padStart(2, "0")}`;
    seed[`testingLogs/${ASSIGNMENT_ID}__${day}`] = {
      assignmentId: ASSIGNMENT_ID,
      testerId: "tester1",
      date: day,
    };
  }
  return seed;
}

function verify(db, { adminUid = "admin1", assignmentId = ASSIGNMENT_ID } = {}) {
  return runCompletionVerification(db, { assignmentId, adminUid });
}

async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err.code;
  }
}

const writesTo = (db, path) => db.__committed.filter((w) => w.path === path);
const balanceWrites = (db) =>
  db.__committed.filter((w) => w.path === TESTER_PATH && "coinBalance" in w.data);

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test("the ledger id is deterministic and derived from the assignment", () => {
  assert.equal(completionLedgerId("app1__tester1"), "done_app1__tester1");
  assert.equal(completionLedgerId("app1__tester1"), completionLedgerId("app1__tester1"));
});

test("eligibility accepts exactly the approved verifiable states", () => {
  const base = { daysRequired: 14, loggedDays: 14, coinReward: 50 };
  assert.equal(checkCompletionEligible({ ...base, status: "waitingForVerification" }).ok, true);
  assert.equal(checkCompletionEligible({ ...base, status: "inProgress" }).ok, true);
  for (const status of ["ready", "completed", "missed", undefined]) {
    assert.equal(checkCompletionEligible({ ...base, status }).ok, false);
  }
});

test("a missing or non-positive day requirement can never be satisfied", () => {
  const base = { status: "inProgress", loggedDays: 0, coinReward: 50 };
  for (const daysRequired of [undefined, null, 0, -1, 1.5, "14"]) {
    assert.equal(checkCompletionEligible({ ...base, daysRequired }).ok, false);
  }
});

test("eligibility rejects any reward that is not a sane positive integer", () => {
  const base = { status: "inProgress", daysRequired: 1, loggedDays: 1 };
  for (const coinReward of [undefined, null, 0, -50, 1.5, "50", MAX_SINGLE_REWARD + 1, NaN]) {
    assert.equal(checkCompletionEligible({ ...base, coinReward }).ok, false);
  }
  assert.equal(checkCompletionEligible({ ...base, coinReward: MAX_SINGLE_REWARD }).ok, true);
});

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("a valid verification awards exactly the assignment's reward", async () => {
  const db = fakeDb(world());
  const outcome = await verify(db);

  assert.deepEqual(outcome, {
    assignmentId: ASSIGNMENT_ID,
    awarded: true,
    amount: 50,
    testerId: "tester1",
  });
});

test("the assignment is marked completed with full verification audit", async () => {
  const db = fakeDb(world());
  await verify(db);

  const updates = writesTo(db, ASSIGNMENT_PATH);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].kind, "update");
  assert.equal(updates[0].data.status, "completed");
  assert.equal(updates[0].data.verifiedBy, "admin1");
  assert.deepStrictEqual(updates[0].data.completedAt, FieldValue.serverTimestamp());
  assert.deepStrictEqual(updates[0].data.updatedAt, FieldValue.serverTimestamp());
  // The reward amount is never rewritten by the payment.
  assert.equal("coinReward" in updates[0].data, false);
});

test("exactly one immutable ledger entry is created, with full audit fields", async () => {
  const db = fakeDb(world());
  await verify(db);

  const entries = writesTo(db, LEDGER_PATH);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "create"); // never "update" — history is append-only
  assert.deepEqual(
    { ...entries[0].data, createdAt: "<sentinel>" },
    {
      userId: "tester1",
      amount: 50,
      kind: "earn",
      source: "assignmentCompletion",
      reason: "Completed testing for app1",
      relatedAssignmentId: ASSIGNMENT_ID,
      actorId: "admin1",
      recordedByAdmin: true,
      createdAt: "<sentinel>",
    },
  );
  assert.deepStrictEqual(entries[0].data.createdAt, FieldValue.serverTimestamp());
});

test("the balance is incremented exactly once, server-side", async () => {
  const db = fakeDb(world());
  await verify(db);

  const writes = balanceWrites(db);
  assert.equal(writes.length, 1);
  // A transform, not a read-modify-write: a plain number here would mean the
  // balance was computed from a value that could already be stale.
  assert.equal(typeof writes[0].data.coinBalance, "object");
  assert.deepStrictEqual(writes[0].data.coinBalance, FieldValue.increment(50));
});

test("a tester whose document has no coinBalance or isSuspended is still paid", async () => {
  // This is the actual shape of every production user document today.
  const db = fakeDb(world({ tester: { uid: "tester1" } }));
  const outcome = await verify(db);
  assert.equal(outcome.awarded, true);
  assert.equal(balanceWrites(db).length, 1);
});

test("all three writes commit together", async () => {
  const db = fakeDb(world());
  await verify(db);
  assert.equal(db.__committed.length, 3);
  assert.deepEqual(
    db.__committed.map((w) => `${w.kind} ${w.path}`).sort(),
    [
      `create ${LEDGER_PATH}`,
      `update ${ASSIGNMENT_PATH}`,
      `update ${TESTER_PATH}`,
    ].sort(),
  );
});

test("an assignment may also be verified straight from inProgress", async () => {
  const db = fakeDb(world({ status: "inProgress" }));
  assert.equal((await verify(db)).awarded, true);
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("verifying an already completed assignment is a harmless no-op", async () => {
  const db = fakeDb(world());
  await verify(db);
  const before = db.__committed.length;

  const second = await verify(db);
  assert.deepEqual(second, {
    assignmentId: ASSIGNMENT_ID,
    awarded: false,
    reason: "alreadyCompleted",
  });
  assert.equal(db.__committed.length, before, "a repeat verification wrote something");
});

test("an existing ledger entry blocks a second reward even if the status was reset", async () => {
  const db = fakeDb(
    world({
      extra: { [LEDGER_PATH]: { userId: "tester1", amount: 50, kind: "earn" } },
    }),
  );

  const outcome = await verify(db);
  assert.deepEqual(outcome, {
    assignmentId: ASSIGNMENT_ID,
    awarded: false,
    reason: "alreadyAwarded",
  });
  assert.equal(db.__committed.length, 0);
});

test("ten repeat verifications still produce exactly one reward", async () => {
  const db = fakeDb(world());
  for (let i = 0; i < 10; i += 1) await verify(db);
  assert.equal(writesTo(db, LEDGER_PATH).length, 1);
  assert.equal(balanceWrites(db).length, 1);
});

test("two simultaneous verifications produce exactly one reward", async () => {
  // The racing admin commits the whole reward between our reads and our commit.
  const db = fakeDb(world(), {
    beforeCommit({ attempt, bump, store }) {
      if (attempt !== 1) return;
      bump(ASSIGNMENT_PATH, { status: "completed" });
      store.set(LEDGER_PATH, { data: { userId: "tester1", amount: 50 }, version: 1 });
    },
  });

  const outcome = await verify(db);
  assert.equal(outcome.awarded, false);
  assert.equal(outcome.reason, "alreadyCompleted");
  assert.equal(db.__state.attempts, 2, "the stale read should have forced a retry");
  assert.equal(db.__committed.length, 0, "the loser of the race must write nothing");
});

test("a transaction retry re-runs the body and still awards exactly once", async () => {
  const db = fakeDb(world(), {
    beforeCommit({ attempt, bump }) {
      // A benign concurrent write to a document we read invalidates attempt 1.
      if (attempt === 1) bump(TESTER_PATH, { displayName: "Renamed" });
    },
  });

  const outcome = await verify(db);
  assert.equal(outcome.awarded, true);
  assert.equal(db.__state.attempts, 2, "the body should have re-run");
  assert.equal(writesTo(db, LEDGER_PATH).length, 1);
  assert.equal(balanceWrites(db).length, 1);
});

test("create refuses to overwrite an existing ledger entry", async () => {
  // Belt and braces: even with the existence guard bypassed, `create` must
  // fail the transaction rather than silently replace paid history.
  const db = fakeDb(world());
  const ledgerRef = db.doc(LEDGER_PATH);
  await assert.rejects(
    db.runTransaction(async (tx) => {
      db.__store.set(LEDGER_PATH, { data: { amount: 50 }, version: 1 });
      tx.create(ledgerRef, { amount: 50 });
    }),
    (err) => err.code === 6,
  );
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("an unauthenticated caller is rejected before anything is read", async () => {
  const db = fakeDb(world());
  assert.equal(await codeOf(verifyAssignmentCompletion(db, { data: {} })), "unauthenticated");
  assert.equal(db.__committed.length, 0);
});

test("a non-admin cannot verify", async () => {
  for (const role of ["member", "moderator", undefined]) {
    const db = fakeDb(world({ extra: { "users/u1": { uid: "u1", role } } }));
    const request = { auth: { uid: "u1" }, data: { assignmentId: ASSIGNMENT_ID } };
    assert.equal(await codeOf(verifyAssignmentCompletion(db, request)), "permission-denied");
    assert.equal(db.__committed.length, 0);
  }
});

test("a caller with no profile document cannot verify", async () => {
  const db = fakeDb(world());
  const request = { auth: { uid: "ghost" }, data: { assignmentId: ASSIGNMENT_ID } };
  assert.equal(await codeOf(verifyAssignmentCompletion(db, request)), "permission-denied");
  assert.equal(db.__committed.length, 0);
});

test("a suspended admin cannot verify", async () => {
  const db = fakeDb(
    world({ extra: { "users/admin1": { uid: "admin1", role: "admin", isSuspended: true } } }),
  );
  const request = { auth: { uid: "admin1" }, data: { assignmentId: ASSIGNMENT_ID } };
  assert.equal(await codeOf(verifyAssignmentCompletion(db, request)), "permission-denied");
  assert.equal(db.__committed.length, 0);
});

test("a malformed assignment id is rejected", async () => {
  const db = fakeDb(world());
  for (const assignmentId of [undefined, "", 42, "a/b", "__proto__x__", null]) {
    const request = { auth: { uid: "admin1" }, data: { assignmentId } };
    assert.equal(await codeOf(verifyAssignmentCompletion(db, request)), "invalid-argument");
  }
  assert.equal(db.__committed.length, 0);
});

test("an admin cannot verify their own assignment", async () => {
  const db = fakeDb(
    world({
      assignmentOverrides: { testerId: "admin1" },
      extra: { "users/admin1": { uid: "admin1", role: "admin" } },
    }),
  );
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

// ---------------------------------------------------------------------------
// Assignment and tester preconditions
// ---------------------------------------------------------------------------

test("a nonexistent assignment is rejected", async () => {
  const db = fakeDb(world());
  assert.equal(await codeOf(verify(db, { assignmentId: "nope" })), "not-found");
  assert.equal(db.__committed.length, 0);
});

test("an assignment in a non-verifiable state is rejected", async () => {
  for (const status of ["ready", "missed", "archived"]) {
    const db = fakeDb(world({ status }));
    assert.equal(await codeOf(verify(db)), "failed-precondition");
    assert.equal(db.__committed.length, 0);
  }
});

test("an assignment with no status at all is rejected", async () => {
  const seed = world();
  delete seed[ASSIGNMENT_PATH].status;
  const db = fakeDb(seed);
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("an assignment with no valid tester is rejected", async () => {
  for (const testerId of [undefined, "", 7, "a/b"]) {
    const db = fakeDb(world({ assignmentOverrides: { testerId } }));
    assert.equal(await codeOf(verify(db)), "failed-precondition");
    assert.equal(db.__committed.length, 0);
  }
});

test("a missing tester profile is rejected", async () => {
  const seed = world();
  delete seed[TESTER_PATH];
  const db = fakeDb(seed);
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("a suspended tester is never paid", async () => {
  const db = fakeDb(world({ tester: { uid: "tester1", isSuspended: true } }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

// ---------------------------------------------------------------------------
// Day count — the logs are the authority, not the cached counter
// ---------------------------------------------------------------------------

test("an assignment without enough logged days is rejected", async () => {
  const db = fakeDb(world({ logs: 13 }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("a cached daysCompleted that overstates progress cannot buy a reward", async () => {
  // daysCompleted claims the work is done; only 3 logs actually exist.
  const db = fakeDb(world({ daysCompleted: 14, logs: 3 }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("a cached daysCompleted that understates progress does not block a reward", async () => {
  const db = fakeDb(world({ daysCompleted: 0, logs: 14 }));
  assert.equal((await verify(db)).awarded, true);
});

test("logs belonging to another assignment do not count", async () => {
  const seed = world({ logs: 10 });
  for (let i = 0; i < 10; i += 1) {
    seed[`testingLogs/other__tester1__2026-09-${String(i + 1).padStart(2, "0")}`] = {
      assignmentId: "other__tester1",
      testerId: "tester1",
    };
  }
  const db = fakeDb(seed);
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("extra logged days beyond the requirement are fine", async () => {
  const db = fakeDb(world({ logs: 20 }));
  assert.equal((await verify(db)).awarded, true);
});

// ---------------------------------------------------------------------------
// Reward amount integrity
// ---------------------------------------------------------------------------

test("a missing coinReward is rejected rather than defaulted to 50", async () => {
  const seed = world();
  delete seed[ASSIGNMENT_PATH].coinReward;
  const db = fakeDb(seed);
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("a zero, negative, fractional or non-numeric coinReward is rejected", async () => {
  for (const coinReward of [0, -50, 1.5, "50", null]) {
    const db = fakeDb(world({ coinReward }));
    assert.equal(await codeOf(verify(db)), "failed-precondition");
    assert.equal(db.__committed.length, 0);
  }
});

test("a coinReward above the safety bound is rejected", async () => {
  const db = fakeDb(world({ coinReward: MAX_SINGLE_REWARD + 1 }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("the ledger amount always equals the assignment's own coinReward", async () => {
  const db = fakeDb(world({ coinReward: 75 }));
  const outcome = await verify(db);

  assert.equal(outcome.amount, 75);
  assert.equal(writesTo(db, LEDGER_PATH)[0].data.amount, 75);
  assert.deepStrictEqual(balanceWrites(db)[0].data.coinBalance, FieldValue.increment(75));
});

test("a caller cannot influence the amount, the tester or the day count", async () => {
  const db = fakeDb(world());
  const request = {
    auth: { uid: "admin1" },
    data: {
      assignmentId: ASSIGNMENT_ID,
      amount: 9999,
      coinReward: 9999,
      testerId: "attacker",
      daysRequired: 0,
      loggedDays: 999,
    },
  };

  const outcome = await verifyAssignmentCompletion(db, request);
  assert.equal(outcome.amount, 50);
  assert.equal(outcome.testerId, "tester1");
  assert.equal(writesTo(db, LEDGER_PATH)[0].data.amount, 50);
  assert.equal(writesTo(db, `users/attacker/coinTransactions/done_${ASSIGNMENT_ID}`).length, 0);
});

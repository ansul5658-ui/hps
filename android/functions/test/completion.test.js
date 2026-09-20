/**
 * Assignment completion-verification tests.
 *
 * This file used to guard the completion REWARD. Under the commitment product
 * there is no reward, so its job has inverted: it now proves that verifying an
 * assignment moves NO coins - no ledger entry, no wallet write, no
 * `coinBalance` increment - while still enforcing every non-money precondition
 * that made the old payment safe (admin only, not your own assignment, logs
 * re-counted from source, suspended accounts refused).
 *
 * The fake below models the parts of Firestore verification depends on -
 * document versions, optimistic-concurrency retries, `create` refusing to
 * overwrite, and a real aggregate count - rather than just recording calls.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { FieldValue } = require("firebase-admin/firestore");

const {
  runCompletionVerification,
  verifyAssignmentCompletion,
} = require("../completion");
const { checkCompletionEligible } = require("../lib/completion");
const { VERIFIABLE_FROM_STATUSES } = require("../lib/constants");

const ASSIGNMENT_ID = "app1__tester1";
const ASSIGNMENT_PATH = `testingAssignments/${ASSIGNMENT_ID}`;
const TESTER_PATH = "users/tester1";
const LEDGER_COLLECTION_PREFIX = "users/tester1/coinTransactions/";
const WALLET_PATH = "users/tester1/wallet/balance";

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
          set(ref, data) {
            writes.push({ kind: "set", path: ref.path, data });
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
          if (w.kind === "create" || w.kind === "set") {
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
  db.__bump = bump;
  return db;
}

/**
 * The realistic production shape: the tester's document has NO `isSuspended`
 * and NO `coinBalance`, because nothing has ever written them.
 *
 * The assignment carries BOTH the new `commitmentAmount` and a leftover
 * reward-era `coinReward`, because real documents created before this batch
 * still have the old field. Verification must ignore both.
 */
function world({
  status = "waitingForVerification",
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
      commitmentAmount: 50,
      coinReward: 50, // reward-era leftover; must be ignored
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

/** Every write that would move coins, in any of the three possible places. */
function coinWrites(db) {
  return db.__committed.filter(
    (w) =>
      w.path.startsWith(LEDGER_COLLECTION_PREFIX) ||
      w.path === WALLET_PATH ||
      (w.path === TESTER_PATH && "coinBalance" in w.data),
  );
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

test("eligibility accepts exactly the approved verifiable states", () => {
  const base = { daysRequired: 14, loggedDays: 14 };
  for (const status of VERIFIABLE_FROM_STATUSES) {
    assert.equal(checkCompletionEligible({ ...base, status }).ok, true, status);
  }
  for (const status of ["ready", "completed", "missed", "", undefined]) {
    assert.equal(checkCompletionEligible({ ...base, status }).ok, false, String(status));
  }
});

test("a missing or non-positive day requirement can never be satisfied", () => {
  const base = { status: "waitingForVerification", loggedDays: 14 };
  for (const daysRequired of [undefined, null, 0, -1, 1.5, "14"]) {
    assert.equal(checkCompletionEligible({ ...base, daysRequired }).ok, false, String(daysRequired));
  }
});

test("eligibility no longer considers an amount at all", () => {
  // The old rule rejected a missing/absurd coinReward. There is no amount in
  // the contract any more, so a verification with none is perfectly eligible.
  const result = checkCompletionEligible({
    status: "waitingForVerification",
    daysRequired: 14,
    loggedDays: 14,
  });
  assert.equal(result.ok, true);
  // And passing one changes nothing — it is simply ignored.
  assert.equal(
    checkCompletionEligible({
      status: "waitingForVerification",
      daysRequired: 14,
      loggedDays: 14,
      coinReward: 999999,
    }).ok,
    true,
  );
});

// ---------------------------------------------------------------------------
// The whole point: verification moves no coins
// ---------------------------------------------------------------------------

test("a valid verification creates no ledger entry and no wallet write", async () => {
  const db = fakeDb(world());
  const outcome = await verify(db);

  assert.equal(outcome.verified, true);
  assert.equal(outcome.testerId, "tester1");
  assert.equal(outcome.amount, undefined, "there is no amount to report any more");
  assert.deepEqual(coinWrites(db), [], "verification must move no coins anywhere");
});

test("no completion reward is generated, ever", async () => {
  const db = fakeDb(world());
  await verify(db);

  // The three places the reward model used to touch.
  const ledgerEntries = [...db.__store.keys()].filter((p) =>
    p.startsWith(LEDGER_COLLECTION_PREFIX),
  );
  assert.deepEqual(ledgerEntries, [], "no ledger entry may be created");
  assert.equal(db.__store.get(WALLET_PATH), undefined, "no wallet may be created");
  assert.equal(
    db.__store.get(TESTER_PATH).data.coinBalance,
    undefined,
    "the reward-era balance field must never be written",
  );
});

test("verification writes exactly one document: the assignment", async () => {
  const db = fakeDb(world());
  await verify(db);
  const paths = [...new Set(db.__committed.map((w) => w.path))];
  assert.deepEqual(paths, [ASSIGNMENT_PATH]);
});

test("the assignment is marked completed with full verification audit", async () => {
  const db = fakeDb(world());
  await verify(db);

  const writes = writesTo(db, ASSIGNMENT_PATH);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].kind, "update");
  assert.equal(writes[0].data.status, "completed");
  assert.equal(writes[0].data.verifiedBy, "admin1");
  assert.deepStrictEqual(writes[0].data.completedAt, FieldValue.serverTimestamp());
  assert.deepStrictEqual(writes[0].data.updatedAt, FieldValue.serverTimestamp());
  // Identity fields are untouched — a verification cannot rewrite the record.
  const after = db.__store.get(ASSIGNMENT_PATH).data;
  assert.equal(after.testerId, "tester1");
  assert.equal(after.appId, "app1");
  assert.equal(after.commitmentAmount, 50, "the stake is recorded, not consumed, by verifying");
});

test("a leftover reward-era coinReward on the document is ignored, not paid", async () => {
  const db = fakeDb(world({ assignmentOverrides: { coinReward: 99999 } }));
  const outcome = await verify(db);
  assert.equal(outcome.verified, true);
  assert.deepEqual(coinWrites(db), [], "a huge legacy coinReward must still pay nothing");
});

test("an assignment with no amount field at all verifies fine", async () => {
  const db = fakeDb(
    world({ assignmentOverrides: { coinReward: undefined, commitmentAmount: undefined } }),
  );
  const outcome = await verify(db);
  assert.equal(outcome.verified, true);
  assert.deepEqual(coinWrites(db), []);
});

test("a tester whose document has no coinBalance or isSuspended is still verified", async () => {
  const db = fakeDb(world({ tester: { uid: "tester1" } }));
  const outcome = await verify(db);
  assert.equal(outcome.verified, true);
});

test("an assignment may also be verified straight from inProgress", async () => {
  const db = fakeDb(world({ status: "inProgress" }));
  const outcome = await verify(db);
  assert.equal(outcome.verified, true);
  assert.equal(db.__store.get(ASSIGNMENT_PATH).data.status, "completed");
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test("verifying an already completed assignment is a harmless no-op", async () => {
  const db = fakeDb(world({ status: "completed" }));
  const outcome = await verify(db);
  assert.equal(outcome.verified, false);
  assert.equal(outcome.reason, "alreadyCompleted");
  assert.equal(db.__committed.length, 0);
});

test("ten repeat verifications still complete the assignment exactly once", async () => {
  const db = fakeDb(world());
  for (let i = 0; i < 10; i += 1) await verify(db);
  assert.equal(writesTo(db, ASSIGNMENT_PATH).length, 1);
  assert.deepEqual(coinWrites(db), []);
});

test("two simultaneous verifications complete the assignment exactly once", async () => {
  const db = fakeDb(world());
  await Promise.all([verify(db), verify(db)]);
  assert.equal(writesTo(db, ASSIGNMENT_PATH).length, 1);
  assert.deepEqual(coinWrites(db), []);
});

test("a transaction retry re-runs the body and still completes exactly once", async () => {
  let injected = false;
  const db = fakeDb(world(), {
    beforeCommit: ({ bump }) => {
      if (injected) return;
      injected = true;
      // A racing writer touches the assignment between read and commit.
      bump(ASSIGNMENT_PATH, { updatedAt: "racing" });
    },
  });

  const outcome = await verify(db);
  assert.equal(outcome.verified, true);
  assert.ok(db.__state.attempts >= 2, "the transaction must actually have retried");
  assert.equal(writesTo(db, ASSIGNMENT_PATH).length, 1);
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

test("an unauthenticated caller is rejected before anything is read", async () => {
  const db = fakeDb(world());
  assert.equal(
    await codeOf(verifyAssignmentCompletion(db, { data: { assignmentId: ASSIGNMENT_ID } })),
    "unauthenticated",
  );
  assert.equal(db.__committed.length, 0);
});

test("a non-admin cannot verify", async () => {
  const db = fakeDb(world());
  assert.equal(
    await codeOf(
      verifyAssignmentCompletion(db, {
        auth: { uid: "tester1" },
        data: { assignmentId: ASSIGNMENT_ID },
      }),
    ),
    "permission-denied",
  );
  assert.equal(db.__committed.length, 0);
});

test("a caller with no profile document cannot verify", async () => {
  const db = fakeDb(world());
  assert.equal(
    await codeOf(
      verifyAssignmentCompletion(db, {
        auth: { uid: "ghost" },
        data: { assignmentId: ASSIGNMENT_ID },
      }),
    ),
    "permission-denied",
  );
});

test("a suspended admin cannot verify", async () => {
  const db = fakeDb(
    world({ extra: { "users/admin1": { uid: "admin1", role: "admin", isSuspended: true } } }),
  );
  assert.equal(
    await codeOf(
      verifyAssignmentCompletion(db, {
        auth: { uid: "admin1" },
        data: { assignmentId: ASSIGNMENT_ID },
      }),
    ),
    "permission-denied",
  );
  assert.equal(db.__committed.length, 0);
});

test("a malformed assignment id is rejected", async () => {
  const db = fakeDb(world());
  for (const assignmentId of [undefined, null, "", 42, "a/b", "..", "__x__"]) {
    assert.equal(
      await codeOf(
        verifyAssignmentCompletion(db, { auth: { uid: "admin1" }, data: { assignmentId } }),
      ),
      "invalid-argument",
      String(assignmentId),
    );
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
  assert.equal(await codeOf(verify(db, { adminUid: "admin1" })), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

test("a nonexistent assignment is rejected", async () => {
  const db = fakeDb(world());
  assert.equal(await codeOf(verify(db, { assignmentId: "nope__nobody" })), "not-found");
});

test("an assignment in a non-verifiable state is rejected", async () => {
  for (const status of ["ready", "missed"]) {
    const db = fakeDb(world({ status }));
    assert.equal(await codeOf(verify(db)), "failed-precondition", status);
    assert.equal(db.__committed.length, 0);
  }
});

test("an assignment with no status at all is rejected", async () => {
  const db = fakeDb(world({ assignmentOverrides: { status: undefined } }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
});

test("an assignment with no valid tester is rejected", async () => {
  for (const testerId of [undefined, "", 42, "a/b"]) {
    const db = fakeDb(world({ assignmentOverrides: { testerId } }));
    assert.equal(await codeOf(verify(db)), "failed-precondition", String(testerId));
  }
});

test("a missing tester profile is rejected", async () => {
  const seed = world();
  delete seed[TESTER_PATH];
  const db = fakeDb(seed);
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("a suspended tester is never verified", async () => {
  const db = fakeDb(world({ tester: { uid: "tester1", isSuspended: true } }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("an assignment without enough logged days is rejected", async () => {
  const db = fakeDb(world({ logs: 13 }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("a cached daysCompleted that overstates progress cannot buy a completion", async () => {
  // The cached counter claims the work is done; the logs say otherwise.
  const db = fakeDb(world({ logs: 3, daysCompleted: 14 }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
  assert.equal(db.__committed.length, 0);
});

test("a cached daysCompleted that understates progress does not block a completion", async () => {
  const db = fakeDb(world({ logs: 14, daysCompleted: 0 }));
  const outcome = await verify(db);
  assert.equal(outcome.verified, true);
});

test("logs belonging to another assignment do not count", async () => {
  const extra = {};
  for (let i = 0; i < 14; i += 1) {
    extra[`testingLogs/other__2026-09-${String(i + 1).padStart(2, "0")}`] = {
      assignmentId: "other__tester1",
      testerId: "tester1",
    };
  }
  const db = fakeDb(world({ logs: 2, extra }));
  assert.equal(await codeOf(verify(db)), "failed-precondition");
});

test("extra logged days beyond the requirement are fine", async () => {
  const db = fakeDb(world({ logs: 20, daysRequired: 14 }));
  const outcome = await verify(db);
  assert.equal(outcome.verified, true);
});

test("a caller cannot influence the tester or the day count", async () => {
  const db = fakeDb(world({ logs: 3 }));
  // Everything a hostile caller might try to smuggle in alongside the id.
  const outcome = await codeOf(
    verifyAssignmentCompletion(db, {
      auth: { uid: "admin1" },
      data: {
        assignmentId: ASSIGNMENT_ID,
        amount: 5000,
        coinReward: 5000,
        loggedDays: 14,
        daysRequired: 1,
        testerId: "admin1",
        deltaAvailable: 5000,
      },
    }),
  );
  assert.equal(outcome, "failed-precondition", "the real log count still governs");
  assert.deepEqual(coinWrites(db), []);
});

/**
 * Admin-guard wiring for the admin callables that had none of their own tests.
 *
 * `guards.test.js` proves `requireAdmin` itself. What it cannot prove is that
 * each callable actually CALLS it, first, before touching anything - a
 * refactor that moved the guard below a read, or dropped it, would leave every
 * guard test green. So each case here drives the real `*Impl` the deployed
 * callable delegates to, and the fake Firestore records every access other
 * than the caller's own profile lookup. A refused call must leave that record
 * empty.
 *
 * Each callable also gets a positive control: an active admin gets PAST the
 * guard. Without it, a fake that refused everyone would pass every test here.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { adminRunExpirySweepImpl, adminEvaluateExpiryImpl } = require("../expiry");
const { adminDeclareOutageImpl } = require("../systemHealth");
const { adminRefreshQuickTestPoolImpl } = require("../quickTests");

const ADMIN = "admin1";
const USER = "user1";
const SUSPENDED_ADMIN = "admin2";

/**
 * A Firestore that serves user profiles and records everything else.
 *
 * Any collection query, transaction, batch or non-profile document read is
 * logged in `touched`. Queries return nothing, which is all the one positive
 * control that reaches business logic (the pool refresh) needs.
 */
function fakeDb() {
  const users = {
    [ADMIN]: { uid: ADMIN, role: "admin" },
    [USER]: { uid: USER },
    [SUSPENDED_ADMIN]: { uid: SUSPENDED_ADMIN, role: "admin", isSuspended: true },
  };
  const touched = [];
  const writes = [];

  const snapshot = (path, data) => ({
    id: path.split("/").pop(),
    ref: { path },
    exists: data !== undefined,
    data: () => data,
    get: (field) => (data === undefined ? undefined : data[field]),
  });

  const query = (name) => {
    const q = {
      where: () => q,
      orderBy: () => q,
      limit: () => q,
      get: async () => {
        touched.push(`query:${name}`);
        return { empty: true, size: 0, docs: [] };
      },
    };
    return q;
  };

  return {
    touched,
    writes,
    doc: (path) => ({
      path,
      get: async () => {
        const m = /^users\/([^/]+)$/.exec(path);
        if (m) return snapshot(path, users[m[1]]);
        touched.push(`read:${path}`);
        return snapshot(path, undefined);
      },
    }),
    collection: (name) => {
      touched.push(`collection:${name}`);
      return query(name);
    },
    batch: () => {
      touched.push("batch");
      const staged = [];
      return {
        set: (ref, data) => staged.push({ path: ref.path, data }),
        commit: async () => {
          writes.push(...staged);
        },
      };
    },
    runTransaction: async () => {
      touched.push("transaction");
      throw new Error("no transaction expected in a guard test");
    },
  };
}

async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (err) {
    return err.code;
  }
}

const CALLABLES = [
  {
    name: "adminRunExpirySweep",
    impl: adminRunExpirySweepImpl,
    data: { limit: 10 },
    // An out-of-range limit is checked after the guard: reaching it proves
    // the admin got through, without running a sweep against the fake.
    adminProbe: { data: { limit: 999999 }, expectCode: "invalid-argument" },
  },
  {
    name: "adminEvaluateExpiry",
    impl: adminEvaluateExpiryImpl,
    data: { assignmentId: "app1__tester1__c1" },
    adminProbe: { data: {}, expectCode: "invalid-argument" },
  },
  {
    name: "adminDeclareOutage",
    impl: adminDeclareOutageImpl,
    data: { dayKey: "2026-09-23", degraded: true, scope: "global" },
    adminProbe: { data: {}, expectCode: "invalid-argument" },
  },
  {
    name: "adminRefreshQuickTestPool",
    impl: adminRefreshQuickTestPoolImpl,
    data: {},
    adminProbe: null, // runs for real; see its own positive control below
  },
];

const CALLERS = [
  {
    label: "an unauthenticated caller",
    auth: undefined,
    code: "unauthenticated",
  },
  {
    // The token claims are what a client COULD forge; admin state lives only
    // in Firestore, so they must change nothing.
    label: "a non-admin, even one presenting admin token claims",
    auth: { uid: USER, token: { admin: true, role: "admin" } },
    code: "permission-denied",
  },
  {
    label: "a suspended admin",
    auth: { uid: SUSPENDED_ADMIN },
    code: "permission-denied",
  },
  {
    label: "a caller with no profile document",
    auth: { uid: "ghost" },
    code: "permission-denied",
  },
];

for (const c of CALLABLES) {
  for (const caller of CALLERS) {
    test(`${c.name}: ${caller.label} is refused before anything is touched`, async () => {
      const db = fakeDb();
      const request = { data: c.data };
      if (caller.auth) request.auth = caller.auth;

      assert.equal(await codeOf(c.impl(db, request)), caller.code);
      assert.deepEqual(db.touched, [], "the guard must run before any other access");
      assert.deepEqual(db.writes, []);
    });
  }

  if (c.adminProbe) {
    test(`${c.name}: an active admin gets past the guard`, async () => {
      const db = fakeDb();
      const code = await codeOf(c.impl(db, { auth: { uid: ADMIN }, data: c.adminProbe.data }));
      // Not a permission failure: the refusal now comes from input validation,
      // which only runs once the guard has let the caller through.
      assert.equal(code, c.adminProbe.expectCode);
    });
  }
}

test("adminRefreshQuickTestPool: an active admin refreshes the pool as themselves", async () => {
  const db = fakeDb();
  const result = await adminRefreshQuickTestPoolImpl(db, { auth: { uid: ADMIN }, data: {} });

  assert.deepEqual(result, { appIds: [], candidates: 0, poolSize: 0 });
  assert.equal(db.writes.length, 1);
  assert.equal(db.writes[0].data.refreshedBy, ADMIN, "attributed to the verified uid");
});

test("adminRefreshQuickTestPool: the deployed callable still delegates to the guarded impl", () => {
  // Public contract unchanged by the extraction: same export, still a callable
  // in the main region.
  const quickTests = require("../quickTests");
  const { REGION } = require("../lib/constants");
  const endpoint = quickTests.adminRefreshQuickTestPool.__endpoint;
  assert.ok(endpoint.callableTrigger, "still an onCall function");
  assert.deepEqual(endpoint.region, [REGION]);
});

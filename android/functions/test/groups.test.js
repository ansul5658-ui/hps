/**
 * Groups backend - CHARACTERIZATION tests (Groups Phase 1, batch G1).
 *
 * These pin down what `joinGroup`, `ensureOfficialGroup`,
 * `syncGroupMemberCount` and `adminUpsertGroup` do TODAY, so later batches
 * change them deliberately rather than by accident. Where today's behaviour is
 * not the intended final behaviour, the test says so in its title and asserts
 * today's behaviour anyway - it is a record, not an endorsement:
 *   * `inviteOnly` is joinable like `open` (intended: requires an invitation);
 *   * `draft` is joinable (kept for now);
 *   * the member cap is checked against the lagging mirror, outside any
 *     transaction (see the emulator suite for the concurrency consequence);
 *   * the sync trigger swallows its own errors.
 *
 * `groups.js` and `admin.js` call `getFirestore()` themselves - they have no
 * `*Impl(db, ...)` seam - so the fake below is installed as `getFirestore`
 * BEFORE either module is loaded (both capture it at require time). Nothing
 * outside this test process is affected: `node --test` runs each file in its
 * own process.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const firestoreModule = require("firebase-admin/firestore");
const { FieldValue } = firestoreModule;

// ---------------------------------------------------------------------------
// Fake Firestore: a flat path -> data map, just the API these modules use.
// ---------------------------------------------------------------------------

const SERVER_TS = FieldValue.serverTimestamp();
const isServerTimestamp = (v) => v !== null && typeof v === "object" && typeof v.isEqual === "function" && v.isEqual(SERVER_TS);

function grpcError(code, message) {
  return Object.assign(new Error(`${code} ${message}`), { code });
}

function makeFakeDb() {
  const store = new Map();
  const ops = []; // every read and write, in order: "get groups/g1", "create users/u/memberships/g1", ...
  const faults = new Map(); // "op path" -> Error to throw instead
  const setOptions = new Map(); // path -> options of the last set() on it
  const hooks = { beforeCreate: null };

  const idOf = (path) => path.split("/").pop();
  const snapshot = (path) => {
    const data = store.get(path);
    return {
      id: idOf(path),
      ref: ref(path),
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : { ...data }),
      get: (field) => (data === undefined ? undefined : data[field]),
    };
  };
  const fault = (op, path) => {
    ops.push(`${op} ${path}`);
    const err = faults.get(`${op} ${path}`);
    if (err) throw err;
  };
  const children = (collectionPath) => {
    const depth = collectionPath.split("/").length + 1;
    return [...store.keys()].filter((k) => k.startsWith(`${collectionPath}/`) && k.split("/").length === depth);
  };

  function ref(path) {
    return {
      path,
      id: idOf(path),
      async get() {
        fault("get", path);
        return snapshot(path);
      },
      async set(data, opts = {}) {
        fault("set", path);
        setOptions.set(path, { ...opts });
        const before = opts.merge ? store.get(path) || {} : {};
        store.set(path, { ...before, ...data });
      },
      async create(data) {
        if (hooks.beforeCreate) await hooks.beforeCreate(path);
        fault("create", path);
        if (store.has(path)) throw grpcError(6, `ALREADY_EXISTS: ${path}`);
        store.set(path, { ...data });
      },
      async update(data) {
        fault("update", path);
        if (!store.has(path)) throw grpcError(5, `NOT_FOUND: ${path}`);
        store.set(path, { ...store.get(path), ...data });
      },
      async delete() {
        fault("delete", path);
        store.delete(path);
      },
    };
  }

  const db = {
    doc: (path) => ref(path),
    collection: (path) => ({
      count: () => ({
        async get() {
          fault("count", path);
          const n = children(path).length;
          return { data: () => ({ count: n }) };
        },
      }),
    }),
    async runTransaction(fn) {
      ops.push("runTransaction");
      const pending = [];
      const tx = {
        get: async (r) => {
          ops.push(`tx.get ${r.path}`);
          return snapshot(r.path);
        },
        set: (r, data) => pending.push(() => store.set(r.path, { ...data })),
        update: (r, data) =>
          pending.push(() => {
            if (!store.has(r.path)) throw grpcError(5, `NOT_FOUND: ${r.path}`);
            store.set(r.path, { ...store.get(r.path), ...data });
          }),
      };
      const out = await fn(tx);
      for (const w of pending) w();
      return out;
    },
  };

  return {
    db,
    store,
    ops,
    faults,
    setOptions,
    hooks,
    seed(path, data) {
      store.set(path, { ...data });
    },
    reset() {
      store.clear();
      ops.length = 0;
      faults.clear();
      setOptions.clear();
      hooks.beforeCreate = null;
    },
    writesOf() {
      return ops.filter((o) => /^(set|create|update|delete) /.test(o));
    },
  };
}

const fake = makeFakeDb();
firestoreModule.getFirestore = () => fake.db;

// Loaded only now, so they capture the fake.
const { joinGroup, syncGroupMemberCount, ensureOfficialGroup } = require("../groups");
const { adminUpsertGroup } = require("../admin");
const { OFFICIAL_GROUP_ID, OFFICIAL_GROUP_NAME, OFFICIAL_GROUP_EMAIL } = require("../lib/constants");

const ADMIN = "admin1";
const USER = "user1";
const OTHER = "user2";
const G = "g1";
const as = (uid, data) => ({ auth: uid ? { uid } : undefined, data });
const join = (uid, groupId) => joinGroup.run(as(uid, { groupId }));
const upsert = (uid, data) => adminUpsertGroup.run(as(uid, data));
const membershipPath = (uid, gid) => `users/${uid}/memberships/${gid}`;
const mirrorPath = (gid, uid) => `groups/${gid}/members/${uid}`;

async function codeOf(promise) {
  try {
    await promise;
  } catch (err) {
    return err.code;
  }
  return "resolved";
}

function world({ group = { status: "open", memberCap: 0 }, user = { uid: USER } } = {}) {
  fake.reset();
  fake.seed(`users/${ADMIN}`, { uid: ADMIN, role: "admin" });
  if (user) fake.seed(`users/${USER}`, user);
  if (group) fake.seed(`groups/${G}`, group);
}

test.beforeEach(() => world());

// ===========================================================================
// joinGroup
// ===========================================================================

test("joinGroup: happy path creates exactly one membership and returns joined", async () => {
  const out = await join(USER, G);
  assert.deepEqual(out, { groupId: G, joined: true, alreadyMember: false });

  const m = fake.store.get(membershipPath(USER, G));
  assert.equal(m.groupId, G);
  assert.equal(m.userId, USER);
  assert.ok(isServerTimestamp(m.joinedAt), "joinedAt is a server timestamp");
  assert.deepEqual(Object.keys(m).sort(), ["groupId", "joinedAt", "userId"]);
});

test("joinGroup: writes ONLY the membership - the mirror and memberCount are left to the trigger", async () => {
  await join(USER, G);
  assert.deepEqual(fake.writesOf(), [`create ${membershipPath(USER, G)}`]);
  assert.equal(fake.store.has(mirrorPath(G, USER)), false);
  assert.equal(fake.store.get(`groups/${G}`).memberCount, undefined);
});

test("joinGroup: an uncapped group (memberCap 0) never counts members", async () => {
  await join(USER, G);
  assert.equal(fake.ops.some((o) => o.startsWith("count ")), false);
});

test("joinGroup: re-joining is idempotent - success, no write", async () => {
  fake.seed(membershipPath(USER, G), { groupId: G, userId: USER });
  const before = fake.writesOf().length;
  const out = await join(USER, G);
  assert.deepEqual(out, { groupId: G, joined: false, alreadyMember: true });
  assert.equal(fake.writesOf().length, before);
});

test("joinGroup: a create that loses a race (raw code 6) is reported as already a member", async () => {
  // The membership did not exist when joinGroup read it, but a concurrent join
  // created it before this create landed.
  fake.hooks.beforeCreate = async (path) => {
    if (path === membershipPath(USER, G)) fake.seed(path, { groupId: G, userId: USER, winner: true });
  };
  const out = await join(USER, G);
  assert.deepEqual(out, { groupId: G, joined: false, alreadyMember: true });
  assert.equal(fake.store.get(membershipPath(USER, G)).winner, true, "the winner's document is untouched");
});

test("joinGroup: any other create failure propagates unchanged", async () => {
  const boom = grpcError(14, "UNAVAILABLE: backend down");
  fake.faults.set(`create ${membershipPath(USER, G)}`, boom);
  await assert.rejects(join(USER, G), (e) => e === boom);
});

test("joinGroup: unauthenticated callers are refused before any read", async () => {
  assert.equal(await codeOf(join(null, G)), "unauthenticated");
  assert.deepEqual(fake.ops, []);
});

test("joinGroup: a missing or malformed groupId is invalid-argument", async () => {
  assert.equal(await codeOf(join(USER, undefined)), "invalid-argument");
  assert.equal(await codeOf(join(USER, "a/b")), "invalid-argument");
  assert.deepEqual(fake.writesOf(), []);
});

test("joinGroup: a missing (non-official) group is not-found and nothing is created", async () => {
  assert.equal(await codeOf(join(USER, "nope")), "not-found");
  assert.equal(fake.store.has("groups/nope"), false);
  assert.deepEqual(fake.writesOf(), []);
});

test("joinGroup: a private group is refused (permission-denied)", async () => {
  world({ group: { status: "open", visibility: "private" } });
  assert.equal(await codeOf(join(USER, G)), "permission-denied");
  assert.deepEqual(fake.writesOf(), []);
});

test("joinGroup: CURRENT behaviour - an inviteOnly group is self-joinable like an open one (intended: requires an invitation)", async () => {
  world({ group: { status: "open", visibility: "inviteOnly" } });
  const out = await join(USER, G);
  assert.equal(out.joined, true);
});

for (const status of ["full", "completed", "archived", "cancelled"]) {
  test(`joinGroup: a "${status}" group refuses new members (failed-precondition)`, async () => {
    world({ group: { status } });
    assert.equal(await codeOf(join(USER, G)), "failed-precondition");
    assert.deepEqual(fake.writesOf(), []);
  });
}

test("joinGroup: an unknown status is refused like a closed one", async () => {
  world({ group: { status: "mystery" } });
  assert.equal(await codeOf(join(USER, G)), "failed-precondition");
});

for (const status of ["draft", "open", "active"]) {
  const note = status === "draft" ? " (draft kept joinable for now, by decision)" : "";
  test(`joinGroup: a "${status}" group accepts members${note}`, async () => {
    world({ group: { status } });
    assert.equal((await join(USER, G)).joined, true);
  });
}

test("joinGroup: a group with NO status field is treated as draft, and so is joinable", async () => {
  world({ group: { memberCap: 0 } });
  assert.equal((await join(USER, G)).joined, true);
});

test("joinGroup: a suspended user is refused (permission-denied)", async () => {
  world({ user: { uid: USER, isSuspended: true } });
  assert.equal(await codeOf(join(USER, G)), "permission-denied");
  assert.deepEqual(fake.writesOf(), []);
});

test("joinGroup: a suspended user who is ALREADY a member is refused, not reported as a member", async () => {
  world({ user: { uid: USER, isSuspended: true } });
  fake.seed(membershipPath(USER, G), { groupId: G, userId: USER });
  assert.equal(await codeOf(join(USER, G)), "permission-denied");
  assert.equal(fake.store.has(membershipPath(USER, G)), true, "the existing membership is not removed");
});

test("joinGroup: a caller with no profile document is treated as active and may join", async () => {
  world({ user: null });
  assert.equal((await join(USER, G)).joined, true);
});

// ---- member cap: counted from the MIRROR, outside any transaction ---------

test("joinGroup: a capped group below its cap accepts a member (count read from the mirror)", async () => {
  world({ group: { status: "open", memberCap: 2 } });
  fake.seed(mirrorPath(G, OTHER), { userId: OTHER });
  assert.equal((await join(USER, G)).joined, true);
  assert.ok(fake.ops.includes(`count groups/${G}/members`), "the cap check counts the mirror collection");
  assert.equal(fake.ops.includes("runTransaction"), false, "no transaction is used");
});

test("joinGroup: the last free seat is joinable and a full mirror refuses (resource-exhausted)", async () => {
  world({ group: { status: "open", memberCap: 1 } });
  assert.equal((await join(USER, G)).joined, true); // mirror empty: 0 < 1
  fake.seed(mirrorPath(G, USER), { userId: USER }); // the trigger's work, done by hand
  assert.equal(await codeOf(join(OTHER, G)), "resource-exhausted");
  assert.equal(fake.store.has(membershipPath(OTHER, G)), false);
});

test("joinGroup: CURRENT behaviour - the cap ignores memberships the mirror does not yet reflect", async () => {
  // Cap 1, one real membership already exists, but the sync trigger has not
  // mirrored it yet. The cap check reads the mirror, sees 0, and admits a
  // second member - the lag the code comments acknowledge.
  world({ group: { status: "open", memberCap: 1 } });
  fake.seed(membershipPath(OTHER, G), { groupId: G, userId: OTHER });
  assert.equal((await join(USER, G)).joined, true);
  const members = [...fake.store.keys()].filter((k) => k.endsWith(`/memberships/${G}`));
  assert.equal(members.length, 2, "two memberships under a cap of 1");
});

test("joinGroup: CURRENT behaviour - the cap ignores the group's own memberCount field", async () => {
  world({ group: { status: "open", memberCap: 1, memberCount: 5 } });
  assert.equal((await join(USER, G)).joined, true, "memberCount 5 is not what the cap is checked against");
});

test("joinGroup: an already-member at a full cap is still reported as a member (idempotency wins over the cap)", async () => {
  world({ group: { status: "open", memberCap: 1 } });
  fake.seed(mirrorPath(G, USER), { userId: USER });
  fake.seed(membershipPath(USER, G), { groupId: G, userId: USER });
  assert.deepEqual(await join(USER, G), { groupId: G, joined: false, alreadyMember: true });
});

// ---- official group auto-provisioning -------------------------------------

test("joinGroup: joining the OFFICIAL group when it does not exist provisions it, then joins", async () => {
  world({ group: null });
  const out = await join(USER, OFFICIAL_GROUP_ID);
  assert.equal(out.joined, true);

  const g = fake.store.get(`groups/${OFFICIAL_GROUP_ID}`);
  assert.equal(g.name, OFFICIAL_GROUP_NAME);
  assert.equal(g.googleGroupEmail, OFFICIAL_GROUP_EMAIL);
  assert.equal(g.status, "open");
  assert.equal(g.visibility, "open");
  assert.equal(g.memberCap, 0);
  assert.equal(g.memberCount, 0);
  assert.equal(g.createdBy, "system");
  assert.ok(isServerTimestamp(g.createdAt));
  assert.ok(fake.store.has(membershipPath(USER, OFFICIAL_GROUP_ID)));
});

test("ensureOfficialGroup: an existing official group is returned untouched", async () => {
  world({ group: null });
  fake.seed(`groups/${OFFICIAL_GROUP_ID}`, { name: "Custom", status: "active", memberCount: 7 });
  const snap = await ensureOfficialGroup(fake.db);
  assert.equal(snap.exists, true);
  assert.equal(snap.get("name"), "Custom");
  assert.deepEqual(fake.writesOf(), []);
});

test("ensureOfficialGroup: a missing official group is created with merge and read back", async () => {
  world({ group: null });
  const snap = await ensureOfficialGroup(fake.db);
  assert.equal(snap.exists, true);
  assert.equal(snap.get("status"), "open");
  assert.deepEqual(fake.writesOf(), [`set groups/${OFFICIAL_GROUP_ID}`]);
  assert.deepEqual(fake.setOptions.get(`groups/${OFFICIAL_GROUP_ID}`), { merge: true });
});

// ===========================================================================
// syncGroupMemberCount (the trigger's handler, run directly)
// ===========================================================================

const docState = (data) => ({
  exists: data !== undefined,
  get: (field) => (data === undefined ? undefined : data[field]),
});
const writeEvent = (userId, groupId, before, after) => ({
  params: { userId, groupId },
  data: { before: docState(before), after: docState(after) },
});
const sync = (event) => syncGroupMemberCount.run(event);

test("sync: a created membership writes the mirror row and recounts memberCount", async () => {
  const joinedAt = { seconds: 1 };
  await sync(writeEvent(USER, G, undefined, { groupId: G, userId: USER, joinedAt }));
  assert.deepEqual(fake.store.get(mirrorPath(G, USER)), { userId: USER, groupId: G, joinedAt });
  assert.equal(fake.store.get(`groups/${G}`).memberCount, 1);
});

test("sync: a created membership with no joinedAt gets a server timestamp on the mirror", async () => {
  await sync(writeEvent(USER, G, undefined, { groupId: G, userId: USER }));
  assert.ok(isServerTimestamp(fake.store.get(mirrorPath(G, USER)).joinedAt));
});

test("sync: a deleted membership removes the mirror row and recounts", async () => {
  fake.seed(mirrorPath(G, USER), { userId: USER });
  fake.seed(mirrorPath(G, OTHER), { userId: OTHER });
  fake.seed(`groups/${G}`, { status: "open", memberCount: 2 });
  await sync(writeEvent(USER, G, { groupId: G }, undefined));
  assert.equal(fake.store.has(mirrorPath(G, USER)), false);
  assert.equal(fake.store.get(`groups/${G}`).memberCount, 1);
});

test("sync: memberCount is RECOUNTED from the mirror, not incremented - a stale value is corrected", async () => {
  fake.seed(`groups/${G}`, { status: "open", memberCount: 99 });
  fake.seed(mirrorPath(G, OTHER), { userId: OTHER });
  await sync(writeEvent(USER, G, undefined, { groupId: G }));
  assert.equal(fake.store.get(`groups/${G}`).memberCount, 2);
});

test("sync: an updated membership re-merges the mirror and recounts", async () => {
  fake.seed(mirrorPath(G, USER), { userId: USER, extra: "kept" });
  await sync(writeEvent(USER, G, { groupId: G }, { groupId: G, joinedAt: 5 }));
  assert.deepEqual(fake.store.get(mirrorPath(G, USER)), { userId: USER, extra: "kept", groupId: G, joinedAt: 5 });
  assert.equal(fake.store.get(`groups/${G}`).memberCount, 1);
});

test("sync: an event with no data still recounts an existing group", async () => {
  fake.seed(mirrorPath(G, OTHER), { userId: OTHER });
  await sync({ params: { userId: USER, groupId: G }, data: null });
  assert.equal(fake.store.has(mirrorPath(G, USER)), false);
  assert.equal(fake.store.get(`groups/${G}`).memberCount, 1);
});

test("sync: CURRENT behaviour - for a MISSING group the mirror row is still written (orphan) and memberCount is skipped", async () => {
  world({ group: null });
  await sync(writeEvent(USER, "ghost", undefined, { groupId: "ghost" }));
  assert.equal(fake.store.has(mirrorPath("ghost", USER)), true, "orphan mirror row under a nonexistent group");
  assert.equal(fake.store.has("groups/ghost"), false, "the group document is not created");
});

test("sync: CURRENT behaviour - a failing memberCount update is swallowed; the mirror is written but the count is stale", async () => {
  fake.seed(`groups/${G}`, { status: "open", memberCount: 0 });
  fake.faults.set(`update groups/${G}`, grpcError(14, "UNAVAILABLE"));
  await assert.doesNotReject(sync(writeEvent(USER, G, undefined, { groupId: G })));
  assert.equal(fake.store.has(mirrorPath(G, USER)), true);
  assert.equal(fake.store.get(`groups/${G}`).memberCount, 0, "stale count, and no retry is signalled");
});

test("sync: CURRENT behaviour - a failing mirror write is swallowed; neither mirror nor count changes", async () => {
  fake.seed(`groups/${G}`, { status: "open", memberCount: 0 });
  fake.faults.set(`set ${mirrorPath(G, USER)}`, grpcError(14, "UNAVAILABLE"));
  await assert.doesNotReject(sync(writeEvent(USER, G, undefined, { groupId: G })));
  assert.equal(fake.store.has(mirrorPath(G, USER)), false, "the membership exists but its mirror row does not");
  assert.equal(fake.store.get(`groups/${G}`).memberCount, 0);
});

test("sync: CURRENT behaviour - a failing mirror DELETE is swallowed; the stale row stays", async () => {
  fake.seed(mirrorPath(G, USER), { userId: USER });
  fake.seed(`groups/${G}`, { status: "open", memberCount: 1 });
  fake.faults.set(`delete ${mirrorPath(G, USER)}`, grpcError(14, "UNAVAILABLE"));
  await assert.doesNotReject(sync(writeEvent(USER, G, { groupId: G }, undefined)));
  assert.equal(fake.store.has(mirrorPath(G, USER)), true, "a departed member keeps a mirror row");
  assert.equal(fake.store.get(`groups/${G}`).memberCount, 1);
});

// ===========================================================================
// adminUpsertGroup
// ===========================================================================

test("adminUpsertGroup: unauthenticated callers are refused before any read", async () => {
  assert.equal(await codeOf(upsert(null, { groupId: G })), "unauthenticated");
  assert.deepEqual(fake.ops, []);
});

test("adminUpsertGroup: a non-admin is refused and nothing is read beyond their profile", async () => {
  assert.equal(await codeOf(upsert(USER, { groupId: "new", name: "Mine" })), "permission-denied");
  assert.deepEqual(fake.ops, [`get users/${USER}`]);
  assert.equal(fake.store.has("groups/new"), false);
});

test("adminUpsertGroup: a suspended admin is refused", async () => {
  fake.seed(`users/${ADMIN}`, { uid: ADMIN, role: "admin", isSuspended: true });
  assert.equal(await codeOf(upsert(ADMIN, { groupId: "new" })), "permission-denied");
  assert.equal(fake.store.has("groups/new"), false);
});

test("adminUpsertGroup: the admin check runs BEFORE groupId validation", async () => {
  assert.equal(await codeOf(upsert(USER, { groupId: "a/b" })), "permission-denied");
  assert.equal(await codeOf(upsert(ADMIN, { groupId: "a/b" })), "invalid-argument");
});

for (const [label, data] of [
  ["unknown visibility", { visibility: "secret" }],
  ["unknown status", { status: "paused" }],
  ["negative memberCap", { memberCap: -1 }],
  ["fractional memberCap", { memberCap: 1.5 }],
  ["non-numeric memberCap", { memberCap: "lots" }],
  ["non-string name", { name: 7 }],
  ["over-long name", { name: "x".repeat(121) }],
  ["over-long googleGroupEmail", { googleGroupEmail: "x".repeat(201) }],
]) {
  test(`adminUpsertGroup: ${label} is invalid-argument and writes nothing`, async () => {
    assert.equal(await codeOf(upsert(ADMIN, { groupId: "new", ...data })), "invalid-argument");
    assert.equal(fake.store.has("groups/new"), false);
  });
}

test("adminUpsertGroup: create sets defaults - status open, memberCount 0, createdBy the admin; visibility is NOT defaulted", async () => {
  const out = await upsert(ADMIN, { groupId: "new", name: "  New group  " });
  assert.deepEqual(out, { groupId: "new", created: true });
  const g = fake.store.get("groups/new");
  assert.equal(g.name, "New group", "strings are trimmed");
  assert.equal(g.status, "open");
  assert.equal(g.memberCount, 0);
  assert.equal(g.createdBy, ADMIN);
  assert.ok(isServerTimestamp(g.createdAt));
  assert.ok(isServerTimestamp(g.updatedAt));
  assert.equal("visibility" in g, false, "no visibility field - the client maps a missing one to Open");
  assert.equal("memberCap" in g, false);
});

test("adminUpsertGroup: an explicit status on create is kept", async () => {
  await upsert(ADMIN, { groupId: "new", status: "draft" });
  assert.equal(fake.store.get("groups/new").status, "draft");
});

test("adminUpsertGroup: update changes only the supplied fields and never memberCount/createdBy", async () => {
  fake.seed(`groups/${G}`, { name: "Old", status: "open", memberCount: 4, createdBy: "someone", summary: "keep" });
  const out = await upsert(ADMIN, { groupId: G, name: "New", memberCount: 999, createdBy: "me" });
  assert.deepEqual(out, { groupId: G, created: false });
  const g = fake.store.get(`groups/${G}`);
  assert.equal(g.name, "New");
  assert.equal(g.summary, "keep");
  assert.equal(g.status, "open");
  assert.equal(g.memberCount, 4, "memberCount in the request is ignored");
  assert.equal(g.createdBy, "someone", "createdBy in the request is ignored");
});

test("adminUpsertGroup: runs as a transaction that reads the group by id", async () => {
  await upsert(ADMIN, { groupId: "new" });
  assert.ok(fake.ops.includes("runTransaction"));
  assert.ok(fake.ops.includes("tx.get groups/new"));
});

test("adminUpsertGroup: inviteOnly and private visibilities are accepted", async () => {
  await upsert(ADMIN, { groupId: "a", visibility: "inviteOnly" });
  await upsert(ADMIN, { groupId: "b", visibility: "private" });
  assert.equal(fake.store.get("groups/a").visibility, "inviteOnly");
  assert.equal(fake.store.get("groups/b").visibility, "private");
});

test("adminUpsertGroup: memberCap accepts 0 and a numeric string; null means 'leave unchanged'", async () => {
  await upsert(ADMIN, { groupId: "a", memberCap: 0 });
  await upsert(ADMIN, { groupId: "b", memberCap: "5" });
  assert.equal(fake.store.get("groups/a").memberCap, 0);
  assert.equal(fake.store.get("groups/b").memberCap, 5, "a numeric string is coerced");
  await upsert(ADMIN, { groupId: "b", memberCap: null });
  assert.equal(fake.store.get("groups/b").memberCap, 5);
});

test("adminUpsertGroup: CURRENT behaviour - memberCap may be lowered below the current membership", async () => {
  fake.seed(`groups/${G}`, { status: "open", memberCap: 10, memberCount: 6 });
  await upsert(ADMIN, { groupId: G, memberCap: 2 });
  const g = fake.store.get(`groups/${G}`);
  assert.equal(g.memberCap, 2);
  assert.equal(g.memberCount, 6, "existing members are not affected or flagged");
});

test("adminUpsertGroup: CURRENT behaviour - closing a group leaves its memberships in place", async () => {
  fake.seed(membershipPath(USER, G), { groupId: G, userId: USER });
  await upsert(ADMIN, { groupId: G, status: "archived" });
  assert.equal(fake.store.get(`groups/${G}`).status, "archived");
  assert.equal(fake.store.has(membershipPath(USER, G)), true);
});

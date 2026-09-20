const test = require("node:test");
const assert = require("node:assert/strict");

const {
  requireAuth,
  requireAdmin,
  requireNotSuspended,
  requireDocId,
  requireBoolean,
  optionalString,
} = require("../lib/guards");

/** Minimal stand-in for the Admin SDK Firestore surface the guards use. */
function fakeDb(docs) {
  return {
    doc(path) {
      return {
        async get() {
          const data = docs[path];
          return {
            ref: { path },
            exists: data !== undefined,
            data: () => data,
          };
        },
      };
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

test("an unauthenticated call is rejected before anything else happens", () => {
  assert.throws(() => requireAuth({}), (err) => err.code === "unauthenticated");
  assert.throws(() => requireAuth({ auth: {} }), (err) => err.code === "unauthenticated");
  assert.equal(requireAuth({ auth: { uid: "u1" } }), "u1");
});

test("a normal user cannot pass the admin guard", async () => {
  const db = fakeDb({ "users/u1": { role: "member" } });
  assert.equal(await codeOf(requireAdmin(db, "u1")), "permission-denied");
});

test("a moderator is not an admin", async () => {
  const db = fakeDb({ "users/u1": { role: "moderator" } });
  assert.equal(await codeOf(requireAdmin(db, "u1")), "permission-denied");
});

test("a user with no profile document cannot pass the admin guard", async () => {
  const db = fakeDb({});
  assert.equal(await codeOf(requireAdmin(db, "ghost")), "permission-denied");
});

test("a client-supplied role claim is irrelevant — only Firestore decides", async () => {
  // Even if a caller sent {role: "admin"} in the payload, the guard reads the
  // user document, which no client can write.
  const db = fakeDb({ "users/u1": { role: "member" } });
  assert.equal(await codeOf(requireAdmin(db, "u1")), "permission-denied");
});

test("an admin passes the admin guard", async () => {
  const db = fakeDb({ "users/admin1": { role: "admin" } });
  const user = await requireAdmin(db, "admin1");
  assert.equal(user.data.role, "admin");
});

test("a suspended admin is refused", async () => {
  const db = fakeDb({ "users/admin1": { role: "admin", isSuspended: true } });
  assert.equal(await codeOf(requireAdmin(db, "admin1")), "permission-denied");
});

test("a suspended user is refused by the suspension guard", async () => {
  const db = fakeDb({ "users/u1": { role: "member", isSuspended: true } });
  assert.equal(await codeOf(requireNotSuspended(db, "u1")), "permission-denied");
});

test("an active user, and a brand new user with no profile yet, both pass", async () => {
  const db = fakeDb({ "users/u1": { role: "member", isSuspended: false } });
  await requireNotSuspended(db, "u1");
  await requireNotSuspended(fakeDb({}), "brandNew");
});

test("input validation rejects malformed ids and types", () => {
  assert.equal(requireDocId("app1", "appId"), "app1");
  assert.throws(() => requireDocId("a/b", "appId"), (err) => err.code === "invalid-argument");
  assert.throws(() => requireDocId(undefined, "appId"), (err) => err.code === "invalid-argument");

  assert.equal(requireBoolean(true, "isSuspended"), true);
  assert.throws(() => requireBoolean("true", "isSuspended"), (err) => err.code === "invalid-argument");
  assert.throws(() => requireBoolean(1, "isSuspended"), (err) => err.code === "invalid-argument");

  assert.equal(optionalString("  hi  ", "name"), "hi");
  assert.equal(optionalString(undefined, "name"), undefined);
  assert.throws(() => optionalString(5, "name"), (err) => err.code === "invalid-argument");
  assert.throws(
    () => optionalString("x".repeat(200), "name", 120),
    (err) => err.code === "invalid-argument",
  );
});

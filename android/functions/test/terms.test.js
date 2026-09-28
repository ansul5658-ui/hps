/**
 * Terms of Service + Privacy Policy acceptance (release audit F2).
 *
 * The decision (lib/terms.js), the only writer (`acceptTerms`), and the rule
 * that the version number is the same in all three places that hard-code it.
 * Enforcement at each callable runs against real transactions in
 * test-emulator/terms.emulator.test.js.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { FieldValue } = require("firebase-admin/firestore");

const { TERMS_VERSION } = require("../lib/constants");
const {
  TERMS_NOT_ACCEPTED_REASON,
  hasAcceptedCurrentTerms,
  requireTermsAccepted,
} = require("../lib/terms");
const { runAcceptTerms, acceptTermsImpl } = require("../terms");

// ---------------------------------------------------------------------------
// A minimal transactional fake: point reads and updates only.
// ---------------------------------------------------------------------------

function fakeDb(seed = {}) {
  const store = new Map(Object.entries(seed).map(([p, d]) => [p, { ...d }]));
  const writes = [];
  const doc = (p) => ({ path: p });
  const snapOf = (p) => {
    const data = store.get(p);
    return {
      exists: data !== undefined,
      data: () => (data === undefined ? undefined : { ...data }),
      get: (f) => (data === undefined ? undefined : data[f]),
    };
  };
  return {
    store,
    writes,
    doc,
    async runTransaction(fn) {
      const staged = [];
      const tx = {
        async get(ref) {
          if (!ref || typeof ref.path !== "string") throw new Error("point reads only");
          return snapOf(ref.path);
        },
        update(ref, fields) {
          staged.push([ref.path, fields]);
        },
      };
      const out = await fn(tx);
      for (const [p, fields] of staged) {
        store.set(p, { ...store.get(p), ...fields });
        writes.push(p);
      }
      return out;
    },
  };
}

async function refusalOf(promise) {
  try {
    await promise;
  } catch (err) {
    return { code: err.code, reason: err.details && err.details.reason };
  }
  return "resolved";
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

test("F2: only an integer acceptance of the current (or a later) version counts", () => {
  assert.equal(hasAcceptedCurrentTerms({ termsAcceptedVersion: TERMS_VERSION }), true);
  assert.equal(hasAcceptedCurrentTerms({ termsAcceptedVersion: TERMS_VERSION + 1 }), true);
  assert.equal(hasAcceptedCurrentTerms({ termsAcceptedVersion: TERMS_VERSION - 1 }), false);
  assert.equal(hasAcceptedCurrentTerms({ termsAcceptedVersion: String(TERMS_VERSION) }), false);
  assert.equal(hasAcceptedCurrentTerms({ termsAcceptedVersion: TERMS_VERSION + 0.5 }), false);
  assert.equal(hasAcceptedCurrentTerms({ termsAcceptedAt: new Date() }), false, "a timestamp alone is not acceptance");
  assert.equal(hasAcceptedCurrentTerms({}), false);
  assert.equal(hasAcceptedCurrentTerms(null), false, "no profile, no acceptance");
});

test("F2: a refusal is failed-precondition with a recognisable reason", () => {
  assert.doesNotThrow(() => requireTermsAccepted({ termsAcceptedVersion: TERMS_VERSION }));
  try {
    requireTermsAccepted({});
    assert.fail("should have thrown");
  } catch (err) {
    assert.equal(err.code, "failed-precondition");
    assert.equal(err.details.reason, TERMS_NOT_ACCEPTED_REASON);
    assert.equal(err.details.requiredVersion, TERMS_VERSION);
    assert.match(err.message, /Terms of Service and Privacy Policy/);
  }
});

// ---------------------------------------------------------------------------
// acceptTerms
// ---------------------------------------------------------------------------

test("F2: acceptTerms records the current version with a SERVER timestamp", async () => {
  const db = fakeDb({ "users/u1": { uid: "u1", displayName: "U" } });
  const out = await runAcceptTerms(db, { uid: "u1", version: TERMS_VERSION });
  assert.deepEqual(out, { accepted: true, version: TERMS_VERSION, alreadyAccepted: false });
  const user = db.store.get("users/u1");
  assert.equal(user.termsAcceptedVersion, TERMS_VERSION);
  assert.ok(FieldValue.serverTimestamp().isEqual(user.termsAcceptedAt), "the server's clock, never the client's");
  assert.equal(user.displayName, "U", "the rest of the profile is untouched");
  assert.equal(hasAcceptedCurrentTerms(user), true, "and the gate now passes");
});

test("F2: re-accepting writes nothing, so the original acceptance time cannot move", async () => {
  const original = new Date("2026-01-01T00:00:00Z");
  const db = fakeDb({ "users/u1": { uid: "u1", termsAcceptedVersion: TERMS_VERSION, termsAcceptedAt: original } });
  const out = await runAcceptTerms(db, { uid: "u1", version: TERMS_VERSION });
  assert.deepEqual(out, { accepted: true, version: TERMS_VERSION, alreadyAccepted: true });
  assert.deepEqual(db.writes, []);
  assert.equal(db.store.get("users/u1").termsAcceptedAt, original);
});

test("F2: a user on an older version is moved to the current one", async () => {
  const db = fakeDb({ "users/u1": { uid: "u1", termsAcceptedVersion: TERMS_VERSION - 1, termsAcceptedAt: new Date(0) } });
  const out = await runAcceptTerms(db, { uid: "u1", version: TERMS_VERSION });
  assert.equal(out.alreadyAccepted, false);
  assert.equal(db.store.get("users/u1").termsAcceptedVersion, TERMS_VERSION);
});

test("F2: a stale or future version is refused and nothing is written", async () => {
  for (const version of [TERMS_VERSION - 1, TERMS_VERSION + 1]) {
    const db = fakeDb({ "users/u1": { uid: "u1" } });
    assert.deepEqual(await refusalOf(runAcceptTerms(db, { uid: "u1", version })), {
      code: "failed-precondition",
      reason: "termsVersionMismatch",
    });
    assert.deepEqual(db.writes, []);
  }
});

test("F2: a missing or non-integer version is invalid-argument", async () => {
  for (const version of [undefined, null, "1", 1.5, true]) {
    const db = fakeDb({ "users/u1": { uid: "u1" } });
    assert.equal((await refusalOf(runAcceptTerms(db, { uid: "u1", version }))).code, "invalid-argument");
    assert.deepEqual(db.writes, []);
  }
});

test("F2: acceptance is recorded on an existing profile only - none is invented", async () => {
  const db = fakeDb({});
  assert.deepEqual(await refusalOf(runAcceptTerms(db, { uid: "u1", version: TERMS_VERSION })), {
    code: "failed-precondition",
    reason: "profileMissing",
  });
  assert.deepEqual(db.writes, []);
  assert.equal(db.store.has("users/u1"), false);
});

test("F2: acceptTerms needs a signed-in caller", async () => {
  const db = fakeDb({ "users/u1": { uid: "u1" } });
  assert.equal((await refusalOf(acceptTermsImpl(db, { data: { version: TERMS_VERSION } }))).code, "unauthenticated");
  assert.deepEqual(db.writes, []);
});

test("F2: acceptTerms only ever writes the CALLER's profile - a target uid in the payload is ignored", async () => {
  const db = fakeDb({ "users/u1": { uid: "u1" }, "users/victim": { uid: "victim" } });
  await acceptTermsImpl(db, {
    auth: { uid: "u1" },
    data: { version: TERMS_VERSION, uid: "victim", userId: "victim", termsAcceptedAt: new Date(0) },
  });
  assert.deepEqual(db.writes, ["users/u1"]);
  assert.equal(db.store.get("users/victim").termsAcceptedVersion, undefined);
  assert.ok(
    FieldValue.serverTimestamp().isEqual(db.store.get("users/u1").termsAcceptedAt),
    "a client-supplied timestamp is ignored",
  );
});

// ---------------------------------------------------------------------------
// One version, three copies
// ---------------------------------------------------------------------------

test("F2: TERMS_VERSION agrees across Functions, firestore.rules and the Android app", () => {
  const rules = fs.readFileSync(path.resolve(__dirname, "../../firestore.rules"), "utf8");
  const ruleMatch = /get\('termsAcceptedVersion', 0\) >= (\d+)/.exec(rules);
  assert.ok(ruleMatch, "firestore.rules acceptedCurrentTerms() literal not found");
  assert.equal(Number(ruleMatch[1]), TERMS_VERSION, "firestore.rules");

  const appConfig = fs.readFileSync(
    path.resolve(__dirname, "../../app/src/main/java/com/apptesting/app/core/util/AppConfig.kt"),
    "utf8",
  );
  const appMatch = /const val TERMS_VERSION\s*=\s*(\d+)/.exec(appConfig);
  assert.ok(appMatch, "AppConfig.TERMS_VERSION not found");
  assert.equal(Number(appMatch[1]), TERMS_VERSION, "Android AppConfig");
});

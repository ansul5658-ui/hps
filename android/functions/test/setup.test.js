/**
 * Batch 9D: the pure rules for developer testing setup, app readiness and the
 * join prerequisites. The emulator suite drives them through the real claim.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  SETUP_CONFIRMATION_KIND,
  READINESS,
  isValidPackageName,
  optInUrlPackage,
  playStoreUrlPackage,
  appGroupId,
  setupFingerprint,
  checkSetupFields,
  checkAppReadiness,
  checkConfirmSetup,
  checkJoinPrerequisites,
} = require("../lib/setup");
const { OFFICIAL_GROUP_ID } = require("../lib/constants");
const {
  confirmAppTestingSetupImpl,
  getAppTestingReadinessImpl,
  getJoinEligibilityImpl,
} = require("../setup");
const functions = require("../index");

const PKG = "com.example.app";
const OPT_IN = `https://play.google.com/apps/testing/${PKG}`;
const STORE = `https://play.google.com/store/apps/details?id=${PKG}`;

function app(overrides = {}) {
  return {
    ownerId: "dev1",
    status: "approved",
    packageName: PKG,
    closedTestingUrl: OPT_IN,
    ...overrides,
  };
}

function confirmed(a) {
  return {
    ...a,
    setupConfirmation: {
      kind: SETUP_CONFIRMATION_KIND,
      confirmedBy: a.ownerId,
      fingerprint: setupFingerprint(a),
      groupId: appGroupId(a),
    },
  };
}

// ---------------------------------------------------------------------------
// URL and package checks
// ---------------------------------------------------------------------------

test("package names: dotted Java identifiers only", () => {
  for (const ok of ["com.example.app", "a.b", "com.Ex_1.app2"]) assert.equal(isValidPackageName(ok), true, ok);
  for (const bad of ["", "app", "1com.x", "com..x", "com.x.", ".com.x", "com.x-y", "com.x/y", null, 5, "a.".repeat(200) + "b"]) {
    assert.equal(isValidPackageName(bad), false, String(bad));
  }
});

test("a closed-testing opt-in URL names its package", () => {
  assert.equal(optInUrlPackage(OPT_IN), PKG);
  assert.equal(optInUrlPackage(`${OPT_IN}/`), PKG);
  assert.equal(optInUrlPackage(`  ${OPT_IN}  `), PKG);
  assert.equal(optInUrlPackage(`${OPT_IN}?hl=en`), PKG);
});

test("malformed or foreign opt-in URLs are refused", () => {
  for (const bad of [
    "",
    "   ",
    "not a url",
    `http://play.google.com/apps/testing/${PKG}`,
    `https://play.google.com.evil.com/apps/testing/${PKG}`,
    `https://evil.com/apps/testing/${PKG}`,
    `https://user:pw@play.google.com/apps/testing/${PKG}`,
    `https://play.google.com:8443/apps/testing/${PKG}`,
    "https://play.google.com/apps/testing/",
    "https://play.google.com/apps/testing/not-a-package",
    `https://play.google.com/apps/testing/${PKG}/extra`,
    `https://play.google.com/store/apps/details?id=${PKG}`,
    `javascript:alert(1)//play.google.com/apps/testing/${PKG}`,
    `https://play.google.com/apps/testing/${PKG}${"x".repeat(600)}`,
    null,
    42,
  ]) {
    assert.equal(optInUrlPackage(bad), null, String(bad));
  }
});

test("a Play listing URL names its package; anything else is refused", () => {
  assert.equal(playStoreUrlPackage(STORE), PKG);
  assert.equal(playStoreUrlPackage(`${STORE}&hl=en`), PKG);
  for (const bad of [
    "https://play.google.com/store/apps/details",
    "https://play.google.com/store/apps/details?id=bad",
    `https://play.google.com/store/apps/dev?id=${PKG}`,
    `http://play.google.com/store/apps/details?id=${PKG}`,
    `https://example.com/store/apps/details?id=${PKG}`,
    OPT_IN,
  ]) {
    assert.equal(playStoreUrlPackage(bad), null, bad);
  }
});

test("setup fields: the opt-in URL is required and must match the package", () => {
  assert.deepEqual(checkSetupFields(app()), []);
  assert.deepEqual(checkSetupFields(app({ closedTestingUrl: "" })), [READINESS.MISSING_OPT_IN_URL]);
  assert.deepEqual(checkSetupFields(app({ closedTestingUrl: "   " })), [READINESS.MISSING_OPT_IN_URL]);
  assert.deepEqual(checkSetupFields(app({ closedTestingUrl: undefined })), [READINESS.MISSING_OPT_IN_URL]);
  assert.deepEqual(
    checkSetupFields(app({ closedTestingUrl: "https://play.google.com/apps/testing/com.other.app" })),
    [READINESS.INVALID_OPT_IN_URL],
  );
  assert.deepEqual(checkSetupFields(app({ closedTestingUrl: "https://evil.com/x" })), [READINESS.INVALID_OPT_IN_URL]);
});

test("setup fields: the listing URL is optional, but checked when present", () => {
  assert.deepEqual(checkSetupFields(app({ playStoreUrl: "" })), []);
  assert.deepEqual(checkSetupFields(app({ playStoreUrl: STORE })), []);
  assert.deepEqual(checkSetupFields(app({ playStoreUrl: "https://evil.com" })), [READINESS.INVALID_PLAY_STORE_URL]);
  assert.deepEqual(
    checkSetupFields(app({ playStoreUrl: "https://play.google.com/store/apps/details?id=com.other.app" })),
    [READINESS.INVALID_PLAY_STORE_URL],
  );
});

test("setup fields: a missing or bad package name is its own gap", () => {
  assert.deepEqual(checkSetupFields(app({ packageName: "" })), [READINESS.INVALID_PACKAGE]);
  assert.deepEqual(checkSetupFields(app({ packageName: "nope" })), [READINESS.INVALID_PACKAGE]);
});

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

test("an approved app with valid links and a current confirmation is ready", () => {
  const r = checkAppReadiness(confirmed(app()));
  assert.deepEqual(r, { ready: true, gaps: [], confirmed: true });
  assert.equal(checkAppReadiness(confirmed(app({ playStoreUrl: STORE }))).ready, true);
});

test("valid links alone are not enough - the developer must self-confirm", () => {
  const r = checkAppReadiness(app());
  assert.equal(r.ready, false);
  assert.deepEqual(r.gaps, [READINESS.NOT_CONFIRMED]);
});

test("approval is still required", () => {
  for (const status of ["pendingReview", "rejected", "archived", undefined]) {
    const r = checkAppReadiness(confirmed(app({ status })));
    assert.equal(r.ready, false, String(status));
    assert.ok(r.gaps.includes(READINESS.NOT_APPROVED));
  }
  assert.equal(checkAppReadiness(null).ready, false);
});

test("editing any confirmed value makes the confirmation outdated", () => {
  const base = confirmed(app());
  for (const edit of [
    { closedTestingUrl: `${OPT_IN}/` },
    { playStoreUrl: STORE },
    { packageName: "com.example.app2", closedTestingUrl: "https://play.google.com/apps/testing/com.example.app2" },
    { activeGroupId: "some_other_group" },
  ]) {
    const r = checkAppReadiness({ ...base, ...edit });
    assert.equal(r.ready, false, JSON.stringify(edit));
    assert.deepEqual(r.gaps, [READINESS.CONFIRMATION_OUTDATED], JSON.stringify(edit));
  }
  // A cosmetic field outside the confirmed facts does not.
  assert.equal(checkAppReadiness({ ...base, appName: "Renamed", description: "x" }).ready, true);
});

test("a confirmation by anyone but the owner, or of the wrong kind, does not count", () => {
  const base = confirmed(app());
  const byOther = { ...base, setupConfirmation: { ...base.setupConfirmation, confirmedBy: "intruder" } };
  assert.deepEqual(checkAppReadiness(byOther).gaps, [READINESS.NOT_CONFIRMED]);
  const verified = { ...base, setupConfirmation: { ...base.setupConfirmation, kind: "verified" } };
  assert.deepEqual(checkAppReadiness(verified).gaps, [READINESS.NOT_CONFIRMED]);
  const junk = { ...base, setupConfirmation: true };
  assert.deepEqual(checkAppReadiness(junk).gaps, [READINESS.NOT_CONFIRMED]);
  // Ownership moving would invalidate it too.
  assert.deepEqual(checkAppReadiness({ ...base, ownerId: "newOwner" }).gaps, [READINESS.NOT_CONFIRMED]);
});

test("every gap is reported together", () => {
  const r = checkAppReadiness({ ownerId: "dev1", status: "pendingReview", packageName: "bad", closedTestingUrl: "" });
  assert.deepEqual(r.gaps, [
    READINESS.NOT_APPROVED,
    READINESS.INVALID_PACKAGE,
    READINESS.MISSING_OPT_IN_URL,
    READINESS.NOT_CONFIRMED,
  ]);
});

test("an app's testing group is its assigned one, else the official group", () => {
  assert.equal(appGroupId({}), OFFICIAL_GROUP_ID);
  assert.equal(appGroupId(null), OFFICIAL_GROUP_ID);
  assert.equal(appGroupId({ activeGroupId: "" }), OFFICIAL_GROUP_ID);
  assert.equal(appGroupId({ activeGroupId: "g2" }), "g2");
});

// ---------------------------------------------------------------------------
// Self-confirmation
// ---------------------------------------------------------------------------

const confirmBase = { callerId: "dev1", app: app(), closedTestConfigured: true, googleGroupAdded: true };

test("the owner may self-confirm valid setup, before or after approval", () => {
  assert.equal(checkConfirmSetup(confirmBase).ok, true);
  assert.equal(checkConfirmSetup({ ...confirmBase, app: app({ status: "pendingReview" }) }).ok, true);
});

test("only the owner may confirm", () => {
  for (const callerId of ["intruder", "", null]) {
    const v = checkConfirmSetup({ ...confirmBase, callerId });
    assert.equal(v.ok, false);
    assert.equal(v.code, "permission-denied");
  }
  assert.equal(checkConfirmSetup({ ...confirmBase, app: null }).code, "not-found");
});

test("both statements must be actively true - never defaulted", () => {
  for (const [a, b] of [[true, false], [false, true], [undefined, true], [true, "true"], [1, true], [null, null]]) {
    const v = checkConfirmSetup({ ...confirmBase, closedTestConfigured: a, googleGroupAdded: b });
    assert.equal(v.ok, false, `${a}/${b}`);
    assert.equal(v.reason, "confirmationIncomplete");
  }
});

test("a rejected or archived app cannot be confirmed", () => {
  for (const status of ["rejected", "archived"]) {
    assert.equal(checkConfirmSetup({ ...confirmBase, app: app({ status }) }).reason, "appClosed");
  }
});

test("broken links cannot be confirmed", () => {
  const v = checkConfirmSetup({ ...confirmBase, app: app({ closedTestingUrl: "https://evil.com" }) });
  assert.equal(v.ok, false);
  assert.equal(v.reason, "setupIncomplete");
  assert.deepEqual(v.gaps, [READINESS.INVALID_OPT_IN_URL]);
});

// ---------------------------------------------------------------------------
// Join prerequisites
// ---------------------------------------------------------------------------

const ready = confirmed(app());
const ownReady = confirmed(app({ ownerId: "tester1", packageName: "com.tester.app", closedTestingUrl: "https://play.google.com/apps/testing/com.tester.app" }));
const joinBase = { targetApp: ready, ownApps: [ownReady], hasGroupMembership: true };

test("a ready target, a ready own app and a group membership: may join", () => {
  assert.deepEqual(checkJoinPrerequisites(joinBase), { ok: true });
});

test("a target that is not ready is refused, with its gaps", () => {
  const v = checkJoinPrerequisites({ ...joinBase, targetApp: app() });
  assert.equal(v.reason, "targetNotReady");
  assert.deepEqual(v.gaps, [READINESS.NOT_CONFIRMED]);
  assert.equal(checkJoinPrerequisites({ ...joinBase, targetApp: { ...ready, closedTestingUrl: "" } }).reason, "targetNotReady");
});

test("no own app, or only own apps that are not ready, is refused", () => {
  assert.equal(checkJoinPrerequisites({ ...joinBase, ownApps: [] }).reason, "noEligibleOwnApp");
  assert.equal(checkJoinPrerequisites({ ...joinBase, ownApps: undefined }).reason, "noEligibleOwnApp");
  const pending = { ...ownReady, status: "pendingReview" };
  const unconfirmed = { ...ownReady, setupConfirmation: undefined };
  assert.equal(checkJoinPrerequisites({ ...joinBase, ownApps: [pending, unconfirmed] }).reason, "noEligibleOwnApp");
  // One ready app among several is enough.
  assert.equal(checkJoinPrerequisites({ ...joinBase, ownApps: [pending, ownReady] }).ok, true);
});

test("without the self-confirmed group membership, the tester is refused", () => {
  for (const hasGroupMembership of [false, undefined, "true", 1]) {
    assert.equal(checkJoinPrerequisites({ ...joinBase, hasGroupMembership }).reason, "groupNotJoined");
  }
});

// ---------------------------------------------------------------------------
// Callable guards (no database reached)
// ---------------------------------------------------------------------------

const noDb = new Proxy({}, { get() { throw new Error("database must not be touched"); } });

test("every setup callable refuses an unauthenticated caller before any read", async () => {
  for (const impl of [confirmAppTestingSetupImpl, getAppTestingReadinessImpl, getJoinEligibilityImpl]) {
    await assert.rejects(impl(noDb, { data: { appId: "app1" } }), (e) => e.code === "unauthenticated");
  }
});

test("every setup callable validates appId before any read", async () => {
  const auth = { uid: "u" };
  for (const impl of [confirmAppTestingSetupImpl, getAppTestingReadinessImpl, getJoinEligibilityImpl]) {
    for (const appId of [undefined, "", "a/b", 5]) {
      await assert.rejects(impl(noDb, { auth, data: { appId } }), (e) => e.code === "invalid-argument");
    }
  }
});

test("the three setup callables are exported and deployed in REGION", () => {
  for (const name of ["confirmAppTestingSetup", "getAppTestingReadiness", "getJoinEligibility"]) {
    assert.ok(functions[name], name);
    assert.deepEqual(functions[name].__endpoint.region, ["asia-south2"]);
    assert.ok(functions[name].__endpoint.callableTrigger, `${name} is a callable`);
  }
});

test("nothing in the setup vocabulary claims verification", () => {
  assert.equal(SETUP_CONFIRMATION_KIND, "selfConfirmed");
  const src = require("node:fs").readFileSync(require.resolve("../lib/setup"), "utf8")
    + require("node:fs").readFileSync(require.resolve("../setup"), "utf8");
  // "verified"/"verify" may appear only in comments explaining what is NOT done.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/verif/i.test(code), false, "no verification wording in executable code or messages");
});

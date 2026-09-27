/**
 * Batch 9D on a real Firestore: developer testing setup, readiness and the
 * join gate, with the capacity, wallet and rejoin rules it sits in front of.
 *
 * Nothing here uses the pre-9D fixture helper. Every precondition is reached
 * through production code: an app is created with exactly the fields the
 * client rules allow, approved by the real `adminSetAppStatus`, and its setup
 * self-confirmed by `confirmAppTestingSetup`; a tester joins the group through
 * the real `joinGroup` and is funded by a real admin grant; and every join is
 * the real claim transaction, through its callable impl.
 *
 * Run through `firebase emulators:exec` - see README.md.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { configureFirestore } = require("../lib/firestore");

const { runAdminGrant, runWalletReconciliation } = require("../wallet");
const {
  joinTestingAssignmentImpl,
  runClaimCommitment,
  runCancelCommitment,
} = require("../commitments");
const { runRecordTestingDay } = require("../testingDays");
const { runExpirySweep } = require("../expiry");
const {
  confirmAppTestingSetupImpl,
  getAppTestingReadinessImpl,
  getJoinEligibilityImpl,
} = require("../setup");
const { adminSetAppStatus } = require("../admin");
const { joinGroup } = require("../groups");
const { runCommitmentStatus } = require("../progress");
const { submitTestingFeedbackImpl } = require("../feedback");
const { activeClaimId, cycleAssignmentId } = require("../lib/commitments");
const { addDays, startOfLocalDayMillis } = require("../lib/testingDays");
const { checkInvariants } = require("../lib/wallet");
const { OFFICIAL_GROUP_ID, REQUIRED_TESTER_COUNT, COIN_KIND_LOCK } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const ADMIN = "admin1";
const DEV = "dev1";
const TESTER = "tester1";
const TARGET = "target";
const HOUR = 3600 * 1000;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.",
  );
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
// The production transport (lib/firestore.js), or these tests would not
// exercise what production runs.
const db = configureFirestore(getFirestore());

async function clearFirestore() {
  const url =
    `http://${process.env.FIRESTORE_EMULATOR_HOST}` +
    `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear emulator: ${res.status}`);
}

test.beforeEach(clearFirestore);

// ---------------------------------------------------------------------------
// The real developer and tester journeys
// ---------------------------------------------------------------------------

const pkgOf = (appId) => `com.test.${appId.replace(/[^A-Za-z0-9_]/g, "_")}`;
const optInFor = (pkg) => `https://play.google.com/apps/testing/${pkg}`;
const as = (uid, data) => ({ auth: { uid }, data });

/** A developer submits an app: exactly the client-writable create. */
async function submitApp(ownerId, appId, overrides = {}) {
  const pkg = overrides.packageName || pkgOf(appId);
  await db.doc(`apps/${appId}`).set({
    ownerId,
    appName: appId,
    packageName: pkg,
    closedTestingUrl: optInFor(pkg),
    description: "",
    status: "pendingReview",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });
}

const approve = (appId) =>
  adminSetAppStatus.run(as(ADMIN, { appId, status: "approved" }));

const confirmSetup = (uid, appId, flags = {}) =>
  confirmAppTestingSetupImpl(db, as(uid, {
    appId,
    closedTestConfigured: true,
    googleGroupAdded: true,
    ...flags,
  }));

const joinOfficialGroup = (uid) => joinGroup.run(as(uid, { groupId: OFFICIAL_GROUP_ID }));

async function user(uid, extra = {}) {
  await db.doc(`users/${uid}`).set({ uid, ...extra });
}

async function fund(uid, amount = 50) {
  await runAdminGrant(db, {
    targetUserId: uid,
    amount,
    reason: "setup emulator test",
    idempotencyKey: `seed_${uid}_${amount}`,
    adminUid: ADMIN,
  });
}

async function world() {
  await user(ADMIN, { role: "admin" });
  await user(DEV);
  await submitApp(DEV, TARGET);
  await approve(TARGET);
  await confirmSetup(DEV, TARGET);
}

/**
 * A tester who did everything right: their own app approved and its setup
 * self-confirmed, the group joined, and `coins` granted.
 */
async function readyTester(uid, { coins = 50, group = true, ownApp = "confirmed" } = {}) {
  await user(uid);
  if (ownApp) {
    const own = `own_${uid}`;
    await submitApp(uid, own);
    if (ownApp !== "pending") await approve(own);
    if (ownApp === "confirmed") await confirmSetup(uid, own);
  }
  if (group) await joinOfficialGroup(uid);
  if (coins > 0) await fund(uid, coins);
}

const join = (uid, appId = TARGET) => joinTestingAssignmentImpl(db, as(uid, { appId }));

async function refusal(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error("expected a refusal");
}

/** The whole footprint a refused join must leave untouched. */
async function footprint(uid, appId = TARGET) {
  const [app, wallet, claim, ledger, assignments] = await Promise.all([
    db.doc(`apps/${appId}`).get(),
    db.doc(`users/${uid}/wallet/balance`).get(),
    db.doc(`activeClaims/${activeClaimId(appId, uid)}`).get(),
    db.collection(`users/${uid}/coinTransactions`).get(),
    db.collection("testingAssignments").where("testerId", "==", uid).get(),
  ]);
  return {
    testerCount: app.exists ? (app.get("testerCount") || 0) : null,
    wallet: wallet.exists ? wallet.data() : null,
    claim: claim.exists,
    ledger: ledger.docs.map((d) => d.id).sort(),
    assignments: assignments.docs.map((d) => d.id).sort(),
  };
}

async function assertRefusedCleanly(uid, promise, check, appId = TARGET) {
  const before = await footprint(uid, appId);
  const err = await refusal(promise);
  check(err);
  assert.deepEqual(await footprint(uid, appId), before, "a refused join changes nothing");
  return err;
}

async function assertReconciled(uid) {
  const report = await runWalletReconciliation(db, { userId: uid });
  assert.equal(report.matches, true, JSON.stringify(report.differences));
  const w = (await db.doc(`users/${uid}/wallet/balance`).get()).data();
  assert.equal(checkInvariants(w).ok, true);
  return w;
}

const testerCount = async (appId = TARGET) => (await db.doc(`apps/${appId}`).get()).get("testerCount") || 0;

// ---------------------------------------------------------------------------
// Developer setup and readiness
// ---------------------------------------------------------------------------

test("setup: a submitted app is not ready until approved AND self-confirmed", async () => {
  await user(ADMIN, { role: "admin" });
  await user(DEV);
  await submitApp(DEV, TARGET);

  let r = await getAppTestingReadinessImpl(db, as(DEV, { appId: TARGET }));
  assert.equal(r.ready, false);
  assert.deepEqual(r.gaps, ["notApproved", "setupNotConfirmed"]);

  // Confirming before approval is allowed; readiness still waits for approval.
  const c = await confirmSetup(DEV, TARGET);
  assert.equal(c.confirmed, true);
  assert.equal(c.kind, "selfConfirmed");
  assert.equal(c.ready, false);
  r = await getAppTestingReadinessImpl(db, as(DEV, { appId: TARGET }));
  assert.deepEqual(r.gaps, ["notApproved"]);

  await approve(TARGET);
  r = await getAppTestingReadinessImpl(db, as(DEV, { appId: TARGET }));
  assert.equal(r.ready, true);
  assert.deepEqual(r.gaps, []);
  assert.equal(r.groupId, OFFICIAL_GROUP_ID);
  assert.equal(r.groupEmail, "developerapptesting@googlegroups.com");
  assert.equal(r.confirmation.kind, "selfConfirmed");
  assert.equal(r.confirmation.current, true);
  assert.equal(/verif/i.test(JSON.stringify(r)), false, "never described as verified");
});

test("setup: the stored confirmation records who, when and what - as a statement", async () => {
  await world();
  const c = (await db.doc(`apps/${TARGET}`).get()).get("setupConfirmation");
  assert.equal(c.kind, "selfConfirmed");
  assert.equal(c.confirmedBy, DEV);
  assert.ok(c.confirmedAt.toMillis() > 0);
  assert.equal(c.groupId, OFFICIAL_GROUP_ID);
  assert.equal(c.groupEmail, "developerapptesting@googlegroups.com");
  assert.equal(c.closedTestConfigured, true);
  assert.equal(c.googleGroupAdded, true);
  assert.match(c.fingerprint, /^[0-9a-f]{64}$/);
});

test("setup: missing, malformed or foreign links cannot be confirmed", async () => {
  await user(DEV);
  const cases = [
    ["noUrl", { closedTestingUrl: "" }, ["missingOptInUrl"]],
    ["blank", { closedTestingUrl: "   " }, ["missingOptInUrl"]],
    ["http", { closedTestingUrl: "http://play.google.com/apps/testing/com.test.http" }, ["invalidOptInUrl"]],
    ["evil", { closedTestingUrl: "https://evil.example/apps/testing/com.test.evil" }, ["invalidOptInUrl"]],
    ["other", { closedTestingUrl: "https://play.google.com/apps/testing/com.someone.else" }, ["invalidOptInUrl"]],
    ["store", { playStoreUrl: "https://play.google.com/store/apps/details?id=com.someone.else" }, ["invalidPlayStoreUrl"]],
    ["pkg", { packageName: "notapackage", closedTestingUrl: "https://play.google.com/apps/testing/com.x.y" }, ["invalidPackageName"]],
  ];
  for (const [appId, overrides, gaps] of cases) {
    await submitApp(DEV, appId, overrides);
    const err = await refusal(confirmSetup(DEV, appId));
    assert.equal(err.code, "failed-precondition", appId);
    assert.deepEqual(err.details.gaps, gaps, appId);
    assert.equal((await db.doc(`apps/${appId}`).get()).get("setupConfirmation"), undefined, appId);
  }
  // A correct listing URL is accepted alongside the opt-in URL.
  await submitApp(DEV, "withStore", { playStoreUrl: `https://play.google.com/store/apps/details?id=${pkgOf("withStore")}` });
  assert.equal((await confirmSetup(DEV, "withStore")).confirmed, true);
});

test("setup: both statements must be actively confirmed", async () => {
  await user(DEV);
  await submitApp(DEV, TARGET);
  for (const flags of [{ closedTestConfigured: false }, { googleGroupAdded: false }, { closedTestConfigured: "true" }, { googleGroupAdded: undefined }]) {
    const err = await refusal(confirmSetup(DEV, TARGET, flags));
    assert.equal(err.code, "invalid-argument", JSON.stringify(flags));
  }
  assert.equal((await db.doc(`apps/${TARGET}`).get()).get("setupConfirmation"), undefined);
});

test("setup: only the owner may confirm or read readiness; admins may read", async () => {
  await world();
  await user("intruder");
  const err = await refusal(confirmSetup("intruder", TARGET));
  assert.equal(err.code, "permission-denied");
  const denied = await refusal(getAppTestingReadinessImpl(db, as("intruder", { appId: TARGET })));
  assert.equal(denied.code, "permission-denied");
  const adminView = await getAppTestingReadinessImpl(db, as(ADMIN, { appId: TARGET }));
  assert.equal(adminView.ready, true);
  const missing = await refusal(getAppTestingReadinessImpl(db, as(DEV, { appId: "nope" })));
  assert.equal(missing.code, "not-found");
});

test("setup: a suspended developer cannot confirm; rejected and archived apps cannot be", async () => {
  await user(ADMIN, { role: "admin" });
  await user(DEV, { isSuspended: true });
  await submitApp(DEV, TARGET);
  assert.equal((await refusal(confirmSetup(DEV, TARGET))).code, "permission-denied");

  await user("dev2");
  for (const status of ["rejected", "archived"]) {
    await submitApp("dev2", status, { status });
    const err = await refusal(confirmSetup("dev2", status));
    assert.equal(err.details.reason, "appClosed");
  }
});

test("setup: editing a confirmed link makes the app not ready until reconfirmed", async () => {
  await world();
  await readyTester(TESTER);
  await db.doc(`apps/${TARGET}`).update({ closedTestingUrl: `${optInFor(pkgOf(TARGET))}/` });

  const r = await getAppTestingReadinessImpl(db, as(DEV, { appId: TARGET }));
  assert.deepEqual(r.gaps, ["setupConfirmationOutdated"]);
  assert.equal(r.confirmation.current, false);

  await assertRefusedCleanly(TESTER, join(TESTER), (e) => {
    assert.equal(e.code, "failed-precondition");
    assert.equal(e.details.reason, "targetNotReady");
    assert.deepEqual(e.details.gaps, ["setupConfirmationOutdated"]);
  });

  await confirmSetup(DEV, TARGET);
  assert.equal((await join(TESTER)).claimed, true);
});

test("setup: a confirmation racing an edit never certifies values nobody checked", async () => {
  await world();
  for (let round = 1; round <= 5; round += 1) {
    const url = `${optInFor(pkgOf(TARGET))}${round % 2 ? "/" : ""}`;
    await Promise.allSettled([
      confirmSetup(DEV, TARGET),
      db.doc(`apps/${TARGET}`).update({ closedTestingUrl: url }),
    ]);
    const r = await getAppTestingReadinessImpl(db, as(DEV, { appId: TARGET }));
    // Either the confirmation landed after the edit (ready), or the edit
    // landed after it (outdated). Never a stale confirmation reading as current.
    assert.ok(
      (r.ready && r.confirmation.current) || (!r.ready && r.gaps.includes("setupConfirmationOutdated")),
      `round ${round}: ${JSON.stringify(r.gaps)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The join gate
// ---------------------------------------------------------------------------

test("join: a fully prepared tester joins; 50 coins locked, one slot, one of everything", async () => {
  await world();
  await readyTester(TESTER);
  const out = await join(TESTER);
  assert.equal(out.claimed, true);
  assert.equal(out.commitmentAmount, 50);
  assert.equal(await testerCount(), 1);
  const w = await assertReconciled(TESTER);
  assert.equal(w.available, 0);
  assert.equal(w.locked, 50);
  const f = await footprint(TESTER);
  assert.equal(f.claim, true);
  assert.deepEqual(f.assignments, [cycleAssignmentId(TARGET, TESTER, 1)]);
  assert.equal(f.ledger.filter((id) => id.startsWith("lock_")).length, 1);
});

test("join: unauthenticated is refused before anything is read", async () => {
  await world();
  const err = await refusal(joinTestingAssignmentImpl(db, { data: { appId: TARGET } }));
  assert.equal(err.code, "unauthenticated");
  assert.equal(await testerCount(), 0);
});

test("join: no own app at all is refused and changes nothing", async () => {
  await world();
  await readyTester(TESTER, { ownApp: null });
  await assertRefusedCleanly(TESTER, join(TESTER), (e) => assert.equal(e.details.reason, "noEligibleOwnApp"));
});

test("join: an own app that is pending, unconfirmed or outdated does not count", async () => {
  await world();
  await readyTester("pending", { ownApp: "pending" });
  await readyTester("unconfirmed", { ownApp: "approved" });
  await readyTester("outdated");
  await db.doc("apps/own_outdated").update({ closedTestingUrl: `${optInFor(pkgOf("own_outdated"))}/` });
  for (const uid of ["pending", "unconfirmed", "outdated"]) {
    await assertRefusedCleanly(uid, join(uid), (e) => assert.equal(e.details.reason, "noEligibleOwnApp", uid));
  }
  // Fixing it is enough.
  await confirmSetup("outdated", "own_outdated");
  assert.equal((await join("outdated")).claimed, true);
});

test("join: without the self-confirmed group membership the tester is refused", async () => {
  await world();
  await readyTester(TESTER, { group: false });
  await assertRefusedCleanly(TESTER, join(TESTER), (e) => assert.equal(e.details.reason, "groupNotJoined"));
  await joinOfficialGroup(TESTER);
  assert.equal((await join(TESTER)).claimed, true);
});

test("join: a suspended tester is refused", async () => {
  await world();
  await readyTester(TESTER);
  await db.doc(`users/${TESTER}`).update({ isSuspended: true });
  await assertRefusedCleanly(TESTER, join(TESTER), (e) => assert.equal(e.code, "permission-denied"));
});

test("join: a missing target app is refused", async () => {
  await world();
  await readyTester(TESTER);
  await assertRefusedCleanly(TESTER, join(TESTER, "ghost"), (e) => assert.equal(e.code, "not-found"), "ghost");
});

test("join: a developer can never join their own app - even a ready one", async () => {
  await world();
  await readyTester(TESTER);
  await assertRefusedCleanly(TESTER, join(TESTER, `own_${TESTER}`), (e) => {
    assert.equal(e.code, "failed-precondition");
    assert.match(e.message, /your own app/);
  }, `own_${TESTER}`);
});

test("join: a target that is not approved, or approved but not confirmed, is refused", async () => {
  await user(ADMIN, { role: "admin" });
  await user(DEV);
  await readyTester(TESTER);

  await submitApp(DEV, "pending");
  await confirmSetup(DEV, "pending");
  await assertRefusedCleanly(TESTER, join(TESTER, "pending"), (e) => assert.match(e.message, /not open for testing/), "pending");

  await submitApp(DEV, "unconfirmed");
  await approve("unconfirmed");
  await assertRefusedCleanly(TESTER, join(TESTER, "unconfirmed"), (e) => {
    assert.equal(e.details.reason, "targetNotReady");
    assert.deepEqual(e.details.gaps, ["setupNotConfirmed"]);
  }, "unconfirmed");

  // An approved app whose opt-in link was removed after confirming.
  await submitApp(DEV, "unlinked");
  await approve("unlinked");
  await confirmSetup(DEV, "unlinked");
  await db.doc("apps/unlinked").update({ closedTestingUrl: "" });
  await assertRefusedCleanly(TESTER, join(TESTER, "unlinked"), (e) => {
    assert.equal(e.details.reason, "targetNotReady");
    assert.deepEqual(e.details.gaps, ["missingOptInUrl", "setupConfirmationOutdated"]);
  }, "unlinked");
});

test("join: the request cannot supply eligibility, ownership, coins or capacity", async () => {
  await world();
  await readyTester(TESTER, { ownApp: null });
  const err = await refusal(joinTestingAssignmentImpl(db, as(TESTER, {
    appId: TARGET,
    hasEligibleOwnApp: true,
    ready: true,
    developerId: "someoneElse",
    testerId: "victim",
    testerCount: 0,
    available: 1000,
    commitmentAmount: 1,
  })));
  assert.equal(err.details.reason, "noEligibleOwnApp");
  assert.equal(await testerCount(), 0);
});

test("join: insufficient coins is refused and nothing moves", async () => {
  await world();
  await readyTester(TESTER, { coins: 49 });
  await assertRefusedCleanly(TESTER, join(TESTER), (e) => assert.equal(e.code, "failed-precondition"));
  const w = await assertReconciled(TESTER);
  assert.equal(w.available, 49);
  assert.equal(w.locked, 0);
});

test("join: an active commitment blocks a second join; a completed one does not", async () => {
  await world();
  await readyTester(TESTER, { coins: 100 });
  const first = await join(TESTER);
  await assertRefusedCleanly(TESTER, join(TESTER), (e) => assert.equal(e.code, "already-exists"));

  // Complete cycle 1 with 14 real check-ins, then start cycle 2.
  const a = (await db.doc(`testingAssignments/${first.assignmentId}`).get()).data();
  for (let n = 1; n <= 14; n += 1) {
    await runRecordTestingDay(db, {
      assignmentId: first.assignmentId,
      testerId: TESTER,
      nowMillis: startOfLocalDayMillis(addDays(a.firstEligibleDayKey, n - 1), a.timeZone) + 12 * HOUR,
    });
  }
  assert.equal((await db.doc(`testingAssignments/${first.assignmentId}`).get()).get("status"), "completed");
  const second = await join(TESTER);
  assert.equal(second.cycle, 2);
  // A completed tester keeps their slot, and the new cycle does not take another.
  assert.equal(await testerCount(), 1);
  await assertReconciled(TESTER);
});

test("eligibility: the advisory read agrees with what the claim then decides, and writes nothing", async () => {
  await world();
  await readyTester("good");
  await readyTester("noApp", { ownApp: null });
  await readyTester("noGroup", { group: false });
  await readyTester("poor", { coins: 10 });

  const expect = {
    good: [],
    noApp: ["noEligibleOwnApp"],
    noGroup: ["groupNotJoined"],
    poor: ["insufficientCoins"],
  };
  for (const [uid, blockers] of Object.entries(expect)) {
    const before = await footprint(uid);
    const e = await getJoinEligibilityImpl(db, as(uid, { appId: TARGET }));
    assert.deepEqual(e.blockers, blockers, uid);
    assert.equal(e.canJoin, blockers.length === 0, uid);
    assert.equal(e.commitmentAmount, 50);
    assert.equal(e.capacity, 16);
    assert.deepEqual(await footprint(uid), before, `${uid}: the read wrote nothing`);
    const outcome = await join(uid).then(() => "joined", () => "refused");
    assert.equal(outcome, blockers.length === 0 ? "joined" : "refused", uid);
  }

  const own = await getJoinEligibilityImpl(db, as(DEV, { appId: TARGET }));
  assert.ok(own.blockers.includes("ownApp"));
  const dup = await getJoinEligibilityImpl(db, as("good", { appId: TARGET }));
  assert.deepEqual(dup.blockers, ["alreadyJoined", "insufficientCoins"]);
});

// ---------------------------------------------------------------------------
// 16-tester capacity
// ---------------------------------------------------------------------------

test("capacity: slots 1, 15 and 16 succeed, the 17th is refused cleanly", async () => {
  await world();
  const testers = Array.from({ length: 17 }, (_, i) => `t${i + 1}`);
  for (const t of testers) await readyTester(t);

  for (const [i, t] of testers.slice(0, 16).entries()) {
    await join(t);
    assert.equal(await testerCount(), i + 1, `slot ${i + 1}`);
  }
  assert.equal(await testerCount(), REQUIRED_TESTER_COUNT);
  await assertRefusedCleanly("t17", join("t17"), (e) => {
    assert.equal(e.code, "resource-exhausted");
    assert.match(e.message, /all the testers it needs/);
  });
  assert.equal(await testerCount(), 16);
  const e17 = await getJoinEligibilityImpl(db, as("t17", { appId: TARGET }));
  assert.deepEqual(e17.blockers, ["capacityFull"]);
  assert.equal(e17.slotsLeft, 0);
});

test("capacity: racers for the final slot - exactly one wins, across 5 rounds", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await world();
    await db.doc(`apps/${TARGET}`).update({ testerCount: REQUIRED_TESTER_COUNT - 1 });
    const racers = ["r1", "r2", "r3", "r4", "r5"];
    for (const r of racers) await readyTester(r);

    const results = await Promise.allSettled(racers.map((r) => join(r)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, `round ${round}`);
    for (const r of results) {
      if (r.status === "rejected") assert.equal(r.reason.code, "resource-exhausted", `round ${round}: ${r.reason.message}`);
    }
    assert.equal(await testerCount(), REQUIRED_TESTER_COUNT, `round ${round}: never above 16`);
    for (const r of racers) await assertReconciled(r);
  }
});

test("capacity: one tester double-tapping join gets one commitment, one lock, one slot", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await world();
    await readyTester(TESTER, { coins: 500 });
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => join(TESTER)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, `round ${round}`);
    const f = await footprint(TESTER);
    assert.equal(f.assignments.length, 1, `round ${round}`);
    assert.equal(f.ledger.filter((id) => id.startsWith("lock_")).length, 1, `round ${round}`);
    assert.equal(await testerCount(), 1, `round ${round}`);
    const w = await assertReconciled(TESTER);
    assert.equal(w.locked, 50);
  }
});

// ---------------------------------------------------------------------------
// Cancellation, forfeiture and rejoin
// ---------------------------------------------------------------------------

test("rejoin: cancel releases the slot once and returns 50; rejoin stakes 50 once", async () => {
  await world();
  await readyTester(TESTER);
  const one = await join(TESTER);

  const racing = await Promise.allSettled([
    runCancelCommitment(db, { assignmentId: one.assignmentId, actorId: TESTER, actorKind: "user", nowMillis: Date.now() }),
    runCancelCommitment(db, { assignmentId: one.assignmentId, actorId: TESTER, actorKind: "user", nowMillis: Date.now() }),
  ]);
  assert.equal(racing.filter((r) => r.status === "fulfilled").length, 1, "one cancel lands");
  assert.equal(await testerCount(), 0, "released exactly once, never negative");
  let w = await assertReconciled(TESTER);
  assert.equal(w.available, 50);
  assert.equal(w.locked, 0);

  const two = await join(TESTER);
  assert.equal(two.cycle, 2);
  assert.equal(await testerCount(), 1);
  w = await assertReconciled(TESTER);
  assert.equal(w.available, 0);
  assert.equal(w.locked, 50);
  const ledger = await db.collection(`users/${TESTER}/coinTransactions`).get();
  const locks = ledger.docs.filter((d) => d.get("kind") === COIN_KIND_LOCK).map((d) => d.id).sort();
  assert.deepEqual(locks, [`lock_${one.assignmentId}`, `lock_${two.assignmentId}`].sort());
});

test("rejoin: after a third-miss forfeiture the slot is free and a new stake is taken", async () => {
  await world();
  await readyTester(TESTER, { coins: 100 });
  const one = await join(TESTER);
  const a = (await db.doc(`testingAssignments/${one.assignmentId}`).get()).data();
  await runExpirySweep(db, { nowMillis: startOfLocalDayMillis(addDays(a.firstEligibleDayKey, 3), a.timeZone) + 12 * HOUR });
  assert.equal((await db.doc(`testingAssignments/${one.assignmentId}`).get()).get("failureReason"), "tooManyMisses");
  assert.equal(await testerCount(), 0);
  let w = await assertReconciled(TESTER);
  assert.equal(w.forfeitedTotal, 50);
  assert.equal(w.available, 50);

  const two = await join(TESTER);
  assert.equal(two.cycle, 2);
  assert.equal(await testerCount(), 1);
  w = await assertReconciled(TESTER);
  assert.equal(w.locked, 50);
  assert.equal(w.available, 0);
});

test("rejoin: concurrent rejoins after a cancellation create one new commitment", async () => {
  for (let round = 1; round <= 5; round += 1) {
    await clearFirestore();
    await world();
    await readyTester(TESTER, { coins: 200 });
    const one = await join(TESTER);
    await runCancelCommitment(db, { assignmentId: one.assignmentId, actorId: TESTER, actorKind: "user", nowMillis: Date.now() });

    const results = await Promise.allSettled(Array.from({ length: 5 }, () => join(TESTER)));
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, `round ${round}`);
    const f = await footprint(TESTER);
    assert.equal(f.assignments.length, 2, `round ${round}: cycle 1 and one cycle 2`);
    assert.equal(await testerCount(), 1, `round ${round}`);
    const w = await assertReconciled(TESTER);
    assert.equal(w.locked, 50, `round ${round}`);
    assert.equal(w.available, 150, `round ${round}`);
  }
});

test("rejoin: a released slot goes to a different waiting tester exactly once", async () => {
  await world();
  await db.doc(`apps/${TARGET}`).update({ testerCount: REQUIRED_TESTER_COUNT - 1 });
  await readyTester("holder");
  await readyTester("w1");
  await readyTester("w2");
  const held = await join("holder");
  await assertRefusedCleanly("w1", join("w1"), (e) => assert.equal(e.code, "resource-exhausted"));

  await runCancelCommitment(db, { assignmentId: held.assignmentId, actorId: "holder", actorKind: "user", nowMillis: Date.now() });
  assert.equal(await testerCount(), REQUIRED_TESTER_COUNT - 1);
  const results = await Promise.allSettled([join("w1"), join("w2"), join("holder")]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await testerCount(), REQUIRED_TESTER_COUNT);
});

// ---------------------------------------------------------------------------
// 9B and 9C still hold on top of the gate
// ---------------------------------------------------------------------------

test("regression: status reads and feedback work unchanged for a gated join", async () => {
  await world();
  await readyTester(TESTER);
  const one = await join(TESTER);
  const a = (await db.doc(`testingAssignments/${one.assignmentId}`).get()).data();
  const day1 = startOfLocalDayMillis(a.firstEligibleDayKey, a.timeZone) + 12 * HOUR;
  await runRecordTestingDay(db, { assignmentId: one.assignmentId, testerId: TESTER, nowMillis: day1 });

  const s = (await runCommitmentStatus(db, { testerId: TESTER, appId: TARGET, nowMillis: day1 })).commitment;
  assert.equal(s.state, "testing");
  assert.equal(s.qualifyingDays, 1);
  assert.equal(s.windowDays, 16);
  assert.equal(s.allowedMisses, 2);

  const before = await footprint(TESTER);
  const fb = await submitTestingFeedbackImpl(db, as(TESTER, { assignmentId: one.assignmentId, rating: 5 }));
  assert.equal(fb.submitted, true);
  assert.deepEqual(await footprint(TESTER), before, "feedback touches no join state");

  // Legacy direct runClaimCommitment callers go through the same gate.
  await readyTester("bare", { ownApp: null, group: false });
  await assert.rejects(runClaimCommitment(db, { appId: TARGET, testerId: "bare" }), (e) => e.details.reason === "noEligibleOwnApp");
});

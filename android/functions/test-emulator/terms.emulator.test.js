/**
 * Terms of Service + Privacy Policy acceptance on a real Firestore (release
 * audit F2): the acceptTerms transaction, and the refusal at every entry point
 * that starts something new - with nothing written - while an existing
 * commitment keeps working.
 *
 * "Not accepted" is modelled the realistic way: a user who accepted an OLDER
 * Terms version (what every user becomes when TERMS_VERSION is bumped).
 *
 * Run through `firebase emulators:exec` - see README.md.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { configureFirestore } = require("../lib/firestore");

const { runAcceptTerms } = require("../terms");
const { runAdminGrant } = require("../wallet");
const { joinTestingAssignmentImpl, cancelTestingAssignmentImpl } = require("../commitments");
const { runRecordTestingDay } = require("../testingDays");
const { confirmAppTestingSetupImpl } = require("../setup");
const { submitTestingFeedbackImpl } = require("../feedback");
const { runStartQuickTest } = require("../quickTests");
const { joinGroup } = require("../groups");
const { activeClaimId, cycleAssignmentId } = require("../lib/commitments");
const { startOfLocalDayMillis } = require("../lib/testingDays");
const { OFFICIAL_GROUP_ID, TERMS_VERSION } = require("../lib/constants");
const { readyAppDoc, seedJoinReady } = require("../test/joinReady");

const PROJECT_ID = "apptesting-concurrency-test";
const ADMIN = "admin1";
const DEV = "dev1";
const TESTER = "tester1";
const TARGET = "target";
const HOUR = 3600 * 1000;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.");
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = configureFirestore(getFirestore());

async function clearFirestore() {
  const url =
    `http://${process.env.FIRESTORE_EMULATOR_HOST}` +
    `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear emulator: ${res.status}`);
}

test.beforeEach(clearFirestore);

const as = (uid, data) => ({ auth: { uid }, data });
const OLD_ACCEPTANCE = { termsAcceptedVersion: TERMS_VERSION - 1, termsAcceptedAt: Timestamp.fromMillis(0) };

async function refusal(promise) {
  try {
    await promise;
  } catch (err) {
    return { code: err.code, reason: err.details && err.details.reason };
  }
  return "resolved";
}
const TERMS_REFUSAL = { code: "failed-precondition", reason: "termsNotAccepted" };

const read = async (p) => (await db.doc(p).get()).data();
const exists = async (p) => (await db.doc(p).get()).exists;

/** A join-ready, funded tester whose acceptance is of an OLDER Terms version. */
async function world() {
  await db.doc(`users/${ADMIN}`).set({ uid: ADMIN, role: "admin" });
  await db.doc(`users/${DEV}`).set({ uid: DEV });
  await runAcceptTerms(db, { uid: DEV, version: TERMS_VERSION });
  await db.doc(`apps/${TARGET}`).set(readyAppDoc(TARGET, { ownerId: DEV, status: "approved", appName: "Target", testerCount: 0 }));
  await db.doc(`users/${TESTER}`).set({ uid: TESTER });
  await seedJoinReady(db, TESTER);
  await db.doc(`users/${TESTER}`).set(OLD_ACCEPTANCE, { merge: true });
  await runAdminGrant(db, {
    targetUserId: TESTER,
    amount: 50,
    reason: "terms emulator test",
    idempotencyKey: `seed_${TESTER}`,
    adminUid: ADMIN,
  });
}

const join = (uid, appId = TARGET) => joinTestingAssignmentImpl(db, as(uid, { appId }));
const wallet = (uid) => read(`users/${uid}/wallet/balance`);

// ---------------------------------------------------------------------------
// acceptTerms
// ---------------------------------------------------------------------------

test("F2: acceptTerms records the current version at the server's time, once", async () => {
  await db.doc("users/u1").set({ uid: "u1", displayName: "U" });
  const before = Date.now();
  const first = await runAcceptTerms(db, { uid: "u1", version: TERMS_VERSION });
  assert.deepEqual(first, { accepted: true, version: TERMS_VERSION, alreadyAccepted: false });

  const stored = await read("users/u1");
  assert.equal(stored.termsAcceptedVersion, TERMS_VERSION);
  assert.ok(stored.termsAcceptedAt instanceof Timestamp, "a real server timestamp");
  assert.ok(stored.termsAcceptedAt.toMillis() >= before - 5000, "stamped now, by the server");
  assert.equal(stored.displayName, "U", "the rest of the profile is untouched");

  const again = await runAcceptTerms(db, { uid: "u1", version: TERMS_VERSION });
  assert.equal(again.alreadyAccepted, true);
  assert.ok((await read("users/u1")).termsAcceptedAt.isEqual(stored.termsAcceptedAt), "the original time never moves");
});

test("F2: acceptTerms never invents a profile", async () => {
  assert.deepEqual(await refusal(runAcceptTerms(db, { uid: "ghost", version: TERMS_VERSION })), {
    code: "failed-precondition",
    reason: "profileMissing",
  });
  assert.equal(await exists("users/ghost"), false);
});

// ---------------------------------------------------------------------------
// Enforcement - each refusal leaves no trace
// ---------------------------------------------------------------------------

test("F2: a tester on an older Terms version cannot start a commitment, and nothing moves", async () => {
  await world();
  assert.deepEqual(await refusal(join(TESTER)), TERMS_REFUSAL);

  const w = await wallet(TESTER);
  assert.equal(w.available, 50);
  assert.equal(w.locked, 0);
  assert.equal(await exists(`testingAssignments/${cycleAssignmentId(TARGET, TESTER, 1)}`), false);
  assert.equal(await exists(`activeClaims/${activeClaimId(TARGET, TESTER)}`), false);
  assert.equal((await read(`apps/${TARGET}`)).testerCount, 0);

  // Accepting the current version through the real callable path unblocks it.
  await runAcceptTerms(db, { uid: TESTER, version: TERMS_VERSION });
  const out = await join(TESTER);
  assert.equal(out.assignmentId, cycleAssignmentId(TARGET, TESTER, 1));
  assert.equal((await wallet(TESTER)).locked, 50);
});

test("F2: a new user cannot self-confirm the official Google Group before accepting", async () => {
  await db.doc("users/newbie").set({ uid: "newbie" });
  const joinOfficial = () => joinGroup.run(as("newbie", { groupId: OFFICIAL_GROUP_ID }));
  assert.deepEqual(await refusal(joinOfficial()), TERMS_REFUSAL);
  assert.equal(await exists(`users/newbie/memberships/${OFFICIAL_GROUP_ID}`), false);

  await runAcceptTerms(db, { uid: "newbie", version: TERMS_VERSION });
  assert.equal((await joinOfficial()).joined, true);
});

test("F2: a developer on an older Terms version cannot confirm their testing setup", async () => {
  await world();
  await db.doc(`users/${DEV}`).set(OLD_ACCEPTANCE, { merge: true });
  const before = (await read(`apps/${TARGET}`)).setupConfirmation;
  const confirm = () =>
    confirmAppTestingSetupImpl(db, as(DEV, { appId: TARGET, closedTestConfigured: true, googleGroupAdded: true }));
  assert.deepEqual(await refusal(confirm()), TERMS_REFUSAL);
  assert.deepEqual((await read(`apps/${TARGET}`)).setupConfirmation, before, "the confirmation is untouched");
});

test("F2: feedback cannot be submitted on an older Terms version", async () => {
  await world();
  const submit = submitTestingFeedbackImpl(db, as(TESTER, {
    assignmentId: cycleAssignmentId(TARGET, TESTER, 1),
    rating: 4,
    comment: "fine",
  }));
  assert.deepEqual(await refusal(submit), TERMS_REFUSAL);
  assert.equal(await exists(`feedback/${cycleAssignmentId(TARGET, TESTER, 1)}`), false);
});

test("F2: a Quick Test cannot be started on an older Terms version", async () => {
  await world();
  await db.doc("apps/quick1").set({ ownerId: DEV, status: "approved", quickTestEnabled: true, appName: "Quick" });
  assert.deepEqual(await refusal(runStartQuickTest(db, { uid: TESTER, appId: "quick1" })), TERMS_REFUSAL);
  const sessions = await db.collection("quickTestSessions").get();
  assert.equal(sessions.size, 0);
  assert.equal((await db.collection(`users/${TESTER}/quickTestDays`).get()).size, 0);
});

// ---------------------------------------------------------------------------
// An existing commitment is never stranded by a Terms change
// ---------------------------------------------------------------------------

test("F2: after acceptance lapses, an existing commitment can still check in and be cancelled", async () => {
  await world();
  await runAcceptTerms(db, { uid: TESTER, version: TERMS_VERSION });
  const { assignmentId } = await join(TESTER);
  // A later Terms version: the tester has not accepted it yet.
  await db.doc(`users/${TESTER}`).set(OLD_ACCEPTANCE, { merge: true });

  const a = await read(`testingAssignments/${assignmentId}`);
  const day1 = startOfLocalDayMillis(a.firstEligibleDayKey, a.timeZone) + 12 * HOUR;
  await runRecordTestingDay(db, { assignmentId, testerId: TESTER, nowMillis: day1 });
  assert.equal((await read(`testingAssignments/${assignmentId}`)).qualifyingDays, 1, "check-in still recorded");
  assert.ok(await exists(`testingLogs/${assignmentId}__${a.firstEligibleDayKey}`));

  await cancelTestingAssignmentImpl(db, as(TESTER, { assignmentId }));
  const w = await wallet(TESTER);
  assert.equal(w.available, 50, "the stake comes back");
  assert.equal(w.locked, 0);
  assert.equal((await read(`apps/${TARGET}`)).testerCount, 0, "the seat is released");
});

// ---------------------------------------------------------------------------
// Feedback on a genuinely eligible cycle, repeated acceptance, suspension
// ---------------------------------------------------------------------------

test("F2: feedback on an ELIGIBLE cycle is refused after acceptance lapses, and accepted once renewed", async () => {
  await world();
  await runAcceptTerms(db, { uid: TESTER, version: TERMS_VERSION });
  const { assignmentId } = await join(TESTER);
  const a = await read(`testingAssignments/${assignmentId}`);
  await runRecordTestingDay(db, {
    assignmentId,
    testerId: TESTER,
    nowMillis: startOfLocalDayMillis(a.firstEligibleDayKey, a.timeZone) + 12 * HOUR,
  });
  // A later Terms version the tester has not accepted yet.
  await db.doc(`users/${TESTER}`).set(OLD_ACCEPTANCE, { merge: true });

  const submit = () => submitTestingFeedbackImpl(db, as(TESTER, { assignmentId, rating: 4, comment: "fine" }));
  assert.deepEqual(await refusal(submit()), TERMS_REFUSAL);
  assert.equal(await exists(`feedback/${assignmentId}`), false, "nothing is written");

  await runAcceptTerms(db, { uid: TESTER, version: TERMS_VERSION });
  await submit();
  assert.equal((await read(`feedback/${assignmentId}`)).rating, 4, "the same submission now lands");
});

test("F2: repeated and concurrent acceptTerms calls record exactly one acceptance", async () => {
  await db.doc("users/u1").set({ uid: "u1" });
  const results = await Promise.all(
    Array.from({ length: 10 }, () => runAcceptTerms(db, { uid: "u1", version: TERMS_VERSION })),
  );
  assert.ok(results.every((r) => r.accepted === true && r.version === TERMS_VERSION));
  assert.equal(results.filter((r) => r.alreadyAccepted === false).length, 1, "exactly one call records it");
  const stamped = (await read("users/u1")).termsAcceptedAt;

  const later = await runAcceptTerms(db, { uid: "u1", version: TERMS_VERSION });
  assert.equal(later.alreadyAccepted, true);
  assert.ok((await read("users/u1")).termsAcceptedAt.isEqual(stamped), "the recorded time never moves");
});

test("F2: accepting the Terms unlocks nothing for a suspended user", async () => {
  await world();
  await db.doc(`users/${TESTER}`).set({ isSuspended: true }, { merge: true });
  // Consent may still be recorded...
  assert.equal((await runAcceptTerms(db, { uid: TESTER, version: TERMS_VERSION })).accepted, true);
  // ...but the suspension still refuses every action it refused before.
  assert.equal((await refusal(join(TESTER))).code, "permission-denied");
  assert.equal((await refusal(joinGroup.run(as(TESTER, { groupId: OFFICIAL_GROUP_ID })))).code, "permission-denied");
  assert.equal((await wallet(TESTER)).locked, 0, "no coins move");
  assert.equal(await exists(`activeClaims/${activeClaimId(TARGET, TESTER)}`), false);
});

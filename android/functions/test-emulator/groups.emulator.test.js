/**
 * Groups on the Firestore emulator - CHARACTERIZATION (Groups Phase 1, G1).
 *
 * The real `joinGroup` callable, the real `syncGroupMemberCount` handler and
 * the real claim gate, against a real Firestore. These record what happens
 * TODAY, including behaviour the project has decided to change later:
 *   * the member cap is checked against the mirror, outside any transaction,
 *     so a burst of joins can overshoot it;
 *   * a mirror row left behind by a missed trigger still counts toward the cap;
 *   * membership of an archived group still satisfies the claim gate
 *     (intended: it must not, for NEW commitments; existing ones unaffected).
 *
 * Only the Firestore emulator runs here, so the sync trigger is not delivered
 * by the platform. Each test invokes its real handler with real before/after
 * snapshots, which lets a test say exactly WHEN the trigger ran relative to
 * the joins - "immediately after each join" or "not yet" (the production lag
 * window). Trigger delivery, ordering and retries are not what these test.
 *
 * Verification reads use point reads of known, deterministic ids.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { configureFirestore } = require("../lib/firestore");

const { joinGroup, syncGroupMemberCount } = require("../groups");
const { adminSetAppStatus, adminUpsertGroup } = require("../admin");
const { joinTestingAssignmentImpl } = require("../commitments");
const { confirmAppTestingSetupImpl, getJoinEligibilityImpl } = require("../setup");
const { runAdminGrant } = require("../wallet");
const { OFFICIAL_GROUP_ID, OFFICIAL_GROUP_NAME, OFFICIAL_GROUP_EMAIL } = require("../lib/constants");

const PROJECT_ID = "apptesting-concurrency-test";
const ADMIN = "admin1";
const G = "g_capped";
const ROUNDS = 10;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.");
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

const as = (uid, data) => ({ auth: { uid }, data });
const membershipRef = (uid, gid) => db.doc(`users/${uid}/memberships/${gid}`);
const mirrorRef = (gid, uid) => db.doc(`groups/${gid}/members/${uid}`);
const uids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, "0")}`);

const join = (uid, gid) => joinGroup.run(as(uid, { groupId: gid }));

/** Run the real sync handler for one membership write, from real snapshots. */
async function syncWrite(uid, gid, before) {
  const after = await membershipRef(uid, gid).get();
  await syncGroupMemberCount.run({ params: { userId: uid, groupId: gid }, data: { before, after } });
}

/** A join followed immediately by its trigger - the best case for the cap. */
async function joinThenSync(uid, gid) {
  const before = await membershipRef(uid, gid).get();
  const out = await join(uid, gid);
  await syncWrite(uid, gid, before);
  return out;
}

/** The client's leave (a self-delete, which the rules allow), optionally synced. */
async function leave(uid, gid, { sync = true } = {}) {
  const before = await membershipRef(uid, gid).get();
  await membershipRef(uid, gid).delete();
  if (sync) await syncWrite(uid, gid, before);
}

async function group(gid, data) {
  await db.doc(`groups/${gid}`).set(data);
}

async function settled(promises) {
  const results = await Promise.allSettled(promises);
  return {
    fulfilled: results.filter((r) => r.status === "fulfilled").map((r) => r.value),
    rejected: results.filter((r) => r.status === "rejected").map((r) => r.reason),
  };
}

const exists = async (ref) => (await ref.get()).exists;
async function countExisting(refs) {
  const snaps = await Promise.all(refs.map((r) => r.get()));
  return snaps.filter((s) => s.exists).length;
}
const memberCountOf = async (gid) => (await db.doc(`groups/${gid}`).get()).get("memberCount");

// ---------------------------------------------------------------------------
// Joining
// ---------------------------------------------------------------------------

test("join: the real callable creates one membership and nothing else", async () => {
  await group(G, { status: "open", memberCap: 0, memberCount: 0 });
  const out = await join("u1", G);
  assert.deepEqual(out, { groupId: G, joined: true, alreadyMember: false });

  const m = await membershipRef("u1", G).get();
  assert.equal(m.exists, true);
  assert.equal(m.get("groupId"), G);
  assert.equal(m.get("userId"), "u1");
  assert.ok(m.get("joinedAt"), "a server timestamp was written");
  assert.equal(await exists(mirrorRef(G, "u1")), false, "the mirror is the trigger's job, not the callable's");
  assert.equal(await memberCountOf(G), 0);
});

test("join: re-joining is idempotent against real Firestore", async () => {
  await group(G, { status: "open", memberCap: 0 });
  await join("u1", G);
  const first = (await membershipRef("u1", G).get()).get("joinedAt");
  assert.deepEqual(await join("u1", G), { groupId: G, joined: false, alreadyMember: true });
  assert.deepEqual((await membershipRef("u1", G).get()).get("joinedAt"), first, "the membership is not rewritten");
});

test(`join: parallel joins by the SAME user produce exactly one membership, across ${ROUNDS} rounds`, async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: 0 });
    const out = await settled(Array.from({ length: 10 }, () => join("same", G)));
    const label = `round ${round}`;
    assert.deepEqual(out.rejected.map((e) => `${e.code} ${e.message}`), [], `${label}: no call fails`);
    assert.equal(out.fulfilled.filter((r) => r.joined).length, 1, `${label}: exactly one reports joined`);
    assert.equal(out.fulfilled.filter((r) => r.alreadyMember).length, 9, `${label}: the rest report already a member`);
    assert.equal(await exists(membershipRef("same", G)), true, label);
  }
});

test(`join: parallel joins by DIFFERENT users into an uncapped group all succeed, across ${ROUNDS} rounds`, async () => {
  const people = uids("p", 10);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: 0 });
    const out = await settled(people.map((uid) => join(uid, G)));
    assert.deepEqual(out.rejected.map((e) => e.code), [], `round ${round}`);
    assert.equal(out.fulfilled.filter((r) => r.joined).length, people.length, `round ${round}`);
    assert.equal(await countExisting(people.map((uid) => membershipRef(uid, G))), people.length, `round ${round}`);
  }
});

// ---------------------------------------------------------------------------
// The member cap
// ---------------------------------------------------------------------------

test("cap: when the trigger runs after every join, sequential joins stop exactly at the cap", async () => {
  await group(G, { status: "open", memberCap: 3, memberCount: 0 });
  const codes = [];
  for (const uid of uids("s", 5)) {
    try {
      await joinThenSync(uid, G);
      codes.push("joined");
    } catch (err) {
      codes.push(err.code);
    }
  }
  assert.deepEqual(codes, ["joined", "joined", "joined", "resource-exhausted", "resource-exhausted"]);
  assert.equal(await memberCountOf(G), 3);
});

test(`cap: CURRENT behaviour - a burst at N-1 capacity OVERSHOOTS the cap before the trigger runs, across ${ROUNDS} rounds`, async () => {
  const CAP = 5;
  const existing = uids("e", CAP - 1);
  const burst = uids("b", 5);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: CAP, memberCount: 0 });
    for (const uid of existing) await joinThenSync(uid, G); // 4 of 5 seats, fully synced
    assert.equal(await memberCountOf(G), CAP - 1);

    // Five joins at once, with the trigger not yet run for any of them: each
    // counts the same four mirror rows, so each sees a free seat.
    const befores = await Promise.all(burst.map((uid) => membershipRef(uid, G).get()));
    const out = await settled(burst.map((uid) => join(uid, G)));
    const label = `round ${round}`;
    assert.deepEqual(out.rejected.map((e) => e.code), [], `${label}: nobody is refused`);
    assert.equal(out.fulfilled.filter((r) => r.joined).length, burst.length, `${label}: all ${burst.length} admitted for 1 seat`);

    // Once the triggers catch up, the recorded count shows the overshoot.
    for (let i = 0; i < burst.length; i += 1) await syncWrite(burst[i], G, befores[i]);
    const members = await countExisting([...existing, ...burst].map((uid) => membershipRef(uid, G)));
    assert.equal(members, CAP - 1 + burst.length, `${label}: ${members} members under a cap of ${CAP}`);
    assert.equal(await memberCountOf(G), members, `${label}: memberCount reflects the overshoot`);
  }
});

test(`cap: joins racing with their OWN triggers - record how far the cap is exceeded, across ${ROUNDS} rounds`, async () => {
  // Each join is followed by its trigger, but the joins race each other: the
  // realistic production shape. The outcome is timing-dependent, so this test
  // records it (printed as a diagnostic) and asserts only what must hold
  // either way: the recount, run once more after everything settles, matches
  // the real membership exactly.
  const CAP = 5;
  const existing = uids("e", CAP - 1);
  const burst = uids("r", 5);
  const admittedPerRound = [];
  const staleCountRounds = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: CAP, memberCount: 0 });
    for (const uid of existing) await joinThenSync(uid, G);

    const out = await settled(burst.map((uid) => joinThenSync(uid, G)));
    for (const e of out.rejected) assert.equal(e.code, "resource-exhausted", `round ${round}: only cap refusals`);
    admittedPerRound.push(out.fulfilled.length);

    const everyone = [...existing, ...burst];
    const members = await countExisting(everyone.map((uid) => membershipRef(uid, G)));
    for (const uid of everyone) {
      assert.equal(
        await exists(mirrorRef(G, uid)),
        await exists(membershipRef(uid, G)),
        `round ${round}: ${uid} has a mirror row exactly when it has a membership`,
      );
    }
    if ((await memberCountOf(G)) !== members) staleCountRounds.push(round);

    // One more recount (any later membership event does this) heals the count.
    await syncGroupMemberCount.run({ params: { userId: "nobody", groupId: G }, data: null });
    assert.equal(await memberCountOf(G), members, `round ${round}: a recount matches reality`);
  }
  const overshootRounds = admittedPerRound.filter((n) => n > 1).length;
  console.log(
    `[G1 cap race] seats free: 1, admitted per round: ${JSON.stringify(admittedPerRound)}; ` +
      `rounds over the cap: ${overshootRounds}/${ROUNDS}; ` +
      `rounds whose memberCount was stale before a final recount: ${JSON.stringify(staleCountRounds)}`,
  );
  assert.ok(admittedPerRound.every((n) => n >= 1), "the free seat is always taken by someone");
});

test("cap: CURRENT behaviour - a mirror row left behind by a missed trigger still occupies a seat", async () => {
  await group(G, { status: "open", memberCap: 1, memberCount: 0 });
  await joinThenSync("first", G);
  await leave("first", G, { sync: false }); // the trigger for the leave never ran

  assert.equal(await exists(membershipRef("first", G)), false, "the member has left");
  assert.equal(await exists(mirrorRef(G, "first")), true, "but their mirror row is still there");
  await assert.rejects(join("second", G), (e) => e.code === "resource-exhausted", "an empty group reports full");

  // The trigger finally running frees the seat.
  await syncWrite("first", G, { exists: true, get: () => undefined });
  assert.equal(await exists(mirrorRef(G, "first")), false);
  assert.equal((await join("second", G)).joined, true);
});

// ---------------------------------------------------------------------------
// The official group
// ---------------------------------------------------------------------------

test("official group: the first join provisions it with safe defaults", async () => {
  assert.equal(await exists(db.doc(`groups/${OFFICIAL_GROUP_ID}`)), false);
  assert.equal((await join("u1", OFFICIAL_GROUP_ID)).joined, true);
  const g = await db.doc(`groups/${OFFICIAL_GROUP_ID}`).get();
  assert.equal(g.get("name"), OFFICIAL_GROUP_NAME);
  assert.equal(g.get("googleGroupEmail"), OFFICIAL_GROUP_EMAIL);
  assert.equal(g.get("status"), "open");
  assert.equal(g.get("visibility"), "open");
  assert.equal(g.get("memberCap"), 0);
  assert.equal(g.get("createdBy"), "system");
  assert.equal(await exists(membershipRef("u1", OFFICIAL_GROUP_ID)), true);
});

test(`official group: parallel first joins all succeed and leave one well-formed group document, across ${ROUNDS} rounds`, async () => {
  const people = uids("o", 5);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    const out = await settled(people.map((uid) => join(uid, OFFICIAL_GROUP_ID)));
    assert.deepEqual(out.rejected.map((e) => `${e.code} ${e.message}`), [], `round ${round}`);
    assert.equal(out.fulfilled.filter((r) => r.joined).length, people.length, `round ${round}`);
    const g = await db.doc(`groups/${OFFICIAL_GROUP_ID}`).get();
    assert.equal(g.get("status"), "open", `round ${round}`);
    assert.equal(g.get("memberCount"), 0, `round ${round}: provisioning leaves the count to the trigger`);
  }
});

// ---------------------------------------------------------------------------
// Mirror and memberCount
// ---------------------------------------------------------------------------

test("mirror: join, second join, leave and recount keep the mirror and memberCount in step", async () => {
  await group(G, { status: "open", memberCap: 0, memberCount: 0 });

  await joinThenSync("a", G);
  const mirrorA = await mirrorRef(G, "a").get();
  assert.equal(mirrorA.get("userId"), "a");
  assert.equal(mirrorA.get("groupId"), G);
  assert.deepEqual(mirrorA.get("joinedAt"), (await membershipRef("a", G).get()).get("joinedAt"), "mirror copies joinedAt");
  assert.equal(await memberCountOf(G), 1);

  await joinThenSync("b", G);
  assert.equal(await memberCountOf(G), 2);

  await leave("a", G);
  assert.equal(await exists(membershipRef("a", G)), false, "membership deleted");
  assert.equal(await exists(mirrorRef(G, "a")), false, "mirror row deleted");
  assert.equal(await memberCountOf(G), 1);

  // A stale memberCount is corrected by the next recount, not incremented.
  await db.doc(`groups/${G}`).update({ memberCount: 99 });
  await syncGroupMemberCount.run({ params: { userId: "nobody", groupId: G }, data: null });
  assert.equal(await memberCountOf(G), 1);
});

test("mirror: CURRENT behaviour - syncing a membership of a nonexistent group leaves an orphan mirror row", async () => {
  // A membership can only reach a missing group if the group is removed out of
  // band (no code path deletes groups); the handler does not guard for it.
  await membershipRef("u1", "ghost").set({ groupId: "ghost", userId: "u1" });
  await syncWrite("u1", "ghost", { exists: false, get: () => undefined });
  assert.equal(await exists(mirrorRef("ghost", "u1")), true, "orphan mirror row");
  assert.equal(await exists(db.doc("groups/ghost")), false, "no group document is created");
});

// ---------------------------------------------------------------------------
// The claim gate (decision (d): CURRENT behaviour recorded, not changed)
// ---------------------------------------------------------------------------

const TARGET = "target";
const DEV = "dev1";
const pkgOf = (appId) => `com.test.${appId.replace(/[^A-Za-z0-9_]/g, "_")}`;

async function submitApprovedConfirmedApp(ownerId, appId) {
  const pkg = pkgOf(appId);
  await db.doc(`apps/${appId}`).set({
    ownerId,
    appName: appId,
    packageName: pkg,
    closedTestingUrl: `https://play.google.com/apps/testing/${pkg}`,
    description: "",
    status: "pendingReview",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await adminSetAppStatus.run(as(ADMIN, { appId, status: "approved" }));
  await confirmAppTestingSetupImpl(db, as(ownerId, { appId, closedTestConfigured: true, googleGroupAdded: true }));
}

async function claimReadyWorld(tester) {
  await db.doc(`users/${ADMIN}`).set({ uid: ADMIN, role: "admin" });
  await db.doc(`users/${DEV}`).set({ uid: DEV });
  await db.doc(`users/${tester}`).set({ uid: tester });
  await submitApprovedConfirmedApp(DEV, TARGET);
  await submitApprovedConfirmedApp(tester, `own_${tester}`);
  await join(tester, OFFICIAL_GROUP_ID);
  await runAdminGrant(db, {
    targetUserId: tester,
    amount: 50,
    reason: "groups emulator test",
    idempotencyKey: `seed_${tester}`,
    adminUid: ADMIN,
  });
}

test("claim gate: CURRENT behaviour - membership of an ARCHIVED group still satisfies it for a NEW commitment (intended: must not)", async () => {
  const tester = "t_archived";
  await claimReadyWorld(tester);
  await adminUpsertGroup.run(as(ADMIN, { groupId: OFFICIAL_GROUP_ID, status: "archived" }));
  assert.equal((await db.doc(`groups/${OFFICIAL_GROUP_ID}`).get()).get("status"), "archived");

  // New members are refused by joinGroup...
  await assert.rejects(join("newcomer", OFFICIAL_GROUP_ID), (e) => e.code === "failed-precondition");

  // ...but an existing member's membership still unlocks a new claim.
  const eligibility = await getJoinEligibilityImpl(db, as(tester, { appId: TARGET }));
  assert.equal(eligibility.groupJoinedSelfConfirmed, true);
  assert.equal(eligibility.canJoin, true, JSON.stringify(eligibility));
  assert.deepEqual(eligibility.blockers, []);
  const claim = await joinTestingAssignmentImpl(db, as(tester, { appId: TARGET }));
  assert.equal(claim.claimed, true);
});

test("claim gate: after leaving, eligibility reports groupNotJoined, and the existing commitment is untouched", async () => {
  const tester = "t_leaver";
  await claimReadyWorld(tester);
  const claim = await joinTestingAssignmentImpl(db, as(tester, { appId: TARGET }));
  assert.equal(claim.claimed, true);
  const assignmentId = claim.assignmentId;
  const before = (await db.doc(`testingAssignments/${assignmentId}`).get()).data();

  await leave(tester, OFFICIAL_GROUP_ID);

  const after = (await db.doc(`testingAssignments/${assignmentId}`).get()).data();
  assert.deepEqual(after, before, "the live commitment is unchanged by leaving");
  const eligibility = await getJoinEligibilityImpl(db, as(tester, { appId: TARGET }));
  assert.equal(eligibility.groupJoinedSelfConfirmed, false);
  assert.equal(eligibility.canJoin, false);
  assert.ok(eligibility.blockers.includes("groupNotJoined"), JSON.stringify(eligibility.blockers));
});

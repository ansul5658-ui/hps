/**
 * Groups on the Firestore emulator - CHARACTERIZATION (Groups Phase 1, G1).
 *
 * The real `joinGroup` callable, the real `syncGroupMemberCount` handler and
 * the real claim gate, against a real Firestore. G1 recorded two cap defects
 * here as CURRENT behaviour; Groups Phase 2 (G2) fixed them, so those tests
 * now assert the intended behaviour and FAIL on the G1 code:
 *   * a burst of joins can no longer overshoot the cap;
 *   * a mirror row left behind by a missed trigger no longer blocks a seat.
 * (groups.capacity.emulator.test.js covers the fix in depth.) Still recorded
 * as CURRENT, not changed: membership of an archived group satisfies the
 * claim gate (intended: it must not, for NEW commitments).
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
const { TERMS_ACCEPTED } = require("../test/joinReady");

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

/**
 * Profiles for real signed-in users, who have accepted the Terms (release audit
 * F2) - joinGroup refuses anyone else. Written BEFORE any race starts, so the
 * races below time exactly what they did before. The Terms gate itself is
 * tested in terms.emulator.test.js.
 */
async function signedUp(...list) {
  const batch = db.batch();
  for (const uid of list) batch.set(db.doc(`users/${uid}`), { uid, ...TERMS_ACCEPTED });
  await batch.commit();
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

test("join: the real callable creates the membership, its seat and the count in one step", async () => {
  await group(G, { status: "open", memberCap: 0, memberCount: 0 });
  await signedUp("u1");
  const out = await join("u1", G);
  assert.deepEqual(out, { groupId: G, joined: true, alreadyMember: false });

  const m = await membershipRef("u1", G).get();
  assert.equal(m.exists, true);
  assert.equal(m.get("groupId"), G);
  assert.equal(m.get("userId"), "u1");
  assert.ok(m.get("joinedAt"), "a server timestamp was written");
  // G2: the seat is taken in the SAME transaction as the membership, so the
  // cap never depends on the trigger having run.
  const seat = await mirrorRef(G, "u1").get();
  assert.equal(seat.exists, true, "the seat is written with the membership");
  assert.deepEqual(seat.get("joinedAt"), m.get("joinedAt"), "same joinedAt");
  assert.equal(await memberCountOf(G), 1);
});

test("join: re-joining is idempotent against real Firestore", async () => {
  await group(G, { status: "open", memberCap: 0 });
  await signedUp("u1");
  await join("u1", G);
  const first = (await membershipRef("u1", G).get()).get("joinedAt");
  assert.deepEqual(await join("u1", G), { groupId: G, joined: false, alreadyMember: true });
  assert.deepEqual((await membershipRef("u1", G).get()).get("joinedAt"), first, "the membership is not rewritten");
});

test(`join: parallel joins by the SAME user produce exactly one membership, across ${ROUNDS} rounds`, async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: 0 });
    await signedUp("same");
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
    await signedUp(...people);
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
  await signedUp(...uids("s", 5));
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

test(`cap: a burst at N-1 capacity, before any trigger runs, admits exactly one - no overshoot, across ${ROUNDS} rounds`, async () => {
  const CAP = 5;
  const existing = uids("e", CAP - 1);
  const burst = uids("b", 5);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: CAP, memberCount: 0 });
    await signedUp(...existing, ...burst);
    for (const uid of existing) await joinThenSync(uid, G); // 4 of 5 seats, fully synced
    assert.equal(await memberCountOf(G), CAP - 1);

    // Five joins at once, with the trigger not yet run for any of them. On the
    // G1 code each counted the same four mirror rows and all five were
    // admitted for the one seat; now the seat is taken transactionally.
    const befores = await Promise.all(burst.map((uid) => membershipRef(uid, G).get()));
    const out = await settled(burst.map((uid) => join(uid, G)));
    const label = `round ${round}`;
    assert.equal(out.fulfilled.filter((r) => r.joined).length, 1, `${label}: exactly 1 admitted for 1 seat`);
    assert.deepEqual(out.rejected.map((e) => e.code), Array(burst.length - 1).fill("resource-exhausted"), `${label}: the rest are full`);

    // Once the triggers catch up, nothing changes.
    for (let i = 0; i < burst.length; i += 1) await syncWrite(burst[i], G, befores[i]);
    const members = await countExisting([...existing, ...burst].map((uid) => membershipRef(uid, G)));
    assert.equal(members, CAP, `${label}: ${members} members under a cap of ${CAP}`);
    assert.equal(await memberCountOf(G), members, `${label}: memberCount equals the members`);
  }
});

test(`cap: joins racing with their OWN triggers never exceed the cap, across ${ROUNDS} rounds`, async () => {
  // Each join is followed by its trigger, but the joins race each other: the
  // realistic production shape. G1 recorded 5 admitted for the 1 free seat in
  // 10/10 rounds; now exactly one is admitted and the count is never stale.
  const CAP = 5;
  const existing = uids("e", CAP - 1);
  const burst = uids("r", 5);
  const admittedPerRound = [];
  const staleCountRounds = [];
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: CAP, memberCount: 0 });
    await signedUp(...existing, ...burst);
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
  assert.deepEqual(admittedPerRound, Array(ROUNDS).fill(1), "exactly the one free seat is taken, every round");
  assert.deepEqual(staleCountRounds, [], "memberCount is never stale");
});

test("cap: a mirror row left behind by a missed trigger no longer occupies a seat", async () => {
  await group(G, { status: "open", memberCap: 1, memberCount: 0 });
  await signedUp("first", "second");
  await joinThenSync("first", G);
  await leave("first", G, { sync: false }); // the trigger for the leave never ran

  assert.equal(await exists(membershipRef("first", G)), false, "the member has left");
  assert.equal(await exists(mirrorRef(G, "first")), true, "but their mirror row is still there");
  // G1: an empty group reported full here. The membership is the source of
  // truth, so the stale row is repaired and the seat given out.
  assert.equal((await join("second", G)).joined, true, "an empty group is not full");
  assert.equal(await exists(mirrorRef(G, "first")), false, "the stale row was removed");
  assert.equal(await memberCountOf(G), 1);

  // The trigger finally running changes nothing more.
  await syncWrite("first", G, { exists: true, get: () => undefined });
  assert.equal(await memberCountOf(G), 1, "freed exactly once");
});

// ---------------------------------------------------------------------------
// The official group
// ---------------------------------------------------------------------------

test("official group: the first join provisions it with safe defaults", async () => {
  await signedUp("u1");
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
    await signedUp(...people);
    const out = await settled(people.map((uid) => join(uid, OFFICIAL_GROUP_ID)));
    assert.deepEqual(out.rejected.map((e) => `${e.code} ${e.message}`), [], `round ${round}`);
    assert.equal(out.fulfilled.filter((r) => r.joined).length, people.length, `round ${round}`);
    const g = await db.doc(`groups/${OFFICIAL_GROUP_ID}`).get();
    assert.equal(g.get("status"), "open", `round ${round}`);
    // G2: each join counts its own seat in its transaction (G1: 0 until the trigger ran).
    assert.equal(g.get("memberCount"), people.length, `round ${round}: every join is counted`);
  }
});

// ---------------------------------------------------------------------------
// Mirror and memberCount
// ---------------------------------------------------------------------------

test("mirror: join, second join, leave and recount keep the mirror and memberCount in step", async () => {
  await group(G, { status: "open", memberCap: 0, memberCount: 0 });
  await signedUp("a", "b");

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

  // memberCount moves by exactly one per seat taken or freed, in the same
  // transaction as the seat; an event that changes no seat changes nothing.
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
  await signedUp(DEV, tester);
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
  // (An accepted profile, so the refusal is the archive's, not the Terms'.)
  await signedUp("newcomer");
  await assert.rejects(
    join("newcomer", OFFICIAL_GROUP_ID),
    (e) => e.code === "failed-precondition" && !(e.details && e.details.reason === "termsNotAccepted"),
  );

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

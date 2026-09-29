/**
 * Groups seat capacity on the Firestore emulator (Groups Phase 2, G2).
 *
 * G1 proved two defects in `joinGroup`:
 *   * OVERSHOOT - the cap was checked against a count of the member mirror,
 *     read outside any transaction, and the mirror was written later by the
 *     sync trigger. A burst of joins all counted the same rows and were all
 *     admitted (5 for 1 seat, 10/10 rounds).
 *   * STALE SEAT - a mirror row left behind by a missed leave trigger was
 *     still counted, so an empty group reported full.
 *
 * These tests state the intended behaviour and must FAIL on the G1 code:
 *   * admitted members never exceed the cap, under any concurrency;
 *   * the membership document is the source of truth - a mirror row whose
 *     membership is gone never blocks a seat, and a legitimate one always
 *     does;
 *   * `memberCount` equals the seated members exactly, and every repair
 *     happens exactly once.
 *
 * Only the Firestore emulator runs here, so the sync trigger is invoked by
 * hand with its real handler - which lets each test say exactly WHEN it ran
 * (immediately, late, twice, or never). Verification reads are point reads.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { configureFirestore } = require("../lib/firestore");

const { joinGroup, syncGroupMemberCount } = require("../groups");
const { adminUpsertGroup } = require("../admin");
const { OFFICIAL_GROUP_ID, TERMS_VERSION } = require("../lib/constants");
const { TERMS_ACCEPTED } = require("../test/joinReady");

const PROJECT_ID = "apptesting-concurrency-test";
const ADMIN = "admin1";
const G = "g_seats";
const ROUNDS = 20;

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.");
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
// The production transport (lib/firestore.js).
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
const membershipRef = (uid, gid = G) => db.doc(`users/${uid}/memberships/${gid}`);
const seatRef = (gid, uid) => db.doc(`groups/${gid}/members/${uid}`);
const uids = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${String(i).padStart(2, "0")}`);

const join = (uid, gid = G) => joinGroup.run(as(uid, { groupId: gid }));

/** Run the real sync handler for `uid`'s membership of `gid`, as the platform would. */
async function sync(uid, gid = G) {
  const after = await membershipRef(uid, gid).get();
  await syncGroupMemberCount.run({
    params: { userId: uid, groupId: gid },
    data: { before: { exists: !after.exists, get: () => undefined }, after },
  });
}

/** The client's leave: a self-delete of the membership (the rules allow exactly this). */
const leave = (uid, gid = G) => membershipRef(uid, gid).delete();

/** Profiles of signed-in users who accepted the Terms (F2); written before any race. */
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
    joined: results.filter((r) => r.status === "fulfilled" && r.value.joined).length,
    alreadyMember: results.filter((r) => r.status === "fulfilled" && r.value.alreadyMember).length,
    rejected: results.filter((r) => r.status === "rejected").map((r) => r.reason),
  };
}

const exists = async (ref) => (await ref.get()).exists;
async function countExisting(refs) {
  const snaps = await Promise.all(refs.map((r) => r.get()));
  return snaps.filter((s) => s.exists).length;
}
const memberCountOf = async (gid = G) => (await db.doc(`groups/${gid}`).get()).get("memberCount");

/**
 * The seat invariant for `people` (everyone who could hold a seat): every
 * member has a seat, every seat has a member, and memberCount counts them.
 */
async function assertSeatsMatchMembers(people, label, gid = G) {
  for (const uid of people) {
    assert.equal(
      await exists(seatRef(gid, uid)),
      await exists(membershipRef(uid, gid)),
      `${label}: ${uid} has a seat exactly when they have a membership`,
    );
  }
  const members = await countExisting(people.map((uid) => membershipRef(uid, gid)));
  assert.equal(await memberCountOf(gid), members, `${label}: memberCount equals the seated members`);
  return members;
}

const codes = (errors) => errors.map((e) => e.code);

// ---------------------------------------------------------------------------
// 1-3. Capacity under concurrency - no trigger runs during the race
// ---------------------------------------------------------------------------

test(`capacity: 10 concurrent joiners for a 1-seat group admit exactly one, across ${ROUNDS} rounds`, async () => {
  const people = uids("c", 10);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: 1, memberCount: 0 });
    await signedUp(...people);
    const out = await settled(people.map((uid) => join(uid)));
    const label = `round ${round}`;
    assert.equal(out.joined, 1, `${label}: exactly one admitted`);
    assert.deepEqual(codes(out.rejected), Array(9).fill("resource-exhausted"), `${label}: the rest are refused as full`);
    assert.equal(await assertSeatsMatchMembers(people, label), 1);
  }
});

test(`capacity: 5 concurrent joiners for the LAST free seat (4 of 5 taken) admit exactly one, across ${ROUNDS} rounds`, async () => {
  const CAP = 5;
  const existing = uids("e", CAP - 1);
  const burst = uids("b", 5);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: CAP, memberCount: 0 });
    await signedUp(...existing, ...burst);
    for (const uid of existing) {
      await join(uid);
      await sync(uid);
    }
    const out = await settled(burst.map((uid) => join(uid)));
    const label = `round ${round}`;
    assert.equal(out.joined, 1, `${label}: one admitted for one seat`);
    assert.deepEqual(codes(out.rejected), Array(4).fill("resource-exhausted"), label);
    // Triggers catching up afterwards change nothing.
    for (const uid of burst) await sync(uid);
    assert.equal(await assertSeatsMatchMembers([...existing, ...burst], label), CAP);
  }
});

test(`capacity: exactly-capacity bursts fill every seat and no more, across ${ROUNDS} rounds`, async () => {
  const CAP = 5;
  for (let round = 0; round < ROUNDS; round += 1) {
    // 5 joiners for 5 seats: all admitted.
    await clearFirestore();
    await group(G, { status: "open", memberCap: CAP, memberCount: 0 });
    const five = uids("f", 5);
    await signedUp(...five);
    const all = await settled(five.map((uid) => join(uid)));
    assert.equal(all.joined, 5, `round ${round}: all five admitted`);
    assert.deepEqual(all.rejected, [], `round ${round}`);
    assert.equal(await assertSeatsMatchMembers(five, `round ${round} (5/5)`), 5);

    // 8 joiners for 5 seats: exactly five admitted.
    await clearFirestore();
    await group(G, { status: "open", memberCap: CAP, memberCount: 0 });
    const eight = uids("x", 8);
    await signedUp(...eight);
    const over = await settled(eight.map((uid) => join(uid)));
    assert.equal(over.joined, 5, `round ${round}: five of eight admitted`);
    assert.deepEqual(codes(over.rejected), Array(3).fill("resource-exhausted"), `round ${round}`);
    assert.equal(await assertSeatsMatchMembers(eight, `round ${round} (8/5)`), 5);
  }
});

test(`capacity: joins racing their OWN triggers never exceed the cap, across ${ROUNDS} rounds`, async () => {
  const CAP = 3;
  const people = uids("t", 8);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: CAP, memberCount: 0 });
    await signedUp(...people);
    const out = await settled(
      people.map(async (uid) => {
        const r = await join(uid);
        await sync(uid);
        return r;
      }),
    );
    assert.equal(out.joined, CAP, `round ${round}: exactly the cap`);
    assert.deepEqual(codes(out.rejected), Array(people.length - CAP).fill("resource-exhausted"), `round ${round}`);
    assert.equal(await assertSeatsMatchMembers(people, `round ${round}`), CAP);
  }
});

// ---------------------------------------------------------------------------
// 4. Idempotent join
// ---------------------------------------------------------------------------

test(`idempotency: 10 parallel joins by the SAME user take one seat, across ${ROUNDS} rounds`, async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: 2, memberCount: 0 });
    await signedUp("same");
    const out = await settled(Array.from({ length: 10 }, () => join("same")));
    assert.equal(out.joined, 1, `round ${round}`);
    assert.equal(out.alreadyMember, 9, `round ${round}`);
    assert.deepEqual(out.rejected, [], `round ${round}`);
    assert.equal(await assertSeatsMatchMembers(["same"], `round ${round}`), 1);
  }
});

test("idempotency: re-joining writes nothing and keeps the original seat and joinedAt", async () => {
  await group(G, { status: "open", memberCap: 2, memberCount: 0 });
  await signedUp("u1");
  await join("u1");
  const membership = (await membershipRef("u1").get()).get("joinedAt");
  const seat = (await seatRef(G, "u1").get()).get("joinedAt");
  assert.deepEqual(await join("u1"), { groupId: G, joined: false, alreadyMember: true });
  assert.deepEqual((await membershipRef("u1").get()).get("joinedAt"), membership);
  assert.deepEqual((await seatRef(G, "u1").get()).get("joinedAt"), seat);
  assert.equal(await memberCountOf(), 1);
});

// ---------------------------------------------------------------------------
// 5. Leave, then join
// ---------------------------------------------------------------------------

test("leave: once its trigger runs, the seat is freed exactly once and another user can take it", async () => {
  await group(G, { status: "open", memberCap: 1, memberCount: 0 });
  await signedUp("a", "b");
  await join("a");
  await leave("a");
  await sync("a");
  await sync("a"); // a redelivered trigger changes nothing
  assert.equal(await exists(seatRef(G, "a")), false);
  assert.equal(await memberCountOf(), 0, "freed once, never below zero");
  assert.equal((await join("b")).joined, true);
  assert.equal(await assertSeatsMatchMembers(["a", "b"], "after b"), 1);
});

test("leave: rejoining BEFORE the leave trigger runs reuses the member's own seat; the late trigger is a no-op", async () => {
  await group(G, { status: "open", memberCap: 1, memberCount: 0 });
  await signedUp("a", "b");
  await join("a");
  await leave("a");
  const again = await join("a");
  assert.equal(again.joined, true, "a is admitted to the seat they still hold");
  assert.equal(await memberCountOf(), 1, "not counted twice");
  await sync("a"); // the delayed trigger for the leave
  assert.equal(await exists(seatRef(G, "a")), true, "the seat of a current member is never removed");
  await assert.rejects(join("b"), (e) => e.code === "resource-exhausted");
  assert.equal(await assertSeatsMatchMembers(["a", "b"], "end"), 1);
});

// ---------------------------------------------------------------------------
// 6-8. Stale and legitimate mirror rows
// ---------------------------------------------------------------------------

test("stale seat: a mirror row whose membership is gone does not block the seat, and is repaired once", async () => {
  await group(G, { status: "open", memberCap: 1, memberCount: 0 });
  await signedUp("first", "second");
  await join("first");
  await leave("first"); // the trigger for this leave never runs
  assert.equal(await exists(seatRef(G, "first")), true, "precondition: a stale seat");

  const out = await join("second");
  assert.equal(out.joined, true, "an empty group is not reported full");
  assert.equal(await exists(seatRef(G, "first")), false, "the stale seat was removed");
  assert.equal(await exists(membershipRef("first")), false, "no membership was touched");
  assert.equal(await assertSeatsMatchMembers(["first", "second"], "after"), 1);

  // The long-delayed trigger for first's leave finally runs: nothing more changes.
  await sync("first");
  assert.equal(await memberCountOf(), 1, "the seat was freed exactly once");
});

test("legitimate seat: a mirror row with a live membership always holds its seat", async () => {
  await group(G, { status: "open", memberCap: 1, memberCount: 0 });
  await signedUp("holder", "other");
  await join("holder");
  await sync("holder");
  await assert.rejects(join("other"), (e) => e.code === "resource-exhausted");
  assert.equal(await exists(membershipRef("holder")), true);
  assert.equal(await exists(seatRef(G, "holder")), true);
  assert.equal(await assertSeatsMatchMembers(["holder", "other"], "end"), 1);
});

test(`stale seat + concurrent joiners: exactly the freed seat is filled, legitimate members kept, across ${ROUNDS} rounds`, async () => {
  const burst = uids("j", 6);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: 2, memberCount: 0 });
    await signedUp("live", "gone", ...burst);
    await join("live");
    await join("gone");
    await leave("gone"); // stale: its trigger never runs
    const out = await settled(burst.map((uid) => join(uid)));
    const label = `round ${round}`;
    assert.equal(out.joined, 1, `${label}: one seat was free`);
    assert.deepEqual(codes(out.rejected), Array(5).fill("resource-exhausted"), label);
    assert.equal(await exists(membershipRef("live")), true, `${label}: the live member is kept`);
    assert.equal(await exists(seatRef(G, "live")), true, label);
    assert.equal(await exists(seatRef(G, "gone")), false, `${label}: the stale seat is gone`);
    assert.equal(await assertSeatsMatchMembers(["live", "gone", ...burst], label), 2);
  }
});

test(`stale seat: its delayed trigger racing a joiner's repair frees it exactly once, across ${ROUNDS} rounds`, async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: 2, memberCount: 0 });
    await signedUp("live", "gone", "new1");
    await join("live");
    await join("gone");
    await leave("gone");
    const [joined] = await Promise.all([join("new1"), sync("gone"), sync("gone")]);
    assert.equal(joined.joined, true, `round ${round}`);
    assert.equal(await assertSeatsMatchMembers(["live", "gone", "new1"], `round ${round}`), 2);
  }
});

// ---------------------------------------------------------------------------
// 9. memberCount reconciliation by the trigger
// ---------------------------------------------------------------------------

test("sync: a membership with no seat (written before G2) gets one seat and one count, however often it is delivered", async () => {
  await group(G, { status: "open", memberCap: 0, memberCount: 0 });
  await membershipRef("legacy").set({ groupId: G, userId: "legacy", joinedAt: new Date(1000) });
  await Promise.all([sync("legacy"), sync("legacy"), sync("legacy")]);
  const seat = await seatRef(G, "legacy").get();
  assert.equal(seat.exists, true);
  assert.equal(seat.get("userId"), "legacy");
  assert.equal(seat.get("groupId"), G);
  assert.equal(seat.get("joinedAt").toMillis(), 1000, "the seat copies the membership's joinedAt");
  assert.equal(await memberCountOf(), 1, "counted once");

  await leave("legacy");
  await Promise.all([sync("legacy"), sync("legacy"), sync("legacy")]);
  assert.equal(await exists(seatRef(G, "legacy")), false);
  assert.equal(await memberCountOf(), 0, "freed once");
});

test("sync: an event for someone with neither a membership nor a seat changes nothing", async () => {
  await group(G, { status: "open", memberCap: 0, memberCount: 3 });
  await sync("nobody");
  assert.equal(await memberCountOf(), 3);
  assert.equal(await exists(seatRef(G, "nobody")), false);
});

// ---------------------------------------------------------------------------
// 10-13. Refusals take no seat; admin behaviour
// ---------------------------------------------------------------------------

test("a suspended user is refused and takes no seat", async () => {
  await group(G, { status: "open", memberCap: 1, memberCount: 0 });
  await db.doc("users/banned").set({ uid: "banned", isSuspended: true, ...TERMS_ACCEPTED });
  await assert.rejects(join("banned"), (e) => e.code === "permission-denied");
  assert.equal(await exists(seatRef(G, "banned")), false);
  assert.equal(await memberCountOf(), 0);
});

test("archived and closed groups refuse joins and take no seat", async () => {
  await signedUp("u1");
  for (const status of ["archived", "completed", "cancelled", "full"]) {
    await group(G, { status, memberCap: 5, memberCount: 0 });
    await assert.rejects(join("u1"), (e) => e.code === "failed-precondition", status);
    assert.equal(await exists(seatRef(G, "u1")), false, status);
    assert.equal(await exists(membershipRef("u1")), false, status);
    assert.equal(await memberCountOf(), 0, status);
  }
});

test(`a Terms-not-accepted joiner never takes the seat from an accepted one, across ${ROUNDS} rounds`, async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await group(G, { status: "open", memberCap: 1, memberCount: 0 });
    await db.doc("users/noterms").set({ uid: "noterms", termsAcceptedVersion: TERMS_VERSION - 1 });
    await signedUp("ok");
    const [refused, admitted] = await Promise.allSettled([join("noterms"), join("ok")]);
    assert.equal(refused.status, "rejected", `round ${round}`);
    // The Terms check runs after the existing decisions (F2), so whichever
    // commits first decides the answer: termsNotAccepted while the seat is
    // free, "full" once the accepted joiner has it. Either way, no seat.
    const reason = refused.reason.details && refused.reason.details.reason;
    assert.ok(
      (refused.reason.code === "failed-precondition" && reason === "termsNotAccepted") ||
        refused.reason.code === "resource-exhausted",
      `round ${round}: refused as ${refused.reason.code}/${reason}`,
    );
    assert.equal(admitted.status, "fulfilled", `round ${round}`);
    assert.equal(admitted.value.joined, true, `round ${round}`);
    assert.equal(await assertSeatsMatchMembers(["noterms", "ok"], `round ${round}`), 1);
  }
});

test("admin: creating a group starts memberCount at 0; editing never touches it; lowering the cap refuses new joins only", async () => {
  await db.doc(`users/${ADMIN}`).set({ uid: ADMIN, role: "admin" });
  await signedUp("a", "b", "c");
  await adminUpsertGroup.run(as(ADMIN, { groupId: G, name: "Seats", memberCap: 3 }));
  assert.equal(await memberCountOf(), 0);
  await join("a");
  await join("b");
  assert.equal(await memberCountOf(), 2);

  await adminUpsertGroup.run(as(ADMIN, { groupId: G, memberCap: 1, summary: "smaller" }));
  assert.equal(await memberCountOf(), 2, "an admin edit never rewrites memberCount");
  await assert.rejects(join("c"), (e) => e.code === "resource-exhausted", "over the lowered cap");
  assert.equal(await exists(membershipRef("a")), true, "existing members are not removed");
  assert.equal(await exists(membershipRef("b")), true);

  await adminUpsertGroup.run(as(ADMIN, { groupId: G, memberCap: 3 }));
  assert.equal((await join("c")).joined, true, "raising the cap frees seats");
  assert.equal(await assertSeatsMatchMembers(["a", "b", "c"], "end"), 3);
});

test("admin: an admin joins like anyone else, under the same cap", async () => {
  await group(G, { status: "open", memberCap: 1, memberCount: 0 });
  await db.doc(`users/${ADMIN}`).set({ uid: ADMIN, role: "admin", ...TERMS_ACCEPTED });
  await signedUp("u1");
  await join("u1");
  await assert.rejects(join(ADMIN), (e) => e.code === "resource-exhausted");
});

// ---------------------------------------------------------------------------
// 14. The official, uncapped group
// ---------------------------------------------------------------------------

test(`official group: concurrent first joins all succeed and memberCount counts every one, across ${ROUNDS} rounds`, async () => {
  const people = uids("o", 10);
  for (let round = 0; round < ROUNDS; round += 1) {
    await clearFirestore();
    await signedUp(...people);
    const out = await settled(people.map((uid) => join(uid, OFFICIAL_GROUP_ID)));
    assert.deepEqual(out.rejected.map((e) => `${e.code} ${e.message}`), [], `round ${round}`);
    assert.equal(out.joined, people.length, `round ${round}`);
    const g = await db.doc(`groups/${OFFICIAL_GROUP_ID}`).get();
    assert.equal(g.get("memberCap"), 0, "uncapped");
    assert.equal(await assertSeatsMatchMembers(people, `round ${round}`, OFFICIAL_GROUP_ID), people.length);
  }
});

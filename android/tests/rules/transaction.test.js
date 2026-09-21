/**
 * Replicates the exact Firestore sequence the Android client USED to perform,
 * and proves every step of it is now refused.
 *
 * `FirestoreAssignmentRepository.recordDayOfTesting` once ran a transaction
 * that read the (usually non-existent) log document, read the assignment, then
 * created the log with a server timestamp. This file existed to prove that
 * whole path worked end to end against the real rules, because two of its
 * steps were fragile: a read rule that dereferenced a null `resource`, and a
 * `createdAt` tolerance window for a sentinel resolved at commit time.
 *
 * The testing engine moved that write to the `recordTestingDay` callable, so
 * the day boundary could follow the assignment's pinned IANA timezone instead
 * of UTC. The client sequence is therefore dead — and this file now proves it
 * is dead rather than deleting the coverage. That distinction matters: a
 * reintroduced client write path would restore the UTC boundary and the
 * existence oracle silently, and these tests are what would catch it.
 *
 * The behaviour those steps guarded (one day per local date, no future days,
 * no backdating, suspended testers refused) did not go away — it moved to
 * functions/test/testingDays.test.js and its emulator counterpart, where it is
 * tested against the real zone-aware clock.
 */

const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const {
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
} = require("firebase/firestore");

const RULES_PATH = path.resolve(__dirname, "../../firestore.rules");

let testEnv;

function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apptesting-tx-test",
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/alice"), { uid: "alice", role: "member", isSuspended: false });
    await setDoc(doc(db, "users/banned"), { uid: "banned", role: "member", isSuspended: true });
    await setDoc(doc(db, "testingAssignments/app1__alice"), {
      appId: "app1",
      testerId: "alice",
      developerId: "bob",
      daysRequired: 14,
      daysCompleted: 0,
      coinReward: 50,
      status: "ready",
    });
    await setDoc(doc(db, "testingAssignments/app1__banned"), {
      appId: "app1",
      testerId: "banned",
      developerId: "bob",
      daysRequired: 14,
      daysCompleted: 0,
      coinReward: 50,
      status: "ready",
    });
  });
});

/** Mirrors recordDayOfTesting(). */
function checkIn(db, { assignmentId, testerId, dayKey }) {
  const logRef = doc(db, `testingLogs/${assignmentId}__${dayKey}`);
  const assignmentRef = doc(db, `testingAssignments/${assignmentId}`);
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(logRef);
    if (existing.exists()) return "alreadyLogged";
    const assignment = await tx.get(assignmentRef);
    if (!assignment.exists()) return "notFound";
    tx.set(logRef, {
      assignmentId,
      testerId,
      date: dayKey,
      createdAt: serverTimestamp(),
    });
    return "logged";
  });
}

test("the old client transactional check-in is refused end to end", async () => {
  // The exact sequence, with a perfectly well-formed payload: right tester,
  // right deterministic id, today's date, a real server timestamp. It
  // satisfied every clause of the rule that used to exist, and it is refused,
  // because `testingLogs` has no client write path at all now.
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertFails(
    checkIn(db, { assignmentId: "app1__alice", testerId: "alice", dayKey: todayKey() }),
  );
});

test("a repeated attempt is refused too, not silently accepted", async () => {
  const db = testEnv.authenticatedContext("alice").firestore();
  const args = { assignmentId: "app1__alice", testerId: "alice", dayKey: todayKey() };
  await assertFails(checkIn(db, args));
  await assertFails(checkIn(db, args));
});

test("a forward-dated client check-in is still rejected", async () => {
  // Was rejected by the `date == serverDayKey()` clause; is now rejected
  // because no client create is possible. Same outcome, stronger reason.
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertFails(
    checkIn(db, { assignmentId: "app1__alice", testerId: "alice", dayKey: todayKey(1) }),
  );
});

test("a suspended tester's client check-in is still rejected", async () => {
  const db = testEnv.authenticatedContext("banned").firestore();
  await assertFails(
    checkIn(db, { assignmentId: "app1__banned", testerId: "banned", dayKey: todayKey() }),
  );
});

test("the existence oracle is closed: a missing log cannot be probed", async () => {
  // Deterministic log ids used to let anyone who knew an assignment id read a
  // non-existent log and learn whether that day had been recorded. The read
  // rule tolerated `resource == null` only because the client transaction had
  // to read before writing. With the write gone, so is the allowance.
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertFails(getDoc(doc(db, `testingLogs/app1__alice__${todayKey()}`)));
});

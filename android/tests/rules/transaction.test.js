/**
 * Replicates the exact Firestore sequence the Android client performs, rather
 * than a simplified version of it.
 *
 * FirestoreAssignmentRepository.recordDayOfTesting runs a transaction that:
 *   1. reads the (usually non-existent) log document,
 *   2. reads the assignment,
 *   3. creates the log with a server timestamp.
 *
 * Both steps 1 and 3 are places where a rule can reject a legitimate check-in:
 * a read rule that dereferences `resource` breaks on a missing document, and a
 * `createdAt` tolerance-window check has to hold for a sentinel resolved at
 * commit time (exact equality was tried first and is fragile in production —
 * see firestore.rules). This file proves the whole path works end to end.
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

test("the client's real transactional check-in succeeds", async () => {
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertSucceeds(
    checkIn(db, { assignmentId: "app1__alice", testerId: "alice", dayKey: todayKey() }),
  );
});

test("a second check-in on the same day is a no-op, not a second log", async () => {
  const db = testEnv.authenticatedContext("alice").firestore();
  const args = { assignmentId: "app1__alice", testerId: "alice", dayKey: todayKey() };
  await assertSucceeds(checkIn(db, args));
  // The transaction short-circuits on the existing doc and writes nothing,
  // so this resolves without tripping the rules at all.
  await assertSucceeds(checkIn(db, args));
});

test("a forward-dated transactional check-in is still rejected", async () => {
  const db = testEnv.authenticatedContext("alice").firestore();
  await assertFails(
    checkIn(db, { assignmentId: "app1__alice", testerId: "alice", dayKey: todayKey(1) }),
  );
});

test("a suspended tester's transactional check-in is rejected", async () => {
  const db = testEnv.authenticatedContext("banned").firestore();
  await assertFails(
    checkIn(db, { assignmentId: "app1__banned", testerId: "banned", dayKey: todayKey() }),
  );
});

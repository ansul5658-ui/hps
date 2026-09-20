/**
 * Firestore security rule tests for Quick Tests.
 *
 * Run with:  firebase emulators:exec --only firestore "npm --prefix tests/rules test"
 *
 * Kept in its own file with its own projectId, the same way transaction.test.js
 * is: the files in this directory run in parallel processes, so sharing a
 * project would mean one file's clearFirestore() wiping another's fixtures.
 *
 * Quick Tests are free and carry no coin effect, so the threat model here is
 * not theft. It is (a) a client manufacturing sessions to bypass the daily
 * limit, the cooldown or the suspension check, and (b) a developer promoting
 * their own app into every user's discovery pool. Every client write below
 * must be refused — including for an admin, because admin authority lives in
 * callable Cloud Functions running with Admin SDK credentials, which bypass
 * these rules entirely.
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
  collection,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} = require("firebase/firestore");

const RULES_PATH = path.resolve(__dirname, "../../firestore.rules");

let testEnv;

/** The UTC day key the server derives; Quick Test session ids embed it. */
function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

const sessionId = (uid, appId, day) => uid + "__" + appId + "__" + day;

/**
 * Seed with rules disabled — this stands in for the Cloud Functions writes,
 * which are the only way any of these documents exists in production.
 */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const day = todayKey();

    await setDoc(doc(db, "users/admin1"), { uid: "admin1", role: "admin" });
    await setDoc(doc(db, "users/alice"), { uid: "alice", isSuspended: false });
    await setDoc(doc(db, "users/bob"), { uid: "bob", isSuspended: false });
    await setDoc(doc(db, "users/banned"), { uid: "banned", isSuspended: true });
    // The shape of every real account: no role, no isSuspended. If any new
    // rule dot-accesses a missing key it errors and denies — the exact defect
    // class that broke every testingLogs create in production.
    await setDoc(doc(db, "users/nofields"), { uid: "nofields", email: "n@x.com" });

    // An app offering Quick Tests...
    await setDoc(doc(db, "apps/quick1"), {
      ownerId: "bob",
      appName: "Quick One",
      packageName: "com.bob.quick1",
      versionName: "1.0",
      description: "hello",
      status: "approved",
      quickTestEnabled: true,
      lastSurfacedAt: new Date(),
    });
    // ...and one with no quickTestEnabled field at all, which is the shape of
    // every app that predates the feature.
    await setDoc(doc(db, "apps/plain1"), {
      ownerId: "bob",
      appName: "Plain One",
      packageName: "com.bob.plain1",
      status: "approved",
    });

    await setDoc(doc(db, "discovery/quickTestPool"), {
      appIds: ["quick1", "plain1"],
      size: 2,
      refreshedAt: new Date(),
      refreshedBy: "system",
    });

    await setDoc(doc(db, "quickTestSessions/" + sessionId("alice", "quick1", day)), {
      uid: "alice",
      appId: "quick1",
      dayKey: day,
      openedAt: new Date(),
      completedAt: null,
      feedbackId: null,
    });

    await setDoc(doc(db, "users/alice/quickTestDays/" + day), {
      dayKey: day,
      count: 1,
      updatedAt: new Date(),
    });

    await setDoc(doc(db, "users/alice/quickTestApps/quick1"), {
      appId: "quick1",
      lastSessionDayKey: day,
      lastSessionAt: new Date(),
      sessionCount: 1,
    });
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apptesting-quicktest-rules",
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
  await seed();
});

// ---------------------------------------------------------------------------
// Sessions are server-only
// ---------------------------------------------------------------------------

test("a client cannot create a Quick Test session, even for itself", async () => {
  // A client that could do this would skip the daily limit, the cooldown, the
  // suspension check and the own-app check in a single write.
  const db = asUser("alice");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, "quickTestSessions/" + sessionId("alice", "plain1", day)), {
      uid: "alice",
      appId: "plain1",
      dayKey: day,
      openedAt: serverTimestamp(),
      completedAt: null,
      feedbackId: null,
    }),
  );
});

test("a client cannot create a session under another user's id", async () => {
  const db = asUser("alice");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, "quickTestSessions/" + sessionId("bob", "quick1", day)), {
      uid: "bob",
      appId: "quick1",
      dayKey: day,
      openedAt: serverTimestamp(),
    }),
  );
});

test("a client cannot backdate a session to escape the cooldown", async () => {
  const db = asUser("alice");
  await assertFails(
    setDoc(doc(db, "quickTestSessions/alice__quick1__2020-01-01"), {
      uid: "alice",
      appId: "quick1",
      dayKey: "2020-01-01",
      openedAt: new Date("2020-01-01"),
    }),
  );
});

test("a client cannot update its own session's timestamps", async () => {
  const db = asUser("alice");
  const ref = doc(db, "quickTestSessions/" + sessionId("alice", "quick1", todayKey()));
  await assertFails(updateDoc(ref, { completedAt: serverTimestamp() }));
  await assertFails(updateDoc(ref, { openedAt: new Date("2020-01-01") }));
  await assertFails(updateDoc(ref, { appId: "plain1" }));
});

test("a client cannot delete a session to free up a daily slot", async () => {
  const db = asUser("alice");
  await assertFails(
    deleteDoc(doc(db, "quickTestSessions/" + sessionId("alice", "quick1", todayKey()))),
  );
});

test("an admin cannot write Quick Test sessions from the client either", async () => {
  const db = asUser("admin1");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, "quickTestSessions/" + sessionId("admin1", "quick1", day)), {
      uid: "admin1",
      appId: "quick1",
    }),
  );
  await assertFails(
    updateDoc(doc(db, "quickTestSessions/" + sessionId("alice", "quick1", day)), {
      completedAt: new Date(),
    }),
  );
  await assertFails(
    deleteDoc(doc(db, "quickTestSessions/" + sessionId("alice", "quick1", day))),
  );
});

// ---------------------------------------------------------------------------
// Session reads
// ---------------------------------------------------------------------------

test("a user can read their own Quick Test session", async () => {
  await assertSucceeds(
    getDoc(doc(asUser("alice"), "quickTestSessions/" + sessionId("alice", "quick1", todayKey()))),
  );
});

test("a user cannot read another user's Quick Test session", async () => {
  await assertFails(
    getDoc(doc(asUser("bob"), "quickTestSessions/" + sessionId("alice", "quick1", todayKey()))),
  );
});

test("an admin can read any Quick Test session", async () => {
  await assertSucceeds(
    getDoc(doc(asUser("admin1"), "quickTestSessions/" + sessionId("alice", "quick1", todayKey()))),
  );
});

test("a missing session is not readable as an existence oracle", async () => {
  // Unlike testingLogs, a null resource is deliberately NOT tolerated here:
  // uid is part of the deterministic id, so a permitted read of a missing
  // document would answer "did user X Quick Test app Y on day Z" for any X.
  await assertFails(
    getDoc(doc(asUser("alice"), "quickTestSessions/" + sessionId("bob", "quick1", todayKey()))),
  );
});

// ---------------------------------------------------------------------------
// The daily counter — this document IS the rate limit
// ---------------------------------------------------------------------------

test("the daily counter is readable by its owner and writable by nobody", async () => {
  const day = todayKey();
  await assertSucceeds(getDoc(doc(asUser("alice"), "users/alice/quickTestDays/" + day)));
  // Writable would mean resettable, and a resettable counter is no limit.
  await assertFails(
    setDoc(doc(asUser("alice"), "users/alice/quickTestDays/" + day), { dayKey: day, count: 0 }),
  );
  await assertFails(
    updateDoc(doc(asUser("alice"), "users/alice/quickTestDays/" + day), { count: 0 }),
  );
  // Deleting is the same bypass by another route.
  await assertFails(deleteDoc(doc(asUser("alice"), "users/alice/quickTestDays/" + day)));
});

test("a client cannot pre-create tomorrow's counter at a negative count", async () => {
  await assertFails(
    setDoc(doc(asUser("alice"), "users/alice/quickTestDays/" + todayKey(1)), {
      dayKey: todayKey(1),
      count: -100,
    }),
  );
});

test("a user cannot read or write another user's daily counter", async () => {
  const db = asUser("bob");
  await assertFails(getDoc(doc(db, "users/alice/quickTestDays/" + todayKey())));
  await assertFails(
    setDoc(doc(db, "users/alice/quickTestDays/" + todayKey()), { count: 0 }),
  );
});

// ---------------------------------------------------------------------------
// The cooldown marker
// ---------------------------------------------------------------------------

test("the cooldown marker is readable by its owner and writable by nobody", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "users/alice/quickTestApps/quick1")));
  // Writable would be a one-line cooldown bypass.
  await assertFails(
    updateDoc(doc(asUser("alice"), "users/alice/quickTestApps/quick1"), {
      lastSessionDayKey: "2020-01-01",
    }),
  );
  await assertFails(deleteDoc(doc(asUser("alice"), "users/alice/quickTestApps/quick1")));
});

test("an admin cannot write the counter or the cooldown marker from the client", async () => {
  const db = asUser("admin1");
  await assertFails(
    setDoc(doc(db, "users/alice/quickTestDays/" + todayKey()), { count: 0 }),
  );
  await assertFails(
    setDoc(doc(db, "users/alice/quickTestApps/quick1"), { lastSessionDayKey: "2020-01-01" }),
  );
});

// ---------------------------------------------------------------------------
// The discovery pool
// ---------------------------------------------------------------------------

test("the pool is readable by any signed-in user and writable by none", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "discovery/quickTestPool")));
  await assertFails(
    setDoc(doc(asUser("alice"), "discovery/quickTestPool"), { appIds: ["plain1"] }),
  );
  await assertFails(
    updateDoc(doc(asUser("alice"), "discovery/quickTestPool"), { appIds: ["plain1"] }),
  );
  // Admins too — rotation fairness is decided server-side or not at all.
  await assertFails(
    setDoc(doc(asUser("admin1"), "discovery/quickTestPool"), { appIds: ["plain1"] }),
  );
  await assertFails(deleteDoc(doc(asUser("admin1"), "discovery/quickTestPool")));
});

test("a client cannot create sibling documents under discovery", async () => {
  await assertFails(
    setDoc(doc(asUser("alice"), "discovery/somethingElse"), { appIds: ["plain1"] }),
  );
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test("an unauthenticated client cannot read the pool or any Quick Test state", async () => {
  const db = asAnon();
  await assertFails(getDoc(doc(db, "discovery/quickTestPool")));
  await assertFails(
    getDoc(doc(db, "quickTestSessions/" + sessionId("alice", "quick1", todayKey()))),
  );
  await assertFails(getDoc(doc(db, "users/alice/quickTestDays/" + todayKey())));
  await assertFails(getDoc(doc(db, "users/alice/quickTestApps/quick1")));
});

test("an unauthenticated client cannot create a Quick Test session", async () => {
  const db = asAnon();
  await assertFails(
    setDoc(doc(db, "quickTestSessions/" + sessionId("anon", "quick1", todayKey())), {
      uid: "anon",
      appId: "quick1",
    }),
  );
});

test("a suspended user cannot manufacture Quick Test state", async () => {
  const db = asUser("banned");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, "quickTestSessions/" + sessionId("banned", "quick1", day)), {
      uid: "banned",
      appId: "quick1",
      dayKey: day,
      openedAt: serverTimestamp(),
    }),
  );
  await assertFails(
    setDoc(doc(db, "users/banned/quickTestDays/" + day), { dayKey: day, count: 0 }),
  );
});

// ---------------------------------------------------------------------------
// App eligibility is server-owned
// ---------------------------------------------------------------------------

test("a developer cannot enable Quick Tests on their own app", async () => {
  // The promotion attack: quickTestEnabled decides whether an app is surfaced
  // at all, so an owner who could set it could put themselves in every pool.
  await assertFails(
    updateDoc(doc(asUser("bob"), "apps/plain1"), {
      quickTestEnabled: true,
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a developer cannot disable Quick Tests on someone else's app", async () => {
  await assertFails(
    updateDoc(doc(asUser("alice"), "apps/quick1"), {
      quickTestEnabled: false,
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a developer cannot stamp lastSurfacedAt to game the rotation", async () => {
  // Rotation is least-recently-surfaced-first, so a writable cursor would let
  // an owner pin their app to the front of every refresh.
  await assertFails(
    updateDoc(doc(asUser("bob"), "apps/quick1"), {
      lastSurfacedAt: new Date("2000-01-01"),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("an admin cannot flip app eligibility from the client", async () => {
  await assertFails(
    updateDoc(doc(asUser("admin1"), "apps/plain1"), { quickTestEnabled: true }),
  );
});

test("a developer cannot submit a new app pre-enabled for Quick Tests", async () => {
  await assertFails(
    setDoc(doc(asUser("bob"), "apps/sneaky1"), {
      ownerId: "bob",
      appName: "Sneaky",
      packageName: "com.bob.sneaky",
      versionName: "1.0",
      playStoreUrl: "https://x",
      closedTestingUrl: "https://x",
      iconUrl: null,
      description: "d",
      status: "pendingReview",
      quickTestEnabled: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("an ordinary app edit still succeeds alongside the new Quick Test fields", async () => {
  // Guards the allow-lists against over-tightening: the Quick Test fields are
  // refused, but everything a developer legitimately edits must still pass.
  await assertSucceeds(
    updateDoc(doc(asUser("bob"), "apps/quick1"), {
      appName: "Quick One v2",
      description: "updated",
      updatedAt: serverTimestamp(),
    }),
  );
});

// ---------------------------------------------------------------------------
// Absent-field safety and containment
// ---------------------------------------------------------------------------

test("a user with no role or isSuspended can still read Quick Test discovery", async () => {
  // The production account shape. A dot-access on a missing key in any new
  // rule would error and deny — the defect that broke testingLogs creates.
  const db = asUser("nofields");
  await assertSucceeds(getDoc(doc(db, "discovery/quickTestPool")));
  await assertSucceeds(getDoc(doc(db, "apps/quick1")));
  await assertSucceeds(getDocs(collection(db, "users/nofields/quickTestApps")));
  await assertSucceeds(
    getDoc(doc(db, "users/nofields/quickTestDays/" + todayKey())),
  );
});

test("Quick Test rules did not open a path into the commitment collections", async () => {
  // The containment guarantee, asserted from the client's side: nothing added
  // for Quick Tests may have loosened assignments, logs or the coin ledger.
  const db = asUser("alice");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, "testingAssignments/quick1__alice"), {
      appId: "quick1",
      testerId: "alice",
      status: "ready",
    }),
  );
  await assertFails(
    setDoc(doc(db, "testingLogs/quick1__alice__" + day), {
      assignmentId: "quick1__alice",
      testerId: "alice",
      date: day,
      createdAt: serverTimestamp(),
    }),
  );
  await assertFails(
    setDoc(doc(db, "users/alice/coinTransactions/quick_forged"), { amount: 50 }),
  );
});

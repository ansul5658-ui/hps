/**
 * Firestore security rule tests.
 *
 * Run with:  firebase emulators:exec --only firestore "npm --prefix tests/rules test"
 *
 * These assert the *deny* half of the security model: the operations a client
 * must never be able to perform directly, including as an admin. Admin
 * authority lives in callable Cloud Functions running with Admin SDK
 * credentials, which bypass these rules entirely — so "admin is denied here"
 * is the expected, correct result.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
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
  query,
  orderBy,
  serverTimestamp,
} = require("firebase/firestore");

const RULES_PATH = path.resolve(__dirname, "../../firestore.rules");

let testEnv;

/** The UTC day key the rules derive from request.time. */
function todayKey(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function asUser(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}
function asAnon() {
  return testEnv.unauthenticatedContext().firestore();
}

/** Seed fixtures with rules disabled — this stands in for server-side writes. */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, "users/admin1"), { uid: "admin1", role: "admin", email: "a@x.com" });
    await setDoc(doc(db, "users/alice"), { uid: "alice", role: "member", isSuspended: false });
    await setDoc(doc(db, "users/bob"), { uid: "bob", role: "member", isSuspended: false });
    await setDoc(doc(db, "users/banned"), { uid: "banned", role: "member", isSuspended: true });
    // Mirrors what the client's own create rule actually produces: no `role`,
    // no `isSuspended` at all. Every ordinary sign-in looks like this until
    // an admin explicitly promotes or suspends the account — see the
    // "missing optional fields" section below.
    await setDoc(doc(db, "users/nofields"), { uid: "nofields", email: "nofields@x.com" });

    await setDoc(doc(db, "apps/app1"), {
      ownerId: "bob",
      appName: "Bob's App",
      packageName: "com.bob.app",
      status: "approved",
      description: "hello",
    });
    await setDoc(doc(db, "apps/pending1"), {
      ownerId: "bob",
      appName: "Pending",
      packageName: "com.bob.pending",
      status: "pendingReview",
    });

    await setDoc(doc(db, "groups/g1"), {
      name: "Official",
      status: "open",
      memberCap: 0,
      memberCount: 0,
    });

    // Fresh assignment for alice (no days logged yet).
    await setDoc(doc(db, "testingAssignments/app1__alice"), {
      appId: "app1",
      testerId: "alice",
      developerId: "bob",
      groupId: "g1",
      daysRequired: 14,
      daysCompleted: 0,
      coinReward: 50,
      status: "ready",
    });
    // Assignment that has met its requirement.
    await setDoc(doc(db, "testingAssignments/done__alice"), {
      appId: "app1",
      testerId: "alice",
      developerId: "bob",
      daysRequired: 14,
      daysCompleted: 14,
      coinReward: 50,
      status: "inProgress",
    });
    // Fresh assignment for the user with no isSuspended/role fields at all.
    await setDoc(doc(db, "testingAssignments/app1__nofields"), {
      appId: "app1",
      testerId: "nofields",
      developerId: "bob",
      groupId: "g1",
      daysRequired: 14,
      daysCompleted: 0,
      coinReward: 50,
      status: "ready",
    });
    // Same, but owned by the suspended user.
    await setDoc(doc(db, "testingAssignments/done__banned"), {
      appId: "app1",
      testerId: "banned",
      developerId: "bob",
      daysRequired: 14,
      daysCompleted: 14,
      coinReward: 50,
      status: "inProgress",
    });
    // A verified, paid assignment — the terminal state adminVerifyAssignment
    // produces, including the audit fields it stamps on.
    await setDoc(doc(db, "testingAssignments/closed__alice"), {
      appId: "app1",
      testerId: "alice",
      developerId: "bob",
      daysRequired: 14,
      daysCompleted: 14,
      coinReward: 50,
      status: "completed",
      completedAt: new Date(),
      verifiedBy: "admin1",
    });

    // Completion rewards exactly as adminVerifyAssignment writes them. Only
    // the Admin SDK can produce these, so seeding them here is the only way to
    // give the client-side rules real paid history to try (and fail) to tamper
    // with. `nofields` gets one too: that account has no role, no isSuspended
    // and no coinBalance, which is the shape of every real user document.
    const rewardEntry = {
      amount: 50,
      kind: "earn",
      source: "assignmentCompletion",
      reason: "Completed testing for app1",
      actorId: "admin1",
      recordedByAdmin: true,
      createdAt: new Date(),
    };
    await setDoc(doc(db, "users/alice/coinTransactions/done_closed__alice"), {
      ...rewardEntry,
      userId: "alice",
      relatedAssignmentId: "closed__alice",
    });
    await setDoc(doc(db, "users/bob/coinTransactions/done_app9__bob"), {
      ...rewardEntry,
      userId: "bob",
      relatedAssignmentId: "app9__bob",
    });
    await setDoc(doc(db, "users/nofields/coinTransactions/done_app1__nofields"), {
      ...rewardEntry,
      userId: "nofields",
      relatedAssignmentId: "app1__nofields",
    });

    await setDoc(doc(db, "users/alice/memberships/g1"), {
      groupId: "g1",
      userId: "alice",
      joinedAt: new Date(),
    });
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apptesting-rules-test",
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
// App approval status — server-authoritative
// ---------------------------------------------------------------------------

test("a normal client cannot change apps.status", async () => {
  const db = asUser("bob"); // the owner, the most privileged client there is
  await assertFails(updateDoc(doc(db, "apps/pending1"), { status: "approved" }));
});

test("a non-owner cannot change apps.status", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, "apps/pending1"), { status: "approved" }));
});

test("even an admin cannot change apps.status from the client", async () => {
  // Approval happens only through the adminSetAppStatus callable.
  const db = asUser("admin1");
  await assertFails(updateDoc(doc(db, "apps/pending1"), { status: "approved" }));
});

test("the owner can still edit their app's profile fields", async () => {
  const db = asUser("bob");
  await assertSucceeds(
    updateDoc(doc(db, "apps/app1"), { description: "updated", updatedAt: serverTimestamp() }),
  );
});

test("an owner cannot reassign their app to someone else", async () => {
  const db = asUser("bob");
  await assertFails(updateDoc(doc(db, "apps/app1"), { ownerId: "alice" }));
});

test("app submission must start at pendingReview and be owned by the caller", async () => {
  const db = asUser("alice");
  const base = {
    ownerId: "alice",
    appName: "A",
    packageName: "com.a",
    versionName: "1.0",
    playStoreUrl: "",
    closedTestingUrl: "",
    iconUrl: null,
    description: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await assertSucceeds(setDoc(doc(db, "apps/new1"), { ...base, status: "pendingReview" }));
  await assertFails(setDoc(doc(db, "apps/new2"), { ...base, status: "approved" }));
  await assertFails(
    setDoc(doc(db, "apps/new3"), { ...base, ownerId: "bob", status: "pendingReview" }),
  );
});

test("a suspended user cannot submit an app", async () => {
  const db = asUser("banned");
  await assertFails(
    setDoc(doc(db, "apps/new4"), {
      ownerId: "banned",
      appName: "A",
      packageName: "com.a",
      versionName: "1.0",
      playStoreUrl: "",
      closedTestingUrl: "",
      iconUrl: null,
      description: "",
      status: "pendingReview",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

// ---------------------------------------------------------------------------
// Suspension and other server-owned user fields
// ---------------------------------------------------------------------------

test("a normal client cannot change its own isSuspended", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, "users/alice"), { isSuspended: true }));
});

test("a suspended user cannot un-suspend themselves", async () => {
  const db = asUser("banned");
  await assertFails(updateDoc(doc(db, "users/banned"), { isSuspended: false }));
});

test("a normal user cannot suspend another user", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, "users/bob"), { isSuspended: true }));
});

test("even an admin cannot change isSuspended from the client", async () => {
  const db = asUser("admin1");
  await assertFails(updateDoc(doc(db, "users/bob"), { isSuspended: true }));
});

test("a client cannot grant itself a role, coins or trust score", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, "users/alice"), { role: "admin" }));
  await assertFails(updateDoc(doc(db, "users/alice"), { coinBalance: 9999 }));
  await assertFails(updateDoc(doc(db, "users/alice"), { trustScore: 100 }));
});

test("a user can still edit their own profile fields", async () => {
  const db = asUser("alice");
  await assertSucceeds(
    updateDoc(doc(db, "users/alice"), { displayName: "Alice A", updatedAt: serverTimestamp() }),
  );
});

test("users can read themselves, admins can read the roster, nobody else can", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "users/alice")));
  await assertFails(getDoc(doc(asUser("alice"), "users/bob")));
  await assertSucceeds(getDocs(collection(asUser("admin1"), "users")));
  await assertFails(getDocs(collection(asUser("alice"), "users")));
  await assertFails(getDoc(doc(asAnon(), "users/alice")));
});

// ---------------------------------------------------------------------------
// Missing optional fields — isSuspended and role can genuinely be absent
//
// Regression coverage for the production bug where isSuspended()/isAdmin()
// dot-accessed a map key ("...data.isSuspended", "...data.role") that most
// real user docs simply don't have. Dot access on an absent key is a rules
// evaluation ERROR in production (confirmed via the Rules Playground), not
// `null`/`false` — and every fixture above sets both fields explicitly, so
// this whole class of bug passed 48/48 tests undetected. `users/nofields`
// (seeded with no isSuspended, no role) closes that gap.
//
// Note on Case B: `assertFails` cannot distinguish "isAdmin() evaluated to
// false" from "isAdmin() errored and the surrounding rule denied" — both
// surface identically as a denied request, exactly as production's
// PERMISSION_DENIED did not reveal it was really an evaluation error. The
// case is still asserted because "missing role must never grant admin" is
// the required security invariant either way; Case A below is the test that
// actually distinguishes the old buggy behavior (denied) from the fixed
// behavior (allowed), because a wrongly-erroring activeUser() denies a
// legitimate write instead of just failing to grant a privilege.
// ---------------------------------------------------------------------------

test("Case A: a user with no isSuspended field can still submit an app", async () => {
  const db = asUser("nofields");
  await assertSucceeds(
    setDoc(doc(db, "apps/nofields-app"), {
      ownerId: "nofields",
      appName: "A",
      packageName: "com.a",
      versionName: "1.0",
      playStoreUrl: "",
      closedTestingUrl: "",
      iconUrl: null,
      description: "",
      status: "pendingReview",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }),
  );
});

test("Case A: a user with no isSuspended field is denied a log write, not errored", async () => {
  // This used to assert the write SUCCEEDED: a client could create its own
  // testing log, and the point was that a missing `isSuspended` did not make
  // the rule throw. Testing logs are now server-written only, so the write is
  // refused — but the reason must still be a clean denial rather than a rules
  // evaluation error, which is what this keeps checking.
  const db = asUser("nofields");
  const day = todayKey();
  await assertFails(
    setDoc(
      doc(db, `testingLogs/app1__nofields__${day}`),
      { assignmentId: "app1__nofields", testerId: "nofields", date: day, createdAt: serverTimestamp() },
    ),
  );
  // The same user can still READ their own documents, which is what proves
  // the denial came from the write rule and not from a broken helper.
  await assertSucceeds(getDoc(doc(db, "users/nofields")));
});

test("Case B: a user with no role field is not treated as admin", async () => {
  const db = asUser("nofields");
  await assertFails(getDoc(doc(db, "users/bob")));
  await assertFails(getDocs(collection(db, "users")));
});

test("Case C: an explicitly suspended user is still blocked (unchanged by the fix)", async () => {
  const db = asUser("banned");
  await assertFails(updateDoc(doc(db, "users/banned"), { isSuspended: false }));
  const day = todayKey();
  await assertFails(
    setDoc(
      doc(db, `testingLogs/done__banned__${day}`),
      { assignmentId: "done__banned", testerId: "banned", date: day, createdAt: serverTimestamp() },
    ),
  );
});

test("Case D: an explicitly admin user still passes admin authorization (unchanged by the fix)", async () => {
  await assertSucceeds(getDoc(doc(asUser("admin1"), "users/bob")));
  await assertSucceeds(getDocs(collection(asUser("admin1"), "users")));
});

test("Case E: an ordinary member with both fields set behaves exactly as before", async () => {
  const db = asUser("alice");
  await assertSucceeds(
    updateDoc(doc(db, "users/alice"), { displayName: "Alice B", updatedAt: serverTimestamp() }),
  );
  await assertFails(getDoc(doc(db, "users/bob")));
});

// ---------------------------------------------------------------------------
// Assignments — creation is server-only, progress fields are server-owned
// ---------------------------------------------------------------------------

test("a normal client cannot create a testing assignment", async () => {
  const db = asUser("alice");
  await assertFails(
    setDoc(doc(db, "testingAssignments/forged"), {
      appId: "app1",
      testerId: "alice",
      developerId: "bob",
      daysRequired: 1,
      daysCompleted: 0,
      coinReward: 9999,
      status: "ready",
    }),
  );
});

test("even an admin cannot create a testing assignment from the client", async () => {
  const db = asUser("admin1");
  await assertFails(
    setDoc(doc(db, "testingAssignments/forged2"), {
      appId: "app1",
      testerId: "admin1",
      developerId: "bob",
      daysRequired: 1,
      daysCompleted: 0,
      coinReward: 1,
      status: "ready",
    }),
  );
});

test("a tester cannot change daysCompleted", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, "testingAssignments/app1__alice"), { daysCompleted: 14 }));
});

test("a tester cannot change coinReward", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, "testingAssignments/app1__alice"), { coinReward: 9999 }));
});

test("a tester cannot mark an assignment completed themselves", async () => {
  const db = asUser("alice");
  await assertFails(
    updateDoc(doc(db, "testingAssignments/done__alice"), { status: "completed" }),
  );
});

test("a tester cannot claim completion before the required days are logged", async () => {
  const db = asUser("alice");
  await assertFails(
    updateDoc(doc(db, "testingAssignments/app1__alice"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a tester can no longer request verification — completion is automatic", async () => {
  // This used to be the one permitted client write on an assignment. The
  // testing engine removed the need for it: recording the fourteenth
  // qualifying day completes the commitment and returns the staked coins in
  // one server transaction, so there is nothing left to request. With the need
  // gone, the permission went too.
  const db = asUser("alice");
  await assertFails(
    updateDoc(doc(db, "testingAssignments/done__alice"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a suspended tester cannot request verification", async () => {
  const db = asUser("banned");
  await assertFails(
    updateDoc(doc(db, "testingAssignments/done__banned"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a tester cannot touch someone else's assignment", async () => {
  const db = asUser("bob");
  await assertFails(
    updateDoc(doc(db, "testingAssignments/done__alice"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a tester cannot delete an assignment", async () => {
  const db = asUser("alice");
  await assertFails(deleteDoc(doc(db, "testingAssignments/app1__alice")));
});

test("tester and developer can read the assignment; an unrelated user cannot", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "testingAssignments/app1__alice")));
  await assertSucceeds(getDoc(doc(asUser("bob"), "testingAssignments/app1__alice")));
  await assertFails(getDoc(doc(asUser("banned"), "testingAssignments/app1__alice")));
});

// ---------------------------------------------------------------------------
// Daily testing logs — the device clock is no longer trusted
// ---------------------------------------------------------------------------

function logPayload(assignmentId, testerId, dayKey) {
  return { assignmentId, testerId, date: dayKey, createdAt: serverTimestamp() };
}

test("a tester cannot write a testing log, even a perfectly well-formed one", async () => {
  // The strongest form of the check: this payload satisfied every clause of
  // the old create rule — right tester, right id, today's date, a server
  // timestamp — and it is still refused, because the collection has no client
  // write path at all now. `recordTestingDay` is the only door.
  const db = asUser("alice");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, `testingLogs/app1__alice__${day}`), logPayload("app1__alice", "alice", day)),
  );
});

test("a device clock set forward cannot buy an extra testing day", async () => {
  const db = asUser("alice");
  const tomorrow = todayKey(1);
  await assertFails(
    setDoc(
      doc(db, `testingLogs/app1__alice__${tomorrow}`),
      logPayload("app1__alice", "alice", tomorrow),
    ),
  );
});

test("a device clock set backward cannot backfill a missed day", async () => {
  const db = asUser("alice");
  const yesterday = todayKey(-1);
  await assertFails(
    setDoc(
      doc(db, `testingLogs/app1__alice__${yesterday}`),
      logPayload("app1__alice", "alice", yesterday),
    ),
  );
});

test("a client cannot log a day once, let alone twice", async () => {
  // Same-day idempotency is now enforced server-side by a deterministic log id
  // plus `tx.create` (see functions/test-emulator/testingDays.concurrency).
  // At the rules layer the simpler fact holds: neither attempt is permitted.
  const db = asUser("alice");
  const day = todayKey();
  const ref = doc(db, `testingLogs/app1__alice__${day}`);
  await assertFails(setDoc(ref, logPayload("app1__alice", "alice", day)));
  await assertFails(setDoc(ref, logPayload("app1__alice", "alice", day)));
});

test("a log cannot be smuggled in under a mismatched document id", async () => {
  const db = asUser("alice");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, "testingLogs/some_other_id"), logPayload("app1__alice", "alice", day)),
  );
});

test("a log cannot be written against someone else's assignment", async () => {
  const db = asUser("bob");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, `testingLogs/app1__alice__${day}`), logPayload("app1__alice", "bob", day)),
  );
});

test("a log cannot claim a different tester's uid", async () => {
  const db = asUser("bob");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, `testingLogs/app1__alice__${day}`), logPayload("app1__alice", "alice", day)),
  );
});

test("a suspended tester cannot log a testing day", async () => {
  const db = asUser("banned");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, `testingLogs/done__banned__${day}`), logPayload("done__banned", "banned", day)),
  );
});

test("a log cannot be added to an assignment that is no longer active", async () => {
  const db = asUser("alice");
  const day = todayKey();
  await assertFails(
    setDoc(
      doc(db, `testingLogs/closed__alice__${day}`),
      logPayload("closed__alice", "alice", day),
    ),
  );
});

test("a log cannot reference an assignment that does not exist", async () => {
  const db = asUser("alice");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, `testingLogs/ghost__${day}`), logPayload("ghost", "alice", day)),
  );
});

test("logs are sealed: no client create, update or delete", async () => {
  // A testing log is worth 1/14th of a 50-coin commitment, so deleting one
  // silently reduces a tester's progress and deleting the fourteenth strips
  // evidence from a settlement. All three verbs are refused.
  const day = todayKey();
  const path = `testingLogs/app1__alice__${day}`;
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    // Stands in for the server write, which is the only way one appears.
    await setDoc(doc(ctx.firestore(), path), {
      assignmentId: "app1__alice",
      cycle: 1,
      testerId: "alice",
      date: day,
      timeZone: "Asia/Kolkata",
      createdAt: new Date(),
    });
  });

  const db = asUser("alice");
  const ref = doc(db, path);
  await assertSucceeds(getDoc(ref)); // reading your own log is still fine
  await assertFails(updateDoc(ref, { date: todayKey(1) }));
  await assertFails(deleteDoc(ref));
  await assertFails(setDoc(ref, logPayload("app1__alice", "alice", day)));
});

// ---------------------------------------------------------------------------
// Groups and membership — joining is server-authoritative
// ---------------------------------------------------------------------------

test("a client cannot create a membership directly (cap and suspension live server-side)", async () => {
  const db = asUser("bob");
  await assertFails(
    setDoc(doc(db, "users/bob/memberships/g1"), {
      groupId: "g1",
      userId: "bob",
      joinedAt: serverTimestamp(),
    }),
  );
});

test("a client cannot write a membership into someone else's account", async () => {
  const db = asUser("alice");
  await assertFails(
    setDoc(doc(db, "users/bob/memberships/g1"), {
      groupId: "g1",
      userId: "bob",
      joinedAt: serverTimestamp(),
    }),
  );
});

test("a user can still leave a group they are in", async () => {
  const db = asUser("alice");
  await assertSucceeds(deleteDoc(doc(db, "users/alice/memberships/g1")));
});

test("nobody can write group documents from the client, admin included", async () => {
  await assertFails(setDoc(doc(asUser("alice"), "groups/g2"), { name: "Mine" }));
  await assertFails(setDoc(doc(asUser("admin1"), "groups/g2"), { name: "Mine" }));
  await assertFails(updateDoc(doc(asUser("admin1"), "groups/g1"), { memberCount: 999 }));
});

test("group discovery still works for signed-in users", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), "groups/g1")));
  await assertFails(getDoc(doc(asAnon(), "groups/g1")));
});

test("the server-maintained member mirror is not client-writable", async () => {
  await assertFails(
    setDoc(doc(asUser("alice"), "groups/g1/members/alice"), { userId: "alice" }),
  );
  await assertFails(
    setDoc(doc(asUser("admin1"), "groups/g1/members/bob"), { userId: "bob" }),
  );
});

// ---------------------------------------------------------------------------
// Ledger + catch-all
// ---------------------------------------------------------------------------

test("the coin ledger is not client-writable", async () => {
  const db = asUser("alice");
  await assertFails(
    setDoc(doc(db, "users/alice/coinTransactions/tx1"), { amount: 1000, kind: "earn" }),
  );
});

test("unknown collections stay denied by default", async () => {
  const db = asUser("alice");
  await assertFails(setDoc(doc(db, "reports/r1"), { reason: "spam" }));
  await assertFails(getDoc(doc(db, "adminActions/a1")));
});

// ---------------------------------------------------------------------------
// Completion-reward security model
//
// Coins are created by exactly one thing: the adminVerifyAssignment callable,
// running with Admin SDK credentials, which bypasses these rules entirely.
// Nothing below is a path the server uses — every test here asserts that the
// CLIENT half of that model is shut, so that "server-authoritative" is a
// property of the rules rather than a convention.
//
// `ALICE_ENTRY` is a real reward document seeded with rules disabled. Reading
// it back is how these tests distinguish "denied because the rule refused"
// from "denied because there was nothing there".
// ---------------------------------------------------------------------------

const ALICE_ENTRY = "users/alice/coinTransactions/done_closed__alice";
const BOB_ENTRY = "users/bob/coinTransactions/done_app9__bob";

test("a user cannot create a coin ledger entry, for themselves or anyone else", async () => {
  const db = asUser("alice");
  const forged = {
    userId: "alice",
    amount: 5000,
    kind: "earn",
    source: "assignmentCompletion",
    reason: "definitely earned this",
    createdAt: serverTimestamp(),
  };
  await assertFails(setDoc(doc(db, "users/alice/coinTransactions/done_forged"), forged));
  await assertFails(setDoc(doc(db, "users/bob/coinTransactions/done_forged"), forged));
  // Nor by reusing the id the server would have chosen.
  await assertFails(setDoc(doc(db, "users/alice/coinTransactions/done_app1__alice"), forged));
});

test("a user cannot update a coin ledger entry", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, ALICE_ENTRY), { amount: 5000 }));
  await assertFails(updateDoc(doc(db, ALICE_ENTRY), { reason: "rewritten" }));
  // An overwriting set is still an update of paid history.
  await assertFails(setDoc(doc(db, ALICE_ENTRY), { userId: "alice", amount: 5000 }));
});

test("a user cannot delete a coin ledger entry", async () => {
  await assertFails(deleteDoc(doc(asUser("alice"), ALICE_ENTRY)));
  await assertFails(deleteDoc(doc(asUser("bob"), ALICE_ENTRY)));
});

test("an admin cannot create a coin ledger entry from the client", async () => {
  const db = asUser("admin1");
  await assertFails(
    setDoc(doc(db, "users/alice/coinTransactions/done_admin_forged"), {
      userId: "alice",
      amount: 5000,
      kind: "earn",
      createdAt: serverTimestamp(),
    }),
  );
});

test("an admin cannot update a coin ledger entry from the client", async () => {
  const db = asUser("admin1");
  await assertFails(updateDoc(doc(db, ALICE_ENTRY), { amount: 5000 }));
});

test("an admin cannot delete a coin ledger entry from the client", async () => {
  await assertFails(deleteDoc(doc(asUser("admin1"), ALICE_ENTRY)));
});

test("nothing can be written beneath a ledger entry either", async () => {
  // Deeper paths fall through to the catch-all rather than inheriting the
  // coinTransactions block, which only matches a single id segment.
  await assertFails(
    setDoc(doc(asUser("alice"), `${ALICE_ENTRY}/notes/n1`), { note: "x" }),
  );
  await assertFails(
    setDoc(doc(asUser("admin1"), `${ALICE_ENTRY}/notes/n1`), { note: "x" }),
  );
});

test("a user can read their own coin transactions", async () => {
  const db = asUser("alice");
  await assertSucceeds(getDoc(doc(db, ALICE_ENTRY)));
  // The exact query FirestoreCoinRepository issues.
  await assertSucceeds(
    getDocs(query(collection(db, "users/alice/coinTransactions"), orderBy("createdAt", "desc"))),
  );
});

test("a user cannot read another user's coin transactions", async () => {
  const db = asUser("alice");
  await assertFails(getDoc(doc(db, BOB_ENTRY)));
  await assertFails(getDocs(collection(db, "users/bob/coinTransactions")));
  await assertFails(getDoc(doc(asAnon(), ALICE_ENTRY)));
});

test("an admin can read any user's coin transactions", async () => {
  const db = asUser("admin1");
  await assertSucceeds(getDoc(doc(db, ALICE_ENTRY)));
  await assertSucceeds(getDocs(collection(db, "users/alice/coinTransactions")));
});

test("a user cannot give themselves a coinBalance on create", async () => {
  // Both callers write their OWN document, so identity is satisfied and the
  // only difference between success and failure is the extra field.
  await assertSucceeds(
    setDoc(doc(asUser("fresh"), "users/fresh"), {
      uid: "fresh",
      email: "f@x.com",
      displayName: "Fresh",
    }),
  );
  await assertFails(
    setDoc(doc(asUser("fresh2"), "users/fresh2"), {
      uid: "fresh2",
      email: "f2@x.com",
      displayName: "Fresh Two",
      coinBalance: 9999,
    }),
  );
  await assertFails(
    setDoc(doc(asUser("fresh3"), "users/fresh3"), {
      uid: "fresh3",
      email: "f3@x.com",
      role: "admin",
    }),
  );
});

test("no client can write coinBalance on an existing user", async () => {
  await assertFails(updateDoc(doc(asUser("alice"), "users/alice"), { coinBalance: 9999 }));
  await assertFails(updateDoc(doc(asUser("alice"), "users/alice"), { coinBalance: 1 }));
  // Not even alongside a field they are allowed to change.
  await assertFails(
    updateDoc(doc(asUser("alice"), "users/alice"), {
      displayName: "Alice A",
      coinBalance: 9999,
    }),
  );
  // And not on someone else, admin or not.
  await assertFails(updateDoc(doc(asUser("alice"), "users/bob"), { coinBalance: 9999 }));
  await assertFails(updateDoc(doc(asUser("admin1"), "users/alice"), { coinBalance: 9999 }));
});

test("a tester cannot change an assignment's coinReward", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, "testingAssignments/app1__alice"), { coinReward: 5000 }));
  // Nor smuggle it in alongside the one legitimate status change.
  await assertFails(
    updateDoc(doc(db, "testingAssignments/done__alice"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
      coinReward: 5000,
    }),
  );
});

test("a tester cannot set an assignment to completed", async () => {
  const db = asUser("alice");
  // Even with the day requirement genuinely met — completion is the server's.
  await assertFails(
    updateDoc(doc(db, "testingAssignments/done__alice"), {
      status: "completed",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("a tester cannot move a completed assignment back to an earlier status", async () => {
  const db = asUser("alice");
  for (const status of ["waitingForVerification", "inProgress", "ready"]) {
    await assertFails(
      updateDoc(doc(db, "testingAssignments/closed__alice"), {
        status,
        updatedAt: serverTimestamp(),
      }),
    );
  }
});

test("every server-owned assignment field stays closed to the tester", async () => {
  // Each attempt is otherwise a LEGITIMATE verification request on an
  // eligible assignment — the same write the next test proves succeeds. The
  // extra field is therefore the only thing that can cause the denial, so
  // these would start failing if the affected-keys check were ever loosened.
  const db = asUser("alice");
  const forbidden = {
    // Every value here must DIFFER from the stored one: `affectedKeys()`
    // reports changed keys, so re-writing an identical value is a no-op that
    // the rule correctly permits (see the next test).
    daysCompleted: 99,
    daysRequired: 1,
    coinReward: 5000,
    testerId: "bob",
    developerId: "alice",
    appId: "app2",
    groupId: "g2",
    completedAt: serverTimestamp(),
    verifiedBy: "alice",
    createdAt: serverTimestamp(),
  };
  for (const [field, value] of Object.entries(forbidden)) {
    await assertFails(
      updateDoc(doc(db, "testingAssignments/done__alice"), {
        status: "waitingForVerification",
        updatedAt: serverTimestamp(),
        [field]: value,
      }),
    );
  }
});

test("even the formerly-permitted write is now refused", async () => {
  // The test above lists forbidden fields. This one used to prove the denial
  // was about those fields specifically, by showing the same write succeeded
  // without them. That contrast is gone: `testingAssignments` has no
  // client-writable field at all now, so the clean write is refused too.
  //
  // The contrast has moved elsewhere — a tester can still edit their own
  // profile (see "the legitimate tester flows still work"), which is what
  // shows the denial here is scoped rather than a blanket lockout.
  await assertFails(
    updateDoc(doc(asUser("alice"), "testingAssignments/done__alice"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("the no-op loophole is closed along with the write itself", async () => {
  // This used to document a real subtlety: `affectedKeys()` reports only keys
  // whose value actually CHANGED, so echoing a protected field's stored value
  // back was a permitted no-op. It was safe — the tester gained no state they
  // did not already have — but it was a nuance that had to be reasoned about.
  //
  // With `allow update: if false` there is nothing left to reason about. Both
  // the echo and the real change are refused, which is a smaller thing to hold
  // in your head and a smaller thing to get wrong later.
  const db = asUser("alice");
  await assertFails(
    updateDoc(doc(db, "testingAssignments/done__alice"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
      daysCompleted: 14, // identical to the stored value
    }),
  );
  await assertFails(
    updateDoc(doc(db, "testingAssignments/app1__alice"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
      daysCompleted: 14, // stored value is 0 — a real change
    }),
  );
});

test("a user with no role, isSuspended or coinBalance can still read their own wallet", async () => {
  // The missing-field regression, now on the coin path: absent fields must
  // evaluate, not error.
  const db = asUser("nofields");
  await assertSucceeds(getDoc(doc(db, "users/nofields")));
  await assertSucceeds(
    getDoc(doc(db, "users/nofields/coinTransactions/done_app1__nofields")),
  );
  await assertSucceeds(
    getDocs(query(collection(db, "users/nofields/coinTransactions"), orderBy("createdAt", "desc"))),
  );
  // Still not an admin, and still cannot write the ledger.
  await assertFails(getDoc(doc(db, ALICE_ENTRY)));
  await assertFails(
    setDoc(doc(db, "users/nofields/coinTransactions/done_forged"), { amount: 1 }),
  );
});

test("the legitimate tester flows still work after the testing engine landed", async () => {
  // The contrast that matters: the lockdown of testingLogs and
  // testingAssignments is SCOPED, not a blanket refusal of everything a
  // signed-in tester does. Logging a day and requesting verification are gone
  // from this list because both are server-side operations now; everything a
  // tester legitimately owns still works.
  // Reading your own assignment and your own logs.
  await assertSucceeds(getDoc(doc(asUser("alice"), "testingAssignments/done__alice")));
  // Editing an own profile field.
  await assertSucceeds(
    updateDoc(doc(asUser("alice"), "users/alice"), {
      displayName: "Alice A",
      updatedAt: serverTimestamp(),
    }),
  );
});

test("suspended-user protections still hold across the reward model", async () => {
  const db = asUser("banned");
  const day = todayKey();
  await assertFails(
    setDoc(doc(db, `testingLogs/done__banned__${day}`), logPayload("done__banned", "banned", day)),
  );
  await assertFails(
    updateDoc(doc(db, "testingAssignments/done__banned"), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
    }),
  );
  await assertFails(updateDoc(doc(db, "users/banned"), { isSuspended: false }));
  await assertFails(
    setDoc(doc(db, "users/banned/coinTransactions/done_forged"), { amount: 50 }),
  );
});

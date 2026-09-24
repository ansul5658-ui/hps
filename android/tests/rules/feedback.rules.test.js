/**
 * Firestore security rule tests for tester feedback (Batch 9C).
 *
 * Run with:  firebase emulators:exec --only firestore "npm --prefix tests/rules test"
 *
 * Kept in its own file with its own projectId, like every other file here:
 * these run in parallel processes, so sharing a project would mean one file's
 * clearFirestore() wiping another's fixtures.
 *
 * THE THREAT MODEL
 * Feedback is written only by the submitTestingFeedback callable, which checks
 * that the caller actually tested the app. A client able to write here could:
 *   * forge feedback for an app they never tested (create)
 *   * rewrite what a developer was told, their own or someone else's (update)
 *   * erase criticism (delete)
 * And a developer able to READ here would see which tester said what, which
 * the product rule forbids - they get an anonymous view through a callable.
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
  query,
  where,
} = require("firebase/firestore");

const RULES_PATH = path.resolve(__dirname, "../../firestore.rules");

let testEnv;

function asUser(uid) {
  return testEnv.authenticatedContext(uid).firestore();
}
function asAnon() {
  return testEnv.unauthenticatedContext().firestore();
}

const APP = "app1";
const ALICE = "alice";
const BOB = "bob";
const DEV = "dev1";
const A_C1 = `${APP}__${ALICE}__c1`;
const B_C1 = `${APP}__${BOB}__c1`;
const FEEDBACK = (id) => `feedback/${id}`;

function feedbackDoc(overrides = {}) {
  return {
    assignmentId: A_C1,
    appId: APP,
    testerId: ALICE,
    developerId: DEV,
    cycle: 1,
    rating: 4,
    comment: "Solid.",
    foundBug: false,
    submittedAt: new Date(),
    ...overrides,
  };
}

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/admin1"), { uid: "admin1", role: "admin" });
    await setDoc(doc(db, `users/${ALICE}`), { uid: ALICE });
    await setDoc(doc(db, `users/${BOB}`), { uid: BOB });
    await setDoc(doc(db, `users/${DEV}`), { uid: DEV });
    await setDoc(doc(db, `apps/${APP}`), { ownerId: DEV, status: "approved" });
    await setDoc(doc(db, FEEDBACK(A_C1)), feedbackDoc());
    await setDoc(doc(db, FEEDBACK(B_C1)), feedbackDoc({ assignmentId: B_C1, testerId: BOB, rating: 1 }));
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apptesting-feedback-rules",
    firestore: {
      rules: fs.readFileSync(RULES_PATH, "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

test.beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

test.after(async () => {
  if (testEnv) await testEnv.cleanup();
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

test("the author can read their own feedback", async () => {
  await assertSucceeds(getDoc(doc(asUser(ALICE), FEEDBACK(A_C1))));
});

test("another tester cannot read someone else's feedback", async () => {
  await assertFails(getDoc(doc(asUser(BOB), FEEDBACK(A_C1))));
});

test("the developer cannot read feedback directly - it would name the tester", async () => {
  await assertFails(getDoc(doc(asUser(DEV), FEEDBACK(A_C1))));
  await assertFails(getDocs(query(collection(asUser(DEV), "feedback"), where("appId", "==", APP))));
  await assertFails(getDocs(query(collection(asUser(DEV), "feedback"), where("developerId", "==", DEV))));
});

test("an admin can read any feedback", async () => {
  await assertSucceeds(getDoc(doc(asUser("admin1"), FEEDBACK(A_C1))));
  await assertSucceeds(getDocs(collection(asUser("admin1"), "feedback")));
});

test("an anonymous visitor cannot read feedback", async () => {
  await assertFails(getDoc(doc(asAnon(), FEEDBACK(A_C1))));
});

test("a tester can list only their own feedback", async () => {
  const db = asUser(ALICE);
  await assertSucceeds(getDocs(query(collection(db, "feedback"), where("testerId", "==", ALICE))));
  await assertFails(getDocs(query(collection(db, "feedback"), where("testerId", "==", BOB))));
  await assertFails(getDocs(collection(db, "feedback")));
});

test("a missing feedback document is not an existence oracle", async () => {
  // Ids are deterministic; "not found" vs "denied" would reveal who tested what.
  await assertFails(getDoc(doc(asUser(ALICE), FEEDBACK(`${APP}__${ALICE}__c2`))));
  await assertFails(getDoc(doc(asUser(BOB), FEEDBACK(`${APP}__carol__c1`))));
});

// ---------------------------------------------------------------------------
// Writes - refused for everyone, the author and admins included
// ---------------------------------------------------------------------------

test("no client can create feedback, even for their own assignment", async () => {
  await assertFails(setDoc(doc(asUser(ALICE), FEEDBACK(`${APP}__${ALICE}__c2`)), feedbackDoc({ assignmentId: `${APP}__${ALICE}__c2` })));
  // Forging feedback for an app never tested.
  await assertFails(setDoc(doc(asUser(ALICE), FEEDBACK(`app9__${ALICE}__c1`)), feedbackDoc({ appId: "app9" })));
  await assertFails(setDoc(doc(asUser("admin1"), FEEDBACK(`${APP}__x__c1`)), feedbackDoc({ testerId: "x" })));
});

test("the author cannot edit their own feedback", async () => {
  const db = asUser(ALICE);
  await assertFails(updateDoc(doc(db, FEEDBACK(A_C1)), { rating: 5 }));
  await assertFails(updateDoc(doc(db, FEEDBACK(A_C1)), { comment: "changed my mind" }));
  await assertFails(setDoc(doc(db, FEEDBACK(A_C1)), feedbackDoc({ rating: 1 })));
});

test("another tester cannot edit or delete someone else's feedback", async () => {
  const db = asUser(BOB);
  await assertFails(updateDoc(doc(db, FEEDBACK(A_C1)), { rating: 1 }));
  await assertFails(updateDoc(doc(db, FEEDBACK(A_C1)), { testerId: BOB }));
  await assertFails(setDoc(doc(db, FEEDBACK(A_C1)), feedbackDoc({ testerId: BOB })));
  await assertFails(deleteDoc(doc(db, FEEDBACK(A_C1))));
});

test("the developer cannot edit or delete feedback on their app", async () => {
  const db = asUser(DEV);
  await assertFails(updateDoc(doc(db, FEEDBACK(B_C1)), { rating: 5 }));
  await assertFails(deleteDoc(doc(db, FEEDBACK(B_C1))));
});

test("nobody can delete feedback - not the author, not an admin", async () => {
  await assertFails(deleteDoc(doc(asUser(ALICE), FEEDBACK(A_C1))));
  await assertFails(deleteDoc(doc(asUser("admin1"), FEEDBACK(A_C1))));
  await assertFails(updateDoc(doc(asUser("admin1"), FEEDBACK(A_C1)), { rating: 5 }));
});

test("the stored feedback is unchanged after every refused write", async () => {
  const db = asUser(BOB);
  await assertFails(updateDoc(doc(db, FEEDBACK(A_C1)), { rating: 1 }));
  await assertFails(deleteDoc(doc(db, FEEDBACK(A_C1))));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), FEEDBACK(A_C1)));
    if (!snap.exists() || snap.get("rating") !== 4 || snap.get("comment") !== "Solid.") {
      throw new Error("feedback was modified");
    }
  });
});

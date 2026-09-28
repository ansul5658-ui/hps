/**
 * Firestore security rule tests for developer testing setup and the join
 * gate's inputs (Batch 9D).
 *
 * Run with:  firebase emulators:exec --only firestore "npm --prefix tests/rules test"
 *
 * Its own projectId, like every file here: they run in parallel processes.
 *
 * NO RULE CHANGED IN 9D - these pin that none needed to. The join gate reads
 * three things a client must not be able to forge:
 *   * `apps/{id}.setupConfirmation` - the developer's self-confirmation, which
 *     only the confirmAppTestingSetup callable writes after checking the links;
 *   * `apps/{id}.status` and `testerCount` - approval and capacity;
 *   * `users/{uid}/memberships/{groupId}` - written only by joinGroup.
 * The owner keeps editing their own links, as before; an edit simply makes the
 * confirmation outdated server-side.
 */

const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp } = require("firebase/firestore");

const RULES_PATH = path.resolve(__dirname, "../../firestore.rules");

let testEnv;

const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();

const DEV = "dev1";
const OTHER = "dev2";
const APP = "app1";
const PKG = "com.example.app1";
const OPT_IN = `https://play.google.com/apps/testing/${PKG}`;
const CONFIRMATION = {
  kind: "selfConfirmed",
  confirmedBy: DEV,
  confirmedAt: new Date(0),
  fingerprint: "f".repeat(64),
  groupId: "app_testing_official",
  closedTestConfigured: true,
  googleGroupAdded: true,
};

async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users/admin1"), { uid: "admin1", role: "admin" });
    // Signed-in developers who accepted the Terms (F2), which app creation needs.
    await setDoc(doc(db, `users/${DEV}`), { uid: DEV, termsAcceptedVersion: 1, termsAcceptedAt: new Date(0) });
    await setDoc(doc(db, `users/${OTHER}`), { uid: OTHER, termsAcceptedVersion: 1, termsAcceptedAt: new Date(0) });
    await setDoc(doc(db, `apps/${APP}`), {
      ownerId: DEV,
      appName: "App One",
      packageName: PKG,
      closedTestingUrl: OPT_IN,
      status: "approved",
      testerCount: 3,
      setupConfirmation: CONFIRMATION,
    });
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apptesting-setup-rules",
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
// The confirmation cannot be forged
// ---------------------------------------------------------------------------

test("a new app cannot be created already self-confirmed", async () => {
  await assertFails(setDoc(doc(asUser(DEV), "apps/fresh"), {
    ownerId: DEV,
    appName: "Fresh",
    packageName: "com.example.fresh",
    closedTestingUrl: "https://play.google.com/apps/testing/com.example.fresh",
    status: "pendingReview",
    setupConfirmation: { ...CONFIRMATION },
  }));
  // Without it, the ordinary create still works.
  await assertSucceeds(setDoc(doc(asUser(DEV), "apps/fresh"), {
    ownerId: DEV,
    appName: "Fresh",
    packageName: "com.example.fresh",
    closedTestingUrl: "https://play.google.com/apps/testing/com.example.fresh",
    status: "pendingReview",
  }));
});

test("the owner cannot write, rewrite or remove the confirmation", async () => {
  const db = asUser(DEV);
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { setupConfirmation: { ...CONFIRMATION, fingerprint: "0".repeat(64) } }));
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { "setupConfirmation.kind": "verified" }));
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { setupConfirmation: null }));
});

test("the owner can still edit their own links - which outdates the confirmation server-side", async () => {
  await assertSucceeds(updateDoc(doc(asUser(DEV), `apps/${APP}`), {
    closedTestingUrl: `${OPT_IN}/`,
    updatedAt: serverTimestamp(),
  }));
});

test("the owner cannot approve their app, move capacity or change ownership", async () => {
  const db = asUser(DEV);
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { status: "pendingReview" }));
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { testerCount: 0 }));
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { testerCount: 99 }));
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { ownerId: OTHER }));
});

test("another user cannot touch someone else's app setup at all", async () => {
  const db = asUser(OTHER);
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { closedTestingUrl: "https://play.google.com/apps/testing/com.evil" }));
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { setupConfirmation: CONFIRMATION }));
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { testerCount: 0 }));
  await assertFails(deleteDoc(doc(db, `apps/${APP}`)));
});

test("an admin cannot write the confirmation from a client either", async () => {
  await assertFails(updateDoc(doc(asUser("admin1"), `apps/${APP}`), { setupConfirmation: CONFIRMATION }));
  await assertFails(updateDoc(doc(asUser("admin1"), `apps/${APP}`), { testerCount: 0 }));
});

// ---------------------------------------------------------------------------
// The group membership the gate reads cannot be forged
// ---------------------------------------------------------------------------

test("a tester cannot write their own group membership - only joinGroup can", async () => {
  await assertFails(setDoc(doc(asUser(OTHER), `users/${OTHER}/memberships/app_testing_official`), {
    groupId: "app_testing_official",
  }));
  await assertFails(setDoc(doc(asUser(OTHER), `users/${DEV}/memberships/app_testing_official`), {
    groupId: "app_testing_official",
  }));
});

test("a tester cannot read someone else's membership", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `users/${DEV}/memberships/app_testing_official`), { groupId: "app_testing_official" });
  });
  await assertFails(getDoc(doc(asUser(OTHER), `users/${DEV}/memberships/app_testing_official`)));
  await assertSucceeds(getDoc(doc(asUser(DEV), `users/${DEV}/memberships/app_testing_official`)));
});

test("the stored confirmation and capacity survive every refused write", async () => {
  const db = asUser(OTHER);
  await assertFails(updateDoc(doc(db, `apps/${APP}`), { setupConfirmation: null, testerCount: 0 }));
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), `apps/${APP}`));
    if (snap.get("testerCount") !== 3 || snap.get("setupConfirmation.fingerprint") !== CONFIRMATION.fingerprint) {
      throw new Error("app was modified");
    }
  });
});

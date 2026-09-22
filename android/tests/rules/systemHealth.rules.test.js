/**
 * Firestore security rule tests for `systemHealth/{yyyy-MM-dd}`.
 *
 * Run with:  firebase emulators:exec --only firestore "npm --prefix tests/rules test"
 *
 * Its own projectId, like every other file here: these run in parallel
 * processes, so a shared project would mean one file's clearFirestore()
 * wiping another's fixtures.
 *
 * THE THREAT MODEL
 * A day declared degraded extends the testing window of every commitment it
 * applies to. That makes this collection a direct lever on whether 50 staked
 * coins are forfeited, and it is precisely what a tester who is about to fail
 * a commitment would forge:
 *
 *   * declare yesterday degraded and buy another day, repeatedly
 *   * widen someone's app-scoped outage to `scope: "global"`
 *   * re-point an outage at their own app
 *   * delete a day an admin declared, re-exposing other testers
 *   * flip `degraded` on an existing record
 *
 * No field validation would make a client write safe here, because the danger
 * is not the shape of the document - it is who gets to say a day was bad. So
 * every client write is refused outright, including for an admin: admin
 * authority lives in `adminDeclareOutage`, a callable running with Admin SDK
 * credentials that bypasses these rules entirely. "Admin is denied here" is
 * the expected, correct result, and it means a compromised admin browser
 * session still cannot write an outage day.
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
} = require("firebase/firestore");

const RULES_PATH = path.resolve(__dirname, "../../firestore.rules");

let testEnv;

const asUser = (uid) => testEnv.authenticatedContext(uid).firestore();
const asAnon = () => testEnv.unauthenticatedContext().firestore();

const ALICE = "alice";
const ADMIN = "admin1";
const APP = "app1";

const DAY = "2026-03-10";
const OTHER_DAY = "2026-03-11";
const HEALTH = (dayKey) => `systemHealth/${dayKey}`;

/** A declaration exactly as `adminDeclareOutage` writes it. */
function outageDoc(overrides = {}) {
  return {
    dayKey: DAY,
    degraded: true,
    reason: "Firestore degraded in asia-south2",
    scope: "global",
    appId: null,
    declaredBy: ADMIN,
    declaredByKind: "admin",
    ...overrides,
  };
}

/** Seed with rules disabled — this stands in for the server-side write. */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${ADMIN}`), { uid: ADMIN, role: "admin" });
    await setDoc(doc(db, `users/${ALICE}`), { uid: ALICE, role: "member", isSuspended: false });
    await setDoc(doc(db, "users/banned"), { uid: "banned", role: "member", isSuspended: true });
    // No role, no isSuspended — what an ordinary sign-in actually produces.
    await setDoc(doc(db, "users/nofields"), { uid: "nofields", email: "nf@x.com" });

    await setDoc(doc(db, HEALTH(DAY)), outageDoc());
    await setDoc(
      doc(db, HEALTH(OTHER_DAY)),
      outageDoc({ dayKey: OTHER_DAY, scope: "app", appId: APP }),
    );
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apptesting-systemhealth-rules",
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
// Reads — deliberately open to signed-in users
// ---------------------------------------------------------------------------

test("a signed-in tester can read a declared outage day", async () => {
  // Not a secret. A tester who lost a day to an outage is entitled to see it
  // was acknowledged, and a support conversation goes better when both sides
  // are looking at the same record.
  await assertSucceeds(getDoc(doc(asUser(ALICE), HEALTH(DAY))));
});

test("a signed-in tester can list outage days", async () => {
  await assertSucceeds(getDocs(collection(asUser(ALICE), "systemHealth")));
});

test("an admin can read outage days", async () => {
  await assertSucceeds(getDoc(doc(asUser(ADMIN), HEALTH(DAY))));
});

test("a user document with no role or isSuspended can still read", async () => {
  // The shape an ordinary first sign-in produces. It must not be locked out
  // by a rule that reads a field that is not there.
  await assertSucceeds(getDoc(doc(asUser("nofields"), HEALTH(DAY))));
});

test("an anonymous visitor cannot read outage days", async () => {
  await assertFails(getDoc(doc(asAnon(), HEALTH(DAY))));
  await assertFails(getDocs(collection(asAnon(), "systemHealth")));
});

// ---------------------------------------------------------------------------
// Writes — refused for everybody
// ---------------------------------------------------------------------------

test("a tester cannot declare a new outage day", async () => {
  // The headline attack: buy yourself another day and escape a commitment
  // you were about to fail.
  await assertFails(
    setDoc(doc(asUser(ALICE), HEALTH("2026-03-12")), outageDoc({ dayKey: "2026-03-12" })),
  );
});

test("a tester cannot declare a whole run of outage days", async () => {
  for (const day of ["2026-03-13", "2026-03-14", "2026-03-15"]) {
    await assertFails(setDoc(doc(asUser(ALICE), HEALTH(day)), outageDoc({ dayKey: day })));
  }
});

test("a tester cannot flip degraded on an existing day", async () => {
  await assertFails(updateDoc(doc(asUser(ALICE), HEALTH(DAY)), { degraded: false }));
  await assertFails(updateDoc(doc(asUser(ALICE), HEALTH(OTHER_DAY)), { degraded: true }));
});

test("a tester cannot widen an app-scoped outage to global", async () => {
  // Turning one app's bad day into everyone's.
  await assertFails(
    updateDoc(doc(asUser(ALICE), HEALTH(OTHER_DAY)), { scope: "global", appId: null }),
  );
});

test("a tester cannot re-point an outage at their own app", async () => {
  await assertFails(updateDoc(doc(asUser(ALICE), HEALTH(OTHER_DAY)), { appId: "their-own-app" }));
});

test("a tester cannot overwrite a declared day wholesale", async () => {
  await assertFails(setDoc(doc(asUser(ALICE), HEALTH(DAY)), outageDoc({ reason: "mine now" })));
});

test("a tester cannot forge the declaredBy attribution", async () => {
  await assertFails(
    setDoc(doc(asUser(ALICE), HEALTH("2026-03-16")), outageDoc({
      dayKey: "2026-03-16",
      declaredBy: ADMIN,
      declaredByKind: "admin",
    })),
  );
});

test("a tester cannot delete a declared day", async () => {
  // Deleting would silently re-expose every commitment that day protected,
  // with nothing left to explain why.
  await assertFails(deleteDoc(doc(asUser(ALICE), HEALTH(DAY))));
});

test("an ADMIN is also denied every client write", async () => {
  // Admin authority is a Cloud Function with Admin SDK credentials, not a
  // browser session. A compromised admin tab must not be able to mint days.
  await assertFails(setDoc(doc(asUser(ADMIN), HEALTH("2026-03-17")), outageDoc()));
  await assertFails(updateDoc(doc(asUser(ADMIN), HEALTH(DAY)), { degraded: false }));
  await assertFails(deleteDoc(doc(asUser(ADMIN), HEALTH(DAY))));
});

test("a suspended user cannot write either", async () => {
  await assertFails(setDoc(doc(asUser("banned"), HEALTH("2026-03-18")), outageDoc()));
  await assertFails(deleteDoc(doc(asUser("banned"), HEALTH(DAY))));
});

test("an anonymous visitor cannot write", async () => {
  await assertFails(setDoc(doc(asAnon(), HEALTH("2026-03-19")), outageDoc()));
  await assertFails(deleteDoc(doc(asAnon(), HEALTH(DAY))));
});

test("the declared record survives every attempt above unchanged", async () => {
  await assertFails(updateDoc(doc(asUser(ALICE), HEALTH(DAY)), { degraded: false }));

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const snap = await getDoc(doc(ctx.firestore(), HEALTH(DAY)));
    const data = snap.data();
    // Proving the refusals above were refusals, not silent partial writes.
    if (data.degraded !== true) throw new Error("degraded was modified");
    if (data.scope !== "global") throw new Error("scope was modified");
    if (data.declaredBy !== ADMIN) throw new Error("declaredBy was modified");
  });
});

// ---------------------------------------------------------------------------
// The collection did not open anything else
// ---------------------------------------------------------------------------

test("adding systemHealth did not open a nested path under it", async () => {
  await assertFails(
    setDoc(doc(asUser(ALICE), `systemHealth/${DAY}/notes/n1`), { text: "hi" }),
  );
});

test("adding systemHealth did not open an arbitrary sibling collection", async () => {
  // The catch-all still denies everything not matched explicitly.
  await assertFails(setDoc(doc(asUser(ALICE), "systemHealthLog/x"), { a: 1 }));
  await assertFails(getDoc(doc(asUser(ALICE), "systemHealthLog/x")));
});

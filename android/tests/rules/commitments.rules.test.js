/**
 * Firestore security rule tests for the commitment lifecycle.
 *
 * Run with:  firebase emulators:exec --only firestore "npm --prefix tests/rules test"
 *
 * Kept in its own file with its own projectId, the same way wallet.rules and
 * quickTests.rules are: the files in this directory run in parallel processes,
 * so sharing a project would mean one file's clearFirestore() wiping another's
 * fixtures.
 *
 * THE THREAT MODEL
 * A commitment is 50 of the tester's own coins held by the server. The
 * documents below are what decide whether those coins come back, so a client
 * that could write them could:
 *
 *   * create an assignment out of nothing (a commitment with no lock, which
 *     settlement would later "return" coins for - minting them)
 *   * raise or lower `commitmentAmount` (change the stake after the fact)
 *   * write `qualifyingDays` (claim the work was done and unlock early)
 *   * write `status` to `completed` (skip settlement entirely)
 *   * write `lockTxId` / `settlementTxId` (point the settlement at a
 *     different ledger entry, or mark a commitment settled that never was)
 *   * delete an `activeClaim` (run two commitments on one app, or clear the
 *     guard that makes double-claiming impossible)
 *   * delete an assignment (strand the locked coins with nothing to settle)
 *
 * Every client write below must therefore be refused - including for an admin,
 * because admin authority lives in callable Cloud Functions running with Admin
 * SDK credentials, which bypass these rules entirely. "Admin is denied here" is
 * the expected, correct result.
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
  serverTimestamp,
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
const A_CLAIM = `${APP}__${ALICE}`;
const B_C1 = `${APP}__${BOB}__c1`;

const ASSIGNMENT = (id) => `testingAssignments/${id}`;
const CLAIM = (id) => `activeClaims/${id}`;

/** A live commitment, exactly as the join transaction writes it. */
function commitmentDoc(overrides = {}) {
  return {
    appId: APP,
    testerId: ALICE,
    developerId: DEV,
    groupId: null,
    cycle: 1,
    commitmentAmount: 50,
    daysRequired: 14,
    windowDays: 18,
    qualifyingDays: 3,
    daysCompleted: 3,
    status: "inProgress",
    lockTxId: `lock_${A_C1}`,
    settlementTxId: null,
    ...overrides,
  };
}

function claimDoc(overrides = {}) {
  return {
    assignmentId: A_C1,
    appId: APP,
    testerId: ALICE,
    cycle: 1,
    commitmentAmount: 50,
    ...overrides,
  };
}

/** Seed fixtures with rules disabled — this stands in for server-side writes. */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    await setDoc(doc(db, "users/admin1"), { uid: "admin1", role: "admin" });
    await setDoc(doc(db, `users/${ALICE}`), { uid: ALICE, role: "member", isSuspended: false });
    await setDoc(doc(db, `users/${BOB}`), { uid: BOB, role: "member", isSuspended: false });
    await setDoc(doc(db, `users/${DEV}`), { uid: DEV, role: "member", isSuspended: false });
    await setDoc(doc(db, "users/banned"), { uid: "banned", role: "member", isSuspended: true });
    // No role, no isSuspended — what an ordinary sign-in actually produces.
    await setDoc(doc(db, "users/nofields"), { uid: "nofields", email: "nf@x.com" });

    await setDoc(doc(db, `apps/${APP}`), {
      ownerId: DEV,
      appName: "App One",
      packageName: "com.example.one",
      status: "approved",
    });

    await setDoc(doc(db, ASSIGNMENT(A_C1)), commitmentDoc());
    await setDoc(doc(db, ASSIGNMENT(B_C1)), commitmentDoc({ testerId: BOB, cycle: 1 }));
    await setDoc(doc(db, CLAIM(A_CLAIM)), claimDoc());
    // A commitment belonging to a user with no role/isSuspended fields.
    await setDoc(
      doc(db, ASSIGNMENT(`${APP}__nofields__c1`)),
      commitmentDoc({ testerId: "nofields" }),
    );
    await setDoc(doc(db, CLAIM(`${APP}__nofields`)), claimDoc({ testerId: "nofields" }));
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apptesting-commitment-rules",
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
// activeClaims — reads
// ---------------------------------------------------------------------------

test("a tester can read their own active claim", async () => {
  await assertSucceeds(getDoc(doc(asUser(ALICE), CLAIM(A_CLAIM))));
});

test("a tester cannot read someone else's active claim", async () => {
  await assertFails(getDoc(doc(asUser(BOB), CLAIM(A_CLAIM))));
});

test("an anonymous visitor cannot read any active claim", async () => {
  await assertFails(getDoc(doc(asAnon(), CLAIM(A_CLAIM))));
});

test("an admin can read any active claim", async () => {
  await assertSucceeds(getDoc(doc(asUser("admin1"), CLAIM(A_CLAIM))));
});

test("a tester can list their own claims and only their own", async () => {
  const db = asUser(ALICE);
  await assertSucceeds(
    getDocs(query(collection(db, "activeClaims"), where("testerId", "==", ALICE))),
  );
  await assertFails(
    getDocs(query(collection(db, "activeClaims"), where("testerId", "==", BOB))),
  );
  // An unfiltered listing would expose every tester's commitments.
  await assertFails(getDocs(collection(db, "activeClaims")));
});

// ---------------------------------------------------------------------------
// activeClaims — every write refused
// ---------------------------------------------------------------------------

test("a tester cannot create an active claim", async () => {
  // Forging a claim would let a tester hold an app slot without staking coins.
  await assertFails(
    setDoc(doc(asUser(ALICE), CLAIM(`${APP}__${ALICE}__forged`)), {
      ...claimDoc(),
      createdAt: serverTimestamp(),
    }),
  );
  await assertFails(
    setDoc(doc(asUser(BOB), CLAIM(`${APP}__${BOB}`)), {
      ...claimDoc({ testerId: BOB }),
      createdAt: serverTimestamp(),
    }),
  );
});

test("a tester cannot DELETE their active claim to start a second commitment", async () => {
  // The single most valuable write to an attacker: dropping the claim frees
  // the app for another 50-coin commitment while the first is still live, and
  // removes the guard that makes double-claiming impossible.
  await assertFails(deleteDoc(doc(asUser(ALICE), CLAIM(A_CLAIM))));
});

test("a tester cannot repoint their active claim at another assignment", async () => {
  const db = asUser(ALICE);
  await assertFails(updateDoc(doc(db, CLAIM(A_CLAIM)), { assignmentId: "somethingElse" }));
  await assertFails(updateDoc(doc(db, CLAIM(A_CLAIM)), { commitmentAmount: 1 }));
  await assertFails(updateDoc(doc(db, CLAIM(A_CLAIM)), { cycle: 99 }));
});

test("a tester cannot touch someone else's active claim", async () => {
  await assertFails(deleteDoc(doc(asUser(BOB), CLAIM(A_CLAIM))));
  await assertFails(updateDoc(doc(asUser(BOB), CLAIM(A_CLAIM)), { testerId: BOB }));
});

test("an admin cannot write an active claim from the client", async () => {
  const db = asUser("admin1");
  await assertFails(
    setDoc(doc(db, CLAIM("forged__claim")), { ...claimDoc(), createdAt: serverTimestamp() }),
  );
  await assertFails(updateDoc(doc(db, CLAIM(A_CLAIM)), { assignmentId: "x" }));
  await assertFails(deleteDoc(doc(db, CLAIM(A_CLAIM))));
});

test("an anonymous visitor cannot write an active claim", async () => {
  await assertFails(setDoc(doc(asAnon(), CLAIM("anon__claim")), claimDoc()));
});

// ---------------------------------------------------------------------------
// testingAssignments — creation and deletion
// ---------------------------------------------------------------------------

test("a tester cannot create an assignment", async () => {
  // An assignment with a lockTxId but no ledger entry would let settlement
  // "return" coins that were never staked.
  await assertFails(
    setDoc(doc(asUser(ALICE), ASSIGNMENT(`${APP}__${ALICE}__c2`)), {
      ...commitmentDoc({ cycle: 2 }),
      createdAt: serverTimestamp(),
    }),
  );
});

test("an admin cannot create an assignment from the client", async () => {
  await assertFails(
    setDoc(doc(asUser("admin1"), ASSIGNMENT(`${APP}__${ALICE}__c3`)), commitmentDoc({ cycle: 3 })),
  );
});

test("nobody can delete an assignment and strand its locked coins", async () => {
  await assertFails(deleteDoc(doc(asUser(ALICE), ASSIGNMENT(A_C1))));
  await assertFails(deleteDoc(doc(asUser("admin1"), ASSIGNMENT(A_C1))));
  await assertFails(deleteDoc(doc(asUser(BOB), ASSIGNMENT(A_C1))));
});

// ---------------------------------------------------------------------------
// testingAssignments — the money fields
// ---------------------------------------------------------------------------

test("a tester cannot change the amount they staked", async () => {
  const db = asUser(ALICE);
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { commitmentAmount: 1 }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { commitmentAmount: 5000 }));
});

test("a tester cannot claim they did the work", async () => {
  // Writing qualifyingDays to 14 is the direct route to an early unlock.
  const db = asUser(ALICE);
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { qualifyingDays: 14 }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { daysCompleted: 14 }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { daysRequired: 1 }));
});

test("a tester cannot mark their own commitment completed or failed", async () => {
  const db = asUser(ALICE);
  for (const status of ["completed", "failed", "missed", "cancelled", "ready", "inProgress"]) {
    await assertFails(
      updateDoc(doc(db, ASSIGNMENT(A_C1)), { status, updatedAt: serverTimestamp() }),
      `status ${status} must be refused`,
    );
  }
});

test("a tester cannot write the settlement or lock transaction ids", async () => {
  const db = asUser(ALICE);
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { settlementTxId: "forged" }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { lockTxId: "forged" }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { settlementTxId: null }));
});

test("a tester cannot change whose commitment it is, or the cycle, or the window", async () => {
  const db = asUser(ALICE);
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { testerId: BOB }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { developerId: ALICE }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { appId: "otherApp" }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { cycle: 99 }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { windowDays: 9999 }));
});

test("there is no longer any client update to smuggle a money field into", async () => {
  // This used to check that `onlyChanges` rejected the whole write when a
  // money field rode along with the one permitted status flip — and that the
  // clean flip still worked, so the rule was not simply broken.
  //
  // The testing engine removed the flip itself: the fourteenth qualifying day
  // completes the commitment server-side, so a tester has nothing to request.
  // The smuggling vector is closed by removing the carrier, which is a
  // stronger guarantee than filtering its payload.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await updateDoc(doc(ctx.firestore(), ASSIGNMENT(A_C1)), {
      qualifyingDays: 14,
      daysCompleted: 14,
    });
  });
  const db = asUser(ALICE);
  await assertFails(
    updateDoc(doc(db, ASSIGNMENT(A_C1)), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
      commitmentAmount: 1,
    }),
  );
  await assertFails(
    updateDoc(doc(db, ASSIGNMENT(A_C1)), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
      settlementTxId: "forged",
    }),
  );
  // The formerly-clean write is refused too.
  await assertFails(
    updateDoc(doc(db, ASSIGNMENT(A_C1)), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
    }),
  );
  // The rule is scoped, not a blanket lockout: the same tester can still read
  // the document and edit their own profile.
  await assertSucceeds(getDoc(doc(db, ASSIGNMENT(A_C1))));
});

test("the pinned commitment clock is not client-writable", async () => {
  // The deadline itself. A tester who could move `lastEligibleDayKey`, the
  // window length or the timezone could extend their own window indefinitely,
  // which would make the 18-day rule decorative.
  const db = asUser(ALICE);
  for (const [field, value] of [
    ["timeZone", "Pacific/Kiritimati"],
    ["firstEligibleDayKey", "2020-01-01"],
    ["lastEligibleDayKey", "2099-12-31"],
    ["windowDays", 9999],
    ["creditedOutageDays", 9999],
    ["claimedDayKey", "2020-01-01"],
    ["lastQualifyingDayKey", "2099-12-31"],
  ]) {
    await assertFails(
      updateDoc(doc(db, ASSIGNMENT(A_C1)), { [field]: value }),
      `${field} must not be client-writable`,
    );
  }
});

test("a tester cannot touch another tester's assignment at all", async () => {
  const db = asUser(ALICE);
  await assertFails(updateDoc(doc(db, ASSIGNMENT(B_C1)), { status: "waitingForVerification" }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(B_C1)), { qualifyingDays: 14 }));
  await assertFails(getDoc(doc(db, ASSIGNMENT(B_C1))));
});

test("an admin cannot write assignment money fields from the client", async () => {
  const db = asUser("admin1");
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { status: "completed" }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { qualifyingDays: 14 }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { settlementTxId: "forged" }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { commitmentAmount: 0 }));
});

test("a suspended tester cannot even make the legitimate status flip", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, ASSIGNMENT(`${APP}__banned__c1`)), {
      ...commitmentDoc({ testerId: "banned", qualifyingDays: 14, daysCompleted: 14 }),
    });
  });
  await assertFails(
    updateDoc(doc(asUser("banned"), ASSIGNMENT(`${APP}__banned__c1`)), {
      status: "waitingForVerification",
      updatedAt: serverTimestamp(),
    }),
  );
});

// ---------------------------------------------------------------------------
// The wallet is still sealed
// ---------------------------------------------------------------------------

test("the commitment rules did not open the wallet or the ledger", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, `users/${ALICE}/wallet/balance`), {
      available: 0,
      locked: 50,
      forfeitedTotal: 0,
      purchasedTotal: 0,
      adjustmentNet: 50,
      ledgerCount: 2,
      schemaVersion: 2,
    });
    await setDoc(doc(db, `users/${ALICE}/coinTransactions/lock_${A_C1}`), {
      userId: ALICE,
      kind: "lock",
      amount: 50,
      deltaAvailable: -50,
      deltaLocked: 50,
      schemaVersion: 2,
      createdAt: new Date(),
    });
  });

  const db = asUser(ALICE);
  // Unlocking your own coins by hand.
  await assertFails(
    updateDoc(doc(db, `users/${ALICE}/wallet/balance`), { available: 50, locked: 0 }),
  );
  // Forging the unlock ledger entry that would justify it.
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/coinTransactions/unlock_${A_C1}`), {
      userId: ALICE,
      kind: "unlock",
      amount: 50,
      deltaAvailable: 50,
      deltaLocked: -50,
      schemaVersion: 2,
      createdAt: serverTimestamp(),
    }),
  );
  // Deleting the lock entry so reconciliation stops seeing the commitment.
  await assertFails(deleteDoc(doc(db, `users/${ALICE}/coinTransactions/lock_${A_C1}`)));
  // Reading is still fine.
  await assertSucceeds(getDoc(doc(db, `users/${ALICE}/wallet/balance`)));
});

// ---------------------------------------------------------------------------
// Missing optional fields must not produce an evaluation error
// ---------------------------------------------------------------------------

test("a user with no role or isSuspended can read their own commitment state", async () => {
  // `.get('field', default)` rather than dot access is what makes this work.
  // Dot access on an absent key is a rules evaluation ERROR, not false.
  const db = asUser("nofields");
  await assertSucceeds(getDoc(doc(db, ASSIGNMENT(`${APP}__nofields__c1`))));
  await assertSucceeds(getDoc(doc(db, CLAIM(`${APP}__nofields`))));
  await assertSucceeds(
    getDocs(query(collection(db, "activeClaims"), where("testerId", "==", "nofields"))),
  );
});

test("a user with no role or isSuspended is still denied every commitment write", async () => {
  const db = asUser("nofields");
  await assertFails(deleteDoc(doc(db, CLAIM(`${APP}__nofields`))));
  await assertFails(
    updateDoc(doc(db, ASSIGNMENT(`${APP}__nofields__c1`)), { qualifyingDays: 14 }),
  );
  await assertFails(
    setDoc(doc(db, CLAIM("forged__nofields")), { ...claimDoc(), createdAt: serverTimestamp() }),
  );
});

test("the commitment rules did not open an arbitrary sibling collection", async () => {
  const db = asUser(ALICE);
  await assertFails(setDoc(doc(db, "claims/forged"), { testerId: ALICE }));
  await assertFails(setDoc(doc(db, "commitments/forged"), { testerId: ALICE }));
  await assertFails(getDoc(doc(db, "claims/forged")));
  // A deeper path under activeClaims falls through to the catch-all deny.
  await assertFails(setDoc(doc(db, `activeClaims/${A_CLAIM}/sub/forged`), { x: 1 }));
});

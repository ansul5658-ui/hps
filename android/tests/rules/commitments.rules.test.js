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

test("nobody can write capacityHeld to hold or free a slot from the client", async () => {
  // `capacityHeld` decides whether settlement releases a tester slot. A tester
  // who could clear it would keep their slot forever after cancelling; one who
  // could set it on a completed cycle would get the counter decremented twice.
  for (const db of [asUser(ALICE), asUser(DEV), asUser("admin1"), asUser("banned")]) {
    await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { capacityHeld: false }));
    await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { capacityHeld: true }));
  }
});

test("an app owner cannot write testerCount on their own app", async () => {
  await testEnv.withSecurityRulesDisabled((ctx) =>
    updateDoc(doc(ctx.firestore(), `apps/${APP}`), { testerCount: 3 }),
  );
  const db = asUser(DEV);
  // Control: the owner CAN edit a profile field, so the refusals below are
  // about testerCount and nothing else.
  await assertSucceeds(updateDoc(doc(db, `apps/${APP}`), { appName: "Renamed" }));

  // Zeroing it would let the app exceed its cap; inflating it would lock
  // testers out; either one desynchronizes it from the capacityHeld claims.
  for (const testerCount of [0, 2, 4, 999, -1]) {
    await assertFails(updateDoc(doc(db, `apps/${APP}`), { testerCount }));
  }
  await assertFails(
    setDoc(doc(db, "apps/newApp"), {
      ownerId: DEV,
      appName: "New",
      packageName: "com.example.new",
      status: "pendingReview",
      testerCount: 999,
    }),
  );
  // Control: the same create without testerCount is allowed.
  await assertSucceeds(
    setDoc(doc(db, "apps/newApp"), {
      ownerId: DEV,
      appName: "New",
      packageName: "com.example.new",
      status: "pendingReview",
    }),
  );
  // Nor can a tester or an admin from the client.
  await assertFails(updateDoc(doc(asUser(ALICE), `apps/${APP}`), { testerCount: 0 }));
  await assertFails(updateDoc(doc(asUser("admin1"), `apps/${APP}`), { testerCount: 0 }));
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

// ---------------------------------------------------------------------------
// Cancellation
//
// Cancelling is the one settlement a TESTER may trigger, which makes it the
// one most worth proving the client still cannot perform for itself. The
// callable is the only door; every field the settlement writes must be
// refused here.
// ---------------------------------------------------------------------------

test("a tester cannot cancel their own commitment by writing the document", async () => {
  const db = asUser(ALICE);
  // The whole settlement in one write — status, settlement id and timestamps.
  await assertFails(
    updateDoc(doc(db, ASSIGNMENT(A_C1)), {
      status: "cancelled",
      settlementTxId: `cancel_${A_C1}`,
      cancelledAt: serverTimestamp(),
      cancelledBy: ALICE,
      updatedAt: serverTimestamp(),
    }),
  );
  // And each cancellation-specific field on its own, so a narrower write
  // cannot slip through a rule that only inspected the combination.
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { cancelledAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { cancelledBy: ALICE }));
  await assertFails(updateDoc(doc(db, ASSIGNMENT(A_C1)), { settlementTxId: `cancel_${A_C1}` }));
});

test("a tester cannot mint the cancellation ledger entry that returns the coins", async () => {
  const db = asUser(ALICE);
  // The entry the server writes with tx.create. Forging it would credit 50
  // available coins without any commitment ending.
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/coinTransactions/cancel_${A_C1}`), {
      userId: ALICE,
      kind: "unlock",
      source: "cancellation",
      amount: 50,
      deltaAvailable: 50,
      deltaLocked: -50,
      deltaForfeited: 0,
      assignmentId: A_C1,
      schemaVersion: 2,
      createdAt: serverTimestamp(),
    }),
  );
});

test("a tester cannot apply the cancellation refund to their own wallet", async () => {
  const db = asUser(ALICE);
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/wallet/balance`), {
      available: 50,
      locked: 0,
      forfeitedTotal: 0,
      purchasedTotal: 0,
      adjustmentNet: 50,
      schemaVersion: 2,
    }),
  );
  await assertFails(
    updateDoc(doc(db, `users/${ALICE}/wallet/balance`), { available: 50, locked: 0 }),
  );
});

test("a tester cannot release the active claim that cancellation removes", async () => {
  // Deleting the claim without a settlement would free a second commitment on
  // the same app while the first still holds the coins.
  await assertFails(deleteDoc(doc(asUser(ALICE), CLAIM(A_CLAIM))));
});

test("cancelling someone else's commitment is refused at every field", async () => {
  const db = asUser(BOB);
  await assertFails(
    updateDoc(doc(db, ASSIGNMENT(A_C1)), { status: "cancelled", cancelledBy: BOB }),
  );
  await assertFails(deleteDoc(doc(db, CLAIM(A_CLAIM))));
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/coinTransactions/cancel_${A_C1}`), {
      kind: "unlock",
      source: "cancellation",
      amount: 50,
    }),
  );
});

test("an admin cannot write a cancellation directly either", async () => {
  // isAdmin() in these rules grants READS only. The admin cancellation path is
  // the callable, which re-verifies the role server-side.
  const db = asUser("admin1");
  await assertFails(
    updateDoc(doc(db, ASSIGNMENT(A_C1)), {
      status: "cancelled",
      settlementTxId: `cancel_${A_C1}`,
    }),
  );
  await assertFails(deleteDoc(doc(db, CLAIM(A_CLAIM))));
  await assertFails(
    setDoc(doc(db, `users/${ALICE}/coinTransactions/cancel_${A_C1}`), { amount: 50 }),
  );
});

// ---------------------------------------------------------------------------
// testingLogs — the CYCLE-SCOPED id shape
//
// The legacy log tests in firestore.rules.test.js use reward-era ids
// (`{appId}__{testerId}__{day}`). The commitment engine writes
// `{appId}__{testerId}__c{n}__{dayKey}` - the id `recordTestingDay` derives -
// and each such log is 1/14th of a staked commitment. Pinned here so the shape
// production actually uses is the one proven sealed.
// ---------------------------------------------------------------------------

const LOG_DAY = "2026-09-24";
const A_C1_LOG = `testingLogs/${A_C1}__${LOG_DAY}`;

/** A log exactly as the recordTestingDay transaction writes it. */
function cycleLogDoc(overrides = {}) {
  return {
    assignmentId: A_C1,
    cycle: 1,
    appId: APP,
    testerId: ALICE,
    date: LOG_DAY,
    timeZone: "Asia/Kolkata",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedCycleLog() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), A_C1_LOG), cycleLogDoc({ createdAt: new Date() }));
  });
}

test("a tester cannot create a cycle-scoped testing log, even a perfect one", async () => {
  const db = asUser(ALICE);
  await assertFails(setDoc(doc(db, A_C1_LOG), cycleLogDoc()));
  // Nor pre-log a future cycle, nor a later day of this one.
  await assertFails(
    setDoc(
      doc(db, `testingLogs/${APP}__${ALICE}__c2__${LOG_DAY}`),
      cycleLogDoc({ assignmentId: `${APP}__${ALICE}__c2`, cycle: 2 }),
    ),
  );
  await assertFails(
    setDoc(doc(db, `testingLogs/${A_C1}__2026-09-25`), cycleLogDoc({ date: "2026-09-25" })),
  );
});

test("a tester cannot update or delete their own cycle-scoped testing log", async () => {
  await seedCycleLog();
  const db = asUser(ALICE);

  // Positive control: the log is theirs and readable, so every denial below
  // is the write rule speaking, not a missing document or a read failure.
  await assertSucceeds(getDoc(doc(db, A_C1_LOG)));

  await assertFails(updateDoc(doc(db, A_C1_LOG), { date: "2026-09-25" }));
  await assertFails(updateDoc(doc(db, A_C1_LOG), { cycle: 2, assignmentId: `${APP}__${ALICE}__c2` }));
  await assertFails(setDoc(doc(db, A_C1_LOG), cycleLogDoc(), { merge: true }));
  await assertFails(deleteDoc(doc(db, A_C1_LOG)));
});

test("an admin cannot write a cycle-scoped testing log from the client", async () => {
  await seedCycleLog();
  const db = asUser("admin1");
  await assertSucceeds(getDoc(doc(db, A_C1_LOG)));

  await assertFails(
    setDoc(
      doc(db, `testingLogs/${A_C1}__2026-09-25`),
      cycleLogDoc({ date: "2026-09-25" }),
    ),
  );
  await assertFails(updateDoc(doc(db, A_C1_LOG), { date: "2026-09-25" }));
  await assertFails(deleteDoc(doc(db, A_C1_LOG)));
});

test("nobody else can write a cycle-scoped testing log either", async () => {
  await seedCycleLog();
  for (const db of [asUser(BOB), asUser("banned"), asUser("nofields"), asAnon()]) {
    await assertFails(setDoc(doc(db, `testingLogs/${A_C1}__2026-09-25`), cycleLogDoc()));
    await assertFails(updateDoc(doc(db, A_C1_LOG), { testerId: BOB }));
    await assertFails(deleteDoc(doc(db, A_C1_LOG)));
  }
  // Another tester cannot even read it.
  await assertFails(getDoc(doc(asUser(BOB), A_C1_LOG)));
});

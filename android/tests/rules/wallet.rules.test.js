/**
 * Firestore security rule tests for the Testing Coin wallet.
 *
 * Run with:  firebase emulators:exec --only firestore "npm --prefix tests/rules test"
 *
 * Kept in its own file with its own projectId, the same way quickTests.rules
 * and transaction.test.js are: the files in this directory run in parallel
 * processes, so sharing a project would mean one file's clearFirestore()
 * wiping another's fixtures.
 *
 * THE THREAT MODEL
 * Testing Coins are a commitment device with real money behind them in a later
 * batch. The wallet document and its ledger are the entire accounting system,
 * so a client that could write either one could:
 *   * grant itself coins (write `available` or create an `adjustment` entry)
 *   * escape a commitment (write `locked`, or delete the lock entry)
 *   * erase a forfeit (write `forfeitedTotal`, or delete the forfeit entry)
 *   * reset everything (DELETE the wallet document, which is why `write`
 *     rather than `create, update` is the rule)
 *
 * Every client write below must therefore be refused — including for an admin,
 * because admin authority lives in callable Cloud Functions running with Admin
 * SDK credentials, which bypass these rules entirely. "Admin is denied here"
 * is the expected, correct result.
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
  orderBy,
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

const WALLET = (uid) => `users/${uid}/wallet/balance`;
const LEDGER = (uid, id) => `users/${uid}/coinTransactions/${id}`;

/** A well-formed v2 wallet, as the server would write it. */
function walletDoc(overrides = {}) {
  return {
    available: 50,
    locked: 0,
    forfeitedTotal: 0,
    purchasedTotal: 0,
    adjustmentNet: 50,
    ledgerCount: 1,
    lastEntryId: "grant_seed",
    schemaVersion: 2,
    ...overrides,
  };
}

/** A well-formed v2 ledger entry, as the server would write it. */
function ledgerDoc(overrides = {}) {
  return {
    userId: "alice",
    kind: "adjustment",
    source: "adminGrant",
    deltaAvailable: 50,
    deltaLocked: 0,
    deltaForfeited: 0,
    amount: 50,
    reason: "Play-money grant (pre-payment pilot)",
    assignmentId: null,
    appId: null,
    paymentRef: null,
    actorId: "admin1",
    actorKind: "admin",
    idempotencyKey: "seed",
    schemaVersion: 2,
    ...overrides,
  };
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
    // no `isSuspended` at all. Every ordinary sign-in looks like this until an
    // admin explicitly promotes or suspends the account.
    await setDoc(doc(db, "users/nofields"), { uid: "nofields", email: "nf@x.com" });

    await setDoc(doc(db, WALLET("alice")), walletDoc());
    await setDoc(doc(db, WALLET("bob")), walletDoc({ available: 0, adjustmentNet: 0, ledgerCount: 0 }));
    await setDoc(doc(db, WALLET("nofields")), walletDoc());
    await setDoc(doc(db, WALLET("banned")), walletDoc());

    await setDoc(doc(db, LEDGER("alice", "grant_seed")), {
      ...ledgerDoc(),
      createdAt: new Date(),
    });
    await setDoc(doc(db, LEDGER("nofields", "grant_seed")), {
      ...ledgerDoc({ userId: "nofields" }),
      createdAt: new Date(),
    });
  });
}

test.before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "apptesting-wallet-rules",
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

test("a user can read their own wallet", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), WALLET("alice"))));
});

test("a user cannot read someone else's wallet", async () => {
  await assertFails(getDoc(doc(asUser("bob"), WALLET("alice"))));
  await assertFails(getDoc(doc(asUser("alice"), WALLET("bob"))));
});

test("an anonymous visitor cannot read any wallet", async () => {
  await assertFails(getDoc(doc(asAnon(), WALLET("alice"))));
});

test("an admin can read any wallet, for the console", async () => {
  await assertSucceeds(getDoc(doc(asUser("admin1"), WALLET("alice"))));
  await assertSucceeds(getDoc(doc(asUser("admin1"), WALLET("bob"))));
});

test("a user can read their own ledger, and only their own", async () => {
  await assertSucceeds(getDoc(doc(asUser("alice"), LEDGER("alice", "grant_seed"))));
  await assertSucceeds(
    getDocs(query(collection(asUser("alice"), "users/alice/coinTransactions"), orderBy("createdAt", "desc"))),
  );
  await assertFails(getDocs(collection(asUser("bob"), "users/alice/coinTransactions")));
});

test("a suspended user can still read their own wallet and ledger", async () => {
  // Suspension removes the ability to act, not the ability to see your own
  // money. Hiding the balance from a suspended user would be a support
  // problem, not a security improvement.
  await assertSucceeds(getDoc(doc(asUser("banned"), WALLET("banned"))));
});

// ---------------------------------------------------------------------------
// Wallet writes — every one of them refused
// ---------------------------------------------------------------------------

test("a user cannot create their own wallet", async () => {
  // bob's wallet is deleted first so this is a genuine create.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await deleteDoc(doc(ctx.firestore(), WALLET("bob")));
  });
  await assertFails(setDoc(doc(asUser("bob"), WALLET("bob")), walletDoc()));
});

test("a user cannot grant themselves available coins", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, WALLET("alice")), { available: 999999 }));
  await assertFails(setDoc(doc(db, WALLET("alice")), walletDoc({ available: 999999 })));
});

test("a user cannot unlock their own committed coins", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), WALLET("alice")), walletDoc({ available: 0, locked: 50 }));
  });
  // Moving locked back into available would escape a live commitment.
  await assertFails(
    updateDoc(doc(asUser("alice"), WALLET("alice")), { available: 50, locked: 0 }),
  );
  await assertFails(updateDoc(doc(asUser("alice"), WALLET("alice")), { locked: 0 }));
});

test("a user cannot erase their own forfeited total", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), WALLET("alice")),
      walletDoc({ available: 0, forfeitedTotal: 50 }),
    );
  });
  await assertFails(updateDoc(doc(asUser("alice"), WALLET("alice")), { forfeitedTotal: 0 }));
});

test("a user cannot inflate purchasedTotal or adjustmentNet", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, WALLET("alice")), { purchasedTotal: 100000 }));
  await assertFails(updateDoc(doc(db, WALLET("alice")), { adjustmentNet: 100000 }));
});

test("a user cannot touch the bookkeeping fields either", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, WALLET("alice")), { ledgerCount: 0 }));
  await assertFails(updateDoc(doc(db, WALLET("alice")), { lastEntryId: "forged" }));
  await assertFails(updateDoc(doc(db, WALLET("alice")), { schemaVersion: 1 }));
  await assertFails(updateDoc(doc(db, WALLET("alice")), { updatedAt: serverTimestamp() }));
});

test("a user cannot DELETE their wallet to reset a forfeit", async () => {
  // The reason the rule is `write: if false` and not `create, update: if false`.
  await assertFails(deleteDoc(doc(asUser("alice"), WALLET("alice"))));
});

test("a user cannot write a wallet document under a different name", async () => {
  // The match is on {walletDocId}, so any sibling document is covered too — a
  // second "balance2" document must not become a writable shadow wallet.
  await assertFails(setDoc(doc(asUser("alice"), "users/alice/wallet/balance2"), walletDoc()));
  await assertFails(setDoc(doc(asUser("alice"), "users/alice/wallet/anything"), { available: 1 }));
});

test("a user cannot write into someone else's wallet", async () => {
  await assertFails(updateDoc(doc(asUser("bob"), WALLET("alice")), { available: 0 }));
  await assertFails(deleteDoc(doc(asUser("bob"), WALLET("alice"))));
});

test("an admin cannot write a wallet from the client either", async () => {
  // Admin authority is server-side only. A console that could write balances
  // directly would bypass the ledger, and the ledger is the audit trail.
  const db = asUser("admin1");
  await assertFails(updateDoc(doc(db, WALLET("alice")), { available: 999 }));
  await assertFails(setDoc(doc(db, WALLET("alice")), walletDoc({ available: 999 })));
  await assertFails(deleteDoc(doc(db, WALLET("alice"))));
});

test("an anonymous visitor cannot write a wallet", async () => {
  await assertFails(setDoc(doc(asAnon(), WALLET("alice")), walletDoc()));
});

// ---------------------------------------------------------------------------
// Ledger writes — append-only means append-by-server-only
// ---------------------------------------------------------------------------

test("a client cannot create a ledger entry", async () => {
  const forged = { ...ledgerDoc({ idempotencyKey: "forged" }), createdAt: serverTimestamp() };
  await assertFails(setDoc(doc(asUser("alice"), LEDGER("alice", "grant_forged")), forged));
  // Including one that looks exactly like a real server-written grant.
  await assertFails(setDoc(doc(asUser("alice"), LEDGER("alice", "grant_seed2")), forged));
});

test("a client cannot update an existing ledger entry", async () => {
  await assertFails(
    updateDoc(doc(asUser("alice"), LEDGER("alice", "grant_seed")), { amount: 999999 }),
  );
  await assertFails(
    updateDoc(doc(asUser("alice"), LEDGER("alice", "grant_seed")), { deltaAvailable: 999999 }),
  );
});

test("a client cannot delete a ledger entry", async () => {
  // Deleting a `forfeit` or `lock` entry would be the cheapest possible way to
  // rewrite history in the user's favour.
  await assertFails(deleteDoc(doc(asUser("alice"), LEDGER("alice", "grant_seed"))));
});

test("an admin cannot create, update or delete a ledger entry from the client", async () => {
  const db = asUser("admin1");
  await assertFails(
    setDoc(doc(db, LEDGER("alice", "grant_adminforged")), {
      ...ledgerDoc(),
      createdAt: serverTimestamp(),
    }),
  );
  await assertFails(updateDoc(doc(db, LEDGER("alice", "grant_seed")), { amount: 1 }));
  await assertFails(deleteDoc(doc(db, LEDGER("alice", "grant_seed"))));
});

test("a client cannot write a ledger entry into someone else's ledger", async () => {
  await assertFails(
    setDoc(doc(asUser("bob"), LEDGER("alice", "grant_frombob")), {
      ...ledgerDoc(),
      createdAt: serverTimestamp(),
    }),
  );
});

// ---------------------------------------------------------------------------
// Missing optional fields must not produce an evaluation error
// ---------------------------------------------------------------------------

test("a user with no role or isSuspended can still read their own wallet and ledger", async () => {
  // `.get('field', default)` rather than dot access is what makes this work.
  // Dot access on an absent key is a rules evaluation ERROR, not false, and it
  // previously broke a whole write path in production.
  const db = asUser("nofields");
  await assertSucceeds(getDoc(doc(db, WALLET("nofields"))));
  await assertSucceeds(getDoc(doc(db, LEDGER("nofields", "grant_seed"))));
  await assertSucceeds(
    getDocs(query(collection(db, "users/nofields/coinTransactions"), orderBy("createdAt", "desc"))),
  );
});

test("a user with no role or isSuspended is still denied every wallet write", async () => {
  const db = asUser("nofields");
  await assertFails(updateDoc(doc(db, WALLET("nofields")), { available: 999 }));
  await assertFails(deleteDoc(doc(db, WALLET("nofields"))));
  await assertFails(
    setDoc(doc(db, LEDGER("nofields", "grant_forged")), {
      ...ledgerDoc({ userId: "nofields" }),
      createdAt: serverTimestamp(),
    }),
  );
});

test("a user with no role cannot read another user's wallet", async () => {
  // The denial must come from the ownership check, not from an error, so it
  // must behave identically to a fully-populated user.
  await assertFails(getDoc(doc(asUser("nofields"), WALLET("alice"))));
});

test("a suspended user is denied every wallet and ledger write", async () => {
  const db = asUser("banned");
  await assertFails(updateDoc(doc(db, WALLET("banned")), { available: 999 }));
  await assertFails(deleteDoc(doc(db, WALLET("banned"))));
  await assertFails(
    setDoc(doc(db, LEDGER("banned", "grant_forged")), {
      ...ledgerDoc({ userId: "banned" }),
      createdAt: serverTimestamp(),
    }),
  );
});

// ---------------------------------------------------------------------------
// The wallet did not open a path into anything else
// ---------------------------------------------------------------------------

test("the wallet rules did not make the user document writable", async () => {
  const db = asUser("alice");
  await assertFails(updateDoc(doc(db, "users/alice"), { coinBalance: 999 }));
  await assertFails(updateDoc(doc(db, "users/alice"), { role: "admin" }));
  await assertFails(updateDoc(doc(db, "users/alice"), { trustScore: 100 }));
  // alice is seeded with isSuspended:false, so it must be flipped to actually
  // change something. Writing a field to the value it already holds produces
  // an EMPTY diff, and `onlyChanges` correctly allows a write that changes
  // nothing — asserting on a no-op would test the harness, not the rule.
  await assertFails(updateDoc(doc(db, "users/alice"), { isSuspended: true }));
});

test("the wallet rules did not open an arbitrary subcollection under users", async () => {
  // Only `wallet`, `coinTransactions`, `memberships`, `quickTestDays` and
  // `quickTestApps` have match blocks; anything else falls to the default deny.
  await assertFails(setDoc(doc(asUser("alice"), "users/alice/ledger/forged"), { amount: 1 }));
  await assertFails(setDoc(doc(asUser("alice"), "users/alice/balances/forged"), { amount: 1 }));
  await assertFails(getDoc(doc(asUser("alice"), "users/alice/ledger/forged")));
});

test("the wallet rules did not open a nested path under wallet", async () => {
  // The match is a single id segment, so a deeper path falls through to the
  // catch-all deny rather than to the wallet rule.
  await assertFails(
    setDoc(doc(asUser("alice"), "users/alice/wallet/balance/sub/forged"), { available: 1 }),
  );
});

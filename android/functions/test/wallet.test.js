/**
 * Testing Coin wallet tests.
 *
 * This is the only code path in the project that moves coins, so the fake
 * below models the parts of Firestore the grant actually depends on -
 * document versions, optimistic-concurrency retries, and `create` refusing to
 * overwrite - rather than just recording calls. A test that cannot fail when
 * the transaction is wrong would be worse than no test here.
 *
 * The emulator counterpart (test-emulator/wallet.concurrency.test.js) runs the
 * same production functions against a real Firestore, because a fake can only
 * prove the code matches my model of Firestore, not that the model is right.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { FieldValue } = require("firebase-admin/firestore");

const {
  runAdminGrant,
  adminGrantCoinsImpl,
  runWalletReconciliation,
  grantEntryId,
  walletPath,
  ledgerPath,
} = require("../wallet");
const {
  KIND_DELTAS,
  emptyWallet,
  deltaSumsBalance,
  ledgerDeltasFor,
  checkInvariants,
  applyEntry,
  foldLedger,
  diffWallets,
  checkEntry,
  isValidAmount,
  isV2Entry,
} = require("../lib/wallet");
const {
  MAX_ADMIN_GRANT_AMOUNT,
  WALLET_SCHEMA_VERSION,
  COIN_KINDS,
} = require("../lib/constants");

const TESTER = "tester1";
const ADMIN = "admin1";
const KEY = "grantkey1";
const WALLET_PATH = walletPath(TESTER);
const ENTRY_ID = grantEntryId(KEY);
const LEDGER_PATH = ledgerPath(TESTER, ENTRY_ID);

// ---------------------------------------------------------------------------
// Fake Firestore
// ---------------------------------------------------------------------------

function snapshot(path, rec) {
  const data = rec ? rec.data : undefined;
  return {
    id: path.split("/").pop(),
    ref: { path },
    exists: data !== undefined,
    data: () => data,
    get: (field) => (data === undefined ? undefined : data[field]),
  };
}

/**
 * @param seed  map of document path -> data
 * @param opts.beforeCommit  hook run after the transaction body and before the
 *        conflict check, so a test can simulate a racing writer
 */
function fakeDb(seed = {}, opts = {}) {
  const store = new Map();
  for (const [path, data] of Object.entries(seed)) store.set(path, { data, version: 1 });

  const committed = [];
  const state = { attempts: 0 };

  function write(path, data) {
    const rec = store.get(path);
    store.set(path, { data, version: (rec ? rec.version : 0) + 1 });
  }

  const db = {
    // Non-transactional reads too: guards.js and the reconciler both read
    // outside a transaction.
    doc: (path) => ({
      path,
      get: async () => snapshot(path, store.get(path)),
    }),
    collection: (path) => ({
      path,
      orderBy: () => ({
        limit: () => ({
          get: async () => {
            const prefix = `${path}/`;
            const docs = [...store.entries()]
              .filter(([p]) => p.startsWith(prefix))
              .map(([p, rec]) => ({ id: p.slice(prefix.length), data: () => rec.data }));
            return { docs };
          },
        }),
      }),
    }),
    async runTransaction(fn) {
      // Retry loop mirroring Firestore's optimistic concurrency.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        state.attempts += 1;
        const reads = new Map();
        const pending = [];
        let aborted = null;

        const tx = {
          get: async (ref) => {
            const rec = store.get(ref.path);
            reads.set(ref.path, rec ? rec.version : 0);
            return snapshot(ref.path, rec);
          },
          create: (ref, data) => pending.push({ op: "create", path: ref.path, data }),
          set: (ref, data) => pending.push({ op: "set", path: ref.path, data }),
          update: (ref, data) => pending.push({ op: "update", path: ref.path, data }),
        };

        const result = await fn(tx);

        if (opts.beforeCommit) await opts.beforeCommit(store, attempt, write);

        // Conflict check: did anything we read change underneath us?
        let conflict = false;
        for (const [path, version] of reads) {
          const rec = store.get(path);
          if ((rec ? rec.version : 0) !== version) conflict = true;
        }
        if (conflict) continue;

        for (const w of pending) {
          if (w.op === "create" && store.has(w.path)) {
            aborted = new Error(`ALREADY_EXISTS: ${w.path}`);
            aborted.code = 6;
            break;
          }
        }
        if (aborted) throw aborted;

        for (const w of pending) {
          if (w.op === "update") {
            const rec = store.get(w.path);
            write(w.path, { ...(rec ? rec.data : {}), ...w.data });
          } else {
            write(w.path, w.data);
          }
          committed.push({ op: w.op, path: w.path, data: w.data });
        }
        return result;
      }
      throw new Error("too much contention");
    },
  };

  db.__store = store;
  db.__committed = committed;
  db.__state = state;
  db.__read = (path) => {
    const rec = store.get(path);
    return rec ? rec.data : undefined;
  };
  return db;
}

function world(overrides = {}) {
  return {
    [`users/${ADMIN}`]: { uid: ADMIN, role: "admin" },
    // Mirrors production: an ordinary user document carries no `isSuspended`,
    // no `role` and no wallet at all until something writes one.
    [`users/${TESTER}`]: { uid: TESTER },
    ...overrides,
  };
}

function callable(data, uid = ADMIN) {
  return { auth: { uid }, data };
}

// ---------------------------------------------------------------------------
// The invariant, proven over the delta table itself
// ---------------------------------------------------------------------------

test("every ledger kind moves both sides of the invariant equally", () => {
  assert.equal(deltaSumsBalance(), true);
  // And the table covers exactly the documented kinds - no more, no fewer.
  assert.deepEqual(Object.keys(KIND_DELTAS).sort(), [...COIN_KINDS].sort());
});

test("available + locked + forfeited == purchased + adjustment, for every sequence", () => {
  const mk = (kind, amount, id) =>
    Object.assign({ kind, amount, id, schemaVersion: WALLET_SCHEMA_VERSION }, ledgerDeltasFor(kind, amount));

  // Every ordering of a realistic lifecycle must hold the invariant.
  const sequences = [
    [mk("adjustment", 50, "a")],
    [mk("adjustment", 50, "a"), mk("lock", 50, "b")],
    [mk("adjustment", 50, "a"), mk("lock", 50, "b"), mk("unlock", 50, "c")],
    [mk("adjustment", 50, "a"), mk("lock", 50, "b"), mk("forfeit", 50, "c")],
    [mk("purchase", 100, "a"), mk("lock", 50, "b"), mk("forfeit", 50, "c"), mk("adjustment", 25, "d")],
    [mk("adjustment", 50, "a"), mk("reversal", 50, "b")],
  ];

  for (const seq of sequences) {
    let w = emptyWallet();
    for (const e of seq) {
      w = applyEntry(w, e);
      const check = checkInvariants(w);
      assert.equal(check.ok, true, `${seq.map((s) => s.kind).join("+")}: ${check.errors.join("; ")}`);
    }
  }
});

test("completing a commitment returns the same coins - it is not a reward", () => {
  const mk = (kind, amount, id) =>
    Object.assign({ kind, amount, id, schemaVersion: WALLET_SCHEMA_VERSION }, ledgerDeltasFor(kind, amount));

  let w = emptyWallet();
  for (const e of [mk("adjustment", 50, "a"), mk("lock", 50, "b"), mk("unlock", 50, "c")]) {
    w = applyEntry(w, e);
  }
  // Started with 50 granted, ended with 50. No +50 anywhere.
  assert.equal(w.available, 50);
  assert.equal(w.locked, 0);
  assert.equal(w.forfeitedTotal, 0);
  assert.equal(w.adjustmentNet, 50, "the only coins that ever entered came from the grant");
});

test("a failed commitment forfeits the stake with no partial unlock", () => {
  const mk = (kind, amount, id) =>
    Object.assign({ kind, amount, id, schemaVersion: WALLET_SCHEMA_VERSION }, ledgerDeltasFor(kind, amount));

  let w = emptyWallet();
  for (const e of [mk("adjustment", 50, "a"), mk("lock", 50, "b"), mk("forfeit", 50, "c")]) {
    w = applyEntry(w, e);
  }
  assert.equal(w.available, 0);
  assert.equal(w.locked, 0);
  assert.equal(w.forfeitedTotal, 50);
  assert.equal(checkInvariants(w).ok, true);
});

test("checkInvariants catches a negative balance and a broken sum", () => {
  assert.equal(checkInvariants({ ...emptyWallet(), available: -1, adjustmentNet: -1 }).ok, false);
  assert.equal(
    checkInvariants({ ...emptyWallet(), available: 50, adjustmentNet: 0 }).ok,
    false,
    "50 available out of nowhere must be rejected",
  );
});

// ---------------------------------------------------------------------------
// Deltas are derived, never supplied
// ---------------------------------------------------------------------------

test("deltas come from the kind, so a caller cannot state its own balance change", () => {
  assert.deepEqual(ledgerDeltasFor("lock", 50), {
    deltaAvailable: -50,
    deltaLocked: 50,
    deltaForfeited: 0,
  });
  assert.deepEqual(ledgerDeltasFor("adjustment", 50), {
    deltaAvailable: 50,
    deltaLocked: 0,
    deltaForfeited: 0,
  });
  // Unknown kind or bad amount yields nothing at all rather than a guess.
  assert.equal(ledgerDeltasFor("earn", 50), null, "the reward-era kind must be unknown now");
  assert.equal(ledgerDeltasFor("lock", 0), null);
  assert.equal(ledgerDeltasFor("lock", -50), null);
  assert.equal(ledgerDeltasFor("lock", 1.5), null);
});

test("amounts: only positive whole numbers", () => {
  for (const bad of [0, -1, 1.5, NaN, Infinity, "50", null, undefined]) {
    assert.equal(isValidAmount(bad), false, `${String(bad)} must be rejected`);
  }
  assert.equal(isValidAmount(1), true);
  assert.equal(isValidAmount(50), true);
});

test("checkEntry rejects unknown kinds and sources", () => {
  assert.equal(checkEntry({ kind: "earn", source: "adminGrant", amount: 50 }).ok, false);
  assert.equal(
    checkEntry({ kind: "adjustment", source: "assignmentCompletion", amount: 50 }).ok,
    false,
    "the reward-era source must be unknown now",
  );
  assert.equal(checkEntry({ kind: "adjustment", source: "adminGrant", amount: 50 }).ok, true);
});

// ---------------------------------------------------------------------------
// Folding the ledger
// ---------------------------------------------------------------------------

test("a new user's wallet is zero everywhere", () => {
  const w = emptyWallet();
  assert.deepEqual(w, {
    available: 0,
    locked: 0,
    forfeitedTotal: 0,
    purchasedTotal: 0,
    adjustmentNet: 0,
    ledgerCount: 0,
    lastEntryId: null,
    schemaVersion: WALLET_SCHEMA_VERSION,
  });
  assert.equal(checkInvariants(w).ok, true);
  assert.deepEqual(foldLedger([]).wallet, w);
});

test("the wallet is derived correctly from the ledger", () => {
  const mk = (kind, amount, id) =>
    Object.assign({ kind, amount, id, schemaVersion: WALLET_SCHEMA_VERSION }, ledgerDeltasFor(kind, amount));

  const { wallet } = foldLedger([
    mk("adjustment", 50, "a"),
    mk("adjustment", 25, "b"),
    mk("lock", 50, "c"),
  ]);
  assert.equal(wallet.available, 25);
  assert.equal(wallet.locked, 50);
  assert.equal(wallet.adjustmentNet, 75);
  assert.equal(wallet.ledgerCount, 3);
  assert.equal(wallet.lastEntryId, "c");
});

test("folding is order-independent for the totals", () => {
  const mk = (kind, amount, id) =>
    Object.assign({ kind, amount, id, schemaVersion: WALLET_SCHEMA_VERSION }, ledgerDeltasFor(kind, amount));

  const entries = [mk("adjustment", 50, "a"), mk("lock", 30, "b"), mk("unlock", 30, "c")];
  const forward = foldLedger(entries).wallet;
  const reverse = foldLedger([...entries].reverse()).wallet;
  for (const f of ["available", "locked", "forfeitedTotal", "purchasedTotal", "adjustmentNet"]) {
    assert.equal(forward[f], reverse[f], `${f} must not depend on order`);
  }
});

test("reward-era v1 entries are reported, never folded into the balance", () => {
  const mk = (kind, amount, id) =>
    Object.assign({ kind, amount, id, schemaVersion: WALLET_SCHEMA_VERSION }, ledgerDeltasFor(kind, amount));

  // Exactly the shape rewards.js used to write.
  const legacyEntry = {
    id: "done_app1__tester1",
    userId: TESTER,
    amount: 50,
    kind: "earn",
    source: "assignmentCompletion",
    reason: "Completed testing for app1",
  };

  const { wallet, legacy } = foldLedger([legacyEntry, mk("adjustment", 20, "new")]);
  assert.equal(wallet.available, 20, "only the v2 grant counts toward spendable balance");
  assert.equal(wallet.ledgerCount, 1);
  assert.equal(legacy.count, 1);
  assert.equal(legacy.totalAmount, 50);
  assert.deepEqual(legacy.ids, ["done_app1__tester1"]);
  assert.equal(isV2Entry(legacyEntry), false);
});

test("diffWallets reports drift rather than hiding it", () => {
  const derived = { ...emptyWallet(), available: 50, adjustmentNet: 50, ledgerCount: 1 };
  assert.equal(diffWallets(derived, derived).matches, true);

  const drifted = diffWallets({ ...derived, available: 999 }, derived);
  assert.equal(drifted.matches, false);
  assert.deepEqual(drifted.differences, [{ field: "available", cached: 999, derived: 50 }]);

  // A missing wallet document is a mismatch against a non-zero ledger, not a crash.
  assert.equal(diffWallets(null, derived).matches, false);
});

// ---------------------------------------------------------------------------
// adminGrantCoins - authorization
// ---------------------------------------------------------------------------

test("a non-admin cannot grant coins", async () => {
  const db = fakeDb(world({ [`users/${TESTER}`]: { uid: TESTER } }));
  await assert.rejects(
    adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }, TESTER)),
    /Admin privileges are required/,
  );
  assert.equal(db.__committed.length, 0, "nothing may be written");
});

test("an unauthenticated caller cannot grant coins", async () => {
  const db = fakeDb(world());
  await assert.rejects(
    adminGrantCoinsImpl(db, { data: { userId: TESTER, amount: 50, idempotencyKey: KEY } }),
    /must be signed in/,
  );
  assert.equal(db.__committed.length, 0);
});

test("a suspended admin cannot grant coins", async () => {
  const db = fakeDb(world({ [`users/${ADMIN}`]: { uid: ADMIN, role: "admin", isSuspended: true } }));
  await assert.rejects(
    adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY })),
    /admin account is suspended/,
  );
  assert.equal(db.__committed.length, 0);
});

test("an admin cannot grant coins to themselves", async () => {
  const db = fakeDb(world());
  await assert.rejects(
    adminGrantCoinsImpl(db, callable({ userId: ADMIN, amount: 50, idempotencyKey: KEY })),
    /cannot grant coins to yourself/,
  );
  assert.equal(db.__committed.length, 0);
});

test("a suspended user cannot receive a grant", async () => {
  const db = fakeDb(world({ [`users/${TESTER}`]: { uid: TESTER, isSuspended: true } }));
  await assert.rejects(
    adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY })),
    /suspended and cannot receive coins/,
  );
  assert.equal(db.__committed.length, 0);
});

test("granting to a user who does not exist is refused", async () => {
  const db = fakeDb({ [`users/${ADMIN}`]: { uid: ADMIN, role: "admin" } });
  await assert.rejects(
    adminGrantCoinsImpl(db, callable({ userId: "ghost", amount: 50, idempotencyKey: KEY })),
    /no longer exists/,
  );
  assert.equal(db.__committed.length, 0);
});

// ---------------------------------------------------------------------------
// adminGrantCoins - amount validation
// ---------------------------------------------------------------------------

test("a negative, zero, fractional or non-numeric grant is rejected", async () => {
  for (const amount of [0, -50, -1, 1.5, "50", null, undefined, NaN]) {
    const db = fakeDb(world());
    await assert.rejects(
      adminGrantCoinsImpl(db, callable({ userId: TESTER, amount, idempotencyKey: KEY })),
      /positive whole number/,
      `amount ${String(amount)} must be rejected`,
    );
    assert.equal(db.__committed.length, 0, `amount ${String(amount)} must write nothing`);
  }
});

test("an excessive grant is rejected at the ceiling", async () => {
  const db = fakeDb(world());
  await assert.rejects(
    adminGrantCoinsImpl(
      db,
      callable({ userId: TESTER, amount: MAX_ADMIN_GRANT_AMOUNT + 1, idempotencyKey: KEY }),
    ),
    /cannot exceed/,
  );
  assert.equal(db.__committed.length, 0);

  // The ceiling itself is allowed.
  const ok = fakeDb(world());
  const outcome = await adminGrantCoinsImpl(
    ok,
    callable({ userId: TESTER, amount: MAX_ADMIN_GRANT_AMOUNT, idempotencyKey: KEY }),
  );
  assert.equal(outcome.granted, true);
  assert.equal(outcome.amount, MAX_ADMIN_GRANT_AMOUNT);
});

test("a grant without an idempotency key is refused", async () => {
  const db = fakeDb(world());
  await assert.rejects(
    adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50 })),
    /idempotencyKey/,
  );
  assert.equal(db.__committed.length, 0);
});

// ---------------------------------------------------------------------------
// adminGrantCoins - the happy path and its writes
// ---------------------------------------------------------------------------

test("an admin can grant 50 play-money coins", async () => {
  const db = fakeDb(world());
  const outcome = await adminGrantCoinsImpl(
    db,
    callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }),
  );

  assert.equal(outcome.granted, true);
  assert.equal(outcome.amount, 50);
  assert.equal(outcome.entryId, ENTRY_ID);

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 50);
  assert.equal(wallet.locked, 0);
  assert.equal(wallet.forfeitedTotal, 0);
  assert.equal(wallet.purchasedTotal, 0, "play money is never recorded as a purchase");
  assert.equal(wallet.adjustmentNet, 50);
  assert.equal(wallet.ledgerCount, 1);
  assert.equal(wallet.lastEntryId, ENTRY_ID);
  assert.equal(wallet.schemaVersion, WALLET_SCHEMA_VERSION);
  assert.equal(checkInvariants(wallet).ok, true);
});

test("the ledger entry records provenance, actor and derived deltas", async () => {
  const db = fakeDb(world());
  await adminGrantCoinsImpl(
    db,
    callable({ userId: TESTER, amount: 50, idempotencyKey: KEY, reason: "pilot top-up" }),
  );

  const entry = db.__read(LEDGER_PATH);
  assert.equal(entry.userId, TESTER);
  assert.equal(entry.kind, "adjustment");
  assert.equal(entry.source, "adminGrant", "play money, never a purchase");
  assert.equal(entry.amount, 50);
  assert.equal(entry.deltaAvailable, 50);
  assert.equal(entry.deltaLocked, 0);
  assert.equal(entry.deltaForfeited, 0);
  assert.equal(entry.actorId, ADMIN);
  assert.equal(entry.actorKind, "admin");
  assert.equal(entry.idempotencyKey, KEY);
  assert.equal(entry.reason, "pilot top-up");
  assert.equal(entry.assignmentId, null);
  assert.equal(entry.appId, null);
  assert.equal(entry.paymentRef, null, "play money has no payment behind it");
  assert.equal(entry.schemaVersion, WALLET_SCHEMA_VERSION);
});

test("a grant writes the ledger with create, so it can never overwrite", async () => {
  const db = fakeDb(world());
  await adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }));
  const ledgerWrite = db.__committed.find((w) => w.path === LEDGER_PATH);
  assert.equal(ledgerWrite.op, "create", "an immutable entry must never be written with set");
});

test("a second grant with a fresh key accumulates", async () => {
  const db = fakeDb(world());
  await adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: "k1" }));
  await adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 25, idempotencyKey: "k2" }));

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 75);
  assert.equal(wallet.adjustmentNet, 75);
  assert.equal(wallet.ledgerCount, 2);
  assert.equal(checkInvariants(wallet).ok, true);
});

test("a duplicate grant is idempotent - the same key never pays twice", async () => {
  const db = fakeDb(world());
  const first = await adminGrantCoinsImpl(
    db,
    callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }),
  );
  const second = await adminGrantCoinsImpl(
    db,
    callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }),
  );

  assert.equal(first.granted, true);
  assert.equal(second.granted, false);
  assert.equal(second.reason, "duplicate");

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 50, "balance must not double");
  assert.equal(wallet.ledgerCount, 1);
});

test("a replay cannot smuggle a different amount through the same key", async () => {
  const db = fakeDb(world());
  await adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }));
  const replay = await adminGrantCoinsImpl(
    db,
    callable({ userId: TESTER, amount: 1000, idempotencyKey: KEY }),
  );
  assert.equal(replay.granted, false);
  assert.equal(db.__read(WALLET_PATH).available, 50);
  assert.equal(db.__read(LEDGER_PATH).amount, 50);
});

test("a racing grant on the same key is retried and then refused", async () => {
  // A second writer creates the very entry this transaction is about to, in
  // the window between the read and the commit.
  let injected = false;
  const db = fakeDb(world(), {
    beforeCommit: (store, attempt, write) => {
      if (injected) return;
      injected = true;
      write(LEDGER_PATH, { userId: TESTER, amount: 50, kind: "adjustment" });
    },
  });

  const outcome = await adminGrantCoinsImpl(
    db,
    callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }),
  );
  // The retry re-reads, sees the entry, and reports a duplicate instead of
  // stacking a second grant on top.
  assert.equal(outcome.granted, false);
  assert.equal(outcome.reason, "duplicate");
});

test("the wallet write carries a server timestamp, not a client clock", async () => {
  const db = fakeDb(world());
  await adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }));
  assert.deepStrictEqual(db.__read(WALLET_PATH).updatedAt, FieldValue.serverTimestamp());
  assert.deepStrictEqual(db.__read(LEDGER_PATH).createdAt, FieldValue.serverTimestamp());
});

test("a grant onto an existing wallet preserves locked and forfeited totals", async () => {
  const db = fakeDb(
    world({
      [WALLET_PATH]: {
        available: 0,
        locked: 50,
        forfeitedTotal: 25,
        purchasedTotal: 0,
        adjustmentNet: 75,
        ledgerCount: 3,
        lastEntryId: "earlier",
        schemaVersion: WALLET_SCHEMA_VERSION,
      },
    }),
  );
  await adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 10, idempotencyKey: KEY }));

  const wallet = db.__read(WALLET_PATH);
  assert.equal(wallet.available, 10);
  assert.equal(wallet.locked, 50, "an unrelated grant must not touch a live commitment");
  assert.equal(wallet.forfeitedTotal, 25);
  assert.equal(wallet.adjustmentNet, 85);
  assert.equal(wallet.ledgerCount, 4);
  assert.equal(checkInvariants(wallet).ok, true);
});

test("a grant refuses to write a wallet whose stored state is already corrupt", async () => {
  // available+locked+forfeited (100) does not equal purchased+adjustment (0).
  const db = fakeDb(
    world({
      [WALLET_PATH]: {
        available: 100,
        locked: 0,
        forfeitedTotal: 0,
        purchasedTotal: 0,
        adjustmentNet: 0,
        ledgerCount: 1,
        schemaVersion: WALLET_SCHEMA_VERSION,
      },
    }),
  );
  await assert.rejects(
    adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY })),
    /breaks its invariants/,
  );
  assert.equal(db.__read(WALLET_PATH).available, 100, "the corrupt wallet is left untouched");
  assert.equal(db.__read(LEDGER_PATH), undefined, "and no entry is written");
});

test("runAdminGrant is the whole money path - it touches no other document", async () => {
  const db = fakeDb(world());
  await runAdminGrant(db, {
    targetUserId: TESTER,
    amount: 50,
    reason: "test",
    idempotencyKey: KEY,
    adminUid: ADMIN,
  });
  const paths = [...new Set(db.__committed.map((w) => w.path))].sort();
  assert.deepEqual(paths, [LEDGER_PATH, WALLET_PATH].sort());
  // In particular, the reward-era balance field is never written.
  assert.equal(db.__read(`users/${TESTER}`).coinBalance, undefined);
});

// ---------------------------------------------------------------------------
// Reconciliation - reports, never repairs
// ---------------------------------------------------------------------------

test("reconciliation reports a match when the wallet agrees with the ledger", async () => {
  const db = fakeDb(world());
  await adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }));

  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.matches, true);
  assert.deepEqual(report.differences, []);
  assert.equal(report.derived.available, 50);
  assert.equal(report.repaired, false);
});

test("reconciliation reports a mismatch and repairs nothing", async () => {
  const db = fakeDb(world());
  await adminGrantCoinsImpl(db, callable({ userId: TESTER, amount: 50, idempotencyKey: KEY }));
  // Simulate a balance written outside the ledger.
  db.__store.set(WALLET_PATH, {
    data: { ...db.__read(WALLET_PATH), available: 999 },
    version: 99,
  });

  const before = db.__read(WALLET_PATH);
  const report = await runWalletReconciliation(db, { userId: TESTER });

  assert.equal(report.matches, false);
  assert.deepEqual(report.differences, [{ field: "available", cached: 999, derived: 50 }]);
  assert.equal(report.repaired, false);
  assert.deepEqual(db.__read(WALLET_PATH), before, "reconciliation must not write");
});

test("reconciliation reports reward-era data instead of migrating it", async () => {
  const db = fakeDb(
    world({
      [`users/${TESTER}`]: { uid: TESTER, coinBalance: 150 },
      [ledgerPath(TESTER, "done_app1__tester1")]: {
        userId: TESTER,
        amount: 50,
        kind: "earn",
        source: "assignmentCompletion",
      },
    }),
  );

  const report = await runWalletReconciliation(db, { userId: TESTER });
  assert.equal(report.legacyCoinBalance, 150);
  assert.equal(report.legacyLedgerEntries.count, 1);
  assert.equal(report.legacyLedgerEntries.totalAmount, 50);
  assert.equal(report.derived.available, 0, "legacy rewards are not spendable commitment balance");
  assert.equal(report.repaired, false);
  assert.equal(db.__committed.length, 0, "reconciliation is read-only");
});

test("a non-admin cannot reconcile a wallet", async () => {
  const { adminReconcileWalletImpl } = require("../wallet");
  const db = fakeDb(world());
  await assert.rejects(
    adminReconcileWalletImpl(db, callable({ userId: TESTER }, TESTER)),
    /Admin privileges are required/,
  );
});

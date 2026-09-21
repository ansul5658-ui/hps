/**
 * Testing Coin wallet - the only code in this project that moves coins.
 *
 * PRODUCT MODEL
 * Testing Coins are a COMMITMENT device, not a reward. 50 coins represent a
 * 50-rupee commitment a tester stakes on an assignment. They are not cash,
 * cannot be withdrawn, and cannot be transferred between users. Completing an
 * assignment returns the SAME coins; there is no completion bonus anywhere in
 * this file, and adding one would break the invariant in `lib/wallet.js`.
 *
 * SECURITY MODEL
 *   * The client supplies, at most, a target and an amount. The three balance
 *     deltas are derived server-side from the entry kind (`ledgerDeltasFor`),
 *     so a caller can never state its own balance change.
 *   * Security rules refuse every client write to `users/{uid}/wallet/**` and
 *     `users/{uid}/coinTransactions/**`. Balance movement exists only here,
 *     under Admin SDK credentials, with the caller's role re-read from
 *     Firestore on every call.
 *   * The ledger entry and the wallet update commit in ONE transaction, so a
 *     balance can never disagree with the entry that caused it.
 *   * Idempotency is structural: the ledger id is derived from a caller-
 *     supplied idempotency key and written with `tx.create`, which refuses to
 *     overwrite. A replayed grant is a no-op, not a second grant.
 *   * The computed wallet is invariant-checked BEFORE it is written. A write
 *     that would produce a negative balance or break
 *     available+locked+forfeited == purchased+adjustment aborts the whole
 *     transaction rather than persisting a corrupt wallet.
 *
 * WHAT IS DELIBERATELY ABSENT
 * No purchase path, no payment gateway, no withdrawal, no transfer, no
 * assignment lock/unlock/forfeit callable. Those are later batches. This file
 * establishes the foundation they will build on.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  MAX_ADMIN_GRANT_AMOUNT,
  WALLET_SCHEMA_VERSION,
  WALLET_DOC_ID,
  WALLET_SUBCOLLECTION,
  COIN_KIND_ADJUSTMENT,
  COIN_SOURCE_ADMIN_GRANT,
  ACTOR_KIND_ADMIN,
} = require("./lib/constants");
const {
  emptyWallet,
  applyEntry,
  checkEntry,
  checkInvariants,
  foldLedger,
  diffWallets,
} = require("./lib/wallet");
const { requireAuth, requireAdmin, requireDocId, optionalString } = require("./lib/guards");
const { isValidDocId } = require("./lib/validation");

/** Upper bound on ledger entries one reconciliation will read. */
const RECONCILE_SCAN_LIMIT = 5000;

function walletPath(uid) {
  return `users/${uid}/${WALLET_SUBCOLLECTION}/${WALLET_DOC_ID}`;
}

function ledgerPath(uid, entryId) {
  return `users/${uid}/coinTransactions/${entryId}`;
}

/**
 * Deterministic ledger id for an admin grant.
 *
 * The namespace prefix keeps grant ids from ever colliding with the ids a
 * future lock/unlock/forfeit path will mint from assignment ids.
 */
function grantEntryId(idempotencyKey) {
  return `grant_${idempotencyKey}`;
}

/** Read a wallet document into the plain shape `lib/wallet.js` operates on. */
function walletFromSnapshot(snap) {
  if (!snap || !snap.exists) return emptyWallet();
  const d = snap.data() || {};
  const base = emptyWallet();
  return {
    available: typeof d.available === "number" ? d.available : base.available,
    locked: typeof d.locked === "number" ? d.locked : base.locked,
    forfeitedTotal: typeof d.forfeitedTotal === "number" ? d.forfeitedTotal : base.forfeitedTotal,
    purchasedTotal: typeof d.purchasedTotal === "number" ? d.purchasedTotal : base.purchasedTotal,
    adjustmentNet: typeof d.adjustmentNet === "number" ? d.adjustmentNet : base.adjustmentNet,
    ledgerCount: typeof d.ledgerCount === "number" ? d.ledgerCount : base.ledgerCount,
    lastEntryId: d.lastEntryId === undefined ? null : d.lastEntryId,
    schemaVersion: WALLET_SCHEMA_VERSION,
  };
}

/**
 * Read a user's wallet inside a transaction, for update.
 *
 * Firestore requires every read before any write, so this is deliberately
 * separate from `stageWalletEntry`. Reading the wallet also LOCKS it for the
 * rest of the transaction under the server SDK's pessimistic concurrency,
 * which is what makes two concurrent commitments against one balance
 * serialize instead of both succeeding.
 */
async function readWalletForUpdate(tx, db, userId) {
  const ref = db.doc(walletPath(userId));
  const snap = await tx.get(ref);
  return { ref, wallet: walletFromSnapshot(snap) };
}

/**
 * Stage one ledger entry plus the matching wallet update.
 *
 * THE SINGLE PLACE COINS MOVE. Every value-moving path in this project -
 * admin grant, commitment lock, completion unlock, forfeiture - funnels
 * through here, so the delta derivation, the immutability guarantee and the
 * invariant check exist once rather than four times.
 *
 * Callers pass a kind and an amount. The three deltas are derived from the
 * kind by `checkEntry`; there is no parameter through which a caller could
 * state its own balance change.
 *
 * @param tx       an open Firestore transaction, past its read phase
 * @param current  the wallet read by `readWalletForUpdate`
 * @returns the entry that was staged and the wallet it produces
 */
function stageWalletEntry(
  tx,
  db,
  {
    userId,
    walletRef,
    current,
    entryId,
    kind,
    source,
    amount,
    reason,
    assignmentId = null,
    appId = null,
    paymentRef = null,
    actorId,
    actorKind,
    idempotencyKey,
  },
) {
  const checked = checkEntry({ kind, source, amount });
  if (!checked.ok) {
    throw new HttpsError(checked.code, checked.message);
  }

  const entry = {
    userId,
    kind,
    source,
    deltaAvailable: checked.deltas.deltaAvailable,
    deltaLocked: checked.deltas.deltaLocked,
    deltaForfeited: checked.deltas.deltaForfeited,
    amount,
    reason,
    // Present and null rather than absent, so every entry has one shape.
    assignmentId,
    appId,
    paymentRef,
    actorId,
    actorKind,
    idempotencyKey,
    schemaVersion: WALLET_SCHEMA_VERSION,
    createdAt: FieldValue.serverTimestamp(),
  };

  const next = applyEntry(current, { ...entry, id: entryId });
  const invariants = checkInvariants(next);
  if (!invariants.ok) {
    // Refuse to persist a corrupt wallet. This is also what makes
    // "lock more than available" and "unlock more than was locked"
    // impossible: both produce a negative component, which fails here and
    // aborts the whole transaction rather than writing a broken balance.
    throw new HttpsError(
      "failed-precondition",
      `Refusing to write a wallet that breaks its invariants: ${invariants.errors.join("; ")}`,
    );
  }

  // `create`, never `set`: an existing entry must fail the transaction rather
  // than be overwritten. With deterministic entry ids this is what makes a
  // replayed settlement fail loudly instead of moving coins twice.
  tx.create(db.doc(ledgerPath(userId, entryId)), entry);
  tx.set(walletRef, {
    available: next.available,
    locked: next.locked,
    forfeitedTotal: next.forfeitedTotal,
    purchasedTotal: next.purchasedTotal,
    adjustmentNet: next.adjustmentNet,
    ledgerCount: next.ledgerCount,
    lastEntryId: entryId,
    schemaVersion: WALLET_SCHEMA_VERSION,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { entry, entryId, wallet: next };
}

/**
 * Grant play-money Testing Coins to a tester, atomically.
 *
 * Split out from the callable - the same shape every privileged path in this
 * project uses - so the whole money path can be tested without the Functions
 * runtime.
 */
async function runAdminGrant(db, { targetUserId, amount, reason, idempotencyKey, adminUid }) {
  const entryId = grantEntryId(idempotencyKey);
  const ledgerRef = db.doc(ledgerPath(targetUserId, entryId));
  const userRef = db.doc(`users/${targetUserId}`);

  return db.runTransaction(async (tx) => {
    // ---- reads: all of them, before any write ------------------------
    const existing = await tx.get(ledgerRef);
    if (existing.exists) {
      // A replay of the same key. Returning rather than throwing keeps a
      // double-submit from the console harmless.
      return { granted: false, reason: "duplicate", entryId, userId: targetUserId };
    }

    const target = await tx.get(userRef);
    if (!target.exists) {
      throw new HttpsError("not-found", "That user no longer exists.");
    }
    // A suspended account must not gain spendable balance. Rules cannot
    // express this (no client write reaches the wallet at all), so it is
    // enforced here, where the grant actually happens.
    if (target.get("isSuspended") === true) {
      throw new HttpsError(
        "failed-precondition",
        "That account is suspended and cannot receive coins.",
      );
    }

    const { ref: walletRefRead, wallet: current } = await readWalletForUpdate(
      tx,
      db,
      targetUserId,
    );

    // ---- writes: these two commit together or not at all -------------
    // Deltas are derived from the kind inside stageWalletEntry; nothing the
    // caller sent can influence them. Play money is recorded as an
    // adjustment, never a purchase, and carries no paymentRef.
    const { wallet: next } = stageWalletEntry(tx, db, {
      userId: targetUserId,
      walletRef: walletRefRead,
      current,
      entryId,
      kind: COIN_KIND_ADJUSTMENT,
      source: COIN_SOURCE_ADMIN_GRANT,
      amount,
      reason,
      actorId: adminUid,
      actorKind: ACTOR_KIND_ADMIN,
      idempotencyKey,
    });

    return {
      granted: true,
      entryId,
      userId: targetUserId,
      amount,
      wallet: {
        available: next.available,
        locked: next.locked,
        forfeitedTotal: next.forfeitedTotal,
      },
    };
  });
}

/**
 * Guard + grant, split out so the authorization wiring is testable too.
 *
 * `requireAdmin` re-reads the caller's role from Firestore on every call and
 * also refuses a suspended admin; nothing here trusts a client-supplied flag.
 */
async function adminGrantCoinsImpl(db, request) {
  const uid = requireAuth(request);
  await requireAdmin(db, uid);

  const data = request.data || {};
  const targetUserId = requireDocId(data.userId, "userId");

  // Separation of duties, matching adminVerifyAssignment and
  // adminSetUserSuspended: an admin cannot act on their own account.
  if (targetUserId === uid) {
    throw new HttpsError("failed-precondition", "You cannot grant coins to yourself.");
  }

  const amount = data.amount;
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpsError("invalid-argument", "Amount must be a positive whole number of coins.");
  }
  if (amount > MAX_ADMIN_GRANT_AMOUNT) {
    throw new HttpsError(
      "invalid-argument",
      `A single grant cannot exceed ${MAX_ADMIN_GRANT_AMOUNT} coins.`,
    );
  }

  // Required, not optional: without a key a double-submit would mint a second
  // grant, and there is no safe way to guess the caller's intent after the
  // fact. The console generates one per grant action.
  const idempotencyKey = requireDocId(data.idempotencyKey, "idempotencyKey");

  const reason =
    optionalString(data.reason, "reason", 280) || "Play-money grant (pre-payment pilot)";

  const outcome = await runAdminGrant(db, {
    targetUserId,
    amount,
    reason,
    idempotencyKey,
    adminUid: uid,
  });

  if (outcome.granted) {
    logger.info(
      `admin ${uid} granted ${amount} play-money coins to ${targetUserId} (${outcome.entryId})`,
    );
  } else {
    logger.info(
      `admin ${uid} grant to ${targetUserId} was a duplicate no-op (${outcome.entryId})`,
    );
  }
  return outcome;
}

/**
 * Recompute a wallet from its ledger and REPORT the difference.
 *
 * Deliberately read-only. A cached wallet that disagrees with its ledger is
 * evidence that something wrote a balance outside the ledger; silently
 * rewriting it would destroy that evidence and could just as easily be
 * overwriting the correct value with a wrong one. Repair, if it is ever
 * needed, must be a separate deliberate operation with its own audit trail.
 */
async function runWalletReconciliation(db, { userId }) {
  const walletSnap = await db.doc(walletPath(userId)).get();
  const cached = walletSnap.exists ? walletSnap.data() : null;

  const ledgerSnap = await db
    .collection(`users/${userId}/coinTransactions`)
    .orderBy("createdAt", "asc")
    .limit(RECONCILE_SCAN_LIMIT)
    .get();

  const entries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const { wallet: derived, legacy, unknown } = foldLedger(entries);
  const { matches, differences } = diffWallets(cached, derived);

  // Reward-era balance that predates this wallet. Reported, never migrated.
  const userSnap = await db.doc(`users/${userId}`).get();
  const legacyCoinBalance = userSnap.exists ? userSnap.get("coinBalance") : undefined;

  const report = {
    userId,
    walletExists: walletSnap.exists,
    matches,
    differences,
    cached: cached || null,
    derived,
    legacyLedgerEntries: legacy,
    unreadableLedgerEntries: unknown,
    legacyCoinBalance: typeof legacyCoinBalance === "number" ? legacyCoinBalance : null,
    scanned: entries.length,
    truncated: entries.length === RECONCILE_SCAN_LIMIT,
    repaired: false,
  };

  if (!matches) {
    logger.warn(`wallet reconciliation MISMATCH for ${userId}`, { differences });
  }
  if (legacy.count > 0) {
    logger.warn(
      `wallet reconciliation found ${legacy.count} pre-wallet ledger entries for ${userId} ` +
        `totalling ${legacy.totalAmount} - reported, not migrated`,
    );
  }
  if (typeof legacyCoinBalance === "number" && legacyCoinBalance !== 0) {
    logger.warn(
      `user ${userId} still carries a reward-era coinBalance of ${legacyCoinBalance} ` +
        `- reported, not migrated`,
    );
  }

  return report;
}

async function adminReconcileWalletImpl(db, request) {
  const uid = requireAuth(request);
  await requireAdmin(db, uid);
  const userId = requireDocId(request.data && request.data.userId, "userId");
  if (!isValidDocId(userId)) {
    throw new HttpsError("invalid-argument", "userId is invalid.");
  }
  return runWalletReconciliation(db, { userId });
}

/**
 * Callable: grant play-money Testing Coins during the pre-payment pilot.
 *
 * Input is `{ userId, amount, idempotencyKey, reason? }`. This is PLAY MONEY -
 * it is recorded as kind "adjustment" / source "adminGrant", never as a
 * purchase, because no money changed hands.
 */
const adminGrantCoins = onCall({ region: REGION }, (request) =>
  adminGrantCoinsImpl(getFirestore(), request),
);

/**
 * Callable: report how a wallet compares to its own ledger. Read-only.
 */
const adminReconcileWallet = onCall({ region: REGION }, (request) =>
  adminReconcileWalletImpl(getFirestore(), request),
);

module.exports = {
  adminGrantCoins,
  adminReconcileWallet,
  // Shared transaction primitives - the commitment lifecycle in
  // `commitments.js` moves coins through these, so there is exactly one
  // implementation of "apply a ledger entry to a wallet".
  readWalletForUpdate,
  stageWalletEntry,
  // Exported for tests - no Functions runtime required.
  adminGrantCoinsImpl,
  adminReconcileWalletImpl,
  runAdminGrant,
  runWalletReconciliation,
  grantEntryId,
  walletPath,
  ledgerPath,
  walletFromSnapshot,
};

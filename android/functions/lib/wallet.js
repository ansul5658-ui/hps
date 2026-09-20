/**
 * Pure Testing Coin wallet arithmetic.
 *
 * Side-effect free, like `lib/validation.js` and `lib/matching.js`, so every
 * balance rule can be unit tested without Firestore, the emulator or network
 * access. The orchestration that reads documents and writes the ledger lives
 * in `wallet.js`.
 *
 * THE INVARIANT
 *
 *     available + locked + forfeitedTotal == purchasedTotal + adjustmentNet
 *
 * This is not checked after the fact - it holds BY CONSTRUCTION. Every kind in
 * `KIND_DELTAS` below contributes the same amount to the left side as to the
 * right side, so any sequence of entries, in any order, preserves it.
 * `deltaSumsBalance()` proves that property over the table itself, and the
 * callers re-check the result anyway as a cheap backstop against a future edit
 * that breaks the pattern.
 *
 * WHY DELTAS ARE DERIVED, NOT SUPPLIED
 * A caller supplies at most a kind and an amount. The three deltas come from
 * this table. That is the difference between "the admin console asks for a 50
 * coin grant" and "the client states its own balance change" - the latter
 * would make every rule here decorative.
 */

const {
  COIN_KIND_PURCHASE,
  COIN_KIND_LOCK,
  COIN_KIND_UNLOCK,
  COIN_KIND_FORFEIT,
  COIN_KIND_ADJUSTMENT,
  COIN_KIND_REVERSAL,
  COIN_KINDS,
  COIN_SOURCES,
  WALLET_SCHEMA_VERSION,
} = require("./constants");

/**
 * Per-kind contribution to the five wallet totals, as multipliers of `amount`.
 *
 * Read each row as: "one unit of this kind moves this much". The left-side
 * columns (avail/locked/forfeited) and the right-side columns (purchased/
 * adjustment) must sum to the same number in every row - see
 * `deltaSumsBalance`.
 */
const KIND_DELTAS = {
  // Buying coins: new value enters the system.
  [COIN_KIND_PURCHASE]: { avail: +1, locked: 0, forfeited: 0, purchased: +1, adjustment: 0 },
  // Committing to an assignment: value moves sideways, none enters or leaves.
  [COIN_KIND_LOCK]: { avail: -1, locked: +1, forfeited: 0, purchased: 0, adjustment: 0 },
  // Completing successfully: the SAME coins come back. Not a reward.
  [COIN_KIND_UNLOCK]: { avail: +1, locked: -1, forfeited: 0, purchased: 0, adjustment: 0 },
  // Failing the commitment: locked coins are consumed, not returned.
  [COIN_KIND_FORFEIT]: { avail: 0, locked: -1, forfeited: +1, purchased: 0, adjustment: 0 },
  // Admin play money (and any future manual correction).
  [COIN_KIND_ADJUSTMENT]: { avail: +1, locked: 0, forfeited: 0, purchased: 0, adjustment: +1 },
  // Undoing an adjustment.
  [COIN_KIND_REVERSAL]: { avail: -1, locked: 0, forfeited: 0, purchased: 0, adjustment: -1 },
};

/** The zero wallet. A user who has never transacted has exactly this. */
function emptyWallet() {
  return {
    available: 0,
    locked: 0,
    forfeitedTotal: 0,
    purchasedTotal: 0,
    adjustmentNet: 0,
    ledgerCount: 0,
    lastEntryId: null,
    schemaVersion: WALLET_SCHEMA_VERSION,
  };
}

/**
 * Self-check over KIND_DELTAS: left side moves exactly as much as right side.
 *
 * Exported so a test asserts the table itself, not just a few worked examples.
 * If someone adds a kind that mints or destroys value asymmetrically, this
 * returns false and the invariant test fails immediately.
 */
function deltaSumsBalance() {
  return Object.values(KIND_DELTAS).every(
    (d) => d.avail + d.locked + d.forfeited === d.purchased + d.adjustment,
  );
}

function isKnownKind(kind) {
  return COIN_KINDS.includes(kind);
}

function isKnownSource(source) {
  return COIN_SOURCES.includes(source);
}

/**
 * A coin amount must be a positive whole number.
 *
 * Direction is carried by `kind`, never by the sign of `amount`, so a negative
 * amount is always a bug or an attack rather than "a debit". Floats are
 * refused outright: coins are indivisible and a fractional amount would make
 * the invariant drift on rounding.
 */
function isValidAmount(amount) {
  return Number.isInteger(amount) && amount > 0;
}

/**
 * The three balance deltas a given (kind, amount) produces.
 *
 * This is the only place deltas come from. Returns null for an unknown kind or
 * a bad amount rather than guessing.
 */
function ledgerDeltasFor(kind, amount) {
  if (!isKnownKind(kind) || !isValidAmount(amount)) return null;
  const d = KIND_DELTAS[kind];
  return {
    deltaAvailable: d.avail * amount,
    deltaLocked: d.locked * amount,
    deltaForfeited: d.forfeited * amount,
  };
}

/** True when a wallet-shaped object satisfies the invariant and every floor. */
function checkInvariants(w) {
  const errors = [];
  if (w.available < 0) errors.push("available is negative");
  if (w.locked < 0) errors.push("locked is negative");
  if (w.forfeitedTotal < 0) errors.push("forfeitedTotal is negative");
  const left = w.available + w.locked + w.forfeitedTotal;
  const right = w.purchasedTotal + w.adjustmentNet;
  if (left !== right) {
    errors.push(
      "invariant broken: available+locked+forfeited=" +
        left +
        " but purchased+adjustment=" +
        right,
    );
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Fold one entry into a wallet, returning a NEW wallet.
 *
 * `entry` is the stored ledger shape: it already carries its deltas, which
 * were derived by `ledgerDeltasFor` when it was written. Re-deriving them here
 * from (kind, amount) instead would hide a corrupted stored entry, so the fold
 * deliberately trusts what is on the document - reconciliation exists to
 * surface exactly that kind of drift.
 */
function applyEntry(wallet, entry) {
  const d = KIND_DELTAS[entry.kind];
  return {
    available: wallet.available + (entry.deltaAvailable || 0),
    locked: wallet.locked + (entry.deltaLocked || 0),
    forfeitedTotal: wallet.forfeitedTotal + (entry.deltaForfeited || 0),
    purchasedTotal: wallet.purchasedTotal + (d ? d.purchased * (entry.amount || 0) : 0),
    adjustmentNet: wallet.adjustmentNet + (d ? d.adjustment * (entry.amount || 0) : 0),
    ledgerCount: wallet.ledgerCount + 1,
    lastEntryId: entry.id || wallet.lastEntryId,
    schemaVersion: WALLET_SCHEMA_VERSION,
  };
}

/**
 * Is this a v2 wallet-era entry, or a leftover from the reward model?
 *
 * v1 entries (kind "earn", a bare `amount`, no deltas) are NOT folded. They
 * predate the commitment economy and absorbing them would silently convert
 * historical rewards into spendable commitment balance - the exact migration
 * this batch is forbidden from performing.
 */
function isV2Entry(entry) {
  return Boolean(
    entry && entry.schemaVersion === WALLET_SCHEMA_VERSION && isKnownKind(entry.kind),
  );
}

/**
 * Deterministically fold a whole ledger into wallet totals.
 *
 * Order-independent for the totals (addition commutes); `lastEntryId` follows
 * the order given, so callers pass entries oldest-first.
 *
 * Returns the derived wallet plus what it refused to fold, so a caller can
 * report legacy data instead of pretending it is not there.
 */
function foldLedger(entries) {
  let wallet = emptyWallet();
  const legacy = { count: 0, totalAmount: 0, ids: [] };
  const unknown = { count: 0, ids: [] };

  for (const entry of entries) {
    if (isV2Entry(entry)) {
      wallet = applyEntry(wallet, entry);
      continue;
    }
    // Anything not v2 is reported, never absorbed.
    if (entry && typeof entry.amount === "number" && Number.isFinite(entry.amount)) {
      legacy.count += 1;
      legacy.totalAmount += entry.amount;
      if (entry.id) legacy.ids.push(entry.id);
    } else {
      unknown.count += 1;
      if (entry && entry.id) unknown.ids.push(entry.id);
    }
  }

  return { wallet, legacy, unknown };
}

const COMPARED_FIELDS = [
  "available",
  "locked",
  "forfeitedTotal",
  "purchasedTotal",
  "adjustmentNet",
  "ledgerCount",
];

/**
 * Compare a cached wallet document against the ledger-derived one.
 *
 * Reports; never repairs. A mismatch is a signal that something wrote a
 * balance outside the ledger, and silently overwriting it would destroy the
 * only evidence of how it happened.
 */
function diffWallets(cached, derived) {
  const differences = [];
  const safe = cached || {};
  for (const field of COMPARED_FIELDS) {
    const was = safe[field] === undefined ? null : safe[field];
    const should = derived[field];
    if (was !== should) differences.push({ field, cached: was, derived: should });
  }
  return { matches: differences.length === 0, differences };
}

/**
 * Validate a proposed entry before it is written.
 *
 * Returns the server-derived deltas on success so the caller never has to
 * compute them (and so there is no second code path that could compute them
 * differently).
 */
function checkEntry({ kind, source, amount }) {
  if (!isKnownKind(kind)) {
    return { ok: false, code: "invalid-argument", message: "Unknown ledger kind." };
  }
  if (!isKnownSource(source)) {
    return { ok: false, code: "invalid-argument", message: "Unknown ledger source." };
  }
  if (!isValidAmount(amount)) {
    return {
      ok: false,
      code: "invalid-argument",
      message: "Amount must be a positive whole number of coins.",
    };
  }
  return { ok: true, deltas: ledgerDeltasFor(kind, amount) };
}

module.exports = {
  KIND_DELTAS,
  COMPARED_FIELDS,
  emptyWallet,
  deltaSumsBalance,
  isKnownKind,
  isKnownSource,
  isValidAmount,
  isV2Entry,
  ledgerDeltasFor,
  checkInvariants,
  applyEntry,
  foldLedger,
  diffWallets,
  checkEntry,
};

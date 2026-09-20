/**
 * Shared constants for the AppTesting backend.
 *
 * These mirror `com.apptesting.app.core.util.AppConfig` on the Android side.
 * They are duplicated deliberately: the server must never derive a limit from
 * a value the client sent.
 */

/** Deploy region — matches the default Firestore database location. */
const REGION = "asia-south2";

/** Document id of the official platform testing group. */
const OFFICIAL_GROUP_ID = "app_testing_official";

/** Defaults used only when the official group document has to be provisioned. */
const OFFICIAL_GROUP_NAME = "App Testing";
const OFFICIAL_GROUP_EMAIL = "developerapptesting@googlegroups.com";

/**
 * Tester slots opened per app.
 *
 * This is a PRODUCT setting (group capacity), not a Google Play requirement.
 * Play's current requirement for a newly created personal developer account is
 * 12 testers continuously opted in for 14 days; this number is deliberately
 * higher to absorb dropout, and it must not be read as "what Play demands".
 * Nothing in this file should encode a Play threshold — if the platform
 * requirement changes, that belongs in product configuration, not here.
 */
const REQUIRED_TESTER_COUNT = 20;

/** Default length of a testing assignment, in days. */
const DEFAULT_DAYS_REQUIRED = 14;

// ---------------------------------------------------------------------------
// Testing Coins — commitment economy
//
// Testing Coins are a COMMITMENT mechanism, not a reward. 50 coins represent a
// ₹50 commitment a tester puts at stake when they take on an assignment. They
// are not cash, cannot be withdrawn, and cannot be transferred between users.
//
// The lifecycle is: coins are locked when an assignment is taken on, the SAME
// coins are unlocked when it completes successfully, and they are forfeited if
// the commitment fails. There is deliberately no "+50 on completion" — a
// tester never ends up with more coins than they started with by testing.
//
// The old reward model (DEFAULT_COIN_REWARD / MAX_SINGLE_REWARD / kind "earn"
// / source "assignmentCompletion") is gone. Do not reintroduce it: paying a
// completion bonus would turn a commitment device into an earnings scheme and
// silently break the wallet invariant below.
// ---------------------------------------------------------------------------

/**
 * Coins a tester commits to a single testing assignment.
 *
 * Snapshotted onto each assignment at creation, so changing this constant
 * never alters an assignment that already exists.
 */
const DEFAULT_COMMITMENT_AMOUNT = 50;

/**
 * Defensive ceiling on a single assignment's commitment.
 *
 * Nothing in normal operation approaches this — it exists so a corrupted or
 * hand-edited `commitmentAmount` cannot lock an arbitrary sum.
 */
const MAX_COMMITMENT_AMOUNT = 500;

/**
 * Ceiling on one admin play-money grant.
 *
 * Pre-payment pilot only. Deliberately small: this mints spendable balance
 * from nothing, so the blast radius of a typo or a compromised admin session
 * is capped here rather than at the caller.
 */
const MAX_ADMIN_GRANT_AMOUNT = 1000;

/**
 * Schema version stamped on every wallet document and v2 ledger entry.
 *
 * v1 is the old reward-era `coinTransactions` shape (a bare `amount` with no
 * deltas). Reconciliation folds ONLY v2 entries and reports v1 ones instead of
 * absorbing them — see `lib/wallet.js`.
 */
const WALLET_SCHEMA_VERSION = 2;

/** Sub-path of the single wallet document under a user. */
const WALLET_DOC_ID = "balance";
const WALLET_SUBCOLLECTION = "wallet";

/**
 * Ledger entry kinds.
 *
 * The delta each one applies is derived server-side from the kind (see
 * `ledgerDeltasFor` in lib/wallet.js) and is never accepted from a caller.
 */
const COIN_KIND_PURCHASE = "purchase";
const COIN_KIND_LOCK = "lock";
const COIN_KIND_UNLOCK = "unlock";
const COIN_KIND_FORFEIT = "forfeit";
const COIN_KIND_ADJUSTMENT = "adjustment";
const COIN_KIND_REVERSAL = "reversal";

const COIN_KINDS = [
  COIN_KIND_PURCHASE,
  COIN_KIND_LOCK,
  COIN_KIND_UNLOCK,
  COIN_KIND_FORFEIT,
  COIN_KIND_ADJUSTMENT,
  COIN_KIND_REVERSAL,
];

/** Machine-readable provenance of a ledger entry, separate from `kind`. */
const COIN_SOURCE_PAYMENT = "payment";
const COIN_SOURCE_COMMITMENT = "commitment";
const COIN_SOURCE_COMPLETION = "completion";
const COIN_SOURCE_FAILURE = "failure";
const COIN_SOURCE_CANCELLATION = "cancellation";
const COIN_SOURCE_ADMIN_GRANT = "adminGrant";
const COIN_SOURCE_ADMIN_REVERSAL = "adminReversal";
const COIN_SOURCE_MIGRATION = "migration";

const COIN_SOURCES = [
  COIN_SOURCE_PAYMENT,
  COIN_SOURCE_COMMITMENT,
  COIN_SOURCE_COMPLETION,
  COIN_SOURCE_FAILURE,
  COIN_SOURCE_CANCELLATION,
  COIN_SOURCE_ADMIN_GRANT,
  COIN_SOURCE_ADMIN_REVERSAL,
  COIN_SOURCE_MIGRATION,
];

/** Who caused a ledger entry. */
const ACTOR_KIND_ADMIN = "admin";
const ACTOR_KIND_SYSTEM = "system";
const ACTOR_KIND_USER = "user";

/**
 * Assignment states an admin may verify a completion from.
 *
 * `ready` is absent on purpose: it means no testing day has been logged yet.
 */
const VERIFIABLE_FROM_STATUSES = ["waitingForVerification", "inProgress"];


// ---------------------------------------------------------------------------
// Quick Tests
//
// Quick Tests are lightweight discovery sessions. They are deliberately and
// completely outside the Testing Coin commitment economy: zero coins in, zero
// coins out, no assignment, no testingLog, no effect on commitment progress.
// The limits below exist to stop farming of the session history — there is
// nothing to farm today, but `trustScore` already exists on the user document
// and any future reputation feature would read this collection.
// ---------------------------------------------------------------------------

/** Firestore path of the server-maintained discovery pool document. */
const QUICK_TEST_POOL_DOC = "discovery/quickTestPool";

/**
 * How many app ids the pool holds.
 *
 * Deliberately larger than QUICK_TEST_MIN_VISIBLE: the client filters the pool
 * down (its own apps, apps still in cooldown, apps that went unavailable
 * between refreshes), so a pool of exactly 5 can render 2. The surplus is what
 * makes "at least 5 when enough exist" actually hold on a real device.
 */
const QUICK_TEST_POOL_SIZE = 8;

/** The floor the Apps screen promises when enough eligible apps exist. */
const QUICK_TEST_MIN_VISIBLE = 5;

/** Quick Tests one user may start per UTC day, across all apps. */
const QUICK_TEST_DAILY_LIMIT = 5;

/** Days before the same user may Quick Test the same app again. */
const QUICK_TEST_COOLDOWN_DAYS = 7;

/** Upper bound on apps examined in one pool refresh. */
const QUICK_TEST_POOL_SCAN_LIMIT = 200;

/** Ceiling on an optional free-text note attached to a completed session. */
const QUICK_TEST_NOTE_MAX_LENGTH = 500;

const APP_STATUSES = ["pendingReview", "approved", "rejected", "archived"];

const ASSIGNMENT_STATUSES = [
  "ready",
  "inProgress",
  "waitingForVerification",
  "completed",
  "missed",
];

/** Group states in which a new member may join. */
const JOINABLE_GROUP_STATES = ["draft", "open", "active"];

module.exports = {
  REGION,
  OFFICIAL_GROUP_ID,
  OFFICIAL_GROUP_NAME,
  OFFICIAL_GROUP_EMAIL,
  REQUIRED_TESTER_COUNT,
  DEFAULT_DAYS_REQUIRED,
  DEFAULT_COMMITMENT_AMOUNT,
  MAX_COMMITMENT_AMOUNT,
  MAX_ADMIN_GRANT_AMOUNT,
  WALLET_SCHEMA_VERSION,
  WALLET_DOC_ID,
  WALLET_SUBCOLLECTION,
  VERIFIABLE_FROM_STATUSES,
  QUICK_TEST_POOL_DOC,
  QUICK_TEST_POOL_SIZE,
  QUICK_TEST_MIN_VISIBLE,
  QUICK_TEST_DAILY_LIMIT,
  QUICK_TEST_COOLDOWN_DAYS,
  QUICK_TEST_POOL_SCAN_LIMIT,
  QUICK_TEST_NOTE_MAX_LENGTH,
  COIN_KIND_PURCHASE,
  COIN_KIND_LOCK,
  COIN_KIND_UNLOCK,
  COIN_KIND_FORFEIT,
  COIN_KIND_ADJUSTMENT,
  COIN_KIND_REVERSAL,
  COIN_KINDS,
  COIN_SOURCE_PAYMENT,
  COIN_SOURCE_COMMITMENT,
  COIN_SOURCE_COMPLETION,
  COIN_SOURCE_FAILURE,
  COIN_SOURCE_CANCELLATION,
  COIN_SOURCE_ADMIN_GRANT,
  COIN_SOURCE_ADMIN_REVERSAL,
  COIN_SOURCE_MIGRATION,
  COIN_SOURCES,
  ACTOR_KIND_ADMIN,
  ACTOR_KIND_SYSTEM,
  ACTOR_KIND_USER,
  APP_STATUSES,
  ASSIGNMENT_STATUSES,
  JOINABLE_GROUP_STATES,
};

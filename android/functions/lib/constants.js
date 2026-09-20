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

/**
 * Coin reward recorded on a new assignment.
 *
 * This is the TOTAL paid once for successfully completing the assignment —
 * not a per-day rate. It is snapshotted onto each assignment at creation, so
 * changing this constant never alters an existing assignment or anything
 * already paid. Payment happens only in `rewards.js`.
 */
const DEFAULT_COIN_REWARD = 50;

/**
 * Assignment states an admin may verify a completion from.
 *
 * `ready` is absent on purpose: it means no testing day has been logged yet.
 */
const VERIFIABLE_FROM_STATUSES = ["waitingForVerification", "inProgress"];

/**
 * Defensive ceiling on a single coin award.
 *
 * Nothing in normal operation approaches this — it exists so a corrupted or
 * hand-edited `coinReward` cannot mint an arbitrary amount.
 */
const MAX_SINGLE_REWARD = 1000;

/**
 * Ledger entry kind. Must stay in the set the Android client already parses
 * (`parseCoinKind` in FirestoreMappers.kt), or the wallet renders it wrong.
 */
const COIN_KIND_EARN = "earn";

/** Machine-readable provenance of a ledger entry, separate from `kind`. */
const COIN_SOURCE_ASSIGNMENT_COMPLETION = "assignmentCompletion";

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
  DEFAULT_COIN_REWARD,
  VERIFIABLE_FROM_STATUSES,
  MAX_SINGLE_REWARD,
  QUICK_TEST_POOL_DOC,
  QUICK_TEST_POOL_SIZE,
  QUICK_TEST_MIN_VISIBLE,
  QUICK_TEST_DAILY_LIMIT,
  QUICK_TEST_COOLDOWN_DAYS,
  QUICK_TEST_POOL_SCAN_LIMIT,
  QUICK_TEST_NOTE_MAX_LENGTH,
  COIN_KIND_EARN,
  COIN_SOURCE_ASSIGNMENT_COMPLETION,
  APP_STATUSES,
  ASSIGNMENT_STATUSES,
  JOINABLE_GROUP_STATES,
};

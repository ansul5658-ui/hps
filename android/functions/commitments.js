/**
 * The Testing Coin commitment lifecycle.
 *
 * A tester stakes coins on a testing assignment, gets the SAME coins back on
 * success, and loses them if the commitment window closes short. Three
 * movements, each its own transaction, each its own immutable ledger entry:
 *
 *     claim     available -50, locked +50     kind "lock"      source commitment
 *     complete  locked -50, available +50     kind "unlock"    source completion
 *     forfeit   locked -50, forfeited +50     kind "forfeit"   source failure
 *
 * There is no reward and no partial refund. The coins that come back are the
 * coins that went in.
 *
 * SECURITY MODEL
 *   * The client sends an appId. Nothing else it sends is trusted: the
 *     commitment amount, the tester id, the day requirement, the window and
 *     all three balance deltas are derived server-side.
 *   * Every movement goes through `stageWalletEntry` in `wallet.js`, so there
 *     is exactly one implementation of "apply a ledger entry to a wallet" and
 *     exactly one place the invariant is enforced.
 *   * Overdraft is structurally impossible, not merely checked: locking more
 *     than `available` produces a negative balance, which fails the invariant
 *     check and aborts the whole transaction. The friendly pre-check exists to
 *     produce a good error message, not to provide the guarantee.
 *   * Concurrency is guarded by two independent mechanisms. The wallet
 *     document is read inside the transaction, which locks it, so two claims
 *     against one balance serialize. The active-claim document is written with
 *     `tx.create`, so two claims on one app collide and one loses.
 *   * Settling twice is impossible: ledger ids are derived from the assignment
 *     id and written with `tx.create`, which refuses to overwrite.
 *
 * WHAT IS DELIBERATELY ABSENT
 * No scheduled window evaluator, no day-recording, no timezone pinning, no
 * payment path. Forfeiture is exposed only to trusted server code and to an
 * admin callable; nothing about a failed request, an offline device or a
 * timed-out function can reach it.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const logger = require("firebase-functions/logger");

const {
  REGION,
  ACTIVE_CLAIMS_COLLECTION,
  COMMITMENT_DAYS_REQUIRED,
  COMMITMENT_WINDOW_DAYS,
  DEFAULT_COMMITMENT_TIMEZONE,
  TIMEZONE_SOURCE_TESTER,
  TIMEZONE_SOURCE_DEFAULT,
  DEFAULT_COMMITMENT_AMOUNT,
  COIN_KIND_LOCK,
  COIN_KIND_UNLOCK,
  COIN_KIND_FORFEIT,
  COIN_SOURCE_COMMITMENT,
  COIN_SOURCE_COMPLETION,
  COIN_SOURCE_FAILURE,
  ACTOR_KIND_USER,
  ACTOR_KIND_SYSTEM,
  ACTOR_KIND_ADMIN,
} = require("./lib/constants");
const {
  cycleAssignmentId,
  activeClaimId,
  lockEntryId,
  unlockEntryId,
  forfeitEntryId,
  nextCycle,
  checkClaimEligible,
  checkUnlockEligible,
  checkForfeitEligible,
} = require("./lib/commitments");
const { deriveWindow, isValidTimeZone } = require("./lib/testingDays");
const { checkCommitmentExpiry } = require("./lib/expiry");
const { readOutageRecords } = require("./systemHealth");
const { readWalletForUpdate, stageWalletEntry } = require("./wallet");
const { requireAuth, requireAdmin, requireDocId } = require("./lib/guards");

function claimPath(appId, testerId) {
  return `${ACTIVE_CLAIMS_COLLECTION}/${activeClaimId(appId, testerId)}`;
}

function assignmentPath(assignmentId) {
  return `testingAssignments/${assignmentId}`;
}

function millisOf(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return 0;
}

/**
 * Count the tester's qualifying days from the logs themselves.
 *
 * The authority for settlement. `qualifyingDays` on the assignment is a cached
 * display value maintained by a trigger; this recount is what decides whether
 * coins move. Batch 4 replaces the underlying day-recording with a fully
 * server-derived one - this function is the seam that will absorb that change
 * without the settlement path noticing.
 */
async function countQualifyingDays(tx, db, assignmentId) {
  const snap = await tx.get(
    db.collection("testingLogs").where("assignmentId", "==", assignmentId).count(),
  );
  return snap.data().count;
}

// ---------------------------------------------------------------------------
// Claim
// ---------------------------------------------------------------------------

/**
 * Claim a testing assignment and lock the commitment, atomically.
 *
 * Creates three documents in one transaction: the cycle assignment, the active
 * claim, and the lock ledger entry - plus the wallet update. Either all four
 * land or none do, so a tester can never end up with locked coins and no
 * assignment, or an assignment with no locked coins.
 *
 * Exported separately from the callable - the same split every privileged
 * path in this project uses - so the money path can be tested without the
 * Functions runtime.
 */
async function runClaimCommitment(db, { appId, testerId, requestedTimeZone }) {
  // Resolve the zone BEFORE the transaction: it depends on nothing in the
  // database, and it must be settled before any coins move. A tester may state
  // their own zone once, here; it is validated against the runtime's real IANA
  // set, and from this moment it is immutable for the whole commitment.
  const timeZone = isValidTimeZone(requestedTimeZone)
    ? requestedTimeZone
    : DEFAULT_COMMITMENT_TIMEZONE;
  const timeZoneSource = isValidTimeZone(requestedTimeZone)
    ? TIMEZONE_SOURCE_TESTER
    : TIMEZONE_SOURCE_DEFAULT;
  const appRef = db.doc(`apps/${appId}`);
  const userRef = db.doc(`users/${testerId}`);
  const claimRef = db.doc(claimPath(appId, testerId));

  return db.runTransaction(async (tx) => {
    // ---- reads: all of them, before any write ------------------------
    const [appSnap, userSnap, claimSnap] = await Promise.all([
      tx.get(appRef),
      tx.get(userRef),
      tx.get(claimRef),
    ]);

    // Every assignment this tester already has for this app, so the new cycle
    // is strictly higher than any existing one and an unfinished assignment
    // blocks a second claim even if its claim document went missing.
    const priorSnap = await tx.get(
      db
        .collection("testingAssignments")
        .where("appId", "==", appId)
        .where("testerId", "==", testerId),
    );
    const priorIds = priorSnap.docs.map((d) => d.id);
    const openPrior = priorSnap.docs.find(
      (d) => !["completed", "failed", "missed", "cancelled"].includes(d.get("status")),
    );

    // Reading the wallet locks it, which is what makes two concurrent claims
    // against one balance serialize rather than both succeeding.
    const { ref: walletRef, wallet } = await readWalletForUpdate(tx, db, testerId);

    // ---- decide -------------------------------------------------------
    const commitmentAmount = DEFAULT_COMMITMENT_AMOUNT;
    const rawTesterCount = appSnap.exists ? appSnap.get("testerCount") : 0;
    const currentTesterCount = Number.isInteger(rawTesterCount) ? rawTesterCount : 0;
    const eligible = checkClaimEligible({
      appExists: appSnap.exists,
      appStatus: appSnap.exists ? appSnap.get("status") : null,
      appOwnerId: appSnap.exists ? appSnap.get("ownerId") : null,
      testerId,
      isSuspended: userSnap.exists && userSnap.get("isSuspended") === true,
      hasActiveClaim: claimSnap.exists,
      openAssignmentStatus: openPrior ? openPrior.get("status") : null,
      availableCoins: wallet.available,
      commitmentAmount,
      testerCount: currentTesterCount,
    });
    if (!eligible.ok) {
      throw new HttpsError(eligible.code, eligible.message);
    }
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "You need a profile before testing.");
    }

    const cycle = nextCycle(priorIds);
    const assignmentId = cycleAssignmentId(appId, testerId, cycle);
    const entryId = lockEntryId(assignmentId);

    // The commitment clock, derived from the SERVER clock and the pinned zone.
    // Day 1 is the next full local day - the partial day the tester joined on
    // is deliberately not a testing day. See `deriveWindow`.
    const claimedAtMillis = Date.now();
    const window = deriveWindow({ claimedAtMillis, timeZone });
    if (!window) {
      throw new HttpsError("internal", "Could not establish the testing window.");
    }

    // ---- writes: all of them commit together or not at all ------------
    // `create`, not `set`: a racing claim for the same app must collide here
    // and lose rather than overwrite the winner's claim.
    tx.create(claimRef, {
      assignmentId,
      appId,
      testerId,
      cycle,
      commitmentAmount,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.create(db.doc(assignmentPath(assignmentId)), {
      appId,
      testerId,
      developerId: appSnap.get("ownerId") || null,
      groupId: appSnap.get("activeGroupId") || null,
      cycle,
      commitmentAmount,
      daysRequired: COMMITMENT_DAYS_REQUIRED,
      windowDays: window.windowDays,
      // ---- the commitment clock, pinned for life -----------------------
      // Immutable after this point. Security rules refuse every client write
      // to these fields, and no server path rewrites them: a tester who could
      // move `firstEligibleDayKey` or the zone could shift their own deadline.
      timeZone: window.timeZone,
      timeZoneSource,
      claimedDayKey: window.claimedDayKey,
      firstEligibleDayKey: window.firstEligibleDayKey,
      lastEligibleDayKey: window.lastEligibleDayKey,
      windowEndsAt: Timestamp.fromMillis(window.windowEndsAtMillis),
      // Extended only by a future outage registry; the window math already
      // reads it, so nothing here changes when that lands.
      creditedOutageDays: 0,
      qualifyingDays: 0,
      // Kept in step with qualifyingDays by syncAssignmentProgress; the
      // settlement path recounts from testingLogs regardless.
      daysCompleted: 0,
      status: "ready",
      lockTxId: entryId,
      settlementTxId: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const staged = stageWalletEntry(tx, db, {
      userId: testerId,
      walletRef,
      current: wallet,
      entryId,
      kind: COIN_KIND_LOCK,
      source: COIN_SOURCE_COMMITMENT,
      amount: commitmentAmount,
      reason: `Committed to testing ${appId}`,
      assignmentId,
      appId,
      actorId: testerId,
      actorKind: ACTOR_KIND_USER,
      idempotencyKey: entryId,
    });

    // The app's tester counter used to be maintained by push-matching, which
    // no longer exists. Maintaining it here keeps the developer-facing
    // "N testers" display working AND is what enforces REQUIRED_TESTER_COUNT:
    // the app document was read inside this transaction, so the count cannot
    // be raced past the cap.
    //
    // The cost is real and worth stating: every claim for one app now contends
    // on that app's document, so simultaneous claims by different testers
    // serialize. That is the price of a correct global cap, and it does not
    // affect claims across different apps.
    tx.update(appRef, {
      testerCount: currentTesterCount + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return {
      claimed: true,
      assignmentId,
      appId,
      cycle,
      commitmentAmount,
      lockTxId: entryId,
      timeZone: window.timeZone,
      firstEligibleDayKey: window.firstEligibleDayKey,
      lastEligibleDayKey: window.lastEligibleDayKey,
      wallet: {
        available: staged.wallet.available,
        locked: staged.wallet.locked,
        forfeitedTotal: staged.wallet.forfeitedTotal,
      },
    };
  });
}

/**
 * Guard + claim, split out so the authorization wiring is testable too.
 *
 * The caller supplies an appId. The tester is the verified uid from the ID
 * token, never a field in the request - a client naming someone else's uid
 * would otherwise be able to spend their coins.
 */
async function joinTestingAssignmentImpl(db, request) {
  const uid = requireAuth(request);
  const appId = requireDocId(request.data && request.data.appId, "appId");
  // The ONE moment a client may influence the day boundary. Validated as a
  // real IANA zone and pinned; an absent or bogus value falls back to the
  // documented default rather than to the server's own zone.
  const requestedTimeZone = request.data && request.data.timeZone;

  const outcome = await runClaimCommitment(db, { appId, testerId: uid, requestedTimeZone });
  logger.info(
    `tester ${uid} claimed ${outcome.assignmentId} ` +
      `(cycle ${outcome.cycle}, locked ${outcome.commitmentAmount})`,
  );
  return outcome;
}

// ---------------------------------------------------------------------------
// Settlement: unlock
// ---------------------------------------------------------------------------

/**
 * Stage the successful settlement of a commitment inside an OPEN transaction.
 *
 * Takes an already-read assignment snapshot so it can be composed into the
 * existing completion transaction in `completion.js` rather than running a
 * second one - a separate transaction could interleave and leave the
 * assignment completed but the coins still locked.
 *
 * Returns null when the assignment carries no lock, which is the reward-era
 * case: those assignments never staked anything, so there is nothing to
 * return and completion proceeds without touching the wallet.
 *
 * MUST be called after every read in the enclosing transaction.
 */
async function stageUnlockSettlement(tx, db, { assignmentSnap, qualifyingDays, actorId, actorKind }) {
  const assignmentId = assignmentSnap.id;
  const lockTxId = assignmentSnap.get("lockTxId");
  if (!lockTxId) return null;

  const testerId = assignmentSnap.get("testerId");
  const appId = assignmentSnap.get("appId");
  const amount = assignmentSnap.get("commitmentAmount");

  const eligible = checkUnlockEligible({
    status: assignmentSnap.get("status"),
    daysRequired: assignmentSnap.get("daysRequired"),
    qualifyingDays,
    lockTxId,
  });
  if (!eligible.ok) {
    throw new HttpsError(eligible.code, eligible.message);
  }

  const { ref: walletRef, wallet } = await readWalletForUpdate(tx, db, testerId);
  const entryId = unlockEntryId(assignmentId);

  const staged = stageWalletEntry(tx, db, {
    userId: testerId,
    walletRef,
    current: wallet,
    entryId,
    kind: COIN_KIND_UNLOCK,
    source: COIN_SOURCE_COMPLETION,
    amount,
    reason: `Returned commitment for ${appId}`,
    assignmentId,
    appId,
    actorId,
    actorKind,
    idempotencyKey: entryId,
  });

  // The claim is what stops a new cycle starting; releasing it is part of the
  // same transaction so a settled commitment can never leave one stranded.
  tx.delete(db.doc(claimPath(appId, testerId)));

  return { settlementTxId: entryId, amount, testerId, wallet: staged.wallet };
}

// ---------------------------------------------------------------------------
// Settlement: forfeit
// ---------------------------------------------------------------------------

/**
 * Turn a refused expiry verdict into a message worth reading in a log.
 *
 * Every branch here is a REFUSAL to destroy someone's coins, so each one says
 * which rule saved the commitment. "failed-precondition" with no explanation
 * is the kind of thing that gets debugged by re-running a forfeiture with the
 * checks removed.
 */
function expiryRefusalMessage(expiry) {
  switch (expiry.reason) {
    case "requirementMet":
      return "That commitment met its requirement and must be completed, not forfeited.";
    case "windowOpen":
      return expiry.creditedOutageDays > 0
        ? `That commitment's window is still open: ${expiry.creditedOutageDays} ` +
          `declared outage day(s) extend it to ${expiry.effectiveLastEligibleDayKey}.`
        : "That commitment's testing window has not closed yet.";
    case "alreadySettled":
      return "That commitment has already been settled.";
    case "noCommitment":
      return "That assignment has no committed coins to forfeit.";
    case "noTimeZone":
      return "That assignment has no pinned timezone, so its deadline cannot be determined.";
    case "invalidWindow":
      return "That assignment has no valid testing window.";
    default:
      return "That commitment is not eligible for forfeiture.";
  }
}

/**
 * Forfeit an expired commitment, atomically.
 *
 * THE ONE SETTLEMENT PRIMITIVE FOR FORFEITURE. The admin callable, the
 * scheduled sweep and the tests all come through here; none of them
 * reimplements a coin movement, and none of them decides for itself whether a
 * window has closed. A second forfeiture path would be a second chance to get
 * "destroy 50 of someone's coins" wrong.
 *
 * Trusted server path only. The decision is made entirely from stored
 * assignment state, the declared outage records and the server clock. Nothing
 * a client sends - and nothing about a failed request, an offline device or a
 * timed-out function - participates in it.
 *
 * TWO INDEPENDENT GATES, BOTH OF WHICH MUST AGREE
 *   1. `checkForfeitEligible` - the coarse elapsed-time rule (createdAt plus
 *      the window length).
 *   2. `checkCommitmentExpiry` - the PINNED local-day window, with declared
 *      outage days credited.
 * Requiring both is strictly harder to satisfy than either alone, and the
 * pinned rule is the later of the two, so it is the one that effectively
 * governs. Keeping the coarse rule as well costs nothing and means a bug in
 * the day arithmetic cannot forfeit a commitment that has plainly not run its
 * calendar length.
 *
 * FAILS CLOSED ON MISSING STATE. An assignment with no readable pinned zone
 * cannot be forfeited at all: no deadline can be derived for it, and guessing
 * one would move it. Every assignment carrying a lock has a pinned window -
 * the claim transaction writes it unconditionally - so in practice this only
 * catches corruption, which is exactly when refusing is right.
 */
async function runForfeitCommitment(
  db,
  { assignmentId, actorId, actorKind, nowMillis = Date.now() },
) {
  const assignmentRef = db.doc(assignmentPath(assignmentId));

  return db.runTransaction(async (tx) => {
    const assignmentSnap = await tx.get(assignmentRef);
    if (!assignmentSnap.exists) {
      throw new HttpsError("not-found", "That assignment no longer exists.");
    }

    const testerId = assignmentSnap.get("testerId");
    const appId = assignmentSnap.get("appId");
    const amount = assignmentSnap.get("commitmentAmount");
    const lockTxId = assignmentSnap.get("lockTxId");

    // Recounted, never taken from the cached field: forfeiting a tester who
    // actually did the work would be the worst possible bug here.
    const qualifyingDays = await countQualifyingDays(tx, db, assignmentId);

    const eligible = checkForfeitEligible({
      status: assignmentSnap.get("status"),
      lockTxId,
      createdAtMillis: millisOf(assignmentSnap.get("createdAt")),
      windowDays: assignmentSnap.get("windowDays"),
      daysRequired: assignmentSnap.get("daysRequired"),
      qualifyingDays,
      nowMillis,
    });
    if (!eligible.ok) {
      throw new HttpsError(eligible.code, eligible.message);
    }

    // Declared outages, read INSIDE the transaction. That placement is the
    // whole defence against the outage/expiry race: an admin declaring a day
    // degraded while this transaction is in flight changes a document this
    // transaction has read, so Firestore aborts and retries it, and the retry
    // sees the declaration and declines to forfeit. Reading them before the
    // transaction would settle the race by luck.
    const firstEligibleDayKey = assignmentSnap.get("firstEligibleDayKey");
    const lastEligibleDayKey = assignmentSnap.get("lastEligibleDayKey");
    const outageRecords = await readOutageRecords(db, {
      fromDayKey: firstEligibleDayKey,
      toDayKey: lastEligibleDayKey,
      tx,
    });

    // The pinned local-day window, with outage credit applied. This is the
    // same decision `evaluateWindowExpiry` reports read-only, re-derived here
    // rather than trusted from a caller - the sweep tells this function WHICH
    // assignment to look at, never WHETHER to forfeit it.
    const expiry = checkCommitmentExpiry({
      status: assignmentSnap.get("status"),
      lockTxId,
      appId,
      timeZone: assignmentSnap.get("timeZone"),
      firstEligibleDayKey,
      lastEligibleDayKey,
      qualifyingDays,
      daysRequired: assignmentSnap.get("daysRequired"),
      outageRecords,
      nowMillis,
    });
    if (!expiry.expired) {
      throw new HttpsError(
        "failed-precondition",
        expiryRefusalMessage(expiry),
      );
    }

    const { ref: walletRef, wallet } = await readWalletForUpdate(tx, db, testerId);
    const entryId = forfeitEntryId(assignmentId);

    const staged = stageWalletEntry(tx, db, {
      userId: testerId,
      walletRef,
      current: wallet,
      entryId,
      kind: COIN_KIND_FORFEIT,
      source: COIN_SOURCE_FAILURE,
      amount,
      reason: `Commitment not met for ${appId}`,
      assignmentId,
      appId,
      actorId,
      actorKind,
      idempotencyKey: entryId,
    });

    tx.update(assignmentRef, {
      status: "failed",
      settlementTxId: entryId,
      qualifyingDays,
      // Written only now, as part of the terminal record, and never consulted
      // to make a decision - the live calculation always re-derives it. This
      // is an audit trail for "why did this window end when it did", not the
      // source of truth it would become if the evaluator read it back.
      creditedOutageDays: expiry.creditedOutageDays,
      effectiveLastEligibleDayKey: expiry.effectiveLastEligibleDayKey,
      forfeitedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.delete(db.doc(claimPath(appId, testerId)));

    return {
      forfeited: true,
      assignmentId,
      testerId,
      amount,
      settlementTxId: entryId,
      qualifyingDays,
      creditedOutageDays: expiry.creditedOutageDays,
      effectiveLastEligibleDayKey: expiry.effectiveLastEligibleDayKey,
      wallet: {
        available: staged.wallet.available,
        locked: staged.wallet.locked,
        forfeitedTotal: staged.wallet.forfeitedTotal,
      },
    };
  });
}

async function adminForfeitCommitmentImpl(db, request) {
  const uid = requireAuth(request);
  await requireAdmin(db, uid);
  const assignmentId = requireDocId(
    request.data && request.data.assignmentId,
    "assignmentId",
  );

  const outcome = await runForfeitCommitment(db, {
    assignmentId,
    actorId: uid,
    actorKind: ACTOR_KIND_ADMIN,
  });
  logger.info(
    `admin ${uid} forfeited ${assignmentId}: ${outcome.amount} coins from ${outcome.testerId}`,
  );
  return outcome;
}

// ---------------------------------------------------------------------------
// Callables
// ---------------------------------------------------------------------------

/**
 * Callable: claim a testing assignment and commit Testing Coins to it.
 *
 * Input is `{ appId }` only. There is deliberately no way for a caller to
 * influence the amount, the tester, the cycle or the balance deltas.
 */
const joinTestingAssignment = onCall({ region: REGION }, (request) =>
  joinTestingAssignmentImpl(getFirestore(), request),
);

/**
 * Callable: forfeit an expired commitment.
 *
 * Admin-only, and still refused unless the window has genuinely elapsed with
 * the requirement unmet. An admin cannot forfeit a commitment early, and
 * cannot forfeit one that actually qualified.
 */
const adminForfeitCommitment = onCall({ region: REGION }, (request) =>
  adminForfeitCommitmentImpl(getFirestore(), request),
);

module.exports = {
  joinTestingAssignment,
  adminForfeitCommitment,
  // Exported for tests and for composition - no Functions runtime required.
  joinTestingAssignmentImpl,
  adminForfeitCommitmentImpl,
  runClaimCommitment,
  runForfeitCommitment,
  stageUnlockSettlement,
  countQualifyingDays,
  claimPath,
  assignmentPath,
  ACTOR_KIND_SYSTEM,
};

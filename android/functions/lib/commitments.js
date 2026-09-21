/**
 * Pure commitment-lifecycle rules.
 *
 * Side-effect free, like `lib/wallet.js` and `lib/validation.js`, so every
 * decision that governs real coin movement can be unit tested without
 * Firestore, the emulator or network access. The transactions live in
 * `commitments.js`.
 *
 * THE LIFECYCLE
 *
 *     claim     available -50, locked +50     ledger kind "lock"
 *     complete  locked -50, available +50     ledger kind "unlock"
 *     forfeit   locked -50, forfeited +50     ledger kind "forfeit"
 *
 * The same 50 coins come back on success. There is no reward, and there is no
 * partial refund on failure - a commitment either completes or it does not.
 *
 * WHY IDENTITIES ARE CYCLE-SCOPED
 * The reward-era id `{appId}__{testerId}` could only ever exist once per
 * (app, tester). Under the commitment model a tester may test the same app
 * again after finishing, and each attempt stakes its own coins, so each needs
 * its own assignment, its own ledger entries and its own settlement. Reusing
 * one id would mean the second cycle's `tx.create` collides with the first
 * cycle's history and the lock silently fails - or worse, succeeds against
 * stale state. Hence `{appId}__{testerId}__c{n}`.
 */

const {
  COMMITMENT_DAYS_REQUIRED,
  COMMITMENT_WINDOW_DAYS,
  DEFAULT_COMMITMENT_AMOUNT,
  MAX_COMMITMENT_AMOUNT,
  REQUIRED_TESTER_COUNT,
  TERMINAL_ASSIGNMENT_STATUSES,
} = require("./constants");

const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Deterministic, cycle-scoped assignment id.
 *
 * Deterministic so `tx.create` can be the duplicate guard; cycle-scoped so a
 * finished commitment never blocks a new one. Do not make this random.
 */
function cycleAssignmentId(appId, testerId, cycle) {
  return `${appId}__${testerId}__c${cycle}`;
}

/**
 * Id of the at-most-one live commitment for a (app, tester) pair.
 *
 * Deliberately NOT cycle-scoped: its whole purpose is to be the one document
 * whose existence means "this tester already has a live commitment on this
 * app", so a second concurrent claim collides on `tx.create` and loses.
 */
function activeClaimId(appId, testerId) {
  return `${appId}__${testerId}`;
}

/** Deterministic ledger ids. One per assignment cycle, per movement. */
function lockEntryId(assignmentId) {
  return `lock_${assignmentId}`;
}
function unlockEntryId(assignmentId) {
  return `unlock_${assignmentId}`;
}
function forfeitEntryId(assignmentId) {
  return `forfeit_${assignmentId}`;
}

/** True when an assignment can no longer be settled. */
function isTerminalStatus(status) {
  return TERMINAL_ASSIGNMENT_STATUSES.includes(status);
}

/**
 * Parse the trailing cycle number out of a cycle-scoped assignment id.
 *
 * Returns 0 for a reward-era id with no cycle suffix, so such a document
 * counts as "cycle 0 already used" and the first real commitment becomes
 * cycle 1.
 */
function cycleOf(assignmentId) {
  if (typeof assignmentId !== "string") return 0;
  const match = /__c(\d+)$/.exec(assignmentId);
  if (!match) return 0;
  const n = Number(match[1]);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/**
 * The cycle a new commitment should take, given every assignment that already
 * exists for this (app, tester).
 *
 * Always strictly greater than any existing cycle, so a new claim can never
 * collide with a finished one - including a reward-era document, which reads
 * as cycle 0.
 */
function nextCycle(existingAssignmentIds) {
  let highest = 0;
  for (const id of existingAssignmentIds || []) {
    const c = cycleOf(id);
    if (c > highest) highest = c;
  }
  return highest + 1;
}

/**
 * Every value-derived precondition for claiming a commitment.
 *
 * Existence checks (app present, wallet present, claim present) stay with the
 * caller, which is the only place that can read documents. Everything
 * decidable from plain values is decided here, so the whole decision table is
 * testable without an emulator.
 *
 * @returns {{ok: true} | {ok: false, code: string, message: string}}
 */
function checkClaimEligible({
  appExists,
  appStatus,
  appOwnerId,
  testerId,
  isSuspended,
  hasActiveClaim,
  openAssignmentStatus,
  availableCoins,
  commitmentAmount,
  testerCount,
}) {
  if (isSuspended) {
    return {
      ok: false,
      code: "permission-denied",
      message:
        "Your account is suspended. Contact support if you think this is a mistake.",
    };
  }
  if (!appExists) {
    return { ok: false, code: "not-found", message: "That app no longer exists." };
  }
  if (appStatus !== "approved") {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That app is not open for testing.",
    };
  }
  // A developer testing their own app would be staking coins against
  // themselves and would make the 14-day evidence worthless.
  if (appOwnerId && appOwnerId === testerId) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "You cannot test your own app.",
    };
  }
  if (hasActiveClaim) {
    return {
      ok: false,
      code: "already-exists",
      message: "You already have an active commitment for this app.",
    };
  }
  // Belt and braces: the active claim above should already cover this, but a
  // non-terminal assignment with a missing claim document would otherwise let
  // a tester run two live commitments on one app.
  if (openAssignmentStatus && !isTerminalStatus(openAssignmentStatus)) {
    return {
      ok: false,
      code: "already-exists",
      message: "You already have an unfinished assignment for this app.",
    };
  }
  if (
    !Number.isInteger(commitmentAmount) ||
    commitmentAmount <= 0 ||
    commitmentAmount > MAX_COMMITMENT_AMOUNT
  ) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That commitment amount is not valid.",
    };
  }
  // The app's tester cap. Push-matching used to enforce this before creating
  // assignments; with that gone, the claim path is the only place left that
  // can. The count is read inside the claim transaction, so it cannot be raced
  // past the cap by simultaneous claimants.
  const taken = Number.isInteger(testerCount) ? testerCount : 0;
  if (taken >= REQUIRED_TESTER_COUNT) {
    return {
      ok: false,
      code: "resource-exhausted",
      message: "This app already has all the testers it needs.",
    };
  }
  // Checked here AND enforced structurally by the wallet invariant, which
  // refuses a negative `available`. This check exists to produce a useful
  // message; the invariant is what makes it safe.
  if (!Number.isInteger(availableCoins) || availableCoins < commitmentAmount) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `You need ${commitmentAmount} available Testing Coins to commit to this test.`,
    };
  }
  return { ok: true };
}

/**
 * Whether a commitment may settle successfully (unlock).
 *
 * `qualifyingDays` here must be the SERVER's recount, never a field the client
 * influenced - the caller is responsible for supplying the counted value.
 */
function checkUnlockEligible({ status, daysRequired, qualifyingDays, lockTxId }) {
  if (isTerminalStatus(status)) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `An assignment in "${status}" has already been settled.`,
    };
  }
  if (!lockTxId) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That assignment has no committed coins to return.",
    };
  }
  if (!Number.isInteger(daysRequired) || daysRequired <= 0) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That assignment has no valid day requirement.",
    };
  }
  if (!Number.isInteger(qualifyingDays) || qualifyingDays < daysRequired) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `Only ${qualifyingDays} of ${daysRequired} qualifying days are recorded.`,
    };
  }
  return { ok: true };
}

/**
 * Whether a commitment may be forfeited.
 *
 * DELIBERATELY NARROW. Forfeiture destroys a tester's coins, so it is allowed
 * only when the server can see, from stored state alone, that the commitment
 * window has elapsed and the requirement was not met.
 *
 * It must never be reachable because a request failed, a device was offline, a
 * function timed out or a client said it missed a day. None of those are
 * inputs here, and none should be added: this function takes the assignment's
 * own recorded state and the server clock, and nothing else.
 */
function checkForfeitEligible({
  status,
  lockTxId,
  createdAtMillis,
  windowDays,
  daysRequired,
  qualifyingDays,
  nowMillis,
}) {
  if (isTerminalStatus(status)) {
    return {
      ok: false,
      code: "failed-precondition",
      message: `An assignment in "${status}" has already been settled.`,
    };
  }
  if (!lockTxId) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That assignment has no committed coins to forfeit.",
    };
  }
  if (!Number.isInteger(createdAtMillis) || createdAtMillis <= 0) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That assignment has no valid start time.",
    };
  }
  const window = Number.isInteger(windowDays) && windowDays > 0
    ? windowDays
    : COMMITMENT_WINDOW_DAYS;
  const deadline = createdAtMillis + window * MILLIS_PER_DAY;
  if (!Number.isInteger(nowMillis) || nowMillis < deadline) {
    return {
      ok: false,
      code: "failed-precondition",
      message: "That commitment window has not closed yet.",
    };
  }
  const required = Number.isInteger(daysRequired) && daysRequired > 0
    ? daysRequired
    : COMMITMENT_DAYS_REQUIRED;
  const days = Number.isInteger(qualifyingDays) ? qualifyingDays : 0;
  // The requirement was actually met - the tester is owed their coins back,
  // not a forfeiture, even though nobody settled it in time.
  if (days >= required) {
    return {
      ok: false,
      code: "failed-precondition",
      message:
        "That commitment met its requirement and must be completed, not forfeited.",
    };
  }
  return { ok: true };
}

/** Millisecond deadline a commitment must be settled by. */
function windowDeadlineMillis(createdAtMillis, windowDays) {
  const window = Number.isInteger(windowDays) && windowDays > 0
    ? windowDays
    : COMMITMENT_WINDOW_DAYS;
  return createdAtMillis + window * MILLIS_PER_DAY;
}

module.exports = {
  MILLIS_PER_DAY,
  REQUIRED_TESTER_COUNT,
  DEFAULT_COMMITMENT_AMOUNT,
  COMMITMENT_DAYS_REQUIRED,
  COMMITMENT_WINDOW_DAYS,
  cycleAssignmentId,
  activeClaimId,
  lockEntryId,
  unlockEntryId,
  forfeitEntryId,
  isTerminalStatus,
  cycleOf,
  nextCycle,
  checkClaimEligible,
  checkUnlockEligible,
  checkForfeitEligible,
  windowDeadlineMillis,
};

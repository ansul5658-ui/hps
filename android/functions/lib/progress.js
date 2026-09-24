/**
 * Commitment status and member progress: the pure shaping behind the two
 * read-only callables in progress.js.
 *
 * NOTHING HERE DECIDES ANYTHING
 * Every number these functions return was derived by the same server code
 * the settlements use - the log recount, `checkCommitmentExpiry` and the miss
 * evidence - and handed in by the caller. This module only chooses which of
 * those facts leave the server, and under what name. It never writes, never
 * reads a client value, and never computes a miss count of its own.
 *
 * WHAT LEAVES THE SERVER IS AN ALLOW-LIST
 * Both shapes are built field by field. Nothing is spread from a stored
 * document, so a field added to an assignment later cannot leak through a read
 * that was reviewed before it existed.
 *
 *   * A tester's own status: their commitment, its pinned clock, recounted
 *     progress and the live miss verdict. No ledger ids, no wallet balance, no
 *     developer uid, no `cancelledBy` (which can be an admin's uid).
 *   * A member row: an anonymous label, whether it is the caller, the display
 *     state and the day counts. No uid, no assignment id (it embeds the uid),
 *     no name, no photo, no email, no wallet or stake - users' profiles are
 *     readable only by their owner and admins, and this read does not widen
 *     that.
 */

const { TERMINAL_ASSIGNMENT_STATUSES, FAILURE_REASON_TOO_MANY_MISSES } = require("./constants");
const { addDays, isValidDayKey, isValidTimeZone, startOfLocalDayMillis } = require("./testingDays");
const { holdsCapacity } = require("./commitments");
const { missRuleApplies } = require("./misses");

/**
 * The one word the UI should render for a commitment.
 *
 *   testing             live, and nothing has ended it
 *   awaitingSettlement  still live on paper, but the server verdict says it is
 *                       already lost (third miss, or window closed short) and
 *                       the sweep has not settled it yet. NEVER "testing": the
 *                       check-in and the cancellation would both be refused.
 *   completed           the requirement was met and the stake returned
 *   cancelled           ended early, stake returned
 *   removedForMisses    forfeited at the third miss
 *   forfeited           forfeited because the window closed short
 *   missed              legacy terminal status from before the wallet
 */
const STATE_TESTING = "testing";
const STATE_AWAITING_SETTLEMENT = "awaitingSettlement";
const STATE_COMPLETED = "completed";
const STATE_CANCELLED = "cancelled";
const STATE_REMOVED_FOR_MISSES = "removedForMisses";
const STATE_FORFEITED = "forfeited";
const STATE_MISSED = "missed";

function commitmentState({ status, failureReason, verdict }) {
  if (status === "completed") return STATE_COMPLETED;
  if (status === "cancelled") return STATE_CANCELLED;
  if (status === "missed") return STATE_MISSED;
  if (status === "failed") {
    return failureReason === FAILURE_REASON_TOO_MANY_MISSES
      ? STATE_REMOVED_FOR_MISSES
      : STATE_FORFEITED;
  }
  if (verdict && verdict.expired === true) return STATE_AWAITING_SETTLEMENT;
  return STATE_TESTING;
}

/** True for a stored status no settlement can change any more. */
function isTerminalStatus(status) {
  return TERMINAL_ASSIGNMENT_STATUSES.includes(status);
}

/**
 * Misses a live commitment can still absorb before the next one removes it.
 * Null when there is no miss rule (legacy) or no verdict to count from.
 */
function remainingMisses(missedDays, allowedMisses) {
  if (!missRuleApplies(allowedMisses) || !Number.isInteger(missedDays)) return null;
  return Math.max(0, allowedMisses - missedDays);
}

/**
 * The miss count to show. A live commitment gets the count re-derived for
 * this read; a terminal one gets only what its settlement froze on it
 * (`missedDays` is written by forfeiture and nothing else). Re-deriving for a
 * settled commitment would count every day since it ended as a miss.
 */
function displayedMissedDays({ status, storedMissedDays, verdict }) {
  if (isTerminalStatus(status)) {
    return Number.isInteger(storedMissedDays) ? storedMissedDays : null;
  }
  return verdict && Number.isInteger(verdict.missedDays) ? verdict.missedDays : null;
}

function millisOf(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  return null;
}

/** Local midnight after `dayKey` in `timeZone` - the instant a window closes. */
function endOfDayMillis(dayKey, timeZone) {
  if (!isValidDayKey(dayKey) || !isValidTimeZone(timeZone)) return null;
  return startOfLocalDayMillis(addDays(dayKey, 1), timeZone);
}

/**
 * The caller's own view of one commitment.
 *
 * @param {object} args
 * @param {string} args.assignmentId
 * @param {object} args.data         the stored assignment
 * @param {number} args.qualifyingDays  recounted from testingLogs
 * @param {object|null} args.verdict   `checkCommitmentExpiry` output, or null
 *                                     for a terminal commitment
 * @param {number} args.nowMillis    the server clock this read used
 */
function shapeCommitmentStatus({ assignmentId, data, qualifyingDays, verdict, nowMillis }) {
  const status = data.status || null;
  const terminal = isTerminalStatus(status);
  const allowedMisses = missRuleApplies(data.allowedMisses) ? data.allowedMisses : null;
  const missedDays = displayedMissedDays({
    status,
    storedMissedDays: data.missedDays,
    verdict,
  });
  const timeZone = data.timeZone || null;
  const effectiveLast = terminal
    ? (data.effectiveLastEligibleDayKey || data.lastEligibleDayKey || null)
    : ((verdict && verdict.effectiveLastEligibleDayKey) || data.lastEligibleDayKey || null);
  const nextCheckInAt = millisOf(data.nextCheckInAt);
  const hasCommitment = Boolean(data.lockTxId);
  const settled = Boolean(data.settlementTxId);

  let stake = "none";
  if (hasCommitment && !settled) stake = "locked";
  else if (hasCommitment && status === "failed") stake = "forfeited";
  else if (hasCommitment && settled) stake = "returned";

  const state = commitmentState({ status, failureReason: data.failureReason, verdict });

  return {
    assignmentId,
    appId: data.appId || null,
    groupId: data.groupId || null,
    cycle: Number.isInteger(data.cycle) ? data.cycle : null,
    status,
    state,
    // Why it ended, or - for `awaitingSettlement` - why it is about to.
    endReason: status === "failed"
      ? (data.failureReason || null)
      : (state === STATE_AWAITING_SETTLEMENT ? verdict.reason : null),
    isActive: !terminal && state === STATE_TESTING,

    timeZone,
    claimedAtMillis: millisOf(data.createdAt),
    claimedDayKey: data.claimedDayKey || null,
    firstEligibleDayKey: data.firstEligibleDayKey || null,
    lastEligibleDayKey: data.lastEligibleDayKey || null,
    effectiveLastEligibleDayKey: effectiveLast,
    windowEndsAtMillis: millisOf(data.windowEndsAt),
    effectiveWindowEndsAtMillis: endOfDayMillis(effectiveLast, timeZone),
    windowDays: Number.isInteger(data.windowDays) ? data.windowDays : null,
    todayKey: verdict && verdict.todayKey ? verdict.todayKey : null,

    daysRequired: Number.isInteger(data.daysRequired) ? data.daysRequired : null,
    qualifyingDays,
    loggedToday: !terminal && nextCheckInAt !== null && nowMillis < nextCheckInAt,
    nextCheckInAtMillis: terminal ? null : nextCheckInAt,

    missRule: allowedMisses !== null,
    allowedMisses,
    missedDays,
    remainingMisses: terminal ? null : remainingMisses(missedDays, allowedMisses),
    removalCheckAtMillis: terminal ? null : millisOf(data.removalCheckAt),

    capacityHeld: holdsCapacity({ capacityHeld: data.capacityHeld, lockTxId: data.lockTxId }),
    commitmentAmount: Number.isInteger(data.commitmentAmount) ? data.commitmentAmount : 0,
    stake,

    completedAtMillis: millisOf(data.completedAt),
    cancelledAtMillis: millisOf(data.cancelledAt),
    forfeitedAtMillis: millisOf(data.forfeitedAt),
    serverNowMillis: nowMillis,
  };
}

/**
 * Anonymous, stable labels for an app's members: "Tester 1".."Tester N" in
 * claim order, ties broken by assignment id so two reads never disagree.
 *
 * @param {Array<{assignmentId: string, createdAtMillis: number|null}>} members
 * @returns {Map<string, string>} assignmentId -> label
 */
function memberLabels(members) {
  const ordered = [...members].sort((x, y) => {
    const a = Number.isFinite(x.createdAtMillis) ? x.createdAtMillis : Number.MAX_SAFE_INTEGER;
    const b = Number.isFinite(y.createdAtMillis) ? y.createdAtMillis : Number.MAX_SAFE_INTEGER;
    if (a !== b) return a - b;
    return x.assignmentId < y.assignmentId ? -1 : x.assignmentId > y.assignmentId ? 1 : 0;
  });
  return new Map(ordered.map((m, i) => [m.assignmentId, `Tester ${i + 1}`]));
}

/**
 * One member row, built from the caller-independent status shape. Only the
 * progress facts cross over; see the header for what is withheld and why.
 */
function shapeMemberRow({ status, label, isYou }) {
  return {
    label,
    isYou,
    state: status.state,
    daysRequired: status.daysRequired,
    qualifyingDays: status.qualifyingDays,
    missedDays: status.missedDays,
    allowedMisses: status.allowedMisses,
    remainingMisses: status.remainingMisses,
    loggedToday: status.loggedToday,
  };
}

/**
 * Who may see an app's member progress: its owner, anyone currently holding
 * one of its slots, and an admin. A tester whose commitment was cancelled or
 * forfeited has given the slot back and is no longer a member.
 */
function canReadMemberProgress({ callerId, isAdmin, appOwnerId, memberTesterIds }) {
  if (!callerId) return false;
  if (isAdmin === true) return true;
  if (appOwnerId && appOwnerId === callerId) return true;
  return Array.isArray(memberTesterIds) && memberTesterIds.includes(callerId);
}

module.exports = {
  STATE_TESTING,
  STATE_AWAITING_SETTLEMENT,
  STATE_COMPLETED,
  STATE_CANCELLED,
  STATE_REMOVED_FOR_MISSES,
  STATE_FORFEITED,
  STATE_MISSED,
  commitmentState,
  isTerminalStatus,
  remainingMisses,
  displayedMissedDays,
  shapeCommitmentStatus,
  memberLabels,
  shapeMemberRow,
  canReadMemberProgress,
};

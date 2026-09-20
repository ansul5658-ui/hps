/**
 * Quick Test rules — pure logic.
 *
 * Side-effect free, like `lib/validation.js`, `lib/matching.js` and
 * `lib/rewards.js`, so every eligibility rule can be unit tested without
 * Firestore, the emulator or network access. The orchestration that reads
 * documents and writes sessions lives in `quickTests.js`.
 *
 * WHAT A QUICK TEST IS NOT
 * A Quick Test never touches the commitment economy. There is no coin effect,
 * no `testingAssignments` document, and no `testingLogs` entry. That is
 * enforced structurally rather than by validation: a `quickTestSessions`
 * document has no `assignmentId` field at all, and `testingLogs` creation
 * requires an owned active assignment. Nothing here can produce a qualifying
 * testing day, and no later refactor of this file could accidentally make it.
 */

const {
  QUICK_TEST_DAILY_LIMIT,
  QUICK_TEST_COOLDOWN_DAYS,
  QUICK_TEST_POOL_SIZE,
} = require("./constants");

/**
 * Deterministic session document id.
 *
 * This is the idempotency key for the whole start path. It must never be
 * random or time-derived below day resolution: paired with `tx.create`, it is
 * what makes "one Quick Test per user per app per day" a storage-layer
 * guarantee rather than a check a race can slip past. Same reasoning as
 * `completionLedgerId` in lib/rewards.js and the `testingLogs` id scheme.
 */
function quickTestSessionId(uid, appId, dayKey) {
  return uid + "__" + appId + "__" + dayKey;
}

/**
 * UTC calendar day as `yyyy-MM-dd`.
 *
 * Matches `TimeProvider.todayKey()` on Android and `serverDayKey()` in the
 * security rules, so all three agree on what "today" means. The value is
 * always derived from the server's own clock — a caller never supplies it.
 */
function utcDayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

/**
 * Whole days from `fromKey` to `toKey`, both `yyyy-MM-dd`.
 *
 * Returns null when either key is unparseable, so a corrupt stored value fails
 * a cooldown check closed rather than silently reading as "expired".
 */
function daysBetweenDayKeys(fromKey, toKey) {
  if (typeof fromKey !== "string" || typeof toKey !== "string") return null;
  const from = Date.parse(fromKey + "T00:00:00Z");
  const to = Date.parse(toKey + "T00:00:00Z");
  if (Number.isNaN(from) || Number.isNaN(to)) return null;
  return Math.round((to - from) / 86400000);
}

/**
 * Every value-derived precondition for starting a Quick Test.
 *
 * Existence checks (does the app document exist, is there already a session)
 * stay with the caller, which is the only place that can read documents.
 * Everything decidable from plain values is decided here.
 *
 * @returns {{ok: true} | {ok: false, code: string, reason: string, message: string}}
 */
function checkQuickTestEligible({
  appExists,
  appStatus,
  quickTestEnabled,
  appOwnerId,
  uid,
  isSuspended,
  sessionExists,
  sessionsToday,
  lastSessionDayKey,
  todayKey,
  dailyLimit = QUICK_TEST_DAILY_LIMIT,
  cooldownDays = QUICK_TEST_COOLDOWN_DAYS,
}) {
  if (isSuspended) {
    return {
      ok: false,
      code: "permission-denied",
      reason: "suspended",
      message:
        "Your account is suspended. Contact support if you think this is a mistake.",
    };
  }
  if (!appExists) {
    return {
      ok: false,
      code: "not-found",
      reason: "missingApp",
      message: "That app no longer exists.",
    };
  }
  if (appStatus !== "approved") {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "notApproved",
      message: "That app isn't available for testing.",
    };
  }
  // `quickTestEnabled` is absent on every app that predates this feature, so
  // this is an explicit `!== true` rather than a truthiness test: absent must
  // read as disabled, never as enabled.
  if (quickTestEnabled !== true) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "quickTestDisabled",
      message: "That app isn't offering Quick Tests right now.",
    };
  }
  // Mirrors selectTesters() refusing to match an owner to their own app: a
  // developer opening their own listing is not a test of anything.
  if (appOwnerId && appOwnerId === uid) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "ownApp",
      message: "You can't Quick Test your own app.",
    };
  }
  // Idempotent, like evaluateJoin()'s alreadyMember: a repeat tap on a session
  // already started today is a success that writes nothing, not an error the
  // UI has to explain.
  if (sessionExists) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "alreadyToday",
      message: "You've already Quick Tested this app today.",
    };
  }
  if (!Number.isInteger(dailyLimit) || dailyLimit <= 0) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "invalidLimit",
      message: "Quick Tests are unavailable right now.",
    };
  }
  const usedToday = Number.isInteger(sessionsToday) ? sessionsToday : 0;
  if (usedToday >= dailyLimit) {
    return {
      ok: false,
      code: "resource-exhausted",
      reason: "dailyLimit",
      message:
        "You've used all " + dailyLimit +
        " Quick Tests for today. Try again tomorrow.",
    };
  }
  // Cooldown. An absent marker means this user has never Quick Tested this
  // app, which is the common case and must pass.
  if (lastSessionDayKey) {
    const elapsed = daysBetweenDayKeys(lastSessionDayKey, todayKey);
    if (elapsed === null) {
      return {
        ok: false,
        code: "failed-precondition",
        reason: "corruptCooldown",
        message: "Quick Tests are unavailable for this app right now.",
      };
    }
    if (elapsed < cooldownDays) {
      const remaining = cooldownDays - elapsed;
      return {
        ok: false,
        code: "failed-precondition",
        reason: "cooldown",
        message:
          "You Quick Tested this app recently. Try again in " + remaining +
          (remaining === 1 ? " day." : " days."),
      };
    }
  }
  return { ok: true };
}

/**
 * Choose which apps make up the next discovery pool.
 *
 * Rotation rule: least-recently-surfaced first, app id as a deterministic
 * tie-breaker. An app that has never been surfaced sorts to the very front, so
 * a newly approved app reaches the pool on the next refresh rather than
 * queueing behind established ones.
 *
 * This ordering is what makes the pool fair, and it is also the reason
 * selection is server-side at all: a client-side `orderBy` would let a caller
 * reverse the rotation and pin the pool to the same apps forever.
 *
 * @param {Array<{appId: string, lastSurfacedAtMillis: number}>} candidates
 * @returns {Array<string>} app ids, pool-ordered
 */
function selectPoolAppIds({ candidates, poolSize = QUICK_TEST_POOL_SIZE }) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates || []) {
    const appId = candidate && candidate.appId;
    if (!appId || seen.has(appId)) continue;
    seen.add(appId);
    unique.push({
      appId,
      lastSurfacedAtMillis: Number.isFinite(candidate.lastSurfacedAtMillis)
        ? candidate.lastSurfacedAtMillis
        : 0,
    });
  }

  unique.sort((a, b) => {
    if (a.lastSurfacedAtMillis !== b.lastSurfacedAtMillis) {
      return a.lastSurfacedAtMillis - b.lastSurfacedAtMillis;
    }
    return a.appId < b.appId ? -1 : a.appId > b.appId ? 1 : 0;
  });

  const limit = Math.max(0, Math.min(poolSize, unique.length));
  return unique.slice(0, limit).map((c) => c.appId);
}

module.exports = {
  quickTestSessionId,
  utcDayKey,
  daysBetweenDayKeys,
  checkQuickTestEligible,
  selectPoolAppIds,
};

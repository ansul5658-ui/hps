/**
 * Tester matching — pure selection logic.
 *
 * MVP MATCHING RULES (deliberately simple and deterministic; this is not a
 * recommendation engine):
 *
 *   1. A candidate must have a real `users/{uid}` document.
 *   2. A suspended candidate is never matched.
 *   3. The app owner is never matched to their own app.
 *   4. Candidates come from the testing group attached to the app, so group
 *      membership is a precondition of even being considered.
 *   5. A tester who already holds an assignment for this app is skipped, so a
 *      repeated call is a no-op rather than a duplicate.
 *   6. Duplicate candidate ids collapse to one.
 *   7. Ordering is oldest-membership-first, with the uid as a tiebreaker, so
 *      the same input always produces the same output.
 *   8. The number selected never exceeds the app's remaining tester slots.
 *
 * Everything here is side-effect free; `assignments.js` owns the Firestore I/O.
 */

/**
 * @param {Object} params
 * @param {Array<{uid: string, joinedAtMillis: number, isSuspended: boolean, exists: boolean}>} params.candidates
 * @param {string} params.ownerId app owner, never eligible
 * @param {Array<string>} params.alreadyAssignedTesterIds testers holding an assignment for this app
 * @param {number} params.remainingSlots tester slots left on the app
 * @param {number} params.maxThisRun upper bound for this single call
 * @returns {{selected: Array<string>, skipped: Array<{uid: string, reason: string}>}}
 */
function selectTesters({
  candidates,
  ownerId,
  alreadyAssignedTesterIds,
  remainingSlots,
  maxThisRun,
}) {
  const assigned = new Set(alreadyAssignedTesterIds || []);
  const seen = new Set();
  const skipped = [];
  const eligible = [];

  for (const candidate of candidates || []) {
    const uid = candidate && candidate.uid;
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);

    if (!candidate.exists) {
      skipped.push({ uid, reason: "noUserDocument" });
      continue;
    }
    if (candidate.isSuspended) {
      skipped.push({ uid, reason: "suspended" });
      continue;
    }
    if (uid === ownerId) {
      skipped.push({ uid, reason: "appOwner" });
      continue;
    }
    if (assigned.has(uid)) {
      skipped.push({ uid, reason: "alreadyAssigned" });
      continue;
    }
    eligible.push(candidate);
  }

  eligible.sort((a, b) => {
    const left = Number.isFinite(a.joinedAtMillis) ? a.joinedAtMillis : 0;
    const right = Number.isFinite(b.joinedAtMillis) ? b.joinedAtMillis : 0;
    if (left !== right) return left - right;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  });

  const limit = Math.max(0, Math.min(remainingSlots, maxThisRun));
  const selected = eligible.slice(0, limit).map((c) => c.uid);

  for (const overflow of eligible.slice(limit)) {
    skipped.push({ uid: overflow.uid, reason: "noSlotsRemaining" });
  }

  return { selected, skipped };
}

/** Deterministic assignment id — makes a duplicate create impossible. */
function assignmentIdFor(appId, testerId) {
  return `${appId}__${testerId}`;
}

module.exports = { selectTesters, assignmentIdFor };

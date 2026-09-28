/**
 * Test fixture support for the Batch 9D join gate. Not a test file.
 *
 * WHY THIS EXISTS
 * Every suite written before 9D seeds a bare target app and bare testers,
 * then claims. Those suites test other rules - coins, capacity, windows,
 * misses, settlement - and the join gate now correctly refuses their claims,
 * because nobody in them has a ready app of their own or has joined the
 * testing group. This helper makes their seeded world satisfy the gate the
 * REAL way: each target app gets a valid opt-in URL and a genuine
 * self-confirmation whose fingerprint is computed by production code, and
 * each user gets a ready app of their own plus the group membership that
 * `joinGroup` would have written.
 *
 * It never changes a field a test set: an app seeded as `pendingReview`
 * stays unapproved and is still refused. The gate itself is tested explicitly,
 * without this helper, in setup.test.js and setup.emulator.test.js.
 */

const { OFFICIAL_GROUP_ID, TERMS_VERSION } = require("../lib/constants");
const {
  SETUP_CONFIRMATION_FIELD,
  SETUP_CONFIRMATION_KIND,
  appGroupId,
  setupFingerprint,
} = require("../lib/setup");

/**
 * Terms acceptance as the acceptTerms callable records it (release audit F2).
 * Every real signed-in user accepts the Terms before starting anything, so a
 * seeded user who stands in for one carries it too. The Terms gate itself is
 * tested explicitly, without this, in terms.test.js and terms.emulator.test.js.
 */
const TERMS_ACCEPTED = Object.freeze({ termsAcceptedVersion: TERMS_VERSION, termsAcceptedAt: new Date(0) });

function packageFor(appId) {
  return `com.test.a_${String(appId).replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/**
 * An app document with valid setup links and a current self-confirmation
 * layered UNDER `app` - fields the test set win.
 */
function readyAppDoc(appId, app = {}, { confirmedAt = new Date(0) } = {}) {
  const pkg = app.packageName || packageFor(appId);
  const merged = {
    packageName: pkg,
    closedTestingUrl: `https://play.google.com/apps/testing/${pkg}`,
    ...app,
  };
  if (merged[SETUP_CONFIRMATION_FIELD] !== undefined) return merged;
  return {
    ...merged,
    [SETUP_CONFIRMATION_FIELD]: {
      kind: SETUP_CONFIRMATION_KIND,
      confirmedBy: merged.ownerId,
      confirmedAt,
      fingerprint: setupFingerprint(merged),
      groupId: appGroupId(merged),
      closedTestConfigured: true,
      googleGroupAdded: true,
    },
  };
}

const ownAppId = (uid) => `own_${String(uid).replace(/[^A-Za-z0-9_]/g, "_")}`;

/** The documents that make `uid` join-ready: a ready own app and the group membership. */
function joinReadyDocs(uid, { confirmedAt } = {}) {
  const id = ownAppId(uid);
  return {
    [`apps/${id}`]: readyAppDoc(id, { ownerId: uid, status: "approved", appName: `${uid}'s app` }, { confirmedAt }),
    [`users/${uid}/memberships/${OFFICIAL_GROUP_ID}`]: { groupId: OFFICIAL_GROUP_ID, joinedAt: confirmedAt || new Date(0) },
  };
}

/**
 * A fake-Firestore seed (path -> data) made join-ready in place: every
 * `apps/{id}` gains setup and a confirmation, every `users/{uid}` gains an own
 * app and a membership. Returns the same object.
 */
function makeJoinReady(seed) {
  for (const path of Object.keys(seed)) {
    const app = /^apps\/([^/]+)$/.exec(path);
    if (app && seed[path] && seed[path].ownerId) seed[path] = readyAppDoc(app[1], seed[path]);
  }
  for (const path of Object.keys(seed)) {
    const user = /^users\/([^/]+)$/.exec(path);
    if (!user) continue;
    // Fields the test set win - including a deliberately unaccepted profile.
    seed[path] = { ...TERMS_ACCEPTED, ...seed[path] };
    for (const [p, d] of Object.entries(joinReadyDocs(user[1]))) {
      if (!(p in seed)) seed[p] = d;
    }
  }
  return seed;
}

/** Emulator form: write the join-ready documents for `uid`. */
async function seedJoinReady(db, uid) {
  const batch = db.batch();
  // merge: the test seeded the profile itself; only the acceptance is added.
  batch.set(db.doc(`users/${uid}`), TERMS_ACCEPTED, { merge: true });
  for (const [p, d] of Object.entries(joinReadyDocs(uid))) batch.set(db.doc(p), d);
  await batch.commit();
}

module.exports = { TERMS_ACCEPTED, packageFor, readyAppDoc, ownAppId, joinReadyDocs, makeJoinReady, seedJoinReady };

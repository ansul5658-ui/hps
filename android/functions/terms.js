/**
 * `acceptTerms` - records that the caller accepted the current Terms of
 * Service and Privacy Policy (release audit F2). See lib/terms.js for the
 * storage model and the checks that depend on it.
 *
 * Server-authoritative by construction:
 *   - the uid is the verified caller; there is no target-user argument;
 *   - the timestamp is the server's, never the client's;
 *   - the version must be exactly the current TERMS_VERSION, so a client
 *     showing stale Terms cannot record consent to text it never displayed;
 *   - re-accepting the version already on file writes nothing, so the
 *     original acceptance time can never be moved.
 *
 * Suspended users may still accept: consent grants no capability on its own,
 * and every privileged action keeps its own suspension check.
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");
const { REGION, TERMS_VERSION } = require("./lib/constants");
const { requireAuth } = require("./lib/guards");
const {
  TERMS_VERSION_FIELD,
  TERMS_ACCEPTED_AT_FIELD,
  hasAcceptedCurrentTerms,
} = require("./lib/terms");

async function runAcceptTerms(db, { uid, version }) {
  if (!Number.isInteger(version)) {
    throw new HttpsError("invalid-argument", '"version" must be a whole number.');
  }
  if (version !== TERMS_VERSION) {
    throw new HttpsError(
      "failed-precondition",
      "These Terms are out of date. Please update the app and review the current Terms.",
      { reason: "termsVersionMismatch", requiredVersion: TERMS_VERSION },
    );
  }

  const userRef = db.doc(`users/${uid}`);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    // The profile is written by the client at sign-in; acceptance is recorded
    // on it rather than creating a half-formed profile here.
    if (!snap.exists) {
      throw new HttpsError(
        "failed-precondition",
        "Your profile isn't set up yet. Please sign in again.",
        { reason: "profileMissing" },
      );
    }
    if (hasAcceptedCurrentTerms(snap.data())) {
      return { accepted: true, version: snap.get(TERMS_VERSION_FIELD), alreadyAccepted: true };
    }
    tx.update(userRef, {
      [TERMS_VERSION_FIELD]: TERMS_VERSION,
      [TERMS_ACCEPTED_AT_FIELD]: FieldValue.serverTimestamp(),
    });
    return { accepted: true, version: TERMS_VERSION, alreadyAccepted: false };
  });
}

async function acceptTermsImpl(db, request) {
  const uid = requireAuth(request);
  const version = request.data ? request.data.version : undefined;
  return runAcceptTerms(db, { uid, version });
}

/** Input `{ version }`: the TERMS_VERSION the client displayed. */
const acceptTerms = onCall({ region: REGION }, (request) =>
  acceptTermsImpl(getFirestore(), request),
);

module.exports = { runAcceptTerms, acceptTermsImpl, acceptTerms };

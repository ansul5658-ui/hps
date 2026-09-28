/**
 * Terms of Service + Privacy Policy acceptance (release audit F2).
 *
 * Acceptance lives on the user's own profile, `users/{uid}`:
 *   termsAcceptedVersion  the TERMS_VERSION the user accepted (integer)
 *   termsAcceptedAt       server timestamp of that acceptance
 *
 * Both are written ONLY by the `acceptTerms` callable. Security rules keep
 * them out of every client-writable field list, so a client can neither set,
 * backdate, clear nor touch another user's acceptance.
 *
 * Kept free of Firestore reads so the decision is unit-testable: callers pass
 * the profile data they have already read (inside their own transaction,
 * where there is one).
 */

const { HttpsError } = require("firebase-functions/v2/https");
const { TERMS_VERSION } = require("./constants");

const TERMS_VERSION_FIELD = "termsAcceptedVersion";
const TERMS_ACCEPTED_AT_FIELD = "termsAcceptedAt";

/** The `details.reason` a refused call carries, so clients can route to the Terms screen. */
const TERMS_NOT_ACCEPTED_REASON = "termsNotAccepted";

/** True when this profile has accepted the CURRENT (or a later) Terms version. */
function hasAcceptedCurrentTerms(userData) {
  const version = userData ? userData[TERMS_VERSION_FIELD] : undefined;
  return Number.isInteger(version) && version >= TERMS_VERSION;
}

/**
 * Throws a recognisable `failed-precondition` unless the profile has accepted
 * the current Terms. `details.reason` is TERMS_NOT_ACCEPTED_REASON.
 */
function requireTermsAccepted(userData) {
  if (!hasAcceptedCurrentTerms(userData)) {
    throw new HttpsError(
      "failed-precondition",
      "Please accept the current Terms of Service and Privacy Policy to continue.",
      { reason: TERMS_NOT_ACCEPTED_REASON, requiredVersion: TERMS_VERSION },
    );
  }
}

module.exports = {
  TERMS_VERSION_FIELD,
  TERMS_ACCEPTED_AT_FIELD,
  TERMS_NOT_ACCEPTED_REASON,
  hasAcceptedCurrentTerms,
  requireTermsAccepted,
};

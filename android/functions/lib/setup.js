/**
 * Developer testing setup, app readiness and the join prerequisites - the pure
 * rules behind setup.js and the claim transaction (Batch 9D).
 *
 * WHAT APPTESTING CAN AND CANNOT KNOW
 * AppTesting does not create, own or administer a developer's Play Console,
 * their closed test, or the Google Group, and it has no API that can see who
 * is enrolled in either. Everything here is therefore one of two kinds:
 *   * CHECKED - things the server can actually establish: the app's review
 *     status, that an opt-in URL is well-formed and names this app's package,
 *     who owns the app.
 *   * SELF-CONFIRMED - things only the developer or tester can attest to: that
 *     the closed test exists and has the AppTesting group added as testers,
 *     and that the tester joined that group. Recorded with who and when, and
 *     always described as self-confirmed, never as verified.
 * A well-formed URL is not proof the test exists; nothing here claims it is.
 *
 * THE PRODUCT RULE
 *   * An app is READY for testers when it is admin-approved, carries a valid
 *     closed-testing opt-in URL for its own package (plus a valid Play listing
 *     URL if one is given), and its developer has self-confirmed that exact
 *     setup. Editing the URLs or package afterwards makes the confirmation
 *     outdated - it was a statement about the old values.
 *   * A tester may JOIN a commitment only if they have at least one READY app
 *     of their own, and have self-confirmed joining the target app's testing
 *     group (the official shared AppTesting group unless an admin assigned
 *     another). The target itself must be ready and owned by someone else.
 */

const crypto = require("node:crypto");

const { OFFICIAL_GROUP_ID } = require("./constants");

/** Where a confirmation lives on the app document. Server-written only. */
const SETUP_CONFIRMATION_FIELD = "setupConfirmation";
/** The word the product uses for it. Never "verified". */
const SETUP_CONFIRMATION_KIND = "selfConfirmed";

const PLAY_HOST = "play.google.com";
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const MAX_URL_LENGTH = 500;

/** Readiness gaps, as stable reason codes the app can map to copy. */
const READINESS = Object.freeze({
  NOT_APPROVED: "notApproved",
  INVALID_PACKAGE: "invalidPackageName",
  MISSING_OPT_IN_URL: "missingOptInUrl",
  INVALID_OPT_IN_URL: "invalidOptInUrl",
  INVALID_PLAY_STORE_URL: "invalidPlayStoreUrl",
  NOT_CONFIRMED: "setupNotConfirmed",
  CONFIRMATION_OUTDATED: "setupConfirmationOutdated",
});

function isValidPackageName(value) {
  return typeof value === "string" && value.length <= 255 && PACKAGE_RE.test(value);
}

function trimmed(value) {
  return typeof value === "string" ? value.trim() : "";
}

/** Parse an https play.google.com URL, or null. No credentials, no port. */
function parsePlayUrl(value) {
  const raw = trimmed(value);
  if (!raw || raw.length > MAX_URL_LENGTH) return null;
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.hostname.toLowerCase() !== PLAY_HOST) return null;
  if (url.username || url.password || url.port) return null;
  return url;
}

/**
 * The package a closed-testing opt-in URL is for, or null when it is not one:
 * `https://play.google.com/apps/testing/<package>` (a trailing slash is fine).
 */
function optInUrlPackage(value) {
  const url = parsePlayUrl(value);
  if (!url) return null;
  const m = /^\/apps\/testing\/([^/]+)\/?$/.exec(url.pathname);
  return m && isValidPackageName(m[1]) ? m[1] : null;
}

/**
 * The package a Play listing URL is for, or null when it is not one:
 * `https://play.google.com/store/apps/details?id=<package>`.
 */
function playStoreUrlPackage(value) {
  const url = parsePlayUrl(value);
  if (!url) return null;
  if (url.pathname !== "/store/apps/details" && url.pathname !== "/store/apps/details/") return null;
  const id = url.searchParams.get("id");
  return isValidPackageName(id) ? id : null;
}

/** The testing group an app's testers join: its assigned group, else the official one. */
function appGroupId(app) {
  const id = app && typeof app.activeGroupId === "string" && app.activeGroupId ? app.activeGroupId : null;
  return id || OFFICIAL_GROUP_ID;
}

/**
 * A fingerprint of exactly what a developer confirms. A confirmation whose
 * fingerprint no longer matches the app is outdated.
 */
function setupFingerprint(app) {
  const facts = {
    packageName: trimmed(app && app.packageName),
    closedTestingUrl: trimmed(app && app.closedTestingUrl),
    playStoreUrl: trimmed(app && app.playStoreUrl),
    groupId: appGroupId(app),
  };
  return crypto.createHash("sha256").update(JSON.stringify(facts)).digest("hex");
}

/**
 * The setup facts the server can check, independent of approval and
 * confirmation. Returns the gaps; empty means the links are usable.
 */
function checkSetupFields(app) {
  const gaps = [];
  const pkg = trimmed(app && app.packageName);
  if (!isValidPackageName(pkg)) gaps.push(READINESS.INVALID_PACKAGE);

  const optIn = trimmed(app && app.closedTestingUrl);
  if (!optIn) {
    gaps.push(READINESS.MISSING_OPT_IN_URL);
  } else {
    const forPkg = optInUrlPackage(optIn);
    if (!forPkg || (isValidPackageName(pkg) && forPkg !== pkg)) gaps.push(READINESS.INVALID_OPT_IN_URL);
  }

  // Optional - but a listing URL that is present must be right.
  const store = trimmed(app && app.playStoreUrl);
  if (store) {
    const forPkg = playStoreUrlPackage(store);
    if (!forPkg || (isValidPackageName(pkg) && forPkg !== pkg)) gaps.push(READINESS.INVALID_PLAY_STORE_URL);
  }
  return gaps;
}

/**
 * Is this app ready for testers? Every gap is reported, not just the first,
 * so a developer sees the whole checklist.
 *
 * @param {object|null} app  the stored app document
 * @returns {{ready: boolean, gaps: string[], confirmed: boolean}}
 */
function checkAppReadiness(app) {
  if (!app) return { ready: false, gaps: [READINESS.NOT_APPROVED], confirmed: false };
  const gaps = [];
  if (app.status !== "approved") gaps.push(READINESS.NOT_APPROVED);
  gaps.push(...checkSetupFields(app));

  const c = app[SETUP_CONFIRMATION_FIELD];
  const hasConfirmation = Boolean(
    c && typeof c === "object" &&
      c.kind === SETUP_CONFIRMATION_KIND &&
      typeof c.confirmedBy === "string" &&
      c.confirmedBy === app.ownerId &&
      typeof c.fingerprint === "string",
  );
  let confirmed = false;
  if (!hasConfirmation) {
    gaps.push(READINESS.NOT_CONFIRMED);
  } else if (c.fingerprint !== setupFingerprint(app)) {
    gaps.push(READINESS.CONFIRMATION_OUTDATED);
  } else {
    confirmed = true;
  }
  return { ready: gaps.length === 0, gaps, confirmed };
}

/**
 * May the developer self-confirm this app's setup now?
 *
 * They must own it, it must not be rejected or archived, the setup fields
 * must be checkable-correct, and they must actively confirm BOTH statements -
 * a missing or non-true flag is a refusal, never a default.
 */
function checkConfirmSetup({ callerId, app, closedTestConfigured, googleGroupAdded }) {
  if (!app) return { ok: false, code: "not-found", reason: "appMissing", message: "That app does not exist." };
  if (!callerId || app.ownerId !== callerId) {
    return { ok: false, code: "permission-denied", reason: "notOwner", message: "Only the app's developer can confirm its setup." };
  }
  if (app.status === "rejected" || app.status === "archived") {
    return { ok: false, code: "failed-precondition", reason: "appClosed", message: "This app is not accepting testers." };
  }
  if (closedTestConfigured !== true || googleGroupAdded !== true) {
    return {
      ok: false,
      code: "invalid-argument",
      reason: "confirmationIncomplete",
      message: "Confirm both that your closed test is set up and that the AppTesting group is added to it.",
    };
  }
  const gaps = checkSetupFields(app);
  if (gaps.length > 0) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "setupIncomplete",
      gaps,
      message: "Fix your app's testing links before confirming the setup.",
    };
  }
  return { ok: true };
}

/**
 * The join prerequisites, checked AFTER the existing claim rules (suspension,
 * approval, own-app, duplicates, coins, capacity) have passed. Pure: every
 * input is read server-side by the caller, inside the claim transaction.
 */
function checkJoinPrerequisites({ targetApp, ownApps, hasGroupMembership }) {
  const target = checkAppReadiness(targetApp);
  if (!target.ready) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "targetNotReady",
      gaps: target.gaps,
      message: "That app's testing setup isn't ready yet.",
    };
  }
  const readyOwn = (ownApps || []).some((app) => checkAppReadiness(app).ready);
  if (!readyOwn) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "noEligibleOwnApp",
      message: "Get one of your own apps approved and its testing setup confirmed before you join.",
    };
  }
  if (hasGroupMembership !== true) {
    return {
      ok: false,
      code: "failed-precondition",
      reason: "groupNotJoined",
      message: "Join the AppTesting Google Group (and confirm you did) before you join.",
    };
  }
  return { ok: true };
}

module.exports = {
  SETUP_CONFIRMATION_FIELD,
  SETUP_CONFIRMATION_KIND,
  READINESS,
  isValidPackageName,
  optInUrlPackage,
  playStoreUrlPackage,
  appGroupId,
  setupFingerprint,
  checkSetupFields,
  checkAppReadiness,
  checkConfirmSetup,
  checkJoinPrerequisites,
};

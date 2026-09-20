/**
 * AppTesting Cloud Functions.
 *
 * Deployed in asia-south2, matching the default Firestore database location.
 *
 * SECURITY MODEL
 * Firestore rules refuse every privileged client write — app approval status,
 * user suspension, group documents, assignment creation. Those operations
 * exist only as callable functions here, which run with Admin SDK credentials
 * and re-verify the caller's identity and role on every invocation. A client
 * boolean or a hidden UI control is never treated as authorization.
 */

const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
const { REGION } = require("./lib/constants");

admin.initializeApp();
setGlobalOptions({ region: REGION });

const adminOps = require("./admin");
const groups = require("./groups");
const assignments = require("./assignments");
const completion = require("./completion");
const wallet = require("./wallet");
const quickTests = require("./quickTests");

// Admin-only callables.
exports.adminSetAppStatus = adminOps.adminSetAppStatus;
exports.adminSetUserSuspended = adminOps.adminSetUserSuspended;
exports.adminUpsertGroup = adminOps.adminUpsertGroup;
exports.adminVerifyAssignment = completion.adminVerifyAssignment;
exports.adminRefreshQuickTestPool = quickTests.adminRefreshQuickTestPool;

// Testing Coin wallet — a commitment device, not a reward system. Coins are
// staked on an assignment and returned on success; there is no payout path
// here, and `adminGrantCoins` issues PLAY MONEY for the pre-payment pilot.
// `adminReconcileWallet` is read-only: it reports drift, it never repairs.
exports.adminGrantCoins = wallet.adminGrantCoins;
exports.adminReconcileWallet = wallet.adminReconcileWallet;

// Group membership.
exports.joinGroup = groups.joinGroup;
exports.syncGroupMemberCount = groups.syncGroupMemberCount;

// Testing assignments.
exports.createTestingAssignments = assignments.createTestingAssignments;
exports.syncAssignmentProgress = assignments.syncAssignmentProgress;

// Quick Tests — discovery sessions, entirely outside the coin economy.
exports.startQuickTest = quickTests.startQuickTest;
exports.completeQuickTest = quickTests.completeQuickTest;
exports.refreshQuickTestPool = quickTests.refreshQuickTestPool;

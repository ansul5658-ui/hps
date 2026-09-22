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
const commitments = require("./commitments");
const testingDays = require("./testingDays");
const expiry = require("./expiry");
const systemHealth = require("./systemHealth");
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

// Testing assignments. `previewEligibleTesters` is READ-ONLY: it reports who
// could claim an app and creates nothing. The old `createTestingAssignments`
// callable, which pushed assignments onto testers without a coin commitment,
// is gone — see the note at the top of assignments.js.
exports.previewEligibleTesters = assignments.previewEligibleTesters;

// Commitment lifecycle — claim locks coins, completion returns the SAME coins,
// an expired short commitment forfeits them. No reward at any point.
// `adminForfeitCommitment` is admin-only AND still refuses unless the window
// has genuinely elapsed with the requirement unmet.
exports.joinTestingAssignment = commitments.joinTestingAssignment;
exports.adminForfeitCommitment = commitments.adminForfeitCommitment;

// The 14-day testing engine. `recordTestingDay` is the ONLY writer of
// `testingLogs` — rules refuse every client write to that collection — and it
// completes the commitment, returning the staked coins, in the same
// transaction as the fourteenth qualifying day.
//
// `syncAssignmentProgress` was retired here: it was a testingLogs trigger that
// recomputed `qualifyingDays` from a count. With the check-in transaction
// maintaining that field itself, a second writer would be a race with no
// upside — and "qualifyingDays is server-authoritative" is only meaningful
// with exactly one authority.
exports.recordTestingDay = testingDays.recordTestingDay;

// Automatic expiry. `evaluateExpiredCommitments` is the ONLY scheduled writer
// of money in this project, and it deliberately owns none of the arithmetic:
// it selects candidates and hands each to `runForfeitCommitment`, the same
// transaction the admin callable uses. Forfeiture is keyed to the assignment
// (`forfeit_{assignmentId}`, written with `tx.create`), so a retried run, an
// overlapping run and a manual sweep all converge on exactly one settlement.
//
// `adminEvaluateExpiry` is READ-ONLY: it answers "would this be forfeited, and
// why" without the permission to make it so.
exports.evaluateExpiredCommitments = expiry.evaluateExpiredCommitments;
exports.adminEvaluateExpiry = expiry.adminEvaluateExpiry;
exports.adminRunExpirySweep = expiry.adminRunExpirySweep;

// Declared service outages — `systemHealth/{yyyy-MM-dd}`, admin-only. A
// declared day extends every affected commitment's window, which is exactly
// what a tester would forge to escape a commitment they were about to fail, so
// rules refuse every client write and this callable re-verifies the admin role
// on each invocation. Declaring a day writes NOTHING to any assignment: the
// extension is derived at evaluation time, so declaring late, twice, or after
// some commitments were already evaluated is safe.
exports.adminDeclareOutage = systemHealth.adminDeclareOutage;

// Quick Tests — discovery sessions, entirely outside the coin economy.
exports.startQuickTest = quickTests.startQuickTest;
exports.completeQuickTest = quickTests.completeQuickTest;
exports.refreshQuickTestPool = quickTests.refreshQuickTestPool;

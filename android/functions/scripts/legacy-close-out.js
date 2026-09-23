#!/usr/bin/env node
/**
 * Operator script: retire the two reward-era TEST assignments.
 *
 *   node scripts/legacy-close-out.js --project apptesting-a64aa --admin-uid <uid>          # dry run
 *   node scripts/legacy-close-out.js --project apptesting-a64aa --admin-uid <uid> --apply  # write
 *
 * DRY RUN IS THE DEFAULT. Without `--apply` it reads each assignment, reports
 * whether it would be closed, and writes nothing.
 *
 * Credentials are the operator's own Application Default Credentials (e.g.
 * `gcloud auth application-default login`, or GOOGLE_APPLICATION_CREDENTIALS).
 * This script never reads, prints or stores a credential.
 *
 * It touches only the assignment ids in `lib/legacyCloseOut.js`. It moves no
 * coins and writes no wallet or ledger document - see `legacyCloseOut.js`.
 */

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");

const { runLegacyCloseOut } = require("../legacyCloseOut");
const {
  LEGACY_CLOSE_OUT_ASSIGNMENT_IDS,
  checkLegacyCloseOutEligible,
} = require("../lib/legacyCloseOut");

const EXPECTED_PROJECT = "apptesting-a64aa";

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

async function main() {
  const project = arg("--project");
  const adminUid = arg("--admin-uid");
  const apply = process.argv.includes("--apply");
  const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

  // The project must be named explicitly - there is no .firebaserc default to
  // fall back on, and guessing is how a script lands on the wrong database.
  if (!emulator && project !== EXPECTED_PROJECT) {
    throw new Error(`Refusing to run: pass --project ${EXPECTED_PROJECT} explicitly.`);
  }
  if (!adminUid) throw new Error("Refusing to run: --admin-uid is required.");

  if (!admin.apps.length) admin.initializeApp({ projectId: project });
  const db = getFirestore();

  console.log(`target: ${emulator ? "EMULATOR" : project}  mode: ${apply ? "APPLY" : "dry run"}`);

  for (const assignmentId of LEGACY_CLOSE_OUT_ASSIGNMENT_IDS) {
    const label = assignmentId.slice(0, 26) + "…";
    if (!apply) {
      const snap = await db.doc(`testingAssignments/${assignmentId}`).get();
      const verdict = checkLegacyCloseOutEligible({
        assignmentId,
        data: snap.exists ? snap.data() : null,
      });
      const status = snap.exists ? snap.get("status") : "(missing)";
      const says = verdict.ok
        ? "WOULD CLOSE"
        : verdict.alreadyClosed
          ? "already closed"
          : `REFUSED: ${verdict.message}`;
      console.log(`  ${label}  status=${status}  ${says}`);
      continue;
    }
    const outcome = await runLegacyCloseOut(db, { assignmentId, adminUid });
    console.log(
      `  ${label}  ` +
        (outcome.closed
          ? `closed (was ${outcome.previousStatus}; claim removed: ${outcome.claimRemoved})`
          : `no-op (${outcome.reason})`),
    );
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err.message}`);
  process.exitCode = 1;
});

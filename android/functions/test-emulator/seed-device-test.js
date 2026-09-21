/**
 * Seeds the local Firebase Emulator Suite for the physical-device smoke test.
 *
 * EMULATOR ONLY. It refuses to run unless FIRESTORE_EMULATOR_HOST is set, so
 * it cannot be pointed at production by accident.
 *
 * It deliberately seeds only the PRECONDITIONS for a commitment — a funded
 * wallet and an approved app owned by someone else. It does NOT create the
 * assignment: that is done by driving the real `joinTestingAssignment`
 * callable from the phone, so the pinned timezone and 18-day window under test
 * are the ones production code actually writes, not ones a fixture invented.
 *
 * Usage:
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
 *   FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
 *   node test-emulator/seed-device-test.js [--coins 50] [--advance-to 13]
 *
 * `--advance-to N` backdates the pinned window and inserts N-1 qualifying days
 * so the next real check-in from the phone is the Nth. That is how the day-14
 * UI path is exercised without waiting 14 days. It writes only through the
 * same fields the server owns, and the final day is still recorded by the real
 * callable — nothing about the settlement itself is faked.
 */

const admin = require("firebase-admin");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is not set — refusing to run outside the emulator.");
}

const PROJECT_ID = process.env.GCLOUD_PROJECT || "apptesting-a64aa";
const DEV_ID = "seed_developer";
const APP_ID = "seed_app_chronos";

const args = process.argv.slice(2);
function argOf(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
}
const COINS = Number(argOf("--coins", 50));
const ADVANCE_TO = Number(argOf("--advance-to", 0));

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

const {
  deriveWindow,
  addDays,
  dayKeyInZone,
  startOfLocalDayMillis,
  testingLogId,
} = require("../lib/testingDays");
const { lockEntryId } = require("../lib/commitments");

async function main() {
  // The phone signs in anonymously against the Auth emulator; find that user.
  const list = await auth.listUsers(50);
  if (list.users.length === 0) {
    throw new Error("No users in the Auth emulator — sign in on the phone first.");
  }
  const user = list.users.sort(
    (a, b) => Date.parse(b.metadata.creationTime) - Date.parse(a.metadata.creationTime),
  )[0];
  const uid = user.uid;
  console.log(`tester uid: ${uid} (anonymous=${!user.email})`);

  // A developer and an approved app the tester does not own.
  await db.doc(`users/${DEV_ID}`).set({ uid: DEV_ID, displayName: "Seed Developer" });
  await db.doc(`apps/${APP_ID}`).set({
    ownerId: DEV_ID,
    appName: "Chronos",
    packageName: "com.seed.chronos",
    description: "Seeded for the physical-device testing-day smoke test.",
    status: "approved",
    testerCount: 0,
    completedTesterCount: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Fund the wallet exactly as adminGrantCoins would: an adjustment entry plus
  // a wallet that satisfies available+locked+forfeited == purchased+adjustment.
  const entryId = "grant_deviceseed";
  await db.doc(`users/${uid}/coinTransactions/${entryId}`).set({
    userId: uid,
    kind: "adjustment",
    source: "adminGrant",
    deltaAvailable: COINS,
    deltaLocked: 0,
    deltaForfeited: 0,
    amount: COINS,
    reason: "Device smoke-test seed (emulator only)",
    assignmentId: null,
    appId: null,
    paymentRef: null,
    actorId: "seed-script",
    actorKind: "system",
    idempotencyKey: "deviceseed",
    schemaVersion: 2,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await db.doc(`users/${uid}/wallet/balance`).set({
    available: COINS,
    locked: 0,
    forfeitedTotal: 0,
    purchasedTotal: 0,
    adjustmentNet: COINS,
    ledgerCount: 1,
    lastEntryId: entryId,
    schemaVersion: 2,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  console.log(`seeded app ${APP_ID} and a wallet with available=${COINS}`);

  if (ADVANCE_TO > 1) {
    await advance(uid, ADVANCE_TO);
  }
  console.log("done");
}

/**
 * Backdate an existing commitment so the next real check-in is day N.
 *
 * Only reachable after the phone has claimed, because it needs the assignment
 * the real callable created. It rewrites the pinned window backwards and adds
 * N-1 logs; the Nth day is still recorded by `recordTestingDay` itself.
 */
async function advance(uid, targetDay) {
  const snap = await db
    .collection("testingAssignments")
    .where("testerId", "==", uid)
    .where("status", "in", ["ready", "inProgress"])
    .get();
  if (snap.empty) {
    console.log("no live assignment yet — claim on the phone first, then re-run with --advance-to");
    return;
  }
  const doc = snap.docs[0];
  const tz = doc.get("timeZone");
  const todayKey = dayKeyInZone(Date.now(), tz);

  // Put day 1 far enough back that today is day `targetDay`.
  const firstEligibleDayKey = addDays(todayKey, -(targetDay - 1));
  const claimedDayKey = addDays(firstEligibleDayKey, -1);
  const windowDays = doc.get("windowDays") || 18;
  const lastEligibleDayKey = addDays(firstEligibleDayKey, windowDays - 1);

  const batch = db.batch();
  batch.update(doc.ref, {
    claimedDayKey,
    firstEligibleDayKey,
    lastEligibleDayKey,
    windowEndsAt: admin.firestore.Timestamp.fromMillis(
      startOfLocalDayMillis(addDays(lastEligibleDayKey, 1), tz),
    ),
    qualifyingDays: targetDay - 1,
    daysCompleted: targetDay - 1,
    status: "inProgress",
    lastQualifyingDayKey: addDays(todayKey, -1),
  });
  for (let i = 0; i < targetDay - 1; i += 1) {
    const key = addDays(firstEligibleDayKey, i);
    batch.set(db.doc(`testingLogs/${testingLogId(doc.id, key)}`), {
      assignmentId: doc.id,
      cycle: doc.get("cycle"),
      appId: doc.get("appId"),
      testerId: uid,
      date: key,
      timeZone: tz,
      createdAt: admin.firestore.Timestamp.fromMillis(startOfLocalDayMillis(key, tz) + 3600000),
    });
  }
  await batch.commit();
  console.log(
    `advanced ${doc.id}: window ${firstEligibleDayKey}..${lastEligibleDayKey}, ` +
      `${targetDay - 1} days logged, today (${todayKey}) is day ${targetDay}`,
  );
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);

/**
 * Seeds the local Firebase Emulator Suite for the physical-device smoke test.
 *
 * EMULATOR ONLY. It refuses to run - or even to load - unless BOTH
 * FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST are set, so it
 * cannot be pointed at production by accident. The Auth host matters as much
 * as the Firestore one: the script lists Auth users to find the phone's, and
 * without the Auth emulator that would read PRODUCTION accounts.
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
 *   node test-emulator/seed-device-test.js --advance-only --advance-to 14
 *
 * `--advance-to N` backdates the pinned window and inserts N-1 qualifying days
 * so the next real check-in from the phone is the Nth. That is how the day-14
 * UI path is exercised without waiting 14 days. It writes only through the
 * same fields the server owns, and the final day is still recorded by the real
 * callable — nothing about the settlement itself is faked.
 */

const admin = require("firebase-admin");

// Both, checked before firebase-admin is initialized: firebase-admin sends each
// service to its emulator only when that service's own variable is set, so one
// without the other would quietly reach the real project.
const REQUIRED_EMULATOR_HOSTS = ["FIRESTORE_EMULATOR_HOST", "FIREBASE_AUTH_EMULATOR_HOST"];
const missingHosts = REQUIRED_EMULATOR_HOSTS.filter((name) => !process.env[name]);
if (missingHosts.length > 0) {
  throw new Error(`${missingHosts.join(" and ")} not set — refusing to run outside the emulators.`);
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
const ADVANCE_ONLY = args.includes("--advance-only");

admin.initializeApp({ projectId: PROJECT_ID });
const db = admin.firestore();
const auth = admin.auth();

const {
  deriveWindow,
  addDays,
  dayKeyInZone,
  startOfLocalDayMillis,
  nextCheckInAtMillis,
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

  // `--advance-only` moves an EXISTING commitment forward and seeds nothing.
  // This is the normal second step of the device workflow: seed once, claim on
  // the phone, then advance. By that point the wallet is holding a live stake,
  // so re-running the seeding below would be the exact corruption the guard
  // further down refuses.
  if (ADVANCE_ONLY) {
    if (!(ADVANCE_TO > 1)) {
      throw new Error("--advance-only requires --advance-to N (N > 1).");
    }
    await advance(uid, ADVANCE_TO);
    console.log("done (advance only — wallet and ledger untouched)");
    return;
  }

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

  // REFUSE to reseed a wallet that is holding a live stake.
  //
  // The wallet write below is an unconditional `set` to
  // `available: COINS, locked: 0`. Run against a wallet with coins locked
  // behind a live commitment, it silently erases the lock: the assignment
  // still carries its `lockTxId`, the lock ledger entry still exists, but the
  // wallet claims nothing is locked. That breaks
  // available+locked+forfeited == purchased+adjustment, and it breaks it
  // quietly - the next settlement then computes from a corrupt balance and the
  // invariant check aborts a transaction that had nothing wrong with it.
  //
  // Refusing is the right answer rather than "repair and continue". A fixture
  // that silently rearranges real settled state is exactly how a test starts
  // proving something other than what it claims.
  const walletSnap = await db.doc(`users/${uid}/wallet/balance`).get();
  const lockedNow = walletSnap.exists ? walletSnap.get("locked") || 0 : 0;
  if (lockedNow > 0) {
    throw new Error(
      `Refusing to reseed: ${uid} has ${lockedNow} coins locked behind a live ` +
        "commitment, and reseeding would erase that lock and break the wallet " +
        "invariant. Settle or cancel the commitment first, or re-run with " +
        "--advance-only, which never touches the wallet.",
    );
  }

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
 * The fields an `--advance-to N` rewrite must write, derived and nothing else.
 *
 * Pure, and separated from the Firestore work for the same reason `lib/` is
 * separated from the callables: this is day arithmetic that decides whether
 * the phone offers a check-in, and it should be testable without an emulator.
 *
 * THE CONSISTENCY THIS EXISTS TO GUARANTEE
 * `lastQualifyingDayKey`, `nextCheckInAt` and the seeded log days all describe
 * the same claim - "days 1..N-1 are done, day N is today and still open". They
 * were previously derived in three places in one `batch.update` and one of
 * them (`nextCheckInAt`) was simply not derived at all, which let the fixture
 * produce a state the product cannot reach: a UI showing "Logged today" with
 * no log for today. Deriving them together is what makes that unrepresentable.
 */
function advanceFields({ todayKey, targetDay, windowDays, timeZone }) {
  // Day 1 far enough back that today is day `targetDay`.
  const firstEligibleDayKey = addDays(todayKey, -(targetDay - 1));
  const claimedDayKey = addDays(firstEligibleDayKey, -1);
  const lastEligibleDayKey = addDays(firstEligibleDayKey, windowDays - 1);

  // Days 1..N-1 are logged; day N is today and is deliberately NOT logged,
  // because recording it is the thing under test.
  const logDayKeys = [];
  for (let i = 0; i < targetDay - 1; i += 1) {
    logDayKeys.push(addDays(firstEligibleDayKey, i));
  }

  // The last day actually logged is yesterday, so the check-in boundary is the
  // start of today - already in the past, which is what "you may check in now"
  // means to `hasLoggedTodayAt`.
  const lastQualifyingDayKey = addDays(todayKey, -1);

  return {
    firstEligibleDayKey,
    claimedDayKey,
    lastEligibleDayKey,
    lastQualifyingDayKey,
    logDayKeys,
    nextCheckInAtMillis: nextCheckInAtMillis(lastQualifyingDayKey, timeZone),
    windowEndsAtMillis: startOfLocalDayMillis(addDays(lastEligibleDayKey, 1), timeZone),
  };
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

  const windowDays = doc.get("windowDays") || 18;
  const {
    firstEligibleDayKey,
    claimedDayKey,
    lastEligibleDayKey,
    lastQualifyingDayKey,
    nextCheckInAtMillis: nextCheckInMillis,
    windowEndsAtMillis,
    logDayKeys,
  } = advanceFields({ todayKey, targetDay, windowDays, timeZone: tz });

  const batch = db.batch();
  batch.update(doc.ref, {
    claimedDayKey,
    firstEligibleDayKey,
    lastEligibleDayKey,
    windowEndsAt: admin.firestore.Timestamp.fromMillis(windowEndsAtMillis),
    qualifyingDays: targetDay - 1,
    daysCompleted: targetDay - 1,
    status: "inProgress",
    lastQualifyingDayKey,
    // MUST move with the window, and this is the field the UI actually gates
    // the check-in button on.
    //
    // It used to be left alone here, which produced a fixture state no real
    // run can reach: `lastQualifyingDayKey` said yesterday while
    // `nextCheckInAt` still pointed past today's midnight, left over from a
    // check-in performed before the advance. The phone therefore rendered
    // "Logged today" on a day with no testing log, and the only way to find
    // out the button was lying was to call the server anyway. A fixture whose
    // whole purpose is to reproduce a real day-N state must not invent a state
    // the product cannot produce.
    //
    // The last qualifying day is `todayKey - 1`, so the next check-in opens at
    // the start of `todayKey` - which is in the past, which is exactly what
    // "you may check in now" means to `hasLoggedTodayAt`.
    nextCheckInAt: admin.firestore.Timestamp.fromMillis(nextCheckInMillis),
  });
  const seededKeys = new Set(logDayKeys);
  for (const key of logDayKeys) {
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

  // Drop any log this advance did not seed - in practice a log for TODAY left
  // behind by a real check-in performed before the advance.
  //
  // Without this the fixture contradicts itself in the other direction: the
  // assignment says day N is still to come, but a log for today already
  // exists, so the real callable correctly reports `alreadyLogged` and the
  // day-N path being set up can never be reached. Counting logs is how the
  // server decides settlement, so a stale one is not cosmetic - it is a wrong
  // qualifying-day count.
  const existingLogs = await db
    .collection("testingLogs")
    .where("assignmentId", "==", doc.id)
    .get();
  let dropped = 0;
  for (const log of existingLogs.docs) {
    if (!seededKeys.has(log.get("date"))) {
      batch.delete(log.ref);
      dropped += 1;
    }
  }

  await batch.commit();
  if (dropped > 0) {
    console.log(`  dropped ${dropped} log(s) outside the simulated window`);
  }
  console.log(
    `advanced ${doc.id}: window ${firstEligibleDayKey}..${lastEligibleDayKey}, ` +
      `${targetDay - 1} days logged, today (${todayKey}) is day ${targetDay}`,
  );
}

// Only run when invoked as a script, so the pure helper above can be unit
// tested without the seeding side effects firing on import.
if (require.main === module) {
  main().then(
    () => process.exit(0),
    (err) => {
      console.error(err);
      process.exit(1);
    },
  );
}

module.exports = { advanceFields };

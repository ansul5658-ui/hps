/**
 * Quick Tests against a REAL Firestore.
 *
 * Same reasoning as completion.concurrency.test.js: a hand-written fake can
 * only prove the code agrees with my model of Firestore. These tests run the
 * production functions against the emulator, so real transaction contention,
 * real `tx.create` semantics and real `FieldValue.increment` are exercised.
 *
 * The property that matters most here is the daily limit. It is enforced by
 * READING a counter document inside the transaction — that read is what locks
 * it and serializes concurrent attempts. An aggregate count() over the
 * sessions collection would not do this, because a count query inside a
 * transaction does not lock the documents it matched. Only a real Firestore
 * can tell the two apart, which is why this file exists.
 *
 * Run with:
 *   firebase emulators:exec --only firestore --project apptesting-concurrency-test \
 *     "npm --prefix functions run test:emulator"
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const {
  runStartQuickTest,
  startQuickTestSession,
  runCompleteQuickTest,
  completeQuickTestSession,
  runPoolRefresh,
} = require("../quickTests");
const { quickTestSessionId } = require("../lib/quickTests");

const PROJECT_ID = "apptesting-concurrency-test";
const TESTER = "tester1";
const OWNER = "dev1";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.",
  );
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();

// ---------------------------------------------------------------------------
// Emulator helpers
// ---------------------------------------------------------------------------

async function clearFirestore() {
  const url =
    "http://" + process.env.FIRESTORE_EMULATOR_HOST +
    "/emulator/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to clear emulator: " + res.status);
}

const dayKey = (millis) => new Date(millis).toISOString().slice(0, 10);
const NOW = Date.parse("2026-09-20T10:00:00Z");
const TODAY = dayKey(NOW);

/**
 * Seeds the shape production actually has: the tester document carries no
 * `isSuspended`, because nothing has ever written one.
 */
async function seed({
  apps = [{ appId: "app1", status: "approved", quickTestEnabled: true, ownerId: OWNER }],
  tester = { uid: TESTER },
  adminDoc = { uid: "admin1", role: "admin" },
} = {}) {
  const batch = db.batch();
  batch.set(db.doc("users/" + TESTER), tester);
  batch.set(db.doc("users/admin1"), adminDoc);
  batch.set(db.doc("users/" + OWNER), { uid: OWNER });
  for (const app of apps) {
    const { appId, ...fields } = app;
    batch.set(db.doc("apps/" + appId), {
      appName: appId,
      packageName: "com." + appId,
      ...fields,
    });
  }
  await batch.commit();
}

/** Full post-condition snapshot — what "exactly once" is measured on. */
async function observe(uid = TESTER, day = TODAY) {
  const [sessions, counter, markers, assignments, logs, user] = await Promise.all([
    db.collection("quickTestSessions").get(),
    db.doc("users/" + uid + "/quickTestDays/" + day).get(),
    db.collection("users/" + uid + "/quickTestApps").get(),
    db.collection("testingAssignments").get(),
    db.collection("testingLogs").get(),
    db.doc("users/" + uid).get(),
  ]);
  return {
    sessionIds: sessions.docs.map((d) => d.id).sort(),
    sessionCount: sessions.size,
    sessionDocs: sessions.docs.map((d) => d.data()),
    dailyCount: counter.exists ? counter.get("count") : 0,
    markerIds: markers.docs.map((d) => d.id).sort(),
    assignmentCount: assignments.size,
    logCount: logs.size,
    coinBalance: user.get("coinBalance"),
    ledgerless: user.data(),
  };
}

async function settled(promises) {
  const results = await Promise.allSettled(promises);
  return {
    started: results.filter((r) => r.status === "fulfilled" && r.value.started),
    noops: results.filter((r) => r.status === "fulfilled" && !r.value.started),
    rejected: results.filter((r) => r.status === "rejected"),
  };
}

const start = (appId = "app1", uid = TESTER, now = NOW) =>
  runStartQuickTest(db, { uid, appId, now });

test.beforeEach(clearFirestore);
test.after(async () => {
  await Promise.all(admin.apps.map((app) => app && app.delete()));
});

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test("a first Quick Test creates exactly one session, counter and marker", async () => {
  await seed();
  const result = await start();

  assert.equal(result.started, true);
  assert.equal(result.sessionId, quickTestSessionId(TESTER, "app1", TODAY));
  assert.equal(result.remainingToday, 4);

  const after = await observe();
  assert.equal(after.sessionCount, 1);
  assert.equal(after.dailyCount, 1);
  assert.deepEqual(after.markerIds, ["app1"]);

  const session = after.sessionDocs[0];
  assert.equal(session.uid, TESTER);
  assert.equal(session.appId, "app1");
  assert.equal(session.dayKey, TODAY);
  assert.ok(session.openedAt, "openedAt must be stamped by the server");
  assert.equal(session.completedAt, null);
});

// ---------------------------------------------------------------------------
// The containment guarantee — this is the point of the whole feature
// ---------------------------------------------------------------------------

test("a Quick Test creates no testingAssignment, no testingLog and no coins", async () => {
  await seed();
  await start();

  const after = await observe();
  assert.equal(after.assignmentCount, 0, "must never create an assignment");
  assert.equal(after.logCount, 0, "must never create a qualifying testing log");
  assert.equal(after.coinBalance, undefined, "must never touch the coin balance");

  const ledger = await db.collection("users/" + TESTER + "/coinTransactions").get();
  assert.equal(ledger.size, 0, "must never write a coin ledger entry");
});

test("a session document carries no assignmentId field at all", async () => {
  // Structural, not cosmetic: the absence of this field is what makes it
  // impossible for a Quick Test to be mistaken for commitment progress.
  await seed();
  await start();
  const after = await observe();
  assert.ok(
    !Object.prototype.hasOwnProperty.call(after.sessionDocs[0], "assignmentId"),
    "a quickTestSession must not carry an assignmentId",
  );
});

// ---------------------------------------------------------------------------
// Idempotency and concurrency
// ---------------------------------------------------------------------------

test("two simultaneous starts for one app create exactly one session", async () => {
  await seed();
  const outcome = await settled([start(), start()]);

  assert.equal(outcome.started.length, 1);
  assert.equal(outcome.rejected.length, 0);

  const after = await observe();
  assert.equal(after.sessionCount, 1);
  assert.equal(after.dailyCount, 1, "the counter must not double-count");
});

test("five simultaneous starts for one app still create exactly one session", async () => {
  await seed();
  const outcome = await settled([start(), start(), start(), start(), start()]);

  assert.equal(outcome.started.length, 1);
  const after = await observe();
  assert.equal(after.sessionCount, 1);
  assert.equal(after.dailyCount, 1);
});

test("exactly-once holds across 10 independent concurrent races", async () => {
  for (let round = 0; round < 10; round += 1) {
    await clearFirestore();
    await seed();
    const outcome = await settled([start(), start(), start()]);
    assert.equal(outcome.started.length, 1, "round " + round);
    const after = await observe();
    assert.equal(after.sessionCount, 1, "round " + round);
    assert.equal(after.dailyCount, 1, "round " + round);
  }
});

test("a repeat start on the same day is a no-op, not an error", async () => {
  await seed();
  await start();
  const again = await start();

  assert.equal(again.started, false);
  assert.equal(again.reason, "alreadyToday");
  const after = await observe();
  assert.equal(after.sessionCount, 1);
  assert.equal(after.dailyCount, 1);
});

test("the same app on a later day is a new session, and the counter is per day", async () => {
  await seed({
    apps: [{ appId: "app1", status: "approved", quickTestEnabled: true, ownerId: OWNER }],
  });
  await start("app1", TESTER, NOW);

  // 8 days on, past the 7-day cooldown.
  const later = NOW + 8 * 86400000;
  const result = await start("app1", TESTER, later);
  assert.equal(result.started, true);

  const sessions = await db.collection("quickTestSessions").get();
  assert.equal(sessions.size, 2);
  const todayCounter = await db.doc("users/" + TESTER + "/quickTestDays/" + TODAY).get();
  const laterCounter = await db
    .doc("users/" + TESTER + "/quickTestDays/" + dayKey(later))
    .get();
  assert.equal(todayCounter.get("count"), 1);
  assert.equal(laterCounter.get("count"), 1, "a new day starts a new counter");
});

// ---------------------------------------------------------------------------
// The daily limit
// ---------------------------------------------------------------------------

test("five Quick Tests succeed and the sixth is refused", async () => {
  await seed({
    apps: Array.from({ length: 6 }, (_, i) => ({
      appId: "app" + i,
      status: "approved",
      quickTestEnabled: true,
      ownerId: OWNER,
    })),
  });

  for (let i = 0; i < 5; i += 1) {
    const result = await start("app" + i);
    assert.equal(result.started, true, "app" + i + " must succeed");
    assert.equal(result.remainingToday, 4 - i);
  }

  await assert.rejects(() => start("app5"), /all 5 Quick Tests/);

  const after = await observe();
  assert.equal(after.sessionCount, 5);
  assert.equal(after.dailyCount, 5);
});

test("concurrent starts on six different apps cannot bypass the daily limit", async () => {
  // The headline concurrency property. Six distinct apps means six distinct
  // deterministic session ids, so tx.create cannot be what stops the sixth —
  // only the counter document lock can.
  await seed({
    apps: Array.from({ length: 6 }, (_, i) => ({
      appId: "app" + i,
      status: "approved",
      quickTestEnabled: true,
      ownerId: OWNER,
    })),
  });

  const outcome = await settled(
    Array.from({ length: 6 }, (_, i) => start("app" + i)),
  );

  assert.equal(outcome.started.length, 5, "exactly five may start");
  assert.equal(outcome.rejected.length, 1, "exactly one must be refused");

  const after = await observe();
  assert.equal(after.sessionCount, 5);
  assert.equal(after.dailyCount, 5);
});

test("ten concurrent starts on ten apps still admit exactly five", async () => {
  await seed({
    apps: Array.from({ length: 10 }, (_, i) => ({
      appId: "app" + i,
      status: "approved",
      quickTestEnabled: true,
      ownerId: OWNER,
    })),
  });

  const outcome = await settled(
    Array.from({ length: 10 }, (_, i) => start("app" + i)),
  );

  assert.equal(outcome.started.length, 5);
  assert.equal(outcome.rejected.length, 5);
  const after = await observe();
  assert.equal(after.sessionCount, 5);
  assert.equal(after.dailyCount, 5);
});

test("the limit resets the next day", async () => {
  await seed({
    apps: Array.from({ length: 6 }, (_, i) => ({
      appId: "app" + i,
      status: "approved",
      quickTestEnabled: true,
      ownerId: OWNER,
    })),
  });
  for (let i = 0; i < 5; i += 1) await start("app" + i);
  await assert.rejects(() => start("app5"));

  const tomorrow = NOW + 86400000;
  const result = await start("app5", TESTER, tomorrow);
  assert.equal(result.started, true);
  assert.equal(result.remainingToday, 4);
});

// ---------------------------------------------------------------------------
// The cooldown
// ---------------------------------------------------------------------------

test("the same app is refused inside the 7-day cooldown and allowed on day 7", async () => {
  await seed();
  await start("app1", TESTER, NOW);

  for (const daysLater of [1, 3, 6]) {
    await assert.rejects(
      () => start("app1", TESTER, NOW + daysLater * 86400000),
      /Quick Tested this app recently/,
      "day " + daysLater + " must still be cooling down",
    );
  }

  const day7 = await start("app1", TESTER, NOW + 7 * 86400000);
  assert.equal(day7.started, true);
});

test("a cooldown on one app does not block a different app", async () => {
  await seed({
    apps: [
      { appId: "app1", status: "approved", quickTestEnabled: true, ownerId: OWNER },
      { appId: "app2", status: "approved", quickTestEnabled: true, ownerId: OWNER },
    ],
  });
  await start("app1");
  const other = await start("app2");
  assert.equal(other.started, true);
});

test("the cooldown marker records the last day and a running count", async () => {
  await seed();
  await start("app1", TESTER, NOW);
  await start("app1", TESTER, NOW + 7 * 86400000);

  const marker = await db.doc("users/" + TESTER + "/quickTestApps/app1").get();
  assert.equal(marker.get("lastSessionDayKey"), dayKey(NOW + 7 * 86400000));
  assert.equal(marker.get("sessionCount"), 2);
});

// ---------------------------------------------------------------------------
// Eligibility, against real documents
// ---------------------------------------------------------------------------

test("a suspended tester is refused and leaves no trace at all", async () => {
  await seed({ tester: { uid: TESTER, isSuspended: true } });
  await assert.rejects(() => start(), /suspended/);

  const after = await observe();
  assert.equal(after.sessionCount, 0);
  assert.equal(after.dailyCount, 0);
  assert.equal(after.markerIds.length, 0);
});

test("an app with quickTestEnabled absent is refused", async () => {
  // The production shape: every app predating this feature has no such field.
  await seed({ apps: [{ appId: "app1", status: "approved", ownerId: OWNER }] });
  await assert.rejects(() => start(), /isn't offering Quick Tests/);
  assert.equal((await observe()).sessionCount, 0);
});

test("an app with quickTestEnabled false is refused", async () => {
  await seed({
    apps: [{ appId: "app1", status: "approved", quickTestEnabled: false, ownerId: OWNER }],
  });
  await assert.rejects(() => start(), /isn't offering Quick Tests/);
});

test("an unapproved app is refused even when quick tests are enabled", async () => {
  await seed({
    apps: [
      { appId: "app1", status: "pendingReview", quickTestEnabled: true, ownerId: OWNER },
    ],
  });
  await assert.rejects(() => start(), /isn't available for testing/);
});

test("a missing app is refused", async () => {
  await seed();
  await assert.rejects(() => start("nope"), /no longer exists/);
});

test("an owner cannot Quick Test their own app, and nothing is written", async () => {
  await seed({
    apps: [{ appId: "app1", status: "approved", quickTestEnabled: true, ownerId: TESTER }],
  });
  await assert.rejects(() => start(), /can't Quick Test your own app/);

  const after = await observe();
  assert.equal(after.sessionCount, 0);
  assert.equal(after.dailyCount, 0);
});

test("every refused start leaves no trace at all", async () => {
  await seed({
    apps: [{ appId: "disabled", status: "approved", ownerId: OWNER }],
    tester: { uid: TESTER },
  });
  await assert.rejects(() => start("disabled"));
  await assert.rejects(() => start("missing"));

  const after = await observe();
  assert.equal(after.sessionCount, 0);
  assert.equal(after.dailyCount, 0);
  assert.equal(after.markerIds.length, 0);
});

// ---------------------------------------------------------------------------
// Authorization wiring
// ---------------------------------------------------------------------------

test("an unauthenticated caller is rejected", async () => {
  await seed();
  await assert.rejects(
    () => startQuickTestSession(db, { data: { appId: "app1" } }),
    /must be signed in/i,
  );
  assert.equal((await observe()).sessionCount, 0);
});

test("a caller cannot supply the day key, timestamps or their own limit", async () => {
  await seed();
  const result = await startQuickTestSession(db, {
    auth: { uid: TESTER },
    data: {
      appId: "app1",
      dayKey: "1999-01-01",
      openedAt: 0,
      completedAt: Date.now(),
      dailyLimit: 9999,
      sessionsToday: 0,
      uid: "someone-else",
    },
  });

  assert.equal(result.started, true);
  const after = await observe();
  const session = after.sessionDocs[0];
  assert.equal(session.uid, TESTER, "uid comes from the token, not the payload");
  assert.notEqual(session.dayKey, "1999-01-01");
  assert.equal(session.completedAt, null, "completedAt is not caller-settable");
});

test("an invalid appId is rejected before any read", async () => {
  await seed();
  for (const bad of [undefined, "", "a/b", "..", null, 42]) {
    await assert.rejects(
      () => startQuickTestSession(db, { auth: { uid: TESTER }, data: { appId: bad } }),
      /"appId" is missing or invalid/,
    );
  }
});

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

test("completing a session stamps completedAt exactly once", async () => {
  await seed();
  await start();

  const first = await runCompleteQuickTest(db, { uid: TESTER, appId: "app1", now: NOW });
  assert.equal(first.completed, true);

  const second = await runCompleteQuickTest(db, { uid: TESTER, appId: "app1", now: NOW });
  assert.equal(second.completed, false);
  assert.equal(second.reason, "alreadyCompleted");

  const session = await db
    .doc("quickTestSessions/" + quickTestSessionId(TESTER, "app1", TODAY))
    .get();
  assert.ok(session.get("completedAt"));
});

test("five simultaneous completions stamp completedAt once", async () => {
  await seed();
  await start();
  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      runCompleteQuickTest(db, { uid: TESTER, appId: "app1", now: NOW }),
    ),
  );
  const completed = results.filter((r) => r.status === "fulfilled" && r.value.completed);
  assert.equal(completed.length, 1);
});

test("completing without starting is refused", async () => {
  await seed();
  await assert.rejects(
    () => runCompleteQuickTest(db, { uid: TESTER, appId: "app1", now: NOW }),
    /haven't started a Quick Test/,
  );
});

test("a note is length-capped and another user's session cannot be completed", async () => {
  await seed();
  await start();

  await assert.rejects(
    () =>
      completeQuickTestSession(db, {
        auth: { uid: TESTER },
        data: { appId: "app1", note: "x".repeat(501) },
      }),
    /too long/,
  );

  await assert.rejects(
    () => runCompleteQuickTest(db, { uid: "intruder", appId: "app1", now: NOW }),
    /haven't started a Quick Test/,
  );
});

test("completing a Quick Test still creates no assignment, log or coins", async () => {
  await seed();
  await start();
  await runCompleteQuickTest(db, { uid: TESTER, appId: "app1", now: NOW });

  const after = await observe();
  assert.equal(after.assignmentCount, 0);
  assert.equal(after.logCount, 0);
  assert.equal(after.coinBalance, undefined);
});

// ---------------------------------------------------------------------------
// The discovery pool
// ---------------------------------------------------------------------------

async function seedPoolApps(count, { enabled = true, status = "approved" } = {}) {
  const batch = db.batch();
  for (let i = 0; i < count; i += 1) {
    batch.set(db.doc("apps/pool" + i), {
      appName: "Pool " + i,
      ownerId: OWNER,
      status,
      quickTestEnabled: enabled,
      lastSurfacedAt: Timestamp.fromMillis(1000 + i),
    });
  }
  await batch.commit();
}

test("the pool holds 8 ids when 10 eligible apps exist", async () => {
  await seedPoolApps(10);
  const result = await runPoolRefresh(db, { now: NOW });

  assert.equal(result.poolSize, 8);
  assert.equal(result.candidates, 10);

  const pool = await db.doc("discovery/quickTestPool").get();
  assert.equal(pool.get("appIds").length, 8);
  assert.ok(pool.get("refreshedAt"));
});

test("the pool survives the client filtering out three apps and still shows five", async () => {
  await seedPoolApps(10);
  const { appIds } = await runPoolRefresh(db, { now: NOW });
  const afterClientFilter = appIds.slice(3);
  assert.ok(afterClientFilter.length >= 5, "at least 5 must survive filtering");
});

test("disabled and unapproved apps never reach the pool", async () => {
  await seedPoolApps(3);
  const batch = db.batch();
  batch.set(db.doc("apps/disabled1"), {
    ownerId: OWNER, status: "approved", quickTestEnabled: false,
  });
  batch.set(db.doc("apps/nofield1"), { ownerId: OWNER, status: "approved" });
  batch.set(db.doc("apps/pending1"), {
    ownerId: OWNER, status: "pendingReview", quickTestEnabled: true,
  });
  batch.set(db.doc("apps/archived1"), {
    ownerId: OWNER, status: "archived", quickTestEnabled: true,
  });
  await batch.commit();

  const { appIds } = await runPoolRefresh(db, { now: NOW });
  assert.deepEqual(appIds.sort(), ["pool0", "pool1", "pool2"]);
});

test("rotation moves the pool on between refreshes", async () => {
  await seedPoolApps(12);
  const first = await runPoolRefresh(db, { now: NOW });
  const second = await runPoolRefresh(db, { now: NOW + 3600000 });

  assert.equal(first.appIds.length, 8);
  assert.equal(second.appIds.length, 8);
  assert.notDeepEqual(
    first.appIds,
    second.appIds,
    "a second refresh must not return the identical pool",
  );
  // The four never surfaced in round one must lead round two.
  const skipped = ["pool8", "pool9", "pool10", "pool11"].filter(
    (id) => !first.appIds.includes(id),
  );
  for (const id of skipped) {
    assert.ok(second.appIds.includes(id), id + " should rotate in");
  }
});

test("refreshing stamps lastSurfacedAt on the selected apps only", async () => {
  await seedPoolApps(10);
  const { appIds } = await runPoolRefresh(db, { now: NOW });

  const selected = await db.doc("apps/" + appIds[0]).get();
  assert.equal(selected.get("lastSurfacedAt").toMillis(), NOW);

  const notSelected = ["pool0", "pool1", "pool2", "pool3", "pool4",
    "pool5", "pool6", "pool7", "pool8", "pool9"].find((id) => !appIds.includes(id));
  const untouched = await db.doc("apps/" + notSelected).get();
  assert.notEqual(untouched.get("lastSurfacedAt").toMillis(), NOW);
});

test("an empty catalogue produces an empty pool rather than an error", async () => {
  const result = await runPoolRefresh(db, { now: NOW });
  assert.deepEqual(result.appIds, []);
  const pool = await db.doc("discovery/quickTestPool").get();
  assert.deepEqual(pool.get("appIds"), []);
});

test("refreshing the pool creates no sessions, assignments, logs or coins", async () => {
  await seed();
  await seedPoolApps(10);
  await runPoolRefresh(db, { now: NOW });

  const after = await observe();
  assert.equal(after.sessionCount, 0);
  assert.equal(after.assignmentCount, 0);
  assert.equal(after.logCount, 0);
});

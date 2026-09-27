/**
 * The root cause of "Transaction is invalid or closed" (Batch 9G), reproduced
 * deterministically on a real emulator - see lib/firestore.js.
 *
 * A transactional read starved of its lock is aborted, and the server closes
 * its transaction. On the SDK's default transport the aborted read is then
 * RE-SENT, carrying the dead transaction's id; emulator v1.19.8 answers the
 * re-send `3 INVALID_ARGUMENT: Transaction is invalid or closed`, which
 * `runTransaction` will not retry. (v1.22.0 answers it with an ABORTED
 * "expired" message instead, which hides the re-send but does not remove it.)
 *
 * What these tests pin down is the re-send itself, which happens on every
 * emulator version: on the production transport every transactional read is
 * sent exactly once per transaction, the first error is the real ABORTED, and
 * `runTransaction` recovers with a fresh transaction.
 *
 * Run through `firebase emulators:exec` - see README.md.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const { Firestore } = require("@google-cloud/firestore");
const { configureFirestore } = require("../lib/firestore");
const { recordTransactionalReads, startLockStarvation } = require("./lockStarvation");

const PROJECT_ID = "apptesting-concurrency-test";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is not set — run this through `firebase emulators:exec`.",
  );
}

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID });
// The production transport (lib/firestore.js).
const db = configureFirestore(getFirestore());

async function clearFirestore() {
  const url =
    `http://${process.env.FIRESTORE_EMULATOR_HOST}` +
    `/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to clear emulator: ${res.status}`);
}

test.beforeEach(clearFirestore);
test.after(async () => {
  await Promise.all(admin.apps.map((app) => app && app.delete()));
});

/**
 * Starve one transaction's read of `probe/a_contended` and report what the
 * victim saw. [victimDb] is the client under test; the chain always runs on
 * the configured one.
 */
async function starveOneRead(victimDb, { maxAttempts }) {
  const contendedPath = "probe/a_contended";
  const heldPath = "probe/b_held";
  await db.doc(contendedPath).set({ n: 0 });
  await db.doc(heldPath).set({ n: 0 });

  const log = await recordTransactionalReads(victimDb, contendedPath);
  const chain = await startLockStarvation(db, { contendedPath, heldPath });
  const readErrors = [];
  let attempts = 0;
  let outcome;
  try {
    outcome = await victimDb
      .runTransaction(
        async (tx) => {
          attempts += 1;
          await tx.get(victimDb.doc("probe/victim_private")); // establishes the transaction id
          if (attempts === 1) await chain.at(chain.victimStartMs);
          try {
            await tx.get(victimDb.doc(contendedPath));
          } catch (err) {
            readErrors.push({ attempt: attempts, code: err.code, message: err.message });
            throw err;
          }
          tx.set(victimDb.doc("probe/victim_out"), { attempts });
        },
        { maxAttempts },
      )
      .then(
        () => ({ ok: true }),
        (err) => ({ ok: false, code: err.code, message: err.message }),
      );
  } finally {
    log.stop();
  }
  const committers = await chain.done();
  assert.ok(log.sawEveryClient(), "a read went through a GAPIC client the recorder did not wrap");
  return { outcome, attempts, readErrors, sends: [...log.sends.values()], errors: log.errors, committers };
}

test("9G root cause: on the production transport a starved read is sent once, fails ABORTED, and the transaction recovers", async (t) => {
  const r = await starveOneRead(db, { maxAttempts: 5 });
  t.diagnostic(`production transport: sends per transaction ${JSON.stringify(r.sends)}, read errors ${JSON.stringify(r.readErrors)}`);

  // The starvation really happened: every committer timed out holding the
  // document, and the victim's first read of it was aborted.
  assert.deepEqual(r.committers, [10, 10, 10, 10]);
  assert.equal(r.readErrors.length, 1, JSON.stringify(r.readErrors));
  assert.equal(r.readErrors[0].attempt, 1);
  assert.equal(r.readErrors[0].code, 10, `the real error must reach runTransaction: ${r.readErrors[0].message}`);
  assert.match(r.readErrors[0].message, /lock timeout/i);

  // ...and was sent exactly once per transaction - never re-sent into the
  // transaction the server had closed.
  assert.ok(r.sends.length >= 2, `one read per attempt: ${r.sends}`);
  assert.deepEqual(r.sends.filter((n) => n !== 1), [], `re-sent reads: ${r.sends}`);
  assert.equal(r.errors.filter((e) => e.code === 3).length, 0, JSON.stringify(r.errors));

  // runTransaction retried with a fresh transaction, which committed.
  assert.deepEqual(r.outcome, { ok: true });
  assert.equal(r.attempts, 2);
  assert.equal((await db.doc("probe/victim_out").get()).get("attempts"), 2);
  // The chain never committed anything.
  assert.equal((await db.doc("probe/a_contended").get()).get("starvedBy"), undefined);
});

test("9G root cause: on the SDK's default transport the same starved read is re-sent into its closed transaction", async (t) => {
  // The old behaviour, kept as the control that proves the test above can
  // fail: an unconfigured client on the same emulator.
  const legacy = new Firestore({ projectId: PROJECT_ID });
  try {
    const r = await starveOneRead(legacy, { maxAttempts: 5 });
    assert.deepEqual(r.committers, [10, 10, 10, 10]);
    assert.ok(
      r.sends.some((n) => n > 1),
      `the transport re-sent the aborted read with the same transaction id: ${r.sends}`,
    );
    // What the server answers the re-send with is version-specific: v1.19.8
    // "3 INVALID_ARGUMENT: Transaction is invalid or closed" (final),
    // v1.22.0 "10 ABORTED: ... expired or is no longer valid" (retried).
    // Either way the real "lock timeout" never reached the caller first.
    const first = r.readErrors[0];
    t.diagnostic(`default transport: sends per transaction ${JSON.stringify(r.sends)}, first read error ${first && `${first.code} ${first.message}`}, outcome ${JSON.stringify(r.outcome)}`);
    assert.ok(first, "the starved read failed");
    assert.doesNotMatch(first.message, /lock timeout/i);
    if (first.code === 3) {
      assert.match(first.message, /invalid or closed/);
      assert.deepEqual(r.outcome.ok, false, "code 3 is final: the transaction was lost");
    } else {
      assert.equal(first.code, 10);
      assert.match(first.message, /expired|no longer valid/);
    }
  } finally {
    await legacy.terminate();
  }
});

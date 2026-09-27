/**
 * Deterministic lock starvation of one transactional read (Batch 9G root
 * cause). Emulator only.
 *
 * The emulator's lock manager (ReactiveLockManager) waits 2 s for a lock; on
 * timeout it CLOSES the waiting transaction and answers that RPC
 * `10 ABORTED: Transaction lock timeout`. Reads take shared locks, so a read
 * only waits behind a COMMIT that holds the document exclusively. A commit
 * takes its locks one at a time in sorted order and holds each while it waits
 * for the next, and waiting transactions are served oldest-first rather than
 * in arrival order. So:
 *
 *   - `holder` takes a shared lock on [heldPath] and keeps it for [holdMs];
 *   - `committers` blind-write [contendedPath] and [heldPath], starting
 *     COMMITTER_SPACING_MS apart. Each takes [contendedPath] exclusively (it
 *     sorts first), then waits 2 s for [heldPath] and gives up. The next,
 *     older than any reader started after them, inherits [contendedPath].
 *
 * A transaction that begins after the committers and reads [contendedPath]
 * inside the chain waits behind one committer after another and exceeds its
 * own 2 s: its read is aborted and its transaction closed - the exact event
 * behind "Transaction is invalid or closed" in the 9G race tests, made to
 * happen every time instead of about one round in ten.
 *
 * [contendedPath] must sort before [heldPath]. No committer ever commits (the
 * holder outlasts them all), so nothing here changes either document.
 */

const COMMITTER_SPACING_MS = 500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start the chain. Resolves once every committer's transaction exists (so the
 * victim, started after, is younger than all of them) and the first one is
 * about to commit. `victimStartMs` is when, from the returned `t0`, a victim
 * should begin so that its contended read lands inside the chain.
 */
async function startLockStarvation(db, { contendedPath, heldPath, committers = 4, holdMs = 9000 }) {
  if (!(contendedPath < heldPath)) throw new Error("contendedPath must sort before heldPath");
  const t0 = Date.now();
  const at = (ms) => sleep(Math.max(0, ms - (Date.now() - t0)));

  const holder = db
    .runTransaction(
      async (tx) => {
        await tx.get(db.doc(heldPath));
        await sleep(holdMs);
        throw new Error("holder done");
      },
      { maxAttempts: 1 },
    )
    .catch(() => undefined);

  const began = [];
  const chain = Array.from({ length: committers }, (_, i) => {
    let signal;
    began.push(new Promise((resolve) => (signal = resolve)));
    return db
      .runTransaction(
        async (tx) => {
          // A private read gives this transaction its id - and its age.
          await tx.get(db.doc(`${heldPath}_committer${i}`));
          signal();
          await at(COMMITTER_SPACING_MS * (i + 1));
          tx.set(db.doc(contendedPath), { starvedBy: i }, { merge: true });
          tx.set(db.doc(heldPath), { starvedBy: i });
        },
        { maxAttempts: 1 },
      )
      .then(
        () => "committed",
        (err) => err.code,
      );
  });
  await Promise.all(began);

  return {
    t0,
    // Inside the first committer's hold, before the second inherits it.
    victimStartMs: COMMITTER_SPACING_MS + 200,
    at,
    /** Every committer's outcome (all time out) once the chain has drained. */
    done: () => Promise.all([holder, ...chain]).then(([, ...outcomes]) => outcomes),
  };
}

/**
 * Record every transactional BatchGetDocuments that [victimDb] puts ON THE
 * WIRE for [docPath], keyed by transaction id.
 *
 * Counted at the gRPC stub, below the SDK and below gax: the legacy re-send
 * happens inside gax's retry-request, which the SDK's own request log never
 * sees. The GAPIC client looks up `stub.batchGetDocuments` on every call (the
 * gRPC method itself is bound when the stub is built, so patching
 * `grpc.Client.prototype` would miss it), so the stub instance is wrapped.
 */
async function recordTransactionalReads(victimDb, docPath) {
  // Make sure the victim's pooled GAPIC client and its stub exist.
  await victimDb.doc("probe/warm_up").get();
  const pool = victimDb._clientPool;
  const clients = [...pool.activeClients.keys()];
  if (clients.length === 0) throw new Error("the victim has no live GAPIC client");
  const sends = new Map(); // transaction id -> times the read went on the wire
  const errors = [];
  const restores = [];
  for (const client of clients) {
    const stub = await client.firestoreStub;
    const original = stub.batchGetDocuments;
    stub.batchGetDocuments = function (request, ...rest) {
      if (request && request.transaction && request.transaction.length) {
        const wanted = (request.documents || []).some((d) => d.endsWith(`/documents/${docPath}`));
        if (wanted) {
          const id = Buffer.from(request.transaction).toString("hex");
          sends.set(id, (sends.get(id) || 0) + 1);
        }
      }
      const call = original.call(this, request, ...rest);
      call.on("error", (err) => errors.push({ code: err.code, message: err.message }));
      return call;
    };
    restores.push(() => {
      stub.batchGetDocuments = original;
    });
  }
  return {
    sends,
    errors,
    /** Every read went through a stub we wrapped - no client was added mid-test. */
    sawEveryClient: () => [...pool.activeClients.keys()].every((c) => clients.includes(c)),
    stop: () => restores.forEach((restore) => restore()),
  };
}

module.exports = { recordTransactionalReads, startLockStarvation };

/**
 * How every Firestore client in this codebase talks to the backend.
 *
 * THE FAILURE THIS PREVENTS
 * A transactional read that waits too long for a lock is answered
 * `ABORTED: Transaction lock timeout`, and the server closes the transaction.
 * ABORTED is the one error `runTransaction` retries - it starts a fresh
 * transaction - so on its own this is harmless.
 *
 * But by default the Admin SDK's streamed reads (BatchGetDocuments, RunQuery,
 * RunAggregationQuery) sit on google-gax's legacy `retry-request` layer, whose
 * `noResponseRetries` silently RE-SENDS a stream that fails before its first
 * response, whatever the error code. So the ABORTED never reaches
 * `runTransaction`: the read is re-sent, still carrying the dead transaction's
 * id, and the server answers the re-send instead. The Firestore emulator
 * v1.19.8 answers it `3 INVALID_ARGUMENT: Transaction is invalid or closed` -
 * which `runTransaction` treats as final - so a settlement that merely lost a
 * lock race failed outright (Batch 9G). Newer emulators and production answer
 * the re-send with an ABORTED "expired" message instead, which only masks the
 * same bug. The Admin SDK's own `DocumentReader` states the intended design:
 * "Transactional reads are retried via the transaction runner".
 *
 * THE FIX
 * `gaxServerStreamingRetries` moves those streams onto gax's code-aware retry
 * path, and the empty retry-code list gives that path nothing to retry. The
 * transport then never re-sends a streamed read on its own: every error
 * reaches the SDK once, with its real code. The SDK's own layers keep doing
 * exactly what they always did with it - `Firestore._retry` restarts a stream
 * that failed transiently before opening, a query resumes from its last
 * document, a non-transactional batch read re-requests what is missing, and
 * `runTransaction` retries a whole transaction on ABORTED. What is gone is
 * only the blind re-send; nothing is ever retried more.
 *
 * Settings can be applied only before a Firestore instance is first used, so
 * `configureFirestore` runs at startup (index.js) and at the top of every
 * emulator test file, which must exercise the production transport.
 */

const FIRESTORE_SERVICE = "google.firestore.v1.Firestore";

/** The server-streaming reads whose transport-level re-send is switched off. */
const STREAMED_READ_METHODS = Object.freeze(["BatchGetDocuments", "RunQuery", "RunAggregationQuery"]);

const NO_TRANSPORT_RETRY = "no_transport_retry";

const FIRESTORE_SETTINGS = Object.freeze({
  gaxServerStreamingRetries: true,
  clientConfig: {
    interfaces: {
      [FIRESTORE_SERVICE]: {
        retry_codes: { [NO_TRANSPORT_RETRY]: [] },
        methods: Object.fromEntries(
          STREAMED_READ_METHODS.map((method) => [method, { retry_codes_name: NO_TRANSPORT_RETRY }]),
        ),
      },
    },
  },
});

const configured = new WeakSet();

/**
 * Apply `FIRESTORE_SETTINGS` to [db] and return it. Idempotent for the same
 * instance. Throws, loudly, if [db] was already used - a client that silently
 * kept the default transport would reintroduce the failure above.
 */
function configureFirestore(db) {
  if (configured.has(db)) return db;
  db.settings(FIRESTORE_SETTINGS);
  configured.add(db);
  return db;
}

module.exports = {
  FIRESTORE_SETTINGS,
  STREAMED_READ_METHODS,
  configureFirestore,
};

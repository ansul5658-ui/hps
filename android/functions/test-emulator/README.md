# Emulator tests

Run with:

    firebase emulators:exec --only firestore --project apptesting-concurrency-test \
      "npm --prefix functions run test:emulator"

## Why `--test-concurrency=1`

`node --test` runs each test FILE in its own process, concurrently. Every file
here talks to one shared emulator database and calls `clearFirestore()` in
`beforeEach`, so running two files at once means one file wipes the database
while the other is mid-test. That shows up as unrelated, irreproducible
concurrency failures in whichever file loses the race — including in tests that
were passing before the new file was added.

The serial flag is therefore load-bearing, not a performance tweak. If a future
file wants parallelism, give it its OWN `projectId`: `singleProjectMode` is
already false in firebase.json, so separate projects get separate databases.

## Emulator version matters: record it with every result

The settlement concurrency tests behave differently on different Firestore
emulator builds, so a result is only comparable with another from the same
emulator and Java. Validated environments (Batch 9G, 2026-09-27):

| | Reference (historical) | Current |
|---|---|---|
| Firestore emulator | `cloud-firestore-emulator-v1.19.8.jar` | `cloud-firestore-emulator-v1.22.0.jar` |
| Java | Temurin 17.0.20+8 | JBR 25.0.3 (Android Studio's bundled runtime) |
| How it is usually started | `npx firebase-tools@13 emulators:exec ...` on Java 17 | the global firebase-tools 15.x, which requires Java 21+ |

Both used Node v24.18.0 (installed; `package.json` asks for Node 22),
firebase-admin 13.10.0, @google-cloud/firestore 7.11.6 and @grpc/grpc-js
1.14.4. Each firebase-tools version downloads its own emulator into
`~/.cache/firebase/emulators` and deletes the other one, so check which jar a
run actually started (firebase-tools prints it when it downloads one).

### "Transaction is invalid or closed": root cause and fix

The code-3 error that 9G's race tests hit on **1.19.8** was not emulator
flakiness. It was a client transport bug, now fixed in
`functions/lib/firestore.js`:

1. A transactional read waits more than 2 s for a lock held by a committing
   transaction. The emulator's lock manager then **closes that transaction**
   and answers the read `10 ABORTED: Transaction lock timeout.`, which
   `runTransaction` would normally retry with a fresh transaction.
2. By default the Admin SDK's streamed reads (BatchGetDocuments, RunQuery,
   RunAggregationQuery) sit on google-gax's legacy `retry-request` layer, which
   silently **re-sends** a stream that fails before its first response,
   whatever the error code. The ABORTED is swallowed, and the read goes back on
   the wire still carrying the closed transaction's id.
3. The server's answer to that re-send is what the caller sees. **1.19.8**
   answers `3 INVALID_ARGUMENT: Transaction is invalid or closed.`, which is
   final, so the settlement failed ("expiry sweep could not settle").
   **1.22.0** (like production) answers `10 ABORTED: The referenced transaction
   has expired or is no longer valid.`, which is retried. That masks the same
   re-send; it does not remove it.

The fix sets `gaxServerStreamingRetries` with no transport-level retry codes for
those three methods, so the transport never re-sends a streamed read on its
own. Every error reaches the SDK once, with its real code, and the SDK's own
layers keep their existing retries (`runTransaction` on ABORTED, restarting a
stream that failed transiently before opening, resuming a query from its
cursor). Nothing is retried more than before; only the blind re-send is gone.
The earlier 9G app-level retry of code 3 (`lib/transactions.js`) has been
**removed**. It treated the symptom, and it would have hidden a regression.

`configureFirestore` must run before a Firestore instance is first used:
`index.js` applies it at startup, and **every emulator test file applies it
too**, so the tests exercise the production transport.
`test/firestore.test.js` enforces both structurally, and checks on the real
SDK that the settings reach the GAPIC client.

### Regression tests for it

The failure is reproduced **deterministically** rather than about one round in
ten. `lockStarvation.js` builds a chain of committers that each hold the
contended document exclusively for 2 s, so a younger transaction's read of it
is starved past its own 2 s every time. Reads are counted on the wire, at the
gRPC stub (below gax, where the re-send happens).

- `transport.emulator.test.js`, on a raw SDK transaction:
  - **production transport:** the starved read is sent exactly once per
    transaction; the first error is the real `ABORTED: Transaction lock
    timeout`; `runTransaction` commits on attempt 2;
  - **default transport (control):** the same read goes on the wire 3 times
    into one transaction. On 1.19.8 the transaction is lost with code 3; on
    1.22.0 it recovers after the masked "expired" error.
- `expiry.concurrency.test.js`, "a forfeiture whose apps/{appId} read is
  starved of its lock": the real `runForfeitCommitment` read of `apps/{appId}`
  (the read that failed in the captured trace) is starved; the forfeiture must
  settle exactly once, release capacity once, and never see code 3. With the
  old transport this test fails on both emulators (code 3 on 1.19.8, the
  masked error on 1.22.0).

Both pass on 1.19.8 and on 1.22.0.

The "9G:" race tests also accept a losing settlement only if it has a
deliberate refusal code, or a raw `6 ALREADY_EXISTS` naming C1's own
deterministic ledger entry (the exactly-once backstop, classified exactly as
the sweep's `isExpectedSettlementRefusal` does). Any other raw Firestore code,
including code 3, fails them. The older race tests still check only the final
money and state.

### Running on 1.19.8

firebase-tools 15.x uses 1.22.0, so to cover both, also run the 1.19.8 jar
directly on Java 17. Download it once from
`https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar`,
then:

    # terminal 1: the reference emulator
    "<Temurin 17>/bin/java" -jar cloud-firestore-emulator-v1.19.8.jar \
      --host=127.0.0.1 --port=8081

    # terminal 2, from functions/
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 \
      node --test --test-concurrency=1 "test-emulator/*.test.js"

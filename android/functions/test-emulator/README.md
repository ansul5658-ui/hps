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

### The difference: "Transaction is invalid or closed"

On **1.19.8**, when several settlements (sweeps, forfeitures, cancellations)
race for one commitment, a losing transaction's point read can block on a lock
for roughly 9-12 s and then fail with
`3 INVALID_ARGUMENT: Transaction is invalid or closed.` The Admin SDK treats
that code as permanent and does not retry it, so without the 9G retry
(`functions/lib/transactions.js`) the sweep logs "expiry sweep could not
settle". Nothing has committed when this happens.

On **1.22.0** the same contention is reported as
`10 ABORTED: Transaction lock timeout.` at commit, which the SDK retries on its
own. Code 3 never appeared there in the validated run.

Validated over the five settlement files (cancellation, expiry, misses and
testingDays concurrency, plus progress; 109 tests):

| Emulator | 9G retry | Result | Code-3 attempts |
|---|---|---|---|
| 1.19.8 | on | 109/109 | 9, all recovered by the retry |
| 1.19.8 | off | 108/109 (the 9G race test fails) | 16, all surfaced |
| 1.22.0 | on | 109/109 | 0 |

Only the "9G:" race tests in `expiry.concurrency.test.js` assert that no
sweep reported a failed settlement. The older race tests check only the final
money and state, so they pass even when a sweep logged code 3.

**This is emulator behaviour observed during testing. It has not been
identified as a production Firestore bug.** The retry stays because it is
narrow (only that code and message, bounded) and safe (the failed attempt
committed nothing, and every settlement is idempotent).

### Reproducing the 1.19.8 behaviour

1.22.0 will not show it, so run the 1.19.8 jar directly on Java 17. Download
it once from
`https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v1.19.8.jar`,
then:

    # terminal 1: the reference emulator
    "<Temurin 17>/bin/java" -jar cloud-firestore-emulator-v1.19.8.jar \
      --host=127.0.0.1 --port=8081

    # terminal 2, from functions/
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8081 \
      node --test --test-concurrency=1 test-emulator/expiry.concurrency.test.js

With the 9G retry in place this passes. To see the raw failure, the retry has
to be disabled: `runSettlementTransaction` accepts `{ retries: 0 }`. The 9G
race test failed in both validated runs, but it is a race, so a single clean
run proves nothing.

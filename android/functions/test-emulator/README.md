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

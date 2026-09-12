# AppTesting — Android app

Kotlin + Jetpack Compose + Material 3, Firebase-backed.

Repository layout note: this Android project lives in the `android/` sub-directory so it can
coexist with the unrelated WordPress theme + Next.js SaaS work at the repo root. Open
`android/` directly in Android Studio (File → Open… → this directory).

## Status

- **Phase 1** — project scaffold, design system, navigation, splash + sign-in + terms flow.
- **Phase 2** — mock data + real UI content across Home, Test Apps, My Apps, Groups, Profile, Add App.
- **Phase 3 Step 1** — real Firebase Authentication, session persistence, `users/{uid}` profile write, starter Firestore security rules.
- **Phase 3 Step 2** — Firestore-backed repositories for `apps`, `groups`, `testingAssignments`, `testingLogs`, plus `users/{uid}/memberships` and `users/{uid}/coinTransactions` subcollections. Real-time listeners drive the UI. Idempotent daily-log writes via deterministic doc IDs + Firestore transaction. Notifications stay on the mock until FCM lands.

## Requirements

- Android Studio Ladybug (2024.2) or newer
- JDK 17
- Android SDK — `compileSdk = 35`, `minSdk = 24`
- A Firebase project (only needed once you want real auth)

## First-run setup

1. Install the Android SDK and set `ANDROID_HOME` (or `sdk.dir` in
   `android/local.properties`) so Gradle can resolve platform artifacts.
2. Sync the project. The Gradle wrapper is pinned to Gradle 8.11.1 and the toolchain uses
   AGP 8.7.3 + Kotlin 2.0.21. Compose Compiler is provided by the Kotlin Compose plugin
   (no separate `kotlinCompilerExtensionVersion` needed).
3. **Without Firebase set up**: the project still builds and runs. `MockUserRepository`
   drives a demo session so every screen renders. The Sign In button will restore the
   demo user and advance to Terms → Main.

## Enabling real Firebase (Phase 3 Step 1)

The Gradle build applies the `com.google.gms.google-services` plugin **only if**
`android/app/google-services.json` is present. Nothing here is faked; supply the file
and Firebase mode turns on automatically.

Console checklist:

1. **Create a Firebase project** (or reuse one) at <https://console.firebase.google.com>.
2. **Register the Android apps** — you'll want two entries because the debug build has
   an `applicationIdSuffix = ".debug"`:
   - `com.apptesting.app.debug`
   - `com.apptesting.app`
3. **Register your signing SHA-1** for each variant. For the debug key:
   ```bash
   keytool -list -v -alias androiddebugkey \
     -keystore ~/.android/debug.keystore \
     -storepass android -keypass android
   ```
   Add the SHA-1 (and SHA-256 for release) in Project settings → Your app → SHAs.
4. **Enable Google sign-in**: Authentication → Sign-in method → Google → Enable. Set
   a support email. Confirm the "Web SDK configuration" section shows a **Web client
   ID** — the `google-services` plugin will emit it as `R.string.default_web_client_id`
   at build time, which the app reads via `FirebaseAvailability.webClientId()`.
5. **Create a Firestore database** in production mode.
6. **Deploy the security rules** in `android/firestore.rules`:
   ```bash
   firebase deploy --only firestore:rules
   ```
   (or paste them via Firebase Console → Firestore → Rules).
7. **Download `google-services.json`** for the debug variant and save it to
   `android/app/google-services.json`. That file is git-ignored on purpose; do not
   commit it.
8. Rebuild. The Gradle build log prints `Firebase enabled — using google-services.json`
   when it applies the plugin.

Once enabled:
- Sign In shows a real Google Credential Manager sheet, exchanges the ID token for a
  Firebase credential, and merges the user's `users/{uid}` profile.
- The session persists across launches (Firebase Auth default storage). Splash routes
  a returning signed-in user straight to Main.
- Sign Out calls `FirebaseAuth.signOut()` and routes back to Sign In.

## Package layout

```
com.apptesting.app
├── AppTestingApplication.kt   — inits ServiceLocator
├── MainActivity.kt
├── core
│   ├── data
│   │   ├── Repositories.kt         — interfaces + AuthGateway
│   │   ├── ServiceLocator.kt       — picks Firebase or Mock impl at runtime
│   │   ├── MockData.kt / MockRepositories.kt
│   │   └── firebase/               — FirebaseAuthUserRepository, GoogleSignInHelper, FirebaseAvailability
│   ├── designsystem  — Material 3 theme + reusable components
│   ├── model         — pure Kotlin domain models
│   ├── navigation    — routes, nav host, bottom bar
│   └── util          — TimeProvider (canonical "today" key)
└── feature
    ├── auth          — SignInScreen, TermsScreen, AuthViewModel
    ├── groups
    ├── home
    ├── myapps        — MyAppsScreen + add/ multi-step flow
    ├── profile
    ├── splash
    └── testapps
```

## Firestore collections

Server-side security rules enforce every one of these; the client trusts none of them.

| Collection / Path                          | Written by            | Read by                       | Step |
| ------------------------------------------ | --------------------- | ----------------------------- | ---- |
| `users/{uid}`                              | Owner (limited)       | Owner                         | 3.1  |
| `users/{uid}/memberships/{groupId}`        | Owner                 | Owner                         | 3.2  |
| `users/{uid}/coinTransactions/{txId}`      | Cloud Functions only  | Owner                         | 3.2 (read-only client) |
| `apps/{appId}`                             | Owner (limited)       | Any signed-in user            | 3.2  |
| `groups/{groupId}`                         | Admin / CFs only      | Any signed-in user            | 3.2  |
| `testingAssignments/{assignmentId}`        | Admin / CFs; tester may only advance `status → waitingForVerification` | Assignment tester + developer | 3.2 |
| `testingLogs/{assignmentId}__{yyyy-MM-dd}` | Tester (append-only)  | Tester                        | 3.2 |
| `notifications/{notificationId}`           | Cloud Functions only  | Owner                         | 3.6 (planned) |
| `reports/{reportId}`                       | Any signed-in user    | Admin                         | 3.7 (planned) |
| `adminActions/{actionId}`                  | Cloud Functions only  | Admin                         | 3.7 (planned) |

### `users/{uid}` field contract

Client-writable: `uid`, `email`, `displayName`, `photoUrl`, `createdAt` (create only), `updatedAt`.
Server-authoritative (Cloud Functions later): `role`, `coinBalance`, `trustScore`, `isSuspended`.

### `apps/{appId}` field contract

`ownerId`, `appName`, `packageName`, `versionName`, `playStoreUrl`, `closedTestingUrl`,
`iconUrl`, `description`, `status`, `createdAt`, `updatedAt`. `status` starts at
`pendingReview`; only admins / Cloud Functions may advance it.

### `testingAssignments/{assignmentId}` field contract

`appId`, `testerId`, `developerId`, `daysRequired`, `daysCompleted`, `coinReward`,
`status`, `createdAt`, `updatedAt`. The client can only flip `status` from
`ready` / `inProgress` → `waitingForVerification`. `daysCompleted` is
server-authoritative and will be maintained by a Cloud Function; the client's UI
still shows live progress because [FirestoreAssignmentRepository](app/src/main/java/com/apptesting/app/core/data/firebase/firestore/FirestoreAssignmentRepository.kt)
derives it from the `testingLogs` collection on the fly.

### `testingLogs/{assignmentId}__{yyyy-MM-dd}` field contract

`assignmentId`, `testerId`, `date` (`yyyy-MM-dd`), `createdAt`.
Deterministic doc ID (`{assignmentId}__{date}`) is the primary duplicate-log
defense: Firestore refuses the second create for the same day at the storage
layer, regardless of client behavior. The rules add a second layer of defense:
they refuse a create whose payload doesn't match its own doc ID and refuse a
create whose `testerId` doesn't match the corresponding assignment's tester.

## Security

- **Coins, Trust Score, admin privileges and completion rewards are never trusted
  client-side.** Cloud Functions perform the state transitions and write the results.
- The starter `firestore.rules` allows a signed-in user to read and merge-write ONLY
  the profile fields on their own `users/{uid}` document, and denies writes to
  `role`, `coinBalance`, `trustScore`, `isSuspended`. Every other collection is denied
  until its Firestore repository lands in a later step.
- `google-services.json`, signing keystores, and `local.properties` are git-ignored.
- No `QUERY_ALL_PACKAGES` permission is declared. If we ever need to detect that a
  specific tested app is installed, add a narrowly-scoped `<queries>` block for that
  package instead.
- No invasive device monitoring.
- Backup/data-extraction rules exclude local storage — Firestore is the source of truth,
  so restoring an install regenerates local state on next launch.

## What is NOT built yet

- Cloud Functions for Coins / Trust Score / assignment verification / user role init.
  Until those land, `daysCompleted` on assignment docs stays at zero server-side and
  the client derives progress from `testingLogs`; `coinBalance` and `trustScore`
  read from `users/{uid}` and stay at zero until CFs write them.
- Admin console for creating `groups` and `testingAssignments` — Firestore rules
  currently reject client writes to both.
- `notifications` — stays on the mock repository until FCM lands.
- `reports` and `adminActions` — planned for Step 7.
- Firebase Storage (real app icons and screenshots).
- FCM inbox + push handling.
- Google Play Console automation — intentionally out of scope; we store the
  developer-provided links only.

### Manual test data (before Cloud Functions land)

Until Step 3+ delivers an admin console, use the Firebase Console (or the
Firebase CLI) to insert `groups/{groupId}` and `testingAssignments/{assignmentId}`
documents matching the field contracts above. Once a signed-in user's uid is
set as `testerId` on an assignment (and the user has joined the corresponding
group), the mobile app will surface it under Test Apps.

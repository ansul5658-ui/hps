# AppTesting — Android app

Kotlin + Jetpack Compose + Material 3, Firebase-backed.

Repository layout note: this Android project lives in the `android/` sub-directory so it can
coexist with the unrelated WordPress theme + Next.js SaaS work at the repo root. Open
`android/` directly in Android Studio (File → Open… → this directory).

## Status

- **Phase 1** — project scaffold, design system, navigation, splash + sign-in + terms flow.
- **Phase 2** — mock data + real UI content across Home, Test Apps, My Apps, Groups, Profile, Add App.
- **Phase 3 Step 1** — real Firebase Authentication, session persistence, `users/{uid}` profile write, starter Firestore security rules. Other repositories remain mocked and will be swapped one by one in later steps.

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

## Planned Firestore collections

Server-side security rules must enforce all of these; the client trusts none of them.

| Collection         | Purpose                                                    | Step wired |
| ------------------ | ---------------------------------------------------------- | ---------- |
| `users`            | Profile (client-writable), role, coinBalance, trustScore   | 3.1        |
| `apps`             | App submissions + approval state                           | 3.2        |
| `groups`           | Group metadata, visibility, state                          | 3.3        |
| `groupMembers`     | Membership rows (`groupId × userId`)                       | 3.3        |
| `testAssignments`  | One row per (app × tester) — status, deadline, progress    | 3.4        |
| `coinTransactions` | Immutable ledger — written only by Cloud Functions         | 3.5        |
| `notifications`    | Per-user notifications                                     | 3.6        |
| `reports`          | Moderation queue                                           | 3.7        |
| `adminActions`     | Immutable audit log of admin operations                    | 3.7        |

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

- Firestore repositories for `apps`, `groups`, `testAssignments`, `coinTransactions`,
  `notifications`, `reports`, `adminActions`. Those still use the mock implementations
  and will be swapped in Phase 3 Steps 2–7.
- Cloud Functions for Coins / Trust Score / assignment verification / user role init.
- Firebase Storage (real app icons and screenshots).
- FCM inbox + push handling.
- Admin console (planned as a separate variant).
- Google Play Console automation — intentionally out of scope; we store the
  developer-provided links only.

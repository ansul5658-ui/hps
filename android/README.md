# AppTesting — Android app

Kotlin + Jetpack Compose + Material 3, Firebase-backed.

Repository layout note: this Android project lives in the `android/` sub-directory so it can
coexist with the unrelated WordPress theme + Next.js SaaS work at the repo root. Open
`android/` directly in Android Studio (File → Open… → this directory).

## Status

Phase 1 foundation — project scaffold, design system, navigation, splash + sign-in +
terms flow, Home dashboard, and polished placeholder screens for Test Apps, My Apps,
Groups and Profile. No Firebase network calls yet; all UI paths are walkable end-to-end.

## Requirements

- Android Studio Ladybug (2024.2) or newer
- JDK 17
- Android SDK — compileSdk 35, minSdk 24
- A Firebase project (to move past the current stub repositories)

## First-run setup

1. Install the Android SDK and set `ANDROID_HOME` (or `sdk.dir` in
   `android/local.properties`) so Gradle can resolve platform artifacts.
2. Sync the project. The Gradle wrapper is pinned to Gradle 8.11.1 and the toolchain uses
   AGP 8.7.3 + Kotlin 2.0.21. Compose Compiler is provided by the Kotlin Compose plugin
   (no separate `kotlinCompilerExtensionVersion` needed).
3. To enable Firebase:
   - Create a Firebase project + Android app with package `com.apptesting.app.debug`
     (and `com.apptesting.app` for release).
   - Drop `google-services.json` under `app/`.
   - Add the Google Services Gradle plugin to `app/build.gradle.kts`:
     ```kotlin
     plugins { id("com.google.gms.google-services") }
     ```
     and to the root `build.gradle.kts`:
     ```kotlin
     plugins { id("com.google.gms.google-services") version "4.4.2" apply false }
     ```
     (kept out of the initial commit so the project builds with no Firebase config).
   - Enable Authentication → Google, Firestore, Storage, Cloud Messaging.
   - Write Firestore security rules per the collections listed below.

## Package layout

```
com.apptesting.app
├── AppTestingApplication.kt
├── MainActivity.kt
├── core
│   ├── data          — repository interfaces + preview stubs
│   ├── designsystem  — Material 3 theme, typography, shapes, reusable components
│   ├── model         — pure Kotlin domain models
│   └── navigation    — routes, nav host, bottom bar
└── feature
    ├── auth          — SignInScreen, TermsScreen
    ├── coins         — (reserved)
    ├── groups        — GroupsScreen
    ├── home          — HomeScreen + HomeViewModel + HomeUiState
    ├── myapps        — MyAppsScreen + Add-app multi-step flow
    ├── profile       — ProfileScreen
    ├── splash        — SplashScreen
    └── testapps      — TestAppsScreen
```

## Planned Firestore collections

Server-side security rules must enforce all of these; the client trusts none of them.

| Collection         | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `users`            | Profile, role, `coinBalance` and `trustScore` (server-set) |
| `apps`             | App submissions + approval state                           |
| `groups`           | Group metadata, visibility, state                          |
| `groupMembers`     | Membership rows (`groupId × userId`)                       |
| `testAssignments`  | One row per (app × tester) — status, deadline, progress    |
| `coinTransactions` | Immutable ledger — written only by Cloud Functions         |
| `notifications`    | Per-user notifications                                     |
| `reports`          | Moderation queue                                           |
| `adminActions`     | Immutable audit log of admin operations                    |

## Security

- Coins, Trust Score, admin privileges and completion rewards are **never** trusted
  client-side. Cloud Functions perform the state transitions and write the results.
- `google-services.json`, signing keystores, and `local.properties` are git-ignored.
- No `QUERY_ALL_PACKAGES` permission is declared. If we ever need to detect that a
  specific tested app is installed, add a narrowly-scoped `<queries>` block for that
  package instead.
- No invasive device monitoring.
- Backup/data-extraction rules exclude local storage — Firestore is the source of truth,
  so restoring an install regenerates local state on next launch.

## What is NOT built yet

- Real Firebase Auth (currently the sign-in button drives navigation only)
- Firestore repositories (the `data/` interfaces have `Stub…` empty implementations)
- Cloud Functions for Coins/Trust Score/approvals
- Notifications inbox screen
- Admin console (planned as a separate variant)
- Google Play Console automation — intentionally out of scope; we store the
  developer-provided links only.

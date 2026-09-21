package com.apptesting.app.core.data.firebase

import android.util.Log
import com.apptesting.app.BuildConfig
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.functions.FirebaseFunctions

private const val TAG = "AUTH_DEBUG"

/**
 * Points this build at a local Firebase Emulator Suite — DEBUG BUILDS ONLY.
 *
 * WHY THIS EXISTS
 * The commitment lifecycle runs through callable Cloud Functions, so the only
 * way to exercise the real Android wire path — serialization, region routing,
 * the callable round trip, the UI rendering the server's response — is to have
 * the app actually call a running backend. Doing that against production would
 * mean deploying unreleased functions and writing real user data. Pointing a
 * debug build at local emulators gives the same end-to-end coverage with no
 * production exposure at all.
 *
 * WHY IT CANNOT REACH PRODUCTION
 * Three independent guards, any one of which is sufficient:
 *   1. [BuildConfig.DEBUG] — false in release.
 *   2. `FIREBASE_EMULATOR_HOST` is hard-coded to "" in the release build type.
 *   3. It is empty in debug too unless a build explicitly passes
 *      `-PfirebaseEmulatorHost=...`, so an ordinary debug build is unaffected.
 *
 * WHY 127.0.0.1 WORKS ON A PHYSICAL PHONE
 * It does not, on its own — a phone's localhost is the phone. The ports are
 * tunnelled over USB with `adb reverse tcp:PORT tcp:PORT`, which makes the
 * device's localhost reach this PC. That is preferred over a LAN IP because it
 * does not depend on both devices being on the same Wi-Fi.
 *
 * The SDK calls below must run BEFORE anything touches the corresponding
 * Firebase singleton; [com.apptesting.app.AppTestingApplication] calls this
 * first thing in `onCreate` for that reason.
 */
internal object FirebaseEmulator {

    private const val AUTH_PORT = 9099
    private const val FIRESTORE_PORT = 8080
    private const val FUNCTIONS_PORT = 5001

    /** The configured host, or null when this build talks to real Firebase. */
    val host: String? =
        BuildConfig.FIREBASE_EMULATOR_HOST.takeIf { BuildConfig.DEBUG && it.isNotBlank() }

    /**
     * True when this build is wired to local emulators.
     *
     * Read by [FirebaseAuthUserRepository] to decide whether the emulator-only
     * anonymous sign-in is available — see the note there.
     */
    val isEnabled: Boolean get() = host != null

    private var wired = false

    /** Idempotent: repeated calls are a no-op, so a restart cannot double-wire. */
    fun wireIfConfigured(
        auth: FirebaseAuth = FirebaseAuth.getInstance(),
        firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
        functions: FirebaseFunctions = FirebaseFunctions.getInstance(FUNCTIONS_REGION),
    ) {
        val target = host ?: return
        if (wired) return
        wired = true

        Log.w(TAG, "[EMULATOR] DEBUG BUILD — using local Firebase emulators at $target")
        auth.useEmulator(target, AUTH_PORT)
        firestore.useEmulator(target, FIRESTORE_PORT)
        functions.useEmulator(target, FUNCTIONS_PORT)
        Log.w(
            TAG,
            "[EMULATOR] auth:$AUTH_PORT firestore:$FIRESTORE_PORT functions:$FUNCTIONS_PORT",
        )
    }

    /**
     * Must match the region the callables are created with, so the emulator
     * URL path lines up with what the Functions emulator serves.
     */
    const val FUNCTIONS_REGION = "asia-south2"
}

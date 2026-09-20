package com.apptesting.app.core.util

/**
 * App-wide configuration constants.
 */
object AppConfig {
    /**
     * Official AppTesting community Google Group URL for Play Console closed testing.
     */
    const val APP_TESTER_GOOGLE_GROUP_URL = "https://groups.google.com/g/developerapptesting"

    /**
     * Official AppTesting community Google Group email.
     */
    const val OFFICIAL_GROUP_EMAIL = "developerapptesting@googlegroups.com"

    /**
     * Document ID for the official platform testing group in Firestore.
     */
    const val OFFICIAL_GROUP_ID = "app_testing_official"

    /**
     * Tester slots opened per app.
     *
     * This is a PRODUCT setting (group capacity), not a Google Play
     * requirement. Play's current requirement for a newly created personal
     * developer account is 12 testers continuously opted in for 14 days; this
     * number is deliberately higher to absorb dropout. Do not present it in
     * the UI as "what Play requires".
     *
     * Mirrors `REQUIRED_TESTER_COUNT` in functions/lib/constants.js.
     */
    const val REQUIRED_TESTER_COUNT = 20

    // ---- Quick Tests -----------------------------------------------------
    // Mirrors the QUICK_TEST_* constants in functions/lib/constants.js. These
    // are duplicated deliberately: the client uses them only to render and to
    // disable buttons early. Every one of them is re-derived server-side on
    // each call, so a tampered value here changes a label, not an outcome.

    /** Quick Tests one user may start per UTC day. Display + pre-disable only. */
    const val QUICK_TEST_DAILY_LIMIT = 5

    /** Days before the same user may Quick Test the same app again. */
    const val QUICK_TEST_COOLDOWN_DAYS = 7

    /** The floor the Apps screen promises when enough eligible apps exist. */
    const val QUICK_TEST_MIN_VISIBLE = 5

    /** Firestore path of the server-maintained discovery pool document. */
    const val QUICK_TEST_POOL_COLLECTION = "discovery"
    const val QUICK_TEST_POOL_DOC_ID = "quickTestPool"
}

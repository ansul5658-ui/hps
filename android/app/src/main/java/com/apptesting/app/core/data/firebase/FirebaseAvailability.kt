package com.apptesting.app.core.data.firebase

import android.content.Context
import com.google.firebase.FirebaseApp

/**
 * Runtime probe for "has Firebase actually been configured for this build?".
 *
 * The `com.google.gms.google-services` Gradle plugin, when applied, generates
 * strings resources from google-services.json and merges the FirebaseInitProvider
 * ContentProvider into the manifest. Firebase then auto-initializes on process
 * start. Without the plugin (i.e. no google-services.json), the ContentProvider
 * isn't present and [FirebaseApp.getApps] returns an empty list.
 *
 * Callers use this to decide between the Firebase-backed [UserRepository] and
 * the in-memory mock — no code path fabricates or hard-codes credentials.
 */
object FirebaseAvailability {
    fun isConfigured(context: Context): Boolean = try {
        FirebaseApp.getApps(context).isNotEmpty()
    } catch (t: Throwable) {
        false
    }

    /**
     * Best-effort lookup of the Web OAuth 2.0 client ID that the
     * google-services plugin generates from google-services.json when
     * Google Sign-In has been enabled in the Firebase Console.
     *
     * Returns null if the plugin never ran (no google-services.json) OR
     * if Google Sign-In hasn't been enabled for this app in the console.
     */
    fun webClientId(context: Context): String? {
        val id = context.resources.getIdentifier(
            "default_web_client_id",
            "string",
            context.packageName,
        )
        return if (id == 0) null else context.getString(id)
    }
}

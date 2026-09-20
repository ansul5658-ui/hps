package com.apptesting.app.core.data.firebase.functions

import android.util.Log
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout

private const val TAG = "AUTH_DEBUG"

/**
 * Thin wrapper around the project's callable Cloud Functions.
 *
 * Every privileged operation — app approval, user suspension, group join,
 * assignment creation — goes through here rather than writing Firestore
 * directly, because security rules refuse those writes to all clients by
 * design. The server re-verifies identity and role on each call; this class
 * only carries the request and turns failures into messages the UI can show.
 */
internal class AppFunctions(
    private val functions: FirebaseFunctions = FirebaseFunctions.getInstance(REGION),
) {

    suspend fun call(name: String, payload: Map<String, Any?>): Map<String, Any?> {
        Log.d(TAG, "[FN] calling $name with keys=${payload.keys}")
        return try {
            val result = withTimeout(CALL_TIMEOUT_MS) {
                functions.getHttpsCallable(name).call(payload).await()
            }
            Log.d(TAG, "[FN] $name succeeded")
            val raw = result.getData() as? Map<*, *> ?: return emptyMap()
            raw.entries.associate { (key, value) -> key.toString() to value }
        } catch (e: FirebaseFunctionsException) {
            Log.e(TAG, "[FN] $name failed: code=${e.code} message=${e.message}", e)
            throw IllegalStateException(messageFor(e), e)
        }
    }

    private companion object {
        const val REGION = "asia-south2"

        /** Well above normal latency, low enough that a broken call surfaces. */
        const val CALL_TIMEOUT_MS = 30_000L
    }
}

/**
 * Maps a callable failure onto something worth showing a human.
 *
 * Kept as a pure top-level function so it can be unit tested without Firebase.
 */
internal fun messageFor(e: FirebaseFunctionsException): String =
    messageFor(e.code.name, e.message)

internal fun messageFor(codeName: String, serverMessage: String?): String = when (codeName) {
    // The backend authors these messages for humans, so pass them through.
    "UNAUTHENTICATED",
    "PERMISSION_DENIED",
    "NOT_FOUND",
    "FAILED_PRECONDITION",
    "RESOURCE_EXHAUSTED",
    "INVALID_ARGUMENT",
    -> serverMessage?.takeIf { it.isNotBlank() } ?: defaultFor(codeName)
    // Transport-level failures carry SDK noise, not something worth showing.
    else -> defaultFor(codeName)
}

private fun defaultFor(codeName: String): String = when (codeName) {
    "UNAUTHENTICATED" -> "You need to be signed in."
    "PERMISSION_DENIED" -> "You don't have permission to do that."
    "NOT_FOUND" -> "That item no longer exists."
    "FAILED_PRECONDITION" -> "That action isn't allowed right now."
    "RESOURCE_EXHAUSTED" -> "That limit has already been reached."
    "INVALID_ARGUMENT" -> "That request was rejected as invalid."
    "UNAVAILABLE", "DEADLINE_EXCEEDED" -> "Network problem — please try again."
    else -> "Something went wrong. Please try again."
}

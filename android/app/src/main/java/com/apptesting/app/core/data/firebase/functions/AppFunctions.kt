package com.apptesting.app.core.data.firebase.functions

import android.util.Log
import com.google.firebase.functions.FirebaseFunctions
import com.google.firebase.functions.FirebaseFunctionsException
import kotlinx.coroutines.TimeoutCancellationException
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
            throw CallableException.from(e.code.name, e.message, e.details, e)
        } catch (e: TimeoutCancellationException) {
            // Our own ceiling, not the caller's scope being cancelled. Letting a
            // CancellationException escape would silently abort the caller's
            // coroutine instead of showing an error, so it becomes one here.
            Log.e(TAG, "[FN] $name timed out after ${CALL_TIMEOUT_MS}ms")
            throw CallableException.from("DEADLINE_EXCEEDED", null, null, e)
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
    "ALREADY_EXISTS",
    "ABORTED",
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
    "ALREADY_EXISTS" -> "That has already been done."
    "ABORTED" -> "Something changed while that was saving. Please try again."
    "UNAVAILABLE", "DEADLINE_EXCEEDED" -> "Network problem — please try again."
    else -> "Something went wrong. Please try again."
}

/**
 * A callable failure, carrying what the server actually said.
 *
 * Still an [IllegalStateException] whose message is the human-readable text
 * from [messageFor], so every existing caller that shows `e.message` keeps
 * working unchanged. New callers can branch on [code] and on the server's
 * machine-readable [reason] (sent in the HttpsError `details`) instead of
 * matching message text - e.g. `groupNotJoined` vs `noEligibleOwnApp`.
 *
 * Only the fields the backend deliberately puts in `details` are read; the
 * server never sends a stack trace there, and nothing here logs or displays
 * the raw SDK exception to the user.
 */
class CallableException(
    val code: String,
    val reason: String?,
    val gaps: List<String>,
    message: String,
    cause: Throwable? = null,
) : IllegalStateException(message, cause) {

    /** True for failures a retry might fix: connectivity, timeouts, contention. */
    val isTransient: Boolean
        get() = code in setOf("UNAVAILABLE", "DEADLINE_EXCEEDED", "ABORTED", "INTERNAL", "UNKNOWN")

    companion object {
        fun from(code: String, serverMessage: String?, details: Any?, cause: Throwable? = null): CallableException {
            val map = details as? Map<*, *>
            val reason = map?.get("reason") as? String
            val gaps = (map?.get("gaps") as? List<*>)?.mapNotNull { it as? String }.orEmpty()
            return CallableException(code, reason, gaps, messageFor(code, serverMessage), cause)
        }
    }
}

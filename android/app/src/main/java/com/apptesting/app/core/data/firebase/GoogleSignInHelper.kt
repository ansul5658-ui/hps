package com.apptesting.app.core.data.firebase

import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

private const val TAG = "AUTH_DEBUG"

/**
 * Wraps the modern Credential Manager + Google Identity Services flow that
 * returns a Google ID token for the signed-in Google account.
 *
 * We deliberately keep this a plain suspend function: no state, no ViewModel
 * coupling. The caller (an AuthViewModel) hands us an Activity/Fragment
 * context and the Web OAuth client id, and gets back a discriminated result
 * that says whether the user cancelled, has no eligible account, or produced
 * a token that we can hand to FirebaseAuth.
 *
 * Diagnostic logging (`adb logcat -s $TAG`) prints one line per step so a
 * hang in either Credential Manager attempt is trivially localizable.
 *
 * A per-attempt [CRED_MAN_TIMEOUT_MS] guarantees that even if Credential
 * Manager gets stuck (a known failure mode when the OAuth Android client
 * for this app's (package, SHA-1) pair isn't registered on the Google
 * Cloud side) the caller sees an Error instead of an infinite spinner.
 */
object GoogleSignInHelper {

    sealed interface Result {
        data class Token(val idToken: String) : Result

        /** The user dismissed the sheet — not a real error. */
        object Cancelled : Result

        /** No eligible Google account is available on the device. */
        object NoAccount : Result

        data class Error(val message: String) : Result
    }

    suspend fun requestIdToken(context: Context, webClientId: String): Result {
        Log.d(TAG, "GoogleSignInHelper.requestIdToken — starting")
        if (webClientId.isBlank()) {
            Log.w(TAG, "webClientId is blank — aborting")
            return Result.Error(
                "Firebase is missing a Google Web client ID. " +
                    "Enable Google sign-in in the Firebase console and re-download google-services.json.",
            )
        }
        val credentialManager = CredentialManager.create(context)

        // First attempt: only accounts already authorized on this app —
        // this makes the sheet less disruptive for returning users.
        val authorizedRequest = GetCredentialRequest.Builder().addCredentialOption(
            GetGoogleIdOption.Builder()
                .setServerClientId(webClientId)
                .setFilterByAuthorizedAccounts(true)
                .setAutoSelectEnabled(true)
                .build(),
        ).build()

        Log.d(TAG, "attempt 1 — filterByAuthorizedAccounts=true")
        val first = runRequest(credentialManager, context, authorizedRequest)
        if (first != null) {
            Log.d(TAG, "attempt 1 resolved: ${first::class.simpleName}")
            return first
        }

        Log.d(TAG, "attempt 1 returned no matching credential — retrying with filter=false")
        val anyRequest = GetCredentialRequest.Builder().addCredentialOption(
            GetGoogleIdOption.Builder()
                .setServerClientId(webClientId)
                .setFilterByAuthorizedAccounts(false)
                .build(),
        ).build()

        val second = runRequest(credentialManager, context, anyRequest)
        return when {
            second != null -> {
                Log.d(TAG, "attempt 2 resolved: ${second::class.simpleName}")
                second
            }
            else -> {
                Log.w(TAG, "attempt 2 also returned no matching credential")
                Result.NoAccount
            }
        }
    }

    /**
     * Returns null when the flow reports "no matching credential" so the
     * caller can retry with `filterByAuthorizedAccounts = false`.
     *
     * The Credential Manager call is bounded by [CRED_MAN_TIMEOUT_MS]. That
     * ceiling accounts for the user picking an account plus the token
     * round-trip; anything longer means the flow has gotten stuck and we
     * surface an actionable error rather than block the sign-in coroutine.
     */
    private suspend fun runRequest(
        credentialManager: CredentialManager,
        context: Context,
        request: GetCredentialRequest,
    ): Result? = try {
        val response = withTimeout(CRED_MAN_TIMEOUT_MS) {
            credentialManager.getCredential(context, request)
        }
        Log.d(TAG, "Credential Manager returned a credential")
        val credential = response.credential
        if (
            credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            val googleId = GoogleIdTokenCredential.createFrom(credential.data)
            Result.Token(googleId.idToken)
        } else {
            Log.w(TAG, "Unexpected credential type: ${credential.type}")
            Result.Error("Unexpected credential type: ${credential.type}")
        }
    } catch (e: TimeoutCancellationException) {
        Log.e(TAG, "Credential Manager timed out after ${CRED_MAN_TIMEOUT_MS}ms")
        Result.Error(
            "Google sign-in timed out. This usually means the OAuth Android " +
                "client for this app's package + SHA-1 isn't registered on the " +
                "Google Cloud side. Check Firebase Console → Project settings → " +
                "Your apps → SHA certificate fingerprints and confirm the debug " +
                "SHA-1 is registered against the actual applicationId your build " +
                "runs as.",
        )
    } catch (e: GetCredentialCancellationException) {
        Log.d(TAG, "Credential Manager reported user cancellation")
        Result.Cancelled
    } catch (e: NoCredentialException) {
        Log.d(TAG, "Credential Manager reported NoCredentialException — retry with filter=false")
        null
    } catch (e: GetCredentialException) {
        Log.e(TAG, "GetCredentialException: type=${e.type}", e)
        Result.Error(e.message ?: "Sign-in failed.")
    } catch (t: Throwable) {
        Log.e(TAG, "Unexpected Credential Manager error", t)
        Result.Error(t.message ?: "Sign-in failed.")
    }

    /**
     * Ceiling on a single Credential Manager attempt. Large enough for the
     * user to pick an account and for the token to come back (~90s), small
     * enough that a broken (package, SHA-1) pair surfaces as an error the
     * user can read instead of an infinite spinner.
     */
    private const val CRED_MAN_TIMEOUT_MS = 90_000L
}

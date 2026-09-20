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
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

private const val TAG = "AUTH_DEBUG"

/**
 * Wraps the modern Credential Manager + Google Identity Services flow that
 * returns a Google ID token for the signed-in Google account.
 *
 * Stage 1 attempts seamless auto-select for previously authorized accounts via
 * [GetGoogleIdOption] with `filterByAuthorizedAccounts = true`.
 *
 * Stage 2 uses [GetSignInWithGoogleOption] (the official option for explicit button
 * taps / account picker), avoiding the Google Play Services hang/bug associated with
 * `GetGoogleIdOption` when `filterByAuthorizedAccounts = false`.
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

        // Attempt 1: Check for previously authorized accounts for seamless returning user sign-in.
        val authorizedRequest = GetCredentialRequest.Builder().addCredentialOption(
            GetGoogleIdOption.Builder()
                .setServerClientId(webClientId)
                .setFilterByAuthorizedAccounts(true)
                .setAutoSelectEnabled(true)
                .build(),
        ).build()

        Log.d(TAG, "attempt 1 — filterByAuthorizedAccounts=true")
        val first = runRequest(credentialManager, context, authorizedRequest, isFallbackAttempt = false)
        if (first != null) {
            Log.d(TAG, "attempt 1 resolved: ${first::class.simpleName}")
            return first
        }

        // Attempt 2: Use GetSignInWithGoogleOption (the official option for button click / account chooser).
        // This avoids the known Google Play Services hang/bug with GetGoogleIdOption(filterByAuthorizedAccounts=false).
        Log.d(TAG, "attempt 1 returned no authorized credential — retrying with GetSignInWithGoogleOption")
        val signInWithGoogleOption = GetSignInWithGoogleOption.Builder(
            serverClientId = webClientId,
        ).build()

        val anyRequest = GetCredentialRequest.Builder()
            .addCredentialOption(signInWithGoogleOption)
            .build()

        val second = runRequest(credentialManager, context, anyRequest, isFallbackAttempt = true)
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
     * Executes a Credential Manager request bounded by [CRED_MAN_TIMEOUT_MS].
     *
     * If [isFallbackAttempt] is false, non-cancellation errors return null so
     * that Stage 2 ([GetSignInWithGoogleOption]) is attempted.
     */
    private suspend fun runRequest(
        credentialManager: CredentialManager,
        context: Context,
        request: GetCredentialRequest,
        isFallbackAttempt: Boolean,
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
            "Google sign-in timed out. Please verify Google Play Services and network connection on the device.",
        )
    } catch (e: GetCredentialCancellationException) {
        Log.d(TAG, "Credential Manager reported user cancellation")
        Result.Cancelled
    } catch (e: NoCredentialException) {
        Log.d(TAG, "Credential Manager reported NoCredentialException")
        null
    } catch (e: GetCredentialException) {
        Log.e(TAG, "GetCredentialException: type=${e.type}", e)
        if (!isFallbackAttempt) {
            Log.d(TAG, "Attempt 1 failed with ${e.type} — falling through to GetSignInWithGoogleOption")
            null
        } else {
            Result.Error(e.message ?: "Sign-in failed.")
        }
    } catch (t: Throwable) {
        Log.e(TAG, "Unexpected Credential Manager error", t)
        if (!isFallbackAttempt) {
            null
        } else {
            Result.Error(t.message ?: "Sign-in failed.")
        }
    }

    private const val CRED_MAN_TIMEOUT_MS = 90_000L
}

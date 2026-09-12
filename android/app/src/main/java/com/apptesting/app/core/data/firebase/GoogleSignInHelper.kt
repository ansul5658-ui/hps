package com.apptesting.app.core.data.firebase

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential

/**
 * Wraps the modern Credential Manager + Google Identity Services flow that
 * returns a Google ID token for the signed-in Google account.
 *
 * We deliberately keep this a plain suspend function: no state, no ViewModel
 * coupling. The caller (an AuthViewModel) hands us an Activity/Fragment
 * context and the Web OAuth client id, and gets back a discriminated result
 * that says whether the user cancelled, has no eligible account, or produced
 * a token that we can hand to FirebaseAuth.
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
        if (webClientId.isBlank()) {
            return Result.Error(
                "Firebase is missing a Google Web client ID. " +
                    "Enable Google sign-in in the Firebase console and re-download google-services.json.",
            )
        }
        val credentialManager = CredentialManager.create(context)
        val option = GetGoogleIdOption.Builder()
            .setServerClientId(webClientId)
            // First attempt: only accounts already authorized on this app —
            // this makes the sheet less disruptive for returning users.
            .setFilterByAuthorizedAccounts(true)
            .setAutoSelectEnabled(true)
            .build()
        val request = GetCredentialRequest.Builder().addCredentialOption(option).build()

        return runRequest(credentialManager, context, request)
            ?: runRequest(
                credentialManager,
                context,
                GetCredentialRequest.Builder().addCredentialOption(
                    GetGoogleIdOption.Builder()
                        .setServerClientId(webClientId)
                        .setFilterByAuthorizedAccounts(false)
                        .build(),
                ).build(),
            )
            ?: Result.NoAccount
    }

    /**
     * Returns null when the flow reports "no matching credential" so the
     * caller can retry with `filterByAuthorizedAccounts = false`.
     */
    private suspend fun runRequest(
        credentialManager: CredentialManager,
        context: Context,
        request: GetCredentialRequest,
    ): Result? = try {
        val response = credentialManager.getCredential(context, request)
        val credential = response.credential
        if (
            credential is CustomCredential &&
            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
        ) {
            val googleId = GoogleIdTokenCredential.createFrom(credential.data)
            Result.Token(googleId.idToken)
        } else {
            Result.Error("Unexpected credential type: ${credential.type}")
        }
    } catch (e: GetCredentialCancellationException) {
        Result.Cancelled
    } catch (e: NoCredentialException) {
        null
    } catch (e: GetCredentialException) {
        Result.Error(e.message ?: "Sign-in failed.")
    } catch (t: Throwable) {
        Result.Error(t.message ?: "Sign-in failed.")
    }
}

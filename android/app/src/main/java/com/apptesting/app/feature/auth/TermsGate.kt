package com.apptesting.app.feature.auth

import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.data.firebase.functions.CallableException
import com.apptesting.app.core.util.AppConfig

/**
 * Terms of Service + Privacy Policy gating rules (release audit F2).
 *
 * Pure so they can be unit tested without Android or Firebase. The server
 * records acceptance and refuses new actions without it; these only decide
 * what the app shows.
 */

/**
 * True when a signed-in user must see the Terms screen: nothing accepted, or
 * an older version than the one this app displays.
 */
internal fun needsTermsAcceptance(
    acceptedVersion: Int?,
    currentVersion: Int = AppConfig.TERMS_VERSION,
): Boolean = acceptedVersion == null || acceptedVersion < currentVersion

/**
 * A policy link the UI can open, or null while it has not been configured.
 * Only absolute https URLs count, so a placeholder can never be opened.
 */
internal fun policyLinkOrNull(url: String): String? =
    url.trim().takeIf { it.startsWith("https://") && it.length > "https://".length }

/**
 * True only when BOTH full policy documents can be opened. Until then the
 * Terms screen must not ask the user to confirm they have read them.
 */
internal fun policyDocumentsAvailable(
    termsUrl: String = AppConfig.TERMS_OF_SERVICE_URL,
    privacyUrl: String = AppConfig.PRIVACY_POLICY_URL,
): Boolean = policyLinkOrNull(termsUrl) != null && policyLinkOrNull(privacyUrl) != null

internal const val TERMS_ERROR_SERVICE_UNAVAILABLE =
    "We couldn't record your agreement because this service isn't available right now. Please try again later."
internal const val TERMS_ERROR_NETWORK =
    "We couldn't reach AppTesting. Check your connection and try again."
internal const val TERMS_ERROR_SIGNED_OUT =
    "Your session has ended. Please sign in again."
internal const val TERMS_ERROR_GENERIC =
    "Couldn't record your acceptance. Please try again."

/**
 * Machine text that must never reach the screen: a status token on its own or
 * leading the message (`NOT_FOUND`, `NOT_FOUND: ...`, `INTERNAL:`), or a raw
 * exception (`java.io.IOException: ...`, `com.google...Exception`).
 */
private val RAW_STATUS_TOKEN = Regex("^[A-Z][A-Z0-9_]*(:.*)?$", RegexOption.DOT_MATCHES_ALL)
private val RAW_EXCEPTION = Regex("^[a-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_$]+)+(Exception|Error)\\b.*", RegexOption.DOT_MATCHES_ALL)

/**
 * What the Terms screen says when recording acceptance failed.
 *
 * A callable that is missing or broken on the server (NOT_FOUND, INTERNAL...)
 * reaches the client with the HTTP status text as its "message", so the
 * generic callable mapping would surface e.g. a raw "NOT_FOUND". Those codes
 * get Terms-specific copy here; the server's own human-written messages
 * (e.g. "These Terms are out of date...") still pass through.
 */
internal fun termsAcceptanceErrorMessage(error: Throwable): String {
    when ((error as? CallableException)?.code) {
        "NOT_FOUND", "UNIMPLEMENTED", "INTERNAL", "UNKNOWN", "DATA_LOSS" ->
            return TERMS_ERROR_SERVICE_UNAVAILABLE
        "UNAVAILABLE", "DEADLINE_EXCEEDED" -> return TERMS_ERROR_NETWORK
        "UNAUTHENTICATED" -> return TERMS_ERROR_SIGNED_OUT
    }
    return error.message?.trim()
        ?.takeIf { it.isNotEmpty() && !RAW_STATUS_TOKEN.matches(it) && !RAW_EXCEPTION.matches(it) }
        ?: TERMS_ERROR_GENERIC
}

/** What the Terms screen shows. */
sealed interface TermsUiState {
    /** Reading the user's accepted version. */
    data object Checking : TermsUiState

    /** Acceptance required; [error] is the last failed attempt's message. */
    data class Required(val submitting: Boolean = false, val error: String? = null) : TermsUiState

    /** The current version is accepted - the screen moves on. */
    data object Accepted : TermsUiState
}

/**
 * The Terms screen's decisions, kept free of Android so they can be tested
 * with a fake [UserRepository].
 */
internal class TermsGateController(
    private val users: UserRepository,
    private val currentVersion: Int = AppConfig.TERMS_VERSION,
) {
    /** Accepted users pass straight through; everyone else must accept. */
    suspend fun resolve(): TermsUiState =
        if (needsTermsAcceptance(users.acceptedTermsVersion(), currentVersion)) {
            TermsUiState.Required()
        } else {
            TermsUiState.Accepted
        }

    /** Records acceptance of the version this app displays; stays on the screen if that fails. */
    suspend fun accept(): TermsUiState =
        users.acceptTerms(currentVersion).fold(
            onSuccess = { TermsUiState.Accepted },
            onFailure = { e -> TermsUiState.Required(error = termsAcceptanceErrorMessage(e)) },
        )
}

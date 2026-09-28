package com.apptesting.app.feature.auth

import com.apptesting.app.core.data.UserRepository
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
            onFailure = { e ->
                TermsUiState.Required(
                    error = e.message?.takeIf { it.isNotBlank() }
                        ?: "Couldn't record your acceptance. Please try again.",
                )
            },
        )
}

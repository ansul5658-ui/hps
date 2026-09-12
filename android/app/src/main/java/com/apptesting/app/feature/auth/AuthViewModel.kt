package com.apptesting.app.feature.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AuthGateway
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.data.firebase.GoogleSignInHelper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * Drives the SignInScreen.
 *
 * Two paths, chosen at runtime:
 *   * Firebase mode (google-services.json present) — talks to Credential
 *     Manager for a Google ID token and hands it to [AuthGateway]. The
 *     Firebase auth state listener drives the rest of the app.
 *   * Mock mode — no real auth is performed; the demo user is restored so
 *     the flow still lands on Terms → Main.
 */
class AuthViewModel(
    private val users: UserRepository,
) : ViewModel() {

    constructor() : this(users = ServiceLocator.userRepository)

    private val gateway: AuthGateway? = users as? AuthGateway

    private val _state = MutableStateFlow<SignInUiState>(SignInUiState.Idle)
    val state: StateFlow<SignInUiState> = _state.asStateFlow()

    val isFirebaseMode: Boolean = gateway?.isConfigured() == true

    fun onSignInPressed(context: Context) {
        if (_state.value is SignInUiState.Loading) return
        _state.value = SignInUiState.Loading
        viewModelScope.launch {
            try {
                val g = gateway
                if (g == null) {
                    // Repository doesn't support any sign-in at all — this
                    // shouldn't happen with the current wiring but we handle
                    // it gracefully so a future misconfiguration is loud.
                    _state.value = SignInUiState.Error(
                        "No authentication gateway available.",
                    )
                    return@launch
                }

                if (!g.isConfigured()) {
                    // Mock mode: restore the demo user so the rest of the
                    // app has something to render, then advance the flow.
                    delay(SHORT_TRANSITION_MS)
                    val demo = g.signInAsDemoUser()
                    _state.value = demo.fold(
                        onSuccess = { SignInUiState.Success },
                        onFailure = {
                            SignInUiState.Error(
                                it.message ?: "Couldn't start the demo session.",
                            )
                        },
                    )
                    return@launch
                }

                val webClientId = g.webClientId()
                if (webClientId.isNullOrBlank()) {
                    _state.value = SignInUiState.Error(
                        "Google sign-in isn't enabled for this Firebase project. " +
                            "Enable it in Firebase Console → Authentication → Sign-in method, " +
                            "then re-download google-services.json.",
                    )
                    return@launch
                }

                val tokenResult = GoogleSignInHelper.requestIdToken(context, webClientId)
                when (tokenResult) {
                    is GoogleSignInHelper.Result.Cancelled -> {
                        _state.value = SignInUiState.Idle
                    }
                    is GoogleSignInHelper.Result.NoAccount -> {
                        _state.value = SignInUiState.Error(
                            "No Google account is available on this device. " +
                                "Add one in Settings → Accounts and try again.",
                        )
                    }
                    is GoogleSignInHelper.Result.Error -> {
                        _state.value = SignInUiState.Error(tokenResult.message)
                    }
                    is GoogleSignInHelper.Result.Token -> {
                        val signInResult = g.signInWithGoogleIdToken(tokenResult.idToken)
                        _state.value = signInResult.fold(
                            onSuccess = { SignInUiState.Success },
                            onFailure = {
                                SignInUiState.Error(
                                    it.message ?: "Sign-in failed.",
                                )
                            },
                        )
                    }
                }
            } catch (t: CancellationException) {
                throw t
            } catch (t: Throwable) {
                _state.value = SignInUiState.Error(t.message ?: "Sign-in failed.")
            }
        }
    }

    /** Reset error / success state so the button becomes tappable again. */
    fun consume() {
        _state.value = SignInUiState.Idle
    }

    private companion object {
        const val SHORT_TRANSITION_MS = 300L
    }
}

sealed interface SignInUiState {
    object Idle : SignInUiState
    object Loading : SignInUiState
    object Success : SignInUiState
    data class Error(val message: String) : SignInUiState
}

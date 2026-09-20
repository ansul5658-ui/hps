package com.apptesting.app.feature.auth

import android.content.Context
import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AuthGateway
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.data.firebase.GoogleSignInHelper
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

private const val TAG = "AUTH_DEBUG"

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

    init {
        Log.d(
            TAG,
            "[AUTH] AuthViewModel init | gateway=${gateway?.javaClass?.simpleName} " +
                "isFirebaseMode=$isFirebaseMode",
        )
    }

    fun onSignInPressed(context: Context) {
        Log.d(TAG, "[AUTH] Google sign-in button pressed")
        if (_state.value is SignInUiState.Loading) {
            Log.d(TAG, "[AUTH] Already loading — ignoring tap")
            return
        }
        _state.value = SignInUiState.Loading
        viewModelScope.launch {
            try {
                val g = gateway
                if (g == null) {
                    Log.w(TAG, "[AUTH] No AuthGateway available on current UserRepository")
                    _state.value = SignInUiState.Error(
                        "No authentication gateway available.",
                    )
                    return@launch
                }

                if (!g.isConfigured()) {
                    Log.d(TAG, "[AUTH] Mock branch — restoring demo user")
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
                Log.d(
                    TAG,
                    "[AUTH] webClientId present=${!webClientId.isNullOrBlank()} " +
                        "length=${webClientId?.length ?: 0}",
                )
                if (webClientId.isNullOrBlank()) {
                    _state.value = SignInUiState.Error(
                        "Google sign-in isn't enabled for this Firebase project. " +
                            "Enable it in Firebase Console → Authentication → Sign-in method, " +
                            "then re-download google-services.json.",
                    )
                    return@launch
                }

                Log.d(TAG, "[AUTH] Credential Manager request started")
                val tokenResult = GoogleSignInHelper.requestIdToken(context, webClientId)
                Log.d(TAG, "[AUTH] Credential Manager result: ${tokenResult::class.simpleName}")
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
                        Log.d(TAG, "[AUTH] Google credential received")
                        val signInResult = try {
                            withTimeout(FIREBASE_TIMEOUT_MS) {
                                g.signInWithGoogleIdToken(tokenResult.idToken)
                            }
                        } catch (e: TimeoutCancellationException) {
                            Log.e(TAG, "[AUTH] FirebaseAuth+Firestore timed out after ${FIREBASE_TIMEOUT_MS}ms")
                            Result.failure(
                                IllegalStateException(
                                    "Sign-in timed out after ${FIREBASE_TIMEOUT_MS / 1000}s. " +
                                        "Check your internet connection and try again.",
                                ),
                            )
                        }
                        Log.d(TAG, "[AUTH] signInWithGoogleIdToken result — success=${signInResult.isSuccess}")
                        _state.value = signInResult.fold(
                            onSuccess = {
                                Log.d(TAG, "[AUTH] Sign-in flow completed")
                                SignInUiState.Success
                            },
                            onFailure = {
                                Log.w(TAG, "[AUTH] signInWithGoogleIdToken failed: ${it.message}")
                                SignInUiState.Error(
                                    it.message ?: "Sign-in failed.",
                                )
                            },
                        )
                    }
                }
            } catch (t: CancellationException) {
                Log.d(TAG, "[AUTH] Coroutine cancelled — likely ViewModel cleared")
                throw t
            } catch (t: Throwable) {
                Log.e(TAG, "[AUTH] Unexpected sign-in error", t)
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

        /**
         * Ceiling on the FirebaseAuth + Firestore round-trip. Well above
         * normal server latency but low enough that a broken configuration
         * surfaces as an error the user can act on instead of an infinite
         * spinner.
         */
        const val FIREBASE_TIMEOUT_MS = 45_000L
    }
}

sealed interface SignInUiState {
    object Idle : SignInUiState
    object Loading : SignInUiState
    object Success : SignInUiState
    data class Error(val message: String) : SignInUiState
}

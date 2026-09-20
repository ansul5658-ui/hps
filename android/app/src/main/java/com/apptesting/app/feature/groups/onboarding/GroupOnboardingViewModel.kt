package com.apptesting.app.feature.groups.onboarding

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.util.AppConfig
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

private const val TAG = "AUTH_DEBUG"

sealed interface GroupOnboardingState {
    object Idle : GroupOnboardingState
    object Working : GroupOnboardingState
    object Success : GroupOnboardingState
    data class Error(val message: String) : GroupOnboardingState
}

class GroupOnboardingViewModel(
    private val users: UserRepository = ServiceLocator.userRepository,
    private val groups: GroupRepository = ServiceLocator.groupRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<GroupOnboardingState>(GroupOnboardingState.Idle)
    val state: StateFlow<GroupOnboardingState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<String>()
    val events: SharedFlow<String> = _events.asSharedFlow()

    fun recordMembership(onCompleted: () -> Unit) {
        if (_state.value is GroupOnboardingState.Working) return
        _state.value = GroupOnboardingState.Working

        viewModelScope.launch {
            try {
                val user = users.currentUser.first()
                if (user == null) {
                    _state.value = GroupOnboardingState.Error("Sign in required.")
                    return@launch
                }

                Log.d(TAG, "[GROUP_ONBOARDING] Recording membership for ${AppConfig.OFFICIAL_GROUP_ID}")
                val result = groups.requestJoin(AppConfig.OFFICIAL_GROUP_ID, user.id)

                if (result.isSuccess) {
                    Log.d(TAG, "[GROUP_ONBOARDING] Membership status recorded successfully for ${user.id}")
                    _events.emit("Thanks! Your tester-group step is complete.")
                    _state.value = GroupOnboardingState.Success
                    onCompleted()
                } else {
                    val errMsg = result.exceptionOrNull()?.message ?: "Could not record group membership."
                    Log.e(TAG, "[GROUP_ONBOARDING] Failed to record membership: $errMsg")
                    _state.value = GroupOnboardingState.Error(errMsg)
                }
            } catch (t: Throwable) {
                Log.e(TAG, "[GROUP_ONBOARDING] Exception recording membership", t)
                _state.value = GroupOnboardingState.Error(t.message ?: "Could not record group membership.")
            }
        }
    }
}

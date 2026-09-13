package com.apptesting.app.feature.groups.details

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupState
import com.apptesting.app.core.model.GroupVisibility
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.launch

/**
 * Group Details ViewModel.
 *
 * Real-time state comes from two flows joined by [combine]:
 *   * `groups.observeGroup(groupId)` — the single group document.
 *   * `groups.observeMembershipFor(userId)` — filtered to this groupId.
 *
 * Join/Leave are the only mutations; both go through the repository
 * (never straight to Firestore from the composable) and are gated
 * against double-tap via a [MutationState.Working] latch. Errors are
 * surfaced as one-shot [DetailsEvent.Message] snackbar events without
 * overwriting the observed content — a failed join leaves the user
 * exactly where they were, non-member and able to try again.
 */
class GroupDetailsViewModel(
    private val groupId: String,
    private val users: UserRepository,
    private val groups: GroupRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<GroupDetailsUiState>(GroupDetailsUiState.Loading)
    val state: StateFlow<GroupDetailsUiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<DetailsEvent>()
    val events: SharedFlow<DetailsEvent> = _events.asSharedFlow()

    /**
     * A latch separate from [state] so a mutation-in-flight doesn't get
     * wiped out by a snapshot re-emission from the observing combine().
     */
    private val mutation = MutableStateFlow<MutationState>(MutationState.Idle)

    private var currentUserId: String? = null

    init {
        observe()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { user ->
                if (user == null) {
                    // Signed out — send a fresh Loading and stop combining.
                    // AppNavHost is the layer responsible for routing back to
                    // SignIn; this VM just stays quiet.
                    currentUserId = null
                    flowOf<GroupDetailsUiState>(GroupDetailsUiState.Loading)
                } else {
                    currentUserId = user.id
                    combine(
                        groups.observeGroup(groupId),
                        groups.observeMembershipFor(user.id),
                        mutation,
                    ) { group, memberships, mut ->
                        if (group == null) {
                            GroupDetailsUiState.NotFound
                        } else {
                            val isMember = memberships.any { it.groupId == groupId }
                            GroupDetailsUiState.Content(
                                group = group,
                                isMember = isMember,
                                canJoin = computeCanJoin(group, isMember),
                                mutation = mut,
                            )
                        }
                    }
                }
            }
            .catch { emit(GroupDetailsUiState.Error(it.message ?: "Failed to load group.")) }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }

    fun join() {
        val uid = currentUserId ?: run {
            viewModelScope.launch { _events.emit(DetailsEvent.Message("Sign in required.")) }
            return
        }
        if (mutation.value is MutationState.Working) return
        mutation.value = MutationState.Working
        viewModelScope.launch {
            val res = groups.requestJoin(groupId, uid)
            mutation.value = MutationState.Idle
            if (res.isSuccess) {
                _events.emit(DetailsEvent.Message("Joined."))
            } else {
                _events.emit(
                    DetailsEvent.Message(
                        res.exceptionOrNull()?.message ?: "Couldn't join. Please try again.",
                    ),
                )
            }
        }
    }

    fun leave() {
        val uid = currentUserId ?: run {
            viewModelScope.launch { _events.emit(DetailsEvent.Message("Sign in required.")) }
            return
        }
        if (mutation.value is MutationState.Working) return
        mutation.value = MutationState.Working
        viewModelScope.launch {
            val res = groups.leave(groupId, uid)
            mutation.value = MutationState.Idle
            if (res.isSuccess) {
                _events.emit(DetailsEvent.Message("You left the group."))
            } else {
                _events.emit(
                    DetailsEvent.Message(
                        res.exceptionOrNull()?.message ?: "Couldn't leave. Please try again.",
                    ),
                )
            }
        }
    }

    private fun computeCanJoin(g: Group, isMember: Boolean): Boolean =
        !isMember &&
            g.visibility != GroupVisibility.Private &&
            g.state != GroupState.Full &&
            g.state != GroupState.Completed &&
            g.state != GroupState.Archived &&
            g.state != GroupState.Cancelled &&
            (g.memberCap == 0 || g.currentMemberCount < g.memberCap)
}

sealed interface DetailsEvent {
    data class Message(val text: String) : DetailsEvent
}

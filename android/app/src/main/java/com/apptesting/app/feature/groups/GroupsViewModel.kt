package com.apptesting.app.feature.groups

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
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

private const val TAG = "AUTH_DEBUG"

class GroupsViewModel(
    private val users: UserRepository,
    private val groups: GroupRepository,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        groups = ServiceLocator.groupRepository,
    )

    private val _state = MutableStateFlow<GroupsUiState>(GroupsUiState.Loading)
    val state: StateFlow<GroupsUiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<GroupsEvent>()
    val events: SharedFlow<GroupsEvent> = _events.asSharedFlow()

    private var currentUserId: String? = null

    init {
        observe()
    }

    fun onJoin(groupId: String) {
        val uid = currentUserId ?: return
        viewModelScope.launch {
            val result = groups.requestJoin(groupId, uid)
            if (result.isFailure) {
                _events.emit(GroupsEvent.Message(result.exceptionOrNull()?.message ?: "Couldn't join."))
            } else {
                _events.emit(GroupsEvent.Message("Joined."))
            }
        }
    }

    fun onLeave(groupId: String) {
        val uid = currentUserId ?: return
        viewModelScope.launch {
            groups.leave(groupId, uid)
            _events.emit(GroupsEvent.Message("Left the group."))
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { user ->
                currentUserId = user?.id
                if (user == null) {
                    flowOf<GroupsUiState>(GroupsUiState.Loading)
                } else {
                    combine(
                        groups.observeGroups().catch { e -> Log.e(TAG, "[GROUPS] observeGroups failed", e); emit(emptyList()) },
                        groups.observeMembershipFor(user.id).catch { e -> Log.e(TAG, "[GROUPS] observeMembershipFor failed", e); emit(emptyList()) },
                    ) { all, memberships -> build(all, memberships) }
                }
            }
            .catch { emit(GroupsUiState.Error(it.message ?: "Failed to load groups.")) }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }

    private fun build(all: List<Group>, memberships: List<GroupMember>): GroupsUiState {
        val membershipGroupIds = memberships.map { it.groupId }.toSet()
        val rows = all.map { g ->
            val member = membershipGroupIds.contains(g.id)
            GroupRow(
                id = g.id,
                name = g.name,
                summary = g.summary,
                memberCount = g.currentMemberCount,
                state = g.state,
                isMember = member,
            )
        }
        return GroupsUiState.Content(rows)
    }
}

sealed interface GroupsEvent {
    data class Message(val text: String) : GroupsEvent
}

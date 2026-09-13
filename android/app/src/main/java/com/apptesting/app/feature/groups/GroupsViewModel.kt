package com.apptesting.app.feature.groups

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

/**
 * Groups list ViewModel.
 *
 * Observes the groups collection and the current user's membership
 * subcollection in parallel and joins them into UI rows. Join and Leave
 * live on [com.apptesting.app.feature.groups.details.GroupDetailsViewModel]
 * now, so this class only reads — no writes, no snackbar events.
 */
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

    init {
        observe()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { user ->
                if (user == null) {
                    flowOf<GroupsUiState>(GroupsUiState.Loading)
                } else {
                    combine(
                        groups.observeGroups(),
                        groups.observeMembershipFor(user.id),
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
            GroupRow(
                id = g.id,
                name = g.name,
                summary = g.summary,
                memberCount = g.currentMemberCount,
                state = g.state,
                isMember = membershipGroupIds.contains(g.id),
            )
        }
        return GroupsUiState.Content(rows)
    }
}

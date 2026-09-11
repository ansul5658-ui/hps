package com.apptesting.app.feature.myapps

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.Group
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

class MyAppsViewModel(
    private val users: UserRepository,
    private val apps: AppRepository,
    private val groups: GroupRepository,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
        groups = ServiceLocator.groupRepository,
    )

    private val _state = MutableStateFlow<MyAppsUiState>(MyAppsUiState.Loading)
    val state: StateFlow<MyAppsUiState> = _state.asStateFlow()

    init {
        observe()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { user ->
                if (user == null) flowOf<MyAppsUiState>(MyAppsUiState.Loading)
                else combine(
                    apps.observeMyApps(user.id),
                    groups.observeGroups(),
                ) { myApps, allGroups -> build(myApps, allGroups) }
            }
            .catch { emit(MyAppsUiState.Error(it.message ?: "Failed to load your apps.")) }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }

    private fun build(myApps: List<AppSubmission>, allGroups: List<Group>): MyAppsUiState {
        val groupsById = allGroups.associateBy { it.id }
        val rows = myApps.map { app ->
            MyAppRow(
                id = app.id,
                name = app.name,
                packageName = app.packageName,
                versionName = app.versionName.ifBlank { "—" },
                approvalStatus = app.approvalStatus,
                testerCount = app.testerCount,
                completedTesterCount = app.completedTesterCount,
                activeGroupName = app.activeGroupId?.let { groupsById[it]?.name },
            )
        }
        return MyAppsUiState.Content(rows)
    }
}

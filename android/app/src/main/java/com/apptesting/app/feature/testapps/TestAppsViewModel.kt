package com.apptesting.app.feature.testapps

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.TestAssignment
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
import kotlinx.coroutines.launch

class TestAppsViewModel(
    private val users: UserRepository,
    private val apps: AppRepository,
    private val assignments: AssignmentRepository,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
        assignments = ServiceLocator.assignmentRepository,
    )

    private val filter = MutableStateFlow(TestFilter.All)
    private val _state = MutableStateFlow<TestAppsUiState>(TestAppsUiState.Loading)
    val state: StateFlow<TestAppsUiState> = _state.asStateFlow()

    init {
        observe()
    }

    fun setFilter(newFilter: TestFilter) {
        filter.value = newFilter
    }

    fun onCheckIn(assignmentId: String) {
        viewModelScope.launch { assignments.recordDayOfTesting(assignmentId) }
    }

    fun onMarkComplete(assignmentId: String) {
        viewModelScope.launch { assignments.requestCompletion(assignmentId) }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { user ->
                if (user == null) flowOf<TestAppsUiState>(TestAppsUiState.Loading)
                else combine(
                    apps.observeAvailableApps(excludeOwnerId = user.id),
                    assignments.observeAssignmentsForUser(user.id),
                    filter,
                ) { available, myAssignments, currentFilter ->
                    build(available, myAssignments, currentFilter)
                }
            }
            .catch { emit(TestAppsUiState.Error(it.message ?: "Failed to load testing apps.")) }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }

    private fun build(
        availableApps: List<AppSubmission>,
        myAssignments: List<TestAssignment>,
        currentFilter: TestFilter,
    ): TestAppsUiState.Content {
        val assignmentByAppId = myAssignments.associateBy { it.appId }
        val rows = availableApps
            .filter { it.approvalStatus == AppApprovalStatus.Approved }
            .map { app ->
                val a = assignmentByAppId[app.id]
                TestRow(
                    assignmentId = a?.id,
                    appId = app.id,
                    appName = app.name,
                    packageName = app.packageName,
                    developerLabel = shortenOwner(app.ownerUserId),
                    coinReward = a?.coinReward ?: DEFAULT_REWARD,
                    daysRequired = a?.daysRequired ?: DEFAULT_DAYS,
                    daysCompleted = a?.daysCompleted ?: 0,
                    status = a?.status,
                )
            }
        val visibleRows = when (currentFilter) {
            TestFilter.All -> rows
            TestFilter.InProgress -> rows.filter {
                it.status == AssignmentStatus.InProgress ||
                    it.status == AssignmentStatus.WaitingForVerification ||
                    it.status == AssignmentStatus.Ready
            }
            TestFilter.Available -> rows.filter { it.status == null }
        }
        return TestAppsUiState.Content(currentFilter, visibleRows)
    }

    private fun shortenOwner(id: String): String = when (id) {
        "u_me" -> "You"
        else -> "Developer #" + id.takeLast(4)
    }

    private companion object {
        const val DEFAULT_REWARD = 50
        const val DEFAULT_DAYS = 14
    }
}

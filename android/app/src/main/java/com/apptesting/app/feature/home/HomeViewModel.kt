package com.apptesting.app.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.NotificationRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.Notification
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
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

class HomeViewModel(
    private val users: UserRepository,
    private val apps: AppRepository,
    private val groups: GroupRepository,
    private val assignments: AssignmentRepository,
    private val notifications: NotificationRepository,
) : ViewModel() {

    // Compose's viewModel() default factory uses reflection on a no-arg
    // constructor; Kotlin doesn't synthesize one for classes with default
    // parameters, so declare it explicitly and hand in the ServiceLocator
    // repositories.
    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
        groups = ServiceLocator.groupRepository,
        assignments = ServiceLocator.assignmentRepository,
        notifications = ServiceLocator.notificationRepository,
    )

    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        observe()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { user ->
                if (user == null) {
                    flowOf<HomeUiState>(HomeUiState.Loading)
                } else {
                    combine(
                        apps.observeMyApps(user.id),
                        groups.observeGroups(),
                        groups.observeMembershipFor(user.id),
                        assignments.observeAssignmentsForUser(user.id),
                        notifications.observeUnread(user.id),
                    ) { myApps, allGroups, memberships, myAssignments, unread ->
                        buildContent(user, myApps, allGroups, memberships, myAssignments, unread)
                    }
                }
            }
            .catch { throwable ->
                emit(HomeUiState.Error(throwable.message ?: "Something went wrong loading your dashboard."))
            }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }

    private fun buildContent(
        user: User,
        myApps: List<AppSubmission>,
        allGroups: List<Group>,
        memberships: List<GroupMember>,
        myAssignments: List<TestAssignment>,
        unread: List<Notification>,
    ): HomeUiState {
        val appNameById = myApps.associateBy { it.id }.toMutableMap()
        // Assignment rows may reference apps not owned by the current user, so
        // fill the name using the full apps flow when we have it — for now the
        // ViewModel only holds myApps; we look up via the Home store lazily.
        val activeGroup = allGroups.firstOrNull { g -> memberships.any { it.groupId == g.id } }
        val rows = myAssignments
            .filter { it.status != AssignmentStatus.Completed && it.status != AssignmentStatus.Missed }
            .sortedBy { it.status.ordinal }
            .take(4)
            .map { a ->
                HomeAssignmentRow(
                    id = a.id,
                    appId = a.appId,
                    appName = appNameById[a.appId]?.name ?: a.appId.substringAfter("app_").replaceFirstChar { it.uppercase() },
                    status = a.status,
                    daysCompleted = a.daysCompleted,
                    daysRequired = a.daysRequired,
                    coinReward = a.coinReward,
                )
            }
        return HomeUiState.Content(
            displayName = user.displayName.ifBlank { "Developer" },
            coinBalance = user.coinBalance,
            trustScore = user.trustScore,
            appsSubmitted = myApps.size,
            appsInReview = myApps.count { it.approvalStatus == AppApprovalStatus.PendingReview },
            testingTasks = myAssignments.count { it.status == AssignmentStatus.InProgress || it.status == AssignmentStatus.Ready },
            completedTests = myAssignments.count { it.status == AssignmentStatus.Completed },
            currentGroupName = activeGroup?.name,
            currentGroupEmail = activeGroup?.googleGroupEmail,
            currentAssignments = rows,
            unreadNotifications = unread.size,
        )
    }
}

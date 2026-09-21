package com.apptesting.app.feature.home

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.CoinRepository
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.NotificationRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinWallet
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
import kotlinx.coroutines.flow.onStart

private const val TAG = "AUTH_DEBUG"

class HomeViewModel(
    private val users: UserRepository,
    private val apps: AppRepository,
    private val groups: GroupRepository,
    private val assignments: AssignmentRepository,
    private val notifications: NotificationRepository,
    private val coins: CoinRepository,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
        groups = ServiceLocator.groupRepository,
        assignments = ServiceLocator.assignmentRepository,
        notifications = ServiceLocator.notificationRepository,
        coins = ServiceLocator.coinRepository,
    )

    private val _state = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    init {
        observe()
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        Log.d(TAG, "[HOME] pipeline started")
        Log.d(TAG, "[FLOW] Home loading started")
        users.currentUser
            .flatMapLatest { user ->
                Log.d(TAG, "[HOME] currentUser received id=${user?.id}")
                Log.d(TAG, "[FLOW] HomeViewModel user flatMap = ${user?.id}")
                if (user == null) {
                    flowOf<HomeUiState>(HomeUiState.Loading)
                } else {
                    Log.d(TAG, "[HOME] starting user-dependent data")

                    val myAppsFlow = apps.observeMyApps(user.id)
                        .onStart { Log.d(TAG, "[HOME] starting apps flow") }
                        .onEach { Log.d(TAG, "[HOME] apps emitted size=${it.size}") }
                        .catch { e ->
                            Log.e(TAG, "[HOME] apps flow FAILED", e)
                            emit(emptyList())
                        }

                    val groupsFlow = groups.observeGroups()
                        .onStart { Log.d(TAG, "[HOME] starting groups flow") }
                        .onEach { Log.d(TAG, "[HOME] groups emitted size=${it.size}") }
                        .catch { e ->
                            Log.e(TAG, "[HOME] groups flow FAILED", e)
                            emit(emptyList())
                        }

                    val membershipsFlow = groups.observeMembershipFor(user.id)
                        .onStart { Log.d(TAG, "[HOME] starting memberships flow") }
                        .onEach { Log.d(TAG, "[HOME] memberships emitted size=${it.size}") }
                        .catch { e ->
                            Log.e(TAG, "[HOME] memberships flow FAILED", e)
                            emit(emptyList())
                        }

                    val assignmentsFlow = assignments.observeAssignmentsForUser(user.id)
                        .onStart { Log.d(TAG, "[HOME] starting tests flow") }
                        .onEach { Log.d(TAG, "[HOME] tests emitted size=${it.size}") }
                        .catch { e ->
                            Log.e(TAG, "[HOME] tests flow FAILED", e)
                            emit(emptyList())
                        }

                    val notificationsFlow = notifications.observeUnread(user.id)
                        .onStart { Log.d(TAG, "[HOME] starting notifications flow") }
                        .onEach { Log.d(TAG, "[HOME] notifications emitted size=${it.size}") }
                        .catch { e ->
                            Log.e(TAG, "[HOME] notifications flow FAILED", e)
                            emit(emptyList())
                        }

                    val walletFlow = coins.observeWallet(user.id)
                        .onStart { Log.d(TAG, "[HOME] starting wallet flow") }
                        .onEach { Log.d(TAG, "[HOME] wallet emitted available=${it.available}") }
                        .catch { e ->
                            Log.e(TAG, "[HOME] wallet flow FAILED", e)
                            emit(CoinWallet.EMPTY)
                        }

                    // Six sources, so this is the vararg `combine` that hands
                    // back an Array rather than named parameters — the same
                    // form TestAppsViewModel uses. The indices below must stay
                    // in step with the order above.
                    combine(
                        myAppsFlow,
                        groupsFlow,
                        membershipsFlow,
                        assignmentsFlow,
                        notificationsFlow,
                        walletFlow,
                    ) { values ->
                        Log.d(TAG, "[HOME] combined data emitted")
                        Log.d(TAG, "[HOME] mapping HomeUiState")
                        @Suppress("UNCHECKED_CAST")
                        val content = buildContent(
                            user = user,
                            myApps = values[0] as List<AppSubmission>,
                            allGroups = values[1] as List<Group>,
                            memberships = values[2] as List<GroupMember>,
                            myAssignments = values[3] as List<TestAssignment>,
                            unread = values[4] as List<Notification>,
                            wallet = values[5] as CoinWallet,
                        )
                        Log.d(TAG, "[HOME] Home state = Content")
                        Log.d(TAG, "[FLOW] Home loading finished")
                        content
                    }
                }
            }
            .catch { throwable ->
                Log.e(TAG, "[HOME] pipeline FAILED", throwable)
                Log.e(TAG, "[FLOW] Home loading error", throwable)
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
        wallet: CoinWallet,
    ): HomeUiState {
        val appNameById = myApps.associateBy { it.id }.toMutableMap()
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
                    // The SAME rule Test Apps renders by, shared rather than
                    // repeated: a reward-era assignment staked nothing, so it
                    // must not appear here as a live 50-coin commitment.
                    commitmentAmount = a.displayedCommitmentAmount,
                )
            }
        return HomeUiState.Content(
            displayName = user.displayName.ifBlank { "Developer" },
            wallet = wallet,
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

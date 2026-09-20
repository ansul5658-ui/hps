package com.apptesting.app.feature.admin

import android.util.Log
import androidx.compose.runtime.Immutable
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AdminRepository
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.UserRole
import com.apptesting.app.core.util.AppConfig
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

sealed interface AdminUiState {
    object Loading : AdminUiState
    object AccessDenied : AdminUiState
    data class Error(val message: String) : AdminUiState

    @Immutable
    data class Content(
        val totalUsers: Int,
        val totalApps: Int,
        val activeTestingApps: Int,
        val completedTests: Int,
        val activeTestersCount: Int,
        val officialGroupMemberCount: Int,
        val usersList: List<User>,
        val appsList: List<AppSubmission>,
        val assignmentsList: List<TestAssignment>,
        val officialGroup: Group?,
    ) : AdminUiState
}

sealed interface AdminEvent {
    data class Message(val text: String) : AdminEvent
}

class AdminDashboardViewModel(
    private val users: UserRepository = ServiceLocator.userRepository,
    private val admin: AdminRepository = ServiceLocator.adminRepository,
    private val groups: GroupRepository = ServiceLocator.groupRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<AdminUiState>(AdminUiState.Loading)
    val state: StateFlow<AdminUiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<AdminEvent>()
    val events: SharedFlow<AdminEvent> = _events.asSharedFlow()

    init {
        observe()
    }

    fun approveApp(appId: String) {
        viewModelScope.launch {
            val result = admin.setAppStatus(appId, AppApprovalStatus.Approved)
            if (result.isSuccess) {
                // The backend runs tester matching as part of approval.
                _events.emit(AdminEvent.Message("App approved — matching testers."))
            } else {
                _events.emit(AdminEvent.Message(result.exceptionOrNull()?.message ?: "Failed to approve app."))
            }
        }
    }

    /** Re-run tester matching for an already approved app. */
    fun assignTesters(appId: String) {
        viewModelScope.launch {
            val result = admin.assignTesters(appId)
            result.fold(
                onSuccess = { created ->
                    _events.emit(
                        AdminEvent.Message(
                            when (created) {
                                0 -> "No new testers were eligible right now."
                                1 -> "Assigned 1 tester."
                                else -> "Assigned $created testers."
                            },
                        ),
                    )
                },
                onFailure = { error ->
                    _events.emit(AdminEvent.Message(error.message ?: "Couldn't assign testers."))
                },
            )
        }
    }

    /** Edit the official group's name/summary/rules/member cap via the secure backend. */
    fun updateGroup(groupId: String, name: String, summary: String, rules: String, memberCap: Int) {
        viewModelScope.launch {
            val result = admin.upsertGroup(
                groupId = groupId,
                name = name,
                summary = summary,
                rules = rules,
                memberCap = memberCap,
            )
            if (result.isSuccess) {
                _events.emit(AdminEvent.Message("Group updated."))
            } else {
                _events.emit(AdminEvent.Message(result.exceptionOrNull()?.message ?: "Failed to update group."))
            }
        }
    }

    fun rejectApp(appId: String) {
        viewModelScope.launch {
            val result = admin.setAppStatus(appId, AppApprovalStatus.Rejected)
            if (result.isSuccess) {
                _events.emit(AdminEvent.Message("App rejected."))
            } else {
                _events.emit(AdminEvent.Message(result.exceptionOrNull()?.message ?: "Failed to reject app."))
            }
        }
    }

    fun setAppStatus(appId: String, status: AppApprovalStatus) {
        viewModelScope.launch {
            val result = admin.setAppStatus(appId, status)
            if (result.isSuccess) {
                _events.emit(AdminEvent.Message("App status updated to ${status.name}."))
            } else {
                _events.emit(AdminEvent.Message(result.exceptionOrNull()?.message ?: "Failed to update status."))
            }
        }
    }

    fun toggleUserSuspension(userId: String, currentSuspended: Boolean) {
        viewModelScope.launch {
            val result = admin.setUserSuspended(userId, !currentSuspended)
            if (result.isSuccess) {
                val action = if (!currentSuspended) "suspended" else "unsuspended"
                _events.emit(AdminEvent.Message("User $action."))
            } else {
                _events.emit(AdminEvent.Message(result.exceptionOrNull()?.message ?: "Failed to update user status."))
            }
        }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { currentUser ->
                if (currentUser == null) {
                    flowOf<AdminUiState>(AdminUiState.AccessDenied)
                } else if (currentUser.role != UserRole.Admin) {
                    Log.w(TAG, "[ADMIN] Access denied for non-admin user ${currentUser.id} with role ${currentUser.role}")
                    flowOf<AdminUiState>(AdminUiState.AccessDenied)
                } else {
                    combine(
                        admin.observeAllUsers().catch { e -> Log.e(TAG, "[ADMIN] observeAllUsers failed", e); emit(emptyList()) },
                        admin.observeAllApps().catch { e -> Log.e(TAG, "[ADMIN] observeAllApps failed", e); emit(emptyList()) },
                        admin.observeAllAssignments().catch { e -> Log.e(TAG, "[ADMIN] observeAllAssignments failed", e); emit(emptyList()) },
                        groups.observeGroup(AppConfig.OFFICIAL_GROUP_ID).catch { e -> Log.e(TAG, "[ADMIN] observeGroup failed", e); emit(null) },
                    ) { usersList, appsList, assignmentsList, officialGroup ->
                        AdminUiState.Content(
                            totalUsers = usersList.size,
                            totalApps = appsList.size,
                            activeTestingApps = appsList.count { it.approvalStatus == AppApprovalStatus.Approved },
                            completedTests = assignmentsList.count { it.status == AssignmentStatus.Completed },
                            activeTestersCount = assignmentsList.map { it.testerUserId }.distinct().size,
                            officialGroupMemberCount = officialGroup?.currentMemberCount ?: 0,
                            usersList = usersList,
                            appsList = appsList,
                            assignmentsList = assignmentsList,
                            officialGroup = officialGroup,
                        )
                    }
                }
            }
            .catch { emit(AdminUiState.Error(it.message ?: "Failed to load admin dashboard.")) }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }
}

package com.apptesting.app.feature.testapps

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.LogDayResult
import com.apptesting.app.core.data.NotificationRepository
import com.apptesting.app.core.data.QuickTestRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.StartQuickTestResult
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.QuickTestAllowance
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import com.apptesting.app.core.util.AppConfig
import com.apptesting.app.core.util.TimeProvider
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

class TestAppsViewModel(
    private val users: UserRepository,
    private val apps: AppRepository,
    private val assignments: AssignmentRepository,
    private val quickTests: QuickTestRepository,
    private val notifications: NotificationRepository,
    private val time: TimeProvider,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
        assignments = ServiceLocator.assignmentRepository,
        quickTests = ServiceLocator.quickTestRepository,
        notifications = ServiceLocator.notificationRepository,
        time = TimeProvider.Default,
    )

    private val filter = MutableStateFlow(TestFilter.All)
    private val _state = MutableStateFlow<TestAppsUiState>(TestAppsUiState.Loading)
    val state: StateFlow<TestAppsUiState> = _state.asStateFlow()

    private val _events = MutableSharedFlow<TestAppsEvent>()
    val events: SharedFlow<TestAppsEvent> = _events.asSharedFlow()

    init {
        observe()
    }

    fun setFilter(newFilter: TestFilter) {
        filter.value = newFilter
    }

    /**
     * Start a Quick Test.
     *
     * Nothing is written locally and no optimistic state is applied: the
     * server owns the daily limit, the cooldown and the session itself, so the
     * UI simply reflects what comes back. The listener on the allowance
     * re-emits the new count on its own.
     */
    fun onStartQuickTest(appId: String) {
        viewModelScope.launch {
            when (val result = quickTests.startQuickTest(appId)) {
                is StartQuickTestResult.Started ->
                    _events.emit(
                        TestAppsEvent.QuickTestStarted(appId, result.remainingToday),
                    )
                StartQuickTestResult.AlreadyToday ->
                    _events.emit(
                        TestAppsEvent.Message("You've already Quick Tested this app today."),
                    )
                is StartQuickTestResult.Error ->
                    _events.emit(TestAppsEvent.Message(result.message))
            }
        }
    }

    fun onCheckIn(assignmentId: String) {
        viewModelScope.launch {
            when (val result = assignments.recordDayOfTesting(assignmentId)) {
                is LogDayResult.Logged -> Unit
                LogDayResult.AlreadyLoggedToday ->
                    _events.emit(TestAppsEvent.Message("You've already logged today for this app."))
                is LogDayResult.Error ->
                    _events.emit(TestAppsEvent.Message(result.message))
            }
        }
    }

    fun onMarkComplete(assignmentId: String) {
        viewModelScope.launch { assignments.requestCompletion(assignmentId) }
    }

    @OptIn(ExperimentalCoroutinesApi::class)
    private fun observe() {
        users.currentUser
            .flatMapLatest { user ->
                if (user == null) {
                    flowOf<TestAppsUiState>(TestAppsUiState.Loading)
                } else {
                    // Every one of these is a read of server-owned state. A
                    // failure in any single stream degrades that section to
                    // empty rather than taking the whole screen down — a
                    // missing discovery pool must not hide the assignments.
                    combine(
                        apps.observeAvailableApps(excludeOwnerId = user.id)
                            .catch { e -> Log.e(TAG, "[TEST_APPS] observeAvailableApps failed", e); emit(emptyList()) },
                        assignments.observeAssignmentsForUser(user.id)
                            .catch { e -> Log.e(TAG, "[TEST_APPS] observeAssignmentsForUser failed", e); emit(emptyList()) },
                        quickTests.observePoolAppIds()
                            .catch { e -> Log.e(TAG, "[TEST_APPS] observePoolAppIds failed", e); emit(emptyList()) },
                        quickTests.observeAllowance(user.id)
                            .catch { e -> Log.e(TAG, "[TEST_APPS] observeAllowance failed", e); emit(emptyAllowance()) },
                        notifications.observeUnread(user.id)
                            .catch { e -> Log.e(TAG, "[TEST_APPS] observeUnread failed", e); emit(emptyList()) },
                        filter,
                    ) { values ->
                        @Suppress("UNCHECKED_CAST")
                        build(
                            user = user,
                            availableApps = values[0] as List<AppSubmission>,
                            myAssignments = values[1] as List<TestAssignment>,
                            poolAppIds = values[2] as List<String>,
                            allowance = values[3] as QuickTestAllowance,
                            unreadCount = (values[4] as List<*>).size,
                            currentFilter = values[5] as TestFilter,
                        )
                    }
                }
            }
            .catch { emit(TestAppsUiState.Error(it.message ?: "Failed to load testing apps.")) }
            .onEach { _state.value = it }
            .launchIn(viewModelScope)
    }

    private fun emptyAllowance() = QuickTestAllowance(
        dayKey = time.todayKey(),
        usedToday = 0,
        dailyLimit = AppConfig.QUICK_TEST_DAILY_LIMIT,
    )

    private fun build(
        user: User,
        availableApps: List<AppSubmission>,
        myAssignments: List<TestAssignment>,
        poolAppIds: List<String>,
        allowance: QuickTestAllowance,
        unreadCount: Int,
        currentFilter: TestFilter,
    ): TestAppsUiState.Content {
        val today = time.todayKey()

        // Section 1 — Quick Tests. Pure, and unit tested in
        // QuickTestSelectionTest; this is presentation filtering only, and the
        // server re-checks every rule on the actual call.
        val quickTestCards = QuickTestSelection.select(
            poolAppIds = poolAppIds,
            apps = availableApps,
            currentUserId = user.id,
            allowance = allowance,
            todayKey = today,
            cooldownDays = AppConfig.QUICK_TEST_COOLDOWN_DAYS,
            limit = AppConfig.QUICK_TEST_MIN_VISIBLE,
        )

        // Section 2 — structured commitments. Unchanged behaviour: testers are
        // still matched server-side, and this batch deliberately does NOT add
        // joining or coin locking.
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
                    daysRequired = a?.daysRequired ?: DEFAULT_DAYS,
                    daysCompleted = a?.daysCompleted ?: 0,
                    status = a?.status,
                    loggedToday = a?.lastLoggedDayKey == today,
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

        return TestAppsUiState.Content(
            filter = currentFilter,
            quickTests = quickTestCards,
            quickTestsRemainingToday = allowance.remainingToday,
            quickTestDailyLimit = allowance.dailyLimit,
            rows = visibleRows,
            coinBalance = user.coinBalance,
            unreadNotifications = unreadCount,
        )
    }

    private fun shortenOwner(id: String): String = when (id) {
        "u_me" -> "You"
        else -> "Developer #" + id.takeLast(4)
    }

    private companion object {
        const val DEFAULT_DAYS = 14
    }
}

sealed interface TestAppsEvent {
    data class Message(val text: String) : TestAppsEvent

    /**
     * A Quick Test session was opened server-side.
     *
     * Carries the app id so the screen can send the user to the app, and the
     * server's own remaining count so the confirmation never guesses.
     */
    data class QuickTestStarted(val appId: String, val remainingToday: Int) : TestAppsEvent
}

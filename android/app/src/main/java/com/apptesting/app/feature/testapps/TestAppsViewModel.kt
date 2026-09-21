package com.apptesting.app.feature.testapps

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.ClaimAssignmentResult
import com.apptesting.app.core.data.CoinRepository
import com.apptesting.app.core.data.LogDayResult
import com.apptesting.app.core.data.NotificationRepository
import com.apptesting.app.core.data.QuickTestRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.StartQuickTestResult
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinWallet
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
    private val coins: CoinRepository,
    private val time: TimeProvider,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
        assignments = ServiceLocator.assignmentRepository,
        quickTests = ServiceLocator.quickTestRepository,
        notifications = ServiceLocator.notificationRepository,
        coins = ServiceLocator.coinRepository,
        time = TimeProvider.Default,
    )

    /**
     * One claim in flight at a time.
     *
     * A UI-level courtesy only. The server refuses a duplicate claim outright
     * (the active-claim document is written with `tx.create`), so this prevents
     * a pointless second round trip rather than providing the guarantee.
     */
    private val claiming = java.util.concurrent.atomic.AtomicBoolean(false)

    /**
     * Assignments with a check-in request in flight.
     *
     * A UI-level courtesy only. The server's deterministic log id and
     * `tx.create` are what actually make a duplicate impossible; this just
     * avoids a redundant round trip on a double tap.
     */
    private val checkingIn = java.util.Collections.synchronizedSet(mutableSetOf<String>())

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

    /**
     * Record today's testing day on the server.
     *
     * Nothing is incremented locally. The day count, the completion and the
     * returned coins all arrive through the Firestore listeners this screen
     * already collects, so the UI shows what the server actually stored rather
     * than an optimistic guess that could disagree with it.
     *
     * A duplicate tap is safe: the in-flight guard avoids a pointless second
     * round trip, and the server treats a same-day repeat as a no-op anyway.
     */
    fun onCheckIn(assignmentId: String) {
        if (!checkingIn.add(assignmentId)) return
        viewModelScope.launch {
            try {
                when (val result = assignments.recordDayOfTesting(assignmentId)) {
                    is LogDayResult.Logged ->
                        if (result.completed) {
                            _events.emit(
                                TestAppsEvent.Message(
                                    "Commitment complete — your Testing Coins have been returned.",
                                ),
                            )
                        } else {
                            _events.emit(
                                TestAppsEvent.Message(
                                    "Day ${result.daysCompleted} of ${result.daysRequired} recorded.",
                                ),
                            )
                        }
                    LogDayResult.AlreadyLoggedToday ->
                        _events.emit(
                            TestAppsEvent.Message("You've already logged today for this app."),
                        )
                    is LogDayResult.Error ->
                        _events.emit(TestAppsEvent.Message(result.message))
                }
            } finally {
                checkingIn.remove(assignmentId)
            }
        }
    }


    /**
     * Commit Testing Coins to an app and claim a testing assignment.
     *
     * Deliberately does NOT adjust any balance locally. The wallet flow this
     * screen already collects is the authority, so the chip and the row update
     * when the server's write lands — not optimistically. Guessing here would
     * show coins as committed even when the claim lost a race for the last 50.
     */
    fun onClaimAssignment(appId: String) {
        if (!claiming.compareAndSet(false, true)) return
        viewModelScope.launch {
            try {
                when (val result = assignments.claimAssignment(appId)) {
                    is ClaimAssignmentResult.Claimed ->
                        _events.emit(
                            TestAppsEvent.Committed(appId, result.committedAmount),
                        )
                    ClaimAssignmentResult.AlreadyCommitted ->
                        _events.emit(
                            TestAppsEvent.Message("You're already testing this app."),
                        )
                    is ClaimAssignmentResult.InsufficientCoins ->
                        _events.emit(TestAppsEvent.Message(result.message))
                    is ClaimAssignmentResult.Error ->
                        _events.emit(TestAppsEvent.Message(result.message))
                }
            } finally {
                claiming.set(false)
            }
        }
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
                        coins.observeWallet(user.id)
                            .catch { e -> Log.e(TAG, "[TEST_APPS] observeWallet failed", e); emit(CoinWallet.EMPTY) },
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
                            wallet = values[5] as CoinWallet,
                            currentFilter = values[6] as TestFilter,
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
        wallet: CoinWallet,
        currentFilter: TestFilter,
    ): TestAppsUiState.Content {
        val today = time.todayKey()
        // Quick Test cooldowns still key off a UTC day string, which is
        // per-viewer display only. The commitment check-in deliberately does
        // not: it compares instants. See `loggedToday` below.
        val now = time.nowMillis()

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
                    // Server-authoritative. The server stamps the instant
                    // today's check-in expires, in the commitment's PINNED
                    // zone; this only asks whether that instant has passed.
                    // Comparing `lastQualifyingDayKey` against a UTC day key
                    // used to put the client 5.5 hours out of step with the
                    // server every night for Indian testers.
                    loggedToday = a?.hasLoggedTodayAt(now) == true,
                    // Only a real, locked commitment shows an amount. A
                    // reward-era assignment staked nothing, so it shows 0
                    // rather than implying coins are at risk.
                    committedAmount = a?.displayedCommitmentAmount ?: 0,
                    lastEligibleDayKey = a?.lastEligibleDayKey,
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
            wallet = wallet,
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

    /**
     * A commitment was made server-side. Carries the amount the SERVER
     * committed, never a locally assumed one.
     */
    data class Committed(val appId: String, val amount: Int) : TestAppsEvent
}

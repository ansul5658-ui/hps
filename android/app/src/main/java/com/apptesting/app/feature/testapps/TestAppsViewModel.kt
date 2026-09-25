package com.apptesting.app.feature.testapps

import android.util.Log
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.CancelAssignmentResult
import com.apptesting.app.core.data.ClaimAssignmentResult
import com.apptesting.app.core.data.CoinRepository
import com.apptesting.app.core.data.GroupRepository
import com.apptesting.app.core.data.LogDayResult
import com.apptesting.app.core.data.NotificationRepository
import com.apptesting.app.core.data.QuickTestRepository
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.StartQuickTestResult
import com.apptesting.app.core.data.TestingRepository
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinWallet
import com.apptesting.app.core.model.CommitmentStatus
import com.apptesting.app.core.model.JoinEligibility
import com.apptesting.app.core.model.QuickTestAllowance
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.isTerminal
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
import kotlinx.coroutines.flow.first
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
    private val testing: TestingRepository,
    private val groups: GroupRepository,
    private val time: TimeProvider,
) : ViewModel() {

    constructor() : this(
        users = ServiceLocator.userRepository,
        apps = ServiceLocator.appRepository,
        assignments = ServiceLocator.assignmentRepository,
        quickTests = ServiceLocator.quickTestRepository,
        notifications = ServiceLocator.notificationRepository,
        coins = ServiceLocator.coinRepository,
        testing = ServiceLocator.testingRepository,
        groups = ServiceLocator.groupRepository,
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

    /**
     * Assignments with a cancellation request in flight.
     *
     * A UI-level courtesy only, exactly like [checkingIn]. The guarantee is the
     * server's deterministic `cancel_{assignmentId}` ledger id written with
     * `tx.create`, which makes a second unlock impossible no matter how many
     * requests arrive.
     */
    private val cancelling = java.util.Collections.synchronizedSet(mutableSetOf<String>())

    private val filter = MutableStateFlow(TestFilter.All)
    private val _state = MutableStateFlow<TestAppsUiState>(TestAppsUiState.Loading)
    val state: StateFlow<TestAppsUiState> = _state.asStateFlow()

    /**
     * The server's live view of the caller's open commitments, by app id.
     *
     * Fetched from `getMyCommitmentStatus` every time the assignment listener
     * fires, so a commitment the server has judged lost (past its third miss,
     * not yet swept) shows as ending rather than as a stale "testing".
     */
    private val serverStates = MutableStateFlow<Map<String, CommitmentStatus>>(emptyMap())

    private val _join = MutableStateFlow<JoinSheetState?>(null)

    /** The join sheet, or null when closed. */
    val join: StateFlow<JoinSheetState?> = _join.asStateFlow()

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
     * Cancel a live commitment, returning the staked coins.
     *
     * Same discipline as [onCheckIn]: no local balance change. The returned
     * amount is used only to word the confirmation message; the wallet chip
     * moves when the wallet listener reports the server's write.
     *
     * The in-flight guard makes a double tap a single round trip, and the
     * server refuses a second settlement regardless — which is why an
     * already-settled result is reported as information rather than an error.
     */
    fun onCancelAssignment(assignmentId: String) {
        if (!cancelling.add(assignmentId)) return
        viewModelScope.launch {
            try {
                when (val result = assignments.cancelAssignment(assignmentId)) {
                    is CancelAssignmentResult.Cancelled ->
                        _events.emit(
                            TestAppsEvent.Message(
                                "Commitment cancelled — ${result.returnedAmount} coins returned " +
                                    "to your available balance.",
                            ),
                        )
                    is CancelAssignmentResult.AlreadySettled ->
                        _events.emit(
                            TestAppsEvent.Message(
                                "This commitment has already been settled.",
                            ),
                        )
                    is CancelAssignmentResult.Error ->
                        _events.emit(TestAppsEvent.Message(result.message))
                }
            } finally {
                cancelling.remove(assignmentId)
                refreshServerStates()
            }
        }
    }

    // -----------------------------------------------------------------------
    // Joining: preview the server's checklist, then claim
    // -----------------------------------------------------------------------

    /**
     * Open the join sheet for [appId] and load the server's checklist.
     *
     * `getJoinEligibility` is a PREVIEW: it lets the sheet show every blocker
     * at once instead of discovering them one refused claim at a time. The
     * claim transaction re-decides everything itself, so nothing here can let
     * a join through that the server would refuse.
     */
    fun openJoin(appId: String, appName: String) {
        _join.value = JoinSheetState.Loading(appId, appName)
        loadEligibility(appId, appName, message = null)
    }

    fun dismissJoin() {
        if ((_join.value as? JoinSheetState.Ready)?.working == true) return
        _join.value = null
    }

    fun retryJoinEligibility() {
        val current = _join.value ?: return
        _join.value = JoinSheetState.Loading(current.appId, current.appName)
        loadEligibility(current.appId, current.appName, message = null)
    }

    private fun loadEligibility(appId: String, appName: String, message: String?) {
        viewModelScope.launch {
            testing.joinEligibility(appId).fold(
                onSuccess = { e ->
                    // Ignore a stale answer for a sheet the user already closed or changed.
                    if (_join.value?.appId == appId) {
                        _join.value = JoinSheetState.Ready(appId, appName, e, message = message)
                    }
                },
                onFailure = { err ->
                    if (_join.value?.appId == appId) {
                        _join.value = JoinSheetState.Failed(
                            appId,
                            appName,
                            err.message ?: "Couldn't check whether you can join.",
                        )
                    }
                },
            )
        }
    }

    /**
     * The tester self-confirms joining the official AppTesting group, through
     * the existing `joinGroup` callable. Not a verification: AppTesting cannot
     * see the group's members. The sheet says so.
     */
    fun confirmGroupJoined() {
        val ready = _join.value as? JoinSheetState.Ready ?: return
        if (ready.working) return
        _join.value = ready.copy(working = true, message = null)
        viewModelScope.launch {
            val user = users.currentUser.first()
            val result = if (user == null) {
                Result.failure(IllegalStateException("Sign in required."))
            } else {
                groups.requestJoin(ready.eligibility.groupId.ifBlank { AppConfig.OFFICIAL_GROUP_ID }, user.id)
            }
            loadEligibility(
                ready.appId,
                ready.appName,
                message = result.exceptionOrNull()?.message ?: "Group membership self-confirmed.",
            )
        }
    }

    /**
     * Commit Testing Coins to the app in the open sheet.
     *
     * Deliberately does NOT adjust any balance locally. The wallet flow this
     * screen already collects is the authority, so the chip and the row update
     * when the server's write lands — not optimistically. On success the user
     * is taken to the commitment's status; on refusal the sheet reloads the
     * server's checklist and shows the server's own reason.
     */
    fun confirmJoin() {
        val ready = _join.value as? JoinSheetState.Ready ?: return
        if (!claiming.compareAndSet(false, true)) return
        _join.value = ready.copy(working = true, message = null)
        viewModelScope.launch {
            try {
                when (val result = assignments.claimAssignment(ready.appId)) {
                    is ClaimAssignmentResult.Claimed -> {
                        _join.value = null
                        refreshServerStates()
                        _events.emit(TestAppsEvent.Committed(ready.appId, result.committedAmount))
                        _events.emit(TestAppsEvent.OpenStatus(ready.appId))
                    }
                    ClaimAssignmentResult.AlreadyCommitted -> {
                        _join.value = null
                        _events.emit(TestAppsEvent.Message("You're already testing this app."))
                        _events.emit(TestAppsEvent.OpenStatus(ready.appId))
                    }
                    is ClaimAssignmentResult.InsufficientCoins ->
                        loadEligibility(ready.appId, ready.appName, result.message)
                    is ClaimAssignmentResult.Refused ->
                        loadEligibility(ready.appId, ready.appName, result.message)
                    is ClaimAssignmentResult.Error ->
                        loadEligibility(ready.appId, ready.appName, result.message)
                }
            } finally {
                claiming.set(false)
            }
        }
    }

    private fun refreshServerStates() {
        viewModelScope.launch {
            testing.openCommitments()
                .onSuccess { list -> serverStates.value = list.associateBy { it.appId } }
                .onFailure { e -> Log.w(TAG, "[TEST_APPS] openCommitments failed: ${e.message}") }
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
                            // Any change to the tester's assignments may change
                            // the server's view of them; re-ask it.
                            .onEach { refreshServerStates() }
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
                        serverStates,
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
                            server = values[7] as Map<String, CommitmentStatus>,
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
        server: Map<String, CommitmentStatus>,
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

        // Section 2 — testing commitments. One row per app, showing the
        // CURRENT cycle: a tester who cancelled and rejoined has two
        // assignments for the app, and the old one must not shadow the live one.
        val currentByApp = currentAssignmentPerApp(myAssignments)
        val rows = availableApps
            .filter { it.approvalStatus == AppApprovalStatus.Approved }
            .map { app ->
                val a = currentByApp[app.id]
                // The server's live verdict, only for the cycle it describes.
                val live = server[app.id]?.takeIf { a != null && it.assignmentId == a.id }
                TestRow(
                    assignmentId = a?.id,
                    appId = app.id,
                    appName = app.name,
                    packageName = app.packageName,
                    developerLabel = shortenOwner(app.ownerUserId),
                    daysRequired = a?.daysRequired ?: AppConfig.COMMITMENT_DAYS_REQUIRED,
                    daysCompleted = a?.daysCompleted ?: 0,
                    status = a?.status,
                    // Server-authoritative. The server stamps the instant
                    // today's check-in expires, in the commitment's PINNED
                    // zone; this only asks whether that instant has passed.
                    loggedToday = a?.hasLoggedTodayAt(now) == true,
                    // Only a real, locked commitment shows an amount. A
                    // reward-era assignment staked nothing, so it shows 0
                    // rather than implying coins are at risk.
                    committedAmount = a?.displayedCommitmentAmount ?: 0,
                    lastEligibleDayKey = live?.effectiveLastEligibleDayKey ?: a?.lastEligibleDayKey,
                    serverState = live?.state,
                    missedDays = live?.missedDays,
                    allowedMisses = live?.allowedMisses,
                    remainingMisses = live?.remainingMisses,
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
}

/**
 * The assignment that represents each app's CURRENT cycle for this tester.
 *
 * Pure, and unit tested. The highest cycle wins, because cycles only grow;
 * a live assignment beats a settled one only as a tie-break for corrupt data
 * with equal cycles. The old `associateBy { it.appId }` kept whichever
 * document the snapshot happened to list last - after cancel-and-rejoin that
 * could show the cancelled cycle and hide the live one.
 */
internal fun currentAssignmentPerApp(assignments: List<TestAssignment>): Map<String, TestAssignment> =
    assignments.groupBy { it.appId }.mapValues { (_, list) ->
        list.maxWith(compareBy<TestAssignment>({ it.cycle }, { if (it.status.isTerminal) 0 else 1 }))
    }

/** The join sheet. */
sealed interface JoinSheetState {
    val appId: String
    val appName: String

    data class Loading(override val appId: String, override val appName: String) : JoinSheetState

    data class Ready(
        override val appId: String,
        override val appName: String,
        val eligibility: JoinEligibility,
        /** A request (join or group confirmation) is in flight; actions are disabled. */
        val working: Boolean = false,
        /** The server's latest word - a refusal reason, or a confirmation. */
        val message: String? = null,
    ) : JoinSheetState

    data class Failed(
        override val appId: String,
        override val appName: String,
        val message: String,
    ) : JoinSheetState
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

    /** Go to the commitment status screen for [appId]. */
    data class OpenStatus(val appId: String) : TestAppsEvent
}

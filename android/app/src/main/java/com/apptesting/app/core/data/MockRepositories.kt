package com.apptesting.app.core.data

import android.net.Uri
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.CoinTransactionKind
import com.apptesting.app.core.model.CoinTransactionSource
import com.apptesting.app.core.model.CoinWallet
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.Notification
import com.apptesting.app.core.model.QuickTestAllowance
import com.apptesting.app.core.model.QuickTestSession
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.UserRole
import com.apptesting.app.core.util.AppConfig
import com.apptesting.app.core.util.TimeProvider
import com.apptesting.app.core.util.daysBetweenDayKeys
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart

private const val LOAD_DELAY_MS = 250L

internal class MockUserRepository(private val store: MockStore) : UserRepository, AuthGateway {
    override val currentUser: Flow<User?> = store.currentUser.onStart { delay(LOAD_DELAY_MS) }

    override suspend fun signOut() {
        store.currentUser.value = null
    }

    override fun isConfigured(): Boolean = false

    override fun webClientId(): String? = null

    override suspend fun signInWithGoogleIdToken(idToken: String): Result<Unit> =
        Result.failure(UnsupportedOperationException("Mock mode doesn't process real Google tokens."))

    override suspend fun signInAsDemoUser(): Result<Unit> {
        store.currentUser.value = User(
            id = "u_me",
            displayName = "Demo Developer",
            email = "demo@apptesting.app",
            photoUrl = null,
            createdAtMillis = System.currentTimeMillis() - 86_400_000L * 14,
            termsAcceptedAtMillis = System.currentTimeMillis() - 86_400_000L * 14,
            coinBalance = 240,
            trustScore = 72,
            role = UserRole.Member,
        )
        return Result.success(Unit)
    }
}

internal class MockAppRepository(private val store: MockStore) : AppRepository {
    override fun observeMyApps(userId: String): Flow<List<AppSubmission>> =
        store.apps
            .map { list -> list.filter { it.ownerUserId == userId }.sortedByDescending { it.createdAtMillis } }
            .onStart { delay(LOAD_DELAY_MS) }

    override fun observeAvailableApps(excludeOwnerId: String): Flow<List<AppSubmission>> =
        store.apps
            .map { list -> list.filter { it.ownerUserId != excludeOwnerId }.sortedByDescending { it.createdAtMillis } }
            .onStart { delay(LOAD_DELAY_MS) }

    override fun observeApp(appId: String): Flow<AppSubmission?> =
        store.apps
            .map { list -> list.firstOrNull { it.id == appId } }
            .onStart { delay(LOAD_DELAY_MS) }

    override suspend fun addApp(app: AppSubmission, iconUri: Uri?): Result<String> {
        val newId = store.newId("app")
        val stored = app.copy(
            id = newId,
            iconStoragePath = iconUri?.toString(),
            createdAtMillis = System.currentTimeMillis(),
        )
        store.apps.value = listOf(stored) + store.apps.value
        return Result.success(newId)
    }

    override suspend fun deleteApp(appId: String): Result<Unit> {
        store.apps.value = store.apps.value.filterNot { it.id == appId }
        return Result.success(Unit)
    }
}

internal class MockGroupRepository(private val store: MockStore) : GroupRepository {
    override fun observeGroups(): Flow<List<Group>> =
        store.groups.onStart { delay(LOAD_DELAY_MS) }

    override fun observeGroup(groupId: String): Flow<Group?> =
        store.groups
            .map { list -> list.firstOrNull { it.id == groupId } }
            .onStart { delay(LOAD_DELAY_MS) }

    override fun observeMembershipFor(userId: String): Flow<List<GroupMember>> =
        store.memberships
            .map { list -> list.filter { it.userId == userId } }
            .onStart { delay(LOAD_DELAY_MS) }

    override suspend fun requestJoin(groupId: String, userId: String): Result<Unit> {
        val group = store.groups.value.firstOrNull { it.id == groupId }
            ?: return Result.failure(IllegalArgumentException("Group not found"))
        if (group.currentMemberCount >= group.memberCap) {
            return Result.failure(IllegalStateException("Group is full"))
        }
        if (store.memberships.value.any { it.groupId == groupId && it.userId == userId }) {
            return Result.success(Unit)
        }
        store.memberships.value = store.memberships.value + GroupMember(
            id = store.newId("gm"),
            groupId = groupId,
            userId = userId,
            joinedAtMillis = System.currentTimeMillis(),
        )
        store.groups.value = store.groups.value.map {
            if (it.id == groupId) it.copy(currentMemberCount = it.currentMemberCount + 1) else it
        }
        return Result.success(Unit)
    }

    override suspend fun leave(groupId: String, userId: String): Result<Unit> {
        val before = store.memberships.value
        val after = before.filterNot { it.groupId == groupId && it.userId == userId }
        if (before.size != after.size) {
            store.memberships.value = after
            store.groups.value = store.groups.value.map {
                if (it.id == groupId) it.copy(currentMemberCount = (it.currentMemberCount - 1).coerceAtLeast(0)) else it
            }
        }
        return Result.success(Unit)
    }
}

internal class MockAssignmentRepository(private val store: MockStore) : AssignmentRepository {
    override fun observeAssignmentsForUser(userId: String): Flow<List<TestAssignment>> =
        store.assignments
            .map { list -> list.filter { it.testerUserId == userId } }
            .onStart { delay(LOAD_DELAY_MS) }

    /**
     * In-memory claim, mirroring the server's rules closely enough that the UI
     * behaves the same in dev mode.
     *
     * This is a development convenience, NOT a security boundary: in Firebase
     * mode every one of these checks is re-derived inside a server transaction
     * and this class is not in the picture at all. It is written to refuse the
     * same things the server refuses — an existing commitment, an unapproved
     * app, the developer's own app, and an insufficient balance — so a screen
     * developed against the mock does not discover those states for the first
     * time in production.
     */
    override suspend fun claimAssignment(appId: String): ClaimAssignmentResult {
        val userId = store.currentUser.value?.id
            ?: return ClaimAssignmentResult.Error("Sign in to commit to a test.")
        val app = store.apps.value.firstOrNull { it.id == appId }
            ?: return ClaimAssignmentResult.Error("That app no longer exists.")
        if (app.approvalStatus != AppApprovalStatus.Approved) {
            return ClaimAssignmentResult.Error("That app is not open for testing.")
        }
        if (app.ownerUserId == userId) {
            return ClaimAssignmentResult.Error("You cannot test your own app.")
        }

        val mine = store.assignments.value.filter {
            it.appId == appId && it.testerUserId == userId
        }
        if (mine.any { it.status != AssignmentStatus.Completed && it.status != AssignmentStatus.Missed }) {
            return ClaimAssignmentResult.AlreadyCommitted
        }

        val amount = AppConfig.DEFAULT_COMMITMENT_AMOUNT
        val wallet = store.wallet.value
        if (wallet.available < amount) {
            return ClaimAssignmentResult.InsufficientCoins(
                required = amount,
                message = "You need $amount available Testing Coins to commit to this test.",
            )
        }

        // Cycle-scoped id, matching `cycleAssignmentId` on the server.
        val cycle = (mine.maxOfOrNull { it.cycle } ?: 0) + 1
        val assignmentId = "${appId}__${userId}__c$cycle"
        val lockTxId = "lock_$assignmentId"

        store.assignments.value = store.assignments.value + TestAssignment(
            id = assignmentId,
            groupId = app.activeGroupId.orEmpty(),
            appId = appId,
            testerUserId = userId,
            assignedAtMillis = System.currentTimeMillis(),
            daysRequired = 14,
            daysCompleted = 0,
            status = AssignmentStatus.Ready,
            commitmentAmount = amount,
            cycle = cycle,
            windowDays = 18,
            lockTxId = lockTxId,
        )
        // The mock wallet moves the same way the server's would: available
        // down, locked up, totals untouched — so the invariant still holds.
        store.wallet.value = wallet.copy(
            available = wallet.available - amount,
            locked = wallet.locked + amount,
            ledgerCount = wallet.ledgerCount + 1,
            lastEntryId = lockTxId,
        )
        store.transactions.value = store.transactions.value + CoinTransaction(
            id = lockTxId,
            userId = userId,
            amount = amount,
            kind = CoinTransactionKind.Lock,
            source = CoinTransactionSource.Commitment,
            deltaAvailable = -amount,
            deltaLocked = amount,
            reason = "Committed to testing ${app.name}",
            relatedAssignmentId = assignmentId,
            createdAtMillis = System.currentTimeMillis(),
            schemaVersion = 2,
        )
        return ClaimAssignmentResult.Claimed(assignmentId, amount, cycle)
    }

    /**
     * In-memory check-in, mirroring the server engine closely enough that the
     * UI behaves the same in dev mode.
     *
     * Development convenience, NOT a security boundary: in Firebase mode the
     * day key comes from the server clock and the assignment's pinned IANA
     * zone, and this class is not in the picture at all. It reproduces the
     * behaviours a screen has to handle — idempotent repeat, the fourteenth
     * day completing and returning the stake — so those states are not met for
     * the first time in production.
     */
    /** Start of the UTC day AFTER the one [nowMillis] falls in. */
    private fun nextUtcMidnightMillis(nowMillis: Long): Long {
        val day = 86_400_000L
        return (nowMillis / day) * day + day
    }

    override suspend fun recordDayOfTesting(assignmentId: String): LogDayResult {
        val item = store.assignments.value.firstOrNull { it.id == assignmentId }
            ?: return LogDayResult.Error("Assignment not found")
        if (item.status == AssignmentStatus.Completed || item.status == AssignmentStatus.Missed) {
            return LogDayResult.Error("This commitment is already ${item.status}.")
        }
        // Stands in for the server's zone-aware day key. The real boundary is
        // local midnight in the assignment's pinned zone; the mock has no
        // clock authority, so UTC is fine here and nowhere else.
        val today = TimeProvider.todayKey()
        if (item.lastLoggedDayKey == today) {
            return LogDayResult.AlreadyLoggedToday
        }
        val newDays = (item.daysCompleted + 1).coerceAtMost(item.daysRequired)
        val completes = newDays >= item.daysRequired
        val newStatus =
            if (completes) AssignmentStatus.Completed else AssignmentStatus.InProgress

        store.assignments.value = store.assignments.value.map {
            if (it.id != assignmentId) {
                it
            } else {
                it.copy(
                    daysCompleted = newDays,
                    status = newStatus,
                    lastLoggedDayKey = today,
                    // The mock's stand-in for the server's pinned-zone
                    // boundary. The real one is local midnight in the
                    // assignment's timezone; the mock has no clock authority,
                    // so the next UTC midnight matches the `today` above.
                    nextCheckInAtMillis = nextUtcMidnightMillis(TimeProvider.nowMillis()),
                    settlementTxId = if (completes) "unlock_$assignmentId" else it.settlementTxId,
                )
            }
        }

        // The fourteenth day returns the SAME staked coins — locked back to
        // available, nothing added. Mirrors `stageUnlockSettlement`.
        if (completes && item.hasCommitment) {
            val amount = item.commitmentAmount
            val wallet = store.wallet.value
            store.wallet.value = wallet.copy(
                available = wallet.available + amount,
                locked = (wallet.locked - amount).coerceAtLeast(0),
                ledgerCount = wallet.ledgerCount + 1,
                lastEntryId = "unlock_$assignmentId",
            )
            store.transactions.value = store.transactions.value + CoinTransaction(
                id = "unlock_$assignmentId",
                userId = item.testerUserId,
                amount = amount,
                kind = CoinTransactionKind.Unlock,
                source = CoinTransactionSource.Completion,
                deltaAvailable = amount,
                deltaLocked = -amount,
                reason = "Returned commitment for ${item.appId}",
                relatedAssignmentId = assignmentId,
                createdAtMillis = System.currentTimeMillis(),
                schemaVersion = 2,
            )
        }

        return LogDayResult.Logged(
            daysCompleted = newDays,
            daysRequired = item.daysRequired,
            completed = completes,
        )
    }
}

/**
 * In-memory [CoinRepository] for dev mode (no google-services.json).
 *
 * Read-only, exactly like the Firestore implementation. There is no mock
 * "grant myself coins" path on purpose: the mock exists so screens can be
 * developed without Firebase, and a mutating method here would let a UI be
 * built against an operation the real client is structurally incapable of.
 */
internal class MockCoinRepository(private val store: MockStore) : CoinRepository {
    override fun observeWallet(userId: String): Flow<CoinWallet> =
        store.wallet
            // A user the mock does not know about has never transacted.
            .map { wallet -> if (userId == MOCK_USER_ID) wallet else CoinWallet.EMPTY }
            .onStart { delay(LOAD_DELAY_MS) }

    override fun observeTransactions(userId: String): Flow<List<CoinTransaction>> =
        store.transactions
            .map { list -> list.filter { it.userId == userId }.sortedByDescending { it.createdAtMillis } }
            .onStart { delay(LOAD_DELAY_MS) }

    private companion object {
        const val MOCK_USER_ID = "u_me"
    }
}

/**
 * In-memory [QuickTestRepository] for dev mode (no google-services.json).
 *
 * Enforces the same daily limit, one-per-app-per-day rule and cooldown as the
 * backend, so the Apps screen behaves the same way without Firebase. This is a
 * development convenience, NOT a security boundary: in Firebase mode every one
 * of these rules is re-derived inside a server transaction, and this class is
 * not in the picture at all.
 */
internal class MockQuickTestRepository(
    private val store: MockStore,
    private val time: TimeProvider = TimeProvider.Default,
) : QuickTestRepository {

    override fun observePoolAppIds(): Flow<List<String>> =
        store.apps
            .map { list ->
                // Stands in for the server's least-recently-surfaced rotation.
                list.filter { it.approvalStatus == AppApprovalStatus.Approved }
                    .sortedBy { it.createdAtMillis }
                    .take(MOCK_POOL_SIZE)
                    .map { it.id }
            }
            .onStart { delay(LOAD_DELAY_MS) }

    override fun observeAllowance(userId: String): Flow<QuickTestAllowance> =
        store.quickTestSessions.map { sessions ->
            val today = time.todayKey()
            val mine = sessions.filter { it.userId == userId }
            QuickTestAllowance(
                dayKey = today,
                usedToday = mine.count { it.dayKey == today },
                dailyLimit = AppConfig.QUICK_TEST_DAILY_LIMIT,
                lastSessionDayByAppId = mine
                    .groupBy { it.appId }
                    .mapValues { (_, list) -> list.maxOf { it.dayKey } },
            )
        }

    override fun observeSessions(userId: String): Flow<List<QuickTestSession>> =
        store.quickTestSessions.map { list ->
            list.filter { it.userId == userId }.sortedByDescending { it.openedAtMillis }
        }

    override suspend fun startQuickTest(appId: String): StartQuickTestResult {
        val userId = store.currentUser.value?.id
            ?: return StartQuickTestResult.Error("You need to be signed in.")
        val today = time.todayKey()
        val mine = store.quickTestSessions.value.filter { it.userId == userId }

        if (mine.any { it.appId == appId && it.dayKey == today }) {
            return StartQuickTestResult.AlreadyToday
        }
        val usedToday = mine.count { it.dayKey == today }
        if (usedToday >= AppConfig.QUICK_TEST_DAILY_LIMIT) {
            return StartQuickTestResult.Error(
                "You've used all ${AppConfig.QUICK_TEST_DAILY_LIMIT} Quick Tests for today. " +
                    "Try again tomorrow.",
            )
        }
        val lastDay = mine.filter { it.appId == appId }.maxOfOrNull { it.dayKey }
        if (lastDay != null) {
            val elapsed = daysBetweenDayKeys(lastDay, today)
            if (elapsed == null || elapsed < AppConfig.QUICK_TEST_COOLDOWN_DAYS) {
                return StartQuickTestResult.Error(
                    "You Quick Tested this app recently. Try again in a few days.",
                )
            }
        }
        if (store.apps.value.firstOrNull { it.id == appId }?.ownerUserId == userId) {
            return StartQuickTestResult.Error("You can't Quick Test your own app.")
        }

        val session = QuickTestSession(
            id = "${userId}__${appId}__$today",
            userId = userId,
            appId = appId,
            dayKey = today,
            openedAtMillis = time.nowMillis(),
            completedAtMillis = null,
        )
        store.quickTestSessions.value = store.quickTestSessions.value + session
        return StartQuickTestResult.Started(
            sessionId = session.id,
            remainingToday = AppConfig.QUICK_TEST_DAILY_LIMIT - usedToday - 1,
        )
    }

    override suspend fun completeQuickTest(appId: String, note: String?): Result<Unit> {
        val userId = store.currentUser.value?.id
            ?: return Result.failure(IllegalStateException("You need to be signed in."))
        val today = time.todayKey()
        store.quickTestSessions.value = store.quickTestSessions.value.map { session ->
            if (session.userId == userId && session.appId == appId && session.dayKey == today &&
                session.completedAtMillis == null
            ) {
                session.copy(completedAtMillis = time.nowMillis())
            } else {
                session
            }
        }
        return Result.success(Unit)
    }

    private companion object {
        const val MOCK_POOL_SIZE = 8
    }
}

internal class MockNotificationRepository(private val store: MockStore) : NotificationRepository {
    override fun observeUnread(userId: String): Flow<List<Notification>> =
        store.notifications
            .map { list -> list.filter { it.userId == userId && it.readAtMillis == null } }
            .onStart { delay(LOAD_DELAY_MS) }

    override suspend fun markRead(notificationId: String) {
        store.notifications.value = store.notifications.value.map {
            if (it.id == notificationId) it.copy(readAtMillis = System.currentTimeMillis()) else it
        }
    }
}

internal class MockAdminRepository(private val store: MockStore) : AdminRepository {
    override fun observeAllUsers(): Flow<List<User>> =
        store.currentUser.map { listOfNotNull(it) }

    override fun observeAllApps(): Flow<List<AppSubmission>> =
        store.apps

    override fun observeAllAssignments(): Flow<List<TestAssignment>> =
        store.assignments

    override suspend fun setAppStatus(appId: String, status: AppApprovalStatus): Result<Unit> {
        store.apps.value = store.apps.value.map {
            if (it.id == appId) it.copy(approvalStatus = status) else it
        }
        return Result.success(Unit)
    }

    override suspend fun setUserSuspended(userId: String, isSuspended: Boolean): Result<Unit> {
        val user = store.currentUser.value
        if (user?.id == userId) {
            store.currentUser.value = user.copy(isSuspended = isSuspended)
        }
        return Result.success(Unit)
    }

    /**
     * Mock mode has no matching backend — the demo store ships with its own
     * assignments. Report zero rather than pretending work happened.
     */
    override suspend fun previewEligibleTesters(appId: String): Result<Int> = Result.success(0)

    override suspend fun upsertGroup(
        groupId: String,
        name: String?,
        summary: String?,
        rules: String?,
        memberCap: Int?,
    ): Result<Unit> {
        val exists = store.groups.value.any { it.id == groupId }
        store.groups.value = if (exists) {
            store.groups.value.map { group ->
                if (group.id != groupId) return@map group
                group.copy(
                    name = name ?: group.name,
                    summary = summary ?: group.summary,
                    rules = rules ?: group.rules,
                    memberCap = memberCap ?: group.memberCap,
                )
            }
        } else {
            store.groups.value + Group(
                id = groupId,
                name = name.orEmpty(),
                summary = summary.orEmpty(),
                rules = rules.orEmpty(),
                memberCap = memberCap ?: 0,
                createdByUserId = store.currentUser.value?.id.orEmpty(),
                createdAtMillis = System.currentTimeMillis(),
            )
        }
        return Result.success(Unit)
    }
}

package com.apptesting.app.core.data

import android.net.Uri
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransaction
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

    override suspend fun requestCompletion(assignmentId: String): Result<Unit> {
        store.assignments.value = store.assignments.value.map {
            if (it.id == assignmentId) it.copy(status = AssignmentStatus.WaitingForVerification) else it
        }
        return Result.success(Unit)
    }

    override suspend fun recordDayOfTesting(assignmentId: String): LogDayResult {
        val item = store.assignments.value.firstOrNull { it.id == assignmentId }
            ?: return LogDayResult.Error("Assignment not found")
        val today = TimeProvider.todayKey()
        if (item.lastLoggedDayKey == today) {
            return LogDayResult.AlreadyLoggedToday
        }
        val newDays = (item.daysCompleted + 1).coerceAtMost(item.daysRequired)
        val newStatus = if (newDays >= item.daysRequired) AssignmentStatus.WaitingForVerification else AssignmentStatus.InProgress
        store.assignments.value = store.assignments.value.map {
            if (it.id == assignmentId) it.copy(daysCompleted = newDays, status = newStatus, lastLoggedDayKey = today) else it
        }
        return LogDayResult.Logged(daysCompleted = newDays, daysRequired = item.daysRequired)
    }
}

internal class MockCoinRepository(private val store: MockStore) : CoinRepository {
    override fun observeTransactions(userId: String): Flow<List<CoinTransaction>> =
        store.transactions
            .map { list -> list.filter { it.userId == userId }.sortedByDescending { it.createdAtMillis } }
            .onStart { delay(LOAD_DELAY_MS) }
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
    override suspend fun assignTesters(appId: String): Result<Int> = Result.success(0)

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

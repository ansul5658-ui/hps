package com.apptesting.app.core.data

import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.Notification
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.UserRole
import com.apptesting.app.core.util.TimeProvider
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onStart

/**
 * Mock repository implementations backed by [MockStore].
 *
 * All flows add a tiny [onStart] delay so the UI has a chance to render its
 * loading state. Mutations update the underlying [kotlinx.coroutines.flow.MutableStateFlow]
 * so observers get the new state immediately.
 */
private const val LOAD_DELAY_MS = 350L

internal class MockUserRepository(private val store: MockStore) : UserRepository, AuthGateway {
    override val currentUser: Flow<User?> = store.currentUser.onStart { delay(LOAD_DELAY_MS) }

    override suspend fun signOut() {
        // NOTE: not truly meaningful with mock data; wiping the user lets the
        // sign-in flow re-appear so the flow is walkable end-to-end.
        store.currentUser.value = null
    }

    // ---- AuthGateway ---------------------------------------------------
    override fun isConfigured(): Boolean = false
    override fun webClientId(): String? = null
    override suspend fun signInWithGoogleIdToken(idToken: String): Result<Unit> =
        Result.failure(UnsupportedOperationException("Mock repository can't verify a Google ID token."))

    override suspend fun signInAsDemoUser(): Result<Unit> {
        // Restore the demo user so post-sign-out flows land back on populated screens.
        store.currentUser.value = User(
            id = "u_me",
            displayName = "Developer",
            email = "developer@example.com",
            createdAtMillis = System.currentTimeMillis(),
            termsAcceptedAtMillis = System.currentTimeMillis(),
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

    override suspend fun addApp(app: AppSubmission): Result<String> {
        val newId = store.newId("app")
        val stored = app.copy(
            id = newId,
            createdAtMillis = System.currentTimeMillis(),
        )
        store.apps.value = listOf(stored) + store.apps.value
        return Result.success(newId)
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
        val existed = store.memberships.value.any { it.groupId == groupId && it.userId == userId }
        store.memberships.value = store.memberships.value.filterNot { it.groupId == groupId && it.userId == userId }
        if (existed) {
            store.groups.value = store.groups.value.map {
                if (it.id == groupId) it.copy(currentMemberCount = (it.currentMemberCount - 1).coerceAtLeast(0)) else it
            }
        }
        return Result.success(Unit)
    }
}

internal class MockAssignmentRepository(
    private val store: MockStore,
    private val time: TimeProvider = TimeProvider.Default,
) : AssignmentRepository {
    override fun observeAssignmentsForUser(userId: String): Flow<List<TestAssignment>> =
        store.assignments
            .map { list -> list.filter { it.testerUserId == userId } }
            .onStart { delay(LOAD_DELAY_MS) }

    override suspend fun requestCompletion(assignmentId: String): Result<Unit> {
        val existed = store.assignments.value.any { it.id == assignmentId }
        if (!existed) return Result.failure(IllegalArgumentException("Assignment not found"))
        store.assignments.value = store.assignments.value.map {
            if (it.id == assignmentId) it.copy(status = AssignmentStatus.WaitingForVerification) else it
        }
        return Result.success(Unit)
    }

    /**
     * Idempotent per calendar day.
     *
     * Reads the current assignment, computes the outcome, and — only when
     * the row is unchanged since it was read — replaces it via
     * [MutableStateFlow.compareAndSet]. That check-and-set is the mock's
     * stand-in for the Firestore transaction / security-rule-guarded
     * subcollection write that the Cloud Function will use: two concurrent
     * "Log today" taps can both see the same starting state, but only one
     * writes the increment; the other retries and observes the newly-set
     * `lastLoggedLocalDay` and returns [LogDayResult.AlreadyLoggedToday].
     */
    override suspend fun recordDayOfTesting(assignmentId: String): LogDayResult {
        val today = time.todayKey()
        while (true) {
            val current = store.assignments.value
            val target = current.firstOrNull { it.id == assignmentId }
                ?: return LogDayResult.Error("Assignment not found")

            if (target.lastLoggedLocalDay == today) {
                return LogDayResult.AlreadyLoggedToday
            }

            val newDays = (target.daysCompleted + 1).coerceAtMost(target.daysRequired)
            val newStatus = when {
                newDays >= target.daysRequired -> AssignmentStatus.WaitingForVerification
                target.status == AssignmentStatus.Ready -> AssignmentStatus.InProgress
                else -> target.status
            }
            val updated = target.copy(
                daysCompleted = newDays,
                status = newStatus,
                lastLoggedLocalDay = today,
            )
            val next = current.map { if (it.id == assignmentId) updated else it }

            if (store.assignments.compareAndSet(current, next)) {
                return LogDayResult.Logged(daysCompleted = newDays, daysRequired = target.daysRequired)
            }
            // Someone else updated the store between read and write; loop and re-check.
        }
    }
}

internal class MockCoinRepository(private val store: MockStore) : CoinRepository {
    override fun observeTransactions(userId: String): Flow<List<CoinTransaction>> =
        store.transactions
            .map { list -> list.filter { it.userId == userId }.sortedByDescending { it.createdAtMillis } }
            .onStart { delay(LOAD_DELAY_MS) }
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

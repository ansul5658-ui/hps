package com.apptesting.app.core.data

import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.Notification
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
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

internal class MockUserRepository(private val store: MockStore) : UserRepository {
    override val currentUser: Flow<User?> = store.currentUser.onStart { delay(LOAD_DELAY_MS) }
    override suspend fun signOut() {
        // NOTE: not truly meaningful with mock data; wiping the user lets the
        // sign-in flow re-appear so the flow is walkable end-to-end.
        store.currentUser.value = null
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

internal class MockAssignmentRepository(private val store: MockStore) : AssignmentRepository {
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

    override suspend fun recordDayOfTesting(assignmentId: String): Result<Unit> {
        store.assignments.value = store.assignments.value.map {
            if (it.id != assignmentId) it
            else it.copy(
                daysCompleted = (it.daysCompleted + 1).coerceAtMost(it.daysRequired),
                status = when {
                    it.daysCompleted + 1 >= it.daysRequired -> AssignmentStatus.WaitingForVerification
                    it.status == AssignmentStatus.Ready -> AssignmentStatus.InProgress
                    else -> it.status
                },
            )
        }
        return Result.success(Unit)
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

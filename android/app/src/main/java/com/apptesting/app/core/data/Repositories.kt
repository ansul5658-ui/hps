package com.apptesting.app.core.data

import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.Notification
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * Repository interfaces — thin, feature-focused contracts. UI depends on these,
 * not on Firebase. A Firestore-backed implementation of each will be added under
 * `data/firestore/` when Firebase is configured; a fake in-memory implementation
 * can live under `data/fake/` for previews and tests.
 *
 * The [Stub…] singletons below implement each interface with empty flows so
 * the UI compiles and previews render without any backend. They are the *only*
 * synthetic data in the codebase; they emit nothing that resembles production
 * content — every list is empty, every count is zero.
 */

interface UserRepository {
    val currentUser: Flow<User?>
    suspend fun signOut()
}

interface AppRepository {
    fun observeMyApps(userId: String): Flow<List<AppSubmission>>
    suspend fun submitForReview(app: AppSubmission): Result<String>
}

interface GroupRepository {
    fun observeGroupsForUser(userId: String): Flow<List<Group>>
    fun observeGroupMembers(groupId: String): Flow<List<GroupMember>>
}

interface AssignmentRepository {
    fun observeAssignmentsForUser(userId: String): Flow<List<TestAssignment>>
    /**
     * Marking an assignment done is server-authoritative: the client requests
     * completion, a Cloud Function verifies and awards Coins.
     */
    suspend fun requestCompletion(assignmentId: String): Result<Unit>
}

interface CoinRepository {
    fun observeTransactions(userId: String): Flow<List<CoinTransaction>>
}

interface NotificationRepository {
    fun observeUnread(userId: String): Flow<List<Notification>>
    suspend fun markRead(notificationId: String)
}

// ----- Stub implementations (compile-time / preview only) -----

object StubUserRepository : UserRepository {
    override val currentUser: Flow<User?> = flowOf(null)
    override suspend fun signOut() = Unit
}

object StubAppRepository : AppRepository {
    override fun observeMyApps(userId: String): Flow<List<AppSubmission>> = flowOf(emptyList())
    override suspend fun submitForReview(app: AppSubmission): Result<String> =
        Result.failure(NotImplementedError("Firebase not configured yet"))
}

object StubGroupRepository : GroupRepository {
    override fun observeGroupsForUser(userId: String): Flow<List<Group>> = flowOf(emptyList())
    override fun observeGroupMembers(groupId: String): Flow<List<GroupMember>> = flowOf(emptyList())
}

object StubAssignmentRepository : AssignmentRepository {
    override fun observeAssignmentsForUser(userId: String): Flow<List<TestAssignment>> = flowOf(emptyList())
    override suspend fun requestCompletion(assignmentId: String): Result<Unit> =
        Result.failure(NotImplementedError("Firebase not configured yet"))
}

object StubCoinRepository : CoinRepository {
    override fun observeTransactions(userId: String): Flow<List<CoinTransaction>> = flowOf(emptyList())
}

object StubNotificationRepository : NotificationRepository {
    override fun observeUnread(userId: String): Flow<List<Notification>> = flowOf(emptyList())
    override suspend fun markRead(notificationId: String) = Unit
}

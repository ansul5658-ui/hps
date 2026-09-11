package com.apptesting.app.core.data

import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.Notification
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import kotlinx.coroutines.flow.Flow

/**
 * Repository contracts. The UI depends on these; concrete implementations
 * are chosen at composition time (see [ServiceLocator]).
 *
 * Phase 2 ships a fully in-memory Mock implementation ([MockRepositories])
 * so screens can render meaningful state. A Firestore implementation will
 * replace it later without changing UI code.
 */

interface UserRepository {
    val currentUser: Flow<User?>
    suspend fun signOut()
}

interface AppRepository {
    /** Apps owned by [userId]. */
    fun observeMyApps(userId: String): Flow<List<AppSubmission>>

    /** Apps other developers submitted that are available for testing. */
    fun observeAvailableApps(excludeOwnerId: String): Flow<List<AppSubmission>>

    /** Persist a new submission. Returns the generated id. */
    suspend fun addApp(app: AppSubmission): Result<String>
}

interface GroupRepository {
    fun observeGroups(): Flow<List<Group>>
    fun observeMembershipFor(userId: String): Flow<List<GroupMember>>
    suspend fun requestJoin(groupId: String, userId: String): Result<Unit>
    suspend fun leave(groupId: String, userId: String): Result<Unit>
}

interface AssignmentRepository {
    /** Assignments assigned to [userId] across all groups. */
    fun observeAssignmentsForUser(userId: String): Flow<List<TestAssignment>>

    /**
     * Client requests completion; a Cloud Function verifies and awards Coins.
     * In the mock implementation this just flips the row to `WaitingForVerification`
     * so the UI transition is visible.
     */
    suspend fun requestCompletion(assignmentId: String): Result<Unit>

    /** Client marks progress locally (e.g. a "check in for today" button in future). */
    suspend fun recordDayOfTesting(assignmentId: String): Result<Unit>
}

interface CoinRepository {
    fun observeTransactions(userId: String): Flow<List<CoinTransaction>>
}

interface NotificationRepository {
    fun observeUnread(userId: String): Flow<List<Notification>>
    suspend fun markRead(notificationId: String)
}

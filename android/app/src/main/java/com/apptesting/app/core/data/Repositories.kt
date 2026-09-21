package com.apptesting.app.core.data

import android.net.Uri
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.CoinWallet
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupMember
import com.apptesting.app.core.model.Notification
import com.apptesting.app.core.model.QuickTestAllowance
import com.apptesting.app.core.model.QuickTestSession
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import kotlinx.coroutines.flow.Flow

/**
 * Repository contracts. The UI depends on these; concrete implementations
 * are chosen at composition time (see [ServiceLocator]).
 */

interface UserRepository {
    val currentUser: Flow<User?>
    suspend fun signOut()
}

/**
 * Optional capability implemented by [UserRepository] impls that can
 * actually authenticate.
 */
interface AuthGateway {
    /** True when this gateway can perform a real Google-backed sign-in. */
    fun isConfigured(): Boolean

    /**
     * Web OAuth 2.0 client ID needed to request a Google ID token from
     * Credential Manager.
     */
    fun webClientId(): String?

    /**
     * Complete sign-in using a Google ID token.
     */
    suspend fun signInWithGoogleIdToken(idToken: String): Result<Unit>

    /**
     * Fallback used only by the mock repository.
     */
    suspend fun signInAsDemoUser(): Result<Unit> =
        Result.failure(UnsupportedOperationException("Not supported by this gateway."))
}

interface AppRepository {
    /** Apps owned by [userId]. */
    fun observeMyApps(userId: String): Flow<List<AppSubmission>>

    /** Apps other developers submitted that are available for testing. */
    fun observeAvailableApps(excludeOwnerId: String): Flow<List<AppSubmission>>

    /** Observe a single app by its document [appId]. */
    fun observeApp(appId: String): Flow<AppSubmission?>

    /** Persist a new submission and optionally upload icon image. Returns generated id. */
    suspend fun addApp(app: AppSubmission, iconUri: Uri? = null): Result<String>

    /** Delete an app and clean up its stored icon image. */
    suspend fun deleteApp(appId: String): Result<Unit>
}

interface GroupRepository {
    fun observeGroups(): Flow<List<Group>>

    /**
     * Observe a single group. Emits `null` when the document doesn't exist
     * so the caller can render a not-found state instead of hanging.
     */
    fun observeGroup(groupId: String): Flow<Group?>

    fun observeMembershipFor(userId: String): Flow<List<GroupMember>>
    suspend fun requestJoin(groupId: String, userId: String): Result<Unit>
    suspend fun leave(groupId: String, userId: String): Result<Unit>
}

interface AssignmentRepository {
    /** Assignments assigned to [userId] across all groups. */
    fun observeAssignmentsForUser(userId: String): Flow<List<TestAssignment>>

    /**
     * Ask the backend to claim a testing assignment for [appId], committing
     * Testing Coins to it.
     *
     * SECURITY NOTE
     * Takes an appId and nothing else. There is deliberately no amount
     * parameter and no tester parameter: the stake is decided by the server,
     * and the tester is the verified uid on the ID token. A client that could
     * name either could spend coins it does not have, or someone else's.
     *
     * This never writes Firestore. Security rules refuse client creates on
     * `testingAssignments` and every write to `activeClaims`, so the
     * `joinTestingAssignment` callable is the only door.
     */
    suspend fun claimAssignment(appId: String): ClaimAssignmentResult

    /**
     * Record today's testing day.
     *
     * The day key, the progress count and the completion settlement are all
     * server-derived — see the implementation note on
     * [com.apptesting.app.core.data.firebase.firestore.FirestoreAssignmentRepository].
     * Safe to call twice: a same-day repeat is an idempotent no-op.
     */
    suspend fun recordDayOfTesting(assignmentId: String): LogDayResult
}

sealed interface ClaimAssignmentResult {
    /**
     * The commitment was made. [committedAmount] coins moved from available to
     * locked; the wallet listener will report the new balance on its own.
     */
    data class Claimed(
        val assignmentId: String,
        val committedAmount: Int,
        val cycle: Int,
    ) : ClaimAssignmentResult

    /** Not enough available coins to fund the commitment. */
    data class InsufficientCoins(val required: Int, val message: String) : ClaimAssignmentResult

    /** A commitment for this app is already live — a no-op, not a failure. */
    object AlreadyCommitted : ClaimAssignmentResult

    data class Error(val message: String) : ClaimAssignmentResult
}

sealed interface LogDayResult {
    /**
     * The server recorded a qualifying day. [daysCompleted] is the server's
     * count, never a local increment.
     *
     * [completed] is true when this was the fourteenth day: the commitment is
     * settled and the staked coins are already back in the wallet. The screen
     * uses it to say so, not to change any balance itself — the wallet
     * listener reports that.
     */
    data class Logged(
        val daysCompleted: Int,
        val daysRequired: Int,
        val completed: Boolean = false,
    ) : LogDayResult

    /** Same-day repeat. A no-op on the server, not a failure. */
    object AlreadyLoggedToday : LogDayResult
    data class Error(val message: String) : LogDayResult
}

/**
 * The Testing Coin wallet and its ledger.
 *
 * Testing Coins are a COMMITMENT device, not a reward: coins are staked on an
 * assignment, the same coins are returned when it completes, and they are
 * forfeited when it fails. They are not cash, are not withdrawable and cannot
 * be transferred between users.
 *
 * SECURITY NOTE
 * This interface is deliberately READ-ONLY, and must stay that way. Security
 * rules refuse every client write to the `wallet` and `coinTransactions`
 * subcollections under a user, so a mutating method here could only ever be a
 * Cloud Function call — and value-moving calls belong next to the thing they
 * move, where each one can be reasoned about separately. Committing coins to a
 * test lives on [AssignmentRepository.claimAssignment]; returning and
 * forfeiting them are server-side settlement paths with no client entry point
 * at all. Do not add `setBalance`, `spend`, `unlock` or anything like them
 * here.
 *
 * Note also what is absent: there is no "compute my balance from the ledger"
 * method. [observeWallet] reads the server-maintained document.
 * [observeTransactions] returns a capped, ordered page for display only, so
 * folding it on-device would silently disagree with the server once a user has
 * more entries than the page holds.
 */
interface CoinRepository {
    /**
     * The server-maintained wallet document.
     *
     * Emits [CoinWallet.EMPTY] (with `exists = false`) for a user who has
     * never transacted — that is a real zero balance, not an error.
     */
    fun observeWallet(userId: String): Flow<CoinWallet>

    /** Ledger entries, most recent first. Display only. */
    fun observeTransactions(userId: String): Flow<List<CoinTransaction>>
}

/**
 * Quick Tests — lightweight discovery sessions, outside the coin economy.
 *
 * Every method here either reads server-maintained state or asks the backend
 * to act. There is deliberately no client write path: the discovery pool, the
 * session documents, the daily counter and the per-app cooldown are all
 * refused to clients by security rules, because a client that could write any
 * of them could bypass the daily limit, the cooldown, or the rotation that
 * keeps discovery fair.
 */
interface QuickTestRepository {
    /**
     * The server-maintained discovery pool, in server-decided order.
     *
     * Order is preserved rather than re-sorted by the client — see
     * [com.apptesting.app.feature.testapps.QuickTestSelection].
     */
    fun observePoolAppIds(): Flow<List<String>>

    /**
     * The viewer's own daily count and per-app cooldowns.
     *
     * For rendering and early button-disabling only; the server re-derives all
     * of it on every [startQuickTest] call.
     */
    fun observeAllowance(userId: String): Flow<QuickTestAllowance>

    /** Sessions this user has opened, most recent first. */
    fun observeSessions(userId: String): Flow<List<QuickTestSession>>

    /** Ask the backend to start a Quick Test. Never writes Firestore directly. */
    suspend fun startQuickTest(appId: String): StartQuickTestResult

    /** Ask the backend to mark today's session for [appId] complete. */
    suspend fun completeQuickTest(appId: String, note: String? = null): Result<Unit>
}

sealed interface StartQuickTestResult {
    data class Started(val sessionId: String, val remainingToday: Int) : StartQuickTestResult
    /** The user already opened this app today — a no-op, not a failure. */
    object AlreadyToday : StartQuickTestResult
    data class Error(val message: String) : StartQuickTestResult
}

interface NotificationRepository {
    fun observeUnread(userId: String): Flow<List<Notification>>
    suspend fun markRead(notificationId: String)
}

/**
 * Admin operations. The mutating calls here are requests to the backend, not
 * Firestore writes: security rules refuse app-status and suspension writes to
 * every client, so the server decides whether they happen.
 */
interface AdminRepository {
    fun observeAllUsers(): Flow<List<User>>
    fun observeAllApps(): Flow<List<AppSubmission>>
    fun observeAllAssignments(): Flow<List<TestAssignment>>
    suspend fun setAppStatus(appId: String, status: AppApprovalStatus): Result<Unit>
    suspend fun setUserSuspended(userId: String, isSuspended: Boolean): Result<Unit>

    /**
     * Ask the backend how many testers are ELIGIBLE to claim an approved app.
     *
     * READ-ONLY, and deliberately so. This used to be `assignTesters`, which
     * pushed assignments onto matched testers — creating live tester
     * obligations with no coins staked behind them. Under the commitment model
     * a tester becomes a tester only by claiming and staking, through
     * [AssignmentRepository.claimAssignment]. This call now just reports reach.
     *
     * Returns the eligible tester count; zero is a normal outcome.
     */
    suspend fun previewEligibleTesters(appId: String): Result<Int>

    /**
     * Create or update a group. `null` for any field leaves it unchanged on
     * an existing group; on a new group an omitted field is left to the
     * backend's default. `groups` has no client-writable path at all —
     * this is the only way a group's name, summary, rules or member cap
     * can change.
     */
    suspend fun upsertGroup(
        groupId: String,
        name: String? = null,
        summary: String? = null,
        rules: String? = null,
        memberCap: Int? = null,
    ): Result<Unit>
}

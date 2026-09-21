package com.apptesting.app.core.model

/**
 * Domain models — data-class shape mirrors the planned Firestore collections
 * (users, apps, groups, groupMembers, testAssignments, coinTransactions,
 * notifications, reports, adminActions).
 *
 * These are pure Kotlin — no Firestore annotations yet, to keep the module
 * decoupled from the SDK until the repository layer lands. When Firestore
 * mappers are added they should live next to their repository, not here.
 *
 * SECURITY NOTE
 * Fields marked "server-authoritative" must never be written by the client.
 * Firestore security rules and Cloud Functions enforce that constraint;
 * these comments only document intent. Do not add client-side setters.
 */

/** A community member. Every user is both a developer and a tester. */
data class User(
    val id: String = "",
    val displayName: String = "",
    val email: String = "",
    val photoUrl: String? = null,
    val createdAtMillis: Long = 0L,
    val termsAcceptedAtMillis: Long? = null,
    /** server-authoritative */
    val coinBalance: Int = 0,
    /** server-authoritative — 0..100 */
    val trustScore: Int = 0,
    /** server-authoritative */
    val role: UserRole = UserRole.Member,
    /** server-authoritative — set by the admin console only */
    val isSuspended: Boolean = false,
)

enum class UserRole { Member, Moderator, Admin }

/** A user-submitted app entered into community testing. */
data class AppSubmission(
    val id: String = "",
    val ownerUserId: String = "",
    val name: String = "",
    val packageName: String = "",
    val description: String = "",
    val iconStoragePath: String? = null,
    val playStoreUrl: String = "",
    val optInUrl: String = "",
    val versionName: String = "",
    val createdAtMillis: Long = 0L,
    /** server-authoritative */
    val approvalStatus: AppApprovalStatus = AppApprovalStatus.PendingReview,
    /** server-authoritative */
    val activeGroupId: String? = null,
    /** server-authoritative — denormalized count of testers actively assigned */
    val testerCount: Int = 0,
    /** server-authoritative — how many testers have finished the required period */
    val completedTesterCount: Int = 0,
)

enum class AppApprovalStatus { PendingReview, Approved, Rejected, Archived }

/** A group organizes members and testing rotations. */
data class Group(
    val id: String = "",
    val name: String = "",
    val summary: String = "",
    val rules: String = "",
    val visibility: GroupVisibility = GroupVisibility.Open,
    val state: GroupState = GroupState.Draft,
    val memberCap: Int = 0,
    val currentMemberCount: Int = 0,
    val createdByUserId: String = "",
    val createdAtMillis: Long = 0L,
    /**
     * Google Group email used for Play Console closed testing.
     * The admin creates and manages the underlying Google Group; this app
     * only records and organizes participation around it.
     */
    val googleGroupEmail: String = "",
)

enum class GroupVisibility { Open, InviteOnly, Private }
enum class GroupState { Draft, Open, Full, Active, Completed, Archived, Cancelled }

/** Membership in a group. */
data class GroupMember(
    val id: String = "",
    val groupId: String = "",
    val userId: String = "",
    val joinedAtMillis: Long = 0L,
    val role: GroupMemberRole = GroupMemberRole.Member,
    /** server-authoritative — cumulative for this membership */
    val assignmentsCompleted: Int = 0,
)

enum class GroupMemberRole { Member, Lead }

/** A single testing assignment given to one user for one app. */
data class TestAssignment(
    val id: String = "",
    val groupId: String = "",
    val appId: String = "",
    val testerUserId: String = "",
    val assignedAtMillis: Long = 0L,
    val deadlineAtMillis: Long? = null,
    val daysRequired: Int = 14,
    /**
     * server-authoritative — qualifying testing days recorded so far.
     *
     * Maintained by the `recordTestingDay` callable inside the same
     * transaction as the log that earned it, and read straight off the
     * assignment. The client never counts logs to derive this.
     */
    val daysCompleted: Int = 0,
    /** server-authoritative — driven by tester actions + admin verification */
    val status: AssignmentStatus = AssignmentStatus.Ready,
    /**
     * server-authoritative — Testing Coins STAKED on this assignment.
     *
     * This is a commitment, not a payout: completing returns the same coins,
     * failing forfeits them. Read from `commitmentAmount`, falling back to the
     * reward-era `coinReward` field for assignments created before the wallet
     * existed, so historical records still display a sensible number.
     */
    val commitmentAmount: Int = 0,
    /**
     * server-authoritative — which commitment cycle this is for the
     * (app, tester) pair. 0 for a reward-era assignment with no cycle suffix.
     *
     * A tester may test the same app again after finishing, and each attempt
     * stakes its own coins, so each gets its own assignment id and its own
     * ledger entries. See `lib/commitments.js`.
     */
    val cycle: Int = 0,
    /** server-authoritative — days the tester has to meet [daysRequired]. */
    val windowDays: Int = 0,
    /**
     * server-authoritative — the ledger entry that locked this commitment.
     *
     * Non-null means coins are actually staked on this assignment. A
     * reward-era assignment has none, which is exactly why settlement skips
     * the wallet for those.
     */
    val lockTxId: String? = null,
    /**
     * server-authoritative — the ledger entry that returned or consumed the
     * stake. Non-null means this commitment is settled and cannot move coins
     * again.
     */
    val settlementTxId: String? = null,
    /**
     * server-authoritative — the IANA zone pinned to this commitment at claim.
     *
     * Authoritative for the whole lifecycle and never re-read from the device.
     * Present here for display and for explaining the deadline to the tester;
     * the client must never use it to decide whether a day counts.
     */
    val timeZone: String? = null,
    /** server-authoritative — the first local day that can qualify. */
    val firstEligibleDayKey: String? = null,
    /** server-authoritative — the last local day that can qualify. */
    val lastEligibleDayKey: String? = null,
    /**
     * server-authoritative — the last LOCAL day a qualifying testing day was
     * recorded, formatted `yyyy-MM-dd` in [timeZone].
     *
     * Written by the server alongside the log itself. Display only — it no
     * longer decides whether the check-in button is enabled, because answering
     * that from a day key forced the client to work out what "today" was.
     * [nextCheckInAtMillis] answers it instead. See [hasLoggedTodayAt].
     */
    val lastLoggedDayKey: String? = null,
    /**
     * server-authoritative — the instant today's check-in stops counting as
     * "today", i.e. local midnight after [lastLoggedDayKey] in [timeZone].
     *
     * THE reason this is an instant and not a day key. Rendering "Logged
     * today" from [lastLoggedDayKey] meant the client had to decide what
     * "today" was, and it did so in UTC — so between 00:00 and 05:30 IST the
     * server knew the day was logged while the button still looked available.
     * Comparing two instants needs no timezone at all, so the device no longer
     * holds an opinion that can disagree with the server.
     *
     * Null for an assignment with no check-in yet, and for one last written
     * before this field existed. Both read as "not logged", which costs a
     * round trip the server rejects idempotently — never a duplicate day.
     */
    val nextCheckInAtMillis: Long? = null,
) {
    /** True when Testing Coins are actually staked on this assignment. */
    val hasCommitment: Boolean get() = !lockTxId.isNullOrBlank()

    /**
     * Testing Coins to render as "committed" — 0 unless they are really locked.
     *
     * THE single definition every screen uses, so Home and Test Apps cannot
     * drift apart on what counts as a stake. [commitmentAmount] falls back to
     * the reward-era `coinReward` field when mapping an older document, so a
     * pre-wallet assignment carries a 50 that was never taken from anyone.
     * Showing it as committed would claim coins are at risk when they are not
     * locked, cannot be forfeited and will not be returned. A lock ledger
     * entry — [hasCommitment] — is the only evidence that a stake exists.
     */
    val displayedCommitmentAmount: Int get() = if (hasCommitment) commitmentAmount else 0

    /**
     * Has the tester already recorded a testing day for the current local day?
     *
     * Pure, and the single definition the UI uses. [nowMillis] is the device
     * clock, which affects only what is rendered: a skewed clock costs a
     * refused round trip in one direction and a stale "Logged today" in the
     * other. The server re-derives the day and enforces one-per-local-day with
     * a deterministic log id regardless of what this returns.
     */
    fun hasLoggedTodayAt(nowMillis: Long): Boolean {
        val boundary = nextCheckInAtMillis ?: return false
        return nowMillis < boundary
    }

    /** True once the stake has been returned or consumed. */
    val isSettled: Boolean get() = !settlementTxId.isNullOrBlank()

    /** Convenience — derived from days rather than a duplicate percentage field. */
    val progressPercent: Int
        get() = if (daysRequired <= 0) 0 else (daysCompleted * 100 / daysRequired).coerceIn(0, 100)
}

enum class AssignmentStatus {
    Ready,
    InProgress,
    WaitingForVerification,
    Completed,
    Missed,
}

/**
 * A user's Testing Coin wallet — `users/{uid}/wallet/balance`.
 *
 * PRODUCT MODEL
 * Testing Coins are a COMMITMENT device, not a reward. 50 coins represent a
 * 50-rupee commitment staked on a testing assignment. They are not cash, they
 * cannot be withdrawn, and they cannot be transferred to another user. A
 * completed assignment returns the SAME coins — there is no completion bonus.
 *
 * SECURITY NOTE
 * Every field here is server-authoritative. The document is written only by
 * Cloud Functions inside a transaction, and Firestore rules refuse every
 * client write to it, including deletes. This class is a read model: it has no
 * mutation helpers and must not gain any. In particular, do NOT add a method
 * that derives a balance from the ledger on-device — the client sees a capped,
 * ordered page of `coinTransactions`, so any client-side fold would silently
 * disagree with the server. [available] is the number to trust and display.
 */
data class CoinWallet(
    /** Spendable now — what a new commitment can be funded from. */
    val available: Int = 0,
    /** Staked on active commitments. Not spendable, not lost. */
    val locked: Int = 0,
    /** Lifetime total lost to failed commitments. Never decreases. */
    val forfeitedTotal: Int = 0,
    /** Lifetime total bought with real money. Always 0 in the pilot. */
    val purchasedTotal: Int = 0,
    /** Net of admin grants and corrections. */
    val adjustmentNet: Int = 0,
    /** How many ledger entries the server has folded into this document. */
    val ledgerCount: Int = 0,
    val lastEntryId: String? = null,
    val updatedAtMillis: Long = 0L,
    /**
     * False when the user has no wallet document yet, which is the normal
     * state for an account that has never transacted. Rendered as a real zero
     * balance rather than an error — see [CoinWallet.EMPTY].
     */
    val exists: Boolean = false,
) {
    /**
     * The invariant the server maintains. Exposed so the UI (and tests) can
     * detect a wallet that disagrees with itself rather than displaying it as
     * if it were sound. The client never repairs it — reconciliation is an
     * admin-side, server-side operation.
     */
    val isConsistent: Boolean
        get() = available >= 0 &&
            locked >= 0 &&
            forfeitedTotal >= 0 &&
            available + locked + forfeitedTotal == purchasedTotal + adjustmentNet

    companion object {
        /** A user who has never transacted. Not an error state. */
        val EMPTY = CoinWallet()
    }
}

/**
 * A single entry in a user's append-only Coin ledger.
 *
 * SECURITY NOTE
 * Every field is server-authoritative. The three deltas are derived on the
 * server from [kind] and are never chosen by a caller. Rules refuse every
 * client create, update and delete.
 */
data class CoinTransaction(
    val id: String = "",
    val userId: String = "",
    val amount: Int = 0,
    val kind: CoinTransactionKind = CoinTransactionKind.Adjustment,
    val source: CoinTransactionSource = CoinTransactionSource.Unknown,
    val deltaAvailable: Int = 0,
    val deltaLocked: Int = 0,
    val deltaForfeited: Int = 0,
    val reason: String = "",
    val relatedAssignmentId: String? = null,
    val createdAtMillis: Long = 0L,
    val actorId: String? = null,
    /**
     * Schema of the stored document. `1` is a reward-era entry written before
     * the commitment model; those carry an `amount` but no deltas, and the
     * server does not fold them into the wallet. Kept visible rather than
     * hidden so history stays readable.
     */
    val schemaVersion: Int = 1,
) {
    /** True for a pre-commitment-model entry that no longer affects a balance. */
    val isLegacyRewardEntry: Boolean get() = schemaVersion < 2
}

/**
 * What a ledger entry did to the balance.
 *
 * Mirrors the kinds in `functions/lib/constants.js`. [Earn] is deliberately
 * absent: the reward model it belonged to is gone. Historical "earn" documents
 * parse as [Unknown] so they render as history without being mistaken for a
 * current-model movement.
 */
enum class CoinTransactionKind {
    /** Bought with real money. Unused in the pilot. */
    Purchase,
    /** Staked on a commitment: available -> locked. */
    Lock,
    /** Commitment met: locked -> available. The same coins, not new ones. */
    Unlock,
    /** Commitment failed: locked -> forfeited. */
    Forfeit,
    /** Admin grant or correction. */
    Adjustment,
    /** An adjustment undone. */
    Reversal,
    /** An entry this build does not recognise, including reward-era ones. */
    Unknown,
}

/** Where a ledger entry came from. Mirrors `COIN_SOURCES` on the server. */
enum class CoinTransactionSource {
    Payment,
    Commitment,
    Completion,
    Failure,
    Cancellation,
    AdminGrant,
    AdminReversal,
    Migration,
    Unknown,
}

/**
 * One lightweight Quick Test session.
 *
 * Quick Tests sit entirely outside the Testing Coin commitment economy: zero
 * coins in, zero coins out, no [TestAssignment], no testing log, no effect on
 * commitment progress.
 *
 * SECURITY NOTE
 * There is deliberately no `assignmentId` here, and there is none on the
 * Firestore document either. That absence is what makes it impossible for a
 * Quick Test to be mistaken for, or converted into, a qualifying testing day.
 * Do not add one.
 *
 * Every field is server-authoritative: sessions are created and completed only
 * by the `startQuickTest` / `completeQuickTest` callables, and security rules
 * refuse every client write to the collection.
 */
data class QuickTestSession(
    val id: String = "",
    /** server-authoritative */
    val userId: String = "",
    /** server-authoritative */
    val appId: String = "",
    /** server-authoritative — UTC `yyyy-MM-dd`, part of the deterministic id */
    val dayKey: String = "",
    /** server-authoritative */
    val openedAtMillis: Long = 0L,
    /** server-authoritative — null until the session is completed */
    val completedAtMillis: Long? = null,
)

/**
 * What the client knows about its own Quick Test allowance.
 *
 * Used only to render counts and to disable a button before a round trip. The
 * server re-derives all of it on every call, so a tampered value here changes
 * a label, never an outcome.
 */
data class QuickTestAllowance(
    val dayKey: String = "",
    val usedToday: Int = 0,
    val dailyLimit: Int = 0,
    /** appId → the `yyyy-MM-dd` of that app's most recent session. */
    val lastSessionDayByAppId: Map<String, String> = emptyMap(),
) {
    val remainingToday: Int get() = (dailyLimit - usedToday).coerceAtLeast(0)
    val hasQuotaLeft: Boolean get() = remainingToday > 0
}

/** A notification for a user — assignments, admin messages, etc. */
data class Notification(
    val id: String = "",
    val userId: String = "",
    val title: String = "",
    val body: String = "",
    val createdAtMillis: Long = 0L,
    val readAtMillis: Long? = null,
    val deeplink: String? = null,
)

/** A user report — moderation queue input. */
data class Report(
    val id: String = "",
    val reporterUserId: String = "",
    val subjectKind: ReportSubjectKind = ReportSubjectKind.User,
    val subjectId: String = "",
    val reason: String = "",
    val createdAtMillis: Long = 0L,
    /** server-authoritative */
    val status: ReportStatus = ReportStatus.Open,
)

enum class ReportSubjectKind { User, App, Group, Assignment }
enum class ReportStatus { Open, UnderReview, Actioned, Dismissed }

/** Audit trail of admin actions. Immutable once written. */
data class AdminAction(
    val id: String = "",
    val adminUserId: String = "",
    val kind: AdminActionKind = AdminActionKind.Other,
    val targetKind: String = "",
    val targetId: String = "",
    val note: String = "",
    val createdAtMillis: Long = 0L,
)

enum class AdminActionKind {
    ApproveApp,
    RejectApp,
    SuspendUser,
    UnsuspendUser,
    AdjustCoins,
    AdjustTrustScore,
    OpenGroup,
    CloseGroup,
    ResolveReport,
    Announcement,
    Other,
}

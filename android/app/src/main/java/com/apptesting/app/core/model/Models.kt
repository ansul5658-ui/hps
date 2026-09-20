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
    /** server-authoritative — recomputed from `testingLogs` by a Cloud Function */
    val daysCompleted: Int = 0,
    /** server-authoritative — driven by tester actions + admin verification */
    val status: AssignmentStatus = AssignmentStatus.Ready,
    /** server-authoritative — Coin reward awarded on verified completion */
    val coinReward: Int = 0,
    /**
     * Last day the tester logged testing progress, formatted as `yyyy-MM-dd`
     * in UTC — the one definition of "today" that the client and Firestore
     * rules can both compute (see
     * [com.apptesting.app.core.util.TimeProvider]). Used to enforce the "one
     * log per calendar day per assignment" rule idempotently: a repeated tap
     * on the same day is a no-op. Derived from the `testingLogs` collection;
     * never mutated by the client via a copy() call.
     */
    val lastLoggedDayKey: String? = null,
) {
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

/** A single credit or debit in a user's Coin wallet. Rules configured server-side. */
data class CoinTransaction(
    val id: String = "",
    val userId: String = "",
    val amount: Int = 0,
    val kind: CoinTransactionKind = CoinTransactionKind.Earn,
    val reason: String = "",
    val relatedAssignmentId: String? = null,
    val createdAtMillis: Long = 0L,
    val recordedByAdmin: Boolean = false,
)

enum class CoinTransactionKind { Earn, Spend, Bonus, Penalty, Adjustment }

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

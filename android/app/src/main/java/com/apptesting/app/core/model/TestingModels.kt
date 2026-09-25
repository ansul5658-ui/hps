package com.apptesting.app.core.model

/*
 * Read models for the Batch 9B-9D callables: commitment status, member
 * progress, feedback, app setup readiness and join eligibility.
 *
 * EVERY FIELD HERE IS SERVER-DERIVED
 * These are parsed from callable responses and never computed on the device.
 * In particular the miss count, the remaining misses, the display state and
 * readiness come from the same server code that settles coins - the client
 * must not re-derive any of them, because a second calculation is exactly how
 * a screen ends up saying "testing" about a commitment the server has already
 * judged lost.
 */

/**
 * What the server says a commitment IS right now, which is not always its
 * stored status: a commitment past its third miss still reads `inProgress` on
 * the document until the sweep settles it, and the server reports that as
 * [AwaitingSettlement].
 */
enum class CommitmentState {
    Testing,
    AwaitingSettlement,
    Completed,
    Cancelled,
    RemovedForMisses,
    Forfeited,
    Missed,
    Unknown;

    val isActive: Boolean get() = this == Testing

    companion object {
        fun parse(raw: String?): CommitmentState = when (raw) {
            "testing" -> Testing
            "awaitingSettlement" -> AwaitingSettlement
            "completed" -> Completed
            "cancelled" -> Cancelled
            "removedForMisses" -> RemovedForMisses
            "forfeited" -> Forfeited
            "missed" -> Missed
            else -> Unknown
        }
    }
}

/** Where the staked coins are: `locked`, `returned`, `forfeited` or `none`. */
enum class StakeState {
    Locked, Returned, Forfeited, None;

    companion object {
        fun parse(raw: String?): StakeState = when (raw) {
            "locked" -> Locked
            "returned" -> Returned
            "forfeited" -> Forfeited
            else -> None
        }
    }
}

/** The caller's own commitment, from `getMyCommitmentStatus`. */
data class CommitmentStatus(
    val assignmentId: String,
    val appId: String,
    val cycle: Int?,
    val state: CommitmentState,
    /** Why it ended, or why it is about to: `tooManyMisses`, `windowClosedShort`. */
    val endReason: String?,
    val isActive: Boolean,
    val timeZone: String?,
    val firstEligibleDayKey: String?,
    val lastEligibleDayKey: String?,
    /** Outage credit applied; equal to [lastEligibleDayKey] when there is none. */
    val effectiveLastEligibleDayKey: String?,
    val windowDays: Int?,
    val todayKey: String?,
    val daysRequired: Int?,
    val qualifyingDays: Int,
    val loggedToday: Boolean,
    /** False for a legacy commitment, which has no miss limit. */
    val missRule: Boolean,
    val allowedMisses: Int?,
    val missedDays: Int?,
    val remainingMisses: Int?,
    val capacityHeld: Boolean,
    val commitmentAmount: Int,
    val stake: StakeState,
    val completedAtMillis: Long?,
    val cancelledAtMillis: Long?,
    val forfeitedAtMillis: Long?,
)

/** One anonymous row of an app's testing group, from `getMemberProgress`. */
data class MemberProgressRow(
    /** "Tester 1".."Tester N" - never a name, uid or email. */
    val label: String,
    val isYou: Boolean,
    val state: CommitmentState,
    val daysRequired: Int?,
    val qualifyingDays: Int,
    val missedDays: Int?,
    val allowedMisses: Int?,
    val remainingMisses: Int?,
    val loggedToday: Boolean,
)

data class MemberProgress(
    val appId: String,
    val capacity: Int,
    val memberCount: Int,
    val members: List<MemberProgressRow>,
)

/** The caller's own feedback for one cycle, from `getMyTestingFeedback`. */
data class MyFeedback(
    val assignmentId: String,
    val submitted: SubmittedFeedback?,
    val canSubmit: Boolean,
    /** Why not: `noTestingDays`, `noCommitment`, `alreadySubmitted`, ... */
    val reason: String?,
)

data class SubmittedFeedback(
    val rating: Int,
    val comment: String?,
    val foundBug: Boolean,
    val submittedAtMillis: Long?,
)

/** A developer's anonymous view of one feedback: no tester identity at all. */
data class AppFeedbackItem(
    val rating: Int,
    val comment: String?,
    val foundBug: Boolean,
    val submittedAtMillis: Long?,
)

/** The owner's setup checklist, from `getAppTestingReadiness`. */
data class AppReadiness(
    val appId: String,
    val ready: Boolean,
    /** Stable server codes - see [ReadinessGap]. */
    val gaps: List<String>,
    val groupId: String,
    val groupEmail: String?,
    /** Null when the developer has never confirmed. */
    val confirmation: SetupConfirmation?,
)

data class SetupConfirmation(
    /** Always `selfConfirmed`: AppTesting cannot verify Play or the group. */
    val kind: String?,
    val confirmedAtMillis: Long?,
    /** False when the app was edited after confirming. */
    val current: Boolean,
)

/** Readiness gap codes, as `lib/setup.js` sends them. */
object ReadinessGap {
    const val NOT_APPROVED = "notApproved"
    const val INVALID_PACKAGE = "invalidPackageName"
    const val MISSING_OPT_IN_URL = "missingOptInUrl"
    const val INVALID_OPT_IN_URL = "invalidOptInUrl"
    const val INVALID_PLAY_STORE_URL = "invalidPlayStoreUrl"
    const val NOT_CONFIRMED = "setupNotConfirmed"
    const val CONFIRMATION_OUTDATED = "setupConfirmationOutdated"
}

/** A tester's join checklist, from `getJoinEligibility`. Advisory only. */
data class JoinEligibility(
    val appId: String,
    val canJoin: Boolean,
    /** Stable server codes - see [JoinBlocker]. */
    val blockers: List<String>,
    val targetGaps: List<String>,
    val hasEligibleOwnApp: Boolean,
    val groupId: String,
    val groupEmail: String?,
    val groupJoinedSelfConfirmed: Boolean,
    val commitmentAmount: Int,
    val availableCoins: Int,
    val slotsLeft: Int,
    val capacity: Int,
)

/** Join blocker codes, as `setup.js` sends them. */
object JoinBlocker {
    const val SUSPENDED = "suspended"
    const val APP_MISSING = "appMissing"
    const val OWN_APP = "ownApp"
    const val ALREADY_JOINED = "alreadyJoined"
    const val TARGET_NOT_READY = "targetNotReady"
    const val NO_ELIGIBLE_OWN_APP = "noEligibleOwnApp"
    const val GROUP_NOT_JOINED = "groupNotJoined"
    const val INSUFFICIENT_COINS = "insufficientCoins"
    const val CAPACITY_FULL = "capacityFull"
}

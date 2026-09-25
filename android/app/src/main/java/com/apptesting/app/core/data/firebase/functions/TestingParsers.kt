package com.apptesting.app.core.data.firebase.functions

import com.apptesting.app.core.model.AppFeedbackItem
import com.apptesting.app.core.model.AppReadiness
import com.apptesting.app.core.model.CommitmentState
import com.apptesting.app.core.model.CommitmentStatus
import com.apptesting.app.core.model.JoinEligibility
import com.apptesting.app.core.model.MemberProgress
import com.apptesting.app.core.model.MemberProgressRow
import com.apptesting.app.core.model.MyFeedback
import com.apptesting.app.core.model.SetupConfirmation
import com.apptesting.app.core.model.StakeState
import com.apptesting.app.core.model.SubmittedFeedback

/*
 * Pure parsers for the Batch 9B-9D callable responses.
 *
 * Kept free of Firebase types so they can be unit tested. Callable results
 * arrive as untyped maps (numbers as Int, Long or Double depending on the
 * value), so every read is tolerant: a missing or mistyped field becomes a
 * conservative default - `false`, `0`, `null`, [CommitmentState.Unknown] -
 * never a crash and never an optimistic guess. In particular nothing missing
 * ever parses as "active" or "can join".
 */

private fun Map<*, *>.str(key: String): String? = (this[key] as? String)?.takeIf { it.isNotEmpty() }
private fun Map<*, *>.int(key: String): Int? = (this[key] as? Number)?.toInt()
private fun Map<*, *>.long(key: String): Long? = (this[key] as? Number)?.toLong()
private fun Map<*, *>.bool(key: String): Boolean = this[key] as? Boolean ?: false
private fun Map<*, *>.strings(key: String): List<String> =
    (this[key] as? List<*>)?.mapNotNull { it as? String }.orEmpty()
private fun Map<*, *>.maps(key: String): List<Map<*, *>> =
    (this[key] as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty()

internal fun parseCommitmentStatus(raw: Map<*, *>?): CommitmentStatus? {
    raw ?: return null
    val assignmentId = raw.str("assignmentId") ?: return null
    return CommitmentStatus(
        assignmentId = assignmentId,
        appId = raw.str("appId").orEmpty(),
        cycle = raw.int("cycle"),
        state = CommitmentState.parse(raw.str("state")),
        endReason = raw.str("endReason"),
        isActive = raw.bool("isActive"),
        timeZone = raw.str("timeZone"),
        firstEligibleDayKey = raw.str("firstEligibleDayKey"),
        lastEligibleDayKey = raw.str("lastEligibleDayKey"),
        effectiveLastEligibleDayKey = raw.str("effectiveLastEligibleDayKey"),
        windowDays = raw.int("windowDays"),
        todayKey = raw.str("todayKey"),
        daysRequired = raw.int("daysRequired"),
        qualifyingDays = raw.int("qualifyingDays") ?: 0,
        loggedToday = raw.bool("loggedToday"),
        missRule = raw.bool("missRule"),
        allowedMisses = raw.int("allowedMisses"),
        missedDays = raw.int("missedDays"),
        remainingMisses = raw.int("remainingMisses"),
        capacityHeld = raw.bool("capacityHeld"),
        commitmentAmount = raw.int("commitmentAmount") ?: 0,
        stake = StakeState.parse(raw.str("stake")),
        completedAtMillis = raw.long("completedAtMillis"),
        cancelledAtMillis = raw.long("cancelledAtMillis"),
        forfeitedAtMillis = raw.long("forfeitedAtMillis"),
    )
}

/** `getMyCommitmentStatus({ appId })` -> the latest cycle for that app, or null. */
internal fun parseCommitmentForApp(result: Map<*, *>): CommitmentStatus? =
    parseCommitmentStatus(result["commitment"] as? Map<*, *>)

/** `getMyCommitmentStatus({})` -> every open commitment. */
internal fun parseOpenCommitments(result: Map<*, *>): List<CommitmentStatus> =
    result.maps("commitments").mapNotNull(::parseCommitmentStatus)

internal fun parseMemberProgress(result: Map<*, *>): MemberProgress {
    val rows = result.maps("members").map { m ->
        MemberProgressRow(
            label = m.str("label") ?: "Tester",
            isYou = m.bool("isYou"),
            state = CommitmentState.parse(m.str("state")),
            daysRequired = m.int("daysRequired"),
            qualifyingDays = m.int("qualifyingDays") ?: 0,
            missedDays = m.int("missedDays"),
            allowedMisses = m.int("allowedMisses"),
            remainingMisses = m.int("remainingMisses"),
            loggedToday = m.bool("loggedToday"),
        )
    }
    return MemberProgress(
        appId = result.str("appId").orEmpty(),
        capacity = result.int("capacity") ?: 0,
        memberCount = result.int("memberCount") ?: rows.size,
        members = rows,
    )
}

internal fun parseMyFeedback(result: Map<*, *>): MyFeedback {
    val f = result["feedback"] as? Map<*, *>
    return MyFeedback(
        assignmentId = result.str("assignmentId").orEmpty(),
        submitted = f?.let {
            SubmittedFeedback(
                rating = it.int("rating") ?: 0,
                comment = it.str("comment"),
                foundBug = it.bool("foundBug"),
                submittedAtMillis = it.long("submittedAtMillis"),
            )
        },
        canSubmit = result.bool("canSubmit"),
        reason = result.str("reason"),
    )
}

internal fun parseAppFeedback(result: Map<*, *>): List<AppFeedbackItem> =
    result.maps("feedback").map { f ->
        AppFeedbackItem(
            rating = f.int("rating") ?: 0,
            comment = f.str("comment"),
            foundBug = f.bool("foundBug"),
            submittedAtMillis = f.long("submittedAtMillis"),
        )
    }

internal fun parseReadiness(result: Map<*, *>): AppReadiness {
    val c = result["confirmation"] as? Map<*, *>
    return AppReadiness(
        appId = result.str("appId").orEmpty(),
        ready = result.bool("ready"),
        gaps = result.strings("gaps"),
        groupId = result.str("groupId").orEmpty(),
        groupEmail = result.str("groupEmail"),
        confirmation = c?.let {
            SetupConfirmation(
                kind = it.str("kind"),
                confirmedAtMillis = it.long("confirmedAtMillis"),
                current = it.bool("current"),
            )
        },
    )
}

internal fun parseJoinEligibility(result: Map<*, *>): JoinEligibility = JoinEligibility(
    appId = result.str("appId").orEmpty(),
    canJoin = result.bool("canJoin"),
    blockers = result.strings("blockers"),
    targetGaps = result.strings("targetGaps"),
    hasEligibleOwnApp = result.bool("hasEligibleOwnApp"),
    groupId = result.str("groupId").orEmpty(),
    groupEmail = result.str("groupEmail"),
    groupJoinedSelfConfirmed = result.bool("groupJoinedSelfConfirmed"),
    commitmentAmount = result.int("commitmentAmount") ?: 0,
    availableCoins = result.int("availableCoins") ?: 0,
    slotsLeft = result.int("slotsLeft") ?: 0,
    capacity = result.int("capacity") ?: 0,
)

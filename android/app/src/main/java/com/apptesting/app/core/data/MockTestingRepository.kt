package com.apptesting.app.core.data

import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppFeedbackItem
import com.apptesting.app.core.model.AppReadiness
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CommitmentState
import com.apptesting.app.core.model.CommitmentStatus
import com.apptesting.app.core.model.JoinBlocker
import com.apptesting.app.core.model.JoinEligibility
import com.apptesting.app.core.model.MemberProgress
import com.apptesting.app.core.model.MemberProgressRow
import com.apptesting.app.core.model.MyFeedback
import com.apptesting.app.core.model.ReadinessGap
import com.apptesting.app.core.model.SetupConfirmation
import com.apptesting.app.core.model.StakeState
import com.apptesting.app.core.model.SubmittedFeedback
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.isTerminal
import com.apptesting.app.core.util.AppConfig

/**
 * Dev-mode [TestingRepository], used only when Firebase is not configured.
 *
 * Mirrors the SHAPE of the server's answers so screens can be built and
 * previewed offline. It is not a second implementation of the rules: misses
 * are not modelled (always 0), and it never runs against real data.
 */
internal class MockTestingRepository(private val store: MockStore) : TestingRepository {

    private val confirmedApps = mutableSetOf<String>()
    private val feedback = mutableMapOf<String, SubmittedFeedback>()

    private fun me(): String? = store.currentUser.value?.id

    private fun statusOf(a: TestAssignment): CommitmentStatus {
        val state = when (a.status) {
            AssignmentStatus.Completed -> CommitmentState.Completed
            AssignmentStatus.Cancelled -> CommitmentState.Cancelled
            AssignmentStatus.Failed -> CommitmentState.Forfeited
            AssignmentStatus.Missed -> CommitmentState.Missed
            else -> CommitmentState.Testing
        }
        val terminal = a.status.isTerminal
        return CommitmentStatus(
            assignmentId = a.id,
            appId = a.appId,
            cycle = a.cycle,
            state = state,
            endReason = null,
            isActive = state == CommitmentState.Testing,
            timeZone = a.timeZone,
            firstEligibleDayKey = a.firstEligibleDayKey,
            lastEligibleDayKey = a.lastEligibleDayKey,
            effectiveLastEligibleDayKey = a.lastEligibleDayKey,
            windowDays = a.windowDays,
            todayKey = null,
            daysRequired = a.daysRequired,
            qualifyingDays = a.daysCompleted,
            loggedToday = a.hasLoggedTodayAt(System.currentTimeMillis()),
            missRule = true,
            allowedMisses = 2,
            missedDays = if (terminal) null else 0,
            remainingMisses = if (terminal) null else 2,
            capacityHeld = !terminal || a.status == AssignmentStatus.Completed,
            commitmentAmount = a.displayedCommitmentAmount,
            stake = when {
                !a.hasCommitment -> StakeState.None
                a.status == AssignmentStatus.Failed -> StakeState.Forfeited
                terminal -> StakeState.Returned
                else -> StakeState.Locked
            },
            completedAtMillis = null,
            cancelledAtMillis = null,
            forfeitedAtMillis = null,
        )
    }

    private fun mine(appId: String): List<TestAssignment> =
        store.assignments.value.filter { it.appId == appId && it.testerUserId == me() }

    override suspend fun commitmentStatus(appId: String): Result<CommitmentStatus?> =
        Result.success(mine(appId).maxByOrNull { it.cycle }?.let(::statusOf))

    override suspend fun openCommitments(): Result<List<CommitmentStatus>> = Result.success(
        store.assignments.value
            .filter { it.testerUserId == me() && !it.status.isTerminal }
            .map(::statusOf),
    )

    override suspend fun memberProgress(appId: String): Result<MemberProgress> {
        val rows = store.assignments.value
            .filter { it.appId == appId && (!it.status.isTerminal || it.status == AssignmentStatus.Completed) }
            .mapIndexed { i, a ->
                val s = statusOf(a)
                MemberProgressRow(
                    label = "Tester ${i + 1}",
                    isYou = a.testerUserId == me(),
                    state = s.state,
                    daysRequired = s.daysRequired,
                    qualifyingDays = s.qualifyingDays,
                    missedDays = s.missedDays,
                    allowedMisses = s.allowedMisses,
                    remainingMisses = s.remainingMisses,
                    loggedToday = s.loggedToday,
                )
            }
        return Result.success(MemberProgress(appId, CAPACITY, rows.size, rows))
    }

    private fun readinessGaps(appId: String): List<String> {
        val app = store.apps.value.firstOrNull { it.id == appId } ?: return listOf(ReadinessGap.NOT_APPROVED)
        return buildList {
            if (app.approvalStatus != AppApprovalStatus.Approved) add(ReadinessGap.NOT_APPROVED)
            if (app.optInUrl.isBlank()) add(ReadinessGap.MISSING_OPT_IN_URL)
            if (appId !in confirmedApps) add(ReadinessGap.NOT_CONFIRMED)
        }
    }

    override suspend fun joinEligibility(appId: String): Result<JoinEligibility> {
        val uid = me()
        val app = store.apps.value.firstOrNull { it.id == appId }
        val gaps = readinessGaps(appId)
        val ownReady = store.apps.value.any { it.ownerUserId == uid && readinessGaps(it.id).isEmpty() }
        val joined = store.memberships.value.any { it.groupId == AppConfig.OFFICIAL_GROUP_ID }
        val wallet = store.wallet.value
        val blockers = buildList {
            if (app == null) add(JoinBlocker.APP_MISSING)
            if (app?.ownerUserId == uid) add(JoinBlocker.OWN_APP)
            if (mine(appId).any { !it.status.isTerminal }) add(JoinBlocker.ALREADY_JOINED)
            if (app != null && gaps.isNotEmpty()) add(JoinBlocker.TARGET_NOT_READY)
            if (!ownReady) add(JoinBlocker.NO_ELIGIBLE_OWN_APP)
            if (!joined) add(JoinBlocker.GROUP_NOT_JOINED)
            if (wallet.available < AppConfig.DEFAULT_COMMITMENT_AMOUNT) add(JoinBlocker.INSUFFICIENT_COINS)
        }
        return Result.success(
            JoinEligibility(
                appId = appId,
                canJoin = blockers.isEmpty(),
                blockers = blockers,
                targetGaps = gaps,
                hasEligibleOwnApp = ownReady,
                groupId = AppConfig.OFFICIAL_GROUP_ID,
                groupEmail = AppConfig.OFFICIAL_GROUP_EMAIL,
                groupJoinedSelfConfirmed = joined,
                commitmentAmount = AppConfig.DEFAULT_COMMITMENT_AMOUNT,
                availableCoins = wallet.available,
                slotsLeft = CAPACITY,
                capacity = CAPACITY,
            ),
        )
    }

    override suspend fun myFeedback(assignmentId: String): Result<MyFeedback> {
        val a = store.assignments.value.firstOrNull { it.id == assignmentId && it.testerUserId == me() }
            ?: return Result.failure(IllegalStateException("We couldn't find that testing commitment."))
        val done = feedback[assignmentId]
        return Result.success(
            MyFeedback(
                assignmentId = assignmentId,
                submitted = done,
                canSubmit = done == null && a.daysCompleted >= 1,
                reason = when {
                    done != null -> "alreadySubmitted"
                    a.daysCompleted < 1 -> "noTestingDays"
                    else -> null
                },
            ),
        )
    }

    override suspend fun submitFeedback(
        assignmentId: String,
        rating: Int,
        comment: String?,
        foundBug: Boolean,
    ): SubmitFeedbackResult {
        if (feedback.containsKey(assignmentId)) return SubmitFeedbackResult.AlreadySubmitted
        feedback[assignmentId] = SubmittedFeedback(rating, comment?.trim()?.ifEmpty { null }, foundBug, System.currentTimeMillis())
        return SubmitFeedbackResult.Submitted
    }

    override suspend fun appFeedback(appId: String): Result<List<AppFeedbackItem>> = Result.success(
        feedback.filterKeys { id -> store.assignments.value.any { it.id == id && it.appId == appId } }
            .values.map { AppFeedbackItem(it.rating, it.comment, it.foundBug, it.submittedAtMillis) },
    )

    override suspend fun appReadiness(appId: String): Result<AppReadiness> {
        val gaps = readinessGaps(appId)
        return Result.success(
            AppReadiness(
                appId = appId,
                ready = gaps.isEmpty(),
                gaps = gaps,
                groupId = AppConfig.OFFICIAL_GROUP_ID,
                groupEmail = AppConfig.OFFICIAL_GROUP_EMAIL,
                confirmation = if (appId in confirmedApps) {
                    SetupConfirmation("selfConfirmed", System.currentTimeMillis(), current = true)
                } else {
                    null
                },
            ),
        )
    }

    override suspend fun confirmAppSetup(appId: String): ConfirmSetupResult {
        confirmedApps += appId
        return ConfirmSetupResult.Confirmed(ready = readinessGaps(appId).isEmpty())
    }

    private companion object {
        const val CAPACITY = AppConfig.REQUIRED_TESTER_COUNT
    }
}

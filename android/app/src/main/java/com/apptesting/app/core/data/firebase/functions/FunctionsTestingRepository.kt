package com.apptesting.app.core.data.firebase.functions

import com.apptesting.app.core.data.ConfirmSetupResult
import com.apptesting.app.core.data.SubmitFeedbackResult
import com.apptesting.app.core.data.TestingRepository
import com.apptesting.app.core.model.AppFeedbackItem
import com.apptesting.app.core.model.AppReadiness
import com.apptesting.app.core.model.CommitmentStatus
import com.apptesting.app.core.model.JoinEligibility
import com.apptesting.app.core.model.MemberProgress
import com.apptesting.app.core.model.MyFeedback

/**
 * [TestingRepository] over the Batch 9B-9D callables.
 *
 * Deliberately thin: it sends ids and content, and parses what comes back.
 * The tester is always the verified caller on the ID token - no method here
 * takes a user id - and every decision (eligibility, readiness, the miss
 * count, the display state, whether feedback is allowed) is the server's.
 */
internal class FunctionsTestingRepository(
    private val functions: AppFunctions = AppFunctions(),
) : TestingRepository {

    override suspend fun commitmentStatus(appId: String): Result<CommitmentStatus?> = runCatching {
        parseCommitmentForApp(functions.call("getMyCommitmentStatus", mapOf("appId" to appId)))
    }

    override suspend fun openCommitments(): Result<List<CommitmentStatus>> = runCatching {
        parseOpenCommitments(functions.call("getMyCommitmentStatus", emptyMap()))
    }

    override suspend fun memberProgress(appId: String): Result<MemberProgress> = runCatching {
        parseMemberProgress(functions.call("getMemberProgress", mapOf("appId" to appId)))
    }

    override suspend fun joinEligibility(appId: String): Result<JoinEligibility> = runCatching {
        parseJoinEligibility(functions.call("getJoinEligibility", mapOf("appId" to appId)))
    }

    override suspend fun myFeedback(assignmentId: String): Result<MyFeedback> = runCatching {
        parseMyFeedback(functions.call("getMyTestingFeedback", mapOf("assignmentId" to assignmentId)))
    }

    override suspend fun submitFeedback(
        assignmentId: String,
        rating: Int,
        comment: String?,
        foundBug: Boolean,
    ): SubmitFeedbackResult = try {
        functions.call(
            "submitTestingFeedback",
            buildMap {
                put("assignmentId", assignmentId)
                put("rating", rating)
                // Omitted rather than sent blank: the server stores no comment either way.
                comment?.trim()?.takeIf { it.isNotEmpty() }?.let { put("comment", it) }
                put("foundBug", foundBug)
            },
        )
        SubmitFeedbackResult.Submitted
    } catch (e: CallableException) {
        when {
            e.code == "ALREADY_EXISTS" || e.reason == "alreadySubmitted" -> SubmitFeedbackResult.AlreadySubmitted
            e.code == "FAILED_PRECONDITION" || e.code == "NOT_FOUND" || e.code == "PERMISSION_DENIED" ->
                SubmitFeedbackResult.NotAllowed(e.reason, e.message.orEmpty())
            else -> SubmitFeedbackResult.Error(e.message.orEmpty())
        }
    }

    override suspend fun appFeedback(appId: String): Result<List<AppFeedbackItem>> = runCatching {
        parseAppFeedback(functions.call("getAppFeedback", mapOf("appId" to appId)))
    }

    override suspend fun appReadiness(appId: String): Result<AppReadiness> = runCatching {
        parseReadiness(functions.call("getAppTestingReadiness", mapOf("appId" to appId)))
    }

    override suspend fun confirmAppSetup(appId: String): ConfirmSetupResult = try {
        val result = functions.call(
            "confirmAppTestingSetup",
            mapOf(
                "appId" to appId,
                // Sent only because the developer ticked both boxes on screen;
                // the button is disabled until they do.
                "closedTestConfigured" to true,
                "googleGroupAdded" to true,
            ),
        )
        ConfirmSetupResult.Confirmed(ready = result["ready"] as? Boolean ?: false)
    } catch (e: CallableException) {
        if (e.reason == "setupIncomplete") {
            ConfirmSetupResult.SetupIncomplete(e.gaps, e.message.orEmpty())
        } else {
            ConfirmSetupResult.Error(e.message.orEmpty())
        }
    }
}

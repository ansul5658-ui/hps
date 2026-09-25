package com.apptesting.app.core.data.firebase.functions

import com.apptesting.app.core.data.ClaimAssignmentResult
import com.apptesting.app.core.data.firebase.firestore.claimResultFor
import com.apptesting.app.core.model.CommitmentState
import com.apptesting.app.core.model.JoinBlocker
import com.apptesting.app.core.model.ReadinessGap
import com.apptesting.app.core.model.StakeState
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Batch 9E: the Android side of the 9B-9D callables.
 *
 * The rules live on the server and are proven there. What matters here is
 * that the app reads the server's answers faithfully - every field, with the
 * callable's number types - and that anything missing or malformed reads as
 * the conservative answer, never as "active" or "can join".
 */
class TestingParsersTest {

    // Callable results use Long/Int/Double interchangeably for numbers.
    private val liveStatus: Map<String, Any?> = mapOf(
        "assignmentId" to "app1__t1__c2",
        "appId" to "app1",
        "cycle" to 2L,
        "status" to "inProgress",
        "state" to "testing",
        "endReason" to null,
        "isActive" to true,
        "timeZone" to "Asia/Kolkata",
        "firstEligibleDayKey" to "2026-03-02",
        "lastEligibleDayKey" to "2026-03-17",
        "effectiveLastEligibleDayKey" to "2026-03-18",
        "windowDays" to 16,
        "todayKey" to "2026-03-06",
        "daysRequired" to 14.0,
        "qualifyingDays" to 4L,
        "loggedToday" to true,
        "missRule" to true,
        "allowedMisses" to 2,
        "missedDays" to 1,
        "remainingMisses" to 1,
        "capacityHeld" to true,
        "commitmentAmount" to 50L,
        "stake" to "locked",
        "completedAtMillis" to null,
        "cancelledAtMillis" to null,
        "forfeitedAtMillis" to null,
    )

    @Test
    fun `a live status is read field for field`() {
        val s = parseCommitmentForApp(mapOf("commitment" to liveStatus))!!
        assertEquals("app1__t1__c2", s.assignmentId)
        assertEquals(2, s.cycle)
        assertEquals(CommitmentState.Testing, s.state)
        assertTrue(s.isActive)
        assertEquals("2026-03-18", s.effectiveLastEligibleDayKey)
        assertEquals(16, s.windowDays)
        assertEquals(14, s.daysRequired)
        assertEquals(4, s.qualifyingDays)
        assertTrue(s.loggedToday)
        assertTrue(s.missRule)
        assertEquals(2, s.allowedMisses)
        assertEquals(1, s.missedDays)
        assertEquals(1, s.remainingMisses)
        assertEquals(50, s.commitmentAmount)
        assertEquals(StakeState.Locked, s.stake)
    }

    @Test
    fun `every server state and stake maps to its own value`() {
        mapOf(
            "testing" to CommitmentState.Testing,
            "awaitingSettlement" to CommitmentState.AwaitingSettlement,
            "completed" to CommitmentState.Completed,
            "cancelled" to CommitmentState.Cancelled,
            "removedForMisses" to CommitmentState.RemovedForMisses,
            "forfeited" to CommitmentState.Forfeited,
            "missed" to CommitmentState.Missed,
        ).forEach { (raw, state) -> assertEquals(raw, state, CommitmentState.parse(raw)) }
        assertEquals(StakeState.Returned, StakeState.parse("returned"))
        assertEquals(StakeState.Forfeited, StakeState.parse("forfeited"))
        assertEquals(StakeState.None, StakeState.parse("none"))
    }

    @Test
    fun `an unknown or missing state is Unknown - never active`() {
        for (raw in listOf(null, "", "verified", "TESTING")) {
            val state = CommitmentState.parse(raw)
            assertEquals(CommitmentState.Unknown, state)
            assertFalse(state.isActive)
        }
        val s = parseCommitmentStatus(mapOf("assignmentId" to "a"))!!
        assertEquals(CommitmentState.Unknown, s.state)
        assertFalse(s.isActive)
        assertFalse(s.loggedToday)
        assertFalse(s.missRule)
        assertNull(s.missedDays)
        assertEquals(StakeState.None, s.stake)
    }

    @Test
    fun `no commitment reads as null, and a nameless one is dropped`() {
        assertNull(parseCommitmentForApp(mapOf("commitment" to null)))
        assertNull(parseCommitmentForApp(emptyMap<String, Any?>()))
        assertNull(parseCommitmentStatus(mapOf("appId" to "app1")))
        assertEquals(
            listOf("app1__t1__c2"),
            parseOpenCommitments(mapOf("commitments" to listOf(liveStatus, mapOf("appId" to "x"), "junk"))).map { it.assignmentId },
        )
    }

    @Test
    fun `member progress keeps only the anonymous fields`() {
        val p = parseMemberProgress(
            mapOf(
                "appId" to "app1",
                "capacity" to 16L,
                "memberCount" to 2,
                "members" to listOf(
                    mapOf(
                        "label" to "Tester 1", "isYou" to false, "state" to "testing",
                        "daysRequired" to 14, "qualifyingDays" to 5, "missedDays" to 0,
                        "allowedMisses" to 2, "remainingMisses" to 2, "loggedToday" to true,
                    ),
                    mapOf(
                        "label" to "Tester 2", "isYou" to true, "state" to "awaitingSettlement",
                        "qualifyingDays" to 1, "missedDays" to 3,
                    ),
                ),
            ),
        )
        assertEquals(16, p.capacity)
        assertEquals(listOf("Tester 1", "Tester 2"), p.members.map { it.label })
        assertEquals(listOf(false, true), p.members.map { it.isYou })
        assertEquals(CommitmentState.AwaitingSettlement, p.members[1].state)
        assertEquals(3, p.members[1].missedDays)
        // The model has nowhere to put an identity: no uid, email or assignment id field exists.
        val fields = com.apptesting.app.core.model.MemberProgressRow::class.java.declaredFields.map { it.name }
        for (forbidden in listOf("uid", "testerId", "userId", "email", "assignmentId", "displayName")) {
            assertFalse(forbidden, fields.contains(forbidden))
        }
    }

    @Test
    fun `join eligibility defaults to cannot-join when anything is missing`() {
        val e = parseJoinEligibility(emptyMap<String, Any?>())
        assertFalse(e.canJoin)
        assertFalse(e.hasEligibleOwnApp)
        assertFalse(e.groupJoinedSelfConfirmed)
        assertEquals(0, e.availableCoins)
    }

    @Test
    fun `join eligibility is read field for field`() {
        val e = parseJoinEligibility(
            mapOf(
                "appId" to "app1", "canJoin" to false,
                "blockers" to listOf(JoinBlocker.GROUP_NOT_JOINED, JoinBlocker.TARGET_NOT_READY),
                "targetGaps" to listOf(ReadinessGap.NOT_CONFIRMED),
                "hasEligibleOwnApp" to true, "groupId" to "app_testing_official",
                "groupEmail" to "developerapptesting@googlegroups.com",
                "groupJoinedSelfConfirmed" to false, "commitmentAmount" to 50L,
                "availableCoins" to 120L, "slotsLeft" to 3, "capacity" to 16,
            ),
        )
        assertEquals(listOf("groupNotJoined", "targetNotReady"), e.blockers)
        assertEquals(listOf("setupNotConfirmed"), e.targetGaps)
        assertTrue(e.hasEligibleOwnApp)
        assertEquals(120, e.availableCoins)
        assertEquals(3, e.slotsLeft)
        assertEquals(16, e.capacity)
    }

    @Test
    fun `readiness and its self-confirmation are read as sent`() {
        val r = parseReadiness(
            mapOf(
                "appId" to "app1", "ready" to false,
                "gaps" to listOf(ReadinessGap.CONFIRMATION_OUTDATED),
                "groupId" to "app_testing_official", "groupEmail" to "g@x",
                "confirmation" to mapOf("kind" to "selfConfirmed", "confirmedAtMillis" to 1000L, "current" to false),
            ),
        )
        assertFalse(r.ready)
        assertEquals(listOf("setupConfirmationOutdated"), r.gaps)
        assertEquals("selfConfirmed", r.confirmation!!.kind)
        assertFalse(r.confirmation!!.current)
        assertNull(parseReadiness(mapOf("ready" to true)).confirmation)
    }

    @Test
    fun `feedback reads - own and anonymous`() {
        val mine = parseMyFeedback(
            mapOf(
                "assignmentId" to "a", "canSubmit" to false, "reason" to "alreadySubmitted",
                "feedback" to mapOf("rating" to 4L, "comment" to "ok", "foundBug" to true, "submittedAtMillis" to 5L),
            ),
        )
        assertEquals(4, mine.submitted!!.rating)
        assertTrue(mine.submitted!!.foundBug)
        assertEquals("alreadySubmitted", mine.reason)
        val none = parseMyFeedback(mapOf("assignmentId" to "a", "feedback" to null, "canSubmit" to true))
        assertNull(none.submitted)
        assertTrue(none.canSubmit)

        val list = parseAppFeedback(mapOf("feedback" to listOf(mapOf("rating" to 2, "comment" to null, "foundBug" to false))))
        assertEquals(1, list.size)
        assertNull(list[0].comment)
        val fields = com.apptesting.app.core.model.AppFeedbackItem::class.java.declaredFields.map { it.name }
        for (forbidden in listOf("testerId", "assignmentId", "uid", "cycle")) assertFalse(forbidden, fields.contains(forbidden))
    }

    // -----------------------------------------------------------------------
    // Typed callable errors
    // -----------------------------------------------------------------------

    @Test
    fun `a callable error keeps the server's reason and gaps`() {
        val e = CallableException.from(
            "FAILED_PRECONDITION",
            "That app's testing setup isn't ready yet.",
            mapOf("reason" to "targetNotReady", "gaps" to listOf("setupNotConfirmed", 7)),
        )
        assertEquals("FAILED_PRECONDITION", e.code)
        assertEquals("targetNotReady", e.reason)
        assertEquals(listOf("setupNotConfirmed"), e.gaps)
        assertEquals("That app's testing setup isn't ready yet.", e.message)
        assertTrue(e is IllegalStateException)
    }

    @Test
    fun `missing details are fine, and transport noise never becomes the message`() {
        val e = CallableException.from("UNAVAILABLE", "UNAVAILABLE: io exception at 127.0.0.1:5001", null)
        assertNull(e.reason)
        assertTrue(e.gaps.isEmpty())
        assertEquals("Network problem — please try again.", e.message)
        assertTrue(e.isTransient)
        assertFalse(CallableException.from("PERMISSION_DENIED", "No.", null).isTransient)
    }

    @Test
    fun `already-exists and aborted pass the server's words through`() {
        assertEquals("You've already left feedback.", messageFor("ALREADY_EXISTS", "You've already left feedback."))
        assertEquals("That has already been done.", messageFor("ALREADY_EXISTS", null))
        assertEquals("Your app changed while confirming.", messageFor("ABORTED", "Your app changed while confirming."))
    }

    // -----------------------------------------------------------------------
    // Claim outcomes
    // -----------------------------------------------------------------------

    @Test
    fun `a gate refusal keeps its reason for the join sheet`() {
        val r = claimResultFor(
            CallableException("FAILED_PRECONDITION", "groupNotJoined", emptyList(), "Join the group first."),
        )
        assertTrue(r is ClaimAssignmentResult.Refused)
        r as ClaimAssignmentResult.Refused
        assertEquals("groupNotJoined", r.reason)
        assertEquals("Join the group first.", r.message)
    }

    @Test
    fun `capacity, suspension, own app and missing app are refusals, not crashes`() {
        for (code in listOf("RESOURCE_EXHAUSTED", "PERMISSION_DENIED", "NOT_FOUND")) {
            assertTrue(code, claimResultFor(CallableException(code, null, emptyList(), "x")) is ClaimAssignmentResult.Refused)
        }
    }

    @Test
    fun `already joined is information, low coins keeps its own result, network is an error`() {
        assertEquals(
            ClaimAssignmentResult.AlreadyCommitted,
            claimResultFor(CallableException("ALREADY_EXISTS", null, emptyList(), "You already have an active commitment for this app.")),
        )
        assertTrue(
            claimResultFor(
                CallableException("FAILED_PRECONDITION", null, emptyList(), "You need 50 available Testing Coins to commit to this test."),
            ) is ClaimAssignmentResult.InsufficientCoins,
        )
        assertTrue(claimResultFor(CallableException("UNAVAILABLE", null, emptyList(), "Network problem")) is ClaimAssignmentResult.Error)
    }
}

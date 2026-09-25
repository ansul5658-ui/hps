package com.apptesting.app.feature.testapps

import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CommitmentState
import com.apptesting.app.core.model.JoinBlocker
import com.apptesting.app.core.model.ReadinessGap
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.util.AppConfig
import com.apptesting.app.feature.testapps.status.FeedbackInput
import com.apptesting.app.feature.testapps.status.MissWarning
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Batch 9E: the pure pieces of the tester and developer screens.
 */
class TestingUiRulesTest {

    // -----------------------------------------------------------------------
    // Which cycle a row shows
    // -----------------------------------------------------------------------

    private fun a(id: String, app: String, cycle: Int, status: AssignmentStatus) =
        TestAssignment(id = id, appId = app, cycle = cycle, status = status, lockTxId = "lock_$id")

    @Test
    fun `after cancel and rejoin the live cycle is shown, whatever the listing order`() {
        val old = a("app1__t__c1", "app1", 1, AssignmentStatus.Cancelled)
        val live = a("app1__t__c2", "app1", 2, AssignmentStatus.Ready)
        assertEquals(live, currentAssignmentPerApp(listOf(old, live))["app1"])
        assertEquals(live, currentAssignmentPerApp(listOf(live, old))["app1"])
    }

    @Test
    fun `each app gets its own current cycle`() {
        val list = listOf(
            a("app1__t__c1", "app1", 1, AssignmentStatus.Completed),
            a("app2__t__c3", "app2", 3, AssignmentStatus.Failed),
            a("app2__t__c1", "app2", 1, AssignmentStatus.Cancelled),
            a("app2__t__c2", "app2", 2, AssignmentStatus.Cancelled),
        )
        val m = currentAssignmentPerApp(list)
        assertEquals("app1__t__c1", m["app1"]!!.id)
        assertEquals("app2__t__c3", m["app2"]!!.id)
    }

    @Test
    fun `equal cycles on corrupt data prefer the live assignment`() {
        val settled = a("x", "app1", 1, AssignmentStatus.Cancelled)
        val live = a("y", "app1", 1, AssignmentStatus.InProgress)
        assertEquals(live, currentAssignmentPerApp(listOf(settled, live))["app1"])
        assertEquals(live, currentAssignmentPerApp(listOf(live, settled))["app1"])
    }

    // -----------------------------------------------------------------------
    // Copy
    // -----------------------------------------------------------------------

    private val blockers = listOf(
        JoinBlocker.SUSPENDED, JoinBlocker.APP_MISSING, JoinBlocker.OWN_APP, JoinBlocker.ALREADY_JOINED,
        JoinBlocker.TARGET_NOT_READY, JoinBlocker.NO_ELIGIBLE_OWN_APP, JoinBlocker.GROUP_NOT_JOINED,
        JoinBlocker.INSUFFICIENT_COINS, JoinBlocker.CAPACITY_FULL,
    )
    private val gaps = listOf(
        ReadinessGap.NOT_APPROVED, ReadinessGap.INVALID_PACKAGE, ReadinessGap.MISSING_OPT_IN_URL,
        ReadinessGap.INVALID_OPT_IN_URL, ReadinessGap.INVALID_PLAY_STORE_URL, ReadinessGap.NOT_CONFIRMED,
        ReadinessGap.CONFIRMATION_OUTDATED,
    )

    @Test
    fun `every server blocker and gap has its own specific wording`() {
        val fallbackBlocker = TestingCopy.joinBlocker("somethingNew")
        blockers.forEach { assertNotEquals(it, fallbackBlocker, TestingCopy.joinBlocker(it)) }
        assertEquals(blockers.size, blockers.map { TestingCopy.joinBlocker(it) }.toSet().size)
        val fallbackGap = TestingCopy.readinessGap("somethingNew")
        gaps.forEach { assertNotEquals(it, fallbackGap, TestingCopy.readinessGap(it)) }
    }

    @Test
    fun `the group blocker says exactly what the brief asks`() {
        assertEquals("Join the official AppTesting Google Group first.", TestingCopy.joinBlocker(JoinBlocker.GROUP_NOT_JOINED))
    }

    @Test
    fun `nothing the user reads claims verification`() {
        val all = buildList {
            blockers.forEach { add(TestingCopy.joinBlocker(it)) }
            gaps.forEach { add(TestingCopy.readinessGap(it)) }
            CommitmentState.values().forEach {
                add(TestingCopy.statePill(it))
                add(TestingCopy.stateExplanation(it, "tooManyMisses", 50))
                add(TestingCopy.stateExplanation(it, "windowClosedShort", 50))
            }
            addAll(TestingCopy.commitmentRules(50))
            add(TestingCopy.GROUP_SELF_CONFIRM_NOTE)
            add(TestingCopy.SETUP_SELF_CONFIRM_NOTE)
            add(TestingCopy.FEEDBACK_ANONYMOUS_NOTE)
            for (m in 0..3) add(MissWarning.text(m, 2, 50))
        }
        for (text in all) {
            assertFalse(text, text.contains("verif", ignoreCase = true))
            assertFalse(text, text.contains("firebase", ignoreCase = true))
            assertFalse(text, text.contains("exception", ignoreCase = true))
        }
        assertTrue(TestingCopy.GROUP_SELF_CONFIRM_NOTE.contains("self-confirmed"))
        assertTrue(TestingCopy.SETUP_SELF_CONFIRM_NOTE.contains("self-confirmed"))
    }

    @Test
    fun `the join rules state the 50 coin lock, 16-day window, 14 days, 2 misses and the third miss`() {
        val rules = TestingCopy.commitmentRules(50).joinToString(" ")
        assertTrue(rules.contains("50 Testing Coins will be locked"))
        assertTrue(rules.contains("not spent"))
        assertTrue(rules.contains("14 days within a 16-day window"))
        assertTrue(rules.contains("miss up to 2 days"))
        assertTrue(rules.contains("third missed day"))
        assertTrue(rules.contains("Today never counts as missed"))
        assertEquals(16, AppConfig.REQUIRED_TESTER_COUNT)
        assertEquals(16, AppConfig.COMMITMENT_WINDOW_DAYS)
        assertEquals(14, AppConfig.COMMITMENT_DAYS_REQUIRED)
        assertEquals(2, AppConfig.COMMITMENT_ALLOWED_MISSES)
    }

    @Test
    fun `awaiting settlement is never described as testing`() {
        assertEquals("Ending", TestingCopy.statePill(CommitmentState.AwaitingSettlement))
        val why = TestingCopy.stateExplanation(CommitmentState.AwaitingSettlement, "tooManyMisses", 50)
        assertTrue(why.contains("being closed"))
        assertTrue(why.contains("forfeited"))
        assertFalse(why.contains("under way"))
    }

    @Test
    fun `completion unlocks, cancellation returns, forfeiture forfeits - never a payout`() {
        assertTrue(TestingCopy.stateExplanation(CommitmentState.Completed, null, 50).contains("unlocked"))
        assertTrue(TestingCopy.stateExplanation(CommitmentState.Cancelled, null, 50).contains("returned"))
        assertTrue(TestingCopy.stateExplanation(CommitmentState.RemovedForMisses, "tooManyMisses", 50).contains("third missed"))
        for (s in CommitmentState.values()) {
            val t = TestingCopy.stateExplanation(s, null, 50)
            for (word in listOf("earn", "withdraw", "cash", "reward", "+50")) assertFalse("$s: $word", t.contains(word, ignoreCase = true))
        }
    }

    // -----------------------------------------------------------------------
    // Miss warning
    // -----------------------------------------------------------------------

    @Test
    fun `the miss warning escalates and names the third miss as the removal`() {
        assertTrue(MissWarning.text(0, 2, 50).contains("haven't missed"))
        val one = MissWarning.text(1, 2, 50)
        assertTrue(one.contains("miss 1 more day"))
        assertTrue(one.contains("missing 2 more removes you"))
        val two = MissWarning.text(2, 2, 50)
        assertTrue(two.contains("One more missed day removes you"))
        assertTrue(two.contains("forfeits the 50"))
        assertTrue(MissWarning.text(3, 2, 50).contains("being closed"))
    }

    // -----------------------------------------------------------------------
    // Feedback pre-validation (the server re-validates regardless)
    // -----------------------------------------------------------------------

    @Test
    fun `feedback needs a 1-5 rating and at most 1000 characters`() {
        assertNull(FeedbackInput.validate(1, ""))
        assertNull(FeedbackInput.validate(5, "x".repeat(1000)))
        assertNull(FeedbackInput.validate(3, "  ${"x".repeat(1000)}  "))
        assertTrue(FeedbackInput.validate(0, "") != null)
        assertTrue(FeedbackInput.validate(6, "") != null)
        assertTrue(FeedbackInput.validate(4, "x".repeat(1001)) != null)
        // Characters, not UTF-16 units: 1000 emoji fit.
        assertNull(FeedbackInput.validate(4, "😀".repeat(1000)))
        assertTrue(FeedbackInput.validate(4, "😀".repeat(1001)) != null)
    }
}

package com.apptesting.app.core.model

import com.apptesting.app.core.data.firebase.firestore.parseAssignmentStatus
import com.apptesting.app.core.data.firebase.firestore.serialize
import com.apptesting.app.feature.home.assignmentStatusLabel
import com.apptesting.app.feature.home.assignmentStatusTone
import com.apptesting.app.core.designsystem.component.StatusTone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The `cancelled` status, and why it had to exist before cancellation did.
 *
 * `"cancelled"` has been in the server's `TERMINAL_ASSIGNMENT_STATUSES` since
 * the commitment model landed, but nothing on the client listed it, so it fell
 * through the mapper's `else` to [AssignmentStatus.Ready] — the identical
 * mapping gap that once affected `"failed"`.
 *
 * It was harmless only because nothing could produce the status. Adding
 * `cancelTestingAssignment` makes it a normal end state, which is what turns
 * the latent gap into a bug every cancelling tester would see: an assignment
 * whose 50 coins had just been returned, still shown as ready to start, with a
 * working check-in button the server would then refuse.
 */
class AssignmentCancelledTest {

    // -----------------------------------------------------------------
    // The mapping
    // -----------------------------------------------------------------

    @Test
    fun theServersCancelledStatusMapsToCancelled() {
        assertEquals(AssignmentStatus.Cancelled, parseAssignmentStatus("cancelled"))
    }

    @Test
    fun cancelledNoLongerFallsThroughToReady() {
        // The regression this whole file guards.
        assertNotEquals(
            "a cancelled commitment must never display as ready to start",
            AssignmentStatus.Ready,
            parseAssignmentStatus("cancelled"),
        )
    }

    @Test
    fun cancelledSerializesToTheStringTheServerWrites() {
        // `runCancelCommitment` writes exactly this. If the two ever drift,
        // the round-trip test still passes while real documents break.
        assertEquals("cancelled", AssignmentStatus.Cancelled.serialize())
    }

    // -----------------------------------------------------------------
    // Terminality — no check-in, not an active commitment
    // -----------------------------------------------------------------

    @Test
    fun cancelledIsTerminal() {
        assertTrue(AssignmentStatus.Cancelled.isTerminal)
    }

    @Test
    fun aCancelledAssignmentIsNotActive() {
        // What the Home list filters on. A cancelled commitment must leave
        // Active Assignments the moment it settles — the coins are already
        // back, so presenting it as live invites testing that counts for
        // nothing.
        assertTrue(AssignmentStatus.Cancelled.isTerminal)
        assertFalse(cancelledAssignment().status == AssignmentStatus.InProgress)
    }

    @Test
    fun aCancelledAssignmentIsSettled() {
        val a = cancelledAssignment()
        assertTrue("the stake has been returned", a.isSettled)
        assertEquals("cancel_app1__u_me__c1", a.settlementTxId)
    }

    // -----------------------------------------------------------------
    // Presentation — returned, not lost
    // -----------------------------------------------------------------

    @Test
    fun cancelledReadsAsCancelledNotAsForfeited() {
        assertEquals("Cancelled", assignmentStatusLabel(AssignmentStatus.Cancelled))
        assertNotEquals(
            "cancelling returns the stake — it must not read as a forfeiture",
            assignmentStatusLabel(AssignmentStatus.Failed),
            assignmentStatusLabel(AssignmentStatus.Cancelled),
        )
    }

    @Test
    fun cancelledIsNotTonedAsADanger() {
        // Nothing went wrong and nothing was lost. Colouring it like the
        // forfeited case would tell the tester they had been penalised.
        assertEquals(StatusTone.Neutral, assignmentStatusTone(AssignmentStatus.Cancelled))
        assertNotEquals(
            StatusTone.Danger,
            assignmentStatusTone(AssignmentStatus.Cancelled),
        )
    }

    @Test
    fun theLabelUsesNoRewardLanguage() {
        val label = assignmentStatusLabel(AssignmentStatus.Cancelled).lowercase()
        for (banned in listOf("earn", "reward", "bonus", "payout", "won")) {
            assertFalse("label must not imply a reward: $label", label.contains(banned))
        }
    }

    // -----------------------------------------------------------------
    // The stake it still carries
    // -----------------------------------------------------------------

    @Test
    fun aCancelledAssignmentStillReportsWhatWasStaked() {
        // The tester is entitled to see the amount that came back, so the
        // commitment fields must survive settlement rather than being cleared.
        val a = cancelledAssignment()
        assertEquals(50, a.commitmentAmount)
        assertTrue(a.hasCommitment)
    }

    private fun cancelledAssignment() = TestAssignment(
        id = "app1__u_me__c1",
        appId = "app1",
        testerUserId = "u_me",
        daysRequired = 14,
        daysCompleted = 4,
        status = AssignmentStatus.Cancelled,
        commitmentAmount = 50,
        cycle = 1,
        windowDays = 18,
        lockTxId = "lock_app1__u_me__c1",
        settlementTxId = "cancel_app1__u_me__c1",
    )
}

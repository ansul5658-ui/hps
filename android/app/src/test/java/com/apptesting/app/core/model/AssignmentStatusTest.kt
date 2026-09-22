package com.apptesting.app.core.model

import com.apptesting.app.core.data.firebase.firestore.parseAssignmentStatus
import com.apptesting.app.core.data.firebase.firestore.serialize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The `failed` status, and why it had to exist before automatic forfeiture did.
 *
 * The server has written `"failed"` on a forfeited commitment since the wallet
 * landed, but nothing on the client listed it, so it fell through the mapper's
 * `else` to [AssignmentStatus.Ready]. A tester who had just lost 50 coins was
 * shown an assignment described as ready to start, still sitting in Active
 * Assignments, with a working check-in button.
 *
 * That was survivable only while forfeiture required an admin to act on each
 * case. The scheduled evaluator makes it the normal end state for an abandoned
 * commitment, which is what turns a latent mapping gap into a bug every
 * affected tester would see.
 */
class AssignmentStatusTest {

    // -----------------------------------------------------------------
    // The mapping
    // -----------------------------------------------------------------

    @Test
    fun theServersFailedStatusMapsToFailed() {
        assertEquals(AssignmentStatus.Failed, parseAssignmentStatus("failed"))
    }

    @Test
    fun failedNoLongerFallsThroughToReady() {
        // The regression this whole file guards.
        assertFalse(
            "a forfeited commitment must never display as ready to start",
            parseAssignmentStatus("failed") == AssignmentStatus.Ready,
        )
    }

    @Test
    fun everyServerStatusStringRoundTrips() {
        for (status in AssignmentStatus.values()) {
            assertEquals(
                "$status must survive serialize -> parse",
                status,
                parseAssignmentStatus(status.serialize()),
            )
        }
    }

    @Test
    fun failedSerializesToTheStringTheServerWrites() {
        // `runForfeitCommitment` writes exactly this. If the two ever drift,
        // the round-trip test above still passes while real documents break.
        assertEquals("failed", AssignmentStatus.Failed.serialize())
    }

    @Test
    fun anUnknownStatusStillReadsAsReady() {
        // Deliberate: a status this client has never heard of should read as
        // "nothing to report", not as a failure. Which is precisely why a real
        // status has to be listed explicitly rather than left to this.
        for (unknown in listOf(null, "", "cancelled", "onHold", "somethingNew")) {
            assertEquals(AssignmentStatus.Ready, parseAssignmentStatus(unknown))
        }
    }

    // -----------------------------------------------------------------
    // Terminality
    // -----------------------------------------------------------------

    @Test
    fun failedIsTerminal() {
        assertTrue(AssignmentStatus.Failed.isTerminal)
    }

    @Test
    fun terminalMatchesTheServersTerminalSet() {
        // Mirrors TERMINAL_ASSIGNMENT_STATUSES in functions/lib/constants.js.
        // `cancelled` has no client enum value and maps to Ready, so it is not
        // represented here — the three the client can actually hold are.
        assertTrue(AssignmentStatus.Completed.isTerminal)
        assertTrue(AssignmentStatus.Failed.isTerminal)
        assertTrue(AssignmentStatus.Missed.isTerminal)

        assertFalse(AssignmentStatus.Ready.isTerminal)
        assertFalse(AssignmentStatus.InProgress.isTerminal)
        assertFalse(AssignmentStatus.WaitingForVerification.isTerminal)
    }

    @Test
    fun aForfeitedAssignmentIsNotActive() {
        // What HomeViewModel filters on. A forfeited commitment must leave the
        // Active Assignments list the moment the evaluator settles it —
        // listing one there invites a tester to keep testing an assignment
        // whose coins are already gone.
        val forfeited = AssignmentStatus.Failed
        assertFalse("a forfeited commitment is not active", !forfeited.isTerminal)
    }

    // -----------------------------------------------------------------
    // What a forfeited assignment still carries
    // -----------------------------------------------------------------

    private fun forfeitedAssignment() = TestAssignment(
        id = "app1__u_me__c1",
        appId = "app1",
        testerUserId = "u_me",
        daysRequired = 14,
        daysCompleted = 4,
        status = AssignmentStatus.Failed,
        commitmentAmount = 50,
        cycle = 1,
        windowDays = 18,
        lockTxId = "lock_app1__u_me__c1",
        settlementTxId = "forfeit_app1__u_me__c1",
        timeZone = "Asia/Kolkata",
        firstEligibleDayKey = "2026-03-02",
        lastEligibleDayKey = "2026-03-19",
    )

    @Test
    fun aForfeitedAssignmentStillReportsWhatWasStaked() {
        // The tester is entitled to see exactly what it cost. The stake is a
        // record of what happened, so settlement does not erase it.
        val a = forfeitedAssignment()
        assertTrue(a.hasCommitment)
        assertTrue(a.isSettled)
        assertEquals(50, a.displayedCommitmentAmount)
    }

    @Test
    fun aForfeitedRewardEraAssignmentStillShowsNothingCommitted() {
        // No lock ledger entry means nothing was ever staked, so nothing was
        // forfeited — even though the status says failed.
        val legacy = forfeitedAssignment().copy(lockTxId = null, settlementTxId = null)
        assertFalse(legacy.hasCommitment)
        assertEquals(0, legacy.displayedCommitmentAmount)
    }

    @Test
    fun aForfeitedAssignmentDoesNotClaimTodayWasLogged() {
        // It carries no check-in boundary, so the button state is driven by
        // the terminal status rather than by a stale instant.
        val a = forfeitedAssignment()
        assertFalse(a.hasLoggedTodayAt(System.currentTimeMillis()))
    }
}

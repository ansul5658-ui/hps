package com.apptesting.app.core.data

import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.util.AppConfig
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Client-side commitment behaviour.
 *
 * The authoritative rules live on the server and are proven in
 * functions/test/commitments.test.js and against a real Firestore in
 * test-emulator/commitments.concurrency.test.js. What is worth testing here is
 * narrower:
 *
 *   1. The read model can tell a real commitment from a reward-era assignment,
 *      so the UI never claims coins are at stake when none are.
 *   2. The mock repository refuses the same things the server refuses, so a
 *      screen developed in dev mode does not meet those states for the first
 *      time in production.
 *   3. Claiming never mutates the wallet optimistically beyond what the mock
 *      server-equivalent does — and the mock's own arithmetic keeps the
 *      invariant intact.
 */
class CommitmentClaimTest {

    private fun storeWithWallet(available: Int): MockStore {
        val store = MockStore()
        store.wallet.value = store.wallet.value.copy(
            available = available,
            locked = 0,
            forfeitedTotal = 0,
            purchasedTotal = 0,
            adjustmentNet = available,
        )
        // Start from a clean slate so seeded fixtures do not mask the result.
        store.assignments.value = emptyList()
        return store
    }

    /** An app owned by someone else, approved and therefore claimable. */
    private fun claimableAppId(store: MockStore): String =
        store.apps.value.first {
            it.ownerUserId != "u_me" && it.approvalStatus == com.apptesting.app.core.model.AppApprovalStatus.Approved
        }.id

    // -----------------------------------------------------------------------
    // The read model
    // -----------------------------------------------------------------------

    @Test
    fun `an assignment with a lock transaction has a real commitment`() {
        val committed = TestAssignment(
            id = "app1__t1__c1",
            commitmentAmount = 50,
            cycle = 1,
            lockTxId = "lock_app1__t1__c1",
        )
        assertTrue(committed.hasCommitment)
        assertFalse(committed.isSettled)
    }

    @Test
    fun `a reward-era assignment carries no commitment even with an amount`() {
        // These documents have a coinReward that the mapper surfaces as
        // commitmentAmount. Nothing was ever staked, so the UI must not imply
        // the tester has coins at risk.
        val legacy = TestAssignment(id = "app1__t1", commitmentAmount = 50, cycle = 0)
        assertFalse(legacy.hasCommitment)
        assertFalse(legacy.isSettled)
    }

    @Test
    fun `a settled assignment reports its settlement`() {
        val settled = TestAssignment(
            id = "app1__t1__c1",
            commitmentAmount = 50,
            lockTxId = "lock_app1__t1__c1",
            settlementTxId = "unlock_app1__t1__c1",
            status = AssignmentStatus.Completed,
        )
        assertTrue(settled.hasCommitment)
        assertTrue(settled.isSettled)
    }

    @Test
    fun `blank transaction ids do not count as a commitment`() {
        val blank = TestAssignment(id = "x", commitmentAmount = 50, lockTxId = "", settlementTxId = "")
        assertFalse(blank.hasCommitment)
        assertFalse(blank.isSettled)
    }

    // -----------------------------------------------------------------------
    // Claiming
    // -----------------------------------------------------------------------

    @Test
    fun `a claim with exactly the stake succeeds and moves available into locked`() = runBlocking {
        val store = storeWithWallet(AppConfig.DEFAULT_COMMITMENT_AMOUNT)
        val repo = MockAssignmentRepository(store)
        val appId = claimableAppId(store)

        val result = repo.claimAssignment(appId)
        assertTrue("expected Claimed, got $result", result is ClaimAssignmentResult.Claimed)
        result as ClaimAssignmentResult.Claimed
        assertEquals(AppConfig.DEFAULT_COMMITMENT_AMOUNT, result.committedAmount)
        assertEquals(1, result.cycle)
        assertEquals("${appId}__u_me__c1", result.assignmentId)

        val wallet = store.wallet.value
        assertEquals(0, wallet.available)
        assertEquals(AppConfig.DEFAULT_COMMITMENT_AMOUNT, wallet.locked)
        assertEquals(0, wallet.forfeitedTotal)
        assertTrue("the mock must not break the invariant", wallet.isConsistent)
    }

    @Test
    fun `the claimed assignment carries the stake and a lock transaction`() = runBlocking {
        val store = storeWithWallet(50)
        val repo = MockAssignmentRepository(store)
        val appId = claimableAppId(store)

        repo.claimAssignment(appId)
        val a = store.assignments.value.single()
        assertEquals(50, a.commitmentAmount)
        assertEquals(1, a.cycle)
        assertEquals(18, a.windowDays)
        assertTrue(a.hasCommitment)
        assertFalse(a.isSettled)
        assertEquals(AssignmentStatus.Ready, a.status)
    }

    @Test
    fun `a claim one coin short is refused and nothing moves`() = runBlocking {
        val store = storeWithWallet(AppConfig.DEFAULT_COMMITMENT_AMOUNT - 1)
        val repo = MockAssignmentRepository(store)
        val before = store.wallet.value

        val result = repo.claimAssignment(claimableAppId(store))
        assertTrue(result is ClaimAssignmentResult.InsufficientCoins)

        assertEquals(before, store.wallet.value)
        assertTrue("no assignment may be created", store.assignments.value.isEmpty())
        assertEquals(0, store.wallet.value.locked)
    }

    @Test
    fun `a second claim on the same app is refused while one is live`() = runBlocking {
        val store = storeWithWallet(200)
        val repo = MockAssignmentRepository(store)
        val appId = claimableAppId(store)

        repo.claimAssignment(appId)
        val after = store.wallet.value

        val second = repo.claimAssignment(appId)
        assertTrue(second is ClaimAssignmentResult.AlreadyCommitted)
        assertEquals("the second claim must not lock more", after, store.wallet.value)
        assertEquals(1, store.assignments.value.size)
    }

    @Test
    fun `a completed cycle frees the app and the next claim gets a new id`() = runBlocking {
        val store = storeWithWallet(100)
        val repo = MockAssignmentRepository(store)
        val appId = claimableAppId(store)

        val first = repo.claimAssignment(appId) as ClaimAssignmentResult.Claimed
        store.assignments.value = store.assignments.value.map {
            if (it.id == first.assignmentId) it.copy(status = AssignmentStatus.Completed) else it
        }

        val second = repo.claimAssignment(appId)
        assertTrue(second is ClaimAssignmentResult.Claimed)
        second as ClaimAssignmentResult.Claimed
        assertEquals(2, second.cycle)
        assertEquals("${appId}__u_me__c2", second.assignmentId)
        // The finished cycle is preserved as history, not overwritten.
        assertEquals(2, store.assignments.value.size)
    }

    @Test
    fun `a developer cannot claim their own app`() = runBlocking {
        val store = storeWithWallet(200)
        val repo = MockAssignmentRepository(store)
        val ownApp = store.apps.value.first { it.ownerUserId == "u_me" }

        val result = repo.claimAssignment(ownApp.id)
        assertTrue(result is ClaimAssignmentResult.Error)
        assertTrue(store.assignments.value.isEmpty())
        assertEquals(200, store.wallet.value.available)
    }

    @Test
    fun `an unapproved app cannot be claimed`() = runBlocking {
        val store = storeWithWallet(200)
        val repo = MockAssignmentRepository(store)
        val pending = store.apps.value.first {
            it.approvalStatus != com.apptesting.app.core.model.AppApprovalStatus.Approved
        }

        val result = repo.claimAssignment(pending.id)
        assertTrue(result is ClaimAssignmentResult.Error)
        assertTrue(store.assignments.value.isEmpty())
    }

    @Test
    fun `a claim records a lock ledger entry with server-shaped deltas`() = runBlocking {
        val store = storeWithWallet(50)
        val repo = MockAssignmentRepository(store)
        val before = store.transactions.value.size

        repo.claimAssignment(claimableAppId(store))

        val entry = store.transactions.value.last()
        assertEquals(before + 1, store.transactions.value.size)
        assertEquals(com.apptesting.app.core.model.CoinTransactionKind.Lock, entry.kind)
        assertEquals(
            com.apptesting.app.core.model.CoinTransactionSource.Commitment,
            entry.source,
        )
        assertEquals(-50, entry.deltaAvailable)
        assertEquals(50, entry.deltaLocked)
        assertEquals(0, entry.deltaForfeited)
        assertEquals(2, entry.schemaVersion)
        assertFalse(entry.isLegacyRewardEntry)
    }

    @Test
    fun `the claim path never invents coins`() = runBlocking {
        val store = storeWithWallet(100)
        val repo = MockAssignmentRepository(store)
        val totalBefore = store.wallet.value.let { it.available + it.locked + it.forfeitedTotal }

        repo.claimAssignment(claimableAppId(store))

        val w = store.wallet.value
        assertEquals(
            "committing must move coins, never create them",
            totalBefore,
            w.available + w.locked + w.forfeitedTotal,
        )
        assertTrue(w.isConsistent)
    }
}

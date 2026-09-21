package com.apptesting.app.core.data

import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransactionKind
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.util.AppConfig
import com.apptesting.app.core.util.TimeProvider
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Client behaviour around recording a testing day.
 *
 * The authoritative engine is server-side and proven in
 * functions/test/testingDays.test.js and its emulator counterpart. What is
 * worth testing here is narrower, and it is mostly about what the client does
 * NOT do:
 *
 *   1. Progress is read off the assignment, never counted or incremented
 *      locally.
 *   2. The pinned window is carried for display and nothing else.
 *   3. The states a screen has to render — idempotent repeat, the fourteenth
 *      day completing and returning the stake — behave the same in dev mode as
 *      they will against Firebase.
 */
class TestingDayCheckInTest {

    private fun storeWithCommitment(
        done: Int = 0,
        available: Int = 0,
        locked: Int = 50,
    ): Pair<MockStore, String> {
        val store = MockStore()
        val appId = store.apps.value.first {
            it.ownerUserId != "u_me" &&
                it.approvalStatus == com.apptesting.app.core.model.AppApprovalStatus.Approved
        }.id
        val assignmentId = "${appId}__u_me__c1"
        store.assignments.value = listOf(
            TestAssignment(
                id = assignmentId,
                appId = appId,
                testerUserId = "u_me",
                daysRequired = 14,
                daysCompleted = done,
                status = if (done > 0) AssignmentStatus.InProgress else AssignmentStatus.Ready,
                commitmentAmount = 50,
                cycle = 1,
                windowDays = 18,
                lockTxId = "lock_$assignmentId",
                timeZone = "Asia/Kolkata",
                firstEligibleDayKey = "2026-03-02",
                lastEligibleDayKey = "2026-03-19",
            ),
        )
        store.wallet.value = store.wallet.value.copy(
            available = available,
            locked = locked,
            forfeitedTotal = 0,
            purchasedTotal = 0,
            adjustmentNet = available + locked,
        )
        return store to assignmentId
    }

    // -----------------------------------------------------------------------
    // The read model carries the server's clock, and only for display
    // -----------------------------------------------------------------------

    @Test
    fun `the pinned window is carried on the assignment for display`() {
        val (store, id) = storeWithCommitment()
        val a = store.assignments.value.single { it.id == id }
        assertEquals("Asia/Kolkata", a.timeZone)
        assertEquals("2026-03-02", a.firstEligibleDayKey)
        assertEquals("2026-03-19", a.lastEligibleDayKey)
        assertEquals(18, a.windowDays)
        assertTrue(a.hasCommitment)
    }

    @Test
    fun `an assignment with no pinned window reads as absent, not as a default`() {
        // A reward-era document. The client must not invent a window for it —
        // showing a made-up deadline would be worse than showing none.
        val legacy = TestAssignment(id = "app1__u_me", commitmentAmount = 50)
        assertEquals(null, legacy.timeZone)
        assertEquals(null, legacy.firstEligibleDayKey)
        assertEquals(null, legacy.lastEligibleDayKey)
        assertFalse(legacy.hasCommitment)
    }

    // -----------------------------------------------------------------------
    // Recording a day
    // -----------------------------------------------------------------------

    @Test
    fun `a first check-in reports the server's count, not a local increment`() = runBlocking {
        val (store, id) = storeWithCommitment(done = 0)
        val repo = MockAssignmentRepository(store)

        val result = repo.recordDayOfTesting(id)
        assertTrue("expected Logged, got $result", result is LogDayResult.Logged)
        result as LogDayResult.Logged
        assertEquals(1, result.daysCompleted)
        assertEquals(14, result.daysRequired)
        assertFalse(result.completed)

        assertEquals(1, store.assignments.value.single { it.id == id }.daysCompleted)
    }

    @Test
    fun `a duplicate same-day check-in is idempotent`() = runBlocking {
        val (store, id) = storeWithCommitment(done = 0)
        val repo = MockAssignmentRepository(store)

        repo.recordDayOfTesting(id)
        val walletAfterFirst = store.wallet.value
        val second = repo.recordDayOfTesting(id)

        assertTrue(second is LogDayResult.AlreadyLoggedToday)
        assertEquals(1, store.assignments.value.single { it.id == id }.daysCompleted)
        assertEquals("a repeat must move nothing", walletAfterFirst, store.wallet.value)
    }

    @Test
    fun `the 13th day does not complete and leaves the stake committed`() = runBlocking {
        val (store, id) = storeWithCommitment(done = 12)
        val repo = MockAssignmentRepository(store)

        val result = repo.recordDayOfTesting(id) as LogDayResult.Logged
        assertEquals(13, result.daysCompleted)
        assertFalse(result.completed)

        assertEquals(50, store.wallet.value.locked)
        assertEquals(0, store.wallet.value.available)
        assertEquals(
            AssignmentStatus.InProgress,
            store.assignments.value.single { it.id == id }.status,
        )
    }

    @Test
    fun `the 14th day completes and returns the SAME 50 coins`() = runBlocking {
        val (store, id) = storeWithCommitment(done = 13, available = 0, locked = 50)
        val repo = MockAssignmentRepository(store)

        val result = repo.recordDayOfTesting(id) as LogDayResult.Logged
        assertEquals(14, result.daysCompleted)
        assertTrue(result.completed)

        val wallet = store.wallet.value
        assertEquals("the stake comes back", 50, wallet.available)
        assertEquals(0, wallet.locked)
        assertEquals(0, wallet.forfeitedTotal)
        assertEquals("no coins were created", 50, wallet.adjustmentNet)
        assertTrue(wallet.isConsistent)

        val a = store.assignments.value.single { it.id == id }
        assertEquals(AssignmentStatus.Completed, a.status)
        assertNotNull(a.settlementTxId)
        assertTrue(a.isSettled)
    }

    @Test
    fun `completion records an unlock entry and no reward entry`() = runBlocking {
        val (store, id) = storeWithCommitment(done = 13)
        val repo = MockAssignmentRepository(store)
        val before = store.transactions.value.size

        repo.recordDayOfTesting(id)

        val entry = store.transactions.value.last()
        assertEquals(before + 1, store.transactions.value.size)
        assertEquals(CoinTransactionKind.Unlock, entry.kind)
        assertEquals(50, entry.deltaAvailable)
        assertEquals(-50, entry.deltaLocked)
        assertEquals(0, entry.deltaForfeited)
        // The decisive one: nothing was earned.
        assertFalse(
            store.transactions.value.any { it.kind.name == "Earn" || it.kind.name == "Bonus" },
        )
    }

    @Test
    fun `a completed commitment cannot be checked into again`() = runBlocking {
        val (store, id) = storeWithCommitment(done = 13)
        val repo = MockAssignmentRepository(store)

        repo.recordDayOfTesting(id)
        val after = store.wallet.value

        val again = repo.recordDayOfTesting(id)
        assertTrue(again is LogDayResult.Error)
        assertEquals("no second unlock", after, store.wallet.value)
        assertEquals(50, store.wallet.value.available)
    }

    @Test
    fun `check-in never creates coins`() = runBlocking {
        val (store, id) = storeWithCommitment(done = 13)
        val repo = MockAssignmentRepository(store)
        val totalBefore = store.wallet.value.let {
            it.available + it.locked + it.forfeitedTotal
        }

        repo.recordDayOfTesting(id)

        val w = store.wallet.value
        assertEquals(
            "completing must move coins, never create them",
            totalBefore,
            w.available + w.locked + w.forfeitedTotal,
        )
        assertTrue(w.isConsistent)
    }

    @Test
    fun `a missing assignment is an error, not a silent success`() = runBlocking {
        val (store, _) = storeWithCommitment()
        val repo = MockAssignmentRepository(store)
        val result = repo.recordDayOfTesting("does__not__exist__c1")
        assertTrue(result is LogDayResult.Error)
    }

    // -----------------------------------------------------------------------
    // What the client deliberately does not do
    // -----------------------------------------------------------------------

    @Test
    fun `the client day key is UTC and is NOT the commitment boundary`() {
        // TimeProvider still produces a UTC key, used for Quick Test cooldowns
        // and local display. The commitment boundary is local midnight in the
        // assignment's pinned zone, computed on the server — these are
        // different things and the difference is the point of the batch.
        val key = TimeProvider.todayKey()
        assertTrue("day key must be yyyy-MM-dd", Regex("""^\d{4}-\d{2}-\d{2}$""").matches(key))

        val (store, id) = storeWithCommitment()
        val a = store.assignments.value.single { it.id == id }
        assertEquals(
            "the authoritative zone lives on the assignment, not in TimeProvider",
            "Asia/Kolkata",
            a.timeZone,
        )
    }

    @Test
    fun `the commitment amount mirrors the server constant`() {
        assertEquals(50, AppConfig.DEFAULT_COMMITMENT_AMOUNT)
    }
}

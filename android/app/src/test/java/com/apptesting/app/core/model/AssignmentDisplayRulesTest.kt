package com.apptesting.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.TimeZone

/**
 * The two display rules a screen may not get wrong, and the bugs that made
 * them worth pinning down.
 *
 * Both were found on a physical device, and both had the same shape: the
 * client held an opinion the server never gave it. One decided what "today"
 * was; the other decided what counted as a stake. Neither belongs to the
 * client, so both are now single functions on the model, tested here rather
 * than re-derived per screen.
 */
class AssignmentDisplayRulesTest {

    private val ist: TimeZone = TimeZone.getTimeZone("Asia/Kolkata")
    private val utc: TimeZone = TimeZone.getTimeZone("UTC")

    /** Epoch millis for a wall-clock time in a given zone. */
    private fun at(
        zone: TimeZone,
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
    ): Long {
        val cal = java.util.Calendar.getInstance(zone)
        cal.clear()
        cal.set(year, month - 1, day, hour, minute, 0)
        return cal.timeInMillis
    }

    /**
     * An assignment whose tester logged a day on 2026-03-05 IST. The server
     * therefore stamped the boundary at IST midnight opening 2026-03-06,
     * which is 18:30 UTC on 2026-03-05.
     */
    private fun loggedOn5March() = TestAssignment(
        id = "app1__u_me__c1",
        appId = "app1",
        testerUserId = "u_me",
        daysRequired = 14,
        daysCompleted = 4,
        status = AssignmentStatus.InProgress,
        commitmentAmount = 50,
        cycle = 1,
        windowDays = 18,
        lockTxId = "lock_app1__u_me__c1",
        timeZone = "Asia/Kolkata",
        firstEligibleDayKey = "2026-03-02",
        lastEligibleDayKey = "2026-03-19",
        lastLoggedDayKey = "2026-03-05",
        nextCheckInAtMillis = at(TimeZone.getTimeZone("Asia/Kolkata"), 2026, 3, 6, 0, 0),
    )

    // -----------------------------------------------------------------
    // Part 1 - the loggedToday boundary
    // -----------------------------------------------------------------

    @Test
    fun boundaryIsIstMidnightWhichIs1830UtcTheDayBefore() {
        val a = loggedOn5March()
        assertEquals(
            "IST is UTC+5:30, so local midnight on the 6th is 18:30 UTC on the 5th",
            at(utc, 2026, 3, 5, 18, 30),
            a.nextCheckInAtMillis,
        )
    }

    /**
     * THE BUG. Between 00:00 and 05:30 IST the device's UTC day key reads one
     * day behind the server's IST day key, so a day the server had already
     * recorded looked unlogged and the button looked available.
     */
    @Test
    fun stillLoggedDuringTheMidnightToHalfPastFiveIstWindow() {
        val a = loggedOn5March()

        // 03:00 IST on 2026-03-05 is 21:30 UTC on 2026-03-04. UTC says the 4th,
        // IST says the 5th - the exact disagreement. Comparing instants, it is
        // still the logged day, so it correctly stays logged.
        assertTrue(
            "00:00-05:30 IST is the window where a UTC day key disagreed",
            a.hasLoggedTodayAt(at(ist, 2026, 3, 5, 3, 0)),
        )
        assertTrue(a.hasLoggedTodayAt(at(ist, 2026, 3, 5, 0, 1)))
        assertTrue(a.hasLoggedTodayAt(at(ist, 2026, 3, 5, 5, 29)))
        assertTrue("05:30 IST is exactly 00:00 UTC", a.hasLoggedTodayAt(at(ist, 2026, 3, 5, 5, 30)))
        assertTrue("and well past it", a.hasLoggedTodayAt(at(ist, 2026, 3, 5, 6, 0)))
    }

    @Test
    fun crossingUtcMidnightAloneDoesNotChangeTheAnswer() {
        val a = loggedOn5March()
        // Either side of UTC midnight, mid-way through the IST day.
        assertTrue(a.hasLoggedTodayAt(at(utc, 2026, 3, 4, 23, 59)))
        assertTrue(a.hasLoggedTodayAt(at(utc, 2026, 3, 5, 0, 0)))
        assertTrue(a.hasLoggedTodayAt(at(utc, 2026, 3, 5, 0, 1)))
    }

    @Test
    fun theRealIstLocalDayTransitionFlipsItToTheMinute() {
        val a = loggedOn5March()
        val boundary = a.nextCheckInAtMillis!!

        assertTrue("23:59 IST on the logged day", a.hasLoggedTodayAt(at(ist, 2026, 3, 5, 23, 59)))
        assertTrue("one millisecond before midnight IST", a.hasLoggedTodayAt(boundary - 1))
        assertFalse("00:00 IST is the boundary itself, and it is exclusive", a.hasLoggedTodayAt(boundary))
        assertFalse("one millisecond past midnight IST", a.hasLoggedTodayAt(boundary + 1))
        assertFalse("00:01 IST on the next day", a.hasLoggedTodayAt(at(ist, 2026, 3, 6, 0, 1)))
        assertFalse("and later that next day", a.hasLoggedTodayAt(at(ist, 2026, 3, 6, 9, 0)))
    }

    @Test
    fun anAssignmentWithNoCheckInYetIsNotLogged() {
        val fresh = loggedOn5March().copy(lastLoggedDayKey = null, nextCheckInAtMillis = null)
        assertFalse(fresh.hasLoggedTodayAt(at(ist, 2026, 3, 5, 3, 0)))
    }

    /**
     * A document last written before the field existed reads as "not logged".
     * That costs one round trip the server rejects idempotently; the opposite
     * default would lock a tester out of a day they are entitled to log.
     */
    @Test
    fun aLegacyDocumentWithNoBoundaryFieldFailsOpen() {
        val legacy = loggedOn5March().copy(nextCheckInAtMillis = null)
        assertFalse(legacy.hasLoggedTodayAt(at(ist, 2026, 3, 5, 12, 0)))
    }

    @Test
    fun theDeviceTimezoneIsNeverConsulted() {
        val a = loggedOn5March()
        val instant = at(ist, 2026, 3, 5, 3, 0)
        val original = TimeZone.getDefault()
        try {
            // Whatever the phone claims its zone is, the same instant gives the
            // same answer - there is no device-zone input to the rule at all.
            for (zone in listOf("UTC", "America/Los_Angeles", "Pacific/Kiritimati", "Asia/Kolkata")) {
                TimeZone.setDefault(TimeZone.getTimeZone(zone))
                assertTrue("device zone $zone must not change the answer", a.hasLoggedTodayAt(instant))
            }
        } finally {
            TimeZone.setDefault(original)
        }
    }

    @Test
    fun theClientDoesNotComputeTheAssignmentsTestingDay() {
        // The only inputs to the rule are a server-supplied instant and the
        // current instant. No day key is parsed, and the pinned zone is not
        // read - so there is no arithmetic here that could drift.
        val a = loggedOn5March().copy(
            timeZone = null,
            firstEligibleDayKey = null,
            lastEligibleDayKey = null,
            lastLoggedDayKey = null,
        )
        assertTrue(a.hasLoggedTodayAt(at(ist, 2026, 3, 5, 3, 0)))
        assertFalse(a.hasLoggedTodayAt(at(ist, 2026, 3, 6, 0, 1)))
    }

    // -----------------------------------------------------------------
    // Part 2 - the committed-coin display
    // -----------------------------------------------------------------

    @Test
    fun aGenuineActiveCommitmentShowsItsCommittedCoins() {
        val a = loggedOn5March()
        assertTrue(a.hasCommitment)
        assertEquals(50, a.displayedCommitmentAmount)
    }

    /**
     * THE BUG. Exactly what push-matching used to write, as FirestoreMappers
     * maps it: no lockTxId, and `commitmentAmount` populated from the
     * reward-era `coinReward` field. It looks like 50 coins; none were staked.
     */
    @Test
    fun aRewardEraAssignmentShowsNothingCommitted() {
        val legacy = TestAssignment(
            id = "app1__u_me",
            appId = "app1",
            testerUserId = "u_me",
            daysRequired = 14,
            daysCompleted = 9,
            status = AssignmentStatus.InProgress,
            commitmentAmount = 50,
            cycle = 0,
            lockTxId = null,
        )
        assertFalse("no lock ledger entry means no stake", legacy.hasCommitment)
        assertEquals(
            "a reward-era assignment must never read as 50 committed",
            0,
            legacy.displayedCommitmentAmount,
        )
    }

    @Test
    fun aBlankLockTxIdIsNotACommitmentEither() {
        val blank = loggedOn5March().copy(lockTxId = "")
        assertFalse(blank.hasCommitment)
        assertEquals(0, blank.displayedCommitmentAmount)
    }

    @Test
    fun aSettledCommitmentStillReportsWhatWasStaked() {
        // Completed, coins already returned - the card still says what the
        // stake was. The lock entry is a record of what happened; the display
        // rule reads it, it does not invent or erase it.
        val settled = loggedOn5March().copy(
            status = AssignmentStatus.Completed,
            daysCompleted = 14,
            settlementTxId = "unlock_app1__u_me__c1",
        )
        assertTrue(settled.isSettled)
        assertEquals(50, settled.displayedCommitmentAmount)
    }

    @Test
    fun theDisplayRuleNeverInventsAnAmount() {
        val noStake = loggedOn5March().copy(lockTxId = null, commitmentAmount = 0)
        assertEquals(0, noStake.displayedCommitmentAmount)
        // and it never reports more than the server recorded
        val small = loggedOn5March().copy(commitmentAmount = 20)
        assertEquals(20, small.displayedCommitmentAmount)
    }

    @Test
    fun theRuleIsTheSameOneBothScreensUse() {
        // Home and Test Apps both read `displayedCommitmentAmount`. This is
        // the guard that used to exist only in TestAppsViewModel, which is why
        // Home showed "50 committed" for a reward-era assignment.
        val rewardEra = loggedOn5March().copy(lockTxId = null)
        val committed = loggedOn5March()
        assertEquals(0, rewardEra.displayedCommitmentAmount)
        assertEquals(50, committed.displayedCommitmentAmount)
    }
}

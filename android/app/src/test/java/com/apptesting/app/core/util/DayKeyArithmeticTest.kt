package com.apptesting.app.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Day-key arithmetic, used by the Quick Test cooldown.
 *
 * Mirrors `daysBetweenDayKeys` in functions/lib/quickTests.js. The client uses
 * it to grey out a card early; the server uses its own copy to actually
 * decide. They must agree, or a card will offer an action the server refuses.
 */
class DayKeyArithmeticTest {

    @Test
    fun `a seven day gap measures seven`() {
        assertEquals(7, daysBetweenDayKeys("2026-09-13", "2026-09-20"))
    }

    @Test
    fun `the same day measures zero`() {
        assertEquals(0, daysBetweenDayKeys("2026-09-20", "2026-09-20"))
    }

    @Test
    fun `gaps span month and year boundaries`() {
        assertEquals(7, daysBetweenDayKeys("2026-01-28", "2026-02-04"))
        assertEquals(7, daysBetweenDayKeys("2025-12-28", "2026-01-04"))
        assertEquals(366, daysBetweenDayKeys("2023-01-01", "2024-01-02"))
    }

    @Test
    fun `a leap day is counted`() {
        // 2028 is a leap year; Feb 28 to Mar 1 is two days, not one.
        assertEquals(2, daysBetweenDayKeys("2028-02-28", "2028-03-01"))
    }

    @Test
    fun `an unparseable key returns null rather than a misleading number`() {
        // A corrupt stored marker must fail a cooldown check CLOSED. Returning
        // a large number here would silently clear the cooldown instead.
        assertNull(daysBetweenDayKeys("garbage", "2026-09-20"))
        assertNull(daysBetweenDayKeys("2026-09-20", "garbage"))
        assertNull(daysBetweenDayKeys(null, "2026-09-20"))
        assertNull(daysBetweenDayKeys("2026-09-20", null))
        assertNull(daysBetweenDayKeys("", "2026-09-20"))
        assertNull(daysBetweenDayKeys("   ", "2026-09-20"))
    }

    @Test
    fun `an out-of-range date is rejected rather than rolled over`() {
        // Without strict parsing, SimpleDateFormat reads "2026-99-99" as a
        // date years in the future — which would clear any cooldown.
        assertNull(daysBetweenDayKeys("2026-99-99", "2026-09-20"))
        assertNull(daysBetweenDayKeys("2026-13-01", "2026-09-20"))
        assertNull(daysBetweenDayKeys("2026-02-30", "2026-09-20"))
    }

    @Test
    fun `a backwards gap is negative, not silently zero`() {
        assertEquals(-7, daysBetweenDayKeys("2026-09-20", "2026-09-13"))
    }

    @Test
    fun `it agrees with the day keys TimeProvider produces`() {
        val day1 = formatDayKey(1_772_712_000_000L, UTC) // 2026-03-05
        val day2 = formatDayKey(1_772_712_000_000L + 7 * 86_400_000L, UTC)
        assertEquals(7, daysBetweenDayKeys(day1, day2))
    }
}

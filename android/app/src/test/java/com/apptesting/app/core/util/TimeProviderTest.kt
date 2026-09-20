package com.apptesting.app.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test
import java.util.TimeZone

/**
 * The day key is the unit of idempotency for daily testing logs, and Firestore
 * rules re-derive the same string from the server clock. These tests pin the
 * format and the UTC basis, because a mismatch between the two sides would
 * reject every legitimate check-in.
 */
class TimeProviderTest {

    @Test
    fun `day key is formatted as yyyy-MM-dd`() {
        // 2026-03-05T12:00:00Z
        val key = formatDayKey(1_772_712_000_000L, UTC)
        assertEquals("2026-03-05", key)
    }

    @Test
    fun `single digit months and days are zero padded to match the rules helper`() {
        // 2026-01-02T00:00:00Z
        assertEquals("2026-01-02", formatDayKey(1_767_312_000_000L, UTC))
    }

    @Test
    fun `the key rolls over at UTC midnight`() {
        val lastMomentOfDay = 1_772_755_199_000L // 2026-03-05T23:59:59Z
        val firstMomentOfNextDay = 1_772_755_200_000L // 2026-03-06T00:00:00Z

        assertEquals("2026-03-05", formatDayKey(lastMomentOfDay, UTC))
        assertEquals("2026-03-06", formatDayKey(firstMomentOfNextDay, UTC))
    }

    @Test
    fun `the default provider ignores the device timezone`() {
        // A device in Kiritimati (UTC+14) is on "tomorrow" for most of the UTC
        // day. The key must not follow it, or the server-side rule comparison
        // against request.time would fail.
        val instant = 1_772_754_600_000L // 2026-03-05T23:50:00Z
        val deviceLocal = formatDayKey(instant, TimeZone.getTimeZone("Pacific/Kiritimati"))
        val serverAgreed = formatDayKey(instant, UTC)

        assertEquals("2026-03-05", serverAgreed)
        assertNotEquals(serverAgreed, deviceLocal)
    }

    @Test
    fun `default provider produces a key for the current instant in UTC`() {
        val now = TimeProvider.Default.nowMillis()
        assertEquals(formatDayKey(now, UTC), TimeProvider.Default.todayKey())
    }
}

package com.apptesting.app.core.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Testable clock plus the app's canonical "day key" format.
 *
 * The day key is `yyyy-MM-dd` in **UTC**.
 *
 * WHAT THIS IS *NOT* USED FOR ANY MORE
 * It is no longer the testing-day boundary. A qualifying testing day is a
 * LOCAL calendar day in the IANA timezone pinned to the assignment, and it is
 * derived entirely on the server by the `recordTestingDay` callable — the
 * client neither computes nor sends a day key for a check-in. The known
 * trade-off this header used to describe (the day flipping at 05:30 IST) is
 * gone with it.
 *
 * What remains is the per-viewer, non-authoritative uses: Quick Test cooldown
 * display and anything else that just needs a stable "today" string for the
 * UI. A tampered device clock changes what those render and nothing else,
 * because the server re-derives every rule it actually enforces.
 */
interface TimeProvider {
    fun nowMillis(): Long
    /** Calendar day in UTC, formatted as `yyyy-MM-dd`. */
    fun todayKey(): String

    companion object Default : TimeProvider {
        override fun nowMillis(): Long = System.currentTimeMillis()
        override fun todayKey(): String = formatDayKey(nowMillis(), UTC)
    }
}

/** The single timezone client and server agree on for day keys. */
val UTC: TimeZone = TimeZone.getTimeZone("UTC")

/** Extracted for testing — pass a fixed epoch + zone to get a deterministic key. */
fun formatDayKey(epochMillis: Long, tz: TimeZone): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = tz }
    return fmt.format(Date(epochMillis))
}

/**
 * Whole days from [fromKey] to [toKey], both `yyyy-MM-dd`.
 *
 * Returns `null` when either key is unparseable, so a corrupt stored value
 * fails a cooldown check *closed* rather than silently reading as "expired".
 * Mirrors `daysBetweenDayKeys` in functions/lib/quickTests.js — the client
 * uses it to grey out a card early, the server uses it to actually decide.
 */
fun daysBetweenDayKeys(fromKey: String?, toKey: String?): Int? {
    if (fromKey.isNullOrBlank() || toKey.isNullOrBlank()) return null
    val from = parseDayKeyMillis(fromKey) ?: return null
    val to = parseDayKeyMillis(toKey) ?: return null
    return ((to - from) / 86_400_000L).toInt()
}

private fun parseDayKeyMillis(key: String): Long? = try {
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
        timeZone = UTC
        // Without this, SimpleDateFormat happily reads "2026-99-99" as a date
        // far in the future — which would silently clear a cooldown.
        isLenient = false
    }
    fmt.parse(key)?.time
} catch (_: java.text.ParseException) {
    null
}

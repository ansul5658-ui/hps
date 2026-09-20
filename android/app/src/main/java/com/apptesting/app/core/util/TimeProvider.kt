package com.apptesting.app.core.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Testable clock plus the app's canonical "day key" format.
 *
 * The day key is `yyyy-MM-dd` in **UTC**. It is the unit of idempotency for
 * anything that must happen "at most once per calendar day" — most importantly
 * [com.apptesting.app.core.data.AssignmentRepository.recordDayOfTesting].
 *
 * WHY UTC AND NOT THE DEVICE TIMEZONE
 * The key the client computes is not trusted. Firestore rules re-derive the
 * same string from `request.time` — the server clock — and reject any
 * `testingLogs` create whose `date` doesn't match. That check is only possible
 * because both sides agree on a single, timezone-free definition of "today":
 * rules have no access to the device's timezone. Moving the device date
 * forward now produces a PERMISSION_DENIED instead of an extra testing day.
 *
 * KNOWN TRADE-OFF
 * The testing day therefore rolls over at UTC midnight rather than local
 * midnight. A tester far from UTC sees the day flip mid-evening or mid-morning.
 * Making the boundary local-timezone-aware again requires the server to learn
 * and pin each tester's zone (a Cloud Function writing the log on the user's
 * behalf), which is deliberately out of scope for this batch.
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

package com.apptesting.app.core.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Testable clock plus the app's canonical "day key" format.
 *
 * The day key is `yyyy-MM-dd` in the device's default timezone. It is the
 * unit of idempotency for anything that must happen "at most once per
 * calendar day" — most importantly [com.apptesting.app.core.data.AssignmentRepository.recordDayOfTesting].
 *
 * SAME RULE ON THE SERVER
 * When Firestore/Cloud Functions replace the mock repositories, the client
 * sends this key alongside its request. A Cloud Function then either:
 *   (a) writes a subcollection doc keyed by that day (e.g.
 *       `testAssignments/{aid}/dailyLogs/{yyyy-MM-dd}`) — security rules
 *       reject creation when the doc already exists, giving atomic
 *       once-per-day semantics; or
 *   (b) runs a Firestore transaction that reads
 *       `testAssignments/{aid}.lastLoggedLocalDay` and refuses the write
 *       when it equals the incoming key.
 * Both paths use the same string format produced here, so client and
 * server agree on what "today" is without ambiguous epoch arithmetic.
 */
interface TimeProvider {
    fun nowMillis(): Long
    /** Local calendar day (device timezone) formatted as `yyyy-MM-dd`. */
    fun todayKey(): String

    companion object Default : TimeProvider {
        override fun nowMillis(): Long = System.currentTimeMillis()
        override fun todayKey(): String = formatDayKey(nowMillis(), TimeZone.getDefault())
    }
}

/** Extracted for testing — pass a fixed epoch + zone to get a deterministic key. */
internal fun formatDayKey(epochMillis: Long, tz: TimeZone): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = tz }
    return fmt.format(Date(epochMillis))
}

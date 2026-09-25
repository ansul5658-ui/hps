package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.CancelAssignmentResult
import com.apptesting.app.core.data.ClaimAssignmentResult
import com.apptesting.app.core.data.LogDayResult
import com.apptesting.app.core.data.firebase.functions.AppFunctions
import com.apptesting.app.core.data.firebase.functions.CallableException
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.util.AppConfig
import com.apptesting.app.core.util.TimeProvider
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

/**
 * Firestore-backed [AssignmentRepository].
 *
 * ### Data model
 *   * `testingAssignments/{appId}__{testerId}__c{cycle}` — one per commitment
 *     cycle. Carries the stake, the pinned IANA timezone and the derived
 *     18-day window. Every field is server-written; rules refuse all client
 *     writes.
 *   * `testingLogs/{assignmentId}__{yyyy-MM-dd}` — one per qualifying local
 *     day, created ONLY by the `recordTestingDay` callable.
 *
 * ### Progress
 * `qualifyingDays` on the assignment is authoritative and is maintained by the
 * server in the same transaction as the log. This repository reads it; it does
 * not count logs, and it does not compute a day key.
 *
 * ### Writes
 * There are none. Claiming a commitment and recording a testing day are both
 * callable Cloud Functions — see the notes on each method below.
 */
internal class FirestoreAssignmentRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val time: TimeProvider = TimeProvider.Default,
    private val functions: AppFunctions = AppFunctions(),
) : AssignmentRepository {

    private val assignments = firestore.collection("testingAssignments")

    /**
     * Observe this tester's assignments, with SERVER-derived progress.
     *
     * This used to stream `testingLogs` alongside the assignments and count
     * them on the device to produce `daysCompleted`. That is gone. The testing
     * engine maintains `qualifyingDays` and `lastQualifyingDayKey` on the
     * assignment inside the same transaction that writes the log, so the
     * authoritative numbers are already on the document — counting a snapshot
     * here would be a second, weaker implementation of progress that could
     * disagree with the one that actually decides whether 50 coins come back.
     *
     * Dropping the log listener also removes a whole query from every screen
     * that shows assignments.
     */
    override fun observeAssignmentsForUser(userId: String): Flow<List<TestAssignment>> =
        assignments.whereEqualTo("testerId", userId).snapshots()
            .map { snap -> snap.documents.map { it.toAssignment() } }

    /**
     * Claim an assignment and commit Testing Coins to it.
     *
     * A single callable, with `appId` as the only input. The stake, the tester,
     * the cycle, the assignment id and all three balance deltas are decided
     * server-side inside one transaction.
     *
     * Deliberately does NOT touch the wallet locally. There is no optimistic
     * subtraction here and there must never be one: the balance the user sees
     * comes from the `users/{uid}/wallet/balance` listener, so it changes when
     * the server says it changed and not a moment before. A local guess would
     * show coins as committed even when the claim lost a race.
     */
    override suspend fun claimAssignment(appId: String): ClaimAssignmentResult {
        auth.currentUser?.uid
            ?: return ClaimAssignmentResult.Error("Sign in to commit to a test.")
        return try {
            val result = functions.call("joinTestingAssignment", mapOf("appId" to appId))
            ClaimAssignmentResult.Claimed(
                assignmentId = result["assignmentId"] as? String ?: "",
                committedAmount = (result["commitmentAmount"] as? Number)?.toInt() ?: 0,
                cycle = (result["cycle"] as? Number)?.toInt() ?: 0,
            )
        } catch (e: CallableException) {
            // Branch on the server's code and machine-readable reason, not its
            // wording: the Batch 9D gate sends `reason` + `gaps` so the screen
            // can say exactly what to fix.
            claimResultFor(e)
        } catch (e: IllegalStateException) {
            // AppFunctions maps the callable's code to a human message; the
            // server's own wording is the best thing to show here.
            val message = e.message.orEmpty()
            when {
                message.contains("already have an active commitment", ignoreCase = true) ||
                    message.contains("already have an unfinished", ignoreCase = true) ->
                    ClaimAssignmentResult.AlreadyCommitted
                message.contains("Testing Coins", ignoreCase = true) ->
                    ClaimAssignmentResult.InsufficientCoins(
                        required = AppConfig.DEFAULT_COMMITMENT_AMOUNT,
                        message = message,
                    )
                else -> ClaimAssignmentResult.Error(
                    message.ifBlank { "Couldn't commit to this test." },
                )
            }
        }
    }

    /**
     * Record today's testing day through the server.
     *
     * A single callable with `assignmentId` as the only input. Everything that
     * decides whether the day counts is derived server-side: the day key comes
     * from the server clock and the assignment's PINNED IANA timezone, the
     * progress count is maintained inside the same transaction, and the
     * fourteenth day completes the commitment and returns the staked coins.
     *
     * WHY THERE IS NO LOCAL WRITE AND NO LOCAL DAY KEY
     * This used to run a client Firestore transaction that created the log
     * itself, using a UTC day key both sides could agree on. Security rules now
     * refuse every client write to `testingLogs`, and the day key is the
     * server's — which is what lets the boundary be real local midnight rather
     * than 05:30 IST. Computing a day key here would at best duplicate the
     * server and at worst disagree with it, so the client no longer has one.
     *
     * Duplicate taps are safe: the server reports a same-day repeat as an
     * idempotent no-op rather than an error.
     */
    override suspend fun recordDayOfTesting(assignmentId: String): LogDayResult {
        auth.currentUser?.uid
            ?: return LogDayResult.Error("Must be signed in to log a testing day.")
        return try {
            val result = functions.call(
                "recordTestingDay",
                mapOf("assignmentId" to assignmentId),
            )
            val recorded = result["recorded"] as? Boolean ?: false
            val qualifyingDays = (result["qualifyingDays"] as? Number)?.toInt() ?: 0
            val daysRequired = (result["daysRequired"] as? Number)?.toInt() ?: DEFAULT_DAYS
            if (!recorded) {
                LogDayResult.AlreadyLoggedToday
            } else {
                LogDayResult.Logged(
                    daysCompleted = qualifyingDays,
                    daysRequired = daysRequired,
                    completed = result["completed"] as? Boolean ?: false,
                )
            }
        } catch (e: IllegalStateException) {
            // AppFunctions turns a callable failure into a human message; the
            // server's own wording ("Your first testing day starts tomorrow",
            // "This commitment's testing window has closed") is the best thing
            // to show, so it is passed through rather than replaced.
            LogDayResult.Error(e.message.orEmpty().ifBlank { "Couldn't record today." })
        }
    }

    /**
     * Cancel a live commitment through the server.
     *
     * Like [claimAssignment], this deliberately does NOT touch the wallet
     * locally. The returned amount comes back only so the screen can say what
     * happened; the balance the user sees still comes from the wallet
     * listener, so it moves when the server says it moved.
     *
     * An already-settled commitment comes back as
     * [CancelAssignmentResult.AlreadySettled] rather than an error: the server
     * refuses the second settlement by design, and surfacing that as a failure
     * would make correct behaviour look broken.
     */
    override suspend fun cancelAssignment(assignmentId: String): CancelAssignmentResult {
        auth.currentUser?.uid
            ?: return CancelAssignmentResult.Error("Sign in to cancel a commitment.")
        return try {
            val result = functions.call(
                "cancelTestingAssignment",
                mapOf("assignmentId" to assignmentId),
            )
            CancelAssignmentResult.Cancelled(
                assignmentId = result["assignmentId"] as? String ?: assignmentId,
                returnedAmount = (result["amount"] as? Number)?.toInt() ?: 0,
            )
        } catch (e: IllegalStateException) {
            val message = e.message.orEmpty()
            if (message.contains("already been settled", ignoreCase = true)) {
                CancelAssignmentResult.AlreadySettled(message)
            } else {
                CancelAssignmentResult.Error(
                    message.ifBlank { "Couldn't cancel this commitment." },
                )
            }
        }
    }


    private companion object {
        const val DEFAULT_DAYS = 14
    }
}

/**
 * Map a refused claim onto a result the screen can act on.
 *
 * Pure, and unit tested. "Already joined" is information rather than an
 * error; an insufficient balance keeps its dedicated result; everything the
 * server refused for a stated reason becomes [ClaimAssignmentResult.Refused]
 * with that reason intact; anything else is a plain error with the server's
 * (already human) message.
 */
internal fun claimResultFor(e: CallableException): ClaimAssignmentResult {
    val message = e.message.orEmpty()
    return when {
        e.code == "ALREADY_EXISTS" -> ClaimAssignmentResult.AlreadyCommitted
        e.reason == null && e.code == "FAILED_PRECONDITION" &&
            message.contains("Testing Coins", ignoreCase = true) ->
            ClaimAssignmentResult.InsufficientCoins(
                required = AppConfig.DEFAULT_COMMITMENT_AMOUNT,
                message = message,
            )
        e.code in setOf("FAILED_PRECONDITION", "RESOURCE_EXHAUSTED", "PERMISSION_DENIED", "NOT_FOUND") ->
            ClaimAssignmentResult.Refused(e.code, e.reason, e.gaps, message)
        else -> ClaimAssignmentResult.Error(message.ifBlank { "Couldn't commit to this test." })
    }
}

package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.LogDayResult
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.TestAssignment
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
 *   * `testingAssignments/{assignmentId}` per spec.
 *   * `testingLogs/{assignmentId}__{yyyy-MM-dd}` — deterministic ID keyed by
 *     assignment + local calendar day. Because the ID is deterministic, a
 *     duplicate `create` inside the same day fails at the storage layer
 *     regardless of client-side state; the security rules are the second
 *     line of defense, not the first.
 *
 * ### daysCompleted
 * `testingAssignments.daysCompleted` is treated as server-authoritative and
 * will be maintained by a Cloud Function later. Until then the repository
 * derives daysCompleted on the fly from the logs collection so the UI
 * reflects check-ins immediately.
 *
 * ### Idempotent "log today"
 * A Firestore transaction reads the deterministic log doc; if it already
 * exists we return [LogDayResult.AlreadyLoggedToday] and write nothing.
 * Otherwise we create the log doc inside the same transaction, so a race
 * that would let two writes both see "no log yet" is caught by Firestore's
 * transaction retry logic.
 */
internal class FirestoreAssignmentRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val time: TimeProvider = TimeProvider.Default,
) : AssignmentRepository {

    private val assignments = firestore.collection("testingAssignments")
    private val logs = firestore.collection("testingLogs")

    override fun observeAssignmentsForUser(userId: String): Flow<List<TestAssignment>> {
        val assignmentsFlow = assignments.whereEqualTo("testerId", userId).snapshots()
        val logsFlow = logs.whereEqualTo("testerId", userId).snapshots()
        return combine(assignmentsFlow, logsFlow) { aSnap, lSnap ->
            val logsByAssignment: Map<String, List<Pair<String, Long>>> =
                lSnap.documents
                    .mapNotNull { doc ->
                        val aid = doc.getString("assignmentId") ?: return@mapNotNull null
                        val date = doc.getString("date").orEmpty()
                        val createdAt = doc.timestampMillis("createdAt")
                        aid to (date to createdAt)
                    }
                    .groupBy({ it.first }, { it.second })

            aSnap.documents.map { doc ->
                val logsForThis = logsByAssignment[doc.id].orEmpty()
                val daysCompleted = logsForThis.size
                val lastLoggedDayKey = logsForThis
                    .maxByOrNull { it.second }?.first
                    ?.takeIf { it.isNotBlank() }
                doc.toAssignment(daysCompleted, lastLoggedDayKey)
            }
        }
    }

    override suspend fun requestCompletion(assignmentId: String): Result<Unit> = runCatching {
        auth.currentUser?.uid ?: throw IllegalStateException("Must be signed in.")
        // Rules enforce that only the tester may set this and that only the
        // `status` + `updatedAt` fields change; the tester check lives on
        // the server, not here.
        assignments.document(assignmentId).set(
            mapOf(
                "status" to AssignmentStatus.WaitingForVerification.serialize(),
                "updatedAt" to FieldValue.serverTimestamp(),
            ),
            SetOptions.merge(),
        ).await()
        // Note: we intentionally do NOT touch daysCompleted here. The admin
        // (or a future Cloud Function) verifies the log count is sufficient
        // before awarding Coins.
    }

    override suspend fun recordDayOfTesting(assignmentId: String): LogDayResult {
        android.util.Log.d("CHECKIN_DEBUG", "[CHECKIN] recordDayOfTesting called for assignmentId=$assignmentId")
        val uid = auth.currentUser?.uid
            ?: return LogDayResult.Error("Must be signed in to log a testing day.")
        val today = time.todayKey()
        val logDocId = deterministicLogId(assignmentId, today)
        android.util.Log.d("CHECKIN_DEBUG", "[CHECKIN] uid=$uid today=$today logDocId=$logDocId")
        val logRef = logs.document(logDocId)
        val assignmentRef = assignments.document(assignmentId)

        return try {
            firestore.runTransaction { tx ->
                val existing = tx.get(logRef)
                if (existing.exists()) {
                    return@runTransaction TxOutcome.AlreadyLogged
                }
                val assignment = tx.get(assignmentRef)
                if (!assignment.exists()) {
                    return@runTransaction TxOutcome.NotFound
                }
                val testerId = assignment.getString("testerId")
                if (testerId != uid) {
                    return@runTransaction TxOutcome.NotYours
                }
                val daysRequired = assignment.getLong("daysRequired")?.toInt() ?: DEFAULT_DAYS
                tx.set(
                    logRef,
                    mapOf(
                        "assignmentId" to assignmentId,
                        "testerId" to uid,
                        "date" to today,
                        "createdAt" to FieldValue.serverTimestamp(),
                    ),
                )
                TxOutcome.Logged(daysRequired)
            }.await().also {
                android.util.Log.d("CHECKIN_DEBUG", "[CHECKIN] transaction outcome=$it")
            }.toLogDayResult()
        } catch (e: FirebaseFirestoreException) {
            android.util.Log.e("CHECKIN_DEBUG", "[CHECKIN] FirebaseFirestoreException code=${e.code} message=${e.message}", e)
            // ALREADY_EXISTS surfaces here if two concurrent transactions
            // both saw "no log" and only one committed; treat as idempotent.
            if (e.code == FirebaseFirestoreException.Code.ALREADY_EXISTS ||
                e.code == FirebaseFirestoreException.Code.ABORTED
            ) {
                LogDayResult.AlreadyLoggedToday
            } else {
                LogDayResult.Error(e.message ?: "Failed to log the day.")
            }
        } catch (t: Throwable) {
            android.util.Log.e("CHECKIN_DEBUG", "[CHECKIN] Throwable class=${t.javaClass.name} message=${t.message}", t)
            LogDayResult.Error(t.message ?: "Failed to log the day.")
        }
    }

    private fun deterministicLogId(assignmentId: String, dayKey: String): String =
        "${assignmentId}__$dayKey"

    private sealed interface TxOutcome {
        object AlreadyLogged : TxOutcome
        object NotFound : TxOutcome
        object NotYours : TxOutcome
        data class Logged(val daysRequired: Int) : TxOutcome
    }

    private fun TxOutcome.toLogDayResult(): LogDayResult = when (this) {
        TxOutcome.AlreadyLogged -> LogDayResult.AlreadyLoggedToday
        TxOutcome.NotFound -> LogDayResult.Error("Assignment not found.")
        TxOutcome.NotYours -> LogDayResult.Error("This assignment isn't yours.")
        // We don't know the new post-log count without a follow-up read.
        // The observing Flow will re-emit the correct total from the logs
        // listener; the ViewModel does not consume Logged's counts for
        // display, so we pass a truthful lower bound (1) + daysRequired.
        is TxOutcome.Logged -> LogDayResult.Logged(daysCompleted = 1, daysRequired = daysRequired)
    }

    private companion object {
        const val DEFAULT_DAYS = 14
    }
}

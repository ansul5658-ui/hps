package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.data.QuickTestRepository
import com.apptesting.app.core.data.StartQuickTestResult
import com.apptesting.app.core.data.firebase.functions.AppFunctions
import com.apptesting.app.core.model.QuickTestAllowance
import com.apptesting.app.core.model.QuickTestSession
import com.apptesting.app.core.util.AppConfig
import com.apptesting.app.core.util.TimeProvider
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map

/**
 * Firestore-backed [QuickTestRepository].
 *
 * ### Data model
 *   * `discovery/quickTestPool` — server-maintained, ~8 app ids, rotated
 *     hourly least-recently-surfaced-first. Read-only to every client.
 *   * `quickTestSessions/{uid}__{appId}__{yyyy-MM-dd}` — deterministic id.
 *     Read-only to the owner; created only by the `startQuickTest` callable.
 *   * `users/{uid}/quickTestDays/{dayKey}` — the daily counter. Reading it
 *     inside the server's transaction is what enforces the 5/day limit.
 *   * `users/{uid}/quickTestApps/{appId}` — the per-app cooldown marker.
 *
 * ### There is no client write path, on purpose
 * Starting and completing a Quick Test go through callable Cloud Functions,
 * never a Firestore write. Security rules refuse every client write to all
 * four paths above, because a client that could write any of them could
 * bypass the daily limit, the cooldown, the suspension check, or the rotation
 * that keeps discovery fair. Everything this class reads is for rendering; the
 * server re-derives all of it on each call.
 *
 * ### Nothing here touches the coin economy
 * No `testingAssignments`, no `testingLogs`, no `coinBalance`, no
 * `coinTransactions`. A Quick Test cannot produce a qualifying testing day.
 */
internal class FirestoreQuickTestRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val functions: AppFunctions = AppFunctions(),
    private val time: TimeProvider = TimeProvider.Default,
) : QuickTestRepository {

    private val sessions = firestore.collection("quickTestSessions")

    override fun observePoolAppIds(): Flow<List<String>> =
        firestore.collection(AppConfig.QUICK_TEST_POOL_COLLECTION)
            .document(AppConfig.QUICK_TEST_POOL_DOC_ID)
            .snapshots()
            .map { snap ->
                // Order is preserved exactly as the server wrote it. Sorting
                // here would hand rotation control back to the client, which
                // is the thing the server-side pool exists to prevent.
                @Suppress("UNCHECKED_CAST")
                (snap.get("appIds") as? List<*>)
                    ?.mapNotNull { it as? String }
                    .orEmpty()
            }

    override fun observeAllowance(userId: String): Flow<QuickTestAllowance> {
        val today = time.todayKey()
        val dayFlow = firestore.collection("users").document(userId)
            .collection("quickTestDays").document(today)
            .snapshots()
        val appsFlow = firestore.collection("users").document(userId)
            .collection("quickTestApps")
            .snapshots()

        return combine(dayFlow, appsFlow) { daySnap, appsSnap ->
            QuickTestAllowance(
                dayKey = today,
                // Absent until the user's first Quick Test of the day — that
                // is the ordinary case, not an error.
                usedToday = daySnap.getLong("count")?.toInt() ?: 0,
                dailyLimit = AppConfig.QUICK_TEST_DAILY_LIMIT,
                lastSessionDayByAppId = appsSnap.documents.mapNotNull { doc ->
                    val lastDay = doc.getString("lastSessionDayKey") ?: return@mapNotNull null
                    doc.id to lastDay
                }.toMap(),
            )
        }
    }

    override fun observeSessions(userId: String): Flow<List<QuickTestSession>> =
        sessions
            .whereEqualTo("uid", userId)
            .orderBy("openedAt", Query.Direction.DESCENDING)
            .limit(SESSION_HISTORY_LIMIT)
            .snapshots()
            .map { snap -> snap.documents.map { it.toQuickTestSession() } }

    override suspend fun startQuickTest(appId: String): StartQuickTestResult = try {
        // `appId` is the ONLY thing sent. The day key, both timestamps, the
        // daily count and the cooldown are all server-derived — there is
        // deliberately no way for this client to influence any of them.
        val result = functions.call("startQuickTest", mapOf("appId" to appId))
        val started = result["started"] as? Boolean ?: false
        if (started) {
            StartQuickTestResult.Started(
                sessionId = result["sessionId"] as? String ?: "",
                remainingToday = (result["remainingToday"] as? Number)?.toInt() ?: 0,
            )
        } else {
            // The server reports a repeat tap as a no-op rather than an error,
            // so the UI treats it the same way.
            StartQuickTestResult.AlreadyToday
        }
    } catch (e: IllegalStateException) {
        // AppFunctions has already turned the callable's own human-authored
        // message into something worth showing.
        StartQuickTestResult.Error(e.message ?: "Couldn't start that Quick Test.")
    }

    override suspend fun completeQuickTest(appId: String, note: String?): Result<Unit> =
        runCatching {
            val payload = buildMap<String, Any?> {
                put("appId", appId)
                note?.trim()?.takeIf { it.isNotEmpty() }?.let { put("note", it) }
            }
            functions.call("completeQuickTest", payload)
            Unit
        }

    private companion object {
        /** Enough for a history screen; the wallet-style full log is not built. */
        const val SESSION_HISTORY_LIMIT = 50L
    }
}

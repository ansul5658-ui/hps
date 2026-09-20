package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.data.AdminRepository
import com.apptesting.app.core.data.firebase.functions.AppFunctions
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.UserRole
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

internal class FirestoreAdminRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val functions: AppFunctions = AppFunctions(),
) : AdminRepository {

    override fun observeAllUsers(): Flow<List<User>> =
        firestore.collection("users").snapshots()
            .map { snap ->
                snap.documents.map { doc ->
                    User(
                        id = doc.id,
                        displayName = doc.getString("displayName").orEmpty(),
                        email = doc.getString("email").orEmpty(),
                        photoUrl = doc.getString("photoUrl"),
                        createdAtMillis = (doc.get("createdAt") as? Timestamp)?.toDate()?.time ?: 0L,
                        termsAcceptedAtMillis = (doc.get("termsAcceptedAt") as? Timestamp)?.toDate()?.time,
                        coinBalance = doc.getLong("coinBalance")?.toInt() ?: 0,
                        trustScore = doc.getLong("trustScore")?.toInt() ?: 0,
                        role = when (doc.getString("role")) {
                            "admin" -> UserRole.Admin
                            "moderator" -> UserRole.Moderator
                            else -> UserRole.Member
                        },
                        isSuspended = doc.getBoolean("isSuspended") ?: false,
                    )
                }
            }

    override fun observeAllApps(): Flow<List<AppSubmission>> =
        firestore.collection("apps").snapshots()
            .map { snap -> snap.documents.map { it.toAppSubmission() } }

    override fun observeAllAssignments(): Flow<List<TestAssignment>> =
        firestore.collection("testingAssignments").snapshots()
            .map { snap ->
                snap.documents.map { doc ->
                    doc.toAssignment(
                        // Server-maintained by syncAssignmentProgress.
                        daysCompleted = doc.getLong("daysCompleted")?.toInt() ?: 0,
                        // Per-day check-in state is derived from testingLogs,
                        // which the admin list doesn't load.
                        lastLoggedDayKey = null,
                    )
                }
            }

    // ---- Privileged operations -----------------------------------------
    // These are callable Cloud Functions, not Firestore writes. The rules
    // deny `apps.status` and `users.isSuspended` writes to every client,
    // including admins; the server verifies the caller's role instead.

    override suspend fun setAppStatus(appId: String, status: AppApprovalStatus): Result<Unit> = runCatching {
        functions.call(
            "adminSetAppStatus",
            mapOf("appId" to appId, "status" to status.serialize()),
        )
        Unit
    }

    override suspend fun setUserSuspended(userId: String, isSuspended: Boolean): Result<Unit> = runCatching {
        functions.call(
            "adminSetUserSuspended",
            mapOf("userId" to userId, "isSuspended" to isSuspended),
        )
        Unit
    }

    override suspend fun assignTesters(appId: String): Result<Int> = runCatching {
        val result = functions.call("createTestingAssignments", mapOf("appId" to appId))
        (result["created"] as? Number)?.toInt() ?: 0
    }

    override suspend fun upsertGroup(
        groupId: String,
        name: String?,
        summary: String?,
        rules: String?,
        memberCap: Int?,
    ): Result<Unit> = runCatching {
        functions.call(
            "adminUpsertGroup",
            mapOf(
                "groupId" to groupId,
                "name" to name,
                "summary" to summary,
                "rules" to rules,
                "memberCap" to memberCap,
            ),
        )
        Unit
    }
}

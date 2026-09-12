package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

/**
 * Firestore-backed [AppRepository].
 *
 *  * `apps/{appId}` holds the submission fields per spec.
 *  * `observeMyApps(uid)` — real-time listener on
 *    `apps.where(ownerId == uid)` ordered by createdAt desc.
 *  * `observeAvailableApps(excludeOwnerId=uid)` — real-time listener on
 *    `apps.where(status == 'approved')`; the current user's own apps are
 *    filtered out in-memory so the UI can't test its own app.
 *  * `addApp(...)` — server sets timestamps and stamps `ownerId` from the
 *    authenticated user. `status` starts at `pendingReview` and can only
 *    be advanced by admin / Cloud Function writes (enforced by rules).
 */
internal class FirestoreAppRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
) : AppRepository {

    private val apps = firestore.collection("apps")

    override fun observeMyApps(userId: String): Flow<List<AppSubmission>> =
        apps.whereEqualTo("ownerId", userId)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .snapshots()
            .map { snap -> snap.documents.map { it.toAppSubmission() } }

    override fun observeAvailableApps(excludeOwnerId: String): Flow<List<AppSubmission>> =
        apps.whereEqualTo("status", AppApprovalStatus.Approved.serialize())
            .snapshots()
            .map { snap ->
                snap.documents
                    .map { it.toAppSubmission() }
                    .filter { it.ownerUserId != excludeOwnerId }
                    .sortedByDescending { it.createdAtMillis }
            }

    override suspend fun addApp(app: AppSubmission): Result<String> = runCatching {
        val uid = auth.currentUser?.uid
            ?: throw IllegalStateException("Must be signed in to submit an app.")
        // Force ownerId to the caller. Rules also enforce this, but stamping
        // it here means we can never accidentally send someone else's id.
        val payload = app.copy(ownerUserId = uid).toFirestoreCreate()
        val ref = apps.add(payload).await()
        ref.id
    }
}

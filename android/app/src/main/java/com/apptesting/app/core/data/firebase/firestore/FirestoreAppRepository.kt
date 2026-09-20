package com.apptesting.app.core.data.firebase.firestore

import android.net.Uri
import android.util.Log
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.ktx.snapshots
import com.google.firebase.storage.FirebaseStorage
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

private const val TAG = "AUTH_DEBUG"

/**
 * Firestore-backed [AppRepository].
 *
 *  * `apps/{appId}` holds the submission fields per spec.
 *  * `observeMyApps(uid)` — real-time listener on `apps.where(ownerId == uid)`.
 *  * `observeAvailableApps(excludeOwnerId=uid)` — real-time listener on `apps.where(status == 'approved')`.
 *  * `observeApp(appId)` — real-time listener on single doc `apps/{appId}`.
 *  * `addApp(...)` — uploads app icon to Firebase Storage if provided, then saves doc to Firestore.
 *  * `deleteApp(...)` — cleans up stored icon from Firebase Storage and deletes Firestore doc.
 */
internal class FirestoreAppRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val storage: FirebaseStorage = FirebaseStorage.getInstance(),
) : AppRepository {

    private val apps = firestore.collection("apps")

    override fun observeMyApps(userId: String): Flow<List<AppSubmission>> =
        apps.whereEqualTo("ownerId", userId)
            .snapshots()
            .map { snap ->
                val list = snap.documents
                    .map { it.toAppSubmission() }
                    .sortedByDescending { it.createdAtMillis }
                Log.d(TAG, "[MY_APPS] observeMyApps fetched ${list.size} apps for ownerId=$userId")
                list
            }

    override fun observeAvailableApps(excludeOwnerId: String): Flow<List<AppSubmission>> =
        apps.whereEqualTo("status", AppApprovalStatus.Approved.serialize())
            .snapshots()
            .map { snap ->
                snap.documents
                    .map { it.toAppSubmission() }
                    .filter { it.ownerUserId != excludeOwnerId }
                    .sortedByDescending { it.createdAtMillis }
            }

    override fun observeApp(appId: String): Flow<AppSubmission?> =
        apps.document(appId)
            .snapshots()
            .map { snap ->
                if (snap.exists()) snap.toAppSubmission() else null
            }

    override suspend fun addApp(app: AppSubmission, iconUri: Uri?): Result<String> = runCatching {
        val uid = auth.currentUser?.uid
            ?: throw IllegalStateException("Must be signed in to submit an app.")

        var iconDownloadUrl: String? = null
        if (iconUri != null) {
            Log.d(TAG, "[ADD_APP] Uploading app icon to Firebase Storage...")
            val bucketName = try { storage.app.options.storageBucket } catch (_: Exception) { null }
            Log.d(TAG, "[ADD_APP] Storage bucket = $bucketName")

            val filename = "${System.currentTimeMillis()}.jpg"
            val storageRef = storage.reference.child("appIcons/$uid/$filename")
            Log.d(TAG, "[ADD_APP] Uploading to path = ${storageRef.path}")

            try {
                val uploadTask = storageRef.putFile(iconUri).await()
                Log.d(TAG, "[ADD_APP] putFile complete: bytesTransferred=${uploadTask.bytesTransferred}")

                val downloadUri = uploadTask.storage.downloadUrl.await()
                iconDownloadUrl = downloadUri.toString()
                Log.d(TAG, "[ADD_APP] Firebase Storage icon upload successful: $iconDownloadUrl")
            } catch (e: Exception) {
                Log.e(TAG, "[ADD_APP] Storage upload failed: class=${e.javaClass.name}, message=${e.message}", e)
                throw IllegalStateException(
                    "App icon upload failed: ${e.message ?: "Storage error"}. " +
                        "Please verify that Firebase Storage is enabled in the Firebase Console.",
                )
            }
        }

        val finalApp = app.copy(ownerUserId = uid, iconStoragePath = iconDownloadUrl)
        val payload = finalApp.toFirestoreCreate()

        Log.d(TAG, "[ADD_APP] Submitting app write to path = apps/{appId}")
        Log.d(TAG, "[ADD_APP] Authenticated UID = $uid")
        Log.d(TAG, "[ADD_APP] Submitted payload keys = ${payload.keys}")
        Log.d(TAG, "[ADD_APP] Submitted status = ${payload["status"]}")
        Log.d(TAG, "[ADD_APP] Submitted ownerId = ${payload["ownerId"]}")

        val ref = apps.add(payload).await()
        Log.d(TAG, "[ADD_APP] App submission SUCCESS generated id = ${ref.id}")
        ref.id
    }

    override suspend fun deleteApp(appId: String): Result<Unit> = runCatching {
        val uid = auth.currentUser?.uid
            ?: throw IllegalStateException("Must be signed in to delete an app.")

        // First inspect the document to clean up its icon from Firebase Storage if present
        val doc = apps.document(appId).get().await()
        if (doc.exists()) {
            val iconUrl = doc.getString("iconUrl")
            if (!iconUrl.isNullOrBlank()) {
                try {
                    Log.d(TAG, "[DELETE_APP] Cleaning up Storage icon for app $appId: $iconUrl")
                    val storageRef = storage.getReferenceFromUrl(iconUrl)
                    storageRef.delete().await()
                    Log.d(TAG, "[DELETE_APP] Storage icon deleted successfully")
                } catch (e: Exception) {
                    Log.w(TAG, "[DELETE_APP] Storage icon deletion failed or object did not exist", e)
                    // Continue to delete Firestore document
                }
            }
        }

        Log.d(TAG, "[DELETE_APP] Deleting Firestore document apps/$appId for owner $uid")
        apps.document(appId).delete().await()
        Log.d(TAG, "[DELETE_APP] Firestore document apps/$appId deleted successfully")
    }
}

package com.apptesting.app.core.data.firebase

import android.content.Context
import android.util.Log
import com.apptesting.app.core.data.AuthGateway
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.UserRole
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.distinctUntilChangedBy
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withTimeout

private const val TAG = "AUTH_DEBUG"

/**
 * Real Firebase-backed [UserRepository] + [AuthGateway].
 *
 * The `currentUser` flow merges two sources so the domain [User]
 * carries server-authoritative fields alongside auth identity:
 *   * [FirebaseAuth] auth-state — identity, email, photo, uid
 *   * `users/{uid}` Firestore document — role, coinBalance, trustScore,
 *     createdAt, updatedAt
 */
internal class FirebaseAuthUserRepository(
    private val appContext: Context,
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
) : UserRepository, AuthGateway {

    @OptIn(ExperimentalCoroutinesApi::class)
    override val currentUser: Flow<User?> = authStateFlow()
        .distinctUntilChangedBy { it?.uid }
        .flatMapLatest { fbUser ->
            Log.d(TAG, "[FLOW] Auth state changed uid=${fbUser?.uid}")
            if (fbUser == null) {
                flowOf(null)
            } else {
                val identity = fbUser.toIdentity()
                firestore.collection("users").document(fbUser.uid)
                    .snapshots()
                    .map<DocumentSnapshot, User> { doc ->
                        val rawRole = doc.getString("role")
                        val parsedRole = parseRole(rawRole)
                        Log.d("ADMIN_DEBUG", "Current UID: ${auth.currentUser?.uid}")
                        Log.d("ADMIN_DEBUG", "Raw role in Firestore: '$rawRole'")
                        Log.d("ADMIN_DEBUG", "Parsed role: $parsedRole")
                        identity.copy(
                            role = parsedRole,
                            coinBalance = doc.getLong("coinBalance")?.toInt() ?: 0,
                            trustScore = doc.getLong("trustScore")?.toInt() ?: 0,
                            createdAtMillis = doc.get("createdAt")?.let {
                                (it as? Timestamp)?.toDate()?.time
                            } ?: identity.createdAtMillis,
                            isSuspended = doc.getBoolean("isSuspended") ?: false,
                        )
                    }
                    .onStart { emit(identity) }
                    .catch { e ->
                        Log.e(TAG, "[FLOW] Error observing users/${fbUser.uid} document in currentUser flow", e)
                        emit(identity)
                    }
            }
        }
        .onEach { user ->
            Log.d(TAG, "[FLOW] currentUser emitted id=${user?.id} displayName=${user?.displayName}")
        }

    private fun authStateFlow(): Flow<FirebaseUser?> = callbackFlow {
        trySend(auth.currentUser)
        val listener = FirebaseAuth.AuthStateListener { fb -> trySend(fb.currentUser) }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    override suspend fun signOut() {
        Log.d(TAG, "[AUTH] FirebaseAuth.signOut()")
        auth.signOut()
    }

    // ---- AuthGateway ---------------------------------------------------
    override fun isConfigured(): Boolean = true

    override fun webClientId(): String? = FirebaseAvailability.webClientId(appContext)

    override suspend fun signInWithGoogleIdToken(idToken: String): Result<Unit> = runCatching {
        Log.d(TAG, "[AUTH] Firebase signInWithCredential started")
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        val user = withTimeout(AUTH_STEP_TIMEOUT_MS) {
            auth.signInWithCredential(credential).await().user
        } ?: error("FirebaseAuth returned no user after sign-in.")

        val uid = user.uid
        Log.d(TAG, "[AUTH] Firebase signInWithCredential successful")
        Log.d(TAG, "[AUTH] Firebase UID = $uid")

        upsertProfile(user)
    }

    // ---- Firestore profile upsert -------------------------------------
    private suspend fun upsertProfile(user: FirebaseUser) {
        val uid = user.uid
        val ref = firestore.collection("users").document(uid)

        Log.d(TAG, "[AUTH] Firestore user profile write started")
        Log.d(TAG, "[AUTH] Firestore path = users/$uid")
        Log.d(TAG, "[AUTH] Firestore operation = SET/MERGE")
        Log.d(TAG, "[AUTH] FirebaseAuth currentUser UID = ${auth.currentUser?.uid}")

        val profile = mutableMapOf<String, Any?>(
            "uid" to uid,
            "displayName" to (user.displayName ?: ""),
            "email" to (user.email ?: ""),
            "photoUrl" to (user.photoUrl?.toString() ?: ""),
            "updatedAt" to FieldValue.serverTimestamp(),
        )

        // Include createdAt on brand new accounts without requiring a preliminary Firestore GET
        val creationTime = user.metadata?.creationTimestamp ?: 0L
        val isNewAccount = creationTime > 0 && (System.currentTimeMillis() - creationTime) < 120_000L
        if (isNewAccount) {
            profile["createdAt"] = FieldValue.serverTimestamp()
        }

        try {
            withTimeout(FIRESTORE_STEP_TIMEOUT_MS) {
                ref.set(profile, SetOptions.merge()).await()
            }
            Log.d(TAG, "[AUTH] Firestore user profile write successful")
        } catch (e: Exception) {
            Log.e(TAG, "[AUTH] Firestore operation FAILED", e)
            Log.e(TAG, "[AUTH] Exception class: ${e.javaClass.name}")
            Log.e(TAG, "[AUTH] Exception message: ${e.message}")
            Log.e(TAG, "[AUTH] FirebaseAuth.currentUser: ${auth.currentUser}")
            Log.e(TAG, "[AUTH] FirebaseAuth.currentUser?.uid: ${auth.currentUser?.uid}")
            Log.e(TAG, "[AUTH] Firestore path being accessed: users/$uid")
            throw e
        }
    }

    private fun FirebaseUser.toIdentity(): User = User(
        id = uid,
        displayName = displayName.orEmpty(),
        email = email.orEmpty(),
        photoUrl = photoUrl?.toString(),
        createdAtMillis = metadata?.creationTimestamp ?: 0L,
    )

    private fun parseRole(raw: String?): UserRole = when (raw) {
        "moderator" -> UserRole.Moderator
        "admin" -> UserRole.Admin
        else -> UserRole.Member
    }

    private companion object {
        const val AUTH_STEP_TIMEOUT_MS = 20_000L
        const val FIRESTORE_STEP_TIMEOUT_MS = 15_000L
    }
}

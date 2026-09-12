package com.apptesting.app.core.data.firebase

import android.content.Context
import com.apptesting.app.core.data.AuthGateway
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.UserRole
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.tasks.await

/**
 * Real Firebase-backed [UserRepository] + [AuthGateway].
 *
 * The `currentUser` flow now merges two sources so the domain [User]
 * carries server-authoritative fields alongside auth identity:
 *   * [FirebaseAuth] auth-state — identity, email, photo, uid
 *   * `users/{uid}` Firestore document — role, coinBalance, trustScore,
 *     createdAt, updatedAt
 *
 * Firestore write path is restricted to the fields the client is
 * permitted to set per Phase 3 Step 2 rules: uid, email, displayName,
 * photoUrl, createdAt (create-only), updatedAt. Server-authoritative
 * fields (role, coinBalance, trustScore, isSuspended) are never sent
 * from the client.
 */
internal class FirebaseAuthUserRepository(
    private val appContext: Context,
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
) : UserRepository, AuthGateway {

    @OptIn(ExperimentalCoroutinesApi::class)
    override val currentUser: Flow<User?> = authStateFlow()
        .flatMapLatest { fbUser ->
            if (fbUser == null) {
                flowOf(null)
            } else {
                val identity = fbUser.toIdentity()
                firestore.collection("users").document(fbUser.uid)
                    .snapshots()
                    .let { docFlow ->
                        combine(flowOf(identity), docFlow) { id, doc ->
                            id.copy(
                                role = parseRole(doc.getString("role")),
                                coinBalance = doc.getLong("coinBalance")?.toInt() ?: 0,
                                trustScore = doc.getLong("trustScore")?.toInt() ?: 0,
                                createdAtMillis = doc.get("createdAt")?.let {
                                    (it as? com.google.firebase.Timestamp)?.toDate()?.time
                                } ?: id.createdAtMillis,
                                isSuspended = doc.getBoolean("isSuspended") ?: false,
                            )
                        }
                    }
            }
        }

    private fun authStateFlow(): Flow<FirebaseUser?> = callbackFlow {
        trySend(auth.currentUser)
        val listener = FirebaseAuth.AuthStateListener { fb -> trySend(fb.currentUser) }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    override suspend fun signOut() {
        auth.signOut()
    }

    // ---- AuthGateway ---------------------------------------------------
    override fun isConfigured(): Boolean = true

    override fun webClientId(): String? = FirebaseAvailability.webClientId(appContext)

    override suspend fun signInWithGoogleIdToken(idToken: String): Result<Unit> = runCatching {
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        val user = auth.signInWithCredential(credential).await().user
            ?: error("FirebaseAuth returned no user after sign-in.")
        upsertProfile(user)
    }

    // ---- Firestore profile upsert -------------------------------------
    private suspend fun upsertProfile(user: FirebaseUser) {
        // Client-writable fields only. Rules reject writes to role,
        // coinBalance, trustScore, isSuspended — those are set by
        // Cloud Functions later.
        val profile = mutableMapOf<String, Any?>(
            "uid" to user.uid,
            "displayName" to (user.displayName ?: ""),
            "email" to (user.email ?: ""),
            "photoUrl" to (user.photoUrl?.toString() ?: ""),
            "updatedAt" to FieldValue.serverTimestamp(),
        )
        val ref = firestore.collection("users").document(user.uid)
        val snapshot = ref.get().await()
        if (!snapshot.exists()) {
            profile["createdAt"] = FieldValue.serverTimestamp()
        }
        ref.set(profile, SetOptions.merge()).await()
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
}

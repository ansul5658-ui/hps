package com.apptesting.app.core.data.firebase

import android.content.Context
import android.util.Log
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
import kotlinx.coroutines.withTimeout

private const val TAG = "AUTH_DEBUG"

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
 *
 * Diagnostic logging + per-call timeouts around the FirebaseAuth and
 * Firestore round trips ensure that even a hung backend surfaces as an
 * actionable error in the UI rather than an infinite Loading spinner.
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
        Log.d(TAG, "FirebaseAuth.signOut()")
        auth.signOut()
    }

    // ---- AuthGateway ---------------------------------------------------
    override fun isConfigured(): Boolean = true

    override fun webClientId(): String? = FirebaseAvailability.webClientId(appContext)

    override suspend fun signInWithGoogleIdToken(idToken: String): Result<Unit> = runCatching {
        Log.d(TAG, "FirebaseAuth.signInWithCredential — starting")
        val credential = GoogleAuthProvider.getCredential(idToken, null)
        val user = withTimeout(AUTH_STEP_TIMEOUT_MS) {
            auth.signInWithCredential(credential).await().user
        } ?: error("FirebaseAuth returned no user after sign-in.")
        Log.d(TAG, "FirebaseAuth.signInWithCredential — completed uid=${user.uid}")
        upsertProfile(user)
        Log.d(TAG, "auth flow finished successfully")
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
        Log.d(TAG, "Firestore users/${user.uid}.get() — starting")
        val snapshot = withTimeout(FIRESTORE_STEP_TIMEOUT_MS) { ref.get().await() }
        Log.d(TAG, "Firestore users/${user.uid}.get() — exists=${snapshot.exists()}")
        if (!snapshot.exists()) {
            profile["createdAt"] = FieldValue.serverTimestamp()
        }
        Log.d(TAG, "Firestore users/${user.uid}.set(merge) — starting")
        withTimeout(FIRESTORE_STEP_TIMEOUT_MS) {
            ref.set(profile, SetOptions.merge()).await()
        }
        Log.d(TAG, "Firestore users/${user.uid}.set(merge) — completed")
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
        // Ceilings on the individual Firebase network calls. Sum is well
        // under AuthViewModel.FIREBASE_TIMEOUT_MS so the outer timeout
        // remains the last-resort guard.
        const val AUTH_STEP_TIMEOUT_MS = 20_000L
        const val FIRESTORE_STEP_TIMEOUT_MS = 15_000L
    }
}

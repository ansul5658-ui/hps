package com.apptesting.app.core.data.firebase

import android.content.Context
import com.apptesting.app.core.data.AuthGateway
import com.apptesting.app.core.data.UserRepository
import com.apptesting.app.core.model.User
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

/**
 * Real Firebase-backed [UserRepository] + [AuthGateway].
 *
 * - `currentUser` mirrors [FirebaseAuth]'s auth-state listener, so the flow
 *   emits `null` after sign-out and re-emits the domain [User] on sign-in.
 * - Sign-in exchanges a Google ID token for a Firebase credential and then
 *   upserts the user's Firestore profile under `users/{uid}` — but only the
 *   fields the client is allowed to write. Server-authoritative fields
 *   (role, coinBalance, trustScore) are set by Cloud Functions later and
 *   are refused by the accompanying `firestore.rules`.
 */
internal class FirebaseAuthUserRepository(
    private val appContext: Context,
    private val auth: FirebaseAuth = FirebaseAuth.getInstance(),
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
) : UserRepository, AuthGateway {

    override val currentUser: Flow<User?> = callbackFlow {
        // Emit whatever is currently cached before the listener fires, so the
        // first collector doesn't have to wait for an auth event to know the
        // signed-out state.
        trySend(auth.currentUser?.toDomain())
        val listener = FirebaseAuth.AuthStateListener { fb ->
            trySend(fb.currentUser?.toDomain())
        }
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
        // Only the fields the client is allowed to write. The security rules
        // must refuse writes to `role`, `coinBalance`, `trustScore` and
        // `isSuspended`, which are server-authoritative.
        val profile = mutableMapOf<String, Any?>(
            "displayName" to (user.displayName ?: ""),
            "email" to (user.email ?: ""),
            "photoUrl" to (user.photoUrl?.toString() ?: ""),
            "lastSignedInAt" to FieldValue.serverTimestamp(),
        )
        val ref = firestore.collection("users").document(user.uid)
        val snapshot = ref.get().await()
        if (!snapshot.exists()) {
            profile["createdAt"] = FieldValue.serverTimestamp()
        }
        ref.set(profile, SetOptions.merge()).await()
    }

    private fun FirebaseUser.toDomain(): User = User(
        id = uid,
        displayName = displayName.orEmpty(),
        email = email.orEmpty(),
        photoUrl = photoUrl?.toString(),
        createdAtMillis = metadata?.creationTimestamp ?: 0L,
        termsAcceptedAtMillis = null,
        // Server-authoritative fields intentionally start at their default
        // zero values here. Later phases will observe users/{uid} directly
        // and layer those values on top.
    )
}

package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.data.CoinRepository
import com.apptesting.app.core.model.CoinTransaction
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Firestore-backed [CoinRepository].
 *
 * Coin transactions are stored under `users/{uid}/coinTransactions/{txId}`
 * — a per-user append-only ledger. The client only ever reads this
 * subcollection; writes are performed by Cloud Functions once the Coin
 * economy lands (Phase 3 Step 5+). Until then the subcollection is empty
 * for real accounts, and this repository just streams an empty list.
 */
internal class FirestoreCoinRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
) : CoinRepository {
    override fun observeTransactions(userId: String): Flow<List<CoinTransaction>> =
        firestore.collection("users").document(userId)
            .collection("coinTransactions")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .snapshots()
            .map { snap -> snap.documents.map { it.toCoinTransaction(userId) } }
}

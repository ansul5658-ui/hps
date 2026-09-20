package com.apptesting.app.core.data.firebase.firestore

import com.apptesting.app.core.data.CoinRepository
import com.apptesting.app.core.model.CoinTransaction
import com.apptesting.app.core.model.CoinWallet
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.ktx.snapshots
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/**
 * Firestore-backed [CoinRepository].
 *
 * Reads two server-maintained things and writes neither:
 *
 *   * `users/{uid}/wallet/balance` — the cached balance, folded from the
 *     ledger by Cloud Functions inside a transaction.
 *   * `users/{uid}/coinTransactions/{txId}` — the append-only ledger.
 *
 * SECURITY NOTE
 * Security rules refuse every client write to both paths, including deletes.
 * That is not a limitation this class works around: a client that could write
 * either one could grant itself coins, escape a live commitment or erase a
 * forfeit. There is deliberately no write method here, and adding one would
 * fail at the rules layer anyway.
 *
 * WHY THE BALANCE IS NOT COMPUTED HERE
 * It would be easy to sum [observeTransactions] and show that. It would also
 * be wrong: the query below is capped at [LEDGER_PAGE_LIMIT], so the sum would
 * quietly start disagreeing with the server as soon as a user crossed that
 * many entries — and it would disagree in the user's favour or against them
 * unpredictably. The wallet document is the number to trust.
 */
internal class FirestoreCoinRepository(
    private val firestore: FirebaseFirestore = FirebaseFirestore.getInstance(),
) : CoinRepository {

    override fun observeWallet(userId: String): Flow<CoinWallet> =
        firestore.collection("users").document(userId)
            .collection(WALLET_COLLECTION).document(WALLET_DOC_ID)
            .snapshots()
            // A user who has never transacted has no document. That is a real
            // zero balance and the normal state for a new account, so it maps
            // to an empty wallet rather than an error or a null.
            .map { snap -> if (snap.exists()) snap.toCoinWallet() else CoinWallet.EMPTY }

    override fun observeTransactions(userId: String): Flow<List<CoinTransaction>> =
        firestore.collection("users").document(userId)
            .collection("coinTransactions")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(LEDGER_PAGE_LIMIT)
            .snapshots()
            .map { snap -> snap.documents.map { it.toCoinTransaction(userId) } }

    private companion object {
        const val WALLET_COLLECTION = "wallet"
        const val WALLET_DOC_ID = "balance"

        /**
         * Ledger entries streamed for display. Bounded because this is a live
         * listener on a collection that only ever grows.
         */
        const val LEDGER_PAGE_LIMIT = 100L
    }
}

package com.apptesting.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Client-side Testing Coin wallet model.
 *
 * The client never computes a balance — the server does — so what is worth
 * testing here is narrow and specific:
 *
 *   1. A user with no wallet document reads as a real zero, not an error.
 *   2. The read model can tell a sound wallet from a self-contradictory one,
 *      so the UI can refuse to present a broken balance as if it were fine.
 *   3. Reward-era ledger entries are identifiable as history.
 *
 * The arithmetic itself is proven on the server, in functions/test/wallet.test.js
 * and against a real Firestore in test-emulator/wallet.concurrency.test.js.
 */
class CoinWalletTest {

    @Test
    fun `a new user's wallet is zero everywhere and reads as consistent`() {
        val wallet = CoinWallet.EMPTY

        assertEquals(0, wallet.available)
        assertEquals(0, wallet.locked)
        assertEquals(0, wallet.forfeitedTotal)
        assertEquals(0, wallet.purchasedTotal)
        assertEquals(0, wallet.adjustmentNet)
        assertEquals(0, wallet.ledgerCount)
        assertFalse("a user who never transacted has no document", wallet.exists)
        assertTrue("zero is a sound state, not an error", wallet.isConsistent)
    }

    @Test
    fun `a granted-then-committed wallet satisfies the invariant`() {
        // 50 granted, all of it staked on one assignment.
        val wallet = CoinWallet(
            available = 0,
            locked = 50,
            forfeitedTotal = 0,
            purchasedTotal = 0,
            adjustmentNet = 50,
            ledgerCount = 2,
            exists = true,
        )
        assertTrue(wallet.isConsistent)
    }

    @Test
    fun `completing returns the same coins rather than adding any`() {
        // The state after grant + lock + unlock. 50 in, 50 out, no bonus.
        val afterUnlock = CoinWallet(
            available = 50,
            locked = 0,
            forfeitedTotal = 0,
            purchasedTotal = 0,
            adjustmentNet = 50,
            ledgerCount = 3,
            exists = true,
        )
        assertTrue(afterUnlock.isConsistent)
        assertEquals(
            "a completed commitment must not leave the user richer",
            50,
            afterUnlock.available + afterUnlock.locked,
        )
    }

    @Test
    fun `a forfeited commitment leaves nothing available and no partial return`() {
        val afterForfeit = CoinWallet(
            available = 0,
            locked = 0,
            forfeitedTotal = 50,
            purchasedTotal = 0,
            adjustmentNet = 50,
            ledgerCount = 3,
            exists = true,
        )
        assertTrue(afterForfeit.isConsistent)
        assertEquals(0, afterForfeit.available)
        assertEquals("no partial unlock", 0, afterForfeit.locked)
    }

    @Test
    fun `a wallet with coins that came from nowhere is not consistent`() {
        // 50 available with nothing purchased and nothing adjusted: the
        // signature of a balance written outside the ledger.
        val tampered = CoinWallet(available = 50, exists = true)
        assertFalse(tampered.isConsistent)
    }

    @Test
    fun `negative balances are never consistent`() {
        assertFalse(CoinWallet(available = -1, adjustmentNet = -1, exists = true).isConsistent)
        assertFalse(
            CoinWallet(available = 50, locked = -50, adjustmentNet = 0, exists = true).isConsistent,
        )
        assertFalse(
            CoinWallet(
                available = 50,
                forfeitedTotal = -50,
                adjustmentNet = 0,
                exists = true,
            ).isConsistent,
        )
    }

    @Test
    fun `reward-era ledger entries are identifiable as legacy`() {
        val legacy = CoinTransaction(
            id = "done_app1__tester1",
            amount = 50,
            kind = CoinTransactionKind.Unknown,
            schemaVersion = 1,
        )
        assertTrue(legacy.isLegacyRewardEntry)

        val current = CoinTransaction(
            id = "grant_k1",
            amount = 50,
            kind = CoinTransactionKind.Adjustment,
            source = CoinTransactionSource.AdminGrant,
            deltaAvailable = 50,
            schemaVersion = 2,
        )
        assertFalse(current.isLegacyRewardEntry)
    }

    @Test
    fun `a default-constructed transaction is treated as legacy, not as a credit`() {
        // Defaults matter here: an entry this build cannot interpret must not
        // fall through to looking like a current-model credit.
        val unknown = CoinTransaction()
        assertTrue(unknown.isLegacyRewardEntry)
        assertEquals(CoinTransactionKind.Adjustment, unknown.kind)
        assertEquals(CoinTransactionSource.Unknown, unknown.source)
        assertEquals(0, unknown.deltaAvailable)
    }

    @Test
    fun `the Earn kind no longer exists`() {
        // A compile-time fact asserted at runtime: if someone reintroduces a
        // reward kind, this fails and they have to justify it.
        val names = CoinTransactionKind.values().map { it.name }
        assertFalse("the reward model is gone", names.contains("Earn"))
        assertFalse(names.contains("Bonus"))
        assertEquals(
            listOf("Purchase", "Lock", "Unlock", "Forfeit", "Adjustment", "Reversal", "Unknown"),
            names,
        )
    }
}

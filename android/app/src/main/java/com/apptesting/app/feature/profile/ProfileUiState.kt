package com.apptesting.app.feature.profile

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransactionKind
import com.apptesting.app.core.model.CoinWallet

sealed interface ProfileUiState {
    object Loading : ProfileUiState
    data class Error(val message: String) : ProfileUiState

    @Immutable
    data class Content(
        val displayName: String,
        val email: String,
        val joinedIso: String,
        /**
         * The server-maintained wallet. There is deliberately no
         * `totalCoinsEarned` beside it: nothing is earned under the commitment
         * model, so a lifetime-earnings figure would be a false claim.
         */
        val wallet: CoinWallet,
        val trustScore: Int,
        val appsSubmitted: Int,
        val testsCompleted: Int,
        val isAdmin: Boolean,
        val recentTransactions: List<ProfileTransactionRow>,
        val historyAssignments: List<ProfileHistoryItem>,
    ) : ProfileUiState
}

@Immutable
data class ProfileTransactionRow(
    val id: String,
    val amount: Int,
    val kind: CoinTransactionKind,
    val reason: String,
    val whenIso: String,
    /** A reward-era entry that no longer affects any balance. */
    val isLegacy: Boolean,
)

@Immutable
data class ProfileHistoryItem(
    val id: String,
    val appId: String,
    val appName: String,
    val daysCompleted: Int,
    val daysRequired: Int,
    /** Testing Coins staked on this assignment — returned on success. */
    val commitmentAmount: Int,
    val status: AssignmentStatus,
)

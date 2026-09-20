package com.apptesting.app.feature.profile

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinTransactionKind

sealed interface ProfileUiState {
    object Loading : ProfileUiState
    data class Error(val message: String) : ProfileUiState

    @Immutable
    data class Content(
        val displayName: String,
        val email: String,
        val joinedIso: String,
        val coinBalance: Int,
        val trustScore: Int,
        val appsSubmitted: Int,
        val testsCompleted: Int,
        val totalCoinsEarned: Int,
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
)

@Immutable
data class ProfileHistoryItem(
    val id: String,
    val appId: String,
    val appName: String,
    val daysCompleted: Int,
    val daysRequired: Int,
    val coinReward: Int,
    val status: AssignmentStatus,
)

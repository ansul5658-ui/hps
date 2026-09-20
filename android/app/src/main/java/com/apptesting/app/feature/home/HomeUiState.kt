package com.apptesting.app.feature.home

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.model.CoinWallet

/**
 * View state for the Home dashboard.
 * The screen renders one of three top-level cases: [Loading], [Error], [Content].
 */
sealed interface HomeUiState {
    object Loading : HomeUiState
    data class Error(val message: String) : HomeUiState

    @Immutable
    data class Content(
        val displayName: String,
        /** Server-maintained Testing Coin wallet. Read-only. */
        val wallet: CoinWallet,
        val trustScore: Int,
        val appsSubmitted: Int,
        val appsInReview: Int,
        val testingTasks: Int,
        val completedTests: Int,
        val currentGroupName: String?,
        val currentGroupEmail: String?,
        val currentAssignments: List<HomeAssignmentRow>,
        val unreadNotifications: Int,
    ) : HomeUiState
}

@Immutable
data class HomeAssignmentRow(
    val id: String,
    val appId: String,
    val appName: String,
    val status: AssignmentStatus,
    val daysCompleted: Int,
    val daysRequired: Int,
    /**
     * Testing Coins STAKED on this assignment.
     *
     * Not a payout. The Home card deliberately does not render this as
     * "+N on completion" — completing returns the same coins, so that copy
     * described a reward the product does not give.
     */
    val commitmentAmount: Int,
) {
    val progress: Float
        get() = if (daysRequired <= 0) 0f else daysCompleted.toFloat() / daysRequired
}

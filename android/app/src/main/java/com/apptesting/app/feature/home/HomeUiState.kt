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
     * Not a payout. The Home card renders this as committed coins that are
     * returned upon completion.
     */
    val commitmentAmount: Int,
    val lastEligibleDayKey: String? = null,
    val nextCheckInAtMillis: Long? = null,
    val hasCommitment: Boolean = false,
    /**
     * The server's live state, misses and allowed misses for this cycle,
     * from `getMyCommitmentStatus`. Null until the first answer arrives or for
     * a legacy commitment (no miss limit). Never computed on the device.
     */
    val serverState: com.apptesting.app.core.model.CommitmentState? = null,
    val missedDays: Int? = null,
    val allowedMisses: Int? = null,
) {
    val progress: Float
        get() = if (daysRequired <= 0) 0f else daysCompleted.toFloat() / daysRequired
}

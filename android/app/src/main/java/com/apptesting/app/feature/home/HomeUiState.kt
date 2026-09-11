package com.apptesting.app.feature.home

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.AssignmentStatus

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
        val coinBalance: Int,
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
    val coinReward: Int,
) {
    val progress: Float
        get() = if (daysRequired <= 0) 0f else daysCompleted.toFloat() / daysRequired
}

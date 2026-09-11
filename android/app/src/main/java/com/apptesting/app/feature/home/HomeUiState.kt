package com.apptesting.app.feature.home

import androidx.compose.runtime.Immutable

/**
 * View state for the Home dashboard.
 *
 * Everything is nullable / empty by default. Real values arrive once
 * repositories are wired to Firebase — see [HomeViewModel]. We deliberately
 * do NOT seed fake data here; empty states are rendered honestly.
 */
@Immutable
data class HomeUiState(
    val isLoading: Boolean = true,
    val displayName: String? = null,
    val coinBalance: Int? = null,
    val trustScore: Int? = null,
    val trustBand: TrustBand? = null,
    val todayCompleted: Int = 0,
    val todayTarget: Int = 0,
    val assignmentsRemaining: Int = 0,
    val myAppsCount: Int = 0,
    val myAppsInReview: Int = 0,
    val activeGroup: ActiveGroupSummary? = null,
    val recentActivity: List<ActivityItem> = emptyList(),
    val unreadNotifications: Int = 0,
) {
    val todayProgress: Float?
        get() = if (todayTarget > 0) todayCompleted.toFloat() / todayTarget else null
}

@Immutable
data class ActiveGroupSummary(
    val id: String,
    val name: String,
    val memberCount: Int,
    val progressPercent: Int, // 0..100
)

@Immutable
data class ActivityItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val kind: ActivityKind,
)

enum class ActivityKind { AssignmentCompleted, CoinsEarned, AppApproved, JoinedGroup, Announcement }

enum class TrustBand { New, Developing, Trusted, Elite }

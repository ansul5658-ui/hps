package com.apptesting.app.feature.testapps

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.AssignmentStatus

sealed interface TestAppsUiState {
    object Loading : TestAppsUiState
    data class Error(val message: String) : TestAppsUiState

    @Immutable
    data class Content(
        val filter: TestFilter,
        /** Section 1 — free, no coin commitment. */
        val quickTests: List<QuickTestCandidate>,
        val quickTestsRemainingToday: Int,
        val quickTestDailyLimit: Int,
        /** Section 2 — structured multi-day commitments. */
        val rows: List<TestRow>,
        /**
         * Read-only balance from `users/{uid}.coinBalance`.
         *
         * The new Available/Locked/Forfeited wallet is a later batch, so this
         * is displayed as a plain total and nothing is claimed about what is
         * locked or spendable.
         */
        val coinBalance: Int,
        val unreadNotifications: Int,
    ) : TestAppsUiState {
        val hasQuickTestQuota: Boolean get() = quickTestsRemainingToday > 0
    }
}

enum class TestFilter { All, InProgress, Available }

/**
 * One Quick Test card.
 *
 * Deliberately carries no coin field of any kind. Quick Tests cost nothing and
 * earn nothing, and a card that cannot express an amount cannot accidentally
 * start implying one.
 */
@Immutable
data class QuickTestCandidate(
    val appId: String,
    val appName: String,
    val packageName: String,
    val developerLabel: String,
    val description: String?,
)

@Immutable
data class TestRow(
    val assignmentId: String?, // null when the app is discoverable but not yet assigned
    val appId: String,
    val appName: String,
    val packageName: String,
    val developerLabel: String,
    val daysRequired: Int,
    val daysCompleted: Int,
    val status: AssignmentStatus?,
    /** True when the tester has already logged testing progress for the current calendar day. */
    val loggedToday: Boolean,
) {
    val progress: Float
        get() = if (daysRequired <= 0) 0f else daysCompleted.toFloat() / daysRequired
}

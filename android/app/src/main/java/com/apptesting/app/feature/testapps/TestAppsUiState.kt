package com.apptesting.app.feature.testapps

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.AssignmentStatus

sealed interface TestAppsUiState {
    object Loading : TestAppsUiState
    data class Error(val message: String) : TestAppsUiState

    @Immutable
    data class Content(
        val filter: TestFilter,
        val rows: List<TestRow>,
    ) : TestAppsUiState
}

enum class TestFilter { All, InProgress, Available }

@Immutable
data class TestRow(
    val assignmentId: String?, // null when the app is discoverable but not yet assigned
    val appId: String,
    val appName: String,
    val packageName: String,
    val developerLabel: String,
    val coinReward: Int,
    val daysRequired: Int,
    val daysCompleted: Int,
    val status: AssignmentStatus?,
    /** True when the tester has already logged testing progress for the current calendar day. */
    val loggedToday: Boolean,
) {
    val progress: Float
        get() = if (daysRequired <= 0) 0f else daysCompleted.toFloat() / daysRequired
}

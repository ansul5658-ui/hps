package com.apptesting.app.feature.myapps

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.AppApprovalStatus

sealed interface MyAppsUiState {
    object Loading : MyAppsUiState
    data class Error(val message: String) : MyAppsUiState

    @Immutable
    data class Content(val rows: List<MyAppRow>) : MyAppsUiState
}

@Immutable
data class MyAppRow(
    val id: String,
    val name: String,
    val packageName: String,
    val versionName: String,
    val approvalStatus: AppApprovalStatus,
    val testerCount: Int,
    val completedTesterCount: Int,
    val activeGroupName: String?,
    val iconUrl: String? = null,
)

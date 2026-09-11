package com.apptesting.app.feature.groups

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.GroupState

sealed interface GroupsUiState {
    object Loading : GroupsUiState
    data class Error(val message: String) : GroupsUiState

    @Immutable
    data class Content(val rows: List<GroupRow>) : GroupsUiState
}

@Immutable
data class GroupRow(
    val id: String,
    val name: String,
    val summary: String,
    val googleGroupEmail: String,
    val memberCount: Int,
    val memberCap: Int,
    val state: GroupState,
    val isMember: Boolean,
    val canJoin: Boolean,
)

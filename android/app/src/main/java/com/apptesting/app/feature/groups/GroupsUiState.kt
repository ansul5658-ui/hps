package com.apptesting.app.feature.groups

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.GroupState

sealed interface GroupsUiState {
    object Loading : GroupsUiState
    data class Error(val message: String) : GroupsUiState

    @Immutable
    data class Content(val rows: List<GroupRow>) : GroupsUiState
}

/**
 * Minimal row used by the list card. Join/leave actions and the Google
 * Group email now live on the Group Details screen, so the list stays
 * uncluttered.
 */
@Immutable
data class GroupRow(
    val id: String,
    val name: String,
    val summary: String,
    val memberCount: Int,
    val state: GroupState,
    val isMember: Boolean,
)

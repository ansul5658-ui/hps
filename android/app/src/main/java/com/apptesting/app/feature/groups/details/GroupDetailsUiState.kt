package com.apptesting.app.feature.groups.details

import androidx.compose.runtime.Immutable
import com.apptesting.app.core.model.Group

/**
 * View state for Group Details.
 *
 * Four terminal branches:
 *   * [Loading]  — waiting for the first snapshot from Firestore.
 *   * [Error]    — the observing flow errored (network / rules).
 *   * [NotFound] — the group document doesn't exist.
 *   * [Content]  — the group, plus the current user's membership state.
 *
 * [Content.mutation] tracks the state of a pending join/leave call so the
 * primary action button can show a spinner and reject double-taps.
 */
sealed interface GroupDetailsUiState {
    object Loading : GroupDetailsUiState
    data class Error(val message: String) : GroupDetailsUiState
    object NotFound : GroupDetailsUiState

    @Immutable
    data class Content(
        val group: Group,
        val isMember: Boolean,
        val canJoin: Boolean,
        val mutation: MutationState,
    ) : GroupDetailsUiState
}

sealed interface MutationState {
    object Idle : MutationState

    /** A join/leave request is in flight — button disables itself. */
    object Working : MutationState
}

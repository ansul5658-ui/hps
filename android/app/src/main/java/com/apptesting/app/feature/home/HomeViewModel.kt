package com.apptesting.app.feature.home

import androidx.lifecycle.ViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Home ViewModel.
 *
 * Currently emits the empty initial state and stops loading. Once Firebase
 * repositories are added, this class will collect from:
 *   - UserRepository (displayName, coinBalance, trustScore)
 *   - AssignmentRepository (today's + remaining assignments)
 *   - AppRepository (my apps summary)
 *   - GroupRepository (active group)
 *   - ActivityRepository (recent activity)
 *   - NotificationRepository (unread count)
 *
 * All merged into [HomeUiState] and exposed as a [StateFlow]. Keeping the
 * shape stable now avoids a rewrite when wiring lands.
 */
class HomeViewModel : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState(isLoading = false))
    val state: StateFlow<HomeUiState> = _state.asStateFlow()

    // TODO(firebase): observe the repositories listed above and update _state.
    // Nothing fake is emitted here — the honest first-run empty state is what
    // real users would see before any data exists.
}

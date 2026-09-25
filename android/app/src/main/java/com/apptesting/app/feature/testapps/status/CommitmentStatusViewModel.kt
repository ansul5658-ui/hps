package com.apptesting.app.feature.testapps.status

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.apptesting.app.core.data.AppRepository
import com.apptesting.app.core.data.AssignmentRepository
import com.apptesting.app.core.data.CancelAssignmentResult
import com.apptesting.app.core.data.LogDayResult
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.data.SubmitFeedbackResult
import com.apptesting.app.core.data.TestingRepository
import com.apptesting.app.core.model.CommitmentStatus
import com.apptesting.app.core.model.MemberProgress
import com.apptesting.app.core.model.MyFeedback
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.launch

sealed interface CommitmentStatusUiState {
    object Loading : CommitmentStatusUiState
    data class Error(val message: String) : CommitmentStatusUiState
    data class Content(
        val appName: String,
        /** Null when the caller has never joined this app. */
        val status: CommitmentStatus?,
        val members: MemberProgress?,
        /** Why the group isn't shown, when it isn't. */
        val membersNote: String?,
        val feedback: MyFeedback?,
        /** A request is in flight: every action button is disabled. */
        val busy: Boolean = false,
        /** A refresh after an action; the old content stays on screen. */
        val refreshing: Boolean = false,
    ) : CommitmentStatusUiState
}

/**
 * The tester's view of one commitment: their progress and misses, the group's
 * anonymous progress, and feedback.
 *
 * Holds no rule of its own. Every number is re-read from the server after
 * every action - check-in, cancellation, feedback - rather than updated
 * locally, so the screen can never show a count the server disagrees with.
 */
class CommitmentStatusViewModel(
    private val appId: String,
    private val testing: TestingRepository = ServiceLocator.testingRepository,
    private val assignments: AssignmentRepository = ServiceLocator.assignmentRepository,
    private val apps: AppRepository = ServiceLocator.appRepository,
) : ViewModel() {

    private val _state = MutableStateFlow<CommitmentStatusUiState>(CommitmentStatusUiState.Loading)
    val state: StateFlow<CommitmentStatusUiState> = _state.asStateFlow()

    private val _messages = MutableSharedFlow<String>()
    val messages: SharedFlow<String> = _messages.asSharedFlow()

    init {
        refresh()
    }

    /**
     * Refresh when the screen returns to view - but not on the first resume,
     * which [init] has already covered. A restored screen must never show
     * progress older than the server's.
     */
    fun onResume() {
        if (_state.value is CommitmentStatusUiState.Content) refresh()
    }

    fun refresh() {
        val current = _state.value as? CommitmentStatusUiState.Content
        if (current != null) _state.value = current.copy(refreshing = true)
        viewModelScope.launch { load() }
    }

    private suspend fun load() {
        val appName = runCatching { apps.observeApp(appId).firstOrNull()?.name }.getOrNull()
        val status = testing.commitmentStatus(appId)
        if (status.isFailure) {
            val msg = status.exceptionOrNull()?.message ?: "Couldn't load this commitment."
            val current = _state.value as? CommitmentStatusUiState.Content
            if (current != null) {
                _state.value = current.copy(refreshing = false, busy = false)
                _messages.emit(msg)
            } else {
                _state.value = CommitmentStatusUiState.Error(msg)
            }
            return
        }
        val commitment = status.getOrNull()
        val members = viewModelScope.async { testing.memberProgress(appId) }
        val feedback = commitment?.let { c -> viewModelScope.async { testing.myFeedback(c.assignmentId) } }
        val memberResult = members.await()
        _state.value = CommitmentStatusUiState.Content(
            appName = appName ?: "This app",
            status = commitment,
            members = memberResult.getOrNull(),
            // Refused for anyone not holding a slot - an ex-member included.
            // That is the privacy rule working, not a failure worth alarming.
            membersNote = if (memberResult.isFailure) {
                "Group progress is visible to this app's current testers."
            } else {
                null
            },
            feedback = feedback?.await()?.getOrNull(),
        )
    }

    private fun act(block: suspend () -> Unit) {
        val current = _state.value as? CommitmentStatusUiState.Content ?: return
        if (current.busy) return
        _state.value = current.copy(busy = true)
        viewModelScope.launch {
            try {
                block()
            } finally {
                load()
            }
        }
    }

    fun checkIn() {
        val id = (state.value as? CommitmentStatusUiState.Content)?.status?.assignmentId ?: return
        act {
            _messages.emit(
                when (val r = assignments.recordDayOfTesting(id)) {
                    is LogDayResult.Logged ->
                        if (r.completed) {
                            "Commitment complete - your Testing Coins have been unlocked."
                        } else {
                            "Day ${r.daysCompleted} of ${r.daysRequired} recorded."
                        }
                    LogDayResult.AlreadyLoggedToday -> "You've already checked in today."
                    is LogDayResult.Error -> r.message
                },
            )
        }
    }

    fun cancel() {
        val id = (state.value as? CommitmentStatusUiState.Content)?.status?.assignmentId ?: return
        act {
            _messages.emit(
                when (val r = assignments.cancelAssignment(id)) {
                    is CancelAssignmentResult.Cancelled ->
                        "Commitment cancelled - ${r.returnedAmount} Testing Coins returned to your available balance."
                    is CancelAssignmentResult.AlreadySettled -> "This commitment has already been settled."
                    is CancelAssignmentResult.Error -> r.message
                },
            )
        }
    }

    fun submitFeedback(rating: Int, comment: String, foundBug: Boolean) {
        val id = (state.value as? CommitmentStatusUiState.Content)?.status?.assignmentId ?: return
        val invalid = FeedbackInput.validate(rating, comment)
        if (invalid != null) {
            viewModelScope.launch { _messages.emit(invalid) }
            return
        }
        act {
            _messages.emit(
                when (val r = testing.submitFeedback(id, rating, comment, foundBug)) {
                    SubmitFeedbackResult.Submitted -> "Thanks - your feedback was sent anonymously."
                    SubmitFeedbackResult.AlreadySubmitted -> "You've already left feedback for this testing cycle."
                    is SubmitFeedbackResult.NotAllowed -> r.message
                    is SubmitFeedbackResult.Error -> r.message
                },
            )
        }
    }
}

/**
 * Client-side courtesy checks that mirror the server's limits, so the form can
 * explain a problem before a round trip. Pure and unit tested. The server
 * re-validates and normalizes everything regardless.
 */
internal object FeedbackInput {
    const val MAX_COMMENT = 1000

    fun validate(rating: Int, comment: String): String? = when {
        rating !in 1..5 -> "Choose a rating from 1 to 5 stars."
        comment.trim().codePointCount(0, comment.trim().length) > MAX_COMMENT ->
            "Keep the comment to $MAX_COMMENT characters."
        else -> null
    }
}

class CommitmentStatusViewModelFactory(private val appId: String) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = CommitmentStatusViewModel(appId) as T
}

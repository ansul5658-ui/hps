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
import com.apptesting.app.core.data.firebase.functions.CallableException
import com.apptesting.app.core.model.CommitmentStatus
import com.apptesting.app.core.model.MemberProgress
import com.apptesting.app.core.model.MyFeedback
import java.text.Normalizer
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
        val members: MembersSection,
        val feedback: MyFeedback?,
        /** A request is in flight: every action button is disabled. */
        val busy: Boolean = false,
        /** A refresh after an action; the old content stays on screen. */
        val refreshing: Boolean = false,
    ) : CommitmentStatusUiState
}

/**
 * The anonymous group-progress section, which fails independently of the rest
 * of the screen.
 *
 * "You may not see this" and "we could not find out" are different answers
 * and must never share wording: a privacy note shown for a dropped connection
 * would tell a current tester they had lost their place.
 */
sealed interface MembersSection {
    /** Re-asking the server after a failed attempt. */
    object Loading : MembersSection

    data class Visible(val progress: MemberProgress) : MembersSection

    /**
     * The server answered and refused: only the app's developer and its
     * current testers may see its progress. The privacy rule working, not a
     * failure - and it reveals nothing about who is testing.
     */
    object NotVisible : MembersSection

    /** No answer came back - connectivity or a timeout. Retrying may help. */
    data class Offline(val message: String) : MembersSection

    /** The server answered with an error. Retrying may help. */
    data class Failed(val message: String) : MembersSection

    companion object {
        const val OFFLINE_MESSAGE = "Couldn't reach AppTesting to load group progress. Check your connection and try again."
        const val FAILED_MESSAGE = "Couldn't load group progress. Please try again."

        /** Pure, and unit tested. Branches on the callable's code, never its wording. */
        fun from(result: Result<MemberProgress>): MembersSection = result.fold(
            onSuccess = { Visible(it) },
            onFailure = { e ->
                when ((e as? CallableException)?.code) {
                    "PERMISSION_DENIED" -> NotVisible
                    "UNAVAILABLE", "DEADLINE_EXCEEDED" -> Offline(OFFLINE_MESSAGE)
                    else -> Failed(FAILED_MESSAGE)
                }
            },
        )
    }
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
            members = MembersSection.from(memberResult),
            feedback = feedback?.await()?.getOrNull(),
        )
    }

    /** Retry only the group section, after it failed to load. */
    fun retryMembers() {
        val current = _state.value as? CommitmentStatusUiState.Content ?: return
        if (current.members == MembersSection.Loading) return
        _state.value = current.copy(members = MembersSection.Loading)
        viewModelScope.launch {
            val section = MembersSection.from(testing.memberProgress(appId))
            // A full refresh may have replaced the content meanwhile; only fill
            // in a section that is still waiting for this answer.
            val latest = _state.value as? CommitmentStatusUiState.Content ?: return@launch
            if (latest.members == MembersSection.Loading) _state.value = latest.copy(members = section)
        }
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
 *
 * The length is measured the way the server measures it (`normalizeComment`
 * and `validateSubmission` in functions/lib/feedback.js): normalize first, then
 * count Unicode code points - so "😀" is one character, not two UTF-16 units,
 * and the counter, the send button and the server all agree on the limit.
 */
internal object FeedbackInput {
    const val MAX_COMMENT = 1000

    /** The server refuses a raw comment longer than this, in UTF-16 units, before normalizing it. */
    const val MAX_RAW_COMMENT = MAX_COMMENT * 4

    // C0 except TAB and LF, DEL, C1, and the bidi embedding/override/isolate controls.
    private val CONTROLS = Regex("[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F\\u202A-\\u202E\\u2066-\\u2069]")
    private val LINE_BREAKS = Regex("\\r\\n?")
    private val BLANK_RUNS = Regex("\\n{3,}")

    /** The server's `normalizeComment`, step for step. */
    fun normalize(comment: String): String =
        Normalizer.normalize(comment, Normalizer.Form.NFC)
            .replace(LINE_BREAKS, "\n")
            .replace(CONTROLS, "")
            .replace(BLANK_RUNS, "\n\n")
            .trim(::isJsWhitespace)

    /** The comment's length as the server counts it. */
    fun length(comment: String): Int = normalize(comment).let { it.codePointCount(0, it.length) }

    /** Whether the server would accept this comment's length. */
    fun fits(comment: String): Boolean = comment.length <= MAX_RAW_COMMENT && length(comment) <= MAX_COMMENT

    fun validate(rating: Int, comment: String): String? = when {
        rating !in 1..5 -> "Choose a rating from 1 to 5 stars."
        !fits(comment) -> "Keep the comment to $MAX_COMMENT characters."
        else -> null
    }

    /**
     * JavaScript's `String.prototype.trim` set, which the server uses: its
     * WhiteSpace and LineTerminator characters. Kotlin's own `trim()` differs
     * (it keeps U+FEFF, for one), so the set is spelled out.
     */
    private fun isJsWhitespace(c: Char): Boolean =
        c == '\t' || c == '\n' || c == '\u000B' || c == '\u000C' || c == '\r' || c == ' ' ||
            c == ' ' || c == '﻿' || c == ' ' || c == ' ' ||
            Character.getType(c) == Character.SPACE_SEPARATOR.toInt()
}

class CommitmentStatusViewModelFactory(private val appId: String) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = CommitmentStatusViewModel(appId) as T
}

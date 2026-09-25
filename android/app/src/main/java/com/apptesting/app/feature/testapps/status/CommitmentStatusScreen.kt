package com.apptesting.app.feature.testapps.status

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Refresh
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarOutline
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.model.CommitmentState
import com.apptesting.app.core.model.CommitmentStatus
import com.apptesting.app.core.model.MemberProgressRow
import com.apptesting.app.core.model.MyFeedback
import com.apptesting.app.core.model.StakeState
import com.apptesting.app.feature.testapps.TestingCopy
import java.text.DateFormat
import java.util.Date

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CommitmentStatusScreen(
    appId: String,
    onBack: () -> Unit,
    viewModel: CommitmentStatusViewModel = viewModel(
        key = "commitment_$appId",
        factory = CommitmentStatusViewModelFactory(appId),
    ),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { viewModel.messages.collect { snackbar.showSnackbar(it) } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { viewModel.onResume() }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text("Testing progress", fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    val refreshing = (state as? CommitmentStatusUiState.Content)?.refreshing == true
                    if (refreshing) {
                        CircularProgressIndicator(modifier = Modifier.size(24.dp).padding(2.dp), strokeWidth = 2.dp)
                        Spacer(Modifier.width(12.dp))
                    } else {
                        IconButton(onClick = viewModel::refresh) {
                            Icon(Icons.Rounded.Refresh, contentDescription = "Refresh")
                        }
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background),
            )
        },
    ) { inner ->
        when (val s = state) {
            CommitmentStatusUiState.Loading -> LoadingState(Modifier.padding(inner), caption = "Loading your progress...")
            is CommitmentStatusUiState.Error -> ErrorState(
                title = "Couldn't load your progress",
                message = s.message,
                modifier = Modifier.padding(inner),
                onRetry = viewModel::refresh,
            )
            is CommitmentStatusUiState.Content -> Content(
                state = s,
                modifier = Modifier.padding(inner),
                onCheckIn = viewModel::checkIn,
                onCancel = viewModel::cancel,
                onSubmitFeedback = viewModel::submitFeedback,
            )
        }
    }
}

@Composable
private fun Content(
    state: CommitmentStatusUiState.Content,
    modifier: Modifier,
    onCheckIn: () -> Unit,
    onCancel: () -> Unit,
    onSubmitFeedback: (Int, String, Boolean) -> Unit,
) {
    LazyColumn(
        modifier = modifier,
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            Text(
                state.appName,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
        }
        val c = state.status
        if (c == null) {
            item {
                SectionCard {
                    Text("You haven't joined this app yet.", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        "Join it from the Apps tab to start testing.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            item { StateCard(c) }
            item { ProgressCard(c, busy = state.busy, onCheckIn = onCheckIn) }
            if (c.isActive || c.state == CommitmentState.AwaitingSettlement) item { MissesCard(c) }
            if (c.isActive) item { CancelCard(c, busy = state.busy, onCancel = onCancel) }
        }

        item { SectionTitle("Testing group") }
        val members = state.members
        when {
            members == null -> item { Muted(state.membersNote ?: "Group progress isn't available.") }
            members.members.isEmpty() -> item { Muted("No one is testing this app yet.") }
            else -> {
                item { Muted("${members.memberCount} of ${members.capacity} tester slots taken. Names are never shown.") }
                items(members.members, key = { it.label }) { MemberRow(it) }
            }
        }

        if (c != null) {
            item { SectionTitle("Feedback") }
            item { FeedbackCard(state.feedback, busy = state.busy, onSubmit = onSubmitFeedback) }
        }
    }
}

// ---------------------------------------------------------------------------
// Own commitment
// ---------------------------------------------------------------------------

@Composable
private fun StateCard(c: CommitmentStatus) {
    val tone = when (c.state) {
        CommitmentState.Testing, CommitmentState.Completed -> StatusTone.Success
        CommitmentState.Cancelled, CommitmentState.Unknown -> StatusTone.Neutral
        CommitmentState.AwaitingSettlement, CommitmentState.RemovedForMisses,
        CommitmentState.Forfeited, CommitmentState.Missed -> StatusTone.Danger
    }
    SectionCard {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                c.cycle?.let { "Cycle $it" } ?: "Commitment",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            StatusPill(text = TestingCopy.statePill(c.state), tone = tone)
        }
        Text(
            TestingCopy.stateExplanation(c.state, c.endReason, c.commitmentAmount),
            style = MaterialTheme.typography.bodyMedium,
        )
        val stake = when (c.stake) {
            StakeState.Locked -> "${c.commitmentAmount} Testing Coins locked"
            StakeState.Returned -> "${c.commitmentAmount} Testing Coins unlocked and returned"
            StakeState.Forfeited -> "${c.commitmentAmount} Testing Coins forfeited"
            StakeState.None -> "No Testing Coins staked"
        }
        Text(stake, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ProgressCard(c: CommitmentStatus, busy: Boolean, onCheckIn: () -> Unit) {
    val required = c.daysRequired ?: 14
    SectionCard {
        SectionLabel("Testing days")
        Text(
            "${c.qualifyingDays} of $required days recorded",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
        )
        LinearProgressIndicator(
            progress = { if (required <= 0) 0f else (c.qualifyingDays.toFloat() / required).coerceIn(0f, 1f) },
            modifier = Modifier.fillMaxWidth().height(8.dp).clip(CircleShape),
        )
        // Window dates straight from the server's pinned window; no local
        // arithmetic, so no disagreement with the server's day boundary.
        val last = c.effectiveLastEligibleDayKey ?: c.lastEligibleDayKey
        if (c.firstEligibleDayKey != null && last != null) {
            Text(
                "Testing window: ${c.firstEligibleDayKey} to $last" +
                    (c.windowDays?.let { " ($it days)" } ?: "") +
                    (c.timeZone?.let { ", $it time" } ?: ""),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (last != null && c.lastEligibleDayKey != null && last != c.lastEligibleDayKey) {
            Text(
                "Extended to $last because of a declared service outage.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        // Both keys are the server's (its "today" in the pinned zone, and the
        // pinned first day), so this compares server facts - it does not
        // decide anything the server hasn't.
        val notStarted = c.isActive && c.todayKey != null && c.firstEligibleDayKey != null &&
            c.todayKey < c.firstEligibleDayKey
        if (notStarted) {
            Text(
                "Testing starts on ${c.firstEligibleDayKey}. Check-ins open that day - " +
                    "the day you joined doesn't count.",
                style = MaterialTheme.typography.bodyMedium,
            )
        } else if (c.isActive) {
            Spacer(Modifier.height(4.dp))
            FilledTonalButton(
                onClick = onCheckIn,
                enabled = !c.loggedToday && !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) {
                Text(if (c.loggedToday) "Checked in today" else "Check in for today", fontWeight = FontWeight.Bold)
            }
            if (!c.loggedToday) {
                Text(
                    "Today isn't a missed day until it's over.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun MissesCard(c: CommitmentStatus) {
    SectionCard {
        SectionLabel("Missed days")
        if (!c.missRule) {
            Text(
                "This commitment started under the earlier rules: no miss limit, but all testing days must be " +
                    "recorded before the window closes.",
                style = MaterialTheme.typography.bodyMedium,
            )
            return@SectionCard
        }
        val missed = c.missedDays
        val allowed = c.allowedMisses
        if (missed == null || allowed == null) {
            Text("Missed days couldn't be worked out right now.", style = MaterialTheme.typography.bodyMedium)
            return@SectionCard
        }
        Text(
            "$missed of $allowed allowed misses used",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = if (missed >= allowed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
        Text(
            MissWarning.text(missed, allowed, c.commitmentAmount),
            style = MaterialTheme.typography.bodyMedium,
            color = if (missed >= allowed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
    }
}

@Composable
private fun CancelCard(c: CommitmentStatus, busy: Boolean, onCancel: () -> Unit) {
    var confirming by rememberSaveable { mutableStateOf(false) }
    TextButton(
        onClick = { confirming = true },
        enabled = !busy,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) { Text("Cancel commitment") }
    if (confirming) {
        AlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text("Cancel this commitment?") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Your commitment will end and testing stops for this app.")
                    Text("Your ${c.commitmentAmount} locked Testing Coins will be returned to your available balance.")
                    Text("Your tester slot is released. You can join again later if a slot is free.")
                }
            },
            confirmButton = {
                TextButton(onClick = { confirming = false; onCancel() }) {
                    Text("Cancel commitment", fontWeight = FontWeight.Bold)
                }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text("Keep testing") } },
        )
    }
}

// ---------------------------------------------------------------------------
// Group
// ---------------------------------------------------------------------------

@Composable
private fun MemberRow(m: MemberProgressRow) {
    val name = if (m.isYou) "You" else m.label
    val misses = if (m.missedDays != null && m.allowedMisses != null) {
        " · ${m.missedDays}/${m.allowedMisses} misses"
    } else {
        ""
    }
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (m.isYou) {
                MaterialTheme.colorScheme.primaryContainer
            } else {
                MaterialTheme.colorScheme.surface
            },
        ),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(name, fontWeight = FontWeight.Bold)
                Text(
                    "${m.qualifyingDays} of ${m.daysRequired ?: 14} days$misses" +
                        if (m.loggedToday) " · checked in today" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            StatusPill(
                text = TestingCopy.statePill(m.state),
                tone = when (m.state) {
                    CommitmentState.Testing, CommitmentState.Completed -> StatusTone.Success
                    CommitmentState.AwaitingSettlement -> StatusTone.Danger
                    else -> StatusTone.Neutral
                },
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

@Composable
private fun FeedbackCard(
    feedback: MyFeedback?,
    busy: Boolean,
    onSubmit: (Int, String, Boolean) -> Unit,
) {
    SectionCard {
        val submitted = feedback?.submitted
        when {
            feedback == null -> Muted("Feedback isn't available right now.")
            submitted != null -> {
                Text("Your feedback was sent", fontWeight = FontWeight.Bold)
                Text(
                    "${submitted.rating} of 5 stars" + if (submitted.foundBug) " · reported a bug" else "",
                    style = MaterialTheme.typography.bodyMedium,
                )
                submitted.comment?.let { Text("\"$it\"", style = MaterialTheme.typography.bodyMedium) }
                submitted.submittedAtMillis?.let {
                    Muted("Sent ${DateFormat.getDateTimeInstance(DateFormat.MEDIUM, DateFormat.SHORT).format(Date(it))}")
                }
                Muted("Feedback can't be edited once sent - one per testing cycle.")
            }
            !feedback.canSubmit -> Muted(
                when (feedback.reason) {
                    "noTestingDays" -> "Record at least one testing day to leave feedback."
                    "noCommitment" -> "Feedback is for testing commitments."
                    else -> "You can't leave feedback for this cycle."
                },
            )
            else -> FeedbackForm(busy = busy, onSubmit = onSubmit)
        }
    }
}

@Composable
private fun FeedbackForm(busy: Boolean, onSubmit: (Int, String, Boolean) -> Unit) {
    var rating by rememberSaveable { mutableIntStateOf(0) }
    var comment by rememberSaveable { mutableStateOf("") }
    var foundBug by rememberSaveable { mutableStateOf(false) }

    Text("How was testing this app?", fontWeight = FontWeight.Bold)
    Muted(TestingCopy.FEEDBACK_ANONYMOUS_NOTE)
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        for (i in 1..5) {
            Icon(
                imageVector = if (i <= rating) Icons.Rounded.Star else Icons.Rounded.StarOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .size(48.dp)
                    .selectable(selected = rating == i, role = Role.RadioButton, onClick = { rating = i })
                    .semantics { contentDescription = "$i of 5 stars" }
                    .padding(8.dp),
            )
        }
    }
    OutlinedTextField(
        value = comment,
        onValueChange = { if (it.length <= FeedbackInput.MAX_COMMENT * 2) comment = it },
        label = { Text("Comment (optional)") },
        supportingText = { Text("${comment.trim().length} / ${FeedbackInput.MAX_COMMENT}") },
        isError = comment.trim().length > FeedbackInput.MAX_COMMENT,
        minLines = 3,
        modifier = Modifier.fillMaxWidth(),
    )
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(value = foundBug, role = Role.Checkbox, onValueChange = { foundBug = it }),
    ) {
        Checkbox(checked = foundBug, onCheckedChange = null)
        Spacer(Modifier.width(8.dp))
        Text("I found a bug")
    }
    Button(
        onClick = { onSubmit(rating, comment, foundBug) },
        enabled = rating in 1..5 && !busy && comment.trim().length <= FeedbackInput.MAX_COMMENT,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) { Text("Send feedback", fontWeight = FontWeight.Bold) }
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

@Composable
private fun SectionCard(content: @Composable () -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { content() }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Column {
        Spacer(Modifier.height(4.dp))
        HorizontalDivider()
        Spacer(Modifier.height(8.dp))
        Text(
            text,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.semantics { heading() },
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun Muted(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

/**
 * The miss warning, escalating with the count. Pure and unit tested. Always
 * describes the THIRD miss as the one that removes - never earlier, never
 * later - because that is the rule the server enforces.
 */
internal object MissWarning {
    fun text(missed: Int, allowed: Int, amount: Int): String = when {
        missed <= 0 -> "You haven't missed any testing days. You can miss up to $allowed."
        missed < allowed -> {
            val left = allowed - missed
            "$missed missed so far. You can miss $left more day${if (left == 1) "" else "s"}; " +
                "missing ${left + 1} more removes you and forfeits the $amount locked coins."
        }
        missed == allowed ->
            "You've used all $allowed allowed misses. One more missed day removes you from this test and " +
                "forfeits the $amount locked Testing Coins. Check in every day."
        else -> "More than $allowed days were missed, so this commitment is being closed and the $amount " +
            "locked Testing Coins forfeited."
    }
}

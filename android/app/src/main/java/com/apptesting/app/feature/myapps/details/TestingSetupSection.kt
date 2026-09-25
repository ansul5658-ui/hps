package com.apptesting.app.feature.myapps.details

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.BugReport
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.model.AppReadiness
import com.apptesting.app.core.model.ReadinessGap
import com.apptesting.app.core.util.AppConfig
import com.apptesting.app.feature.testapps.TestingCopy
import java.text.DateFormat
import java.util.Date

/**
 * The developer's testing-setup checklist and self-confirmation.
 *
 * The checklist is the server's (`getAppTestingReadiness`); this card only
 * renders it. The confirmation is a statement by the developer, recorded as
 * "self-confirmed" - AppTesting cannot see the Play Console or the group's
 * members, and the card says so in plain words before the button.
 */
@Composable
internal fun TestingSetupCard(
    state: SetupUiState,
    onConfirm: () -> Unit,
    onRetry: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Testing setup", style = MaterialTheme.typography.titleMedium)
            when (state) {
                SetupUiState.Loading -> Row(verticalAlignment = Alignment.CenterVertically) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                    Spacer(Modifier.width(10.dp))
                    Text("Checking your setup...")
                }
                is SetupUiState.Error -> {
                    Text(state.message, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = onRetry) { Text("Try again") }
                }
                is SetupUiState.Loaded -> Loaded(state.readiness, state.confirming, onConfirm)
            }
        }
    }
}

@Composable
private fun Loaded(r: AppReadiness, confirming: Boolean, onConfirm: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            if (r.ready) "Ready for testers" else "Not ready yet",
            fontWeight = FontWeight.Bold,
            modifier = Modifier.weight(1f),
        )
        StatusPill(
            text = if (r.ready) "Ready" else "Action needed",
            tone = if (r.ready) StatusTone.Success else StatusTone.Warning,
        )
    }

    // Each checklist item is either done or one of the server's gaps.
    val approvedGap = ReadinessGap.NOT_APPROVED in r.gaps
    CheckItem(!approvedGap, if (approvedGap) TestingCopy.readinessGap(ReadinessGap.NOT_APPROVED) else "Approved by an admin")
    val linkGaps = r.gaps.filter {
        it in setOf(
            ReadinessGap.INVALID_PACKAGE,
            ReadinessGap.MISSING_OPT_IN_URL,
            ReadinessGap.INVALID_OPT_IN_URL,
            ReadinessGap.INVALID_PLAY_STORE_URL,
        )
    }
    if (linkGaps.isEmpty()) {
        CheckItem(true, "Closed-testing opt-in link is valid")
    } else {
        linkGaps.forEach { CheckItem(false, TestingCopy.readinessGap(it)) }
        Text(
            "Fix this link in your app details, then confirm the setup.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    val confirmation = r.confirmation
    when {
        ReadinessGap.CONFIRMATION_OUTDATED in r.gaps ->
            CheckItem(false, "Setup changed since you confirmed - confirmation required again")
        confirmation != null && confirmation.current -> CheckItem(
            true,
            "Self-confirmed" + (
                confirmation.confirmedAtMillis
                    ?.let { " on " + DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(it)) }
                    ?: ""
                ),
        )
        else -> CheckItem(false, "Confirmation required")
    }

    HorizontalDivider()
    Text("Official AppTesting Google Group", fontWeight = FontWeight.Bold)
    Text(
        "Add this group as testers in your Play Console closed test: ${r.groupEmail ?: AppConfig.OFFICIAL_GROUP_EMAIL}",
        style = MaterialTheme.typography.bodyMedium,
    )
    Text(
        "You set up your closed test and add the group yourself - AppTesting doesn't create or control them.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )

    // The form is offered whenever a (re)confirmation would change something.
    val needsConfirmation = confirmation == null || !confirmation.current
    val linksOk = linkGaps.isEmpty()
    if (needsConfirmation) ConfirmForm(linksOk = linksOk, confirming = confirming, onConfirm = onConfirm)
}

@Composable
private fun ConfirmForm(linksOk: Boolean, confirming: Boolean, onConfirm: () -> Unit) {
    var closedTest by rememberSaveable { mutableStateOf(false) }
    var groupAdded by rememberSaveable { mutableStateOf(false) }
    HorizontalDivider()
    Text("Confirm your setup", fontWeight = FontWeight.Bold)
    Text(
        TestingCopy.SETUP_SELF_CONFIRM_NOTE,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    CheckRow("Closed testing is set up", closedTest) { closedTest = it }
    CheckRow("Official AppTesting Google Group has been added to the closed test", groupAdded) { groupAdded = it }
    Button(
        onClick = onConfirm,
        enabled = closedTest && groupAdded && linksOk && !confirming,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
    ) {
        if (confirming) {
            CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
        } else {
            Text("I have completed this - confirm setup", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .toggleable(value = checked, role = Role.Checkbox, onValueChange = onChange),
    ) {
        Checkbox(checked = checked, onCheckedChange = null)
        Spacer(Modifier.width(8.dp))
        Text(label, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun CheckItem(done: Boolean, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = if (done) Icons.Rounded.CheckCircle else Icons.Rounded.ErrorOutline,
            contentDescription = if (done) "Done" else "To do",
            tint = if (done) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

/** Anonymous tester feedback: rating, comment, bug flag, time. Never who. */
@Composable
internal fun AppFeedbackCard(state: AppFeedbackUiState, onRetry: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Tester feedback", style = MaterialTheme.typography.titleMedium)
            Text(
                "Feedback is anonymous - you see what testers said, never who said it.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            when (state) {
                AppFeedbackUiState.Loading -> CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                is AppFeedbackUiState.Error -> {
                    Text(state.message, color = MaterialTheme.colorScheme.error)
                    TextButton(onClick = onRetry) { Text("Try again") }
                }
                is AppFeedbackUiState.Loaded ->
                    if (state.items.isEmpty()) {
                        Text("No feedback yet.", style = MaterialTheme.typography.bodyMedium)
                    } else {
                        state.items.forEachIndexed { i, f ->
                            if (i > 0) HorizontalDivider()
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Rounded.Star, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
                                Spacer(Modifier.width(4.dp))
                                Text("${f.rating} of 5", fontWeight = FontWeight.Bold)
                                if (f.foundBug) {
                                    Spacer(Modifier.width(12.dp))
                                    Icon(Icons.Rounded.BugReport, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Bug reported", color = MaterialTheme.colorScheme.error)
                                }
                                Spacer(Modifier.weight(1f))
                                f.submittedAtMillis?.let {
                                    Text(
                                        DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(it)),
                                        style = MaterialTheme.typography.labelSmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            f.comment?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
                        }
                    }
            }
        }
    }
}

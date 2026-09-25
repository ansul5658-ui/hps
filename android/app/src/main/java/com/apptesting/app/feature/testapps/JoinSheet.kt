package com.apptesting.app.feature.testapps

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.apptesting.app.core.model.JoinBlocker
import com.apptesting.app.core.util.AppConfig

/**
 * The join sheet: the server's checklist, the rules, then the stake.
 *
 * Everything shown comes from `getJoinEligibility` - the blockers, the
 * balance, the slots left, the group. It is a preview; pressing the button
 * runs the real claim, which decides again from scratch. The button is
 * disabled while the preview has blockers, but that is a courtesy: a tampered
 * client that pressed it anyway would be refused by the server for the same
 * reason.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun JoinSheet(
    state: JoinSheetState,
    onDismiss: () -> Unit,
    onRetry: () -> Unit,
    onConfirmGroupJoined: () -> Unit,
    onConfirmJoin: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 24.dp)
                .padding(bottom = 24.dp)
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Text(
                text = "Join ${state.appName}",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.semantics { heading() },
            )
            when (state) {
                is JoinSheetState.Loading -> Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.padding(vertical = 24.dp),
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 3.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("Checking whether you can join...")
                }
                is JoinSheetState.Failed -> {
                    Notice(Icons.Rounded.ErrorOutline, state.message, error = true)
                    FilledTonalButton(onClick = onRetry, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                        Text("Try again")
                    }
                }
                is JoinSheetState.Ready -> ReadyContent(
                    state = state,
                    onConfirmGroupJoined = onConfirmGroupJoined,
                    onConfirmJoin = onConfirmJoin,
                    onDismiss = onDismiss,
                )
            }
        }
    }
}

@Composable
private fun ReadyContent(
    state: JoinSheetState.Ready,
    onConfirmGroupJoined: () -> Unit,
    onConfirmJoin: () -> Unit,
    onDismiss: () -> Unit,
) {
    val e = state.eligibility
    val amount = e.commitmentAmount.takeIf { it > 0 } ?: AppConfig.DEFAULT_COMMITMENT_AMOUNT

    if (state.message != null) Notice(Icons.Rounded.Info, state.message)

    // The facts that matter before anything is staked, all from the server.
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.surfaceVariant) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Fact("Testing Coins required", "$amount")
            Fact("Your available coins", "${e.availableCoins}")
            Fact("Tester slots left", "${e.slotsLeft} of ${e.capacity}")
        }
    }

    Text("How it works", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
    TestingCopy.commitmentRules(amount).forEach { rule ->
        Text("•  $rule", style = MaterialTheme.typography.bodyMedium)
    }

    if (e.blockers.isNotEmpty()) {
        Text("Before you can join", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        e.blockers.forEach { code ->
            Notice(Icons.Rounded.ErrorOutline, TestingCopy.joinBlocker(code, amount), error = true)
            if (code == JoinBlocker.TARGET_NOT_READY && e.targetGaps.isNotEmpty()) {
                Text(
                    text = e.targetGaps.joinToString("\n") { "–  " + TestingCopy.readinessGap(it) },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 32.dp),
                )
            }
        }
    }

    if (JoinBlocker.GROUP_NOT_JOINED in e.blockers) {
        GroupStep(
            groupEmail = e.groupEmail ?: AppConfig.OFFICIAL_GROUP_EMAIL,
            working = state.working,
            onConfirmGroupJoined = onConfirmGroupJoined,
        )
    } else if (e.groupJoinedSelfConfirmed) {
        Notice(Icons.Rounded.CheckCircle, "Official AppTesting Google Group: self-confirmed")
    }

    Spacer(Modifier.height(4.dp))
    Button(
        onClick = onConfirmJoin,
        enabled = e.canJoin && !state.working,
        modifier = Modifier.fillMaxWidth().heightIn(min = 52.dp),
    ) {
        if (state.working) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            Text("Lock $amount Testing Coins and join", fontWeight = FontWeight.Bold)
        }
    }
    TextButton(onClick = onDismiss, enabled = !state.working, modifier = Modifier.fillMaxWidth()) {
        Text("Not now")
    }
}

/** The tester's group step: open the group, then self-confirm. */
@Composable
private fun GroupStep(groupEmail: String, working: Boolean, onConfirmGroupJoined: () -> Unit) {
    val context = LocalContext.current
    Surface(shape = MaterialTheme.shapes.medium, color = MaterialTheme.colorScheme.secondaryContainer) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Rounded.Groups, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text(TestingCopy.GROUP_FIRST, fontWeight = FontWeight.Bold)
            }
            Text("1. Open the group and join it: $groupEmail", style = MaterialTheme.typography.bodyMedium)
            Text("2. Come back here.", style = MaterialTheme.typography.bodyMedium)
            Text("3. Tap \"I have completed this\".", style = MaterialTheme.typography.bodyMedium)
            Text(
                TestingCopy.GROUP_SELF_CONFIRM_NOTE,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSecondaryContainer,
            )
            OutlinedButton(
                onClick = {
                    runCatching {
                        context.startActivity(
                            Intent(Intent.ACTION_VIEW, Uri.parse(AppConfig.APP_TESTER_GOOGLE_GROUP_URL)),
                        )
                    }
                },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text("Open the AppTesting Google Group") }
            FilledTonalButton(
                onClick = onConfirmGroupJoined,
                enabled = !working,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
            ) { Text("I have completed this") }
        }
    }
}

@Composable
private fun Fact(label: String, value: String) {
    Row(Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
    }
}

@Composable
internal fun Notice(icon: ImageVector, text: String, error: Boolean = false) {
    Row(verticalAlignment = Alignment.Top) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = if (error) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(20.dp),
        )
        Spacer(Modifier.width(10.dp))
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

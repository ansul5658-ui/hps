package com.apptesting.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.core.designsystem.component.*
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.core.util.AppConfig

@Composable
fun HomeScreen(
    viewModel: HomeViewModel = viewModel(),
    onGoToTestApps: () -> Unit = {},
    onGoToMyApps: () -> Unit = {},
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    when (val s = state) {
        HomeUiState.Loading    -> LoadingState(caption = "Loading your dashboard…")
        is HomeUiState.Error   -> ErrorState(title = "Couldn't load dashboard", message = s.message)
        is HomeUiState.Content -> HomeContent(s, onGoToTestApps, onGoToMyApps)
    }
}

@Composable
private fun HomeContent(
    state: HomeUiState.Content,
    onGoToTestApps: () -> Unit,
    onGoToMyApps: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 24.dp),
    ) {
        // ── Hero header ──
        item {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.verticalGradient(
                            colors = listOf(
                                MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.4f),
                                Color.Transparent,
                            )
                        )
                    )
                    .padding(horizontal = 20.dp)
                    .padding(top = 20.dp, bottom = 16.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column {
                        Text(
                            text = greetingFor(state.displayName),
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onBackground,
                        )
                        Text(
                            text = "Your testing dashboard",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    BadgedBox(
                        badge = {
                            if (state.unreadNotifications > 0)
                                Badge { Text(state.unreadNotifications.toString()) }
                        }
                    ) {
                        FilledTonalIconButton(onClick = {}) {
                            Icon(Icons.Rounded.Notifications, contentDescription = "Notifications")
                        }
                    }
                }
            }
        }

        // ── Stat cards ──
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                StatCard(
                    icon = Icons.Rounded.Savings,
                    label = "Testing Coins",
                    value = state.wallet.available.toString(),
                    accent = MaterialTheme.colorScheme.tertiary,
                    accentContainer = MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    icon = Icons.Rounded.Verified,
                    label = "Trust",
                    value = state.trustScore.toString(),
                    accent = MaterialTheme.colorScheme.secondary,
                    accentContainer = MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    icon = Icons.Rounded.CheckCircle,
                    label = "Tests Done",
                    value = state.completedTests.toString(),
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(16.dp))
        }

        // ── Group info ──
        state.currentGroupName?.let { groupName ->
            item {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                    shape = MaterialTheme.shapes.large,
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    ),
                    elevation = CardDefaults.cardElevation(0.dp),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Rounded.Groups,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.secondary,
                            modifier = Modifier.size(24.dp),
                        )
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Text(
                                text = groupName,
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onSecondaryContainer,
                            )
                            state.currentGroupEmail?.let {
                                Text(
                                    text = it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f),
                                )
                            }
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
            }
        }

        // ── Quick actions ──
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                QuickActionCard(
                    icon = Icons.Rounded.PhoneAndroid,
                    label = "Test Apps",
                    sublabel = "${state.testingTasks} pending",
                    onClick = onGoToTestApps,
                    modifier = Modifier.weight(1f),
                    containerColor = MaterialTheme.colorScheme.primaryContainer,
                    contentColor = MaterialTheme.colorScheme.primary,
                )
                QuickActionCard(
                    icon = Icons.Rounded.AddCircle,
                    label = "My Apps",
                    sublabel = "${state.appsSubmitted} submitted",
                    onClick = onGoToMyApps,
                    modifier = Modifier.weight(1f),
                    containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    contentColor = MaterialTheme.colorScheme.secondary,
                )
            }
            Spacer(Modifier.height(20.dp))
        }

        // ── Active assignments ──
        if (state.currentAssignments.isNotEmpty()) {
            item {
                SectionHeader(
                    title = "Active Assignments",
                    modifier = Modifier.padding(horizontal = 20.dp),
                )
                Spacer(Modifier.height(8.dp))
            }
            items(state.currentAssignments) { row ->
                AssignmentCard(
                    appName = row.appName,
                    status = row.status,
                    daysCompleted = row.daysCompleted,
                    daysRequired = row.daysRequired,
                    progress = row.progress,
                    commitmentAmount = row.commitmentAmount,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp)
                        .padding(bottom = 10.dp),
                )
            }
        }
    }
}

@Composable
private fun QuickActionCard(
    icon: ImageVector,
    label: String,
    sublabel: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    containerColor: Color = MaterialTheme.colorScheme.surfaceContainer,
    contentColor: Color = MaterialTheme.colorScheme.onSurface,
) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = containerColor),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Icon(icon, null, tint = contentColor, modifier = Modifier.size(28.dp))
            Spacer(Modifier.height(12.dp))
            Text(label, style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold, color = contentColor)
            Text(sublabel, style = MaterialTheme.typography.bodySmall,
                color = contentColor.copy(alpha = 0.7f))
        }
    }
}

@Composable
private fun AssignmentCard(
    appName: String,
    status: com.apptesting.app.core.model.AssignmentStatus,
    daysCompleted: Int,
    daysRequired: Int,
    progress: Float,
    commitmentAmount: Int,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainer,
        ),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    appName,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Spacer(Modifier.width(8.dp))
                StatusPill(text = assignmentStatusLabel(status), tone = assignmentStatusTone(status))
            }
            Spacer(Modifier.height(10.dp))
            LinearProgressIndicator(
                progress = { progress },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(6.dp)
                    .clip(MaterialTheme.shapes.small),
                color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.outlineVariant,
            )
            Spacer(Modifier.height(6.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    "$daysCompleted / $daysRequired days",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                // The stake, not a reward. Completing this assignment returns
                // these coins; it does not add any. The old copy here read
                // "+N coins on completion", which promised earnings the
                // commitment product does not give.
                Text(
                    if (commitmentAmount > 0) "$commitmentAmount committed" else "",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun greetingFor(name: String): String {
    val first = name.substringBefore(" ").ifBlank { name }
    return "Hey, $first 👋"
}

fun assignmentStatusLabel(status: AssignmentStatus): String = when (status) {
    AssignmentStatus.Ready                  -> "Ready"
    AssignmentStatus.InProgress             -> "In Progress"
    AssignmentStatus.WaitingForVerification -> "Verifying"
    AssignmentStatus.Completed              -> "Completed"
    AssignmentStatus.Missed                 -> "Missed"
}

fun assignmentStatusTone(status: AssignmentStatus): StatusTone = when (status) {
    AssignmentStatus.Ready                  -> StatusTone.Info
    AssignmentStatus.InProgress             -> StatusTone.Warning
    AssignmentStatus.WaitingForVerification -> StatusTone.Warning
    AssignmentStatus.Completed              -> StatusTone.Neutral
    AssignmentStatus.Missed                 -> StatusTone.Danger
}


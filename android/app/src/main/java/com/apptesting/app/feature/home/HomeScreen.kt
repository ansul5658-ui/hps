package com.apptesting.app.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.CardGiftcard
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Savings
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.AppIconAvatar
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.ResponsivePane
import com.apptesting.app.core.designsystem.component.SectionHeader
import com.apptesting.app.core.designsystem.component.StatCard
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.designsystem.theme.AppTestingTheme
import com.apptesting.app.core.model.AssignmentStatus
import java.util.Calendar

@Composable
fun HomeScreen(
    viewModel: HomeViewModel = viewModel(),
    onGoToTestApps: () -> Unit = {},
    onGoToMyApps: () -> Unit = {},
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    when (val s = state) {
        HomeUiState.Loading -> LoadingState(caption = "Loading your dashboard…")
        is HomeUiState.Error -> ErrorState(
            title = "Couldn't load your dashboard",
            message = s.message,
        )
        is HomeUiState.Content -> HomeContent(
            state = s,
            onGoToTestApps = onGoToTestApps,
            onGoToMyApps = onGoToMyApps,
        )
    }
}

@Composable
private fun HomeContent(
    state: HomeUiState.Content,
    onGoToTestApps: () -> Unit,
    onGoToMyApps: () -> Unit,
) {
    ResponsivePane {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        item { HeaderBar(displayName = state.displayName, unread = state.unreadNotifications) }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(
                    icon = Icons.Rounded.Savings,
                    label = stringResource(R.string.home_coin_balance),
                    value = state.coinBalance.toString(),
                    accent = MaterialTheme.colorScheme.tertiary,
                    accentContainer = MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    icon = Icons.Rounded.Verified,
                    label = stringResource(R.string.home_trust_score),
                    value = state.trustScore.toString(),
                    trailing = trustBandLabel(state.trustScore),
                    accent = MaterialTheme.colorScheme.secondary,
                    accentContainer = MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(
                    icon = Icons.Rounded.Apps,
                    label = "Apps submitted",
                    value = state.appsSubmitted.toString(),
                    trailing = if (state.appsInReview > 0) "${state.appsInReview} in review" else null,
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    icon = Icons.Rounded.CardGiftcard,
                    label = "Testing tasks",
                    value = state.testingTasks.toString(),
                    trailing = if (state.completedTests > 0) "${state.completedTests} done" else null,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                FilledTonalButton(
                    onClick = onGoToMyApps,
                    modifier = Modifier.weight(1f).height(52.dp),
                    shape = MaterialTheme.shapes.large,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Apps,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Manage my apps")
                }
                OutlinedButton(
                    onClick = onGoToTestApps,
                    modifier = Modifier.weight(1f).height(52.dp),
                    shape = MaterialTheme.shapes.large,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.CardGiftcard,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text("Find tests")
                }
            }
        }

        item {
            SectionHeader(title = stringResource(R.string.home_active_group))
            Spacer(Modifier.height(8.dp))
            ActiveGroupCard(state.currentGroupName, state.currentGroupEmail)
        }

        item {
            SectionHeader(
                title = "Current assignments",
                onSeeAll = if (state.currentAssignments.isNotEmpty()) onGoToTestApps else null,
            )
            Spacer(Modifier.height(8.dp))
        }

        if (state.currentAssignments.isEmpty()) {
            item { EmptyAssignmentsCard(onGoToTestApps = onGoToTestApps) }
        } else {
            items(state.currentAssignments, key = { it.id }) { row ->
                AssignmentPreviewRow(row = row)
            }
        }

        item { Spacer(Modifier.height(24.dp)) }
    }
    }
}

@Composable
private fun HeaderBar(displayName: String, unread: Int) {
    val greeting = greetingForHour(Calendar.getInstance().get(Calendar.HOUR_OF_DAY))
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = stringResource(greeting),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = displayName,
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
        // Softly-tinted circular affordance for the bell — reads as a
        // tappable control at a glance rather than a floating icon.
        BadgedBox(
            badge = {
                if (unread > 0) {
                    Badge {
                        Text(if (unread > 99) "99+" else unread.toString())
                    }
                }
            },
        ) {
            FilledTonalIconButton(
                onClick = { /* TODO(nav): open notifications */ },
                colors = IconButtonDefaults.filledTonalIconButtonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                    contentColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            ) {
                Icon(
                    imageVector = Icons.Rounded.Notifications,
                    contentDescription = stringResource(R.string.home_notifications),
                )
            }
        }
    }
}

@Composable
private fun ActiveGroupCard(name: String?, email: String?) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        if (name == null) {
            Row(
                modifier = Modifier.padding(20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RoundIcon(Icons.Rounded.Groups)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = "You haven't joined a group yet",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = "Groups organize testers and rotations. Discover one from the Groups tab.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            Column(Modifier.padding(20.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    RoundIcon(Icons.Rounded.Groups)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(
                            text = name,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        if (email != null && email.isNotBlank()) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Rounded.Email,
                                    contentDescription = null,
                                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.size(16.dp),
                                )
                                Spacer(Modifier.width(6.dp))
                                Text(
                                    text = email,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                    }
                    StatusPill(text = "Active", tone = StatusTone.Success)
                }
            }
        }
    }
}

@Composable
private fun EmptyAssignmentsCard(onGoToTestApps: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(20.dp)) {
            Text(
                text = "No open assignments",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Pick an app to test and start earning Coins.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            FilledTonalButton(
                onClick = onGoToTestApps,
                shape = MaterialTheme.shapes.large,
            ) {
                Text("Browse test apps")
            }
        }
    }
}

@Composable
private fun AssignmentPreviewRow(row: HomeAssignmentRow) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIconAvatar(seed = row.appId, label = row.appName)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = row.appName,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${row.daysCompleted} of ${row.daysRequired} days · ${row.coinReward} Coins",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(12.dp))
                StatusPill(
                    text = assignmentStatusLabel(row.status),
                    tone = assignmentStatusTone(row.status),
                )
            }
            Spacer(Modifier.height(12.dp))
            LinearProgressIndicator(
                progress = { row.progress.coerceIn(0f, 1f) },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(8.dp),
                strokeCap = ProgressIndicatorDefaults.LinearStrokeCap,
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
private fun RoundIcon(icon: ImageVector) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.primaryContainer,
        modifier = Modifier.size(40.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}

private fun greetingForHour(h: Int): Int = when (h) {
    in 5..11 -> R.string.home_greeting_morning
    in 12..16 -> R.string.home_greeting_afternoon
    in 17..21 -> R.string.home_greeting_evening
    else -> R.string.home_greeting_night
}

private fun trustBandLabel(score: Int): String = when {
    score >= 90 -> "Elite"
    score >= 60 -> "Trusted"
    score >= 30 -> "Developing"
    else -> "New"
}

internal fun assignmentStatusLabel(status: AssignmentStatus): String = when (status) {
    AssignmentStatus.Ready -> "Ready"
    AssignmentStatus.InProgress -> "In progress"
    AssignmentStatus.WaitingForVerification -> "Waiting"
    AssignmentStatus.Completed -> "Completed"
    AssignmentStatus.Missed -> "Missed"
}

internal fun assignmentStatusTone(status: AssignmentStatus): StatusTone = when (status) {
    AssignmentStatus.Ready -> StatusTone.Info
    AssignmentStatus.InProgress -> StatusTone.Success
    AssignmentStatus.WaitingForVerification -> StatusTone.Warning
    AssignmentStatus.Completed -> StatusTone.Neutral
    AssignmentStatus.Missed -> StatusTone.Danger
}

@Preview(name = "Home – content", showBackground = true)
@Composable
private fun HomeContentPreview() {
    AppTestingTheme {
        HomeContent(
            state = HomeUiState.Content(
                displayName = "Developer",
                coinBalance = 240,
                trustScore = 72,
                appsSubmitted = 2,
                appsInReview = 1,
                testingTasks = 3,
                completedTests = 6,
                currentGroupName = "AppTesting Beta Group",
                currentGroupEmail = "apptesting-beta@googlegroups.com",
                currentAssignments = listOf(
                    HomeAssignmentRow(
                        id = "a1", appId = "app_bytereader", appName = "ByteReader",
                        status = AssignmentStatus.InProgress,
                        daysCompleted = 7, daysRequired = 14, coinReward = 50,
                    ),
                ),
                unreadNotifications = 2,
            ),
            onGoToTestApps = {},
            onGoToMyApps = {},
        )
    }
}

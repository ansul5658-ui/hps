package com.apptesting.app.feature.testapps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CardGiftcard
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.PlayArrow
import androidx.compose.material.icons.rounded.Savings
import androidx.compose.material.icons.rounded.Timelapse
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.ui.text.style.TextOverflow
import com.apptesting.app.core.designsystem.component.AppIconAvatar
import com.apptesting.app.core.designsystem.component.EmptyState
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.ScreenHeader
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.model.AssignmentStatus
import com.apptesting.app.feature.home.assignmentStatusLabel
import com.apptesting.app.feature.home.assignmentStatusTone

@Composable
fun TestAppsScreen(
    viewModel: TestAppsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            if (event is TestAppsEvent.Message) snackbar.showSnackbar(event.text)
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
    ) { inner ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(inner)
                .background(MaterialTheme.colorScheme.background)
                .padding(PaddingValues(horizontal = 20.dp, vertical = 16.dp)),
        ) {
            ScreenHeader(
                title = stringResource(R.string.nav_test_apps),
                subtitle = "Apps from the community that need testers.",
            )
            Spacer(Modifier.height(16.dp))
            FilterRow(
                selected = (state as? TestAppsUiState.Content)?.filter ?: TestFilter.All,
                onSelected = viewModel::setFilter,
            )
            Spacer(Modifier.height(16.dp))
            when (val s = state) {
                TestAppsUiState.Loading -> LoadingState()
                is TestAppsUiState.Error -> ErrorState(
                    title = "Couldn't load apps",
                    message = s.message,
                )
                is TestAppsUiState.Content -> {
                    if (s.rows.isEmpty()) {
                        EmptyState(
                            icon = Icons.Rounded.CardGiftcard,
                            title = when (s.filter) {
                                TestFilter.InProgress -> "No tests in progress"
                                TestFilter.Available -> "Nothing new to test right now"
                                TestFilter.All -> "No apps available"
                            },
                            body = "Check back soon — new apps are added regularly.",
                        )
                    } else {
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                            contentPadding = PaddingValues(bottom = 24.dp),
                        ) {
                            items(s.rows, key = { it.appId }) { row ->
                                TestAppCard(
                                    row = row,
                                    onCheckIn = { row.assignmentId?.let(viewModel::onCheckIn) },
                                    onMarkComplete = { row.assignmentId?.let(viewModel::onMarkComplete) },
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FilterRow(
    selected: TestFilter,
    onSelected: (TestFilter) -> Unit,
) {
    // Horizontal scroll keeps every chip reachable on narrow screens
    // without introducing a foundation FlowRow dependency.
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        TestFilter.entries.forEach { filter ->
            FilterChip(
                selected = selected == filter,
                onClick = { onSelected(filter) },
                label = { Text(filterLabel(filter)) },
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                ),
            )
        }
    }
}

private fun filterLabel(f: TestFilter): String = when (f) {
    TestFilter.All -> "All"
    TestFilter.InProgress -> "In progress"
    TestFilter.Available -> "Available"
}

@Composable
private fun TestAppCard(
    row: TestRow,
    onCheckIn: () -> Unit,
    onMarkComplete: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIconAvatar(seed = row.appId, label = row.appName, size = 52.dp)
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
                        text = "${row.developerLabel} · ${row.packageName}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                if (row.status != null) {
                    Spacer(Modifier.width(12.dp))
                    StatusPill(
                        text = assignmentStatusLabel(row.status),
                        tone = assignmentStatusTone(row.status),
                    )
                }
            }

            Spacer(Modifier.height(14.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                RewardChip(coins = row.coinReward)
                Spacer(Modifier.width(8.dp))
                RequirementChip(days = row.daysRequired)
            }

            if (row.status != null) {
                Spacer(Modifier.height(14.dp))
                Text(
                    text = "${row.daysCompleted} of ${row.daysRequired} days",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
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

            Spacer(Modifier.height(16.dp))
            ActionRow(
                status = row.status,
                loggedToday = row.loggedToday,
                canMarkComplete = row.assignmentId != null &&
                    row.status == AssignmentStatus.InProgress &&
                    row.daysCompleted >= row.daysRequired,
                onCheckIn = onCheckIn,
                onMarkComplete = onMarkComplete,
            )
        }
    }
}

@Composable
private fun RewardChip(coins: Int) {
    StatusPill(text = "$coins Coins", tone = StatusTone.Info)
}

@Composable
private fun RequirementChip(days: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(
            imageVector = Icons.Rounded.Timelapse,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(16.dp),
        )
        Spacer(Modifier.width(6.dp))
        Text(
            text = "$days days",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ActionRow(
    status: AssignmentStatus?,
    loggedToday: Boolean,
    canMarkComplete: Boolean,
    onCheckIn: () -> Unit,
    onMarkComplete: () -> Unit,
) {
    when (status) {
        null -> {
            OutlinedButton(
                onClick = { /* TODO(join): route to Groups tab so the user can join to receive assignment */ },
                modifier = Modifier.fillMaxWidth().height(48.dp),
                shape = MaterialTheme.shapes.large,
            ) {
                Icon(
                    imageVector = Icons.Rounded.PlayArrow,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text("Join to test")
            }
        }

        AssignmentStatus.Ready, AssignmentStatus.InProgress -> {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilledTonalButton(
                    onClick = onCheckIn,
                    enabled = !loggedToday,
                    modifier = Modifier.weight(1f).height(48.dp),
                    shape = MaterialTheme.shapes.large,
                ) {
                    if (loggedToday) {
                        Icon(
                            imageVector = Icons.Rounded.Check,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(Modifier.width(6.dp))
                        Text("Logged today")
                    } else {
                        Text("Log today")
                    }
                }
                Button(
                    onClick = onMarkComplete,
                    enabled = canMarkComplete,
                    modifier = Modifier.weight(1f).height(48.dp),
                    shape = MaterialTheme.shapes.large,
                ) {
                    Text("Mark complete")
                }
            }
        }

        AssignmentStatus.WaitingForVerification -> {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Savings,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.tertiary,
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = "Coins will be awarded when an admin verifies completion.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        AssignmentStatus.Completed -> {
            Text(
                text = "Completed — thank you for testing this app.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        AssignmentStatus.Missed -> {
            Text(
                text = "This assignment expired without completion.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
            )
        }
    }
}

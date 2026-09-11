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
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.CardGiftcard
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.EmojiEvents
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Savings
import androidx.compose.material.icons.rounded.Verified
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.ProgressCard
import com.apptesting.app.core.designsystem.component.SectionHeader
import com.apptesting.app.core.designsystem.component.StatCard
import com.apptesting.app.core.designsystem.theme.AppTestingTheme
import java.util.Calendar

@Composable
fun HomeScreen(
    viewModel: HomeViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    HomeContent(state = state)
}

@Composable
private fun HomeContent(state: HomeUiState) {
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
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
                    value = state.coinBalance?.toString() ?: "—",
                    accent = MaterialTheme.colorScheme.tertiary,
                    accentContainer = MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    icon = Icons.Rounded.Verified,
                    label = stringResource(R.string.home_trust_score),
                    value = state.trustScore?.toString() ?: "—",
                    trailing = state.trustBand?.name,
                    accent = MaterialTheme.colorScheme.secondary,
                    accentContainer = MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            ProgressCard(
                title = stringResource(R.string.home_today_progress),
                subtitle = if (state.todayTarget == 0) {
                    "No assignments queued for today."
                } else {
                    "${state.todayCompleted} of ${state.todayTarget} completed today"
                },
                progress = state.todayProgress,
            )
        }

        item {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                StatCard(
                    icon = Icons.Rounded.CardGiftcard,
                    label = stringResource(R.string.home_assignments_remaining),
                    value = state.assignmentsRemaining.toString(),
                    modifier = Modifier.weight(1f),
                )
                StatCard(
                    icon = Icons.Rounded.Apps,
                    label = stringResource(R.string.home_my_apps_summary),
                    value = state.myAppsCount.toString(),
                    trailing = if (state.myAppsInReview > 0) "${state.myAppsInReview} in review" else null,
                    modifier = Modifier.weight(1f),
                )
            }
        }

        item {
            SectionHeader(title = stringResource(R.string.home_active_group))
            Spacer(Modifier.height(8.dp))
            ActiveGroupCard(state.activeGroup)
        }

        item {
            SectionHeader(title = stringResource(R.string.home_recent_activity))
            Spacer(Modifier.height(8.dp))
        }

        if (state.recentActivity.isEmpty()) {
            item { RecentActivityEmpty() }
        } else {
            items(state.recentActivity, key = { it.id }) { item ->
                ActivityRow(item)
            }
        }

        item { Spacer(Modifier.height(24.dp)) }
    }
}

@Composable
private fun HeaderBar(displayName: String?, unread: Int) {
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
                text = displayName ?: "Welcome",
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
        }
        BadgedBox(
            badge = {
                if (unread > 0) {
                    Badge {
                        Text(if (unread > 99) "99+" else unread.toString())
                    }
                }
            },
        ) {
            IconButton(onClick = { /* TODO(nav): open notifications */ }) {
                Icon(
                    imageVector = Icons.Rounded.Notifications,
                    contentDescription = stringResource(R.string.home_notifications),
                    tint = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun ActiveGroupCard(group: ActiveGroupSummary?) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        if (group == null) {
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
                    Spacer(Modifier.height(2.dp))
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
                            text = group.name,
                            style = MaterialTheme.typography.titleMedium,
                            color = MaterialTheme.colorScheme.onSurface,
                        )
                        Text(
                            text = "${group.memberCount} members",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        text = "${group.progressPercent}%",
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Spacer(Modifier.height(12.dp))
                LinearProgressIndicator(
                    progress = { group.progressPercent / 100f },
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
}

@Composable
private fun RecentActivityEmpty() {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier.padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoundIcon(Icons.Rounded.Bolt)
            Spacer(Modifier.width(14.dp))
            Column {
                Text(
                    text = "Nothing here yet",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = "Your recent testing activity will appear here.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun ActivityRow(item: ActivityItem) {
    val icon = when (item.kind) {
        ActivityKind.AssignmentCompleted -> Icons.Rounded.CheckCircle
        ActivityKind.CoinsEarned -> Icons.Rounded.Savings
        ActivityKind.AppApproved -> Icons.Rounded.Verified
        ActivityKind.JoinedGroup -> Icons.Rounded.Groups
        ActivityKind.Announcement -> Icons.Rounded.EmojiEvents
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier.padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoundIcon(icon)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = item.title,
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = item.subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
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

@Preview(name = "Home – light", showBackground = true)
@Composable
private fun HomeContentPreviewLight() {
    AppTestingTheme(darkTheme = false) {
        HomeContent(state = HomeUiState(isLoading = false, displayName = "Ansul"))
    }
}

@Preview(name = "Home – dark", showBackground = true)
@Composable
private fun HomeContentPreviewDark() {
    AppTestingTheme(darkTheme = true) {
        HomeContent(state = HomeUiState(isLoading = false, displayName = "Ansul"))
    }
}

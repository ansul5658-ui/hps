package com.apptesting.app.feature.testapps

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.material.icons.rounded.CardGiftcard
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Clear
import androidx.compose.material.icons.rounded.Lock
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Savings
import androidx.compose.material.icons.rounded.Schedule
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material.icons.rounded.SearchOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.AppIconAvatar
import com.apptesting.app.core.designsystem.component.EmptyState
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.ScreenContainer
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.model.AssignmentStatus

/**
 * The Apps screen — two clearly separated discovery surfaces.
 *
 *   1. **Quick Tests** — free, one session, no coin commitment.
 *   2. **Testing Assignments** — structured multi-day commitments.
 *
 * The separation is the point. A user must never be unsure which one they are
 * about to enter, so the two sections differ in header, icon, colour, body
 * copy and call to action ("Try Now" vs "View assignment").
 *
 * WHAT THIS SCREEN DELIBERATELY DOES NOT SAY
 *   * Quick Tests never mention coins — not a cost, not a reward. They have
 *     neither, and any number shown next to one would be a false claim.
 *   * Testing Assignments do not display a 50-coin lock either. Committing
 *     coins is a later batch; until the wallet exists, showing a lock would
 *     describe behaviour the app does not have.
 *   * Nothing anywhere says a user "earns" coins. The old completion-reward
 *     model is obsolete under the commitment product, so that copy is gone.
 */
@Composable
fun TestAppsScreen(
    viewModel: TestAppsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    var searchQuery by remember { mutableStateOf("") }

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            when (event) {
                is TestAppsEvent.Message -> snackbar.showSnackbar(event.text)
                is TestAppsEvent.QuickTestStarted -> snackbar.showSnackbar(
                    if (event.remainingToday > 0) {
                        "Quick Test started — ${event.remainingToday} left today."
                    } else {
                        "Quick Test started — that's your last one today."
                    },
                )
            }
        }
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            AppsTopBar(
                coinBalance = (state as? TestAppsUiState.Content)?.coinBalance,
                unreadCount = (state as? TestAppsUiState.Content)?.unreadNotifications ?: 0,
            )
        },
    ) { inner ->
        ScreenContainer(modifier = Modifier.padding(inner)) {
            when (val s = state) {
                TestAppsUiState.Loading -> TestAppsSkeletonLoading()
                is TestAppsUiState.Error -> ErrorState(
                    title = "Couldn't load testing apps",
                    message = s.message,
                )
                is TestAppsUiState.Content -> AppsContent(
                    state = s,
                    searchQuery = searchQuery,
                    onSearchChange = { searchQuery = it },
                    onFilterChange = viewModel::setFilter,
                    onStartQuickTest = viewModel::onStartQuickTest,
                    onCheckIn = viewModel::onCheckIn,
                    onMarkComplete = viewModel::onMarkComplete,
                )
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

@Composable
private fun AppsTopBar(coinBalance: Int?, unreadCount: Int) {
    TopAppBar(
        title = { Text("Apps", fontWeight = FontWeight.Bold) },
        actions = {
            if (coinBalance != null) {
                TestingCoinChip(balance = coinBalance)
                Spacer(Modifier.width(4.dp))
            }
            BadgedBox(
                badge = {
                    if (unreadCount > 0) {
                        Badge { Text(if (unreadCount > 9) "9+" else "$unreadCount") }
                    }
                },
            ) {
                IconButton(onClick = { /* Notifications inbox lands with FCM. */ }) {
                    Icon(
                        imageVector = Icons.Rounded.Notifications,
                        contentDescription = "Notifications",
                    )
                }
            }
        },
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.background,
        ),
    )
}

/**
 * Read-only Testing Coin balance.
 *
 * A single total, with no Available/Locked split and no call to action,
 * because the wallet that would give those meaning is a later batch. Showing
 * one number the user already has is honest; inventing a breakdown is not.
 */
@Composable
private fun TestingCoinChip(balance: Int) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.tertiaryContainer,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Rounded.Savings,
                contentDescription = "Testing Coin balance",
                tint = MaterialTheme.colorScheme.onTertiaryContainer,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = "$balance",
                style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onTertiaryContainer,
            )
        }
    }
}

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

@Composable
private fun AppsContent(
    state: TestAppsUiState.Content,
    searchQuery: String,
    onSearchChange: (String) -> Unit,
    onFilterChange: (TestFilter) -> Unit,
    onStartQuickTest: (String) -> Unit,
    onCheckIn: (String) -> Unit,
    onMarkComplete: (String) -> Unit,
) {
    val filteredRows = remember(state.rows, searchQuery) {
        if (searchQuery.isBlank()) {
            state.rows
        } else {
            state.rows.filter { row ->
                row.appName.contains(searchQuery, ignoreCase = true) ||
                    row.packageName.contains(searchQuery, ignoreCase = true) ||
                    row.developerLabel.contains(searchQuery, ignoreCase = true)
            }
        }
    }

    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = PaddingValues(bottom = 32.dp),
    ) {
        // ---- Section 1: Quick Tests -------------------------------------
        item(key = "quickTestsHeader") {
            SectionHeading(
                icon = Icons.Rounded.Bolt,
                title = "Quick Tests",
                // The one line that has to land: free, and nothing is spent.
                subtitle = "Try apps without spending Testing Coins.",
                tint = MaterialTheme.colorScheme.tertiary,
                trailing = if (state.quickTestDailyLimit > 0) {
                    "${state.quickTestsRemainingToday} of ${state.quickTestDailyLimit} left today"
                } else {
                    null
                },
            )
        }

        if (state.quickTests.isEmpty()) {
            item(key = "quickTestsEmpty") {
                EmptyState(
                    icon = Icons.Rounded.Bolt,
                    title = if (state.hasQuickTestQuota) {
                        "No Quick Tests available right now"
                    } else {
                        "You've used today's Quick Tests"
                    },
                    body = if (state.hasQuickTestQuota) {
                        "Check back soon — the list refreshes as developers join."
                    } else {
                        "Your ${state.quickTestDailyLimit} daily Quick Tests reset tomorrow."
                    },
                )
            }
        } else {
            items(state.quickTests, key = { "qt_" + it.appId }) { candidate ->
                QuickTestCard(
                    candidate = candidate,
                    enabled = state.hasQuickTestQuota,
                    onTryNow = { onStartQuickTest(candidate.appId) },
                )
            }
        }

        // ---- Section 2: Testing Assignments -----------------------------
        item(key = "assignmentsHeader") {
            Spacer(Modifier.height(12.dp))
            SectionHeading(
                icon = Icons.Rounded.Lock,
                title = "Testing Assignments",
                subtitle = "Structured multi-day testing with a daily check-in.",
                tint = MaterialTheme.colorScheme.primary,
                trailing = null,
            )
        }

        item(key = "assignmentsControls") {
            Column {
                SearchBar(query = searchQuery, onQueryChange = onSearchChange)
                Spacer(Modifier.height(10.dp))
                FilterRow(selected = state.filter, onSelected = onFilterChange)
            }
        }

        if (filteredRows.isEmpty()) {
            item(key = "assignmentsEmpty") {
                EmptyState(
                    icon = if (searchQuery.isNotBlank()) {
                        Icons.Rounded.SearchOff
                    } else {
                        Icons.Rounded.CardGiftcard
                    },
                    title = when {
                        searchQuery.isNotBlank() -> "No apps match \"$searchQuery\""
                        state.filter == TestFilter.InProgress -> "No tests in progress"
                        state.filter == TestFilter.Available -> "Nothing new to test right now"
                        else -> "No apps available for testing"
                    },
                    body = if (searchQuery.isNotBlank()) {
                        "Try searching for a different app name or package."
                    } else {
                        "Check back soon — developers submit new apps regularly."
                    },
                )
            }
        } else {
            items(filteredRows, key = { "ta_" + it.appId }) { row ->
                TestAppCard(
                    row = row,
                    onCheckIn = { row.assignmentId?.let(onCheckIn) },
                    onMarkComplete = { row.assignmentId?.let(onMarkComplete) },
                )
            }
        }
    }
}

@Composable
private fun SectionHeading(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    title: String,
    subtitle: String,
    tint: androidx.compose.ui.graphics.Color,
    trailing: String?,
) {
    Column(Modifier.padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = tint,
                modifier = Modifier.size(22.dp),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.weight(1f),
            )
            if (trailing != null) {
                Text(
                    text = trailing,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Spacer(Modifier.height(2.dp))
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

// ---------------------------------------------------------------------------
// Quick Test card
// ---------------------------------------------------------------------------

@Composable
private fun QuickTestCard(
    candidate: QuickTestCandidate,
    enabled: Boolean,
    onTryNow: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIconAvatar(seed = candidate.appId, label = candidate.appName, size = 48.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = candidate.appName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = candidate.developerLabel,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(8.dp))
                // The label that separates this card from an assignment card.
                // No coin amount appears anywhere on it, because there is none.
                StatusPill(text = "Quick Test", tone = StatusTone.Info)
            }

            if (candidate.description != null) {
                Spacer(Modifier.height(10.dp))
                Text(
                    text = candidate.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
            }

            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = "No coin commitment",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.tertiary,
                    modifier = Modifier.weight(1f),
                )
                FilledTonalButton(
                    onClick = onTryNow,
                    enabled = enabled,
                    shape = MaterialTheme.shapes.large,
                    modifier = Modifier.height(44.dp),
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Bolt,
                        contentDescription = null,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text("Try Now", fontWeight = FontWeight.Bold)
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Search + filters (Testing Assignments only)
// ---------------------------------------------------------------------------

@Composable
private fun SearchBar(
    query: String,
    onQueryChange: (String) -> Unit,
) {
    OutlinedTextField(
        value = query,
        onValueChange = onQueryChange,
        placeholder = { Text("Search by app name or package…") },
        leadingIcon = {
            Icon(
                imageVector = Icons.Rounded.Search,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        },
        trailingIcon = {
            if (query.isNotEmpty()) {
                IconButton(onClick = { onQueryChange("") }) {
                    Icon(
                        imageVector = Icons.Rounded.Clear,
                        contentDescription = "Clear search",
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        singleLine = true,
        shape = MaterialTheme.shapes.large,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = MaterialTheme.colorScheme.primary,
            unfocusedBorderColor = MaterialTheme.colorScheme.outlineVariant,
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
        ),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun FilterRow(
    selected: TestFilter,
    onSelected: (TestFilter) -> Unit,
) {
    Row(
        modifier = Modifier.horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        TestFilter.entries.forEach { filter ->
            val isSelected = selected == filter
            FilterChip(
                selected = isSelected,
                onClick = { onSelected(filter) },
                label = { Text(filterLabel(filter)) },
                shape = CircleShape,
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = MaterialTheme.colorScheme.primaryContainer,
                    selectedLabelColor = MaterialTheme.colorScheme.onPrimaryContainer,
                    containerColor = MaterialTheme.colorScheme.surface,
                    labelColor = MaterialTheme.colorScheme.onSurfaceVariant,
                ),
            )
        }
    }
}

private fun filterLabel(f: TestFilter): String = when (f) {
    TestFilter.All -> "All Apps"
    TestFilter.InProgress -> "In Progress"
    TestFilter.Available -> "Available to Test"
}

// ---------------------------------------------------------------------------
// Testing Assignment card
// ---------------------------------------------------------------------------

@Composable
private fun TestAppCard(
    row: TestRow,
    onCheckIn: () -> Unit,
    onMarkComplete: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .animateContentSize(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(20.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIconAvatar(seed = row.appId, label = row.appName, size = 56.dp)
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = row.appName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Spacer(Modifier.height(2.dp))
                    Text(
                        text = "${row.developerLabel} · ${row.packageName}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(8.dp))
                val (pillLabel, tone) = when (row.status) {
                    null -> "Available" to StatusTone.Info
                    AssignmentStatus.Ready -> "Ready" to StatusTone.Info
                    AssignmentStatus.InProgress -> "Testing" to StatusTone.Success
                    AssignmentStatus.WaitingForVerification -> "Verification" to StatusTone.Warning
                    AssignmentStatus.Completed -> "Completed" to StatusTone.Success
                    AssignmentStatus.Missed -> "Expired" to StatusTone.Danger
                }
                StatusPill(text = pillLabel, tone = tone)
            }

            Spacer(Modifier.height(16.dp))

            // Commitment shape only — days and cadence. No coin amount: the
            // old "+50 Coins" reward is obsolete under the commitment product,
            // and the new 50-coin lock does not exist yet. Stating either
            // would describe behaviour this build does not have.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                DurationBadge(days = row.daysRequired)
                CadenceBadge()
            }

            if (row.status != null) {
                Spacer(Modifier.height(16.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = "Progress: ${row.daysCompleted} of ${row.daysRequired} days",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = "${(row.progress * 100).toInt()}%",
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Spacer(Modifier.height(8.dp))
                LinearProgressIndicator(
                    progress = { row.progress.coerceIn(0f, 1f) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(CircleShape),
                    strokeCap = ProgressIndicatorDefaults.LinearStrokeCap,
                    trackColor = MaterialTheme.colorScheme.surfaceVariant,
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            Spacer(Modifier.height(20.dp))

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
private fun DurationBadge(days: Int) {
    MetaBadge(icon = Icons.Rounded.Schedule, text = "$days days testing")
}

@Composable
private fun CadenceBadge() {
    MetaBadge(icon = Icons.Rounded.Check, text = "1 check-in/day")
}

@Composable
private fun MetaBadge(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    text: String,
) {
    Surface(
        shape = CircleShape,
        color = MaterialTheme.colorScheme.surfaceVariant,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(16.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(
                text = text,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
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
        // No assignment exists for this app yet. Testers are still matched by
        // the backend in this build — self-service joining and coin locking
        // are a later batch — so there is nothing for the tester to press.
        // Say so plainly rather than offering a button that does nothing.
        null -> {
            OutlinedButton(
                onClick = {},
                enabled = false,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = MaterialTheme.shapes.large,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Schedule,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text("Awaiting assignment", fontWeight = FontWeight.Bold)
            }
        }

        AssignmentStatus.Ready, AssignmentStatus.InProgress -> {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                FilledTonalButton(
                    onClick = onCheckIn,
                    enabled = !loggedToday,
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
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
                    modifier = Modifier
                        .weight(1f)
                        .height(48.dp),
                    shape = MaterialTheme.shapes.large,
                ) {
                    Text("Complete", fontWeight = FontWeight.Bold)
                }
            }
        }

        AssignmentStatus.WaitingForVerification -> {
            InfoPanel(
                text = "Verification pending — an admin will confirm your testing days.",
                container = MaterialTheme.colorScheme.primaryContainer,
                content = MaterialTheme.colorScheme.onPrimaryContainer,
            )
        }

        AssignmentStatus.Completed -> {
            InfoPanel(
                text = "Completed — thank you for participating in testing!",
                container = MaterialTheme.colorScheme.surfaceVariant,
                content = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        AssignmentStatus.Missed -> {
            InfoPanel(
                text = "This testing assignment expired without completion.",
                container = MaterialTheme.colorScheme.errorContainer,
                content = MaterialTheme.colorScheme.onErrorContainer,
            )
        }
    }
}

@Composable
private fun InfoPanel(
    text: String,
    container: androidx.compose.ui.graphics.Color,
    content: androidx.compose.ui.graphics.Color,
) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = container,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = content,
            modifier = Modifier.padding(14.dp),
        )
    }
}

@Composable
private fun TestAppsSkeletonLoading() {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        repeat(3) {
            Card(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(140.dp),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(20.dp),
                ) {
                    Row {
                        Box(
                            modifier = Modifier
                                .size(56.dp)
                                .clip(MaterialTheme.shapes.medium)
                                .background(MaterialTheme.colorScheme.surfaceVariant),
                        )
                        Spacer(Modifier.width(16.dp))
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Box(
                                modifier = Modifier
                                    .size(width = 160.dp, height = 20.dp)
                                    .clip(MaterialTheme.shapes.small)
                                    .background(MaterialTheme.colorScheme.surfaceVariant),
                            )
                            Box(
                                modifier = Modifier
                                    .size(width = 220.dp, height = 14.dp)
                                    .clip(MaterialTheme.shapes.small)
                                    .background(MaterialTheme.colorScheme.surfaceVariant),
                            )
                        }
                    }
                }
            }
        }
    }
}

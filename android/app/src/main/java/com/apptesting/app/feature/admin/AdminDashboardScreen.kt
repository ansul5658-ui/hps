package com.apptesting.app.feature.admin

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.core.designsystem.component.*
import com.apptesting.app.core.model.AppApprovalStatus
import com.apptesting.app.core.model.AppSubmission
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.TestAssignment
import com.apptesting.app.core.model.User
import com.apptesting.app.core.model.UserRole
import com.apptesting.app.core.util.AppConfig
import com.apptesting.app.feature.home.assignmentStatusLabel
import com.apptesting.app.feature.home.assignmentStatusTone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AdminDashboardScreen(
    onBack: () -> Unit,
    viewModel: AdminDashboardViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            if (event is AdminEvent.Message) snackbar.showSnackbar(event.text)
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.primaryContainer,
                            modifier = Modifier.size(32.dp),
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Rounded.AdminPanelSettings, null,
                                    tint = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.size(18.dp))
                            }
                        }
                        Text("Admin Dashboard", fontWeight = FontWeight.Bold)
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, "Back")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { inner ->
        when (val s = state) {
            AdminUiState.Loading     -> LoadingState(caption = "Loading admin data…", modifier = Modifier.padding(inner))
            AdminUiState.AccessDenied -> AccessDeniedPane(modifier = Modifier.padding(inner))
            is AdminUiState.Error    -> ErrorState(title = "Failed to load", message = s.message, modifier = Modifier.padding(inner))
            is AdminUiState.Content  -> AdminContent(s, viewModel, Modifier.padding(inner))
        }
    }
}

@Composable
private fun AccessDeniedPane(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(shape = CircleShape, color = MaterialTheme.colorScheme.errorContainer, modifier = Modifier.size(72.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Block, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(36.dp))
                }
            }
            Text("Access Denied", style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text("Admin role required", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun AdminContent(
    state: AdminUiState.Content,
    viewModel: AdminDashboardViewModel,
    modifier: Modifier = Modifier,
) {
    var selectedTab by remember { mutableIntStateOf(0) }
    val tabs = listOf("Overview", "Users", "Apps", "Assignments", "Group")

    Column(modifier.fillMaxSize()) {
        ScrollableTabRow(
            selectedTabIndex = selectedTab,
            containerColor = MaterialTheme.colorScheme.surface,
            contentColor = MaterialTheme.colorScheme.primary,
            edgePadding = 16.dp,
        ) {
            tabs.forEachIndexed { i, title ->
                Tab(
                    selected = selectedTab == i,
                    onClick = { selectedTab = i },
                    text = {
                        Text(
                            title,
                            fontWeight = if (selectedTab == i) FontWeight.SemiBold else FontWeight.Normal,
                        )
                    },
                )
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        when (selectedTab) {
            0 -> OverviewTab(state)
            1 -> UsersTab(state.usersList, viewModel)
            2 -> AppsTab(state.appsList, viewModel)
            3 -> AssignmentsTab(state.assignmentsList)
            4 -> OfficialGroupTab(state, viewModel)
        }
    }
}

// ─── OVERVIEW ────────────────────────────────────────────────────────────────

@Composable
private fun OverviewTab(state: AdminUiState.Content) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            // Hero gradient banner
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        Brush.horizontalGradient(
                            listOf(
                                MaterialTheme.colorScheme.primaryContainer,
                                MaterialTheme.colorScheme.secondaryContainer,
                            )
                        ),
                        shape = MaterialTheme.shapes.extraLarge,
                    )
                    .padding(20.dp),
            ) {
                Column {
                    Text("Platform at a Glance", style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Text("Live data from Firestore", style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f))
                }
            }
        }

        item {
            Text("Community", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp))
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AdminStatCard(Icons.Rounded.People, "Total Users", state.totalUsers.toString(),
                    MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.weight(1f))
                AdminStatCard(Icons.Rounded.Groups, "Group Members", state.officialGroupMemberCount.toString(),
                    MaterialTheme.colorScheme.secondary, MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.weight(1f))
            }
        }

        item {
            Text("Testing", style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 4.dp))
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AdminStatCard(Icons.Rounded.Apps, "Total Apps", state.totalApps.toString(),
                    MaterialTheme.colorScheme.tertiary, MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier.weight(1f))
                AdminStatCard(Icons.Rounded.Task, "Active Apps", state.activeTestingApps.toString(),
                    MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.primaryContainer,
                    modifier = Modifier.weight(1f))
            }
        }
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                AdminStatCard(Icons.Rounded.Person, "Active Testers", state.activeTestersCount.toString(),
                    MaterialTheme.colorScheme.secondary, MaterialTheme.colorScheme.secondaryContainer,
                    modifier = Modifier.weight(1f))
                AdminStatCard(Icons.Rounded.CheckCircle, "Tests Done", state.completedTests.toString(),
                    MaterialTheme.colorScheme.tertiary, MaterialTheme.colorScheme.tertiaryContainer,
                    modifier = Modifier.weight(1f))
            }
        }

        // Pending reviews alert
        val pending = state.appsList.count { it.approvalStatus == AppApprovalStatus.PendingReview }
        if (pending > 0) {
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.large,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer.copy(alpha = 0.5f)),
                ) {
                    Row(
                        modifier = Modifier.padding(16.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Icon(Icons.Rounded.Notifications, null,
                            tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(24.dp))
                        Column {
                            Text("$pending App${if (pending > 1) "s" else ""} Pending Review",
                                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                                color = MaterialTheme.colorScheme.onErrorContainer)
                            Text("Switch to Apps tab to review",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onErrorContainer.copy(alpha = 0.7f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun AdminStatCard(
    icon: ImageVector, label: String, value: String,
    accent: Color, accentContainer: Color,
    modifier: Modifier = Modifier,
) {
    Card(
        modifier = modifier,
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Column(Modifier.padding(14.dp)) {
            Surface(shape = CircleShape, color = accentContainer, modifier = Modifier.size(36.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, null, tint = accent, modifier = Modifier.size(18.dp))
                }
            }
            Spacer(Modifier.height(10.dp))
            Text(value, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// ─── USERS ───────────────────────────────────────────────────────────────────

@Composable
private fun UsersTab(users: List<User>, viewModel: AdminDashboardViewModel) {
    var searchQuery by remember { mutableStateOf("") }
    var confirmUser by remember { mutableStateOf<User?>(null) }

    val filtered = remember(users, searchQuery) {
        if (searchQuery.isBlank()) users
        else users.filter {
            it.displayName.contains(searchQuery, ignoreCase = true) ||
                    it.email.contains(searchQuery, ignoreCase = true) ||
                    it.id.contains(searchQuery, ignoreCase = true)
        }
    }

    confirmUser?.let { u ->
        AlertDialog(
            onDismissRequest = { confirmUser = null },
            shape = MaterialTheme.shapes.extraLarge,
            title = { Text(if (u.isSuspended) "Unsuspend user?" else "Suspend user?", fontWeight = FontWeight.Bold) },
            text = {
                Text(
                    if (u.isSuspended) "Restore account access for ${u.displayName.ifBlank { u.email }}?"
                    else "Suspend ${u.displayName.ifBlank { u.email }}? They won't be able to submit or test apps.",
                )
            },
            confirmButton = {
                Button(
                    onClick = { viewModel.toggleUserSuspension(u.id, u.isSuspended); confirmUser = null },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (u.isSuspended) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    ),
                ) { Text(if (u.isSuspended) "Unsuspend" else "Suspend") }
            },
            dismissButton = {
                OutlinedButton(onClick = { confirmUser = null }) { Text("Cancel") }
            },
        )
    }

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        OutlinedTextField(
            value = searchQuery,
            onValueChange = { searchQuery = it },
            placeholder = { Text("Search by name, email or UID…") },
            leadingIcon = { Icon(Icons.Rounded.Search, null) },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            shape = MaterialTheme.shapes.large,
        )
        Spacer(Modifier.height(12.dp))
        Text("${filtered.size} users", style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp))
        Spacer(Modifier.height(8.dp))

        LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            items(filtered, key = { it.id }) { user ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.large,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    elevation = CardDefaults.cardElevation(0.dp),
                ) {
                    Row(Modifier.padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        // Avatar
                        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer,
                            modifier = Modifier.size(46.dp)) {
                            Box(contentAlignment = Alignment.Center) {
                                Text(
                                    user.displayName.firstOrNull()?.uppercase() ?: "?",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.Bold,
                                    color = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                            }
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(Modifier.weight(1f)) {
                            Text(user.displayName.ifBlank { "Developer" },
                                style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                                maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Text(user.email.ifBlank { "No email" },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1,
                                overflow = TextOverflow.Ellipsis)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 3.dp)) {
                                // Reward-era `users/{uid}.coinBalance`, labelled
                                // as legacy so the console does not present it
                                // as the Testing Coin wallet. The real wallet
                                // lives at users/{uid}/wallet/balance and is
                                // read per user, which this roster does not do.
                                Text("legacy ${user.coinBalance}", style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                                Text("🛡 ${user.trustScore}", style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        Spacer(Modifier.width(8.dp))
                        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            when {
                                user.role == UserRole.Admin -> StatusPill("Admin", StatusTone.Info)
                                user.isSuspended            -> StatusPill("Suspended", StatusTone.Danger)
                                else                        -> StatusPill("Active", StatusTone.Success)
                            }
                            if (user.role != UserRole.Admin) {
                                OutlinedButton(
                                    onClick = { confirmUser = user },
                                    modifier = Modifier.height(32.dp),
                                    contentPadding = PaddingValues(horizontal = 10.dp),
                                ) {
                                    Text(
                                        if (user.isSuspended) "Unsuspend" else "Suspend",
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

// ─── APPS ────────────────────────────────────────────────────────────────────

@Composable
private fun AppsTab(apps: List<AppSubmission>, viewModel: AdminDashboardViewModel) {
    val pending  = apps.filter { it.approvalStatus == AppApprovalStatus.PendingReview }
    val approved = apps.filter { it.approvalStatus == AppApprovalStatus.Approved }
    val others   = apps.filter { it.approvalStatus != AppApprovalStatus.PendingReview && it.approvalStatus != AppApprovalStatus.Approved }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (pending.isNotEmpty()) {
            item {
                Text("Pending Review (${pending.size})",
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp))
            }
            items(pending, key = { "p_${it.id}" }) { app -> AppCard(app, viewModel) }
        }
        if (approved.isNotEmpty()) {
            item {
                Text("Active (${approved.size})",
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp))
            }
            items(approved, key = { "a_${it.id}" }) { app -> AppCard(app, viewModel) }
        }
        if (others.isNotEmpty()) {
            item {
                Text("Archived / Rejected (${others.size})",
                    style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp))
            }
            items(others, key = { "o_${it.id}" }) { app -> AppCard(app, viewModel) }
        }
    }
}

@Composable
private fun AppCard(app: AppSubmission, viewModel: AdminDashboardViewModel) {
    val (statusText, tone) = when (app.approvalStatus) {
        AppApprovalStatus.PendingReview -> "Pending"  to StatusTone.Warning
        AppApprovalStatus.Approved      -> "Approved" to StatusTone.Success
        AppApprovalStatus.Rejected      -> "Rejected" to StatusTone.Danger
        AppApprovalStatus.Archived      -> "Archived" to StatusTone.Neutral
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        elevation = CardDefaults.cardElevation(0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIconAvatar(seed = app.id, label = app.name, size = 46.dp)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(app.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                        maxLines = 1, overflow = TextOverflow.Ellipsis)
                    Text(app.packageName, style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
                Spacer(Modifier.width(8.dp))
                StatusPill(statusText, tone)
            }

            if (app.optInUrl.isNotBlank()) {
                Spacer(Modifier.height(8.dp))
                Text("🔗 ${app.optInUrl}", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }

            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                when (app.approvalStatus) {
                    AppApprovalStatus.PendingReview -> {
                        Button(onClick = { viewModel.approveApp(app.id) }, modifier = Modifier.weight(1f).height(38.dp)) {
                            Text("Approve", style = MaterialTheme.typography.labelMedium)
                        }
                        OutlinedButton(
                            onClick = { viewModel.rejectApp(app.id) },
                            modifier = Modifier.weight(1f).height(38.dp),
                            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
                        ) {
                            Text("Reject", style = MaterialTheme.typography.labelMedium)
                        }
                    }
                    AppApprovalStatus.Approved -> {
                        // Read-only. Testers claim tests themselves and stake
                        // coins; the console cannot commit anyone.
                        OutlinedButton(
                            onClick = { viewModel.previewEligibleTesters(app.id) },
                            modifier = Modifier.weight(1f).height(38.dp),
                        ) {
                            Text("Eligible testers", style = MaterialTheme.typography.labelMedium)
                        }
                        OutlinedButton(
                            onClick = { viewModel.setAppStatus(app.id, AppApprovalStatus.Archived) },
                            modifier = Modifier.weight(1f).height(38.dp),
                        ) { Text("Archive", style = MaterialTheme.typography.labelMedium) }
                    }
                    else -> {
                        Button(
                            onClick = { viewModel.approveApp(app.id) },
                            modifier = Modifier.fillMaxWidth().height(38.dp),
                        ) { Text("Activate / Re-approve", style = MaterialTheme.typography.labelMedium) }
                    }
                }
            }
        }
    }
}

// ─── ASSIGNMENTS ─────────────────────────────────────────────────────────────

@Composable
private fun AssignmentsTab(assignments: List<TestAssignment>) {
    if (assignments.isEmpty()) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(Icons.Rounded.Task, null, modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("No assignments yet", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text("Testing assignments will appear here", style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            items(assignments, key = { it.id }) { item ->
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = MaterialTheme.shapes.large,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                    elevation = CardDefaults.cardElevation(0.dp),
                ) {
                    Column(Modifier.padding(14.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text("App: …${item.appId.takeLast(8)}",
                                    style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                Text("Tester: …${item.testerUserId.takeLast(8)}",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            StatusPill(assignmentStatusLabel(item.status), assignmentStatusTone(item.status))
                        }
                        Spacer(Modifier.height(10.dp))
                        LinearProgressIndicator(
                            progress = { if (item.daysRequired <= 0) 0f else item.daysCompleted.toFloat() / item.daysRequired },
                            modifier = Modifier.fillMaxWidth().height(5.dp),
                            color = MaterialTheme.colorScheme.primary,
                            trackColor = MaterialTheme.colorScheme.outlineVariant,
                        )
                        Spacer(Modifier.height(5.dp))
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text("${item.daysCompleted}/${item.daysRequired} days",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            // The stake, not a payout. Verifying this
                            // assignment moves no coins at all.
                            Text("${item.commitmentAmount} committed",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

// ─── OFFICIAL GROUP ───────────────────────────────────────────────────────────

@Composable
private fun OfficialGroupTab(state: AdminUiState.Content, viewModel: AdminDashboardViewModel) {
    val context = LocalContext.current
    var showEditDialog by remember { mutableStateOf(false) }

    if (showEditDialog) {
        EditGroupDialog(
            group = state.officialGroup,
            onDismiss = { showEditDialog = false },
            onSave = { name, summary, rules, memberCap ->
                viewModel.updateGroup(AppConfig.OFFICIAL_GROUP_ID, name, summary, rules, memberCap)
                showEditDialog = false
            },
        )
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Header card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.extraLarge,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
            elevation = CardDefaults.cardElevation(0.dp),
        ) {
            Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(52.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.AdminPanelSettings, null,
                            tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(28.dp))
                    }
                }
                Spacer(Modifier.width(14.dp))
                Column {
                    Text("Official Google Group", style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
                    Text("AppTesting Community Tester Pool",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f))
                }
            }
        }

        // Stats
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            AdminStatCard(Icons.Rounded.Groups, "Members", state.officialGroupMemberCount.toString(),
                MaterialTheme.colorScheme.secondary, MaterialTheme.colorScheme.secondaryContainer,
                modifier = Modifier.weight(1f))
            AdminStatCard(
                Icons.Rounded.CheckCircle,
                "Member Cap",
                (state.officialGroup?.memberCap ?: 0).let { if (it > 0) it.toString() else "Unlimited" },
                MaterialTheme.colorScheme.primary, MaterialTheme.colorScheme.primaryContainer,
                modifier = Modifier.weight(1f),
            )
        }

        // Details card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.large,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
            elevation = CardDefaults.cardElevation(0.dp),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                GroupDetailRow("Group ID", AppConfig.OFFICIAL_GROUP_ID)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                GroupDetailRow("Group Email", AppConfig.OFFICIAL_GROUP_EMAIL)
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                GroupDetailRow("Web URL", AppConfig.APP_TESTER_GOOGLE_GROUP_URL)
            }
        }

        Button(
            onClick = {
                try {
                    context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(AppConfig.APP_TESTER_GOOGLE_GROUP_URL)))
                } catch (_: Exception) {}
            },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = MaterialTheme.shapes.large,
        ) {
            Icon(Icons.AutoMirrored.Rounded.OpenInNew, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Open Google Group", fontWeight = FontWeight.SemiBold)
        }

        OutlinedButton(
            onClick = { showEditDialog = true },
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = MaterialTheme.shapes.large,
        ) {
            Icon(Icons.Rounded.Edit, null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp))
            Text("Edit Group Details", fontWeight = FontWeight.SemiBold)
        }
    }
}

/**
 * Name/summary/rules/member cap only — visibility and status aren't exposed
 * here to keep this a small edit surface rather than a full group-management
 * screen. Writes go through the adminUpsertGroup callable; there is no
 * client-writable path to `groups/{id}` at all.
 */
@Composable
private fun EditGroupDialog(
    group: Group?,
    onDismiss: () -> Unit,
    onSave: (name: String, summary: String, rules: String, memberCap: Int) -> Unit,
) {
    var name by remember { mutableStateOf(group?.name.orEmpty()) }
    var summary by remember { mutableStateOf(group?.summary.orEmpty()) }
    var rules by remember { mutableStateOf(group?.rules.orEmpty()) }
    var memberCapText by remember { mutableStateOf((group?.memberCap ?: 0).toString()) }

    AlertDialog(
        onDismissRequest = onDismiss,
        shape = MaterialTheme.shapes.extraLarge,
        title = { Text("Edit Group Details", fontWeight = FontWeight.Bold) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Name") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = summary,
                    onValueChange = { summary = it },
                    label = { Text("Summary") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = rules,
                    onValueChange = { rules = it },
                    label = { Text("Rules") },
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = memberCapText,
                    onValueChange = { input -> if (input.all { it.isDigit() }) memberCapText = input },
                    label = { Text("Member cap (0 = unlimited)") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onSave(name.trim(), summary.trim(), rules.trim(), memberCapText.toIntOrNull() ?: 0)
                },
                enabled = name.isNotBlank(),
            ) { Text("Save") }
        },
        dismissButton = {
            OutlinedButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

@Composable
private fun GroupDetailRow(label: String, value: String) {
    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold,
            color = MaterialTheme.colorScheme.onSurface)
    }
}

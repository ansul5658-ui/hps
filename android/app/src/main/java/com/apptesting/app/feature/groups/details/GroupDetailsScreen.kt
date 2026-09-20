package com.apptesting.app.feature.groups.details

import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.People
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.apptesting.app.core.data.ServiceLocator
import com.apptesting.app.core.designsystem.component.AppIconAvatar
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.model.Group
import com.apptesting.app.core.model.GroupState
import com.apptesting.app.core.util.AppConfig
import kotlinx.coroutines.launch

private const val TAG = "AUTH_DEBUG"

/**
 * Group Details screen — Scaffold with a back-arrow TopAppBar. Body:
 * hero (avatar + name + status pill), description, meta rows
 * (member count, Google Group email, rules if present), and a single
 * primary action button that becomes Join / Leave / disabled based on
 * membership and group state. Both actions confirm via [AlertDialog].
 */
@Composable
fun GroupDetailsScreen(
    groupId: String,
    onBack: () -> Unit,
) {
    Log.d(TAG, "[GROUPS_DEBUG] GroupDetailsScreen composed for groupId=$groupId")

    val context = LocalContext.current
    val viewModel: GroupDetailsViewModel = viewModel(
        key = "GroupDetailsViewModel/$groupId",
        factory = viewModelFactory {
            initializer {
                GroupDetailsViewModel(
                    groupId = groupId,
                    users = ServiceLocator.userRepository,
                    groups = ServiceLocator.groupRepository,
                )
            }
        },
    )

    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val clipboard = LocalClipboardManager.current
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            if (event is DetailsEvent.Message) snackbar.showSnackbar(event.text)
        }
    }

    var showJoinDialog by rememberSaveable { mutableStateOf(false) }
    var showLeaveDialog by rememberSaveable { mutableStateOf(false) }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            TopAppBar(
                title = { Text(topBarTitleFor(state)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.Rounded.ArrowBack,
                            contentDescription = "Back",
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { inner ->
        when (val s = state) {
            GroupDetailsUiState.Loading -> {
                Box(Modifier.padding(inner).fillMaxSize()) { LoadingState() }
            }
            is GroupDetailsUiState.Error -> {
                Box(Modifier.padding(inner).fillMaxSize()) {
                    ErrorState(title = "Couldn't load group", message = s.message)
                }
            }
            GroupDetailsUiState.NotFound -> {
                Box(Modifier.padding(inner).fillMaxSize()) {
                    ErrorState(
                        title = "Group not found",
                        message = "This group may have been removed by an administrator.",
                    )
                }
            }
            is GroupDetailsUiState.Content -> {
                DetailsContent(
                    modifier = Modifier.padding(inner),
                    content = s,
                    onJoinRequested = { showJoinDialog = true },
                    onLeaveRequested = { showLeaveDialog = true },
                    onCopyEmail = { email ->
                        if (email.isNotBlank()) {
                            clipboard.setText(AnnotatedString(email))
                            scope.launch { snackbar.showSnackbar("Email copied") }
                        }
                    },
                )
            }
        }
    }

    if (showJoinDialog) {
        ConfirmDialog(
            title = "Join Google Group?",
            message = "This will open the official AppTesting Google Group in your browser so you can join.",
            confirmLabel = "Open Google Group",
            onConfirm = {
                showJoinDialog = false
                try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(AppConfig.APP_TESTER_GOOGLE_GROUP_URL))
                    context.startActivity(intent)
                } catch (_: Exception) {
                    scope.launch { snackbar.showSnackbar("No browser app found to open link.") }
                }
                viewModel.join()
            },
            onDismiss = { showJoinDialog = false },
        )
    }
    if (showLeaveDialog) {
        ConfirmDialog(
            title = "Leave group?",
            message = "You will no longer be a member of this testing group.",
            confirmLabel = "Leave Group",
            onConfirm = {
                showLeaveDialog = false
                viewModel.leave()
            },
            onDismiss = { showLeaveDialog = false },
        )
    }
}

@Composable
private fun DetailsContent(
    modifier: Modifier,
    content: GroupDetailsUiState.Content,
    onJoinRequested: () -> Unit,
    onLeaveRequested: () -> Unit,
    onCopyEmail: (String) -> Unit,
) {
    val group = content.group
    val working = content.mutation is MutationState.Working

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .verticalScroll(rememberScrollState())
            .padding(PaddingValues(horizontal = 20.dp, vertical = 16.dp)),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AppIconAvatar(seed = group.id, label = group.name, size = 56.dp)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = group.name.ifBlank { "Unnamed group" },
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onBackground,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(6.dp))
                val (label, tone) = groupStateToPill(group.state, content.isMember)
                StatusPill(text = label, tone = tone)
            }
        }

        if (group.summary.isNotBlank()) {
            Spacer(Modifier.height(20.dp))
            Text(
                text = group.summary,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        Spacer(Modifier.height(20.dp))
        MetaCard(
            memberCount = group.currentMemberCount,
            memberCap = group.memberCap,
            googleGroupEmail = group.googleGroupEmail,
            onCopyEmail = onCopyEmail,
        )

        if (group.rules.isNotBlank()) {
            Spacer(Modifier.height(20.dp))
            Text(
                text = "Group rules",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(8.dp))
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Text(
                    text = group.rules,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }

        Spacer(Modifier.height(24.dp))
        PrimaryAction(
            content = content,
            working = working,
            onJoinRequested = onJoinRequested,
            onLeaveRequested = onLeaveRequested,
        )
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun MetaCard(
    memberCount: Int,
    memberCap: Int,
    googleGroupEmail: String,
    onCopyEmail: (String) -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.People,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(
                    text = if (memberCap > 0) "$memberCount of $memberCap members"
                    else "$memberCount members",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }

            if (googleGroupEmail.isNotBlank()) {
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(min = 40.dp)
                        .clickable(
                            onClick = { onCopyEmail(googleGroupEmail) },
                            role = Role.Button,
                            onClickLabel = "Copy email",
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        imageVector = Icons.Rounded.Email,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(16.dp),
                    )
                    Spacer(Modifier.width(8.dp))
                    Text(
                        text = googleGroupEmail,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
private fun PrimaryAction(
    content: GroupDetailsUiState.Content,
    working: Boolean,
    onJoinRequested: () -> Unit,
    onLeaveRequested: () -> Unit,
) {
    when {
        content.isMember -> {
            OutlinedButton(
                onClick = onLeaveRequested,
                enabled = !working,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = MaterialTheme.shapes.large,
            ) {
                ActionLabel(working = working, text = "Leave Group")
            }
        }
        content.canJoin -> {
            Button(
                onClick = onJoinRequested,
                enabled = !working,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = MaterialTheme.shapes.large,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            ) {
                ActionLabel(working = working, text = "Join Group")
            }
        }
        else -> {
            OutlinedButton(
                onClick = {},
                enabled = false,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = MaterialTheme.shapes.large,
            ) {
                Text(
                    text = when (content.group.state) {
                        GroupState.Full -> "Group full"
                        GroupState.Completed -> "Group completed"
                        GroupState.Archived -> "Group archived"
                        GroupState.Cancelled -> "Group cancelled"
                        else -> "Not open to join"
                    },
                )
            }
        }
    }
}

@Composable
private fun ActionLabel(working: Boolean, text: String) {
    if (working) {
        CircularProgressIndicator(
            modifier = Modifier.size(20.dp),
            strokeWidth = 2.dp,
        )
    } else {
        Text(text)
    }
}

@Composable
private fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
    )
}

// Shared between list and details.
private fun groupStateToPill(state: GroupState, isMember: Boolean): Pair<String, StatusTone> = when {
    isMember -> "Member" to StatusTone.Success
    state == GroupState.Open -> "Open" to StatusTone.Info
    state == GroupState.Active -> "Active" to StatusTone.Info
    state == GroupState.Full -> "Full" to StatusTone.Warning
    state == GroupState.Completed -> "Completed" to StatusTone.Neutral
    state == GroupState.Archived -> "Archived" to StatusTone.Neutral
    state == GroupState.Cancelled -> "Cancelled" to StatusTone.Danger
    else -> "Draft" to StatusTone.Neutral
}

private fun topBarTitleFor(state: GroupDetailsUiState): String = when (state) {
    is GroupDetailsUiState.Content -> state.group.name.ifBlank { "Group" }
    else -> "Group"
}

package com.apptesting.app.feature.groups

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.rounded.Email
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.People
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.AppIconAvatar
import com.apptesting.app.core.designsystem.component.EmptyState
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.model.GroupState

@Composable
fun GroupsScreen(
    viewModel: GroupsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val clipboard = LocalClipboardManager.current

    LaunchedEffect(Unit) {
        viewModel.events.collect { event ->
            if (event is GroupsEvent.Message) snackbar.showSnackbar(event.text)
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
                .padding(PaddingValues(horizontal = 20.dp, vertical = 16.dp))
                .background(MaterialTheme.colorScheme.background),
        ) {
            Text(
                text = stringResource(R.string.nav_groups),
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Admin-managed Google Groups you can join for closed testing.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            when (val s = state) {
                GroupsUiState.Loading -> LoadingState()
                is GroupsUiState.Error -> ErrorState(
                    title = "Couldn't load groups",
                    message = s.message,
                )
                is GroupsUiState.Content -> {
                    if (s.rows.isEmpty()) {
                        EmptyState(
                            icon = Icons.Rounded.Groups,
                            title = stringResource(R.string.placeholder_groups_title),
                            body = stringResource(R.string.placeholder_groups_body),
                        )
                    } else {
                        LazyColumn(
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                            contentPadding = PaddingValues(bottom = 24.dp),
                        ) {
                            items(s.rows, key = { it.id }) { row ->
                                GroupCard(
                                    row = row,
                                    onJoin = { viewModel.onJoin(row.id) },
                                    onLeave = { viewModel.onLeave(row.id) },
                                    onCopyEmail = { clipboard.setText(AnnotatedString(row.googleGroupEmail)) },
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
private fun GroupCard(
    row: GroupRow,
    onJoin: () -> Unit,
    onLeave: () -> Unit,
    onCopyEmail: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIconAvatar(seed = row.id, label = row.name, size = 52.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = row.name,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        text = row.summary,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                val (label, tone) = groupStateToPill(row.state, row.isMember)
                StatusPill(text = label, tone = tone)
            }

            Spacer(Modifier.height(14.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable(onClick = onCopyEmail),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(
                    imageVector = Icons.Rounded.Email,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = row.googleGroupEmail.ifBlank { "No Google Group email set" },
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(6.dp))

            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.People,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = "${row.memberCount} of ${row.memberCap} members",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(14.dp))

            when {
                row.isMember -> {
                    OutlinedButton(
                        onClick = onLeave,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = MaterialTheme.shapes.large,
                    ) {
                        Text("Leave group")
                    }
                }
                row.canJoin -> {
                    Button(
                        onClick = onJoin,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = MaterialTheme.shapes.large,
                    ) {
                        Text("Join group")
                    }
                }
                else -> {
                    OutlinedButton(
                        onClick = { /* no-op */ },
                        enabled = false,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                        shape = MaterialTheme.shapes.large,
                    ) {
                        Text(if (row.state == GroupState.Full) "Group full" else "Not open to join")
                    }
                }
            }
        }
    }
}

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

package com.apptesting.app.feature.groups

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
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.People
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.AppIconAvatar
import com.apptesting.app.core.designsystem.component.EmptyState
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.ScreenContainer
import com.apptesting.app.core.designsystem.component.ScreenHeader
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.model.GroupState

/**
 * Groups list. Each card is tappable and routes to Group Details, which
 * is where the Join / Leave actions live. The list itself is read-only.
 */
@Composable
fun GroupsScreen(
    onGroupClick: (String) -> Unit,
    viewModel: GroupsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    ScreenContainer {
        ScreenHeader(
            title = stringResource(R.string.nav_groups),
            subtitle = "Join a testing group and start testing apps.",
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
                        modifier = Modifier.fillMaxSize(),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = PaddingValues(bottom = 24.dp),
                    ) {
                        items(s.rows, key = { it.id }) { row ->
                            GroupCard(row = row, onClick = { onGroupClick(row.id) })
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
    onClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(
                onClick = onClick,
                role = Role.Button,
                onClickLabel = "Open ${row.name}",
            ),
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
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    if (row.summary.isNotBlank()) {
                        Text(
                            text = row.summary,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                Spacer(Modifier.width(12.dp))
                val (label, tone) = groupStateToPill(row.state, row.isMember)
                StatusPill(text = label, tone = tone)
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.People,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = "${row.memberCount} members",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

internal fun groupStateToPill(state: GroupState, isMember: Boolean): Pair<String, StatusTone> = when {
    isMember -> "Member" to StatusTone.Success
    state == GroupState.Open -> "Open" to StatusTone.Info
    state == GroupState.Active -> "Active" to StatusTone.Info
    state == GroupState.Full -> "Full" to StatusTone.Warning
    state == GroupState.Completed -> "Completed" to StatusTone.Neutral
    state == GroupState.Archived -> "Archived" to StatusTone.Neutral
    state == GroupState.Cancelled -> "Cancelled" to StatusTone.Danger
    else -> "Draft" to StatusTone.Neutral
}

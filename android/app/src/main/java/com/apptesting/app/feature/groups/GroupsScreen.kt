package com.apptesting.app.feature.groups

import android.content.Intent
import android.net.Uri
import android.util.Log
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
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material.icons.rounded.People
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
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
import com.apptesting.app.core.util.AppConfig

private const val TAG = "AUTH_DEBUG"

/**
 * Groups list. Each card displays group details and a "Join Google Group"
 * action button that launches [AppConfig.APP_TESTER_GOOGLE_GROUP_URL]
 * in an external browser.
 */
@Composable
fun GroupsScreen(
    onGroupClick: (String) -> Unit,
    viewModel: GroupsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    Log.d(TAG, "[GROUPS_DEBUG] GroupsScreen composed state=${state::class.simpleName}")

    ScreenContainer {
        ScreenHeader(
            title = stringResource(R.string.nav_groups),
            subtitle = "Join our official Google Group to participate in community app testing.",
        )
        Spacer(Modifier.height(16.dp))
        when (val s = state) {
            GroupsUiState.Loading -> LoadingState()
            is GroupsUiState.Error -> ErrorState(
                title = "Couldn't load groups",
                message = s.message,
            )
            is GroupsUiState.Content -> {
                Log.d(TAG, "[GROUPS_DEBUG] GroupsScreen Content loaded with ${s.rows.size} group rows")
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
                            GroupCard(
                                row = row,
                                onClick = { onGroupClick(row.id) },
                                onJoinGroupClick = {
                                    try {
                                        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(AppConfig.APP_TESTER_GOOGLE_GROUP_URL))
                                        context.startActivity(intent)
                                    } catch (_: Exception) {
                                        // Safely handle missing browser without crashing
                                    }
                                    onGroupClick(row.id)
                                },
                            )
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
    onJoinGroupClick: () -> Unit,
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(
                onClick = {
                    Log.d(TAG, "[GROUPS_DEBUG] GroupCard clicked: id=${row.id}, name=${row.name}")
                    onClick()
                },
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
            Spacer(Modifier.height(12.dp))
            Button(
                onClick = onJoinGroupClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(44.dp),
                shape = MaterialTheme.shapes.medium,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                ),
            ) {
                Icon(
                    imageVector = Icons.AutoMirrored.Rounded.OpenInNew,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text("Join Google Group")
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

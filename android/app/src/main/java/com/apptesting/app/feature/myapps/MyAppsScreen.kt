package com.apptesting.app.feature.myapps

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
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.People
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
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
import com.apptesting.app.core.model.AppApprovalStatus

@Composable
fun MyAppsScreen(
    onAddApp: () -> Unit,
    viewModel: MyAppsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(PaddingValues(horizontal = 20.dp, vertical = 16.dp)),
    ) {
        Header(onAddApp = onAddApp)
        Spacer(Modifier.height(16.dp))
        when (val s = state) {
            MyAppsUiState.Loading -> LoadingState()
            is MyAppsUiState.Error -> ErrorState(
                title = "Couldn't load your apps",
                message = s.message,
            )
            is MyAppsUiState.Content -> {
                if (s.rows.isEmpty()) {
                    EmptyState(
                        icon = Icons.Rounded.Apps,
                        title = stringResource(R.string.placeholder_my_apps_title),
                        body = stringResource(R.string.placeholder_my_apps_body),
                        actionLabel = stringResource(R.string.action_add_app),
                        onAction = onAddApp,
                    )
                } else {
                    LazyColumn(
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        contentPadding = PaddingValues(bottom = 24.dp),
                    ) {
                        items(s.rows, key = { it.id }) { row -> MyAppCard(row) }
                    }
                }
            }
        }
    }
}

@Composable
private fun Header(onAddApp: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = stringResource(R.string.nav_my_apps),
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Apps you've submitted for testing.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        FilledTonalButton(
            onClick = onAddApp,
            shape = MaterialTheme.shapes.large,
        ) {
            Icon(
                imageVector = Icons.Rounded.Add,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.action_add_app))
        }
    }
}

@Composable
private fun MyAppCard(row: MyAppRow) {
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
                        text = "${row.packageName} · v${row.versionName}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                val (label, tone) = approvalStatusToPill(row.approvalStatus)
                StatusPill(text = label, tone = tone)
            }
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.People,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = "${row.testerCount} testers · ${row.completedTesterCount} completed",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.width(14.dp))
                Icon(
                    imageVector = Icons.Rounded.Group,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Spacer(Modifier.width(6.dp))
                Text(
                    text = row.activeGroupName ?: "Not in a group yet",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun approvalStatusToPill(status: AppApprovalStatus): Pair<String, StatusTone> = when (status) {
    AppApprovalStatus.PendingReview -> "Pending review" to StatusTone.Warning
    AppApprovalStatus.Approved -> "Approved" to StatusTone.Success
    AppApprovalStatus.Rejected -> "Rejected" to StatusTone.Danger
    AppApprovalStatus.Archived -> "Archived" to StatusTone.Neutral
}

package com.apptesting.app.feature.profile

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
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.History
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ProgressIndicatorDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.ResponsivePane
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.feature.home.assignmentStatusLabel
import com.apptesting.app.feature.home.assignmentStatusTone

@Composable
fun TestingHistoryScreen(
    onBack: () -> Unit,
    viewModel: ProfileViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Testing History") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
    ) { inner ->
        ResponsivePane(modifier = Modifier.padding(inner)) {
            when (val s = state) {
                ProfileUiState.Loading -> LoadingState()
                is ProfileUiState.Error -> ErrorState(title = "Couldn't load history", message = s.message)
                is ProfileUiState.Content -> HistoryContent(s)
            }
        }
    }
}

@Composable
private fun HistoryContent(state: ProfileUiState.Content) {
    if (state.historyAssignments.isEmpty()) {
        EmptyState(
            icon = Icons.Rounded.History,
            title = "No testing history yet",
            body = "Assignments you complete or participate in will be listed here.",
        )
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            items(state.historyAssignments, key = { it.id }) { assignment ->
                HistoryCard(assignment)
            }
        }
    }
}

@Composable
private fun HistoryCard(item: ProfileHistoryItem) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIconAvatar(seed = item.appId, label = item.appName, size = 52.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = item.appName,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${item.daysCompleted} of ${item.daysRequired} days completed",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.width(8.dp))
                StatusPill(
                    text = assignmentStatusLabel(item.status),
                    tone = assignmentStatusTone(item.status),
                )
            }
            Spacer(Modifier.height(12.dp))
            LinearProgressIndicator(
                progress = { if (item.daysRequired <= 0) 0f else item.daysCompleted.toFloat() / item.daysRequired },
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

package com.apptesting.app.feature.myapps.details

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Delete
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.Group
import androidx.compose.material.icons.rounded.Link
import androidx.compose.material.icons.rounded.MoreVert
import androidx.compose.material.icons.rounded.People
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import coil.compose.AsyncImage
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.AppIconAvatar
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.ResponsivePane
import com.apptesting.app.core.designsystem.component.StatusPill
import com.apptesting.app.core.designsystem.component.StatusTone
import com.apptesting.app.core.model.AppApprovalStatus

@Composable
fun AppDetailsScreen(
    appId: String,
    onBack: () -> Unit,
    viewModel: AppDetailsViewModel = viewModel(factory = AppDetailsViewModelFactory(appId)),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val isDeleting by viewModel.isDeleting.collectAsStateWithLifecycle()
    val deleteError by viewModel.deleteError.collectAsStateWithLifecycle()

    var showMenu by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf(false) }

    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(deleteError) {
        val err = deleteError
        if (err != null) {
            snackbarHostState.showSnackbar(err)
            viewModel.clearDeleteError()
        }
    }

    if (showDeleteDialog) {
        AlertDialog(
            onDismissRequest = { if (!isDeleting) showDeleteDialog = false },
            title = { Text("Delete app?") },
            text = { Text("This will permanently delete this app from your account. This action cannot be undone.") },
            confirmButton = {
                Button(
                    onClick = {
                        viewModel.deleteApp(onDeleted = {
                            showDeleteDialog = false
                            onBack()
                        })
                    },
                    enabled = !isDeleting,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError,
                    ),
                ) {
                    if (isDeleting) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(18.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onError,
                        )
                    } else {
                        Text("Delete")
                    }
                }
            },
            dismissButton = {
                OutlinedButton(
                    onClick = { showDeleteDialog = false },
                    enabled = !isDeleting,
                ) {
                    Text("Cancel")
                }
            },
        )
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("App Details") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Rounded.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                actions = {
                    if (state is AppDetailsUiState.Content) {
                        IconButton(onClick = { showMenu = true }) {
                            Icon(Icons.Rounded.MoreVert, contentDescription = "More actions")
                        }
                        DropdownMenu(
                            expanded = showMenu,
                            onDismissRequest = { showMenu = false },
                        ) {
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        "Delete app",
                                        color = MaterialTheme.colorScheme.error,
                                    )
                                },
                                leadingIcon = {
                                    Icon(
                                        Icons.Rounded.Delete,
                                        contentDescription = null,
                                        tint = MaterialTheme.colorScheme.error,
                                    )
                                },
                                onClick = {
                                    showMenu = false
                                    showDeleteDialog = true
                                },
                            )
                        }
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
                AppDetailsUiState.Loading -> LoadingState()
                is AppDetailsUiState.Error -> ErrorState(title = "Couldn't load app", message = s.message)
                is AppDetailsUiState.Content -> AppDetailsContent(s)
            }
        }
    }
}

@Composable
private fun AppDetailsContent(content: AppDetailsUiState.Content) {
    val app = content.app
    val scrollState = rememberScrollState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(scrollState)
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // App Header Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.large,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Row(
                modifier = Modifier.padding(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                var imageError by remember { mutableStateOf(false) }
                if (!app.iconStoragePath.isNullOrBlank() && !imageError) {
                    AsyncImage(
                        model = app.iconStoragePath,
                        contentDescription = app.name,
                        modifier = Modifier
                            .size(64.dp)
                            .clip(MaterialTheme.shapes.medium),
                        contentScale = ContentScale.Crop,
                        onError = { imageError = true },
                    )
                } else {
                    AppIconAvatar(seed = app.id, label = app.name, size = 64.dp)
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(
                        text = app.name,
                        style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = "${app.packageName} · v${app.versionName.ifBlank { "1.0.0" }}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(12.dp))
                val (label, tone) = approvalStatusToPill(app.approvalStatus)
                StatusPill(text = label, tone = tone)
            }
        }

        // Stats Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.large,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Testing Status", style = MaterialTheme.typography.titleMedium)
                DetailLine(
                    icon = Icons.Rounded.People,
                    label = "Testers",
                    value = "${app.testerCount} assigned · ${app.completedTesterCount} completed",
                )
                DetailLine(
                    icon = Icons.Rounded.Group,
                    label = "Testing Group",
                    value = content.activeGroup?.name ?: "Not in a group yet",
                )
            }
        }

        // Store Links Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = MaterialTheme.shapes.large,
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        ) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Store Links", style = MaterialTheme.typography.titleMedium)
                DetailLine(
                    icon = Icons.Rounded.Link,
                    label = "Play Store URL",
                    value = app.playStoreUrl.ifBlank { "Not provided" },
                )
                DetailLine(
                    icon = Icons.Rounded.Link,
                    label = "Closed-testing / Opt-in URL",
                    value = app.optInUrl.ifBlank { "Not provided" },
                )
            }
        }

        // Description Card
        if (app.description.isNotBlank()) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
            ) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Rounded.Description, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text("Description", style = MaterialTheme.typography.titleMedium)
                    }
                    Text(
                        text = app.description,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun DetailLine(
    icon: ImageVector,
    label: String,
    value: String,
) {
    Row(verticalAlignment = Alignment.Top) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(18.dp).padding(top = 2.dp),
        )
        Spacer(Modifier.width(10.dp))
        Column {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = value,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

private fun approvalStatusToPill(status: AppApprovalStatus): Pair<String, StatusTone> = when (status) {
    AppApprovalStatus.PendingReview -> "Pending review" to StatusTone.Warning
    AppApprovalStatus.Approved -> "Approved" to StatusTone.Success
    AppApprovalStatus.Rejected -> "Rejected" to StatusTone.Danger
    AppApprovalStatus.Archived -> "Archived" to StatusTone.Neutral
}

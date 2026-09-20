package com.apptesting.app.feature.profile

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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AdminPanelSettings
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.HelpOutline
import androidx.compose.material.icons.rounded.History
import androidx.compose.material.icons.rounded.Logout
import androidx.compose.material.icons.rounded.Notifications
import androidx.compose.material.icons.rounded.Person
import androidx.compose.material.icons.rounded.Savings
import androidx.compose.material.icons.rounded.Shield
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.ResponsivePane
import com.apptesting.app.core.model.CoinTransactionKind

@Composable
fun ProfileScreen(
    onSignOut: () -> Unit,
    onNavigateToCoins: () -> Unit = {},
    onNavigateToTrustScore: () -> Unit = {},
    onNavigateToMyApps: () -> Unit = {},
    onNavigateToTestingHistory: () -> Unit = {},
    onNavigateToNotifications: () -> Unit = {},
    onNavigateToHelpFeedback: () -> Unit = {},
    onNavigateToAdmin: () -> Unit = {},
    viewModel: ProfileViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    when (val s = state) {
        ProfileUiState.Loading -> LoadingState()
        is ProfileUiState.Error -> ErrorState(
            title = "Couldn't load your profile",
            message = s.message,
        )
        is ProfileUiState.Content -> ProfileContent(
            state = s,
            onNavigateToCoins = onNavigateToCoins,
            onNavigateToTrustScore = onNavigateToTrustScore,
            onNavigateToMyApps = onNavigateToMyApps,
            onNavigateToTestingHistory = onNavigateToTestingHistory,
            onNavigateToNotifications = onNavigateToNotifications,
            onNavigateToHelpFeedback = onNavigateToHelpFeedback,
            onNavigateToAdmin = onNavigateToAdmin,
            onSignOut = {
                viewModel.signOut()
                onSignOut()
            },
        )
    }
}

@Composable
private fun ProfileContent(
    state: ProfileUiState.Content,
    onNavigateToCoins: () -> Unit,
    onNavigateToTrustScore: () -> Unit,
    onNavigateToMyApps: () -> Unit,
    onNavigateToTestingHistory: () -> Unit,
    onNavigateToNotifications: () -> Unit,
    onNavigateToHelpFeedback: () -> Unit,
    onNavigateToAdmin: () -> Unit,
    onSignOut: () -> Unit,
) {
    ResponsivePane {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(PaddingValues(horizontal = 20.dp, vertical = 16.dp)),
        ) {
            ProfileHeader(state.displayName, state.email, state.joinedIso)
            Spacer(Modifier.height(20.dp))
            CoinBalanceCard(
                balance = state.coinBalance,
                totalEarned = state.totalCoinsEarned,
                onClick = onNavigateToCoins,
            )
            Spacer(Modifier.height(20.dp))
            StatsRow(
                appsSubmitted = state.appsSubmitted,
                testsCompleted = state.testsCompleted,
                trustScore = state.trustScore,
                onAppsClick = onNavigateToMyApps,
                onTestsClick = onNavigateToTestingHistory,
                onTrustClick = onNavigateToTrustScore,
            )
            Spacer(Modifier.height(24.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Recent Coin activity",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
                TextButton(onClick = onNavigateToCoins) {
                    Text("See all")
                }
            }
            Spacer(Modifier.height(8.dp))
            if (state.recentTransactions.isEmpty()) {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(
                            onClick = onNavigateToCoins,
                            role = Role.Button,
                            onClickLabel = "View coin wallet",
                        ),
                    shape = MaterialTheme.shapes.large,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                ) {
                    Text(
                        text = "No coin transactions yet. Tap to view wallet.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(20.dp),
                    )
                }
            } else {
                Card(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable(
                            onClick = onNavigateToCoins,
                            role = Role.Button,
                            onClickLabel = "View coin wallet",
                        ),
                    shape = MaterialTheme.shapes.large,
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
                ) {
                    Column {
                        state.recentTransactions.forEachIndexed { i, tx ->
                            TransactionRow(tx)
                            if (i != state.recentTransactions.lastIndex) {
                                Box(
                                    Modifier
                                        .padding(start = 20.dp)
                                        .fillMaxWidth()
                                        .height(1.dp)
                                        .background(MaterialTheme.colorScheme.outlineVariant),
                                )
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
            val settingsEntries = buildList {
                if (state.isAdmin) {
                    add(RowEntry(Icons.Rounded.AdminPanelSettings, "Admin Dashboard", "Manage users, apps, and platform testing", onNavigateToAdmin))
                }
                add(RowEntry(Icons.Rounded.Savings, "Coin wallet", "Balance, earnings and history", onNavigateToCoins))
                add(RowEntry(Icons.Rounded.Shield, "Trust score", "How your score is calculated", onNavigateToTrustScore))
                add(RowEntry(Icons.Rounded.History, "Testing history", "All assignments you've completed", onNavigateToTestingHistory))
                add(RowEntry(Icons.Rounded.Notifications, "Notifications", "Alerts for assignments and reviews", onNavigateToNotifications))
                add(RowEntry(Icons.Rounded.HelpOutline, "Help & feedback", "Reach the AppTesting team", onNavigateToHelpFeedback))
            }
            SettingsGroup(entries = settingsEntries)
            Spacer(Modifier.height(24.dp))
            TextButton(onClick = onSignOut) {
                Icon(
                    imageVector = Icons.Rounded.Logout,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(Modifier.width(8.dp))
                Text(stringResource(R.string.action_sign_out))
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun ProfileHeader(name: String, email: String, joinedIso: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.primaryContainer,
            modifier = Modifier.size(64.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = Icons.Rounded.Person,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    modifier = Modifier.size(32.dp),
                )
            }
        }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = name,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onBackground,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (email.isNotBlank()) {
                Text(
                    text = email,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Text(
                text = "Joined $joinedIso",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun CoinBalanceCard(balance: Int, totalEarned: Int, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(
                onClick = onClick,
                role = Role.Button,
                onClickLabel = "Open coin wallet",
            ),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.tertiaryContainer,
            contentColor = MaterialTheme.colorScheme.onTertiaryContainer,
        ),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Row(
            modifier = Modifier.padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                shape = CircleShape,
                color = MaterialTheme.colorScheme.tertiary.copy(alpha = 0.18f),
                modifier = Modifier.size(48.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Rounded.Savings,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.tertiary,
                        modifier = Modifier.size(24.dp),
                    )
                }
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    text = "Coin balance",
                    style = MaterialTheme.typography.labelLarge,
                )
                Text(
                    text = balance.toString(),
                    style = MaterialTheme.typography.headlineLarge,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "$totalEarned earned all-time",
                    style = MaterialTheme.typography.bodySmall,
                )
            }
            Icon(
                imageVector = Icons.Rounded.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onTertiaryContainer,
            )
        }
    }
}

@Composable
private fun StatsRow(
    appsSubmitted: Int,
    testsCompleted: Int,
    trustScore: Int,
    onAppsClick: () -> Unit,
    onTestsClick: () -> Unit,
    onTrustClick: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        MiniStat("Apps", appsSubmitted.toString(), onClick = onAppsClick, modifier = Modifier.weight(1f))
        MiniStat("Tests", testsCompleted.toString(), onClick = onTestsClick, modifier = Modifier.weight(1f))
        MiniStat("Trust", trustScore.toString(), onClick = onTrustClick, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun MiniStat(label: String, value: String, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier.clickable(
            onClick = onClick,
            role = Role.Button,
            onClickLabel = "View $label",
        ),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 14.dp),
            horizontalAlignment = Alignment.Start,
        ) {
            Text(
                text = value,
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.height(2.dp))
            Text(
                text = label,
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

@Composable
private fun TransactionRow(tx: ProfileTransactionRow) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = tx.reason,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = tx.whenIso,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(12.dp))
        val (signPrefix, tint) = when (tx.kind) {
            CoinTransactionKind.Earn, CoinTransactionKind.Bonus ->
                "+" to MaterialTheme.colorScheme.tertiary
            CoinTransactionKind.Spend, CoinTransactionKind.Penalty ->
                "-" to MaterialTheme.colorScheme.error
            CoinTransactionKind.Adjustment ->
                "" to MaterialTheme.colorScheme.onSurface
        }
        Text(
            text = "$signPrefix${tx.amount} Coins",
            style = MaterialTheme.typography.titleMedium,
            color = tint,
            maxLines = 1,
        )
    }
}

private data class RowEntry(
    val icon: ImageVector,
    val title: String,
    val subtitle: String,
    val onClick: () -> Unit,
)

@Composable
private fun SettingsGroup(entries: List<RowEntry>) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column {
            entries.forEachIndexed { i, entry ->
                SettingsRowUi(entry)
                if (i != entries.lastIndex) {
                    Box(
                        Modifier
                            .padding(start = 68.dp)
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(MaterialTheme.colorScheme.outlineVariant),
                    )
                }
            }
        }
    }
}

@Composable
private fun SettingsRowUi(entry: RowEntry) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(
                onClick = entry.onClick,
                role = Role.Button,
                onClickLabel = entry.title,
            )
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Surface(
            shape = CircleShape,
            color = MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.size(36.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(
                    imageVector = entry.icon,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(18.dp),
                )
            }
        }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f)) {
            Text(
                text = entry.title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = entry.subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Icon(
            imageVector = Icons.Rounded.ChevronRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

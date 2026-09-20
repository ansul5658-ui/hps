package com.apptesting.app.feature.profile

import androidx.compose.foundation.background
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
import androidx.compose.material.icons.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Savings
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.EmptyState
import com.apptesting.app.core.designsystem.component.ErrorState
import com.apptesting.app.core.designsystem.component.LoadingState
import com.apptesting.app.core.designsystem.component.ResponsivePane
import com.apptesting.app.core.model.CoinTransactionKind
import com.apptesting.app.core.model.CoinWallet

@Composable
fun CoinWalletScreen(
    onBack: () -> Unit,
    viewModel: ProfileViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            TopAppBar(
                title = { Text("Testing Coins") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Rounded.ArrowBack, contentDescription = stringResource(R.string.action_back))
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
                is ProfileUiState.Error -> ErrorState(title = "Couldn't load wallet", message = s.message)
                is ProfileUiState.Content -> WalletContent(s)
            }
        }
    }
}

@Composable
private fun WalletContent(state: ProfileUiState.Content) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        // Balance Banner
        Card(
            modifier = Modifier.fillMaxWidth(),
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
                    color = MaterialTheme.colorScheme.tertiary.copy(alpha = 0.2f),
                    modifier = Modifier.size(56.dp),
                ) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(
                            imageVector = Icons.Rounded.Savings,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.tertiary,
                            modifier = Modifier.size(28.dp),
                        )
                    }
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(text = "Available", style = MaterialTheme.typography.labelLarge)
                    // The spec's exact shape: "Testing Coins: 0" when empty,
                    // "Testing Coins: 50" when funded. Never framed as money.
                    Text(
                        text = "Testing Coins: ${state.wallet.available}",
                        style = MaterialTheme.typography.headlineLarge,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }

        WalletBreakdown(state.wallet)

        Text(
            text = "Transaction History",
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.padding(horizontal = 4.dp),
        )

        if (state.recentTransactions.isEmpty()) {
            EmptyState(
                icon = Icons.Rounded.Savings,
                title = "No Testing Coin activity yet",
                // Says nothing about earning. Coins are committed and returned,
                // never earned, and this is the screen where that has to land.
                body = "Testing Coins are committed when you take on a test, " +
                    "and returned when you complete it.",
            )
        } else {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = MaterialTheme.shapes.large,
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
            ) {
                Column {
                    state.recentTransactions.forEachIndexed { index, tx ->
                        WalletTransactionItem(tx)
                        if (index != state.recentTransactions.lastIndex) {
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
    }
}

@Composable
private fun WalletTransactionItem(tx: ProfileTransactionRow) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                text = tx.reason,
                style = MaterialTheme.typography.titleMedium,
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
        val (signPrefix, tint) = coinRowStyle(tx.kind, tx.isLegacy)
        Text(
            text = "$signPrefix${tx.amount}",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            color = tint,
        )
    }
}

/**
 * Available / committed / forfeited, spelled out.
 *
 * Three separate numbers rather than one total, because they mean genuinely
 * different things to the user: what they can commit now, what is at stake
 * right now, and what they have already lost. Rolling them into one figure
 * would hide the only number that can go down permanently.
 */
@Composable
private fun WalletBreakdown(wallet: CoinWallet) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 0.dp),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            BreakdownRow(
                label = "Available",
                value = wallet.available,
                caption = "Ready to commit to a new test",
            )
            BreakdownRow(
                label = "Committed",
                value = wallet.locked,
                caption = "At stake on tests you are running now",
            )
            BreakdownRow(
                label = "Forfeited",
                value = wallet.forfeitedTotal,
                caption = "Lost from commitments that were not completed",
            )
            // Testing Coins are not money. Saying so once, here, is the honest
            // place for it — this is the screen a user opens expecting a balance.
            Text(
                text = "Testing Coins are a commitment, not cash. They cannot be " +
                    "withdrawn or transferred.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun BreakdownRow(label: String, value: Int, caption: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                text = label,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                text = caption,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(Modifier.width(12.dp))
        Text(
            text = value.toString(),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}

/**
 * Sign and colour for one ledger row, shared with the Profile screen.
 *
 * A [CoinTransactionKind.Lock] is shown as a negative because available coins
 * go down, even though nothing was spent — the user's spendable balance is
 * what the sign describes. Reward-era entries are shown unsigned and muted:
 * they are history, and they no longer move any balance, so giving one a "+"
 * would imply a credit the wallet never received.
 */
@Composable
internal fun coinRowStyle(kind: CoinTransactionKind, isLegacy: Boolean): Pair<String, Color> {
    if (isLegacy) return "" to MaterialTheme.colorScheme.onSurfaceVariant
    return when (kind) {
        CoinTransactionKind.Purchase,
        CoinTransactionKind.Unlock,
        CoinTransactionKind.Adjustment,
        -> "+" to MaterialTheme.colorScheme.tertiary

        CoinTransactionKind.Lock,
        CoinTransactionKind.Reversal,
        -> "-" to MaterialTheme.colorScheme.onSurface

        CoinTransactionKind.Forfeit -> "-" to MaterialTheme.colorScheme.error
        CoinTransactionKind.Unknown -> "" to MaterialTheme.colorScheme.onSurfaceVariant
    }
}

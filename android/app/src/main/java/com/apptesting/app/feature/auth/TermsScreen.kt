package com.apptesting.app.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.util.AppConfig

/**
 * Explicit Terms & Privacy acknowledgement, shown to a signed-in user who has
 * not accepted the CURRENT Terms version (AppConfig.TERMS_VERSION): after
 * sign-in, and at app start after a version bump. A user who already accepted
 * passes straight through to [onAccepted].
 *
 * Acceptance is recorded by the `acceptTerms` callable on `users/{uid}`
 * (version + server timestamp); the server refuses new commitments, group
 * joins, setup confirmations, feedback and Quick Tests without it.
 */
@Composable
fun TermsScreen(
    onAccepted: () -> Unit,
    viewModel: TermsViewModel = viewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    var checked by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()

    LaunchedEffect(state) {
        if (state is TermsUiState.Accepted) onAccepted()
    }

    if (state !is TermsUiState.Required) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator()
        }
        return
    }
    val required = state as TermsUiState.Required

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 24.dp, vertical = 32.dp),
        ) {
            Text(
                text = stringResource(R.string.terms_title),
                style = MaterialTheme.typography.headlineMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = "A short summary of what AppTesting does with your data. Read the full policies below before you agree.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row {
                PolicyLink("Terms of Service", AppConfig.TERMS_OF_SERVICE_URL)
                PolicyLink("Privacy Policy", AppConfig.PRIVACY_POLICY_URL)
            }
            Spacer(Modifier.height(12.dp))
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(scroll),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                TermBullet(
                    title = "Your identity",
                    body = "We sign you in through Google. We store your email, display name and profile photo for community features. We never store your Google password.",
                )
                TermBullet(
                    title = "What we don't collect",
                    body = "We do not scan the list of apps installed on your device, and we do not monitor unrelated device activity.",
                )
                TermBullet(
                    title = "Apps you submit",
                    body = "The information you provide about your own apps — package name, Play Store URL, closed-testing opt-in link — is shared with community members who test them.",
                )
                TermBullet(
                    title = "Testing Coins and Trust Score",
                    body = "Testing Coins are a commitment you stake on a test, not money. They cannot be withdrawn or transferred, completing a test returns the same coins, and failing one forfeits them. Balances and Trust Score are managed on the server; client-side changes are never trusted.",
                )
                TermBullet(
                    title = "Google Play",
                    body = "AppTesting is not Google Play Console and is not a replacement for it. You remain responsible for your own Play Console configuration.",
                )
            }
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(checked = checked, onCheckedChange = { checked = it })
                Text(
                    text = "I have read and agree to the Terms of Service and Privacy Policy.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
            }
            required.error?.let { message ->
                Spacer(Modifier.height(8.dp))
                Text(
                    text = message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = viewModel::onAccept,
                enabled = checked && !required.submitting,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = MaterialTheme.shapes.large,
            ) {
                if (required.submitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(24.dp),
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text(stringResource(R.string.terms_ack_action))
                }
            }
        }
    }
}

/**
 * Opens a full policy document. While its URL is not configured (see
 * AppConfig) it is shown disabled as "not yet available" rather than opening
 * a wrong page.
 */
@Composable
private fun PolicyLink(label: String, url: String) {
    val link = policyLinkOrNull(url)
    val uriHandler = LocalUriHandler.current
    TextButton(
        onClick = { link?.let(uriHandler::openUri) },
        enabled = link != null,
    ) {
        Text(if (link != null) label else "$label (not yet available)")
    }
}

@Composable
private fun TermBullet(title: String, body: String) {
    Row {
        Icon(
            imageVector = Icons.Rounded.Check,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier
                .padding(top = 2.dp)
                .size(20.dp),
        )
        Spacer(Modifier.size(12.dp))
        Column {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onBackground,
            )
            Spacer(Modifier.height(4.dp))
            Text(
                text = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

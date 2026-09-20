package com.apptesting.app.feature.auth

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.apptesting.app.R

/**
 * Explicit Terms & Privacy acknowledgement. Shown after successful sign-in,
 * before the user reaches the main app. Required for Play Store transparency.
 *
 * NOTE: the actual policy documents are hosted externally; this screen presents
 * the summary and captures acceptance. Persistence of the acceptance flag will
 * live in DataStore + Firestore (`users/{uid}.termsAcceptedAt`) — see TODO.
 */
@Composable
fun TermsScreen(onAccepted: () -> Unit) {
    var checked by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()

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
                text = "A short summary of what AppTesting does with your data. Full policies are available on our website.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(20.dp))
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
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = {
                    // TODO(persist): write termsAcceptedAt to DataStore (local) and users/{uid} (server).
                    onAccepted()
                },
                enabled = checked,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = MaterialTheme.shapes.large,
            ) {
                Text(stringResource(R.string.terms_ack_action))
            }
        }
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

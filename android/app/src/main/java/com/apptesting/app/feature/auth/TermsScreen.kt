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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.Info
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.apptesting.app.R
import com.apptesting.app.core.util.AppConfig

internal const val TERMS_AGREE_WITH_DOCUMENTS =
    "I have read and agree to the Terms of Service and Privacy Policy."
internal const val TERMS_AGREE_SUMMARY_ONLY =
    "I have read and agree to the summary on this screen."
internal const val TERMS_DOCUMENTS_UNAVAILABLE_TITLE = "Full policies not yet published"
internal const val TERMS_DOCUMENT_NOT_PUBLISHED = "Not yet published"

internal const val TERMS_TAG_AGREE = "terms_agree"
internal const val TERMS_TAG_ACCEPT = "terms_accept"
internal const val TERMS_TAG_ERROR = "terms_error"

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

    LaunchedEffect(state) {
        if (state is TermsUiState.Accepted) onAccepted()
    }

    val required = state as? TermsUiState.Required
    if (required == null) {
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
    TermsContent(state = required, onAccept = viewModel::onAccept)
}

/**
 * The Terms screen body, free of the ViewModel so it can be UI tested.
 *
 * While either full policy document is unpublished (blank URL in AppConfig)
 * the screen says so plainly and the agreement covers only the summary shown
 * here - it never claims the user has read documents they could not open.
 */
@Composable
internal fun TermsContent(
    state: TermsUiState.Required,
    onAccept: () -> Unit,
    termsUrl: String = AppConfig.TERMS_OF_SERVICE_URL,
    privacyUrl: String = AppConfig.PRIVACY_POLICY_URL,
) {
    var checked by remember { mutableStateOf(false) }
    val scroll = rememberScrollState()
    val documentsAvailable = policyDocumentsAvailable(termsUrl, privacyUrl)

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
                modifier = Modifier.semantics { heading() },
            )
            Spacer(Modifier.height(12.dp))
            Text(
                text = if (documentsAvailable) {
                    "A short summary of what AppTesting does with your data. Read the full policies below before you agree."
                } else {
                    "A short summary of what AppTesting does with your data."
                },
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(16.dp))
            Column(
                modifier = Modifier
                    .weight(1f)
                    .verticalScroll(scroll),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                PolicyDocuments(termsUrl = termsUrl, privacyUrl = privacyUrl)
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
            // The whole row is the checkbox's touch target and label, so tapping
            // the text toggles it and TalkBack reads one labelled checkbox.
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .toggleable(
                        value = checked,
                        enabled = !state.submitting,
                        role = Role.Checkbox,
                        onValueChange = { checked = it },
                    )
                    .testTag(TERMS_TAG_AGREE),
            ) {
                Checkbox(checked = checked, onCheckedChange = null, enabled = !state.submitting)
                Spacer(Modifier.size(12.dp))
                Text(
                    text = if (documentsAvailable) TERMS_AGREE_WITH_DOCUMENTS else TERMS_AGREE_SUMMARY_ONLY,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                    modifier = Modifier.weight(1f),
                )
            }
            state.error?.let { message ->
                Spacer(Modifier.height(8.dp))
                TermsError(message)
            }
            Spacer(Modifier.height(16.dp))
            Button(
                onClick = onAccept,
                enabled = checked && !state.submitting,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .testTag(TERMS_TAG_ACCEPT),
                shape = MaterialTheme.shapes.large,
            ) {
                if (state.submitting) {
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
 * The full policy documents. Each takes the full width, so neither label is
 * squeezed. A document whose URL is not configured is listed as "Not yet
 * published" with an explanation, rather than a dead link or a wrong page.
 */
@Composable
private fun PolicyDocuments(termsUrl: String, privacyUrl: String) {
    val termsLink = policyLinkOrNull(termsUrl)
    val privacyLink = policyLinkOrNull(privacyUrl)
    if (termsLink != null && privacyLink != null) {
        Column(modifier = Modifier.fillMaxWidth()) {
            PolicyLink("Terms of Service", termsLink)
            PolicyLink("Privacy Policy", privacyLink)
        }
        return
    }
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.large,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Rounded.Info,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(20.dp),
                )
                Spacer(Modifier.size(12.dp))
                Text(
                    text = TERMS_DOCUMENTS_UNAVAILABLE_TITLE,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier
                        .weight(1f)
                        .semantics { heading() },
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                text = "The complete Terms of Service and Privacy Policy aren't available to open yet. The summary below describes how AppTesting handles your data.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(8.dp))
            PolicyDocumentRow("Terms of Service", termsLink)
            PolicyDocumentRow("Privacy Policy", privacyLink)
        }
    }
}

/** One document inside the "not yet published" card: a link if it exists, otherwise its status. */
@Composable
private fun PolicyDocumentRow(label: String, link: String?) {
    if (link != null) {
        PolicyLink(label, link)
        return
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier
            .fillMaxWidth()
            .heightIn(min = 48.dp)
            .semantics(mergeDescendants = true) {},
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        Spacer(Modifier.size(12.dp))
        Text(
            text = TERMS_DOCUMENT_NOT_PUBLISHED,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** Opens a full policy document; only ever given a validated https link. */
@Composable
private fun PolicyLink(label: String, link: String) {
    val uriHandler = LocalUriHandler.current
    TextButton(
        onClick = { uriHandler.openUri(link) },
        modifier = Modifier.fillMaxWidth(),
    ) {
        Text(text = label, modifier = Modifier.weight(1f))
        Icon(
            imageVector = Icons.AutoMirrored.Rounded.OpenInNew,
            contentDescription = null,
            modifier = Modifier.size(18.dp),
        )
    }
}

/** A failed acceptance, announced to TalkBack when it appears. */
@Composable
private fun TermsError(message: String) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier
            .fillMaxWidth()
            .testTag(TERMS_TAG_ERROR)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.Top,
        ) {
            Icon(
                imageVector = Icons.Rounded.ErrorOutline,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onErrorContainer,
                modifier = Modifier.size(20.dp),
            )
            Spacer(Modifier.size(12.dp))
            Text(
                text = message,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onErrorContainer,
                modifier = Modifier.weight(1f),
            )
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

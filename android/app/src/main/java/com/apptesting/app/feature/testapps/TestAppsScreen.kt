package com.apptesting.app.feature.testapps

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CardGiftcard
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.EmptyState

/**
 * Test Apps tab — the list of testing assignments a user has been given.
 *
 * The assignment list will render as cards showing app icon, name, developer,
 * status pill, deadline and a primary "Test app" action. Until Firebase is
 * wired we render the empty state so users see a real first-run UX.
 */
@Composable
fun TestAppsScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(PaddingValues(horizontal = 20.dp, vertical = 16.dp)),
    ) {
        Text(
            text = stringResource(R.string.nav_test_apps),
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "Assignments from your groups.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        EmptyState(
            icon = Icons.Rounded.CardGiftcard,
            title = stringResource(R.string.placeholder_test_apps_title),
            body = stringResource(R.string.placeholder_test_apps_body),
        )
    }
}

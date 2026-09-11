package com.apptesting.app.feature.groups

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Groups
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.apptesting.app.R
import com.apptesting.app.core.designsystem.component.EmptyState

/**
 * Groups tab.
 *
 * Group discovery, details, join/request flow, member list, participating apps,
 * assignments, daily progress, rules, and announcements are the target set of
 * features here. The screen currently shows the empty discovery state until
 * the Firebase-backed group repository lands.
 */
@Composable
fun GroupsScreen() {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .padding(PaddingValues(horizontal = 20.dp, vertical = 16.dp)),
    ) {
        Text(
            text = stringResource(R.string.nav_groups),
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.onBackground,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = "Testing communities you can join.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(24.dp))
        EmptyState(
            icon = Icons.Rounded.Groups,
            title = stringResource(R.string.placeholder_groups_title),
            body = stringResource(R.string.placeholder_groups_body),
        )
    }
}

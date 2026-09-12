package com.apptesting.app.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Root wrapper for a tab / screen surface.
 *
 * Fills the available window, paints the theme background, and caps the
 * inner content pane at [maxContentWidth] — so a phone gets edge-to-edge
 * layout as before, while a tablet or foldable centers the same content
 * on a comfortable reading measure instead of stretching cards across
 * the whole display.
 *
 * A screen whose top-level is a `LazyColumn` should use
 * [ResponsivePane] instead so the list's own contentPadding stays intact.
 */
@Composable
fun ScreenContainer(
    modifier: Modifier = Modifier,
    maxContentWidth: Dp = 720.dp,
    contentPadding: PaddingValues = PaddingValues(horizontal = 20.dp, vertical = 16.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    ResponsivePane(modifier = modifier, maxContentWidth = maxContentWidth) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(contentPadding),
            content = content,
        )
    }
}

/**
 * Just the centering + max-width behavior of [ScreenContainer] — for
 * screens whose top-level is a `LazyColumn` or a custom scroll container.
 */
@Composable
fun ResponsivePane(
    modifier: Modifier = Modifier,
    maxContentWidth: Dp = 720.dp,
    content: @Composable () -> Unit,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background),
        contentAlignment = Alignment.TopCenter,
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = maxContentWidth)
                .fillMaxHeight(),
        ) {
            content()
        }
    }
}

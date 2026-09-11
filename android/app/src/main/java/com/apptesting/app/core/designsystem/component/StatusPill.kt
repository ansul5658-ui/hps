package com.apptesting.app.core.designsystem.component

import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.apptesting.app.core.designsystem.theme.BrandColors

/** Compact tinted pill used for assignment / group states. */
@Composable
fun StatusPill(
    text: String,
    tone: StatusTone,
    modifier: Modifier = Modifier,
) {
    val (bg, fg) = tone.colors()
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(999.dp),
        color = bg,
        contentColor = fg,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelMedium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
        )
    }
}

enum class StatusTone {
    Neutral, Info, Success, Warning, Danger;

    @Composable
    fun colors(): Pair<Color, Color> {
        val cs = MaterialTheme.colorScheme
        val dark = cs.background.let { it.red + it.green + it.blue < 1.5f }
        return when (this) {
            Neutral -> cs.surfaceVariant to cs.onSurfaceVariant
            Info -> cs.primaryContainer to cs.onPrimaryContainer
            Success -> (if (dark) BrandColors.SuccessContainerDark else BrandColors.SuccessContainer) to
                (if (dark) BrandColors.Teal90 else BrandColors.Success)
            Warning -> (if (dark) BrandColors.WarningContainerDark else BrandColors.WarningContainer) to
                (if (dark) BrandColors.Sand90 else BrandColors.Warning)
            Danger -> cs.errorContainer to cs.onErrorContainer
        }
    }
}

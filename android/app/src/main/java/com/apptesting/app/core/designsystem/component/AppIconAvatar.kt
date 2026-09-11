package com.apptesting.app.core.designsystem.component

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Placeholder app/group avatar: 2-letter initials on a colored rounded square.
 *
 * The color is chosen deterministically from [seed] (usually a name or id),
 * so the same app shows the same tile every time. When Firebase Storage
 * is wired we swap this out for a Coil-loaded image; the API stays the same.
 */
@Composable
fun AppIconAvatar(
    seed: String,
    label: String,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    corner: Dp = 12.dp,
) {
    val hue = ((seed.hashCode().toLong() and 0xFFFFFFFFL) % 360L).toInt()
    val bg = hslToColor(hue.toFloat(), saturation = 0.55f, lightness = 0.86f)
    val fg = hslToColor(hue.toFloat(), saturation = 0.55f, lightness = 0.28f)

    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(corner))
            .background(bg),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = initialsFor(label),
            style = MaterialTheme.typography.titleMedium,
            color = fg,
        )
    }
}

private fun initialsFor(label: String): String {
    val parts = label.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
    return when {
        parts.isEmpty() -> "?"
        parts.size == 1 -> parts[0].take(2).uppercase()
        else -> (parts[0].take(1) + parts[1].take(1)).uppercase()
    }
}

/** Small HSL→RGB conversion so we don't need to depend on android.graphics for previews. */
private fun hslToColor(h: Float, saturation: Float, lightness: Float): Color {
    val c = (1f - kotlin.math.abs(2f * lightness - 1f)) * saturation
    val hp = h / 60f
    val x = c * (1f - kotlin.math.abs((hp % 2f) - 1f))
    val (r1, g1, b1) = when {
        hp < 1f -> Triple(c, x, 0f)
        hp < 2f -> Triple(x, c, 0f)
        hp < 3f -> Triple(0f, c, x)
        hp < 4f -> Triple(0f, x, c)
        hp < 5f -> Triple(x, 0f, c)
        else -> Triple(c, 0f, x)
    }
    val m = lightness - c / 2f
    return Color(r1 + m, g1 + m, b1 + m)
}

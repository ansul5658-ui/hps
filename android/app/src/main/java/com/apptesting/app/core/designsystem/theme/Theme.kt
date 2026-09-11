package com.apptesting.app.core.designsystem.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

/**
 * Light color scheme — cool white surface, indigo primary. Kept restrained;
 * the accent shows up mainly in primary CTAs and progress accents.
 */
private val LightScheme = lightColorScheme(
    primary = BrandColors.Indigo40,
    onPrimary = Color.White,
    primaryContainer = BrandColors.Indigo90,
    onPrimaryContainer = BrandColors.Indigo10,

    secondary = BrandColors.Teal40,
    onSecondary = Color.White,
    secondaryContainer = BrandColors.Teal90,
    onSecondaryContainer = BrandColors.Teal10,

    tertiary = BrandColors.Sand40,
    onTertiary = Color.White,
    tertiaryContainer = BrandColors.Sand90,
    onTertiaryContainer = BrandColors.Sand10,

    error = BrandColors.Error40,
    onError = Color.White,
    errorContainer = BrandColors.Error90,
    onErrorContainer = BrandColors.Error10,

    background = BrandColors.Neutral98,
    onBackground = BrandColors.Neutral10,
    surface = BrandColors.Neutral99,
    onSurface = BrandColors.Neutral10,
    surfaceVariant = BrandColors.NeutralVariant90,
    onSurfaceVariant = BrandColors.NeutralVariant30,
    surfaceTint = BrandColors.Indigo40,

    outline = BrandColors.NeutralVariant50,
    outlineVariant = BrandColors.NeutralVariant80,

    inverseSurface = BrandColors.Neutral20,
    inverseOnSurface = BrandColors.Neutral95,
    inversePrimary = BrandColors.Indigo80,

    scrim = Color.Black,
)

/**
 * Dark color scheme — deep neutral surface, lighter indigo primary for contrast.
 * Meant to be easy on the eyes; avoids pure black so elevation reads correctly.
 */
private val DarkScheme = darkColorScheme(
    primary = BrandColors.Indigo80,
    onPrimary = BrandColors.Indigo20,
    primaryContainer = BrandColors.Indigo30,
    onPrimaryContainer = BrandColors.Indigo90,

    secondary = BrandColors.Teal80,
    onSecondary = BrandColors.Teal20,
    secondaryContainer = BrandColors.Teal30,
    onSecondaryContainer = BrandColors.Teal90,

    tertiary = BrandColors.Sand80,
    onTertiary = BrandColors.Sand20,
    tertiaryContainer = BrandColors.Sand30,
    onTertiaryContainer = BrandColors.Sand90,

    error = BrandColors.Error80,
    onError = BrandColors.Error20,
    errorContainer = BrandColors.Error20,
    onErrorContainer = BrandColors.Error90,

    background = BrandColors.Neutral10,
    onBackground = BrandColors.Neutral95,
    surface = BrandColors.Neutral15,
    onSurface = BrandColors.Neutral95,
    surfaceVariant = BrandColors.Neutral25,
    onSurfaceVariant = BrandColors.NeutralVariant80,
    surfaceTint = BrandColors.Indigo80,

    outline = BrandColors.NeutralVariant50,
    outlineVariant = BrandColors.Neutral30,

    inverseSurface = BrandColors.Neutral90,
    inverseOnSurface = BrandColors.Neutral20,
    inversePrimary = BrandColors.Indigo40,

    scrim = Color.Black,
)

@Composable
fun AppTestingTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    // Dynamic color is off by default — the brand palette should read the same
    // on every device. Callers can opt in per screen if we ever want it.
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkScheme
        else -> LightScheme
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            val insets = WindowCompat.getInsetsController(window, view)
            val useLightIcons = colorScheme.background.luminance() > 0.5f
            insets.isAppearanceLightStatusBars = useLightIcons
            insets.isAppearanceLightNavigationBars = useLightIcons
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content,
    )
}

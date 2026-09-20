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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val DarkScheme = darkColorScheme(
    primary            = BrandColors.Violet60,
    onPrimary          = Color.White,
    primaryContainer   = BrandColors.Violet30,
    onPrimaryContainer = BrandColors.Violet90,

    secondary            = BrandColors.Cyan60,
    onSecondary          = BrandColors.Cyan10,
    secondaryContainer   = BrandColors.Cyan30,
    onSecondaryContainer = BrandColors.Cyan90,

    tertiary            = BrandColors.Gold80,
    onTertiary          = BrandColors.Gold10,
    tertiaryContainer   = BrandColors.Gold30,
    onTertiaryContainer = BrandColors.Gold90,

    error            = BrandColors.ErrorLight,
    onError          = BrandColors.ErrorDark,
    errorContainer   = BrandColors.ErrorDark,
    onErrorContainer = BrandColors.ErrorLight,

    background        = BrandColors.N10,
    onBackground      = BrandColors.N95,
    surface           = BrandColors.N12,
    onSurface         = BrandColors.N95,
    surfaceVariant    = BrandColors.N20,
    onSurfaceVariant  = BrandColors.N80,
    surfaceContainer       = BrandColors.N15,
    surfaceContainerHigh   = BrandColors.N20,
    surfaceContainerHighest= BrandColors.N25,
    surfaceTint       = BrandColors.Violet60,

    outline        = BrandColors.N40,
    outlineVariant = BrandColors.N30,

    inverseSurface    = BrandColors.N90,
    inverseOnSurface  = BrandColors.N15,
    inversePrimary    = BrandColors.Violet40,

    scrim = Color.Black,
)

private val LightScheme = lightColorScheme(
    primary            = BrandColors.Violet40,
    onPrimary          = Color.White,
    primaryContainer   = BrandColors.Violet90,
    onPrimaryContainer = BrandColors.Violet10,

    secondary            = BrandColors.Cyan40,
    onSecondary          = Color.White,
    secondaryContainer   = BrandColors.Cyan90,
    onSecondaryContainer = BrandColors.Cyan10,

    tertiary            = BrandColors.Gold40,
    onTertiary          = Color.White,
    tertiaryContainer   = BrandColors.Gold90,
    onTertiaryContainer = BrandColors.Gold10,

    error            = BrandColors.ErrorRed,
    onError          = Color.White,
    errorContainer   = BrandColors.ErrorLight,
    onErrorContainer = BrandColors.ErrorDark,

    background        = BrandColors.N99,
    onBackground      = BrandColors.N10,
    surface           = BrandColors.N99,
    onSurface         = BrandColors.N10,
    surfaceVariant    = BrandColors.NV90,
    onSurfaceVariant  = BrandColors.NV30,
    surfaceContainer       = BrandColors.N98,
    surfaceContainerHigh   = BrandColors.N95,
    surfaceContainerHighest= BrandColors.N90,
    surfaceTint       = BrandColors.Violet40,

    outline        = BrandColors.NV50,
    outlineVariant = BrandColors.NV80,

    inverseSurface    = BrandColors.N20,
    inverseOnSurface  = BrandColors.N95,
    inversePrimary    = BrandColors.Violet80,

    scrim = Color.Black,
)

@Composable
fun AppTestingTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkScheme
        else      -> LightScheme
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !darkTheme
                isAppearanceLightNavigationBars = !darkTheme
            }
        }
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography  = AppTypography,
        shapes      = AppShapes,
        content     = content,
    )
}

package com.apptesting.app.core.designsystem.theme

import androidx.compose.ui.graphics.Color

/**
 * AppTesting brand palette.
 *
 * Designed for a professional, developer-focused feel — cool indigo primary,
 * slate neutrals, teal secondary for testing progress, warm sand for coin accents.
 * The palette is defined once here; Material 3 [ColorScheme]s in Theme.kt map
 * these into light and dark roles.
 */
internal object BrandColors {
    // --- Primary (indigo) ---
    val Indigo10 = Color(0xFF00105E)
    val Indigo20 = Color(0xFF0A1F87)
    val Indigo30 = Color(0xFF1E36B0)
    val Indigo40 = Color(0xFF3149DD)
    val Indigo60 = Color(0xFF7A8CFF)
    val Indigo80 = Color(0xFFB4C2FF)
    val Indigo90 = Color(0xFFDDE1FF)
    val Indigo95 = Color(0xFFEEF0FF)
    val Indigo99 = Color(0xFFFAFAFF)

    // --- Secondary (teal — testing / progress) ---
    val Teal10 = Color(0xFF00201A)
    val Teal20 = Color(0xFF00382E)
    val Teal30 = Color(0xFF005143)
    val Teal40 = Color(0xFF006B58)
    val Teal80 = Color(0xFF6ADBBE)
    val Teal90 = Color(0xFF87F7D8)

    // --- Tertiary (warm sand — coin accents) ---
    val Sand10 = Color(0xFF291800)
    val Sand20 = Color(0xFF432B00)
    val Sand30 = Color(0xFF603F00)
    val Sand40 = Color(0xFF7E5500)
    val Sand80 = Color(0xFFFFBB6A)
    val Sand90 = Color(0xFFFFDEB0)

    // --- Neutrals (slate) ---
    val Neutral10 = Color(0xFF0E1116)
    val Neutral15 = Color(0xFF161A22)
    val Neutral20 = Color(0xFF1D222B)
    val Neutral25 = Color(0xFF262B35)
    val Neutral30 = Color(0xFF2F3540)
    val Neutral40 = Color(0xFF4A5060)
    val Neutral60 = Color(0xFF7A8194)
    val Neutral80 = Color(0xFFC5CAD5)
    val Neutral90 = Color(0xFFE1E4EC)
    val Neutral95 = Color(0xFFF0F2F7)
    val Neutral98 = Color(0xFFF9FAFD)
    val Neutral99 = Color(0xFFFDFDFF)

    // --- Neutral variants — for outlines, muted surfaces ---
    val NeutralVariant30 = Color(0xFF404859)
    val NeutralVariant50 = Color(0xFF6E7689)
    val NeutralVariant80 = Color(0xFFC5CBD9)
    val NeutralVariant90 = Color(0xFFE1E5EF)

    // --- Semantic ---
    val Error10 = Color(0xFF410002)
    val Error20 = Color(0xFF690005)
    val Error40 = Color(0xFFBA1A1A)
    val Error80 = Color(0xFFFFB4AB)
    val Error90 = Color(0xFFFFDAD6)

    // --- Status accents (used sparingly for assignment states) ---
    val Success = Color(0xFF16A34A)
    val SuccessContainer = Color(0xFFDCFCE7)
    val SuccessContainerDark = Color(0xFF14532D)
    val Warning = Color(0xFFEA580C)
    val WarningContainer = Color(0xFFFFEDD5)
    val WarningContainerDark = Color(0xFF7C2D12)
}

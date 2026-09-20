package com.apptesting.app.core.designsystem.theme

import androidx.compose.ui.graphics.Color

internal object BrandColors {
    // --- Primary (deep violet-purple — premium, bold) ---
    val Violet10  = Color(0xFF1A003D)
    val Violet20  = Color(0xFF2D0066)
    val Violet30  = Color(0xFF4A00A8)
    val Violet40  = Color(0xFF6B21D4)
    val Violet50  = Color(0xFF8B3DFF)
    val Violet60  = Color(0xFFA366FF)
    val Violet80  = Color(0xFFCFB3FF)
    val Violet90  = Color(0xFFECE0FF)
    val Violet95  = Color(0xFFF7F2FF)
    val Violet99  = Color(0xFFFFFBFF)

    // --- Secondary (electric cyan — action, progress) ---
    val Cyan10  = Color(0xFF001F26)
    val Cyan20  = Color(0xFF003640)
    val Cyan30  = Color(0xFF004E5C)
    val Cyan40  = Color(0xFF006878)
    val Cyan60  = Color(0xFF00B4D8)
    val Cyan80  = Color(0xFF72E4F8)
    val Cyan90  = Color(0xFFB8F3FD)

    // --- Tertiary (amber gold — coins, rewards) ---
    val Gold10  = Color(0xFF2B1600)
    val Gold20  = Color(0xFF4A2700)
    val Gold30  = Color(0xFF6B3A00)
    val Gold40  = Color(0xFF8E5000)
    val Gold60  = Color(0xFFE08600)
    val Gold80  = Color(0xFFFFBB33)
    val Gold90  = Color(0xFFFFDFA0)
    val Amber90 = Gold90

    // --- Neutrals (near-black dark, clean white light) ---
    val N10  = Color(0xFF0D0D12)
    val N12  = Color(0xFF111118)
    val N15  = Color(0xFF15151E)
    val N20  = Color(0xFF1C1C27)
    val N25  = Color(0xFF222230)
    val N30  = Color(0xFF2A2A3A)
    val N40  = Color(0xFF3E3E52)
    val N50  = Color(0xFF5A5A74)
    val N60  = Color(0xFF7A7A96)
    val N70  = Color(0xFF9898B2)
    val N80  = Color(0xFFB8B8CC)
    val N90  = Color(0xFFD8D8E8)
    val N95  = Color(0xFFECECF4)
    val N98  = Color(0xFFF5F5FA)
    val N99  = Color(0xFFFAFAFD)

    // --- Neutral variant (for outlines, tinted surfaces) ---
    val NV30 = Color(0xFF333348)
    val NV50 = Color(0xFF666680)
    val NV80 = Color(0xFFBBBBD0)
    val NV90 = Color(0xFFE0E0EE)

    // --- Semantic ---
    val ErrorRed    = Color(0xFFCF2B2B)
    val ErrorLight  = Color(0xFFFFDAD6)
    val ErrorDark   = Color(0xFF93000A)
    val Success     = Color(0xFF0F9B5A)
    val SuccessLight= Color(0xFFD4F5E5)
    val Warning     = Color(0xFFD97706)
    val WarningLight= Color(0xFFFEF3C7)

    // Status accent colours (unchanged — keep app logic working)
    val SuccessContainer     = Color(0xFFDCFCE7)
    val SuccessContainerDark = Color(0xFF14532D)
    val WarningContainer     = Color(0xFFFFEDD5)
    val WarningContainerDark = Color(0xFF7C2D12)
}

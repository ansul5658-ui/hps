package com.apptesting.app.core.designsystem.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

private val Sans = FontFamily.Default

val AppTypography = Typography(
    displayLarge  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Bold,
        fontSize=44.sp, lineHeight=52.sp, letterSpacing=(-0.5).sp),
    displayMedium = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Bold,
        fontSize=36.sp, lineHeight=44.sp, letterSpacing=(-0.25).sp),
    displaySmall  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.SemiBold,
        fontSize=30.sp, lineHeight=38.sp),
    headlineLarge  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Bold,
        fontSize=28.sp, lineHeight=34.sp, letterSpacing=(-0.2).sp),
    headlineMedium = TextStyle(fontFamily=Sans, fontWeight=FontWeight.SemiBold,
        fontSize=24.sp, lineHeight=30.sp),
    headlineSmall  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.SemiBold,
        fontSize=20.sp, lineHeight=26.sp),
    titleLarge  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.SemiBold,
        fontSize=18.sp, lineHeight=24.sp),
    titleMedium = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Medium,
        fontSize=16.sp, lineHeight=22.sp, letterSpacing=0.1.sp),
    titleSmall  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Medium,
        fontSize=14.sp, lineHeight=20.sp, letterSpacing=0.1.sp),
    bodyLarge  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Normal,
        fontSize=16.sp, lineHeight=24.sp),
    bodyMedium = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Normal,
        fontSize=14.sp, lineHeight=20.sp),
    bodySmall  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Normal,
        fontSize=12.sp, lineHeight=17.sp),
    labelLarge  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.SemiBold,
        fontSize=14.sp, lineHeight=20.sp, letterSpacing=0.15.sp),
    labelMedium = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Medium,
        fontSize=12.sp, lineHeight=16.sp, letterSpacing=0.5.sp),
    labelSmall  = TextStyle(fontFamily=Sans, fontWeight=FontWeight.Medium,
        fontSize=11.sp, lineHeight=14.sp, letterSpacing=0.5.sp),
)

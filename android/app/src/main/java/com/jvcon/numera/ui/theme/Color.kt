package com.jvcon.numera.ui.theme

import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/*
 * Numera — Material 3 semantic color layer (Android mirror).
 *
 * Values are transcribed 1:1 from the web token layer:
 *   web/src/styles/palette.css    (raw tones, resolved here)
 *   web/src/styles/sys-color.css  (light + dark semantic schemes)
 *
 * The reference palette is private to this file; components must only read
 * MaterialTheme.colorScheme (the --md-sys-color-* contract). No hard-coded
 * colors are permitted outside this file (design-spec §15).
 *
 * Source color: teal #00696D (primary40).
 */

// ---------------------------------------------------------------------------
// Light scheme — resolves the [data-theme="light"] / :root block.
// ---------------------------------------------------------------------------
internal val LightColors: ColorScheme = lightColorScheme(
    // Primary — palette primary40 / 100 / 90 / 10
    primary = Color(0xFF00696D),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFF6FF7FC),
    onPrimaryContainer = Color(0xFF002021),

    // Secondary — palette secondary40 / 100 / 90 / 10
    secondary = Color(0xFF4A6364),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFCCE8E8),
    onSecondaryContainer = Color(0xFF051F20),

    // Tertiary — palette tertiary40 / 100 / 90 / 10
    tertiary = Color(0xFF426885),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD0E9FF),
    onTertiaryContainer = Color(0xFF001F3A),

    // Error — palette error40 / 100 / 90 / 10
    error = Color(0xFFBA1A1A),
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),

    // Surfaces — palette neutral99 / neutral10 / neutral-variant90 / 30
    background = Color(0xFFFAFDFC),
    onBackground = Color(0xFF191C1C),
    surface = Color(0xFFFAFDFC),
    onSurface = Color(0xFF191C1C),
    surfaceVariant = Color(0xFFDAE4E4),
    onSurfaceVariant = Color(0xFF3F4949),
    outline = Color(0xFF6F7979),
    outlineVariant = Color(0xFFBEC8C8),

    // Misc
    scrim = Color(0xFF000000),
    inverseSurface = Color(0xFF2D3131),
    inverseOnSurface = Color(0xFFEFF1F1),
    inversePrimary = Color(0xFF4CD9DF),
    surfaceTint = Color(0xFF00696D),

    // Surface-container ladder (M3 Expressive, explicit tones)
    surfaceContainerHighest = Color(0xFFE0E3E2), // neutral90
    surfaceContainerHigh = Color(0xFFE3EAE9),
    surfaceContainer = Color(0xFFE9EFEF),
    surfaceContainerLow = Color(0xFFEFF5F4),
    surfaceContainerLowest = Color(0xFFFFFFFF), // neutral100
    surfaceBright = Color(0xFFFAFDFC), // neutral99
    surfaceDim = Color(0xFFD8DBDA),
)

// ---------------------------------------------------------------------------
// Dark scheme — resolves the [data-theme="dark"] block.
// ---------------------------------------------------------------------------
internal val DarkColors: ColorScheme = darkColorScheme(
    // Primary — palette primary80 / 20 / 30 / 90
    primary = Color(0xFF4CD9DF),
    onPrimary = Color(0xFF003739),
    primaryContainer = Color(0xFF004F52),
    onPrimaryContainer = Color(0xFF6FF7FC),

    // Secondary — palette secondary80 / 20 / 30 / 90
    secondary = Color(0xFFB1CCCC),
    onSecondary = Color(0xFF1C3435),
    secondaryContainer = Color(0xFF324B4C),
    onSecondaryContainer = Color(0xFFCCE8E8),

    // Tertiary — palette tertiary80 / 20 / 30 / 90
    tertiary = Color(0xFFACD3F4),
    onTertiary = Color(0xFF0F3452),
    tertiaryContainer = Color(0xFF284B6B),
    onTertiaryContainer = Color(0xFFD0E9FF),

    // Error — palette error80 / 20 / 30 / 90
    error = Color(0xFFFFB4AB),
    onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A),
    onErrorContainer = Color(0xFFFFDAD6),

    // Surfaces — palette neutral10 / neutral90 / neutral-variant30 / 80
    background = Color(0xFF191C1C),
    onBackground = Color(0xFFE0E3E2),
    surface = Color(0xFF191C1C),
    onSurface = Color(0xFFE0E3E2),
    surfaceVariant = Color(0xFF3F4949),
    onSurfaceVariant = Color(0xFFBEC8C8),
    outline = Color(0xFF899392),
    outlineVariant = Color(0xFF3F4949),

    // Misc
    scrim = Color(0xFF000000),
    inverseSurface = Color(0xFFE0E3E2),
    inverseOnSurface = Color(0xFF2D3131),
    inversePrimary = Color(0xFF00696D),
    surfaceTint = Color(0xFF4CD9DF),

    // Surface-container ladder (M3 Expressive, explicit tones)
    surfaceContainerHighest = Color(0xFF323535),
    surfaceContainerHigh = Color(0xFF282B2B),
    surfaceContainer = Color(0xFF1E2121),
    surfaceContainerLow = Color(0xFF191C1C), // neutral10
    surfaceContainerLowest = Color(0xFF0D0F0F),
    surfaceBright = Color(0xFF373A3A),
    surfaceDim = Color(0xFF111414),
)

package com.jvcon.numera.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable

/*
 * Numera — Compose theme entry point.
 *
 * Color is the only category with light/dark variants (design-spec §2.1);
 * typography, shape, elevation, and motion are theme-agnostic token objects.
 */
@Composable
fun NumeraTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colorScheme = if (darkTheme) DarkColors else LightColors

    MaterialTheme(
        colorScheme = colorScheme,
        typography = NumeraTypography,
        shapes = NumeraShapes,
        content = content,
    )
}

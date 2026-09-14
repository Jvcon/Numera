package com.jvcon.numera.ui.theme

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * Numera — Material 3 elevation (Android mirror).
 *
 * Source: web/src/styles/elevation.css. The web layer expresses elevation as
 * layered box-shadows (blur/spread/alpha); Android/Compose expresses it as a
 * single tonal/shadow [Dp]. We map the six CSS levels to the Material 3 dp
 * scale (a standard, monotonic approximation):
 *
 *   level0 = 0dp
 *   level1 = 1dp
 *   level2 = 3dp
 *   level3 = 6dp
 *   level4 = 8dp
 *   level5 = 12dp
 *
 * Semantic role aliases resolve exactly as in elevation.css so intent survives
 * the platform translation. Components should prefer a role alias over a raw
 * level.
 */
object NumeraElevation {
    // Raw levels
    val level0: Dp = 0.dp
    val level1: Dp = 1.dp
    val level2: Dp = 3.dp
    val level3: Dp = 6.dp
    val level4: Dp = 8.dp
    val level5: Dp = 12.dp

    // Semantic role aliases
    val card: Dp = level1
    val cardHover: Dp = level2
    val menu: Dp = level2
    val tooltip: Dp = level2
    val snackbar: Dp = level3
    val navDrawer: Dp = level1
    val bottomSheet: Dp = level2
    val dialog: Dp = level3
    val fabRest: Dp = level3
    val fabHover: Dp = level4
    val fabPressed: Dp = level5
}

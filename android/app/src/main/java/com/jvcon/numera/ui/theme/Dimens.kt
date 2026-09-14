package com.jvcon.numera.ui.theme

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * Numera — density, touch-target, and layout primitives (Android mirror).
 *
 * Source: web/src/styles/state.css and design-spec §13.2. CSS px map to
 * Android dp 1:1 for layout dimensions. Components compose named roles rather
 * than reaching for raw values (design-spec §15).
 */
object NumeraDimens {
    // Density — 4dp grid
    val space0: Dp = 0.dp
    val space1: Dp = 4.dp
    val space2: Dp = 8.dp
    val space3: Dp = 12.dp
    val space4: Dp = 16.dp
    val space5: Dp = 20.dp
    val space6: Dp = 24.dp
    val space8: Dp = 32.dp
    val space10: Dp = 40.dp
    val space12: Dp = 48.dp

    // Semantic spacing roles
    val spacingInlineTight: Dp = space1
    val spacingInline: Dp = space2
    val spacingInlineLoose: Dp = space3
    val spacingBlockTight: Dp = space2
    val spacingBlock: Dp = space4
    val spacingBlockLoose: Dp = space6
    val spacingSection: Dp = space8

    // Touch targets — Material 3 minimums
    val touchTargetMin: Dp = 44.dp
    val touchTargetComfortable: Dp = 48.dp
    val touchTargetLarge: Dp = 56.dp

    // Standard layout primitives
    val appBarHeight: Dp = 64.dp
    val bottomBarHeight: Dp = 32.dp
    val navRailWidth: Dp = 80.dp
    val sidePanelWidth: Dp = 280.dp
}

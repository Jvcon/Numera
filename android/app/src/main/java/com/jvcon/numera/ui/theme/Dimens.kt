package com.jvcon.numera.ui.theme

import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/*
 * Numera — density, touch-target, and layout primitives (Android mirror).
 *
 * Source: web/src/styles/state.css and design-spec §13.2. CSS px map to
 * Android dp 1:1 for layout dimensions. Components compose named roles rather
 * than reaching for raw values (design-spec §15).
 *
 * Only the steps the app actually composes from are declared — no dead tokens.
 * The web-only status-bar height and navigation-rail width are intentionally
 * absent: Android uses the system status/navigation bars, and this shell is
 * drawer / persistent-sidebar only.
 */
object NumeraDimens {
    // Density — 4dp grid
    val space1: Dp = 4.dp
    val space2: Dp = 8.dp
    val space3: Dp = 12.dp
    val space4: Dp = 16.dp
    val space5: Dp = 20.dp
    val space6: Dp = 24.dp

    // Semantic spacing roles
    val spacingInlineTight: Dp = space1
    val spacingInline: Dp = space2
    val spacingInlineLoose: Dp = space3
    val spacingBlockTight: Dp = space2
    val spacingBlock: Dp = space4
    val spacingBlockLoose: Dp = space6

    // Touch targets — Material 3 minimums
    val touchTargetMin: Dp = 44.dp
    val touchTargetComfortable: Dp = 48.dp
    val touchTargetLarge: Dp = 56.dp

    // Standard layout primitives
    val appBarHeight: Dp = 64.dp
    val sidePanelWidth: Dp = 280.dp

    // Editor / result gutter
    val resultGutterWidth: Dp = 112.dp
    val errorUnderlineStroke: Dp = 1.dp
    val errorUnderlineDash: Dp = 4.dp
    val errorUnderlineGap: Dp = 3.dp
    val errorUnderlineOffset: Dp = 2.dp

    // Icons — small = inline actions/result status, medium = list leading icons
    val iconSmall: Dp = 16.dp
    val iconMedium: Dp = space5

    // Floating action button + speed-dial actions
    val fabSize: Dp = touchTargetLarge
    val speedDialActionSize: Dp = touchTargetMin
}

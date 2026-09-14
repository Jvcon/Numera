package com.jvcon.numera.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

/*
 * Numera — Material 3 shape scale (Android mirror).
 *
 * Values transcribed 1:1 from web/src/styles/shape.css. Components pick a
 * role by intent (text field, card, dialog, …); the M3 [Shapes] slots are the
 * Android equivalent of the --md-sys-shape-corner-* contract.
 */
val NumeraShapes: Shapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),  // text fields, chips, snackbar, tooltip
    small = RoundedCornerShape(8.dp),       // small buttons
    medium = RoundedCornerShape(12.dp),     // cards, dialogs
    large = RoundedCornerShape(16.dp),      // large sheets
    extraLarge = RoundedCornerShape(28.dp), // FAB surface, navigation rail
)

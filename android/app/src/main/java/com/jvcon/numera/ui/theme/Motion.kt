package com.jvcon.numera.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing

/*
 * Numera — Material 3 motion (Android mirror).
 *
 * Source: web/src/styles/motion.css. Duration is decoupled from animation
 * type; prefer the emphasized easing family for anything user-perceivable.
 * Control points are transcribed exactly.
 */
object NumeraMotion {
    // Durations (milliseconds)
    const val durationInstant: Int = 0
    const val durationFast: Int = 100
    const val durationMedium: Int = 200
    const val durationEmphasized: Int = 300
    const val durationLong: Int = 400

    // Easing — emphasized family
    val emphasized: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val emphasizedDecelerate: Easing = CubicBezierEasing(0.05f, 0.7f, 0.1f, 1f)
    val emphasizedAccelerate: Easing = CubicBezierEasing(0.3f, 0f, 0.8f, 0.15f)

    // Easing — standard family
    val standard: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
    val standardDecelerate: Easing = CubicBezierEasing(0f, 0f, 0.2f, 1f)
    val standardAccelerate: Easing = CubicBezierEasing(0.3f, 0f, 1f, 1f)

    // Easing — enter / exit
    val exit: Easing = CubicBezierEasing(0.4f, 0f, 1f, 1f)
    val enter: Easing = CubicBezierEasing(0f, 0f, 0.2f, 1f)

    // State-layer opacities (also declared in state.css / motion.css)
    const val stateHoverOpacity: Float = 0.08f
    const val stateFocusOpacity: Float = 0.10f
    const val statePressedOpacity: Float = 0.12f
    const val stateDraggedOpacity: Float = 0.16f
}

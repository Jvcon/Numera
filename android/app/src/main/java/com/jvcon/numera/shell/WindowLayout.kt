package com.jvcon.numera.shell

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo

/**
 * Android window-size class, per design-spec §13.1 (Material 3 canonical
 * breakpoints). Kept as an app enum so the shell is a pure function of it and
 * every form factor is reachable from tests without a real window.
 */
enum class AppWindowSizeClass { COMPACT, MEDIUM, EXPANDED }

/**
 * Which window edge a separating hinge sits on.
 *
 * [NONE] — no separating hinge. [START] — hinge near the start edge (left in
 * LTR): content is pushed past it and the FAB snaps to the far (end) edge.
 * [END] — hinge near the end edge: the FAB snaps back to the start edge.
 */
enum class HingeEdge { NONE, START, END }

/**
 * A separating fold hinge expressed as the hard margin it imposes on the shell.
 *
 * The hinge is never split across (design-spec §13.3: "treat the hinge as a
 * hard margin"); [size] is the hinge's width and [edge] is the side it occupies.
 */
data class HingeInsets(
    val edge: HingeEdge = HingeEdge.NONE,
    val size: Dp = 0.dp,
)

/**
 * Resolved, layout-independent window facts the shell renders from.
 *
 * Deliberately NOT part of `WorkspaceState` — form factor is chrome-only
 * (design-spec §13.4: the state model is form-factor agnostic).
 */
data class AppWindowLayout(
    val sizeClass: AppWindowSizeClass,
    val hinge: HingeInsets = HingeInsets(),
)

/** Material 3 width breakpoints: Compact < 600dp, Medium < 840dp, else Expanded. */
fun appWindowSizeClassForWidthDp(widthDp: Float): AppWindowSizeClass = when {
    widthDp < 600f -> AppWindowSizeClass.COMPACT
    widthDp < 840f -> AppWindowSizeClass.MEDIUM
    else -> AppWindowSizeClass.EXPANDED
}

/** Pure mapping used by [rememberAppWindowLayout] and unit tests. */
fun appWindowLayoutForWidthDp(widthDp: Float): AppWindowLayout =
    AppWindowLayout(sizeClass = appWindowSizeClassForWidthDp(widthDp))

/**
 * The content edge the FAB snaps to — away from a separating hinge so no
 * floating element ever lands on it (design-spec §13.3).
 */
fun fabEdgeFor(hinge: HingeInsets): HingeEdge = when (hinge.edge) {
    HingeEdge.END -> HingeEdge.START
    HingeEdge.NONE, HingeEdge.START -> HingeEdge.END
}

/**
 * Reads the real window width + fold posture.
 *
 * Only this function touches `androidx.window`; the shell receives the result
 * as [AppWindowLayout] so UI tests can inject any form factor directly.
 * `FoldingFeature` only reports on foldable hardware (API 29+); on every other
 * device the display-feature list is empty and [HingeInsets] stays neutral.
 */
@Composable
fun rememberAppWindowLayout(): AppWindowLayout {
    val context = LocalContext.current
    val configuration = LocalConfiguration.current
    val density = LocalDensity.current
    val widthDp = configuration.screenWidthDp.toFloat()
    val activity = remember(context) { context.findActivity() }

    val windowLayout by produceState<WindowLayoutInfo?>(initialValue = null, activity) {
        val host = activity
        if (host != null) {
            WindowInfoTracker.getOrCreate(host)
                .windowLayoutInfo(host)
                .collect { value = it }
        }
    }

    val hinge = remember(windowLayout, widthDp, density) {
        val feature = windowLayout?.displayFeatures
            ?.filterIsInstance<FoldingFeature>()
            ?.firstOrNull {
                it.isSeparating && it.orientation == FoldingFeature.Orientation.VERTICAL
            }
        if (feature == null || widthDp <= 0f) {
            HingeInsets()
        } else {
            val leftDp = with(density) { feature.bounds.left.toDp().value }
            val rightDp = with(density) { feature.bounds.right.toDp().value }
            val size = (rightDp - leftDp).coerceAtLeast(0f).dp
            val centerDp = (leftDp + rightDp) / 2f
            if (centerDp < widthDp / 2f) {
                HingeInsets(edge = HingeEdge.START, size = size)
            } else {
                HingeInsets(edge = HingeEdge.END, size = size)
            }
        }
    }

    return AppWindowLayout(
        sizeClass = appWindowSizeClassForWidthDp(widthDp),
        hinge = hinge,
    )
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

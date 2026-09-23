package com.jvcon.numera.shell

import androidx.compose.ui.unit.dp
import kotlin.test.assertEquals
import org.junit.Test

/**
 * S1 tests for the pure window-size-class mapping and FAB hinge rule
 * (design-spec §13.1 / §13.3).
 */
class WindowLayoutTest {

    @Test
    fun widthMapsToCanonicalMaterial3SizeClasses() {
        assertEquals(AppWindowSizeClass.COMPACT, appWindowSizeClassForWidthDp(320f))
        assertEquals(AppWindowSizeClass.COMPACT, appWindowSizeClassForWidthDp(599f))
        assertEquals(AppWindowSizeClass.MEDIUM, appWindowSizeClassForWidthDp(600f))
        assertEquals(AppWindowSizeClass.MEDIUM, appWindowSizeClassForWidthDp(839f))
        assertEquals(AppWindowSizeClass.EXPANDED, appWindowSizeClassForWidthDp(840f))
        assertEquals(AppWindowSizeClass.EXPANDED, appWindowSizeClassForWidthDp(1280f))
    }

    @Test
    fun widthOnlyLayoutHasNoHinge() {
        val layout = appWindowLayoutForWidthDp(900f)

        assertEquals(AppWindowSizeClass.EXPANDED, layout.sizeClass)
        assertEquals(HingeEdge.NONE, layout.hinge.edge)
        assertEquals(0.dp, layout.hinge.size)
    }

    @Test
    fun fabSnapsAwayFromASeparatingHinge() {
        // No hinge → conventional end corner.
        assertEquals(HingeEdge.END, fabEdgeFor(HingeInsets()))
        // Hinge on the start edge → FAB moves to the end corner, still clear of it.
        assertEquals(HingeEdge.END, fabEdgeFor(HingeInsets(HingeEdge.START, 40.dp)))
        // Hinge on the end edge → FAB snaps back to the start corner.
        assertEquals(HingeEdge.START, fabEdgeFor(HingeInsets(HingeEdge.END, 40.dp)))
    }
}

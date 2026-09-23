package com.jvcon.numera.shell

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.unit.dp
import com.jvcon.numera.engine.EnginePort
import com.jvcon.numera.engine.LineOutcome
import com.jvcon.numera.ui.theme.NumeraTheme
import com.jvcon.numera.workspace.WorkspaceViewModel
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * S4 Compose UI tests for the responsive shell (issue #12).
 *
 * The window layout is injected, so Compact / Expanded / hinge postures are
 * exercised deterministically without a real window.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AppShellTest {

    @get:Rule
    val composeRule = createComposeRule()

    private fun renderShell(
        viewModel: WorkspaceViewModel,
        layout: AppWindowLayout,
    ) {
        composeRule.setContent {
            NumeraTheme {
                AppShell(viewModel = viewModel, layout = layout)
            }
        }
        composeRule.waitForIdle()
    }

    @Test
    fun compact_drawerOpensAndSelectingAFileSwitchesTheEditor() {
        val vm = newViewModel()
        renderShell(vm, AppWindowLayout(AppWindowSizeClass.COMPACT))

        // Drawer starts closed; the menu affordance is in the editor top bar.
        composeRule.onNodeWithTag("file-list", useUnmergedTree = true).assertIsNotDisplayed()
        composeRule.onNodeWithTag("open-nav").assertIsDisplayed().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("file-list", useUnmergedTree = true).assertIsDisplayed()

        val active = vm.state.value.activeFileId
        val target = vm.state.value.files.first { it.id != active && it.folderId == null }
        composeRule.onNodeWithTag("file-list", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("file-row-${target.id}"))
        composeRule.onNodeWithTag("file-row-${target.id}").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("editor-title").assertTextEquals(target.displayName)
    }

    @Test
    fun expanded_showsPersistentSidebarAndNoDrawerAffordance() {
        val vm = newViewModel()
        renderShell(vm, AppWindowLayout(AppWindowSizeClass.EXPANDED))

        composeRule.onNodeWithTag("file-list", useUnmergedTree = true).assertIsDisplayed()
        composeRule.onNodeWithTag("open-nav").assertDoesNotExist()
    }

    @Test
    fun hinge_snapsTheFabAwayFromTheHingeEdge() {
        val vm = newViewModel()
        renderShell(
            vm,
            AppWindowLayout(
                sizeClass = AppWindowSizeClass.EXPANDED,
                hinge = HingeInsets(edge = HingeEdge.END, size = 40.dp),
            ),
        )

        val rootRect = composeRule.onRoot(useUnmergedTree = true)
            .fetchSemanticsNode().boundsInRoot
        val fabRect = composeRule.onNodeWithTag("fab").fetchSemanticsNode().boundsInRoot

        // Hinge on the end edge → the FAB must snap to the start side instead.
        assertTrue(
            fabRect.right <= rootRect.center.x,
            "FAB must stay clear of the end-side hinge: fab=$fabRect root=$rootRect",
        )
    }

    @Test
    fun fab_expandsToThreeActionsAndScrimCollapsesIt() {
        val vm = newViewModel()
        renderShell(vm, AppWindowLayout(AppWindowSizeClass.EXPANDED))

        composeRule.onNodeWithTag("fab-new-file").assertDoesNotExist()

        composeRule.onNodeWithTag("fab").assertIsDisplayed().performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("fab-new-file").assertIsDisplayed()
        composeRule.onNodeWithTag("fab-new-draft").assertIsDisplayed()
        composeRule.onNodeWithTag("fab-search").assertIsDisplayed()

        composeRule.onNodeWithTag("fab-scrim").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("fab-new-file").assertDoesNotExist()
    }

    @Test
    fun pinActionMutatesWorkspaceState() {
        val vm = newViewModel()
        renderShell(vm, AppWindowLayout(AppWindowSizeClass.EXPANDED))

        val file = vm.state.value.files.first { !it.draft && !it.pinned }
        composeRule.onNodeWithTag("pin-file-${file.id}").performClick()
        composeRule.waitForIdle()

        assertTrue(vm.state.value.files.first { it.id == file.id }.pinned)
    }

    @Test
    fun searchActionRevealsTheFilterField() {
        val vm = newViewModel()
        renderShell(vm, AppWindowLayout(AppWindowSizeClass.EXPANDED))

        composeRule.onNodeWithTag("search-field", useUnmergedTree = true).assertDoesNotExist()

        composeRule.onNodeWithTag("fab").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithTag("fab-search").performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("search-field", useUnmergedTree = true).assertIsDisplayed()
    }

    private fun newViewModel(): WorkspaceViewModel {
        val vm = WorkspaceViewModel(
            FakeShellEngine(),
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
        )
        runBlocking { vm.hydrate() }
        runBlocking { vm.evaluateActiveFile() }
        return vm
    }
}

/** Empty engine: the shell tests only exercise chrome + state wiring. */
private class FakeShellEngine : EnginePort {
    override suspend fun setGlobals(content: String) = Unit

    override suspend fun setDocuments(aliases: Map<String, String>) = Unit

    override suspend fun evaluateDocument(document: String): List<LineOutcome> = emptyList()

    override suspend fun eval(line: String): String = ""

    override suspend fun applyRates(rates: Map<String, Double>): Int = 0

    override fun expressionPrefixUtf16Len(line: String): Int = line.trimEnd().length
}

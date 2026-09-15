package com.jvcon.numera.editor

import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
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
 * S4 Compose UI tests for [EditorScreen] (issue #11).
 *
 * These run on the local JVM under Robolectric — no emulator. The view model is
 * driven by a hand-rolled [FakeEnginePort] whose suspend methods never suspend,
 * so a `Dispatchers.Unconfined` scope runs `evaluateActiveFile()` synchronously
 * and the state is settled before the editor composes.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class EditorScreenTest {

    @get:Rule
    val composeRule = createComposeRule()

    /** Five logical lines: two values, a blank, a comment, then an error. */
    private val testContent = "a = 1\nb = 2\n\n# comment\nbad = 1/0"

    // -------------------------------------------------------------------------
    // 1. Result gutter — index-aligned values, empty/comment lines skipped, and
    //    live updates when outcomes change.
    // -------------------------------------------------------------------------

    @Test
    fun resultGutter_rendersValuesAndSkipsEmptyAndCommentLines() {
        val engine = FakeEnginePort().apply {
            outcomes = listOf(
                value("1"),
                value("2"),
                empty(),
                empty(),
                error("division by zero"),
            )
        }
        renderEditor(engine)

        composeRule.onNodeWithTag("result-gutter").assertIsDisplayed()
        composeRule.onNodeWithTag("result-0").assertIsDisplayed().assertTextEquals("1")
        composeRule.onNodeWithTag("result-1").assertIsDisplayed().assertTextEquals("2")
        // Blank line (2) and comment line (3) emit no result cell.
        composeRule.onNodeWithTag("result-2").assertDoesNotExist()
        composeRule.onNodeWithTag("result-3").assertDoesNotExist()
        composeRule.onNodeWithTag("error-4").assertIsDisplayed()
    }

    @Test
    fun resultGutter_updatesWhenOutcomesChange() {
        val engine = FakeEnginePort().apply {
            outcomes = listOf(
                value("1"),
                value("2"),
                empty(),
                empty(),
                error("division by zero"),
            )
        }
        val vm = renderEditor(engine)

        composeRule.onNodeWithTag("result-2").assertDoesNotExist()

        // The blank line becomes a value line: the gutter must pick it up live.
        engine.outcomes = listOf(
            value("1"),
            value("2"),
            value("42"),
            empty(),
            error("division by zero"),
        )
        runBlocking { vm.evaluateActiveFile() }
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("result-2").assertIsDisplayed().assertTextEquals("42")
    }

    @Test
    fun editor_reflectsTypedText() {
        val vm = renderEditor(FakeEnginePort())

        composeRule.onNodeWithTag("editor").performClick()
        composeRule.onNodeWithTag("editor").performTextInput("Z")
        composeRule.waitForIdle()

        val active = vm.state.value
        val content = active.files.firstOrNull { it.id == active.activeFileId }?.content ?: ""
        assertTrue(
            content.contains("Z"),
            "expected the typed text to reach the view model; was: $content",
        )
    }

    // -------------------------------------------------------------------------
    // 2. Error state — tapping an error cell surfaces its message.
    // -------------------------------------------------------------------------

    @Test
    fun errorCell_tapShowsErrorMessageInSnackbar() {
        val engine = FakeEnginePort().apply {
            outcomes = listOf(
                value("1"),
                value("2"),
                empty(),
                empty(),
                error("division by zero"),
            )
        }
        renderEditor(engine)

        composeRule.onNodeWithTag("error-4").assertIsDisplayed().performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithText("division by zero").assertIsDisplayed()
    }

    // -------------------------------------------------------------------------
    // 3. Copy — tapping a value cell fires the copy path ("Copied" snackbar).
    // -------------------------------------------------------------------------

    @Test
    fun valueCell_tapShowsCopiedSnackbar() {
        val engine = FakeEnginePort().apply {
            outcomes = listOf(
                value("1"),
                value("2"),
                empty(),
                empty(),
                error("division by zero"),
            )
        }
        renderEditor(engine)

        composeRule.onNodeWithTag("result-0").assertIsDisplayed().performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithText("Copied").assertIsDisplayed()
    }

    // -------------------------------------------------------------------------
    // 4. Globals toggle — title + back affordance flip with the editing target.
    // -------------------------------------------------------------------------

    @Test
    fun globalsToggle_switchesTitleAndBackAffordance() {
        val engine = FakeEnginePort().apply {
            outcomes = listOf(
                value("1"),
                value("2"),
                empty(),
                empty(),
                error("division by zero"),
            )
        }
        renderEditor(engine)

        // FILE mode: active file title, globals entry point, no back arrow.
        composeRule.onNodeWithTag("editor-title").assertTextEquals("Budget 2026")
        composeRule.onNodeWithTag("open-globals").assertIsDisplayed()
        composeRule.onNodeWithTag("editor-back").assertDoesNotExist()
        composeRule.onNodeWithTag("new-draft").assertIsDisplayed()

        composeRule.onNodeWithTag("open-globals").performClick()
        composeRule.waitForIdle()

        // GLOBALS mode: globals title, back arrow, no globals entry point.
        composeRule.onNodeWithTag("editor-title").assertTextEquals("Globals")
        composeRule.onNodeWithTag("editor-back").assertIsDisplayed()
        composeRule.onNodeWithTag("open-globals").assertDoesNotExist()

        composeRule.onNodeWithTag("editor-back").performClick()
        composeRule.waitForIdle()

        // Back in FILE mode.
        composeRule.onNodeWithTag("editor-title").assertTextEquals("Budget 2026")
        composeRule.onNodeWithTag("open-globals").assertIsDisplayed()
        composeRule.onNodeWithTag("editor-back").assertDoesNotExist()
    }

    // -------------------------------------------------------------------------
    // Harness
    // -------------------------------------------------------------------------

    /**
     * Hydrates (no persister, so `hydrating` clears immediately), seeds
     * [testContent], evaluates, then composes the editor over [engine].
     */
    private fun renderEditor(engine: FakeEnginePort): WorkspaceViewModel {
        val vm = WorkspaceViewModel(
            engine,
            CoroutineScope(SupervisorJob() + Dispatchers.Unconfined),
        )
        runBlocking { vm.hydrate() }
        vm.setActiveContent(testContent)
        runBlocking { vm.evaluateActiveFile() }

        composeRule.setContent {
            NumeraTheme {
                EditorScreen(viewModel = vm)
            }
        }
        composeRule.waitForIdle()
        return vm
    }

    private fun value(display: String): LineOutcome = LineOutcome(
        display = display,
        error = null,
        isEmpty = false,
        isError = false,
        kind = "number",
        rawValue = null,
    )

    private fun empty(): LineOutcome = LineOutcome(
        display = "",
        error = null,
        isEmpty = true,
        isError = false,
        kind = "empty",
        rawValue = null,
    )

    private fun error(message: String): LineOutcome = LineOutcome(
        display = "",
        error = message,
        isEmpty = false,
        isError = true,
        kind = "error",
        rawValue = null,
    )
}

/**
 * In-memory [EnginePort]. Unlike the S1 fake, [expressionPrefixUtf16Len]
 * returns the real trimmed length so result anchors land on the correct logical
 * line — that is what makes the gutter render at the matching index.
 */
private class FakeEnginePort : EnginePort {
    var outcomes: List<LineOutcome> = emptyList()

    override suspend fun setGlobals(content: String) = Unit

    override suspend fun setDocuments(aliases: Map<String, String>) = Unit

    override suspend fun evaluateDocument(document: String): List<LineOutcome> = outcomes

    override suspend fun eval(line: String): String = ""

    override suspend fun applyRates(rates: Map<String, Double>): Int = 0

    override fun expressionPrefixUtf16Len(line: String): Int = line.trimEnd().length
}

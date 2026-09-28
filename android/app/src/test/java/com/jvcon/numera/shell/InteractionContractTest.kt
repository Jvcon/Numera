package com.jvcon.numera.shell

import java.io.File
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.junit.Test

/**
 * Conformance test for the platform-neutral navigation model (issue: interaction
 * contract). Reads the shared fixture at `contracts/interaction.json` (path
 * injected as the `numera.contract` system property by the Gradle test task) and
 * asserts the invariants in `docs/interaction-model.md`.
 *
 * Plain JVM — no Robolectric, no device.
 */
class InteractionContractTest {

    private val contract: InteractionContract by lazy {
        val path = System.getProperty("numera.contract")
            ?: error("numera.contract system property is not set")
        val file = File(path)
        check(file.exists()) { "interaction contract not found at $path" }
        InteractionContract.parse(file.readText())
    }

    @Test
    fun `leading slot exposes at most one affordance on every size class`() {
        for (sizeClass in AppWindowSizeClass.values()) {
            val leading = contract.leadingAffordances(sizeClass)
            assertTrue(
                leading.size <= 1,
                "leading slot must hold <= 1 affordance on $sizeClass, got $leading",
            )
        }
    }

    @Test
    fun `leading is menu on compact and medium and none on expanded`() {
        assertEquals(listOf("menu"), contract.leadingAffordances(AppWindowSizeClass.COMPACT))
        assertEquals(listOf("menu"), contract.leadingAffordances(AppWindowSizeClass.MEDIUM))
        assertEquals(emptyList(), contract.leadingAffordances(AppWindowSizeClass.EXPANDED))
    }

    @Test
    fun `globals and draft are non-list editing targets while file is a list member`() {
        assertTrue(contract.isInFileList("file"))
        assertFalse(contract.isInFileList("globals"))
        assertFalse(contract.isInFileList("draft"))
    }

    @Test
    fun `non-list targets exit with exit-editing-target and a trailing close`() {
        for (id in listOf("globals", "draft")) {
            assertEquals("exit-editing-target", contract.editingTarget(id)?.exit)
            val trailing = contract.trailingActions(id)
            assertTrue(
                trailing.contains("exit-editing-target"),
                "$id trailing actions must include exit-editing-target, got $trailing",
            )
            assertFalse(trailing.contains("up"), "$id must not exit with an up/back action")
        }
        assertEquals("close", contract.topBar.exitIcon)
    }

    @Test
    fun `file target trailing actions have no exit`() {
        assertEquals(listOf("new-draft", "open-globals"), contract.trailingActions("file"))
    }

    @Test
    fun `back precedence is overlay then drawer then editing target then root`() {
        assertEquals(
            "dismiss-overlay",
            contract.resolveBack(overlayOpen = true, drawerOpen = true, editingTargetId = "globals"),
        )
        assertEquals(
            "close-drawer",
            contract.resolveBack(overlayOpen = false, drawerOpen = true, editingTargetId = "globals"),
        )
        assertEquals(
            "exit-editing-target",
            contract.resolveBack(overlayOpen = false, drawerOpen = false, editingTargetId = "globals"),
        )
        assertEquals(
            "exit-editing-target",
            contract.resolveBack(overlayOpen = false, drawerOpen = false, editingTargetId = "draft"),
        )
        assertEquals(
            "root-exit",
            contract.resolveBack(overlayOpen = false, drawerOpen = false, editingTargetId = "file"),
        )
    }

    @Test
    fun `command surface is named Command and no surface uses a forbidden synonym`() {
        val command = contract.surfaces.firstOrNull { it.id == "command" }
        assertNotNull(command, "command surface must exist")
        assertEquals("Command", command.label)
        assertTrue(command.entry.contains("fab:command"))
        assertTrue(command.entry.contains("keybinding:cmd+k"))

        val forbidden = contract.forbiddenSynonyms["command"].orEmpty()
        for (surface in contract.surfaces) {
            assertFalse(
                forbidden.contains(surface.id),
                "surface id '${surface.id}' is a forbidden synonym for command",
            )
            surface.label?.let {
                assertFalse(
                    forbidden.contains(it.lowercase()),
                    "surface label '$it' is a forbidden synonym for command",
                )
            }
        }
    }
}

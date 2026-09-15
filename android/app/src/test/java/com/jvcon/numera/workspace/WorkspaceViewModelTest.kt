package com.jvcon.numera.workspace

import com.jvcon.numera.engine.EnginePort
import com.jvcon.numera.engine.LineOutcome
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import org.junit.Test

/**
 * JVM tests for [WorkspaceViewModel] (seam S1).
 *
 * The view model is a plain JVM class driven by [FakeEnginePort], so no Android
 * device or native library is needed. The scope uses
 * [Dispatchers.Unconfined] so fire-and-forget `scope.launch { evaluate... }`
 * runs synchronously to completion (the fake's suspend methods never suspend);
 * `evaluateActiveFile()` is also awaited directly under [runBlocking] where
 * determinism matters.
 */
class WorkspaceViewModelTest {

    private fun newVm(engine: FakeEnginePort = FakeEnginePort()): WorkspaceViewModel =
        WorkspaceViewModel(engine, CoroutineScope(SupervisorJob() + Dispatchers.Unconfined))

    private fun rootOrders(vm: WorkspaceViewModel): List<Int> {
        val s = vm.state.value
        return (s.files.filter { it.folderId == null }.map { it.order } + s.folders.map { it.order }).sorted()
    }

    // -------------------------------------------------------------------------
    // 1. Defaults
    // -------------------------------------------------------------------------

    @Test
    fun defaultsAreSeededAndNormalized() {
        val vm = newVm()
        val s = vm.state.value

        assertEquals(3, s.files.size)
        assertEquals(1, s.folders.size)

        val budget = s.files.first { it.id == "budget" }
        assertTrue(budget.pinned)
        assertEquals(0, budget.order)

        val folder = s.folders.single()
        assertEquals("daily", folder.name)

        val daily = s.files.first { it.id == "daily" }
        assertEquals(folder.id, daily.folderId)

        val cheatsheet = s.files.first { it.id == "cheatsheet" }
        assertEquals(2, cheatsheet.order)
        assertEquals(1, folder.order)

        assertEquals("budget", s.activeFileId)
        assertEquals(EditingTarget.FILE, s.editingTarget)
        assertEquals(EditorMode.STANDARD, s.mode)
        assertEquals(Annotations.EMPTY_ANNOTATIONS, s.annotations)
        assertEquals(emptyList(), s.outcomes)
        assertNull(s.lastError)
        assertTrue(s.hydrating)

        // Root orders are contiguous after normalization.
        assertEquals(listOf(0, 1, 2), rootOrders(vm))
        // Files keep the workspace-array order (not display order).
        assertEquals(listOf("budget", "daily", "cheatsheet"), s.files.map { it.id })
    }

    // -------------------------------------------------------------------------
    // 2. Pin ordering
    // -------------------------------------------------------------------------

    @Test
    fun togglePinMovesWithinGroupAndKeepsOrdersContiguous() {
        val vm = newVm()

        vm.togglePin("cheatsheet")
        val pinned = vm.state.value.files.first { it.id == "cheatsheet" }
        assertTrue(pinned.pinned)
        assertEquals(0, pinned.order)
        assertEquals(1, vm.state.value.files.first { it.id == "budget" }.order)
        assertEquals(listOf(0, 1, 2), rootOrders(vm))

        vm.togglePin("cheatsheet")
        val unpinned = vm.state.value.files.first { it.id == "cheatsheet" }
        assertFalse(unpinned.pinned)
        assertEquals(2, unpinned.order)
        assertEquals(0, vm.state.value.files.first { it.id == "budget" }.order)
        assertEquals(listOf(0, 1, 2), rootOrders(vm))
    }

    // -------------------------------------------------------------------------
    // 3. Folders
    // -------------------------------------------------------------------------

    @Test
    fun folderMutations() {
        val vm = newVm()

        val created = vm.createFolder("archive")
        assertEquals("archive", created.name)
        assertEquals(3, created.order) // end of root non-pinned group
        assertEquals(2, vm.state.value.folders.size)

        assertFailsWith<IllegalArgumentException> { vm.createFolder("") }
        assertFailsWith<IllegalArgumentException> { vm.createFolder("a/b") }

        vm.renameFolder(created.id, "  Archive  ")
        assertEquals("Archive", vm.state.value.folders.first { it.id == created.id }.name)

        // deleteFolder re-homes its files to root with folderId=null + basename.
        val dailyFolder = vm.state.value.folders.first { it.name == "daily" }
        vm.deleteFolder(dailyFolder.id)
        val daily = vm.state.value.files.first { it.id == "daily" }
        assertNull(daily.folderId)
        assertEquals("2026-09-07.numr", daily.path)
        assertTrue(vm.state.value.folders.none { it.id == dailyFolder.id })

        val archive = vm.state.value.folders.first { it.name == "Archive" }
        assertFalse(archive.collapsed)
        vm.toggleFolderCollapsed(archive.id)
        assertTrue(vm.state.value.folders.first { it.id == archive.id }.collapsed)
    }

    // -------------------------------------------------------------------------
    // 4. Files
    // -------------------------------------------------------------------------

    @Test
    fun fileMutations() {
        val vm = newVm()

        val notes = vm.createFile("notes.numr")
        assertFalse(notes.pinned)
        assertEquals(3, notes.order) // end of root non-pinned group
        assertEquals(notes.id, vm.state.value.activeFileId)

        val plan = vm.createFile("work/plan.numr")
        val workFolder = vm.state.value.folders.first { it.name == "work" }
        assertEquals(workFolder.id, plan.folderId)
        assertEquals("plan", plan.displayName)

        vm.renameFile(notes.id, "  My Notes  ")
        assertEquals("My Notes", vm.state.value.files.first { it.id == notes.id }.displayName)

        // Deleting the active file falls back to the first remaining file.
        assertEquals(plan.id, vm.state.value.activeFileId)
        vm.deleteFile(plan.id)
        assertTrue(vm.state.value.files.none { it.id == plan.id })
        assertEquals("budget", vm.state.value.activeFileId)
    }

    // -------------------------------------------------------------------------
    // 5. Draft
    // -------------------------------------------------------------------------

    @Test
    fun draftsAreInMemoryOnly() {
        val vm = newVm()

        val draft1 = vm.createDraft()
        assertTrue(draft1.draft)
        assertEquals("draft-1", draft1.id)
        assertEquals("Draft 1", draft1.displayName)
        assertTrue(vm.state.value.files.any { it.id == "draft-1" })
        assertEquals(4, vm.state.value.files.size)

        val snapshot = vm.toSnapshot()
        assertEquals(3, snapshot.files.size)
        assertTrue(snapshot.files.none { it.id == "draft-1" })

        val draft2 = vm.createDraft()
        assertEquals("draft-2", draft2.id)
        assertTrue(vm.toSnapshot().files.none { it.id.startsWith("draft-") })
    }

    // -------------------------------------------------------------------------
    // 6. Globals / editingTarget
    // -------------------------------------------------------------------------

    @Test
    fun globalsAndEditingTarget() {
        val vm = newVm()

        vm.openGlobals()
        assertEquals(EditingTarget.GLOBALS, vm.state.value.editingTarget)

        vm.setGlobals("x = 1\n")
        assertEquals("x = 1\n", vm.state.value.globalsContent)

        vm.closeGlobals()
        assertEquals(EditingTarget.FILE, vm.state.value.editingTarget)

        vm.openGlobals()
        vm.selectFile("cheatsheet")
        assertEquals(EditingTarget.FILE, vm.state.value.editingTarget)
        assertEquals("cheatsheet", vm.state.value.activeFileId)
    }

    // -------------------------------------------------------------------------
    // 7. evaluateActiveFile — file mode
    // -------------------------------------------------------------------------

    @Test
    fun evaluateActiveFilePublishesWholeDocumentTable() {
        val engine = FakeEnginePort()
        engine.outcomes = listOf(
            LineOutcome(display = "1", isEmpty = false, isError = false, kind = "number"),
            LineOutcome(display = "2", isEmpty = false, isError = false, kind = "number"),
        )
        val vm = newVm(engine)

        val annotated = "# @money\n# @input amount\namount = 10\n"
        vm.setActiveContent(annotated)
        runBlocking { vm.evaluateActiveFile() }

        val s = vm.state.value
        assertEquals(2, s.outcomes.size)
        assertEquals(parseAnnotations(annotated), s.annotations)
        assertEquals(3, s.annotations.firstInputLine)
        assertNull(s.lastError)

        val docs = engine.lastDocuments ?: error("documents were not published")
        val active = s.files.first { it.id == s.activeFileId }
        assertEquals(annotated, active.content)
        // Known aliases for every workspace file (first-wins).
        assertEquals(annotated, docs["budget-2026.numr"])
        assertEquals(annotated, docs["budget-2026"])
        val daily = s.files.first { it.id == "daily" }
        assertEquals(daily.content, docs["2026-09-07.numr"])
        assertEquals(daily.content, docs["Daily — Sep 7"])
        val cheatsheet = s.files.first { it.id == "cheatsheet" }
        assertEquals(cheatsheet.content, docs["unit-cheatsheet"])
    }

    // -------------------------------------------------------------------------
    // 8. evaluateActiveFile — globals mode
    // -------------------------------------------------------------------------

    @Test
    fun evaluateActiveFileInGlobalsModeSkipsDocuments() {
        val engine = FakeEnginePort()
        val vm = newVm(engine)

        // A file-mode pass publishes the document table.
        runBlocking { vm.evaluateActiveFile() }
        assertEquals(1, engine.setDocumentsCalls)
        val publishedBefore = engine.lastDocuments

        vm.openGlobals()
        runBlocking { vm.evaluateActiveFile() }

        assertEquals(DEFAULT_GLOBALS, engine.lastGlobals)
        // No new setDocuments call was made.
        assertEquals(1, engine.setDocumentsCalls)
        assertEquals(publishedBefore, engine.lastDocuments)
    }

    // -------------------------------------------------------------------------
    // 9. Error path
    // -------------------------------------------------------------------------

    @Test
    fun evaluateFailureRecordsErrorAndClearsOutcomes() {
        val engine = FakeEnginePort()
        engine.throwOnEvaluate = true
        val vm = newVm(engine)

        runBlocking { vm.evaluateActiveFile() }

        assertTrue(vm.state.value.lastError != null)
        assertTrue(vm.state.value.outcomes.isEmpty())
    }

    // -------------------------------------------------------------------------
    // 10. Aliases first-wins
    // -------------------------------------------------------------------------

    @Test
    fun collectFileAliasesHasExactOrderIncludingDuplicates() {
        val file = WorkspaceFile(
            id = "daily",
            path = "daily/2026-09-07.numr",
            displayName = "Daily — Sep 7",
            pinned = false,
            folderId = null,
            order = 0,
            content = "",
        )

        assertEquals(
            listOf(
                "daily/2026-09-07.numr",
                "daily/2026-09-07.numr",
                "daily/2026-09-07",
                "2026-09-07.numr",
                "2026-09-07",
                "Daily — Sep 7",
            ),
            collectFileAliases(file),
        )
    }
}

/**
 * In-memory [EnginePort] fake (seam S1). Suspend methods never actually
 * suspend, so an [Dispatchers.Unconfined] scope runs `evaluateActiveFile`
 * synchronously.
 */
private class FakeEnginePort : EnginePort {
    var lastGlobals: String? = null
    var lastDocuments: Map<String, String>? = null
    var setDocumentsCalls: Int = 0
    var outcomes: List<LineOutcome> = emptyList()
    var throwOnEvaluate: Boolean = false
    var evalResult: String = ""
    var applyRatesResult: Int = 0

    override suspend fun setGlobals(content: String) {
        lastGlobals = content
    }

    override suspend fun setDocuments(aliases: Map<String, String>) {
        lastDocuments = aliases
        setDocumentsCalls += 1
    }

    override suspend fun evaluateDocument(document: String): List<LineOutcome> {
        if (throwOnEvaluate) throw RuntimeException("boom")
        return outcomes
    }

    override suspend fun eval(line: String): String = evalResult

    override suspend fun applyRates(rates: Map<String, Double>): Int = applyRatesResult

    override fun expressionPrefixUtf16Len(line: String): Int = 0
}

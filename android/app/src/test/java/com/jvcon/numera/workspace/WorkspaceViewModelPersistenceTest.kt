package com.jvcon.numera.workspace

import com.jvcon.numera.engine.EnginePort
import com.jvcon.numera.engine.LineOutcome
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.test.TestCoroutineScheduler
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Test

/**
 * JVM tests for the [WorkspaceViewModel] persistence seam (seam S1).
 *
 * The view model is driven by a [FakePersister] and a [FakePersistenceEnginePort].
 * The VM scope uses [UnconfinedTestDispatcher] over the [runTest] scheduler so
 * `scope.launch` runs eagerly and the debounce timer is controlled by
 * [advanceTimeBy].
 */
@OptIn(ExperimentalCoroutinesApi::class)
class WorkspaceViewModelPersistenceTest {

    private fun newVm(
        persister: WorkspacePersister,
        scheduler: TestCoroutineScheduler,
    ): WorkspaceViewModel = WorkspaceViewModel(
        FakePersistenceEnginePort(),
        CoroutineScope(UnconfinedTestDispatcher(scheduler) + SupervisorJob()),
        persister = persister,
    )

    @Test
    fun hydrateSeedsStateFromSnapshot() = runTest {
        val persister = FakePersister()
        persister.loadResult = WorkspaceSnapshot(
            files = listOf(
                PersistedFile(
                    id = "a",
                    path = "a.numr",
                    displayName = "A",
                    pinned = true,
                    folderId = null,
                    order = 0,
                    content = "a = 1\n",
                ),
                PersistedFile(
                    id = "b",
                    path = "work/b.numr",
                    displayName = "B",
                    pinned = false,
                    folderId = "f1",
                    order = 0,
                    content = "b = 2\n",
                ),
            ),
            folders = listOf(
                PersistedFolder(id = "f1", name = "work", pinned = false, collapsed = false, order = 1),
            ),
            globalsContent = "g = 1\n",
        )
        val vm = newVm(persister, testScheduler)

        vm.hydrate()

        val s = vm.state.value
        assertEquals(listOf("a", "b"), s.files.map { it.id })
        assertEquals("a = 1\n", s.files.first { it.id == "a" }.content)
        assertEquals("b = 2\n", s.files.first { it.id == "b" }.content)
        assertEquals("work", s.folders.single().name)
        assertEquals("f1", s.folders.single().id)
        assertEquals("a", s.activeFileId)
        assertEquals("g = 1\n", s.globalsContent)
        assertFalse(s.hydrating)
    }

    @Test
    fun hydrateOnFirstRunWritesDefaults() = runTest {
        val persister = FakePersister()
        persister.loadResult = null
        val vm = newVm(persister, testScheduler)

        vm.hydrate()

        assertFalse(vm.state.value.hydrating)
        // Defaults are written via a debounced save (mirrors web scheduleSave).
        assertEquals(0, persister.saveCount)
        advanceTimeBy(400)
        runCurrent()
        assertEquals(1, persister.saveCount)
    }

    @Test
    fun persistNowSavesSnapshotWithoutDrafts() = runTest {
        val persister = FakePersister()
        val vm = newVm(persister, testScheduler)

        vm.createDraft()
        vm.persistNow()

        val saved = persister.saved ?: error("nothing was saved")
        assertEquals(3, saved.files.size)
        assertTrue(saved.files.none { it.id.startsWith("draft-") })
    }

    @Test
    fun savesAreDebounced() = runTest {
        val persister = FakePersister()
        val vm = newVm(persister, testScheduler)

        vm.setActiveContent("x = 1\n")
        vm.setActiveContent("x = 2\n")

        advanceTimeBy(399)
        assertEquals(0, persister.saveCount)

        advanceTimeBy(1)
        runCurrent()
        assertEquals(1, persister.saveCount)
    }
}

/** In-memory [WorkspacePersister] fake. */
private class FakePersister : WorkspacePersister {
    var loadResult: WorkspaceSnapshot? = null
    var saved: WorkspaceSnapshot? = null
    var saveCount = 0

    override suspend fun load(): WorkspaceSnapshot? = loadResult

    override suspend fun save(snapshot: WorkspaceSnapshot) {
        saved = snapshot
        saveCount += 1
    }
}

/** Minimal [EnginePort] for persistence tests. */
private class FakePersistenceEnginePort : EnginePort {
    override suspend fun setGlobals(content: String) = Unit

    override suspend fun setDocuments(aliases: Map<String, String>) = Unit

    override suspend fun evaluateDocument(document: String): List<LineOutcome> = emptyList()

    override suspend fun eval(line: String): String = ""

    override suspend fun applyRates(rates: Map<String, Double>): Int = 0

    override fun expressionPrefixUtf16Len(line: String): Int = 0
}

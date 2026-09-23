package com.jvcon.numera.shell

import com.jvcon.numera.workspace.WorkspaceFile
import com.jvcon.numera.workspace.WorkspaceFolder
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.Test

/**
 * S1 tests for the pure file-list projection (issue #12): ordering, the shared
 * root order domain, draft exclusion, and collapsed-folder visibility.
 */
class FileListRowsTest {

    @Test
    fun pinnedItemsComeFirstThenAscendingOrder_inOneRootDomain() {
        val rows = buildFileListRows(
            files = listOf(
                file(id = "f1", order = 2),
                file(id = "f2", order = 0, pinned = true),
                file(id = "f3", order = 1),
            ),
            folders = listOf(
                folder(id = "d1", order = 0, pinned = true),
                folder(id = "d2", order = 3),
            ),
        )

        assertEquals(
            listOf("folder-d1", "file-f2", "file-f3", "file-f1", "folder-d2"),
            rows.map { it.debugKey() },
        )
    }

    @Test
    fun draftsNeverAppearInTheList() {
        val rows = buildFileListRows(
            files = listOf(
                file(id = "keep", order = 0),
                file(id = "scratch", order = 1, draft = true),
            ),
            folders = emptyList(),
        )

        assertEquals(listOf("file-keep"), rows.map { it.debugKey() })
    }

    @Test
    fun collapsedFolderHidesChildrenButKeepsItsHeaderWithCount() {
        val rows = buildFileListRows(
            files = listOf(
                file(id = "a", order = 0, folderId = "d1"),
                file(id = "b", order = 1, folderId = "d1"),
            ),
            folders = listOf(folder(id = "d1", order = 0, collapsed = true)),
        )

        assertEquals(1, rows.size)
        val header = rows.single() as FileListRow.FolderHeader
        assertEquals("d1", header.folder.id)
        assertEquals(2, header.childCount)
    }

    @Test
    fun expandedFolderListsChildrenPinnedFirst_withDepthOne() {
        val rows = buildFileListRows(
            files = listOf(
                file(id = "a", order = 0, folderId = "d1"),
                file(id = "b", order = 1, folderId = "d1", pinned = true),
            ),
            folders = listOf(folder(id = "d1", order = 0, collapsed = false)),
        )

        assertEquals(
            listOf("folder-d1", "file-b", "file-a"),
            rows.map { it.debugKey() },
        )
        assertTrue(rows.filterIsInstance<FileListRow.FileRow>().all { it.depth == 1 })
    }

    @Test
    fun searchMatchesNameCaseInsensitivelyAndBlankMatchesEverything() {
        val row = FileListRow.FileRow(file = file(id = "x", name = "Budget 2026"), depth = 0)

        assertTrue(row.matchesQuery("budget"))
        assertTrue(row.matchesQuery("2026"))
        assertTrue(row.matchesQuery("   "))
        assertFalse(row.matchesQuery("mortgage"))
    }

    private fun FileListRow.debugKey(): String = when (this) {
        is FileListRow.FolderHeader -> "folder-${folder.id}"
        is FileListRow.FileRow -> "file-${file.id}"
    }

    private fun file(
        id: String,
        order: Int = 0,
        pinned: Boolean = false,
        folderId: String? = null,
        draft: Boolean = false,
        name: String = id,
    ) = WorkspaceFile(
        id = id,
        path = "$name.numr",
        displayName = name,
        pinned = pinned,
        folderId = folderId,
        order = order,
        content = "",
        draft = draft,
    )

    private fun folder(
        id: String,
        order: Int,
        pinned: Boolean = false,
        collapsed: Boolean = false,
    ) = WorkspaceFolder(
        id = id,
        name = id,
        pinned = pinned,
        collapsed = collapsed,
        order = order,
    )
}

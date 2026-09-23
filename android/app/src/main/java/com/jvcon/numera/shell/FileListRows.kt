package com.jvcon.numera.shell

import com.jvcon.numera.workspace.WorkspaceFile
import com.jvcon.numera.workspace.WorkspaceFolder

/**
 * One rendered line of the file list: a folder header, or a file.
 *
 * Drafts never appear here — they are ephemeral scratch buffers with no list
 * presence (CONTEXT.md "draft"; design-spec §13.5).
 */
sealed interface FileListRow {
    /** A collapsible folder. [childCount] is the number of non-draft children. */
    data class FolderHeader(val folder: WorkspaceFolder, val childCount: Int) : FileListRow

    /** A file; [depth] is 0 at the root level and 1 inside a folder. */
    data class FileRow(val file: WorkspaceFile, val depth: Int) : FileListRow
}

/**
 * Flattens [files] + [folders] into display rows.
 *
 * Ordering contract (mirrors `WorkspaceState.kt`): folders and root-level files
 * share ONE root order domain; pinned items sort first, then by ascending
 * `order`. A folder's children use their own domain with the same pinned-first
 * rule and are omitted while the folder is collapsed.
 */
fun buildFileListRows(
    files: List<WorkspaceFile>,
    folders: List<WorkspaceFolder>,
): List<FileListRow> {
    val visibleFiles = files.filterNot { it.draft }
    val rootItems: List<Any> = folders + visibleFiles.filter { it.folderId == null }

    val orderedRoot = rootItems.sortedWith(
        compareByDescending<Any> { item ->
            when (item) {
                is WorkspaceFolder -> item.pinned
                is WorkspaceFile -> item.pinned
                else -> false
            }
        }.thenBy { item ->
            when (item) {
                is WorkspaceFolder -> item.order
                is WorkspaceFile -> item.order
                else -> 0
            }
        },
    )

    val rows = mutableListOf<FileListRow>()
    orderedRoot.forEach { item ->
        when (item) {
            is WorkspaceFolder -> {
                val children = visibleFiles.filter { it.folderId == item.id }
                rows += FileListRow.FolderHeader(folder = item, childCount = children.size)
                if (!item.collapsed) {
                    children
                        .sortedWith(
                            compareByDescending<WorkspaceFile> { it.pinned }.thenBy { it.order },
                        )
                        .forEach { child -> rows += FileListRow.FileRow(file = child, depth = 1) }
                }
            }

            is WorkspaceFile -> rows += FileListRow.FileRow(file = item, depth = 0)
        }
    }
    return rows
}

/** Case-insensitive name/path match used by the pane's search filter. */
fun FileListRow.matchesQuery(query: String): Boolean {
    if (query.isBlank()) return true
    val needle = query.trim().lowercase()
    return when (this) {
        is FileListRow.FileRow ->
            file.displayName.lowercase().contains(needle) ||
                file.path.lowercase().contains(needle)

        is FileListRow.FolderHeader -> folder.name.lowercase().contains(needle)
    }
}

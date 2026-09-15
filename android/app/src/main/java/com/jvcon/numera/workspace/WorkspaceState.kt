package com.jvcon.numera.workspace

import com.jvcon.numera.engine.LineOutcome

/**
 * Workspace state model — the in-memory view the editor renders.
 *
 * Faithful Kotlin port of the web `WorkspaceStore` state shape
 * (`web/src/lib/workspace.ts`). Everything is immutable; mutators in
 * [WorkspaceViewModel] copy-on-write and emit a fresh [WorkspaceState].
 *
 * Ordering model: one level of folders plus explicit ordering. The root level
 * holds both folders and root-level files (`folderId == null`), sharing ONE
 * `order` domain. Files inside a folder share a SEPARATE `order` domain scoped
 * to that folder. Display order in any scope is: pinned items first (by `order`
 * ascending), then non-pinned items (by `order` ascending).
 */

/**
 * A workspace document.
 *
 * [id] is stable — used as the key in the file list and the editor view
 * identity. [path] may change without invalidating [id].
 */
data class WorkspaceFile(
    /** Stable identifier. */
    val id: String,
    /** Full workspace path: `"folderName/file.numr"` or `"file.numr"`. */
    val path: String,
    /** Display name shown in the sidebar (falls back to path basename). */
    val displayName: String,
    /** Pinned files float to the top of their scope's list. */
    val pinned: Boolean,
    /** References [WorkspaceFolder.id]; null = root level. */
    val folderId: String?,
    /** Sort key within its scope (root, or its folder). */
    val order: Int,
    /** Editor contents. */
    val content: String,
    /** Ephemeral scratch file — never persisted. */
    val draft: Boolean = false,
)

/** A single-level folder in the root scope. */
data class WorkspaceFolder(
    /** Stable id (`UUID.randomUUID()`). */
    val id: String,
    /** Display name (no slashes). */
    val name: String,
    /** Pinned folders float to the top of the root list. */
    val pinned: Boolean,
    /** Whether the folder is visually collapsed. */
    val collapsed: Boolean,
    /** Sort key among ROOT items (shared with root files). */
    val order: Int,
)

/** What the editor is currently showing: a file, or the globals document. */
enum class EditingTarget { FILE, GLOBALS }

/** Editor mode; web stores the strings `'Normal' | 'Insert' | 'Standard'`. */
enum class EditorMode { NORMAL, INSERT, STANDARD }

/**
 * `# @money` / `# @input` / `# @result` metadata for the active document.
 *
 * [inputs] / [results] are 1-based line numbers of the annotated assignment
 * lines (ascending). [firstInputLine] is the first input line, or null.
 */
data class Annotations(
    /** True when the file-level `# @money` marker is present. */
    val money: Boolean,
    val inputs: List<Int>,
    val results: List<Int>,
    val firstInputLine: Int?,
) {
    companion object {
        /** Neutral annotations for empty/global documents. */
        val EMPTY_ANNOTATIONS = Annotations(
            money = false,
            inputs = emptyList(),
            results = emptyList(),
            firstInputLine = null,
        )
    }
}

/**
 * The complete workspace snapshot rendered by the UI.
 *
 * Field names mirror the web `WorkspaceState` one-to-one.
 */
data class WorkspaceState(
    val files: List<WorkspaceFile>,
    val folders: List<WorkspaceFolder>,
    val activeFileId: String?,
    val globalsContent: String,
    /** What the editor is currently showing: a file, or the globals doc. */
    val editingTarget: EditingTarget,
    val outcomes: List<LineOutcome>,
    /** Annotation metadata for the active file. */
    val annotations: Annotations,
    val mode: EditorMode,
    val lastError: String?,
    /** True until the first hydrate-from-persistence completes. */
    val hydrating: Boolean,
)

// ---------------------------------------------------------------------------
// Persistence seam (issue #9)
//
// These mirror the web `PersistedFile` / `PersistedFolder` rows. #8 only needs
// the shape so [WorkspaceViewModel.toSnapshot] can hand drafts-free data to a
// future Room-backed repository.
// ---------------------------------------------------------------------------

/** A persisted workspace file row (drafts are never represented here). */
data class PersistedFile(
    val id: String,
    val path: String,
    val displayName: String,
    val pinned: Boolean,
    val folderId: String?,
    val order: Int,
    val content: String,
)

/** A persisted workspace folder row. */
data class PersistedFolder(
    val id: String,
    val name: String,
    val pinned: Boolean,
    val collapsed: Boolean,
    val order: Int,
)

/** The persistable slice of a workspace (drafts excluded). */
data class WorkspaceSnapshot(
    val files: List<PersistedFile>,
    val folders: List<PersistedFolder>,
    val globalsContent: String,
)

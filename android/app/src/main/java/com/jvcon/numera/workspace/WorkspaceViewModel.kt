package com.jvcon.numera.workspace

import com.jvcon.numera.engine.EnginePort
import com.jvcon.numera.engine.LineOutcome
import java.util.UUID
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * In-memory workspace state store — a faithful Kotlin port of the web
 * `WorkspaceStore` (`web/src/lib/workspace.ts`).
 *
 * State is exposed as a [StateFlow]; every mutator copies-on-write and emits a
 * fresh [WorkspaceState]. Cross-file references are resolved by the engine: the
 * whole workspace is published as an `alias -> content` table before each
 * evaluation ([buildDocumentAliases], first-wins dedup).
 *
 * Persistence (Room) is a later ticket (#9); this class only exposes
 * [toSnapshot]. There is intentionally no `hydrate` yet.
 *
 * This is a plain JVM class (no `androidx.lifecycle.ViewModel`) so the S1 JVM
 * tests can drive it with a fake engine.
 */
class WorkspaceViewModel(
    private val engine: EnginePort,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default),
) {

    private val _state: MutableStateFlow<WorkspaceState> = MutableStateFlow(initialState())

    /** The current workspace snapshot. */
    val state: StateFlow<WorkspaceState> = _state.asStateFlow()

    private var draftCounter = 0

    /**
     * Expose the engine handle for consumers that need non-state helpers
     * (e.g. the editor's expression-prefix measurement). Mirrors web
     * `getEngine`.
     */
    fun getEngine(): EnginePort = engine

    // -------------------------------------------------------------------------
    // Evaluation
    // -------------------------------------------------------------------------

    /**
     * Re-evaluate the active document and publish outcomes.
     *
     * In globals mode the globals document is evaluated directly; in file mode
     * the whole workspace document table is published first so the engine can
     * resolve `file("...")` references while evaluating the raw document.
     */
    suspend fun evaluateActiveFile() {
        if (state.value.editingTarget == EditingTarget.GLOBALS) {
            // Evaluating the globals document itself: no cross-file references
            // apply here — globals are the shared context, not a consumer.
            try {
                engine.setGlobals(state.value.globalsContent)
                val outcomes = engine.evaluateDocument(state.value.globalsContent)
                setRawOutcomes(outcomes, lastError = null, annotations = Annotations.EMPTY_ANNOTATIONS)
            } catch (err: Exception) {
                setRawOutcomes(
                    outcomes = emptyList(),
                    lastError = err.message ?: err.toString(),
                    annotations = Annotations.EMPTY_ANNOTATIONS,
                )
            }
            return
        }

        val active = activeFile()
        if (active == null) {
            // Mirror web: only annotations/outcomes are patched; lastError is
            // left untouched.
            setRawOutcomes(
                outcomes = emptyList(),
                lastError = state.value.lastError,
                annotations = Annotations.EMPTY_ANNOTATIONS,
            )
            return
        }
        try {
            engine.setGlobals(state.value.globalsContent)
            // Publish the whole workspace to the engine so it can resolve
            // `file("...")` references while evaluating the raw document.
            engine.setDocuments(buildDocumentAliases())
            val outcomes = engine.evaluateDocument(active.content)
            setRawOutcomes(
                outcomes = outcomes,
                lastError = null,
                annotations = parseAnnotations(active.content),
            )
        } catch (err: Exception) {
            setRawOutcomes(
                outcomes = emptyList(),
                lastError = err.message ?: err.toString(),
                annotations = Annotations.EMPTY_ANNOTATIONS,
            )
        }
    }

    // -------------------------------------------------------------------------
    // Selection / content
    // -------------------------------------------------------------------------

    /** Select [id] as the active file and switch to file mode. */
    fun selectFile(id: String) {
        if (state.value.editingTarget == EditingTarget.FILE && state.value.activeFileId == id) return
        _state.update { it.copy(activeFileId = id, editingTarget = EditingTarget.FILE) }
        scope.launch { evaluateActiveFile() }
    }

    /**
     * Set the editor contents. In globals mode this delegates to [setGlobals];
     * otherwise it updates the active file (no-op when unchanged).
     */
    fun setActiveContent(content: String) {
        if (state.value.editingTarget == EditingTarget.GLOBALS) {
            setGlobals(content)
            return
        }
        val active = activeFile() ?: return
        if (active.content == content) return
        _state.update { s ->
            s.copy(files = s.files.map { if (it.id == active.id) it.copy(content = content) else it })
        }
        scope.launch { evaluateActiveFile() }
    }

    /** Replace the globals document and re-evaluate. */
    fun setGlobals(content: String) {
        _state.update { it.copy(globalsContent = content) }
        scope.launch { evaluateActiveFile() }
    }

    /** Rename a file's display name. Empty names are ignored. */
    fun renameFile(id: String, displayName: String) {
        val name = displayName.trim()
        if (name.isEmpty()) return
        if (state.value.files.none { it.id == id }) return
        _state.update { s ->
            s.copy(files = s.files.map { if (it.id == id) it.copy(displayName = name) else it })
        }
    }

    // -------------------------------------------------------------------------
    // Folders
    // -------------------------------------------------------------------------

    /** Create a new folder at the END of the root non-pinned group. */
    fun createFolder(name: String): WorkspaceFolder {
        val trimmed = name.trim()
        // A blank name (or one containing a path separator) would corrupt the
        // one-level folder invariant encoded in file paths.
        require(trimmed.isNotEmpty() && !trimmed.contains('/')) {
            "Folder name must be a non-empty, single-segment name"
        }
        val s = state.value
        val folder = makeFolder(trimmed)
        val folders = s.folders + folder
        val refs = scopeRefs(s.files, folders, null)
            .filter { it.id != folder.id }
            .toMutableList()
        refs.add(ScopedRef(ScopedRefKind.FOLDER, folder.id, pinned = false, order = 0))
        val plan = mapOf<String?, List<ScopedRef>>(null to refs)
        val next = applyPlan(s.files, folders, plan)
        _state.update { it.copy(files = next.first, folders = next.second) }
        return next.second.first { it.id == folder.id }
    }

    /**
     * Rename a folder's display name. Empty names are ignored. Child file paths
     * are intentionally left unchanged.
     */
    fun renameFolder(id: String, name: String) {
        val trimmed = name.trim()
        if (trimmed.isEmpty()) return
        if (state.value.folders.none { it.id == id }) return
        _state.update { s ->
            s.copy(folders = s.folders.map { if (it.id == id) it.copy(name = trimmed) else it })
        }
    }

    /**
     * Delete a folder and move all of its files to the root level
     * (`folderId = null`, `path = basename`). Files keep their pinned flag and
     * are appended to the end of the root scope, preserving the folder's
     * internal display order.
     */
    fun deleteFolder(id: String) {
        val s = state.value
        if (s.folders.none { it.id == id }) return

        val moved = s.files
            .filter { it.folderId == id }
            .map { it.copy(folderId = null, path = basename(it.path)) }
        val files0 = s.files.filter { it.folderId != id }
        val folders0 = s.folders.filter { it.id != id }

        // Preserve the folder's internal display order (pinned first, then by
        // order) when re-homing its files into the root list.
        val childRefs = scopeRefs(s.files, s.folders, id)
        val rootRefs = scopeRefs(files0, folders0, null).toMutableList()
        for (child in childRefs) {
            rootRefs.add(child.copy(kind = ScopedRefKind.FILE))
        }

        val filesAll = files0 + moved
        val plan = mapOf<String?, List<ScopedRef>>(null to rootRefs)
        val next = applyPlan(filesAll, folders0, plan)
        _state.update { it.copy(files = next.first, folders = next.second) }
    }

    fun toggleFolderCollapsed(id: String) {
        if (state.value.folders.none { it.id == id }) return
        _state.update { s ->
            s.copy(folders = s.folders.map { if (it.id == id) it.copy(collapsed = !it.collapsed) else it })
        }
    }

    /**
     * Flip a folder's pinned flag and reorder it to the front of the root
     * pinned group / the end of the root non-pinned group.
     */
    fun toggleFolderPin(id: String) {
        flipPinInScope(null, id, ScopedRefKind.FOLDER)
    }

    // -------------------------------------------------------------------------
    // Files
    // -------------------------------------------------------------------------

    /**
     * Flip the pinned flag on a file and reorder it to the top of its group
     * (front of the pinned block when pinning; end of the scope's non-pinned
     * block when unpinning).
     */
    fun togglePin(id: String) {
        val file = state.value.files.find { it.id == id } ?: return
        flipPinInScope(file.folderId, id, ScopedRefKind.FILE)
    }

    /**
     * Reorder a file within its current scope and group (pinned ↔ pinned,
     * non-pinned ↔ non-pinned). [beforeId] is a file id in the same scope+group
     * to insert before; null = move to the end of the group. No-op if ids are
     * invalid or not in the same group.
     */
    fun moveFile(id: String, beforeId: String?) {
        val s = state.value
        val file = s.files.find { it.id == id } ?: return
        if (beforeId == id) return

        val fileScope = file.folderId
        val refs = scopeRefs(s.files, s.folders, fileScope).toMutableList()
        val idx = refs.indexOfFirst { it.kind == ScopedRefKind.FILE && it.id == id }
        if (idx < 0) return
        val target = refs[idx]

        if (beforeId != null) {
            // `beforeId` may be a file OR a folder (folders only participate in
            // the root scope). Require it to be a member of the same scope and
            // pinned group so ordering stays within the pinned-first layout.
            val beforeIdx = refs.indexOfFirst { it.id == beforeId && it.pinned == file.pinned }
            if (beforeIdx < 0) return
            refs.removeAt(idx)
            // Recompute the insertion point after the removal (removing the
            // target can shift indices when the target precedes `beforeId`).
            val insertAt = refs.indexOfFirst { it.id == beforeId }
            refs.add(insertAt, target)
        } else if (target.pinned) {
            // Move to the END of the pinned block (just before the first
            // non-pinned member).
            refs.removeAt(idx)
            var lastPinned = -1
            refs.forEachIndexed { i, r -> if (r.pinned) lastPinned = i }
            refs.add(lastPinned + 1, target)
        } else {
            refs.removeAt(idx)
            refs.add(target)
        }

        val plan = mapOf<String?, List<ScopedRef>>(fileScope to refs)
        val next = applyPlan(s.files, s.folders, plan)
        _state.update { it.copy(files = next.first, folders = next.second) }
    }

    /**
     * Move a file into/out of a folder. Updates `folderId` and the path prefix,
     * then appends the file to the end of the target scope's non-pinned group
     * (keeping its pinned flag). Reassigns order.
     */
    fun moveFileToFolder(id: String, folderId: String?) {
        val s = state.value
        val file = s.files.find { it.id == id } ?: return
        if (folderId != null && s.folders.none { it.id == folderId }) return

        val targetPath = if (folderId == null) {
            basename(file.path)
        } else {
            "${s.folders.first { it.id == folderId }.name}/${basename(file.path)}"
        }

        val files0 = s.files.map { if (it.id == id) it.copy(folderId = folderId, path = targetPath) else it }

        val source = file.folderId
        val plan = mutableMapOf<String?, List<ScopedRef>>()
        val scopes = setOf(source, folderId)
        for (sc in scopes) {
            val refs = scopeRefs(files0, s.folders, sc)
                .filter { !(it.kind == ScopedRefKind.FILE && it.id == id) }
                .toMutableList()
            if (sc == folderId) {
                refs.add(ScopedRef(ScopedRefKind.FILE, id, pinned = file.pinned, order = 0))
            }
            plan[sc] = refs
        }

        val next = applyPlan(files0, s.folders, plan)
        _state.update { it.copy(files = next.first, folders = next.second) }
    }

    /**
     * Add a new file and switch to it. If [path] contains a `/`, the first
     * segment is treated as the folder name — the folder is created if missing
     * — and the file is placed inside it. New files are unpinned and appended
     * to the end of their scope's non-pinned group.
     */
    fun createFile(path: String, content: String = ""): WorkspaceFile {
        val s = state.value
        val id = uniqueId()
        val displayName = path.split('/').lastOrNull()?.removeSuffix(".numr") ?: path
        val slash = path.indexOf('/')

        var folders = s.folders
        var folderId: String? = null
        var createdFolder: WorkspaceFolder? = null
        if (slash >= 0) {
            val folderName = path.substring(0, slash)
            var folder = folders.find { it.name == folderName }
            if (folder == null) {
                folder = makeFolder(folderName)
                folders = folders + folder
                createdFolder = folder
            }
            folderId = folder.id
        }

        val file = WorkspaceFile(
            id = id,
            path = path,
            displayName = displayName,
            pinned = false,
            folderId = folderId,
            order = 0,
            draft = false,
            content = if (content.isNotEmpty()) content else "# $displayName\n",
        )
        val files0 = s.files + file

        val plan = mutableMapOf<String?, List<ScopedRef>>()
        if (createdFolder != null) {
            val rootRefs = scopeRefs(files0, folders, null)
                .filter { it.id != createdFolder.id }
                .toMutableList()
            rootRefs.add(ScopedRef(ScopedRefKind.FOLDER, createdFolder.id, pinned = false, order = 0))
            plan[null] = rootRefs
        }
        val fileScopeRefs = scopeRefs(files0, folders, folderId)
            .filter { it.id != file.id }
            .toMutableList()
        fileScopeRefs.add(ScopedRef(ScopedRefKind.FILE, file.id, pinned = false, order = 0))
        plan[folderId] = fileScopeRefs

        val next = applyPlan(files0, folders, plan)
        _state.update { it.copy(files = next.first, folders = next.second, activeFileId = id) }
        scope.launch { evaluateActiveFile() }
        return next.first.first { it.id == id }
    }

    /**
     * Delete a file. If it was active, activate the first remaining file (or
     * none if the workspace is empty).
     */
    fun deleteFile(id: String) {
        val s = state.value
        val file = s.files.find { it.id == id } ?: return
        val files0 = s.files.filter { it.id != id }
        val activeFileId = if (s.activeFileId == id) files0.firstOrNull()?.id else s.activeFileId

        val fileScope = file.folderId
        val refs = scopeRefs(files0, s.folders, fileScope)
        val plan = mapOf<String?, List<ScopedRef>>(fileScope to refs)
        val next = applyPlan(files0, s.folders, plan)

        _state.update { it.copy(files = next.first, folders = next.second, activeFileId = activeFileId) }
        scope.launch { evaluateActiveFile() }
    }

    /**
     * Create an ephemeral scratch file and switch to it. Drafts are never
     * persisted and are excluded from [toSnapshot].
     */
    fun createDraft(content: String = ""): WorkspaceFile {
        var n = draftCounter + 1
        val used = state.value.files.map { it.id }.toSet()
        while (used.contains("draft-$n")) n += 1
        draftCounter = n

        val file = WorkspaceFile(
            id = "draft-$n",
            path = "Draft",
            displayName = "Draft $n",
            pinned = false,
            folderId = null,
            order = 0,
            draft = true,
            content = content,
        )
        val s = state.value
        val files0 = s.files + file
        val refs = scopeRefs(files0, s.folders, null)
            .filter { it.id != file.id }
            .toMutableList()
        refs.add(ScopedRef(ScopedRefKind.FILE, file.id, pinned = false, order = 0))
        val plan = mapOf<String?, List<ScopedRef>>(null to refs)
        val next = applyPlan(files0, s.folders, plan)

        _state.update {
            it.copy(
                files = next.first,
                folders = next.second,
                activeFileId = file.id,
                editingTarget = EditingTarget.FILE,
            )
        }
        scope.launch { evaluateActiveFile() }
        return next.first.first { it.id == file.id }
    }

    /** Switch the editor to the globals document. */
    fun openGlobals() {
        if (state.value.editingTarget == EditingTarget.GLOBALS) return
        _state.update { it.copy(editingTarget = EditingTarget.GLOBALS) }
        scope.launch { evaluateActiveFile() }
    }

    /** Switch the editor back to the active file. */
    fun closeGlobals() {
        if (state.value.editingTarget != EditingTarget.GLOBALS) return
        _state.update { it.copy(editingTarget = EditingTarget.FILE) }
        scope.launch { evaluateActiveFile() }
    }

    fun setMode(mode: EditorMode) {
        _state.update { it.copy(mode = mode) }
    }

    // -------------------------------------------------------------------------
    // Persistence seam
    // -------------------------------------------------------------------------

    /**
     * The persistable slice of the workspace.
     *
     * Drafts are intentionally excluded — they are ephemeral scratch files that
     * must never be written to storage (satisfies the "draft 仅内存" acceptance
     * criterion). #9 wires this to Room.
     */
    fun toSnapshot(): WorkspaceSnapshot {
        val s = state.value
        val files = s.files
            .filter { !it.draft }
            .map {
                PersistedFile(
                    id = it.id,
                    path = it.path,
                    displayName = it.displayName,
                    pinned = it.pinned,
                    folderId = it.folderId,
                    order = it.order,
                    content = it.content,
                )
            }
        val folders = s.folders.map {
            PersistedFolder(
                id = it.id,
                name = it.name,
                pinned = it.pinned,
                collapsed = it.collapsed,
                order = it.order,
            )
        }
        return WorkspaceSnapshot(files = files, folders = folders, globalsContent = s.globalsContent)
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    /**
     * Flip `pinned` on the member [kind]/[id] in [scope], moving it to the FRONT
     * of the scope's pinned group when pinning or to the END of the scope's
     * non-pinned group when unpinning.
     */
    private fun flipPinInScope(scope: String?, id: String, kind: ScopedRefKind) {
        val refs = scopeRefs(state.value.files, state.value.folders, scope).toMutableList()
        val idx = refs.indexOfFirst { it.kind == kind && it.id == id }
        if (idx < 0) return
        val target = refs.removeAt(idx)
        val pinned = !target.pinned
        val flipped = target.copy(pinned = pinned)
        if (pinned) {
            refs.add(0, flipped)
        } else {
            refs.add(flipped)
        }
        val plan = mapOf<String?, List<ScopedRef>>(scope to refs)
        val next = applyPlan(state.value.files, state.value.folders, plan)
        _state.update { it.copy(files = next.first, folders = next.second) }
    }

    private fun activeFile(): WorkspaceFile? =
        state.value.files.find { it.id == state.value.activeFileId }

    /**
     * Build the `alias -> content` table published to the engine.
     *
     * Aliases are deduplicated FIRST-COME-FIRST-SERVED in `state.files` order:
     * when two files claim the same alias (e.g. two files in different folders
     * sharing a basename), the file that appears first in the workspace array
     * wins. Deduping must happen here — before serialization — because the
     * engine stores the table in a Rust `HashMap`, which cannot preserve
     * insertion order.
     */
    private fun buildDocumentAliases(): Map<String, String> {
        val docs = LinkedHashMap<String, String>()
        for (file in state.value.files) {
            for (alias in collectFileAliases(file)) {
                if (!docs.containsKey(alias)) {
                    docs[alias] = file.content
                }
            }
        }
        return docs
    }

    /**
     * Store the engine outcomes plus annotation/lastError patch in one update.
     *
     * TODO(#8 follow-up): settings-aware display formatting (Intl equivalent) is
     * deferred, so the engine `display` strings are stored as-is.
     */
    private fun setRawOutcomes(
        outcomes: List<LineOutcome>,
        lastError: String?,
        annotations: Annotations,
    ) {
        _state.update { it.copy(outcomes = outcomes, lastError = lastError, annotations = annotations) }
    }
}

// ---------------------------------------------------------------------------
// Ordering helpers
//
// Every scope (root = `null`, or a folder id) owns a contiguous order domain.
// The display order within a scope is a stable partition: pinned items first
// (by `order` ascending), then non-pinned items (by `order` ascending). All
// mutators rebuild the affected scope as an ordered member list and renumber it
// 0..n-1 via [applyPlan], so order values stay small integers with no drift.
// ---------------------------------------------------------------------------

private enum class ScopedRefKind { FOLDER, FILE }

private data class ScopedRef(
    val kind: ScopedRefKind,
    val id: String,
    val pinned: Boolean,
    val order: Int,
)

/** Stable sort: pinned first, then `order` ascending. */
private fun sortRefs(refs: List<ScopedRef>): List<ScopedRef> =
    refs.sortedWith(compareByDescending<ScopedRef> { it.pinned }.thenBy { it.order })

/**
 * Members of [scope] (folders only participate in the root scope) in display
 * order.
 */
private fun scopeRefs(
    files: List<WorkspaceFile>,
    folders: List<WorkspaceFolder>,
    scope: String?,
): List<ScopedRef> {
    val folderRefs = if (scope == null) {
        folders.map { ScopedRef(ScopedRefKind.FOLDER, it.id, it.pinned, it.order) }
    } else {
        emptyList()
    }
    val fileRefs = files
        .filter { it.folderId == scope }
        .map { ScopedRef(ScopedRefKind.FILE, it.id, it.pinned, it.order) }
    return sortRefs(folderRefs + fileRefs)
}

/**
 * Write the provided display-ordered member lists back onto the arrays: every
 * member listed for a scope gets `order` = its position in the list and the
 * `pinned` value carried by its ref. Members not covered by a plan entry are
 * passed through untouched.
 */
private fun applyPlan(
    files: List<WorkspaceFile>,
    folders: List<WorkspaceFolder>,
    plan: Map<String?, List<ScopedRef>>,
): Pair<List<WorkspaceFile>, List<WorkspaceFolder>> {
    val orderById = mutableMapOf<String, Int>()
    val pinnedById = mutableMapOf<String, Boolean>()
    for (refs in plan.values) {
        refs.forEachIndexed { i, ref ->
            orderById[ref.id] = i
            pinnedById[ref.id] = ref.pinned
        }
    }
    val nextFiles = files.map { f ->
        if (orderById.containsKey(f.id)) {
            f.copy(order = orderById.getValue(f.id), pinned = pinnedById.getValue(f.id))
        } else {
            f
        }
    }
    val nextFolders = folders.map { fd ->
        if (orderById.containsKey(fd.id)) {
            fd.copy(order = orderById.getValue(fd.id), pinned = pinnedById.getValue(fd.id))
        } else {
            fd
        }
    }
    return nextFiles to nextFolders
}

/**
 * Renumber every scope (root + each folder) from its current display order.
 * Used once after construction to normalize the defaults.
 */
private fun normalizeScopes(
    files: List<WorkspaceFile>,
    folders: List<WorkspaceFolder>,
): Pair<List<WorkspaceFile>, List<WorkspaceFolder>> {
    val scopes: List<String?> = listOf(null) + folders.map { it.id }
    val plan = mutableMapOf<String?, List<ScopedRef>>()
    for (scope in scopes) {
        plan[scope] = scopeRefs(files, folders, scope)
    }
    return applyPlan(files, folders, plan)
}

/**
 * Legacy migration: ensure every file that lives under a path prefix
 * (`"folderName/…"`) has a matching folder and a `folderId`. Folders referenced
 * by `folderId` that already exist are kept as-is. Used at construction time
 * (default fixtures) and, later, after hydration of v1 snapshots.
 */
private fun deriveFoldersForFiles(
    files: List<WorkspaceFile>,
    folders: List<WorkspaceFolder>,
): Pair<List<WorkspaceFile>, List<WorkspaceFolder>> {
    var outFolders = folders.map { it.copy() }
    val outFiles = files.map { f ->
        if (f.folderId != null && outFolders.any { it.id == f.folderId }) {
            return@map f
        }
        val segments = f.path.split('/')
        if (segments.size < 2) {
            return@map if (f.folderId == null) f else f.copy(folderId = null)
        }
        val folderName = segments[0]
        var folder = outFolders.find { it.name == folderName }
        if (folder == null) {
            folder = makeFolder(folderName)
            outFolders = outFolders + folder
        }
        f.copy(folderId = folder.id)
    }
    return outFiles to outFolders
}

private fun makeFolder(name: String): WorkspaceFolder =
    WorkspaceFolder(id = uniqueId(), name = name, pinned = false, collapsed = false, order = 0)

private fun basename(path: String): String =
    path.split('/').filter { it.isNotEmpty() }.lastOrNull() ?: path

private fun uniqueId(): String = UUID.randomUUID().toString()

/**
 * Build the initial state from the default fixtures: derive the "daily" folder
 * from the path prefix, then normalize every scope. Mirrors the web
 * `WorkspaceStore` constructor. There is no hydration in #8, so `hydrating` is
 * false.
 */
private fun initialState(): WorkspaceState {
    val derived = deriveFoldersForFiles(DEFAULT_FILES.map { it.copy() }, emptyList())
    val normalized = normalizeScopes(derived.first, derived.second)
    return WorkspaceState(
        files = normalized.first,
        folders = normalized.second,
        activeFileId = DEFAULT_FILES.firstOrNull()?.id,
        globalsContent = DEFAULT_GLOBALS,
        editingTarget = EditingTarget.FILE,
        outcomes = emptyList(),
        annotations = Annotations.EMPTY_ANNOTATIONS,
        mode = EditorMode.STANDARD,
        lastError = null,
        hydrating = false,
    )
}

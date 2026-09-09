/**
 * Workspace state model — the in-memory view the editor renders.
 *
 * State is a plain object wrapped in a tiny pub-sub. Components
 * subscribe via `subscribe()` and receive the next snapshot whenever
 * any mutator is called.
 *
 * Persistence: every mutator schedules a debounced write to IndexedDB
 * via `lib/persistence`. The store hydrates from IndexedDB on
 * construction; if no snapshot exists, the default fixtures are used
 * and written out on first mutation.
 *
 * Cross-file references: `lib/file-ref` resolves `file("name")` in
 * the active document using the rest of the workspace, before the
 * document reaches the WASM engine. The engine's own reference
 * resolver is left in place as a fallback for cases we don't handle.
 * The `path` field keeps encoding the folder ("folderName/file.numr"),
 * so basename/path resolution keeps working for files inside folders.
 *
 * Ordering model: one level of folders plus explicit ordering.
 * The root level holds both folders and root-level files
 * (`folderId === null`), sharing ONE `order` domain. Files inside a
 * folder share a SEPARATE `order` domain scoped to that folder.
 * Display order in any scope is: pinned items first (by `order`
 * ascending), then non-pinned items (by `order` ascending). After
 * every reorder the affected scopes are renumbered with sequential
 * non-negative integers so `order` values never drift.
 */

import { type LineOutcome, type EngineHandle } from './engine';
import { resolveFileReferences } from './file-ref';
import {
  loadWorkspace,
  saveWorkspace,
  type PersistedFile,
  type PersistedFolder,
} from './persistence';
import { formatOutcome } from './format';
import { loadSettings, type NumeraSettings } from './settings';

export interface WorkspaceFolder {
  /** Stable id (crypto.randomUUID()). */
  id: string;
  /** Display name (no slashes). */
  name: string;
  /** Pinned folders float to the top of the root list. */
  pinned: boolean;
  /** Whether the folder is visually collapsed. */
  collapsed: boolean;
  /** Sort key among ROOT items (shared with root files). */
  order: number;
}

export interface WorkspaceFile {
  /** Stable identifier — used as the key in the file list and the
   *  CodeMirror view identity. Path may change without invalidating
   *  the id. */
  id: string;
  /** Full workspace path: "folderName/file.numr" or "file.numr". */
  path: string;
  /** Display name shown in the sidebar (falls back to path basename). */
  displayName: string;
  /** Pinned files float to the top of their scope's list. */
  pinned: boolean;
  /** References WorkspaceFolder.id; null = root level. */
  folderId: string | null;
  /** Sort key within its scope (root, or its folder). */
  order: number;
  /** Editor contents. */
  content: string;
  /** Ephemeral scratch file — never persisted. */
  draft?: boolean;
}

export interface WorkspaceState {
  files: WorkspaceFile[];
  folders: WorkspaceFolder[];
  activeFileId: string | null;
  globalsContent: string;
  /** What the editor is currently showing: a file, or the globals doc. */
  editingTarget: 'file' | 'globals';
  outcomes: LineOutcome[];
  mode: 'Normal' | 'Insert' | 'Standard';
  lastError: string | null;
  /** True until the first hydrate-from-IndexedDB completes. */
  hydrating: boolean;
}

export type WorkspaceListener = (state: WorkspaceState) => void;

const DEFAULT_GLOBALS = `# Globals — shared across all files in this workspace.
# Variables and functions defined here are referenced as \`global.<name>\`.

tax_rate = 13%
vat_rate = 0.2

# Cross-file references work via \`file("name")\`. Try them in any file:
#   profit = file("daily")
`;

// `folderId`/`order` are placeholders here: the constructor derives the
// "daily" folder from the `daily/2026-09-07.numr` path prefix and
// normalizes every scope to sequential integer orders.
const DEFAULT_FILES: WorkspaceFile[] = [
  {
    id: 'budget',
    path: 'budget-2026.numr',
    displayName: 'Budget 2026',
    pinned: true,
    folderId: null,
    order: 0,
    content: `# September 2026 budget
# Globals live in globals.numr and are referenced as \`global.<name>\`.

monthly_income = $6,500
tax_rate       = 22%
rent           = $1,800
savings        = monthly_income * (1 - tax_rate) - rent

vat_total      = (rent + savings) * global.vat_rate
take_home      = monthly_income * (1 - tax_rate) - rent

# Cross-file reference: pulls the first export from daily.numr.
daily_net      = file("daily")
`,
  },
  {
    id: 'daily',
    path: 'daily/2026-09-07.numr',
    displayName: 'Daily — Sep 7',
    pinned: false,
    folderId: null,
    order: 0,
    content: `# Daily snapshot — Sep 7, 2026
expense_breakfast = $12.50
expense_lunch     = $18.20
expense_coffee    = $4.80

total = expense_breakfast + expense_lunch + expense_coffee
`,
  },
  {
    id: 'cheatsheet',
    path: 'unit-cheatsheet.numr',
    displayName: 'Unit Cheatsheet',
    pinned: false,
    folderId: null,
    order: 1,
    content: `# Unit conversion cheatsheet
meters   = 100
kilometers = meters / 1000
feet     = meters * 3.281
miles    = feet / 5280
`,
  },
];

const SAVE_DEBOUNCE_MS = 400;

/** Order sentinel for files/folders appended by `applyRemoteChanges`; they
 *  are renumbered to small contiguous values by `normalizeScopes`, so this
 *  only needs to be larger than any real (already normalized) order. */
const BATCH_ORDER_BASE = 1_000_000_000;

// ---------------------------------------------------------------------------
// Ordering helpers
//
// Every scope (root = `null`, or a folder id) owns a contiguous order
// domain. The display order within a scope is computed as a stable
// partition: pinned items first (by `order` ascending), then non-pinned
// items (by `order` ascending). All mutators below rebuild the affected
// scope as an ordered member list and then renumber it 0..n-1 via
// `applyPlan`, so order values stay small integers with no drift.
// ---------------------------------------------------------------------------

type ScopedRef = {
  kind: 'folder' | 'file';
  id: string;
  pinned: boolean;
  order: number;
};

/** Stable sort: pinned first, then `order` ascending. */
function sortRefs(refs: ScopedRef[]): ScopedRef[] {
  return [...refs].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.order - b.order;
  });
}

/** Members of `scope` (folders only participate in the root scope) in
 *  display order. */
function scopeRefs(
  files: readonly WorkspaceFile[],
  folders: readonly WorkspaceFolder[],
  scope: string | null,
): ScopedRef[] {
  const folderRefs =
    scope === null
      ? folders.map(
          (fd): ScopedRef => ({
            kind: 'folder',
            id: fd.id,
            pinned: fd.pinned,
            order: fd.order,
          }),
        )
      : [];
  const fileRefs = files
    .filter((f) => f.folderId === scope)
    .map(
      (f): ScopedRef => ({
        kind: 'file',
        id: f.id,
        pinned: f.pinned,
        order: f.order,
      }),
    );
  return sortRefs([...folderRefs, ...fileRefs]);
}

/**
 * Write the provided display-ordered member lists back onto the arrays:
 * every member listed for a scope gets `order` = its position in the list
 * and the `pinned` value carried by its ref. Members not covered by a plan
 * entry are passed through untouched.
 */
function applyPlan(
  files: readonly WorkspaceFile[],
  folders: readonly WorkspaceFolder[],
  plan: ReadonlyMap<string | null, readonly ScopedRef[]>,
): { files: WorkspaceFile[]; folders: WorkspaceFolder[] } {
  const orderById = new Map<string, number>();
  const pinnedById = new Map<string, boolean>();
  for (const refs of plan.values()) {
    refs.forEach((ref, i) => {
      orderById.set(ref.id, i);
      pinnedById.set(ref.id, ref.pinned);
    });
  }
  return {
    files: files.map((f) =>
      orderById.has(f.id)
        ? { ...f, order: orderById.get(f.id)!, pinned: pinnedById.get(f.id)! }
        : f,
    ),
    folders: folders.map((fd) =>
      orderById.has(fd.id)
        ? {
            ...fd,
            order: orderById.get(fd.id)!,
            pinned: pinnedById.get(fd.id)!,
          }
        : fd,
    ),
  };
}

/** Renumber every scope (root + each folder) from its current display
 *  order. Used once after construction/hydration to normalize defaults
 *  and legacy snapshots. */
function normalizeScopes(
  files: readonly WorkspaceFile[],
  folders: readonly WorkspaceFolder[],
): { files: WorkspaceFile[]; folders: WorkspaceFolder[] } {
  const scopes: Array<string | null> = [null, ...folders.map((fd) => fd.id)];
  const plan = new Map<string | null, ScopedRef[]>();
  for (const scope of scopes) {
    plan.set(scope, scopeRefs(files, folders, scope));
  }
  return applyPlan(files, folders, plan);
}

/**
 * Legacy migration: ensure every file that lives under a path prefix
 * ("folderName/…") has a matching folder and a `folderId`. Folders
 * referenced by `folderId` that already exist are kept as-is. Used at
 * construction time (default fixtures) and after hydration (v1
 * snapshots persisted without folders / `folderId`).
 */
function deriveFoldersForFiles(
  files: readonly WorkspaceFile[],
  folders: readonly WorkspaceFolder[],
): { files: WorkspaceFile[]; folders: WorkspaceFolder[] } {
  let outFolders = folders.map((fd) => ({ ...fd }));
  const outFiles = files.map((f) => {
    if (f.folderId !== null && outFolders.some((fd) => fd.id === f.folderId)) {
      return f;
    }
    const segments = f.path.split('/');
    if (segments.length < 2) {
      return f.folderId === null ? f : { ...f, folderId: null };
    }
    const folderName = segments[0];
    let folder = outFolders.find((fd) => fd.name === folderName);
    if (!folder) {
      folder = makeFolder(folderName);
      outFolders = [...outFolders, folder];
    }
    return { ...f, folderId: folder.id };
  });
  return { files: outFiles, folders: outFolders };
}

function makeFolder(name: string): WorkspaceFolder {
  return { id: uniqueId(), name, pinned: false, collapsed: false, order: 0 };
}

function basename(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

export class WorkspaceStore {
  private state: WorkspaceState;
  private listeners = new Set<WorkspaceListener>();
  private engine: EngineHandle | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated = false;
  private draftCounter = 0;
  /** Current formatting settings; results are re-formatted from these. */
  private settings: NumeraSettings = loadSettings();
  /** Raw engine outcomes, before settings-based display re-formatting. */
  private rawOutcomes: LineOutcome[] = [];

  constructor() {
    const derived = deriveFoldersForFiles(
      DEFAULT_FILES.map((f) => ({ ...f })),
      [],
    );
    const normalized = normalizeScopes(derived.files, derived.folders);
    this.state = {
      files: normalized.files,
      folders: normalized.folders,
      activeFileId: DEFAULT_FILES[0]?.id ?? null,
      globalsContent: DEFAULT_GLOBALS,
      editingTarget: 'file',
      outcomes: [],
      mode: 'Standard',
      lastError: null,
      hydrating: true,
    };
  }

  /** Hydrate state from IndexedDB. Call once after construction. */
  async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;

    try {
      const snapshot = await loadWorkspace();
      if (snapshot && snapshot.files.length > 0) {
        // v1 rows lack `folderId`/`order` — default folderId from the
        // path prefix and order to the array index, then derive folders
        // and normalize so legacy snapshots migrate cleanly.
        const mapped = snapshot.files.map((f, i) => ({
          id: f.id,
          path: f.path,
          displayName: f.displayName,
          pinned: f.pinned,
          folderId: f.folderId ?? null,
          order: f.order ?? i,
          content: f.content,
        }));
        const derived = deriveFoldersForFiles(mapped, snapshot.folders);
        const normalized = normalizeScopes(derived.files, derived.folders);
        this.state = {
          ...this.state,
          files: normalized.files,
          folders: normalized.folders,
          activeFileId: snapshot.files[0]?.id ?? null,
          globalsContent: snapshot.globalsContent || DEFAULT_GLOBALS,
          hydrating: false,
        };
      } else {
        this.state = { ...this.state, hydrating: false };
        // First-run: persist the defaults so subsequent reloads are
        // consistent.
        this.scheduleSave();
      }
    } catch (err) {
      console.warn('[numera] hydrate failed, using defaults:', err);
      this.state = { ...this.state, hydrating: false };
    }

    this.broadcast();
    await this.evaluateActiveFile();
  }

  attachEngine(engine: EngineHandle): void {
    this.engine = engine;
  }

  /** Expose the engine handle for consumers that need non-state
   *  helpers (e.g. the editor's expression-prefix measurement). */
  getEngine(): EngineHandle | null {
    return this.engine;
  }

  getState(): WorkspaceState {
    return this.state;
  }

  subscribe(listener: WorkspaceListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Apply the current settings and re-render existing raw outcomes
   *  without re-running the engine. Called on boot and whenever the
   *  settings store changes. */
  setSettings(settings: NumeraSettings): void {
    this.settings = settings;
    this.update({ outcomes: this.formatOutcomes(this.rawOutcomes) });
  }

  async evaluateActiveFile(): Promise<void> {
    if (this.state.editingTarget === 'globals') {
      // Evaluating the globals document itself: no cross-file references
      // apply here — globals are the shared context, not a consumer.
      if (!this.engine) {
        this.setRawOutcomes([]);
        return;
      }
      try {
        await this.engine.setGlobals(this.state.globalsContent);
        const outcomes = await this.engine.evaluateDocument(
          this.state.globalsContent,
        );
        this.setRawOutcomes(outcomes, { lastError: null });
      } catch (err) {
        this.setRawOutcomes([], {
          lastError: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    const active = this.activeFile();
    if (!active || !this.engine) {
      this.setRawOutcomes([]);
      return;
    }
    try {
      await this.engine.setGlobals(this.state.globalsContent);
      // Cross-file references resolve against the rest of the
      // workspace before the document reaches the engine. This keeps
      // the WASM surface area stable.
      const rewritten = resolveFileReferences(active.content, this.state.files);
      const wrapped = wrapFileReferences(rewritten);
      const outcomes = await this.engine.evaluateDocument(wrapped);
      this.setRawOutcomes(outcomes, { lastError: null });
    } catch (err) {
      this.setRawOutcomes([], {
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  selectFile(id: string): void {
    if (this.state.editingTarget === 'file' && this.state.activeFileId === id)
      return;
    this.update({ activeFileId: id, editingTarget: 'file' });
    void this.evaluateActiveFile();
  }

  setActiveContent(content: string): void {
    if (this.state.editingTarget === 'globals') {
      void this.setGlobals(content);
      return;
    }
    const active = this.activeFile();
    if (!active || active.content === content) return;
    this.update({
      files: this.state.files.map((f) =>
        f.id === active.id ? { ...f, content } : f,
      ),
    });
    void this.evaluateActiveFile();
    this.scheduleSave();
  }

  async setGlobals(content: string): Promise<void> {
    this.update({ globalsContent: content });
    await this.evaluateActiveFile();
    this.scheduleSave();
  }

  /** Rename a file's display name. Empty names are ignored. */
  renameFile(id: string, displayName: string): void {
    const name = displayName.trim();
    if (!name) return;
    const file = this.state.files.find((f) => f.id === id);
    if (!file) return;
    this.update({
      files: this.state.files.map((f) =>
        f.id === id ? { ...f, displayName: name } : f,
      ),
    });
    this.scheduleSave();
  }

  // -------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------

  /** Create a new folder at the END of the root non-pinned group. */
  createFolder(name: string): WorkspaceFolder {
    const trimmed = name.trim();
    // A blank name (or one containing a path separator) would corrupt
    // the one-level folder invariant encoded in file paths.
    if (!trimmed || trimmed.includes('/')) {
      throw new Error('Folder name must be a non-empty, single-segment name');
    }
    const folder = makeFolder(trimmed);
    const folders = [...this.state.folders, folder];
    const refs = scopeRefs(this.state.files, folders, null).filter(
      (r) => r.id !== folder.id,
    );
    refs.push({ kind: 'folder', id: folder.id, pinned: false, order: 0 });
    const plan = new Map<string | null, ScopedRef[]>([[null, refs]]);
    const next = applyPlan(this.state.files, folders, plan);
    this.update({ files: next.files, folders: next.folders });
    this.scheduleSave();
    return next.folders.find((fd) => fd.id === folder.id)!;
  }

  /** Rename a folder's display name. Empty names are ignored. Child file
   *  paths are intentionally left unchanged. */
  renameFolder(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const folder = this.state.folders.find((fd) => fd.id === id);
    if (!folder) return;
    this.update({
      folders: this.state.folders.map((fd) =>
        fd.id === id ? { ...fd, name: trimmed } : fd,
      ),
    });
    this.scheduleSave();
  }

  /** Delete a folder and move all of its files to the root level
   *  (folderId=null, path=basename). Files keep their pinned flag and are
   *  appended to the end of the root scope, so unpinned files land at the
   *  end of the root non-pinned group. */
  deleteFolder(id: string): void {
    const folder = this.state.folders.find((fd) => fd.id === id);
    if (!folder) return;

    const moved = this.state.files
      .filter((f) => f.folderId === id)
      .map((f) => ({ ...f, folderId: null, path: basename(f.path) }));
    const files0 = this.state.files.filter((f) => f.folderId !== id);
    const folders0 = this.state.folders.filter((fd) => fd.id !== id);

    // Preserve the folder's internal display order (pinned first, then
    // by order) when re-homing its files into the root list. Read from
    // the pre-remap files (the `moved` copies already carry folderId=null).
    const childRefs = scopeRefs(this.state.files, this.state.folders, id);
    const rootRefs = scopeRefs(files0, folders0, null);
    for (const child of childRefs) {
      rootRefs.push({ ...child, kind: 'file' });
    }

    const filesAll = [...files0, ...moved];
    const plan = new Map<string | null, ScopedRef[]>([[null, rootRefs]]);
    const next = applyPlan(filesAll, folders0, plan);
    this.update({ files: next.files, folders: next.folders });
    this.scheduleSave();
  }

  toggleFolderCollapsed(id: string): void {
    const folder = this.state.folders.find((fd) => fd.id === id);
    if (!folder) return;
    this.update({
      folders: this.state.folders.map((fd) =>
        fd.id === id ? { ...fd, collapsed: !fd.collapsed } : fd,
      ),
    });
    this.scheduleSave();
  }

  /** Flip a folder's pinned flag and reorder it to the front of the root
   *  pinned group / the end of the root non-pinned group. */
  toggleFolderPin(id: string): void {
    this.flipPinInScope(null, id, 'folder');
  }

  // -------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------

  /** Flip the pinned flag on a file and reorder it to the top of its
   *  group (front of the pinned block when pinning; end of the scope's
   *  non-pinned block when unpinning). */
  togglePin(id: string): void {
    const file = this.state.files.find((f) => f.id === id);
    if (!file) return;
    this.flipPinInScope(file.folderId, id, 'file');
  }

  /** Reorder a file within its current scope and group (pinned ↔ pinned,
   *  non-pinned ↔ non-pinned). `beforeId` is a file id in the same
   *  scope+group to insert before; null = move to the end of the group.
   *  No-op if ids are invalid or not in the same group. */
  moveFile(id: string, beforeId: string | null): void {
    const file = this.state.files.find((f) => f.id === id);
    if (!file || beforeId === id) return;

    const scope = file.folderId;
    const refs = scopeRefs(this.state.files, this.state.folders, scope);
    const idx = refs.findIndex((r) => r.kind === 'file' && r.id === id);
    if (idx < 0) return;
    const target = refs[idx];

    if (beforeId !== null) {
      // `beforeId` may be a file OR a folder (folders only participate in
      // the root scope). Require it to be a member of the same scope and
      // pinned group so ordering stays within the pinned-first layout.
      const beforeIdx = refs.findIndex(
        (r) => r.id === beforeId && r.pinned === file.pinned,
      );
      if (beforeIdx < 0) return;
      refs.splice(idx, 1);
      // Recompute the insertion point after the splice (removing the
      // target can shift indices when the target precedes `beforeId`).
      const insertAt = refs.findIndex((r) => r.id === beforeId);
      refs.splice(insertAt, 0, target);
    } else if (target.pinned) {
      // Move to the END of the pinned block (just before the first
      // non-pinned member).
      refs.splice(idx, 1);
      let lastPinned = -1;
      refs.forEach((r, i) => {
        if (r.pinned) lastPinned = i;
      });
      refs.splice(lastPinned + 1, 0, target);
    } else {
      refs.splice(idx, 1);
      refs.push(target);
    }

    const plan = new Map<string | null, ScopedRef[]>([[scope, refs]]);
    const next = applyPlan(this.state.files, this.state.folders, plan);
    this.update({ files: next.files, folders: next.folders });
    this.scheduleSave();
  }

  /** Move a file into/out of a folder. Updates folderId and the path
   *  prefix, then appends the file to the end of the target scope's
   *  non-pinned group (keeping its pinned flag). Reassigns order. */
  moveFileToFolder(id: string, folderId: string | null): void {
    const file = this.state.files.find((f) => f.id === id);
    if (!file) return;
    if (folderId !== null) {
      const folder = this.state.folders.find((fd) => fd.id === folderId);
      if (!folder) return;
    }

    const targetPath =
      folderId === null
        ? basename(file.path)
        : `${this.state.folders.find((fd) => fd.id === folderId)!.name}/${basename(file.path)}`;

    const files0 = this.state.files.map((f) =>
      f.id === id ? { ...f, folderId, path: targetPath } : f,
    );

    const source = file.folderId;
    const plan = new Map<string | null, ScopedRef[]>();
    const scopes = new Set<string | null>([source, folderId]);
    for (const scope of scopes) {
      const refs = scopeRefs(files0, this.state.folders, scope).filter(
        (r) => !(r.kind === 'file' && r.id === id),
      );
      if (scope === folderId) {
        refs.push({ kind: 'file', id, pinned: file.pinned, order: 0 });
      }
      plan.set(scope, refs);
    }

    const next = applyPlan(files0, this.state.folders, plan);
    this.update({ files: next.files, folders: next.folders });
    this.scheduleSave();
  }

  /** Add a new empty file and switch to it. If `path` contains a '/',
   *  the first segment is treated as the folder name — the folder is
   *  created if missing — and the file is placed inside it. New files
   *  are unpinned and appended to the end of their scope's non-pinned
   *  group. */
  createFile(path: string, content = ''): WorkspaceFile {
    const id = uniqueId();
    const displayName = path.split('/').pop()?.replace(/\.numr$/, '') ?? path;
    const slash = path.indexOf('/');

    let folders = this.state.folders;
    let folderId: string | null = null;
    let createdFolder: WorkspaceFolder | null = null;
    if (slash >= 0) {
      const folderName = path.slice(0, slash);
      let folder = folders.find((fd) => fd.name === folderName);
      if (!folder) {
        folder = makeFolder(folderName);
        folders = [...folders, folder];
        createdFolder = folder;
      }
      folderId = folder.id;
    }

    const file: WorkspaceFile = {
      id,
      path,
      displayName,
      pinned: false,
      folderId,
      order: 0,
      draft: false,
      content: content || `# ${displayName}\n`,
    };
    const files0 = [...this.state.files, file];

    const plan = new Map<string | null, ScopedRef[]>();
    if (createdFolder) {
      const rootRefs = scopeRefs(files0, folders, null).filter(
        (r) => r.id !== createdFolder.id,
      );
      rootRefs.push({
        kind: 'folder',
        id: createdFolder.id,
        pinned: false,
        order: 0,
      });
      plan.set(null, rootRefs);
    }
    const scopeRefsForFile = scopeRefs(files0, folders, folderId).filter(
      (r) => r.id !== file.id,
    );
    scopeRefsForFile.push({ kind: 'file', id: file.id, pinned: false, order: 0 });
    plan.set(folderId, scopeRefsForFile);

    const next = applyPlan(files0, folders, plan);
    this.update({
      files: next.files,
      folders: next.folders,
      activeFileId: id,
    });
    void this.evaluateActiveFile();
    this.scheduleSave();
    return next.files.find((f) => f.id === id)!;
  }

  /** Delete a file. If it was active, activate the first remaining
   *  file (or none if the workspace is empty). */
  deleteFile(id: string): void {
    const file = this.state.files.find((f) => f.id === id);
    if (!file) return;
    const files0 = this.state.files.filter((f) => f.id !== id);
    const activeFileId =
      this.state.activeFileId === id
        ? (files0[0]?.id ?? null)
        : this.state.activeFileId;

    const scope = file.folderId;
    const refs = scopeRefs(files0, this.state.folders, scope);
    const plan = new Map<string | null, ScopedRef[]>([[scope, refs]]);
    const next = applyPlan(files0, this.state.folders, plan);

    this.update({ files: next.files, folders: next.folders, activeFileId });
    this.scheduleSave();
    void this.evaluateActiveFile();
  }

  /**
   * Batch-apply remote sync changes in a single update. Files are matched by
   * PATH, not id. `upsert` creates a missing file (deriving its folder from the
   * path prefix, exactly like createFile) or updates an existing file's
   * content/displayName/pinned in place. `deletePaths` removes files by path.
   * Optionally replaces globalsContent. Preserves activeFileId unless it is
   * deleted. One broadcast + one debounced save + one re-evaluation of the
   * active file.
   */
  applyRemoteChanges(opts: {
    upsert: Array<{
      path: string;
      content: string;
      displayName?: string;
      pinned?: boolean;
    }>;
    deletePaths: string[];
    globalsContent?: string;
  }): void {
    const { upsert = [], deletePaths = [], globalsContent } = opts;
    const deleteSet = new Set(deletePaths);

    // (1) Drop locally-deleted paths, then (2) fold in every upsert — either
    // replacing the file that currently holds the path (keeping its
    // id/folderId/order so the editor's file identity is stable) or appending
    // a brand-new file at the end of its scope.
    let files = this.state.files.filter((f) => !deleteSet.has(f.path));
    let folders = this.state.folders.map((fd) => ({ ...fd }));
    let appendSeq = 0;

    for (const u of upsert) {
      const existing = files.find((f) => f.path === u.path);
      if (existing) {
        files = files.map((f) =>
          f.id === existing.id
            ? {
                ...f,
                content: u.content,
                ...(u.displayName !== undefined ? { displayName: u.displayName } : {}),
                ...(u.pinned !== undefined ? { pinned: u.pinned } : {}),
              }
            : f,
        );
        continue;
      }

      // Fresh file — derive folder/display-name exactly like createFile().
      const slash = u.path.indexOf('/');
      let folderId: string | null = null;
      if (slash >= 0) {
        const folderName = u.path.slice(0, slash);
        let folder = folders.find((fd) => fd.name === folderName);
        if (!folder) {
          folder = makeFolder(folderName);
          // Large order so the new folder lands at the END of the root scope
          // once normalizeScopes renumbers it.
          folders = [...folders, { ...folder, order: BATCH_ORDER_BASE + appendSeq }];
        }
        folderId = folder.id;
      }

      const displayName =
        u.displayName ??
        (u.path.split('/').filter(Boolean).pop()?.replace(/\.numr$/, '') ?? u.path);

      files = [
        ...files,
        {
          id: uniqueId(),
          path: u.path,
          displayName,
          pinned: u.pinned ?? false,
          folderId,
          // Large order so the new file lands at the END of its scope's
          // (non-)pinned block once normalizeScopes renumbers it.
          order: BATCH_ORDER_BASE + appendSeq,
          content: u.content,
        },
      ];
      appendSeq += 1;
    }

    // Re-derive folder membership (a new file's path prefix may have
    // introduced a folder) and renumber every scope so `order` values stay
    // small, contiguous integers after the batch mutation.
    const derived = deriveFoldersForFiles(files, folders);
    const normalized = normalizeScopes(derived.files, derived.folders);

    // Keep the active file unless it was just deleted (fall back to the first
    // remaining file, or null for an empty workspace).
    const remaining = normalized.files;
    const activeFileId =
      this.state.activeFileId !== null &&
      remaining.some((f) => f.id === this.state.activeFileId)
        ? this.state.activeFileId
        : (remaining[0]?.id ?? null);

    const patch: Partial<WorkspaceState> = {
      files: remaining,
      folders: normalized.folders,
      activeFileId,
    };
    if (globalsContent !== undefined) patch.globalsContent = globalsContent;

    this.update(patch);
    this.scheduleSave();
    void this.evaluateActiveFile();
  }

  /** Create an ephemeral scratch file and switch to it. Drafts are
   *  never persisted and do not schedule a save. */
  createDraft(content = ''): WorkspaceFile {
    let n = this.draftCounter + 1;
    const used = new Set(this.state.files.map((f) => f.id));
    while (used.has(`draft-${n}`)) n += 1;
    this.draftCounter = n;
    const file: WorkspaceFile = {
      id: `draft-${n}`,
      path: 'Draft',
      displayName: `Draft ${n}`,
      pinned: false,
      folderId: null,
      order: 0,
      draft: true,
      content,
    };
    const files0 = [...this.state.files, file];
    const refs = scopeRefs(files0, this.state.folders, null).filter(
      (r) => r.id !== file.id,
    );
    refs.push({ kind: 'file', id: file.id, pinned: false, order: 0 });
    const plan = new Map<string | null, ScopedRef[]>([[null, refs]]);
    const next = applyPlan(files0, this.state.folders, plan);

    this.update({
      files: next.files,
      folders: next.folders,
      activeFileId: file.id,
      editingTarget: 'file',
    });
    void this.evaluateActiveFile();
    return next.files.find((f) => f.id === file.id)!;
  }

  /** Switch the editor to the globals document. */
  openGlobals(): void {
    if (this.state.editingTarget === 'globals') return;
    this.update({ editingTarget: 'globals' });
    void this.evaluateActiveFile();
  }

  /** Switch the editor back to the active file. */
  closeGlobals(): void {
    if (this.state.editingTarget !== 'globals') return;
    this.update({ editingTarget: 'file' });
    void this.evaluateActiveFile();
  }

  setMode(mode: WorkspaceState['mode']): void {
    this.update({ mode });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  /** Flip `pinned` on the member `kind`/`id` in `scope`, moving it to
   *  the FRONT of the scope's pinned group when pinning or to the END of
   *  the scope's non-pinned group when unpinning. */
  private flipPinInScope(
    scope: string | null,
    id: string,
    kind: ScopedRef['kind'],
  ): void {
    const refs = scopeRefs(this.state.files, this.state.folders, scope);
    const idx = refs.findIndex((r) => r.kind === kind && r.id === id);
    if (idx < 0) return;
    const [target] = refs.splice(idx, 1);
    const pinned = !target.pinned;
    const flipped: ScopedRef = { ...target, pinned };
    if (pinned) {
      refs.unshift(flipped);
    } else {
      refs.push(flipped);
    }
    const plan = new Map<string | null, ScopedRef[]>([[scope, refs]]);
    const next = applyPlan(this.state.files, this.state.folders, plan);
    this.update({ files: next.files, folders: next.folders });
    this.scheduleSave();
  }

  private activeFile(): WorkspaceFile | undefined {
    return this.state.files.find((f) => f.id === this.state.activeFileId);
  }

  /** Re-render raw outcomes with the current settings. Every field is
   *  preserved except `display`, which gets the settings-aware string. */
  private formatOutcomes(raw: readonly LineOutcome[]): LineOutcome[] {
    return raw.map((o) => ({ ...o, display: formatOutcome(o, this.settings) }));
  }

  /** Store the raw engine outcomes and broadcast their formatted
   *  display strings (plus any `extra` state patch) in one update. */
  private setRawOutcomes(
    outcomes: LineOutcome[],
    extra: Partial<WorkspaceState> = {},
  ): void {
    this.rawOutcomes = outcomes;
    this.update({ ...extra, outcomes: this.formatOutcomes(outcomes) });
  }

  private update(patch: Partial<WorkspaceState>): void {
    this.state = { ...this.state, ...patch };
    this.broadcast();
  }

  private broadcast(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      void this.persistNow();
    }, SAVE_DEBOUNCE_MS);
  }

  private async persistNow(): Promise<void> {
    try {
      const files: PersistedFile[] = this.state.files
        .filter((f) => !f.draft)
        .map((f) => ({
          id: f.id,
          path: f.path,
          displayName: f.displayName,
          pinned: f.pinned,
          folderId: f.folderId,
          order: f.order,
          content: f.content,
          updatedAt: Date.now(),
        }));
      const folders: PersistedFolder[] = this.state.folders.map((fd) => ({
        id: fd.id,
        name: fd.name,
        pinned: fd.pinned,
        collapsed: fd.collapsed,
        order: fd.order,
      }));
      await saveWorkspace({
        files,
        folders,
        globalsContent: this.state.globalsContent,
      });
    } catch (err) {
      console.warn('[numera] persistence failed:', err);
    }
  }

  /**
   * Immediately write any pending debounced save. The store normally
   * debounces writes by 400ms; if the page is hidden or torn down
   * (tab switch, refresh, navigation) before that timer fires, the
   * pending edits would otherwise be lost. Callers wire this to
   * `visibilitychange`/`pagehide`.
   */
  flush(): void {
    if (!this.saveTimer) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    void this.persistNow();
  }
}

function uniqueId(): string {
  return crypto.randomUUID();
}

/**
 * Mark file() references in the rewritten document so the editor can
 * show them as resolved references. We don't actually wrap anything;
 * the engine already has its own resolver. This is a hook for future
 * decoration (e.g. underlining resolved references) — for now it's a
 * no-op pass-through kept for the next iteration.
 */
function wrapFileReferences(expr: string): string {
  return expr;
}

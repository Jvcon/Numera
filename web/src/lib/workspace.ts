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
 */

import { type LineOutcome, type EngineHandle } from './engine';
import { resolveFileReferences } from './file-ref';
import {
  loadWorkspace,
  saveWorkspace,
  type PersistedFile,
} from './persistence';

export interface WorkspaceFile {
  /** Stable identifier — used as the key in the file list and the
   *  CodeMirror view identity. Path may change without invalidating
   *  the id. */
  id: string;
  /** Workspace-relative path, e.g. `daily/2026-09-07.numr`. */
  path: string;
  /** Display name shown in the sidebar (falls back to path basename). */
  displayName: string;
  /** Pinned files float to the top of the sidebar list. */
  pinned: boolean;
  /** Editor contents. */
  content: string;
}

export interface WorkspaceState {
  files: WorkspaceFile[];
  activeFileId: string | null;
  globalsContent: string;
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

const DEFAULT_FILES: WorkspaceFile[] = [
  {
    id: 'budget',
    path: 'budget-2026.numr',
    displayName: 'Budget 2026',
    pinned: true,
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
    content: `# Unit conversion cheatsheet
meters   = 100
kilometers = meters / 1000
feet     = meters * 3.281
miles    = feet / 5280
`,
  },
];

const SAVE_DEBOUNCE_MS = 400;

export class WorkspaceStore {
  private state: WorkspaceState;
  private listeners = new Set<WorkspaceListener>();
  private engine: EngineHandle | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private hydrated = false;

  constructor() {
    this.state = {
      files: DEFAULT_FILES.map((f) => ({ ...f })),
      activeFileId: DEFAULT_FILES[0]?.id ?? null,
      globalsContent: DEFAULT_GLOBALS,
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
        this.state = {
          ...this.state,
          files: snapshot.files.map((f) => ({
            id: f.id,
            path: f.path,
            displayName: f.displayName,
            pinned: f.pinned,
            content: f.content,
          })),
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

  async evaluateActiveFile(): Promise<void> {
    const active = this.activeFile();
    if (!active || !this.engine) {
      this.update({ outcomes: [] });
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
      this.update({ outcomes, lastError: null });
    } catch (err) {
      this.update({
        outcomes: [],
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  selectFile(id: string): void {
    if (this.state.activeFileId === id) return;
    this.update({ activeFileId: id });
    void this.evaluateActiveFile();
  }

  setActiveContent(content: string): void {
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

  /** Add a new empty file and switch to it. */
  createFile(path: string, content = ''): WorkspaceFile {
    const id = uniqueId(this.state.files);
    const displayName = path.split('/').pop()?.replace(/\.numr$/, '') ?? path;
    const file: WorkspaceFile = {
      id,
      path,
      displayName,
      pinned: false,
      content: content || `# ${displayName}\n`,
    };
    this.update({
      files: [...this.state.files, file],
      activeFileId: id,
    });
    void this.evaluateActiveFile();
    this.scheduleSave();
    return file;
  }

  setMode(mode: WorkspaceState['mode']): void {
    this.update({ mode });
  }

  private activeFile(): WorkspaceFile | undefined {
    return this.state.files.find((f) => f.id === this.state.activeFileId);
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
      const files: PersistedFile[] = this.state.files.map((f) => ({
        id: f.id,
        path: f.path,
        displayName: f.displayName,
        pinned: f.pinned,
        content: f.content,
        updatedAt: Date.now(),
      }));
      await saveWorkspace({
        files,
        globalsContent: this.state.globalsContent,
      });
    } catch (err) {
      console.warn('[numera] persistence failed:', err);
    }
  }
}

function uniqueId(files: readonly WorkspaceFile[]): string {
  const used = new Set(files.map((f) => f.id));
  let i = files.length + 1;
  while (used.has(`file-${i}`)) i += 1;
  return `file-${i}`;
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

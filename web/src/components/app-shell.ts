import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { cycleTheme, type ThemeSetting } from '../lib/theme';
import { getSettings, subscribeSettings } from '../lib/settings';
import { WorkspaceStore } from '../lib/workspace';
import { initEngine } from '../lib/engine';
import { runSync } from '../lib/sync';
import './top-bar';
import './sidebar';
import './editor-area';
import './status-bar';
import './command-palette';
import './snackbar';
import './fab';
import './settings-page';

interface SidebarFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
  folderId: string | null;
  order: number;
}

interface SidebarFolder {
  id: string;
  name: string;
  pinned: boolean;
  collapsed: boolean;
  order: number;
}

@customElement('numera-app-shell')
export class NumeraAppShell extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-rows: var(--md-sys-app-bar-height) 1fr var(--md-sys-bottom-bar-height);
      grid-template-columns: var(--md-sys-side-panel-width) 1fr;
      grid-template-areas:
        'sidebar top-bar'
        'sidebar editor'
        'status-bar status-bar';
      width: 100%;
      height: 100%;
      background-color: var(--md-sys-color-background);
      color: var(--md-sys-color-on-background);
    }

    numera-top-bar {
      grid-area: top-bar;
    }

    numera-sidebar {
      grid-area: sidebar;
      min-width: 0;
      background-color: var(--md-sys-color-surface-container-low);
      border-inline-end: 1px solid var(--md-sys-color-outline-variant);
    }

    numera-editor {
      grid-area: editor;
      min-width: 0;
      background-color: var(--md-sys-color-surface);
    }

    numera-status-bar {
      grid-area: status-bar;
      background-color: var(--md-sys-color-surface-container-highest);
      border-top: 1px solid var(--md-sys-color-outline-variant);
    }

    numera-settings-page {
      grid-area: 1 / 1 / 4 / 3;
      min-width: 0;
      min-height: 0;
    }

    .sidebar-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      background-color: var(--md-sys-color-scrim);
      opacity: 0;
      z-index: 2;
      transition: opacity var(--md-sys-motion-duration-medium)
        var(--md-sys-motion-easing-emphasized);
    }

    @media (max-width: 1023px) {
      :host {
        grid-template-columns: 0 1fr;
        grid-template-areas:
          'top-bar top-bar'
          'sidebar editor'
          'status-bar status-bar';
      }

      numera-sidebar {
        position: fixed;
        inset-block: 0;
        inset-inline-start: 0;
        width: min(var(--md-sys-side-panel-width), calc(100% - 56px));
        z-index: 3;
        transform: translateX(-100%);
        transition: transform var(--md-sys-motion-duration-emphasized)
          var(--md-sys-motion-easing-emphasized);
        border-inline-end: none;
      }

      :host([sidebar-open]) numera-sidebar {
        transform: translateX(0);
      }

      :host([sidebar-open]) .sidebar-backdrop {
        display: block;
        opacity: 0.32;
      }
    }

    @media (min-width: 1024px) {
      :host {
        grid-template-columns: var(--md-sys-side-panel-width) 1fr;
      }

      :host([sidebar-collapsed]) {
        grid-template-columns: 0 1fr;
      }

      numera-sidebar {
        position: relative;
        z-index: 1;
        width: var(--md-sys-side-panel-width);
        transform: none;
        transition: transform var(--md-sys-motion-duration-emphasized)
          var(--md-sys-motion-easing-emphasized);
      }

      :host([sidebar-collapsed]) numera-sidebar {
        transform: translateX(-100%);
      }

      .sidebar-backdrop {
        display: none !important;
      }
    }
  `;

  @property({ type: Boolean, reflect: true, attribute: 'sidebar-open' })
  private sidebarOpen = false;

  @property({ type: Boolean, reflect: true, attribute: 'sidebar-collapsed' })
  private sidebarCollapsed = false;

  @state()
  private theme: ThemeSetting = 'auto';

  @state()
  private mode: 'Normal' | 'Insert' | 'Standard' = 'Standard';

  @state()
  private sidebarFiles: SidebarFile[] = [];

  @state()
  private sidebarFolders: SidebarFolder[] = [];

  @state()
  private selectedFileId: string | null = null;

  @state()
  private lastError: string | null = null;

  @state()
  private paletteOpen = false;

  @state()
  private editingGlobals = false;

  @state()
  private settingsOpen = false;

  private store = new WorkspaceStore();

  private settingsUnsub: (() => void) | null = null;

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Hydrate from IndexedDB first so the editor opens on the
    // user's last-known state, not the default fixtures.
    await this.store.hydrate();

    // Subscribe before attaching the engine so the first eval result
    // is broadcast to the freshly-mounted components.
    this.store.subscribe((state) => {
      this.sidebarFiles = state.files
        .filter((f) => !f.draft)
        .map((f) => ({
          id: f.id,
          path: f.path,
          displayName: f.displayName,
          pinned: f.pinned,
          folderId: f.folderId,
          order: f.order,
        }));
      this.sidebarFolders = state.folders.map((fd) => ({
        id: fd.id,
        name: fd.name,
        pinned: fd.pinned,
        collapsed: fd.collapsed,
        order: fd.order,
      }));
      this.selectedFileId = state.activeFileId;
      this.editingGlobals = state.editingTarget === 'globals';
      this.mode = state.mode;
      this.lastError = state.lastError;
    });

    // Push the current settings into the store so the first evaluation
    // is formatted per user prefs, then live-update (re-format only,
    // no re-evaluation) whenever the settings page changes them.
    this.store.setSettings(getSettings());
    this.settingsUnsub = subscribeSettings((s) => this.store.setSettings(s));

    // Ctrl/Cmd+K opens the command palette.
    window.addEventListener('numera-keyevent', this.handleGlobalKeyEvent as EventListener);

    // Flush any pending debounced save before the page is hidden or
    // unloaded, so edits survive a refresh/tab-switch.
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handlePageHide);

    try {
      const engine = await initEngine();
      this.store.attachEngine(engine);
      await this.store.evaluateActiveFile();
    } catch (err) {
      console.error('[numera] failed to initialise engine:', err);
      this.lastError = err instanceof Error ? err.message : String(err);
    }

    // Auto-sync on startup when a WebDAV URL is configured. Fire-and-forget so
    // the shell paints immediately; the outcome surfaces through the snackbar.
    const { url, folder, username, password } = getSettings().sync.webdav;
    if (url) {
      void (async () => {
        try {
          const result = await runSync(this.store, { url, folder, username, password });
          const { pushed, pulled, conflicts, deleted } = result;
          if (pushed === 0 && pulled === 0 && conflicts === 0 && deleted === 0) {
            this.showSnackbar('Already up to date');
          } else {
            let summary = `Synced: ${pushed} up, ${pulled} down`;
            if (conflicts > 0) {
              summary += `, ${conflicts} conflict${conflicts === 1 ? '' : 's'}`;
            }
            if (deleted > 0) summary += `, ${deleted} deleted`;
            this.showSnackbar(summary);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.showSnackbar(`Sync failed: ${message}`);
        }
      })();
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.settingsUnsub?.();
    this.settingsUnsub = null;
    window.removeEventListener('numera-keyevent', this.handleGlobalKeyEvent as EventListener);
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.handlePageHide);
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      this.store.flush();
    }
  };

  private handlePageHide = () => {
    this.store.flush();
  };

  private handleGlobalKeyEvent = (event: CustomEvent<{ input: { key: string; ctrl: boolean; meta: boolean } }>) => {
    const { input } = event.detail;
    if ((input.ctrl || input.meta) && (input.key === 'k' || input.key === 'K')) {
      event.preventDefault?.();
      this.paletteOpen = true;
    }
  };

  private handleFileSelect = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    this.store.selectFile(custom.detail.id);
    this.sidebarOpen = false;
  };

  private handleFileCreate = () => {
    const next = `untitled-${this.sidebarFiles.length + 1}.numr`;
    this.store.createFile(next);
    this.sidebarOpen = false;
    this.showSnackbar(`Created ${next}`);
  };

  private get isDesktop(): boolean {
    return window.matchMedia('(min-width: 1024px)').matches;
  }

  private handleMenuToggle = () => {
    if (this.isDesktop) {
      // Desktop: the collapsed sidebar re-expands via the top-bar hamburger.
      this.sidebarCollapsed = false;
    } else {
      // Mobile: toggle the off-canvas drawer.
      this.sidebarOpen = !this.sidebarOpen;
    }
  };

  private handleCollapseToggle = () => {
    if (this.isDesktop) {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    } else {
      this.sidebarOpen = false;
    }
  };

  private handleFilePin = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    this.store.togglePin(custom.detail.id);
  };

  private handleFileRename = (event: Event) => {
    const custom = event as CustomEvent<{ id: string; name: string }>;
    this.store.renameFile(custom.detail.id, custom.detail.name);
  };

  private handleFileExport = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    const file = this.store
      .getState()
      .files.find((f) => f.id === custom.detail.id);
    if (!file) return;
    const filename = `${file.displayName || file.path.split('/').pop() || 'file'}.numr`;
    const blob = new Blob([file.content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  private handleFileDelete = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    this.store.deleteFile(custom.detail.id);
  };

  private handleFileReorder = (event: Event) => {
    const custom = event as CustomEvent<{ id: string; beforeId: string | null }>;
    this.store.moveFile(custom.detail.id, custom.detail.beforeId);
  };

  private handleFileMoveFolder = (event: Event) => {
    const custom = event as CustomEvent<{ id: string; folderId: string | null }>;
    this.store.moveFileToFolder(custom.detail.id, custom.detail.folderId);
  };

  private handleFolderToggle = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    this.store.toggleFolderCollapsed(custom.detail.id);
  };

  private handleFolderPin = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    this.store.toggleFolderPin(custom.detail.id);
  };

  private handleFolderRename = (event: Event) => {
    const custom = event as CustomEvent<{ id: string; name: string }>;
    this.store.renameFolder(custom.detail.id, custom.detail.name);
  };

  private handleFolderDelete = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    this.store.deleteFolder(custom.detail.id);
  };

  private handleFolderCreate = (event: Event) => {
    const custom = event as CustomEvent<{ name: string; moveFileId?: string }>;
    try {
      const folder = this.store.createFolder(custom.detail.name);
      if (custom.detail.moveFileId) {
        this.store.moveFileToFolder(custom.detail.moveFileId, folder.id);
      }
    } catch {
      // createFolder throws on blank or path-separator names; the sidebar
      // already trims, so this only guards against unexpected input.
    }
  };

  private handleSettingsOpen = () => {
    this.settingsOpen = true;
  };

  private handleSettingsClose = () => {
    this.settingsOpen = false;
  };

  private handleResultCopied = (event: Event) => {
    const custom = event as CustomEvent<{ value: string }>;
    this.showSnackbar(`Copied ${custom.detail.value}`);
  };

  private handleThemeToggle = () => {
    this.theme = cycleTheme(this.theme);
  };

  private handleBackdropClick = () => {
    this.sidebarOpen = false;
  };

  private handleFabSearch = () => {
    this.paletteOpen = true;
  };

  private handleFabNewDraft = () => {
    this.store.createDraft();
    this.sidebarOpen = false;
  };

  private handleGlobalOpen = () => {
    this.store.openGlobals();
  };

  private handleGlobalsClose = () => {
    this.store.closeGlobals();
  };

  private handlePaletteClose = () => {
    this.paletteOpen = false;
  };

  private handlePaletteSelectFile = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    this.store.selectFile(custom.detail.id);
  };

  private handlePaletteCommand = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    if (custom.detail.id === 'new-file') {
      this.handleFileCreate();
    } else if (custom.detail.id === 'toggle-theme') {
      this.theme = cycleTheme(this.theme);
    }
  };

  private showSnackbar(message: string): void {
    const snackbar = this.renderRoot.querySelector<import('./snackbar').NumeraSnackbar>(
      'numera-snackbar',
    );
    snackbar?.show(message);
  }

  render() {
    if (this.settingsOpen) {
      return html`
        <numera-settings-page
          .store=${this.store}
          @settings-close=${this.handleSettingsClose}
        ></numera-settings-page>
      `;
    }

    const activeFile = this.sidebarFiles.find((f) => f.id === this.selectedFileId);
    const fileName = activeFile
      ? (activeFile.displayName || activeFile.path.split('/').pop()?.replace(/\.numr$/, '') || activeFile.path)
      : 'Numera';

    return html`
      <numera-top-bar
        .fileName=${fileName}
        .sidebarOpen=${this.sidebarOpen}
        .sidebarCollapsed=${this.sidebarCollapsed}
        .editingGlobals=${this.editingGlobals}
        @menu-toggle=${this.handleMenuToggle}
        @global-open=${this.handleGlobalOpen}
        @globals-close=${this.handleGlobalsClose}
      ></numera-top-bar>

      <numera-sidebar
        .files=${this.sidebarFiles}
        .folders=${this.sidebarFolders}
        .selectedId=${this.selectedFileId ?? ''}
        @file-select=${this.handleFileSelect}
        @file-pin=${this.handleFilePin}
        @file-rename=${this.handleFileRename}
        @file-export=${this.handleFileExport}
        @file-delete=${this.handleFileDelete}
        @file-reorder=${this.handleFileReorder}
        @file-move-folder=${this.handleFileMoveFolder}
        @folder-toggle=${this.handleFolderToggle}
        @folder-pin=${this.handleFolderPin}
        @folder-rename=${this.handleFolderRename}
        @folder-delete=${this.handleFolderDelete}
        @folder-create=${this.handleFolderCreate}
        @theme-toggle=${this.handleThemeToggle}
        @settings-open=${this.handleSettingsOpen}
        @collapse-toggle=${this.handleCollapseToggle}
      ></numera-sidebar>

      <numera-editor .store=${this.store} @result-copied=${this.handleResultCopied}></numera-editor>

      <numera-status-bar .mode=${this.mode} .lastError=${this.lastError}></numera-status-bar>

      <div class="sidebar-backdrop" aria-hidden="true" @click=${this.handleBackdropClick}></div>

      <numera-command-palette
        .open=${this.paletteOpen}
        .files=${this.sidebarFiles}
        .theme=${this.theme}
        @palette-select-file=${this.handlePaletteSelectFile}
        @palette-command=${this.handlePaletteCommand}
        @palette-close=${this.handlePaletteClose}
      ></numera-command-palette>

      <numera-fab
        @fab-new-file=${this.handleFileCreate}
        @fab-new-draft=${this.handleFabNewDraft}
        @fab-search=${this.handleFabSearch}
      ></numera-fab>

      <numera-snackbar></numera-snackbar>
    `;
  }
}

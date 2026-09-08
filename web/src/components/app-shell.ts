import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { cycleTheme, type ThemeSetting } from '../lib/theme';
import { WorkspaceStore } from '../lib/workspace';
import { initEngine } from '../lib/engine';
import './top-bar';
import './sidebar';
import './editor-area';
import './status-bar';
import './command-palette';
import './snackbar';

interface SidebarFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
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
  private selectedFileId: string | null = null;

  @state()
  private lastError: string | null = null;

  @state()
  private paletteOpen = false;

  private store = new WorkspaceStore();

  async connectedCallback(): Promise<void> {
    super.connectedCallback();

    // Hydrate from IndexedDB first so the editor opens on the
    // user's last-known state, not the default fixtures.
    await this.store.hydrate();

    // Subscribe before attaching the engine so the first eval result
    // is broadcast to the freshly-mounted components.
    this.store.subscribe((state) => {
      this.sidebarFiles = state.files.map((f) => ({
        id: f.id,
        path: f.path,
        displayName: f.displayName,
        pinned: f.pinned,
      }));
      this.selectedFileId = state.activeFileId;
      this.mode = state.mode;
      this.lastError = state.lastError;
    });

    // Ctrl/Cmd+K opens the command palette.
    window.addEventListener('numera-keyevent', this.handleGlobalKeyEvent as EventListener);

    try {
      const engine = await initEngine();
      this.store.attachEngine(engine);
      await this.store.evaluateActiveFile();
    } catch (err) {
      console.error('[numera] failed to initialise engine:', err);
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('numera-keyevent', this.handleGlobalKeyEvent as EventListener);
  }

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

  private handleThemeToggle = () => {
    this.theme = cycleTheme(this.theme);
  };

  private handleBackdropClick = () => {
    this.sidebarOpen = false;
  };

  private handleCommandPalette = () => {
    this.paletteOpen = true;
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
    const activeFile = this.sidebarFiles.find((f) => f.id === this.selectedFileId);
    const fileName = activeFile
      ? (activeFile.path.split('/').pop()?.replace(/\.numr$/, '') ?? activeFile.path)
      : 'Numera';

    return html`
      <numera-top-bar
        .fileName=${fileName}
        .sidebarOpen=${this.sidebarOpen}
        .sidebarCollapsed=${this.sidebarCollapsed}
        .theme=${this.theme}
        @menu-toggle=${this.handleMenuToggle}
        @theme-toggle=${this.handleThemeToggle}
        @command-palette=${this.handleCommandPalette}
      ></numera-top-bar>

      <numera-sidebar
        .files=${this.sidebarFiles}
        .selectedId=${this.selectedFileId ?? ''}
        @file-select=${this.handleFileSelect}
        @file-create=${this.handleFileCreate}
        @collapse-toggle=${this.handleCollapseToggle}
      ></numera-sidebar>

      <numera-editor .store=${this.store}></numera-editor>

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

      <numera-snackbar></numera-snackbar>
    `;
  }
}

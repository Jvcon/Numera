import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { cycleTheme, type ThemeSetting } from '../lib/theme';
import './top-bar';
import './sidebar';
import './editor-area';
import './status-bar';

interface NumeraFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
}

const PLACEHOLDER_FILES: NumeraFile[] = [
  {
    id: '1',
    path: 'budget-2026.numr',
    displayName: 'Budget 2026',
    pinned: true,
  },
  {
    id: '2',
    path: 'daily/2026-09-07.numr',
    displayName: 'Daily — Sep 7',
    pinned: false,
  },
  {
    id: '3',
    path: 'unit-cheatsheet.numr',
    displayName: 'Unit Cheatsheet',
    pinned: false,
  },
  {
    id: '4',
    path: 'investment-tracker.numr',
    displayName: 'Investment Tracker',
    pinned: false,
  },
  {
    id: '5',
    path: 'trips/kyoto-2026.numr',
    displayName: 'Kyoto 2026',
    pinned: false,
  },
];

@customElement('numera-app-shell')
export class NumeraAppShell extends LitElement {
  static styles = css`
    :host {
      display: grid;
      grid-template-rows: auto 1fr auto;
      grid-template-columns: 280px 1fr;
      grid-template-areas:
        'top-bar top-bar'
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
      transition: opacity var(--md-sys-motion-duration-medium) var(--md-sys-motion-easing-emphasized);
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
        width: min(280px, calc(100% - 56px));
        z-index: 3;
        transform: translateX(-100%);
        transition: transform var(--md-sys-motion-duration-emphasized) var(--md-sys-motion-easing-emphasized);
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
        grid-template-columns: 280px 1fr;
      }

      numera-sidebar {
        position: static;
        transform: none;
        transition: none;
      }

      .sidebar-backdrop {
        display: none !important;
      }
    }
  `;

  @state()
  private selectedFileId = PLACEHOLDER_FILES[0]?.id ?? '';

  @property({ type: Boolean, reflect: true, attribute: 'sidebar-open' })
  private sidebarOpen = false;

  @state()
  private theme: ThemeSetting = 'auto';

  @state()
  private mode: 'Normal' | 'Insert' | 'Standard' = 'Standard';

  private handleFileSelect = (event: Event) => {
    const custom = event as CustomEvent<{ id: string }>;
    this.selectedFileId = custom.detail.id;
    this.sidebarOpen = false;
  };

  private handleMenuToggle = () => {
    this.sidebarOpen = !this.sidebarOpen;
  };

  private handleSidebarClose = () => {
    this.sidebarOpen = false;
  };

  private handleThemeToggle = () => {
    this.theme = cycleTheme(this.theme);
  };

  private handleBackdropClick = () => {
    this.sidebarOpen = false;
  };

  render() {
    const selectedFile = PLACEHOLDER_FILES.find((f) => f.id === this.selectedFileId) ?? null;

    return html`
      <numera-top-bar
        .sidebarOpen=${this.sidebarOpen}
        .theme=${this.theme}
        @menu-toggle=${this.handleMenuToggle}
        @theme-toggle=${this.handleThemeToggle}
      ></numera-top-bar>

      <numera-sidebar
        .files=${PLACEHOLDER_FILES}
        .selectedId=${this.selectedFileId}
        @file-select=${this.handleFileSelect}
        @close=${this.handleSidebarClose}
      ></numera-sidebar>

      <numera-editor .file=${selectedFile} .mode=${this.mode}></numera-editor>

      <numera-status-bar .mode=${this.mode}></numera-status-bar>

      <div
        class="sidebar-backdrop"
        aria-hidden="true"
        @click=${this.handleBackdropClick}
      ></div>
    `;
  }
}

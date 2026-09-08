import { LitElement, html, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { ThemeSetting } from '../lib/theme';

/**
 * Command palette — a keyboard-first modal for switching files and
 * running commands (new file, toggle theme). Triggered by Ctrl/Cmd+K
 * or the top-bar search button.
 *
 * Events (bubbling + composed):
 *   - `palette-select-file`  detail `{ id }`
 *   - `palette-command`      detail `{ id }`
 *   - `palette-close`
 */

export interface PaletteFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
}

interface PaletteItem {
  id: string;
  label: string;
  detail: string;
  kind: 'file' | 'command';
  pinned?: boolean;
}

const ICONS = {
  file: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>`,
  folder: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
  plus: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
  theme: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>`,
  pin: html`<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M16 12V4H17V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,
  search: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
};

@customElement('numera-command-palette')
export class NumeraCommandPalette extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 12vh;
      background-color: var(--md-sys-color-scrim);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--md-sys-motion-duration-medium)
        var(--md-sys-motion-easing-emphasized);
    }

    :host([open]) .backdrop {
      opacity: 1;
      pointer-events: auto;
    }

    .panel {
      width: min(38rem, calc(100vw - 32px));
      max-height: 60vh;
      display: flex;
      flex-direction: column;
      background-color: var(--md-sys-color-surface-container-high);
      color: var(--md-sys-color-on-surface);
      border-radius: var(--md-sys-shape-dialog);
      box-shadow: var(--md-sys-elevation-dialog);
      overflow: hidden;
      transform: translateY(-8px) scale(0.98);
      transition: transform var(--md-sys-motion-duration-emphasized)
        var(--md-sys-motion-easing-emphasized-decelerate);
    }

    :host([open]) .panel {
      transform: translateY(0) scale(1);
    }

    .search-row {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-loose);
      padding: var(--md-sys-spacing-block) var(--md-sys-spacing-block-loose);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
    }

    .search-row md-icon {
      color: var(--md-sys-color-on-surface-variant);
    }

    .search-input {
      flex: 1;
      border: none;
      outline: none;
      background: transparent;
      color: var(--md-sys-color-on-surface);
      font-family: var(--md-sys-typescale-font-plain);
      font-size: var(--md-sys-typescale-title-medium-size);
      line-height: var(--md-sys-typescale-title-medium-line);
      font-weight: var(--md-sys-typescale-title-medium-weight);
      letter-spacing: var(--md-sys-typescale-title-medium-tracking);
    }

    .search-input::placeholder {
      color: var(--md-sys-color-on-surface-variant);
    }

    .results {
      overflow-y: auto;
      padding: var(--md-sys-spacing-inline-tight);
    }

    .group-label {
      padding: var(--md-sys-spacing-inline-tight) var(--md-sys-spacing-inline-loose);
      font-family: var(--md-sys-typescale-label-medium-font);
      font-size: var(--md-sys-typescale-label-medium-size);
      line-height: var(--md-sys-typescale-label-medium-line);
      font-weight: var(--md-sys-typescale-label-medium-weight);
      letter-spacing: var(--md-sys-typescale-label-medium-tracking);
      text-transform: uppercase;
      color: var(--md-sys-color-on-surface-variant);
    }

    .item {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-loose);
      padding: var(--md-sys-spacing-inline) var(--md-sys-spacing-inline-loose);
      border-radius: var(--md-sys-shape-corner-small);
      cursor: pointer;
    }

    .item[data-selected='true'] {
      background-color: var(--md-sys-color-secondary-container);
      color: var(--md-sys-color-on-secondary-container);
    }

    .item-icon {
      display: inline-flex;
      flex-shrink: 0;
      color: var(--md-sys-color-on-surface-variant);
    }

    .item[data-selected='true'] .item-icon {
      color: var(--md-sys-color-on-secondary-container);
    }

    .item-body {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .item-label {
      font-family: var(--md-sys-typescale-title-small-font);
      font-size: var(--md-sys-typescale-title-small-size);
      line-height: var(--md-sys-typescale-title-small-line);
      font-weight: var(--md-sys-typescale-title-small-weight);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item-detail {
      font-family: var(--md-sys-typescale-label-small-font);
      font-size: var(--md-sys-typescale-label-small-size);
      line-height: var(--md-sys-typescale-label-small-line);
      color: var(--md-sys-color-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .item[data-selected='true'] .item-detail {
      color: var(--md-sys-color-on-secondary-container);
    }

    .item-pin {
      margin-inline-start: auto;
      flex-shrink: 0;
      color: var(--md-sys-color-primary);
    }

    .empty-hint {
      padding: var(--md-sys-spacing-block);
      text-align: center;
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--md-sys-typescale-body-medium-font);
      font-size: var(--md-sys-typescale-body-medium-size);
      line-height: var(--md-sys-typescale-body-medium-line);
    }

    @media (prefers-reduced-motion: reduce) {
      .backdrop,
      .panel {
        transition: none;
      }
    }
  `;

  @property({ type: Boolean, reflect: true }) open = false;

  @property({ attribute: false }) files: PaletteFile[] = [];

  @property() theme: ThemeSetting = 'auto';

  @state()
  private query = '';

  @state()
  private selectedIndex = 0;

  private inputEl: HTMLInputElement | null = null;

  private get commands(): PaletteItem[] {
    return [
      {
        id: 'new-file',
        label: 'New file',
        detail: 'Create a new .numr file',
        kind: 'command',
      },
      {
        id: 'toggle-theme',
        label: 'Toggle theme',
        detail: `Current theme: ${this.theme}`,
        kind: 'command',
      },
    ];
  }

  private get fileItems(): PaletteItem[] {
    return this.files.map((f) => ({
      id: f.id,
      label: f.displayName,
      detail: f.path,
      kind: 'file' as const,
      pinned: f.pinned,
    }));
  }

  private get filteredItems(): PaletteItem[] {
    const all = [...this.fileItems, ...this.commands];
    const q = this.query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q),
    );
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('open')) {
      if (this.open) {
        this.query = '';
        this.selectedIndex = 0;
        // Focus the input after the panel renders.
        requestAnimationFrame(() => this.inputEl?.focus());
      }
    }
  }

  private clampSelected(): void {
    const count = this.filteredItems.length;
    if (count === 0) {
      this.selectedIndex = 0;
      return;
    }
    this.selectedIndex = ((this.selectedIndex % count) + count) % count;
  }

  private handleInput(event: Event) {
    this.query = (event.target as HTMLInputElement).value;
    this.selectedIndex = 0;
  }

  private handleKeydown(event: KeyboardEvent) {
    if (!this.open) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selectedIndex = this.selectedIndex + 1;
      this.clampSelected();
      this.scrollSelectedIntoView();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selectedIndex = this.selectedIndex - 1;
      this.clampSelected();
      this.scrollSelectedIntoView();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.activate(this.selectedIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  private scrollSelectedIntoView(): void {
    requestAnimationFrame(() => {
      const selected = this.renderRoot.querySelector<HTMLElement>(
        '.item[data-selected="true"]',
      );
      selected?.scrollIntoView({ block: 'nearest' });
    });
  }

  private activate(index: number): void {
    const item = this.filteredItems[index];
    if (!item) return;
    if (item.kind === 'file') {
      this.dispatchEvent(
        new CustomEvent('palette-select-file', {
          detail: { id: item.id },
          bubbles: true,
          composed: true,
        }),
      );
    } else {
      this.dispatchEvent(
        new CustomEvent('palette-command', {
          detail: { id: item.id },
          bubbles: true,
          composed: true,
        }),
      );
    }
    this.close();
  }

  private close(): void {
    this.dispatchEvent(
      new CustomEvent('palette-close', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private handleBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('backdrop')) {
      this.close();
    }
  }

  private renderItem(item: PaletteItem, index: number) {
    const isSelected = index === this.selectedIndex;
    const icon =
      item.kind === 'command'
        ? item.id === 'toggle-theme'
          ? ICONS.theme
          : ICONS.plus
        : item.detail.includes('/')
          ? ICONS.folder
          : ICONS.file;

    return html`
      <div
        class="item"
        data-selected=${isSelected}
        @click=${() => this.activate(index)}
        @mousemove=${() => {
          if (!isSelected) this.selectedIndex = index;
        }}
      >
        <span class="item-icon">${icon}</span>
        <span class="item-body">
          <span class="item-label">${item.label}</span>
          <span class="item-detail">${item.detail}</span>
        </span>
        ${item.kind === 'file' && item.pinned
          ? html`<span class="item-pin">${ICONS.pin}</span>`
          : nothing}
      </div>
    `;
  }

  render() {
    if (!this.open) return nothing;

    const items = this.filteredItems;
    const fileItems = items.filter((i) => i.kind === 'file');
    const commandItems = items.filter((i) => i.kind === 'command');

    return html`
      <div class="backdrop" @mousedown=${this.handleBackdropClick}>
        <div class="panel" role="dialog" aria-modal="true" aria-label="Command palette">
          <div class="search-row">
            <md-icon>${ICONS.search}</md-icon>
            <input
              class="search-input"
              type="text"
              placeholder="Search files and commands…"
              .value=${this.query}
              @input=${this.handleInput}
              @keydown=${this.handleKeydown}
              spellcheck="false"
              autocomplete="off"
              ${(el: HTMLInputElement) => (this.inputEl = el)}
            />
          </div>
          <div class="results">
            ${items.length === 0
              ? html`<div class="empty-hint">No matches for “${this.query}”</div>`
              : html`
                  ${fileItems.length > 0
                    ? html`<div class="group-label">Files</div>`
                    : nothing}
                  ${fileItems.map((item, i) => this.renderItem(item, i))}
                  ${commandItems.length > 0
                    ? html`<div class="group-label">Commands</div>`
                    : nothing}
                  ${commandItems.map((item, i) =>
                    this.renderItem(item, fileItems.length + i),
                  )}
                `}
          </div>
        </div>
      </div>
    `;
  }
}

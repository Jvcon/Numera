import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

interface NumeraFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
}

const ICONS = {
  menu: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`,
  file: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>`,
  folder: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
  pin: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 12V4H17V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,
  plus: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
};

@customElement('numera-sidebar')
export class NumeraSidebar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background-color: var(--md-sys-color-surface-container-low);
      color: var(--md-sys-color-on-surface);
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--md-sys-spacing-inline-tight);
      padding-inline: var(--md-sys-spacing-inline-tight) var(--md-sys-spacing-inline);
      height: var(--md-sys-app-bar-height);
    }

    .header-start {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
      min-width: 0;
    }

    .brand {
      font-family: var(--md-sys-typescale-font-brand);
      font-size: var(--md-sys-typescale-title-large-size);
      line-height: var(--md-sys-typescale-title-large-line);
      font-weight: var(--md-sys-typescale-title-large-weight);
      letter-spacing: var(--md-sys-typescale-title-large-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
    }

    .file-list {
      flex: 1;
      overflow-y: auto;
      padding-block: var(--md-sys-spacing-block-tight);
    }

    md-list-item {
      --md-list-item-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-supporting-text-color: var(--md-sys-color-on-surface-variant);
      --md-list-item-hover-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-focus-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-container-color: transparent;
      --md-list-item-hover-container-color: color-mix(
        in srgb,
        var(--md-sys-color-on-surface) calc(var(--md-sys-state-hover-state-layer-opacity) * 100%),
        transparent
      );
      --md-list-item-focus-container-color: color-mix(
        in srgb,
        var(--md-sys-color-on-surface) calc(var(--md-sys-state-focus-state-layer-opacity) * 100%),
        transparent
      );
      cursor: pointer;
    }

    md-list-item[selected] {
      --md-list-item-container-color: var(--md-sys-color-secondary-container);
      --md-list-item-label-text-color: var(--md-sys-color-on-secondary-container);
      --md-list-item-supporting-text-color: var(--md-sys-color-on-secondary-container);
    }

    md-list-item[selected] .pin-icon {
      color: var(--md-sys-color-on-secondary-container);
    }

    .pin-icon {
      flex-shrink: 0;
      color: var(--md-sys-color-primary);
      opacity: 0.87;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--md-sys-spacing-inline);
      padding: var(--md-sys-spacing-section) var(--md-sys-spacing-block-loose);
      text-align: center;
      color: var(--md-sys-color-on-surface-variant);
    }

    .empty-state-title {
      font-family: var(--md-sys-typescale-title-small-font);
      font-size: var(--md-sys-typescale-title-small-size);
      line-height: var(--md-sys-typescale-title-small-line);
      font-weight: var(--md-sys-typescale-title-small-weight);
      letter-spacing: var(--md-sys-typescale-title-small-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .empty-state-body {
      font-family: var(--md-sys-typescale-body-small-font);
      font-size: var(--md-sys-typescale-body-small-size);
      line-height: var(--md-sys-typescale-body-small-line);
      font-weight: var(--md-sys-typescale-body-small-weight);
      letter-spacing: var(--md-sys-typescale-body-small-tracking);
    }
  `;

  @property({ type: Array }) files: NumeraFile[] = [];

  @property() selectedId = '';

  private dispatchSelect(id: string) {
    this.dispatchEvent(
      new CustomEvent('file-select', {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchCollapseToggle() {
    this.dispatchEvent(
      new CustomEvent('collapse-toggle', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchCreate() {
    this.dispatchEvent(
      new CustomEvent('file-create', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private renderFileItem(file: NumeraFile) {
    const isSelected = file.id === this.selectedId;
    const directory = file.path.includes('/')
      ? file.path.slice(0, file.path.lastIndexOf('/'))
      : undefined;

    return html`
      <md-list-item
        type="button"
        ?selected=${isSelected}
        aria-selected=${isSelected}
        @click=${() => this.dispatchSelect(file.id)}
      >
        <md-icon slot="start">${directory ? ICONS.folder : ICONS.file}</md-icon>
        <div slot="headline">${file.displayName}</div>
        ${directory ? html`<div slot="supporting-text">${directory}/</div>` : null}
        ${file.pinned
          ? html`<md-icon class="pin-icon" slot="end">${ICONS.pin}</md-icon>`
          : null}
      </md-list-item>
    `;
  }

  render() {
    return html`
      <div class="header">
        <div class="header-start">
          <md-icon-button
            class="collapse-button"
            aria-label="Toggle sidebar"
            title="Toggle sidebar"
            @click=${this.dispatchCollapseToggle}
          >
            <md-icon>${ICONS.menu}</md-icon>
          </md-icon-button>
          <div class="brand">Numera</div>
        </div>
        <div class="header-actions">
          <md-icon-button
            aria-label="New file"
            title="New file"
            @click=${this.dispatchCreate}
          >
            <md-icon>${ICONS.plus}</md-icon>
          </md-icon-button>
        </div>
      </div>

      <md-list class="file-list">
        ${this.files.length === 0
          ? html`
              <div class="empty-state">
                <div class="empty-state-title">No files yet</div>
                <div class="empty-state-body">
                  Your .numr files will appear here once your workspace is connected.
                </div>
              </div>
            `
          : this.files.map((file) => this.renderFileItem(file))}
      </md-list>
    `;
  }
}

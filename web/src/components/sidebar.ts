import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

interface NumeraFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
}

const ICONS = {
  file: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/></svg>`,
  folder: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`,
  pin: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 12V4H17V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>`,
  close: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
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
      padding: 16px 12px 8px 16px;
      min-height: 56px;
    }

    .header-title {
      font-family: 'Roboto', sans-serif;
      font-size: 1rem;
      font-weight: 500;
      line-height: 1.5;
      letter-spacing: 0.00625em;
      color: var(--md-sys-color-on-surface-variant);
    }

    .close-button {
      display: none;
    }

    .file-list {
      flex: 1;
      overflow-y: auto;
      padding-block: 8px;
    }

    md-list-item {
      --md-list-item-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-supporting-text-color: var(--md-sys-color-on-surface-variant);
      --md-list-item-hover-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-focus-label-text-color: var(--md-sys-color-on-surface);
      --md-list-item-container-color: transparent;
      --md-list-item-hover-container-color: color-mix(in srgb, var(--md-sys-color-on-surface) 8%, transparent);
      --md-list-item-focus-container-color: color-mix(in srgb, var(--md-sys-color-on-surface) 10%, transparent);
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
      gap: 8px;
      padding: 32px 24px;
      text-align: center;
      color: var(--md-sys-color-on-surface-variant);
    }

    .empty-state-title {
      font-size: 1rem;
      font-weight: 500;
      color: var(--md-sys-color-on-surface);
    }

    .empty-state-body {
      font-size: 0.875rem;
      line-height: 1.25rem;
    }

    @media (max-width: 1023px) {
      .close-button {
        display: inline-flex;
      }
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

  private dispatchClose() {
    this.dispatchEvent(
      new CustomEvent('close', {
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
        <div class="header-title">Files</div>
        <md-icon-button
          class="close-button"
          aria-label="Close sidebar"
          @click=${this.dispatchClose}
        >
          <md-icon>${ICONS.close}</md-icon>
        </md-icon-button>
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

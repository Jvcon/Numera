import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

interface NumeraFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
}

const EXAMPLE_CONTENT = `# Welcome to Numera
# A natural-language text calculator

monthly_income = $6,500
tax_rate       = 22%
rent           = $1,800
savings        = monthly_income * (1 - tax_rate) - rent

# Try editing this file. Keyboard events are captured
# by the wasm-ready bridge and logged to the dev overlay.
`;

@customElement('numera-editor')
export class NumeraEditor extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background-color: var(--md-sys-color-surface);
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 12px 16px;
      min-height: 48px;
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      background-color: var(--md-sys-color-surface-container-low);
    }

    .file-name {
      font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
      font-size: 0.875rem;
      font-weight: 500;
      line-height: 1.25rem;
      color: var(--md-sys-color-on-surface);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .file-meta {
      font-size: 0.75rem;
      line-height: 1rem;
      color: var(--md-sys-color-on-surface-variant);
      margin-inline-start: auto;
    }

    .editor-wrapper {
      flex: 1;
      position: relative;
      padding: 16px;
      overflow: hidden;
    }

    textarea {
      width: 100%;
      height: 100%;
      padding: 16px;
      resize: none;
      border: 1px solid var(--md-sys-color-outline);
      border-radius: 4px;
      background-color: var(--md-sys-color-surface);
      color: var(--md-sys-color-on-surface);
      font-family: 'JetBrains Mono', 'Roboto Mono', monospace;
      font-size: 0.9375rem;
      line-height: 1.5rem;
      letter-spacing: 0;
      tab-size: 2;
      caret-color: var(--md-sys-color-primary);
      transition:
        border-color var(--md-sys-motion-duration-fast) var(--md-sys-motion-easing-standard),
        box-shadow var(--md-sys-motion-duration-fast) var(--md-sys-motion-easing-standard);
    }

    textarea:hover {
      border-color: var(--md-sys-color-on-surface);
    }

    textarea:focus {
      outline: none;
      border-color: var(--md-sys-color-primary);
      box-shadow: 0 0 0 1px var(--md-sys-color-primary);
    }

    .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--md-sys-color-on-surface-variant);
      font-size: 0.875rem;
    }

    @media (max-width: 639px) {
      .editor-wrapper {
        padding: 8px;
      }

      textarea {
        padding: 12px;
      }
    }
  `;

  @property({ attribute: false }) file: NumeraFile | null = null;

  @property() mode: 'Normal' | 'Insert' | 'Standard' = 'Standard';

  @state()
  private content = EXAMPLE_CONTENT;

  private handleInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    this.content = target.value;
  }

  render() {
    if (!this.file) {
      return html`<div class="empty">Select a file from the sidebar to begin.</div>`;
    }

    return html`
      <div class="header">
        <div class="file-name">${this.file.path}</div>
        <div class="file-meta">${this.mode} mode</div>
      </div>
      <div class="editor-wrapper">
        <textarea
          .value=${this.content}
          @input=${this.handleInput}
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          aria-label="Editor for ${this.file.displayName}"
        ></textarea>
      </div>
    `;
  }
}

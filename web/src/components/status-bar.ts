import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('numera-status-bar')
export class NumeraStatusBar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--md-sys-spacing-block);
      height: var(--md-sys-bottom-bar-height);
      padding-inline: var(--md-sys-spacing-block);
      background-color: var(--md-sys-color-surface-container-highest);
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--md-sys-typescale-label-medium-font);
      font-size: var(--md-sys-typescale-label-medium-size);
      line-height: var(--md-sys-typescale-label-medium-line);
      font-weight: var(--md-sys-typescale-label-medium-weight);
      letter-spacing: var(--md-sys-typescale-label-medium-tracking);
      border-top: 1px solid var(--md-sys-color-outline-variant);
    }

    .mode {
      display: inline-flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline);
      flex-shrink: 0;
      font-weight: 500;
      color: var(--md-sys-color-on-surface);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .mode-dot {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: var(--md-sys-shape-corner-full);
      background-color: var(--md-sys-color-primary);
    }

    .status {
      flex: 1;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      text-align: end;
      color: var(--md-sys-color-on-surface-variant);
    }

    .status[data-tone='error'] {
      color: var(--md-sys-color-error);
    }

    @media (max-width: 639px) {
      .status {
        max-width: 50%;
      }
    }
  `;

  @property() mode: 'Normal' | 'Insert' | 'Standard' = 'Standard';

  @property({ attribute: false }) lastError: string | null = null;

  render() {
    const status = this.lastError ? `⚠ ${this.lastError}` : 'Press Ctrl+K for commands';
    return html`
      <div class="mode" aria-live="polite">
        <span class="mode-dot" aria-hidden="true"></span>
        ${this.mode}
      </div>
      <div class="status" data-tone=${this.lastError ? 'error' : 'normal'}>${status}</div>
    `;
  }
}

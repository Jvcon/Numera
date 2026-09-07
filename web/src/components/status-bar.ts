import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('numera-status-bar')
export class NumeraStatusBar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      height: 32px;
      padding-inline: 16px;
      background-color: var(--md-sys-color-surface-container-highest);
      color: var(--md-sys-color-on-surface-variant);
      font-family: 'Roboto', sans-serif;
      font-size: 0.75rem;
      line-height: 1rem;
      letter-spacing: 0.025em;
      border-top: 1px solid var(--md-sys-color-outline-variant);
    }

    .mode {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      font-weight: 500;
      color: var(--md-sys-color-on-surface);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .mode-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: var(--md-sys-color-primary);
    }

    .hint {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      text-align: end;
    }

    @media (max-width: 639px) {
      .hint {
        display: none;
      }
    }
  `;

  @property() mode: 'Normal' | 'Insert' | 'Standard' = 'Standard';

  render() {
    return html`
      <div class="mode" aria-live="polite">
        <span class="mode-dot" aria-hidden="true"></span>
        ${this.mode}
      </div>
      <div class="hint">Press Ctrl+K for commands</div>
    `;
  }
}

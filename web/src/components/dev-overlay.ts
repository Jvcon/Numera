import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { formatKeyInput, type KeyEventDetail } from '../lib/keyboard';

@customElement('numera-dev-overlay')
export class NumeraDevOverlay extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset-inline-end: var(--md-sys-spacing-block);
      inset-block-end: calc(var(--md-sys-bottom-bar-height) + var(--md-sys-spacing-block));
      z-index: 10;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--md-sys-spacing-inline);
      pointer-events: none;
    }

    .toggle {
      pointer-events: auto;
      background-color: var(--md-sys-color-surface-container-highest);
      color: var(--md-sys-color-on-surface);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: var(--md-sys-shape-chip);
      padding: var(--md-sys-spacing-inline) var(--md-sys-spacing-inline-loose);
      font-family: var(--md-sys-typescale-label-medium-font);
      font-size: var(--md-sys-typescale-label-medium-size);
      line-height: var(--md-sys-typescale-label-medium-line);
      font-weight: var(--md-sys-typescale-label-medium-weight);
      letter-spacing: var(--md-sys-typescale-label-medium-tracking);
      text-transform: uppercase;
      box-shadow: var(--md-sys-elevation-card);
      cursor: pointer;
      transition:
        background-color var(--md-sys-motion-duration-fast)
          var(--md-sys-motion-easing-standard),
        transform var(--md-sys-motion-duration-fast)
          var(--md-sys-motion-easing-standard);
    }

    .toggle:hover {
      background-color: var(--md-sys-color-surface-container-highest);
    }

    .toggle:active {
      transform: scale(0.98);
    }

    .panel {
      pointer-events: auto;
      min-width: 15rem;
      max-width: min(22.5rem, calc(100vw - 32px));
      max-height: 15rem;
      overflow-y: auto;
      background-color: var(--md-sys-color-surface-container-highest);
      color: var(--md-sys-color-on-surface);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: var(--md-sys-shape-card);
      padding: var(--md-sys-spacing-inline-loose);
      font-family: var(--md-sys-typescale-font-mono);
      font-size: var(--md-sys-typescale-label-small-size);
      line-height: var(--md-sys-typescale-label-small-line);
      box-shadow: var(--md-sys-elevation-menu);
      transform-origin: bottom right;
      animation: panel-enter var(--md-sys-motion-duration-emphasized)
        var(--md-sys-motion-easing-emphasized-decelerate);
    }

    @keyframes panel-enter {
      from {
        opacity: 0;
        transform: scale(0.96) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--md-sys-spacing-inline);
      padding-bottom: var(--md-sys-spacing-inline);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--md-sys-typescale-label-medium-font);
      font-size: var(--md-sys-typescale-label-medium-size);
      font-weight: var(--md-sys-typescale-label-medium-weight);
    }

    .event {
      display: flex;
      gap: var(--md-sys-spacing-inline-loose);
      padding: var(--md-sys-density-1) 0;
      opacity: 0.87;
    }

    .event:first-of-type {
      color: var(--md-sys-color-primary);
      opacity: 1;
    }

    .event-time {
      color: var(--md-sys-color-on-surface-variant);
      flex-shrink: 0;
    }

    .empty {
      color: var(--md-sys-color-on-surface-variant);
      font-style: italic;
    }

    @media (max-width: 639px) {
      :host {
        inset-inline-end: var(--md-sys-spacing-inline);
        inset-block-end: calc(var(--md-sys-bottom-bar-height) + var(--md-sys-spacing-inline));
      }
    }
  `;

  @state()
  private open = false;

  @state()
  private events: KeyEventDetail[] = [];

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('numera-keyevent', this.handleKeyEvent as EventListener);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('numera-keyevent', this.handleKeyEvent as EventListener);
  }

  private handleKeyEvent = (event: CustomEvent<KeyEventDetail>) => {
    const detail = event.detail;
    console.log('[numera-keyevent]', detail.input);
    this.events = [detail, ...this.events].slice(0, 24);
  };

  private toggleOpen = () => {
    this.open = !this.open;
  };

  private clearEvents = () => {
    this.events = [];
  };

  render() {
    return html`
      <button class="toggle" @click=${this.toggleOpen}>
        ${this.open ? 'Hide' : 'Show'} key bridge
      </button>

      ${this.open
        ? html`
            <div class="panel" role="log" aria-live="polite" aria-label="Keyboard bridge debug log">
              <div class="panel-header">
                <span>Key bridge log</span>
                <button @click=${this.clearEvents}>Clear</button>
              </div>
              ${this.events.length === 0
                ? html`<div class="empty">No keys captured yet.</div>`
                : this.events.map(
                    (event) => html`
                      <div class="event">
                        <span class="event-time">
                          ${new Date(event.timestamp).toLocaleTimeString(undefined, {
                            hour12: false,
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                            fractionalSecondDigits: 3,
                          })}
                        </span>
                        <span>${formatKeyInput(event.input)}</span>
                      </div>
                    `,
                  )}
            </div>
          `
        : null}
    `;
  }
}

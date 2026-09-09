import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

/**
 * Transient snackbar for lightweight feedback (file created, saved,
 * errors). Managed imperatively via `show(message, options)`.
 *
 * Usage (from a parent):
 *   const snackbar = this.renderRoot.querySelector('numera-snackbar');
 *   snackbar.show('File created');
 */

interface SnackbarOptions {
  /** Auto-dismiss delay in ms (default 3000). */
  duration?: number;
  /** Optional action label. Fires `snackbar-action` when clicked. */
  action?: string;
}

@customElement('numera-snackbar')
export class NumeraSnackbar extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset-inline-start: 50%;
      inset-block-end: calc(var(--md-sys-bottom-bar-height) + var(--md-sys-spacing-block));
      z-index: 30;
      transform: translateX(-50%) translateY(8px);
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-block);
      max-width: min(36rem, calc(100vw - 32px));
      padding: var(--md-sys-spacing-inline-loose) var(--md-sys-spacing-block);
      background-color: var(--md-sys-color-inverse-surface);
      color: var(--md-sys-color-inverse-on-surface);
      border-radius: var(--md-sys-shape-snackbar);
      box-shadow: var(--md-sys-elevation-snackbar);
      opacity: 0;
      pointer-events: none;
      transition:
        opacity var(--md-sys-motion-duration-medium)
          var(--md-sys-motion-easing-emphasized),
        transform var(--md-sys-motion-duration-medium)
          var(--md-sys-motion-easing-emphasized);
    }

    :host([open]) {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(-50%) translateY(0);
    }

    .message {
      font-family: var(--md-sys-typescale-body-medium-font);
      font-size: var(--md-sys-typescale-body-medium-size);
      line-height: var(--md-sys-typescale-body-medium-line);
      font-weight: var(--md-sys-typescale-body-medium-weight);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .action {
      flex-shrink: 0;
      border: none;
      background: transparent;
      color: var(--md-sys-color-inverse-primary);
      cursor: pointer;
      font-family: var(--md-sys-typescale-label-large-font);
      font-size: var(--md-sys-typescale-label-large-size);
      line-height: var(--md-sys-typescale-label-large-line);
      font-weight: var(--md-sys-typescale-label-large-weight);
      letter-spacing: var(--md-sys-typescale-label-large-tracking);
      padding: 0;
    }

    @media (prefers-reduced-motion: reduce) {
      :host {
        transition: none;
      }
    }
  `;

  @property({ type: Boolean, reflect: true, attribute: 'open' })
  private open = false;

  @state()
  private message = '';

  @state()
  private actionLabel: string | null = null;

  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    // Coordinate with the editor's error tooltip: when a tooltip opens,
    // it dispatches `numera-dismiss-snackbar` so this toast dismisses
    // and the two overlays never coexist.
    window.addEventListener('numera-dismiss-snackbar', this.handleDismissRequest);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('numera-dismiss-snackbar', this.handleDismissRequest);
  }

  private handleDismissRequest = (): void => {
    this.dismiss();
  };

  show(message: string, options: SnackbarOptions = {}): void {
    const duration = options.duration ?? 3000;
    // Coordinate with the error tooltip: showing the toast dismisses any
    // open tooltip so the two overlays never coexist.
    window.dispatchEvent(new CustomEvent('numera-dismiss-tooltip'));

    this.message = message;
    this.actionLabel = options.action ?? null;
    this.open = true;

    if (this.dismissTimer) clearTimeout(this.dismissTimer);
    this.dismissTimer = setTimeout(() => {
      this.dismiss();
    }, duration);
  }

  dismiss(): void {
    this.open = false;
    if (this.dismissTimer) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }

  private handleAction(): void {
    this.dispatchEvent(
      new CustomEvent('snackbar-action', { bubbles: true, composed: true }),
    );
    this.dismiss();
  }

  render() {
    return html`
      <span
        class="message"
        role="status"
        aria-live="polite"
        aria-hidden=${!this.open}
      >${this.message}</span>
      ${this.actionLabel
        ? html`<button class="action" @click=${this.handleAction}>${this.actionLabel}</button>`
        : null}
    `;
  }
}

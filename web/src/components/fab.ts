import { LitElement, html, css, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';

/**
 * Speed-dial FAB — a Material 3 Floating Action Button pinned to the
 * bottom-end of the viewport, floating above the status bar. Tapping it
 * expands a small menu of three actions over a scrim; tapping the scrim
 * or pressing Escape dismisses it.
 *
 * Events (bubbling + composed, no detail):
 *   - `fab-new-file`
 *   - `fab-new-draft`
 *   - `fab-search`
 */

const ICONS = {
  plus: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>`,
  bolt: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M11 21h-1l1-7H7.5c-.88 0-.33-.75-.31-.78C8.48 10.94 10.42 7.54 13.01 3h1l-1 7h3.51c.4 0 .62.19.4.66C12.97 17.55 11 21 11 21z"/></svg>`,
  search: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
};

@customElement('numera-fab')
export class NumeraFab extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      bottom: calc(var(--md-sys-bottom-bar-height) + var(--md-sys-spacing-block-loose));
      inset-inline-end: var(--md-sys-spacing-block-loose);
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--md-sys-spacing-block-tight);
      z-index: 4;
    }

    .scrim {
      position: fixed;
      inset: 0;
      z-index: -1;
      background-color: var(--md-sys-color-scrim);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--md-sys-motion-duration-medium)
        var(--md-sys-motion-easing-emphasized);
    }

    :host([open]) .scrim {
      opacity: 0.32;
      pointer-events: auto;
    }

    .actions {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: var(--md-sys-spacing-block-tight);
    }

    .action {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline);
      opacity: 0;
      transform: translateY(var(--md-sys-spacing-inline-loose));
      pointer-events: none;
      transition:
        opacity var(--md-sys-motion-duration-medium)
          var(--md-sys-motion-easing-emphasized-decelerate),
        transform var(--md-sys-motion-duration-medium)
          var(--md-sys-motion-easing-emphasized-decelerate);
    }

    :host([open]) .action {
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    :host([open]) .action:nth-child(1) {
      transition-delay: 0.08s;
    }

    :host([open]) .action:nth-child(2) {
      transition-delay: 0.04s;
    }

    :host([open]) .action:nth-child(3) {
      transition-delay: 0s;
    }

    .action-label {
      padding: var(--md-sys-spacing-inline-tight) var(--md-sys-spacing-inline-loose);
      border-radius: var(--md-sys-shape-corner-full);
      background-color: var(--md-sys-color-surface-container-highest);
      color: var(--md-sys-color-on-surface);
      box-shadow: var(--md-sys-elevation-level1);
      font-family: var(--md-sys-typescale-label-large-font);
      font-size: var(--md-sys-typescale-label-large-size);
      line-height: var(--md-sys-typescale-label-large-line);
      font-weight: var(--md-sys-typescale-label-large-weight);
      letter-spacing: var(--md-sys-typescale-label-large-tracking);
      white-space: nowrap;
    }

    .action-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--md-sys-touch-target-min);
      height: var(--md-sys-touch-target-min);
      border: none;
      border-radius: var(--md-sys-shape-corner-full);
      background-color: var(--md-sys-color-secondary-container);
      color: var(--md-sys-color-on-secondary-container);
      cursor: pointer;
      box-shadow: var(--md-sys-elevation-level2);
      transition: background-color var(--md-sys-motion-duration-fast)
        var(--md-sys-motion-easing-standard);
    }

    .action-button:hover {
      background-color: color-mix(
        in srgb,
        var(--md-sys-color-on-secondary-container)
          calc(var(--md-sys-state-hover-state-layer-opacity) * 100%),
        var(--md-sys-color-secondary-container)
      );
    }

    .fab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--md-sys-touch-target-large);
      height: var(--md-sys-touch-target-large);
      border: none;
      border-radius: var(--md-sys-shape-corner-extra-large);
      background-color: var(--md-sys-color-primary-container);
      color: var(--md-sys-color-on-primary-container);
      cursor: pointer;
      box-shadow: var(--md-sys-elevation-level3);
      transition:
        box-shadow var(--md-sys-motion-duration-medium)
          var(--md-sys-motion-easing-emphasized),
        background-color var(--md-sys-motion-duration-fast)
          var(--md-sys-motion-easing-standard);
    }

    .fab:hover {
      box-shadow: var(--md-sys-elevation-fab-hover);
      background-color: color-mix(
        in srgb,
        var(--md-sys-color-on-primary-container)
          calc(var(--md-sys-state-hover-state-layer-opacity) * 100%),
        var(--md-sys-color-primary-container)
      );
    }

    .fab:active {
      box-shadow: var(--md-sys-elevation-fab-pressed);
    }

    .fab-icon {
      display: inline-flex;
      transition: transform var(--md-sys-motion-duration-medium)
        var(--md-sys-motion-easing-emphasized);
    }

    :host([open]) .fab-icon {
      transform: rotate(45deg);
    }

    .fab:focus-visible,
    .action-button:focus-visible {
      outline: 2px solid var(--md-sys-color-primary);
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      .scrim,
      .action,
      .fab,
      .fab-icon {
        transition: none;
      }

      :host([open]) .action {
        transition-delay: 0s;
      }
    }
  `;

  @property({ type: Boolean, reflect: true }) open = false;

  private handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.open) {
      this.open = false;
    }
  };

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.handleKeydown);
  }

  private toggle() {
    this.open = !this.open;
  }

  private close() {
    this.open = false;
  }

  private dispatchAction(name: string) {
    this.dispatchEvent(
      new CustomEvent(name, { bubbles: true, composed: true }),
    );
    this.open = false;
  }

  private renderAction(label: string, eventName: string, icon: TemplateResult) {
    return html`
      <div class="action">
        <span class="action-label" aria-hidden="true">${label}</span>
        <button
          class="action-button"
          type="button"
          aria-label=${label}
          @click=${() => this.dispatchAction(eventName)}
        >
          ${icon}
        </button>
      </div>
    `;
  }

  render() {
    return html`
      <div class="scrim" aria-hidden="true" @click=${this.close}></div>

      <div class="actions" id="fab-menu" ?inert=${!this.open}>
        ${this.renderAction('New file', 'fab-new-file', ICONS.plus)}
        ${this.renderAction('New draft', 'fab-new-draft', ICONS.bolt)}
        ${this.renderAction('Search', 'fab-search', ICONS.search)}
      </div>

      <button
        class="fab"
        type="button"
        aria-label=${this.open ? 'Close menu' : 'Open menu'}
        aria-haspopup="true"
        aria-expanded=${this.open}
        aria-controls="fab-menu"
        @click=${this.toggle}
      >
        <span class="fab-icon">${ICONS.plus}</span>
      </button>
    `;
  }
}

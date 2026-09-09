import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

const ICONS = {
  menu: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`,
  functions: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M18 4H6v2l6.5 6L6 18v2h12v-3h-7l5-5-5-5h7V4z"/></svg>`,
  close: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
};

@customElement('numera-top-bar')
export class NumeraTopBar extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
      height: var(--md-sys-app-bar-height);
      padding-inline: var(--md-sys-spacing-inline-tight) var(--md-sys-spacing-inline);
      background-color: var(--md-sys-color-surface-container-low);
      color: var(--md-sys-color-on-surface);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
    }

    .menu-button {
      display: none;
    }

    .title {
      flex: 1;
      padding-inline-start: var(--md-sys-spacing-inline-loose);
      font-family: var(--md-sys-typescale-title-large-font);
      font-size: var(--md-sys-typescale-title-large-size);
      line-height: var(--md-sys-typescale-title-large-line);
      font-weight: var(--md-sys-typescale-title-large-weight);
      letter-spacing: var(--md-sys-typescale-title-large-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .actions {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
    }

    md-icon-button {
      color: var(--md-sys-color-on-surface-variant);
      transition: color var(--md-sys-motion-duration-fast)
        var(--md-sys-motion-easing-standard);
    }

    md-icon-button:hover {
      color: var(--md-sys-color-on-surface);
    }

    @media (max-width: 1023px) {
      .menu-button {
        display: inline-flex;
      }
    }

    @media (min-width: 1024px) {
      :host([sidebar-collapsed]) .menu-button {
        display: inline-flex;
      }
    }
  `;

  @property({ type: Boolean }) sidebarOpen = false;

  @property({ type: Boolean, reflect: true, attribute: 'sidebar-collapsed' })
  sidebarCollapsed = false;

  @property() fileName = 'Numera';

  @property({ type: Boolean, reflect: true }) editingGlobals = false;

  private dispatchMenuToggle() {
    this.dispatchEvent(
      new CustomEvent('menu-toggle', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchGlobalOpen() {
    this.dispatchEvent(
      new CustomEvent('global-open', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchGlobalsClose() {
    this.dispatchEvent(
      new CustomEvent('globals-close', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <md-icon-button
        class="menu-button"
        aria-label=${this.sidebarOpen ? 'Close sidebar' : 'Open sidebar'}
        @click=${this.dispatchMenuToggle}
      >
        <md-icon>${ICONS.menu}</md-icon>
      </md-icon-button>

      ${this.editingGlobals
        ? html`
            <md-icon-button
              class="exit-button"
              aria-label="Exit globals"
              title="Exit globals"
              @click=${this.dispatchGlobalsClose}
            >
              <md-icon>${ICONS.close}</md-icon>
            </md-icon-button>
          `
        : nothing}

      <div class="title" role="banner">
        ${this.editingGlobals ? 'Globals' : this.fileName}
      </div>

      <div class="actions">
        <md-icon-button
          aria-label="Global variables"
          title="Global variables"
          @click=${this.dispatchGlobalOpen}
        >
          <md-icon>${ICONS.functions}</md-icon>
        </md-icon-button>
      </div>
    `;
  }
}

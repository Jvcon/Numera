import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { ThemeSetting } from '../lib/theme';

const ICONS = {
  menu: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/></svg>`,
  search: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>`,
  settings: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84a.484.484 0 0 0-.48.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.488.488 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.27.41.48.41h3.84c.24 0 .44-.17.48-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>`,
  theme: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.04-.92-.1-1.36a5.389 5.389 0 0 1-4.4 2.26 5.403 5.403 0 0 1-3.14-9.8c-.44-.06-.9-.1-1.36-.1z"/></svg>`,
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

  @property() theme: ThemeSetting = 'auto';

  @property() fileName = 'Numera';

  private dispatchMenuToggle() {
    this.dispatchEvent(
      new CustomEvent('menu-toggle', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchThemeToggle() {
    this.dispatchEvent(
      new CustomEvent('theme-toggle', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchCommandPalette() {
    this.dispatchEvent(
      new CustomEvent('command-palette', {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private dispatchSettings() {
    this.dispatchEvent(
      new CustomEvent('settings-open', {
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

      <div class="title" role="banner">${this.fileName}</div>

      <div class="actions">
        <md-icon-button aria-label="Search or command palette" @click=${this.dispatchCommandPalette}>
          <md-icon>${ICONS.search}</md-icon>
        </md-icon-button>

        <md-icon-button aria-label="Settings" @click=${this.dispatchSettings}>
          <md-icon>${ICONS.settings}</md-icon>
        </md-icon-button>

        <md-icon-button
          aria-label="Toggle theme"
          title="Theme: ${this.theme}"
          @click=${this.dispatchThemeToggle}
        >
          <md-icon>${ICONS.theme}</md-icon>
        </md-icon-button>
      </div>
    `;
  }
}

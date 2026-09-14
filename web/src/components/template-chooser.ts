import { LitElement, html, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { Template } from '../lib/templates';

/**
 * Template chooser — a modal listing the built-in scenario templates.
 * Opened from the top bar, the FAB speed-dial, or the command palette;
 * picking a template emits `template-select` so the shell can instantiate
 * it via the workspace store.
 *
 * Events (bubbling + composed):
 *   - `template-select`  detail `{ id }`
 *   - `template-close`
 */

const ICONS = {
  template: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z"/></svg>`,
  close: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
};

@customElement('numera-template-chooser')
export class NumeraTemplateChooser extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--md-sys-spacing-block-loose);
      background-color: var(--md-sys-color-scrim);
      opacity: 0;
      pointer-events: none;
      transition: opacity var(--md-sys-motion-duration-medium)
        var(--md-sys-motion-easing-emphasized);
    }

    :host([open]) .backdrop {
      opacity: 0.32;
      pointer-events: auto;
    }

    .panel {
      width: min(24rem, calc(100vw - 32px));
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      background-color: var(--md-sys-color-surface-container-high);
      color: var(--md-sys-color-on-surface);
      border-radius: var(--md-sys-shape-dialog);
      box-shadow: var(--md-sys-elevation-dialog);
      overflow: hidden;
      transform: translateY(-8px) scale(0.98);
      transition: transform var(--md-sys-motion-duration-emphasized)
        var(--md-sys-motion-easing-emphasized-decelerate);
    }

    :host([open]) .panel {
      transform: translateY(0) scale(1);
    }

    .header {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-loose);
      padding: var(--md-sys-spacing-block) var(--md-sys-spacing-block-loose);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
    }

    .title {
      flex: 1;
      font-family: var(--md-sys-typescale-title-small-font);
      font-size: var(--md-sys-typescale-title-small-size);
      line-height: var(--md-sys-typescale-title-small-line);
      font-weight: var(--md-sys-typescale-title-small-weight);
      letter-spacing: var(--md-sys-typescale-title-small-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .close-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--md-sys-touch-target-min);
      height: var(--md-sys-touch-target-min);
      border: none;
      border-radius: var(--md-sys-shape-icon-button);
      background: transparent;
      color: var(--md-sys-color-on-surface-variant);
      cursor: pointer;
      transition: background-color var(--md-sys-motion-duration-fast)
        var(--md-sys-motion-easing-standard);
    }

    .close-button:hover {
      background-color: color-mix(
        in srgb,
        var(--md-sys-color-on-surface)
          calc(var(--md-sys-state-hover-state-layer-opacity) * 100%),
        transparent
      );
    }

    .close-button:focus-visible {
      outline: 2px solid var(--md-sys-color-primary);
      outline-offset: 2px;
    }

    .list {
      overflow-y: auto;
      padding: var(--md-sys-spacing-inline-tight);
    }

    .item {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-loose);
      width: 100%;
      padding: var(--md-sys-spacing-inline) var(--md-sys-spacing-inline-loose);
      border: none;
      border-radius: var(--md-sys-shape-corner-small);
      background: transparent;
      color: var(--md-sys-color-on-surface);
      cursor: pointer;
      text-align: start;
      transition: background-color var(--md-sys-motion-duration-fast)
        var(--md-sys-motion-easing-standard);
    }

    .item:hover {
      background-color: color-mix(
        in srgb,
        var(--md-sys-color-on-surface)
          calc(var(--md-sys-state-hover-state-layer-opacity) * 100%),
        transparent
      );
    }

    .item:focus-visible {
      outline: 2px solid var(--md-sys-color-primary);
      outline-offset: 2px;
    }

    .item-icon {
      display: inline-flex;
      flex-shrink: 0;
      color: var(--md-sys-color-on-surface-variant);
    }

    .item-body {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .item-label {
      font-family: var(--md-sys-typescale-title-small-font);
      font-size: var(--md-sys-typescale-title-small-size);
      line-height: var(--md-sys-typescale-title-small-line);
      font-weight: var(--md-sys-typescale-title-small-weight);
      letter-spacing: var(--md-sys-typescale-title-small-tracking);
    }

    .item-detail {
      font-family: var(--md-sys-typescale-body-medium-font);
      font-size: var(--md-sys-typescale-body-medium-size);
      line-height: var(--md-sys-typescale-body-medium-line);
      font-weight: var(--md-sys-typescale-body-medium-weight);
      letter-spacing: var(--md-sys-typescale-body-medium-tracking);
      color: var(--md-sys-color-on-surface-variant);
    }

    .empty {
      padding: var(--md-sys-spacing-block-loose);
      text-align: center;
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--md-sys-typescale-body-small-font);
      font-size: var(--md-sys-typescale-body-small-size);
      line-height: var(--md-sys-typescale-body-small-line);
      font-weight: var(--md-sys-typescale-body-small-weight);
      letter-spacing: var(--md-sys-typescale-body-small-tracking);
    }

    @media (prefers-reduced-motion: reduce) {
      .backdrop,
      .panel {
        transition: none;
      }
    }
  `;

  @property({ type: Boolean, reflect: true }) open = false;

  @property({ attribute: false }) templates: Template[] = [];

  private handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.open) {
      event.preventDefault();
      this.close();
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

  updated(changed: Map<string, unknown>): void {
    if (changed.has('open') && this.open) {
      // Move focus into the dialog once it has rendered: the first
      // template item, or the close button when the list is empty.
      requestAnimationFrame(() => {
        const target = this.renderRoot.querySelector<HTMLElement>(
          '.item, .close-button',
        );
        target?.focus();
      });
    }
  }

  private close(): void {
    this.dispatchEvent(
      new CustomEvent('template-close', { bubbles: true, composed: true }),
    );
  }

  private select(id: string): void {
    this.dispatchEvent(
      new CustomEvent('template-select', {
        detail: { id },
        bubbles: true,
        composed: true,
      }),
    );
    this.close();
  }

  private handleBackdropClick(event: MouseEvent): void {
    if ((event.target as HTMLElement).classList.contains('backdrop')) {
      this.close();
    }
  }

  render() {
    if (!this.open) return nothing;

    return html`
      <div class="backdrop" @mousedown=${this.handleBackdropClick}>
        <div
          class="panel"
          role="dialog"
          aria-modal="true"
          aria-label="从模板新建"
        >
          <div class="header">
            <span class="title">从模板新建</span>
            <button
              class="close-button"
              type="button"
              aria-label="关闭"
              @click=${this.close}
            >
              ${ICONS.close}
            </button>
          </div>
          <div class="list">
            ${this.templates.length === 0
              ? html`<div class="empty">暂无可用模板</div>`
              : this.templates.map(
                  (t) => html`
                    <button
                      class="item"
                      type="button"
                      @click=${() => this.select(t.id)}
                    >
                      <span class="item-icon">${ICONS.template}</span>
                      <span class="item-body">
                        <span class="item-label">${t.name}</span>
                        <span class="item-detail">${t.description}</span>
                      </span>
                    </button>
                  `,
                )}
          </div>
        </div>
      </div>
    `;
  }
}

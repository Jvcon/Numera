import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';
import { initTheme } from './lib/theme';
import { initKeyboardBridge } from './lib/keyboard';
import './components/app-shell';
import './components/dev-overlay';

@customElement('numera-app')
export class NumeraApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
    }
  `;

  private keyboardCleanup?: () => void;

  connectedCallback(): void {
    super.connectedCallback();
    initTheme();
    this.keyboardCleanup = initKeyboardBridge(window, (detail) => {
      window.dispatchEvent(
        new CustomEvent('numera-keyevent', {
          detail,
          bubbles: true,
          composed: true,
        }),
      );
    });
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.keyboardCleanup?.();
  }

  render() {
    return html`
      <numera-app-shell></numera-app-shell>
      <numera-dev-overlay></numera-dev-overlay>
    `;
  }
}

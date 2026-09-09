import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { generateMnemonic, applyMnemonic } from '../lib/encryption';
import type { MdCheckbox } from '@material/web/checkbox/checkbox.js';
import type { MdFilledTextField } from '@material/web/textfield/filled-text-field.js';

/**
 * Self-contained end-to-end encryption wizard, shown as a modal dialog.
 *
 * Two modes:
 *   - `setup`: explain → generate → show mnemonic → confirm → done
 *   - `restore`: paste mnemonic → done
 *
 * The mnemonic only lives in component state during the flow — it is never
 * logged or persisted by this component.
 *
 * Events:
 *   - `encryption-setup-close` (bubbles, composed) — fired when the dialog is
 *     dismissed (scrim, Escape, close button) or completed (Done).
 */
type SetupStep = 'explain' | 'generating' | 'show' | 'confirm';

/** 1-indexed word positions the user must re-enter to prove they saved it. */
const CONFIRM_WORDS = [3, 7, 11] as const;

const ICONS = {
  close: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`,
  copy: html`<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>`,
  check: html`<svg viewBox="0 0 24 24" width="32" height="32" fill="currentColor"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>`,
};

@customElement('numera-encryption-setup')
export class NumeraEncryptionSetup extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--md-sys-spacing-block);
      background-color: var(--md-sys-color-scrim);
      animation: backdrop-in var(--md-sys-motion-duration-medium)
        var(--md-sys-motion-easing-emphasized) both;
    }

    .panel {
      width: min(34rem, 100%);
      max-height: calc(100vh - 2 * var(--md-sys-spacing-block));
      display: flex;
      flex-direction: column;
      background-color: var(--md-sys-color-surface-container-high);
      color: var(--md-sys-color-on-surface);
      border-radius: var(--md-sys-shape-dialog);
      box-shadow: var(--md-sys-elevation-dialog);
      overflow: hidden;
      animation: panel-in var(--md-sys-motion-duration-emphasized)
        var(--md-sys-motion-easing-emphasized-decelerate) both;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--md-sys-spacing-inline-loose);
      padding: var(--md-sys-spacing-block) var(--md-sys-spacing-block)
        var(--md-sys-spacing-inline) var(--md-sys-spacing-block-loose);
      flex-shrink: 0;
    }

    .panel-title {
      margin: 0;
      font-family: var(--md-sys-typescale-title-large-font);
      font-size: var(--md-sys-typescale-title-large-size);
      line-height: var(--md-sys-typescale-title-large-line);
      font-weight: var(--md-sys-typescale-title-large-weight);
      letter-spacing: var(--md-sys-typescale-title-large-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .panel-body {
      padding: var(--md-sys-spacing-inline) var(--md-sys-spacing-block-loose);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: var(--md-sys-spacing-block);
    }

    .panel-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: var(--md-sys-spacing-inline);
      padding: var(--md-sys-spacing-block) var(--md-sys-spacing-block-loose);
      flex-shrink: 0;
    }

    .body {
      margin: 0;
      font-family: var(--md-sys-typescale-body-medium-font);
      font-size: var(--md-sys-typescale-body-medium-size);
      line-height: var(--md-sys-typescale-body-medium-line);
      font-weight: var(--md-sys-typescale-body-medium-weight);
      letter-spacing: var(--md-sys-typescale-body-medium-tracking);
      color: var(--md-sys-color-on-surface-variant);
    }

    .error-text {
      margin: 0;
      font-family: var(--md-sys-typescale-body-small-font);
      font-size: var(--md-sys-typescale-body-small-size);
      line-height: var(--md-sys-typescale-body-small-line);
      font-weight: var(--md-sys-typescale-body-small-weight);
      letter-spacing: var(--md-sys-typescale-body-small-tracking);
      color: var(--md-sys-color-error);
    }

    .word-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: var(--md-sys-spacing-inline-tight);
    }

    .word {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-inline);
      background-color: var(--md-sys-color-surface-container);
      border-radius: var(--md-sys-shape-corner-small);
    }

    .word-index {
      flex-shrink: 0;
      min-width: 1.25rem;
      text-align: end;
      font-family: var(--md-sys-typescale-font-mono);
      font-size: var(--md-sys-typescale-mono-small-size);
      line-height: var(--md-sys-typescale-mono-small-line);
      color: var(--md-sys-color-on-surface-variant);
    }

    .word-text {
      font-family: var(--md-sys-typescale-font-mono);
      font-size: var(--md-sys-typescale-mono-medium-size);
      line-height: var(--md-sys-typescale-mono-medium-line);
      color: var(--md-sys-color-on-surface);
      overflow-wrap: anywhere;
    }

    .copy-row {
      display: flex;
      justify-content: flex-start;
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline);
      cursor: pointer;
      font-family: var(--md-sys-typescale-body-medium-font);
      font-size: var(--md-sys-typescale-body-medium-size);
      line-height: var(--md-sys-typescale-body-medium-line);
      font-weight: var(--md-sys-typescale-body-medium-weight);
      letter-spacing: var(--md-sys-typescale-body-medium-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .confirm-field,
    .restore-field {
      width: 100%;
    }

    .done {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: var(--md-sys-spacing-block);
      padding-block: var(--md-sys-spacing-block-loose);
    }

    .done-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--md-sys-touch-target-large);
      height: var(--md-sys-touch-target-large);
      border-radius: var(--md-sys-shape-corner-full);
      background-color: var(--md-sys-color-tertiary-container);
      color: var(--md-sys-color-on-tertiary-container);
    }

    @keyframes backdrop-in {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    @keyframes panel-in {
      from {
        opacity: 0;
        transform: translateY(0.5rem) scale(0.98);
      }
      to {
        opacity: 1;
        transform: none;
      }
    }

    @media (max-width: 639px) {
      .word-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .backdrop,
      .panel {
        animation: none;
      }
    }
  `;

  @property({ reflect: true }) mode: 'setup' | 'restore' = 'setup';

  @state()
  private step: SetupStep = 'explain';

  @state()
  private completed = false;

  @state()
  private mnemonic = '';

  @state()
  private words: string[] = [];

  @state()
  private flowError = '';

  @state()
  private savedChecked = false;

  @state()
  private confirm: string[] = ['', '', ''];

  @state()
  private copied = false;

  @state()
  private restoreValue = '';

  @state()
  private restoreError = '';

  @state()
  private restoring = false;

  @state()
  private persisting = false;

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleKeydown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.handleKeydown);
  }

  protected override firstUpdated(): void {
    // Move focus into the dialog so keyboard users aren't left on the
    // button behind the scrim.
    this.renderRoot.querySelector<HTMLElement>('.panel')?.focus();
  }

  private handleKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  };

  private handleBackdrop = (event: MouseEvent) => {
    if ((event.target as HTMLElement).classList.contains('backdrop')) {
      this.close();
    }
  };

  private close = () => {
    this.dispatchEvent(
      new CustomEvent('encryption-setup-close', { bubbles: true, composed: true }),
    );
  };

  private async startSetup() {
    this.step = 'generating';
    this.flowError = '';
    try {
      const mnemonic = await generateMnemonic();
      this.mnemonic = mnemonic;
      this.words = mnemonic.split(/\s+/).filter(Boolean);
      this.savedChecked = false;
      this.confirm = ['', '', ''];
      this.step = 'show';
    } catch (error) {
      this.flowError = error instanceof Error ? error.message : String(error);
      this.step = 'explain';
    }
  }

  /** Persist the keyring only after the user confirmed they saved the phrase. */
  private async finish() {
    this.persisting = true;
    this.flowError = '';
    try {
      await applyMnemonic(this.mnemonic);
      this.completed = true;
    } catch (error) {
      this.flowError = error instanceof Error ? error.message : String(error);
    } finally {
      this.persisting = false;
    }
  }

  private async copyMnemonic() {
    try {
      await navigator.clipboard.writeText(this.mnemonic);
      this.copied = true;
      window.setTimeout(() => {
        this.copied = false;
      }, 2000);
    } catch {
      // Clipboard unavailable (permissions or insecure context) — do nothing.
    }
  }

  private handleSavedChange = (event: Event) => {
    this.savedChecked = (event.currentTarget as MdCheckbox).checked;
  };

  private wordAt(index: number): string {
    return this.words[index - 1] ?? '';
  }

  private confirmCorrect(i: number): boolean {
    const entered = (this.confirm[i] ?? '').trim().toLowerCase();
    const expected = this.wordAt(CONFIRM_WORDS[i]).toLowerCase();
    return expected !== '' && entered === expected;
  }

  private get confirmComplete(): boolean {
    return CONFIRM_WORDS.every((_, i) => this.confirmCorrect(i));
  }

  private handleConfirmInput = (event: Event, i: number) => {
    const value = (event.currentTarget as MdFilledTextField).value;
    const next = [...this.confirm];
    next[i] = value;
    this.confirm = next;
  };

  private handleRestoreInput = (event: Event) => {
    this.restoreValue = (event.currentTarget as MdFilledTextField).value;
    this.restoreError = '';
  };

  private async doRestore() {
    const mnemonic = this.restoreValue.trim();
    if (mnemonic === '') return;
    this.restoring = true;
    this.restoreError = '';
    try {
      await applyMnemonic(mnemonic);
      this.completed = true;
    } catch (error) {
      this.restoreError = error instanceof Error ? error.message : String(error);
    } finally {
      this.restoring = false;
    }
  }

  private get heading(): string {
    if (this.completed) {
      return this.mode === 'setup' ? 'Encryption is set up' : 'Encryption restored';
    }
    if (this.mode === 'restore') {
      return 'Restore from recovery phrase';
    }
    switch (this.step) {
      case 'explain':
      case 'generating':
        return 'End-to-end encryption';
      case 'show':
        return 'Save your recovery phrase';
      case 'confirm':
        return 'Confirm your recovery phrase';
    }
  }

  private renderExplain() {
    return html`
      <p class="body">
        Encryption is optional. When it's on, each file is encrypted on this device
        before it's uploaded, so the server never sees the plaintext.
      </p>
      <p class="body">
        You'll be given a 12-word recovery phrase. Write it down and keep it safe —
        if you lose it, there is no way to recover your encrypted files.
      </p>
      ${this.flowError ? html`<p class="error-text">${this.flowError}</p>` : ''}
    `;
  }

  private renderGenerating() {
    return html`<p class="body">Creating your encryption key…</p>`;
  }

  private renderShow() {
    return html`
      <p class="body">
        Write down these 12 words, in order. This is the only way to restore your
        encrypted files on a new device. It won't be shown again.
      </p>
      <div class="word-grid">
        ${this.words.map(
          (word, i) => html`
            <span class="word">
              <span class="word-index">${i + 1}</span>
              <span class="word-text">${word}</span>
            </span>
          `,
        )}
      </div>
      <div class="copy-row">
        <md-text-button @click=${this.copyMnemonic}>
          <md-icon slot="icon">${ICONS.copy}</md-icon>
          ${this.copied ? 'Copied' : 'Copy'}
        </md-text-button>
      </div>
      <label class="checkbox-row">
        <md-checkbox
          aria-label="I have saved my recovery phrase"
          ?checked=${this.savedChecked}
          @change=${this.handleSavedChange}
        ></md-checkbox>
        <span>I have saved my recovery phrase</span>
      </label>
    `;
  }

  private renderConfirm() {
    return html`
      <p class="body">Enter the requested words to confirm you saved the phrase.</p>
      ${CONFIRM_WORDS.map((wordIndex, i) => {
        const entered = this.confirm[i] ?? '';
        const hasInput = entered.trim() !== '';
        const correct = this.confirmCorrect(i);
        return html`
          <md-filled-text-field
            class="confirm-field"
            label="Word ${wordIndex}"
            .value=${entered}
            ?error=${hasInput && !correct}
            errorText=${hasInput && !correct ? "Doesn't match" : ''}
            @input=${(event: Event) => this.handleConfirmInput(event, i)}
          ></md-filled-text-field>
        `;
      })}
      ${this.flowError ? html`<p class="error-text">${this.flowError}</p>` : ''}
    `;
  }

  private renderRestore() {
    return html`
      <p class="body">
        Paste your 12-word recovery phrase to restore your encryption key on this
        device.
      </p>
      <md-filled-text-field
        class="restore-field"
        type="textarea"
        rows="4"
        label="Recovery phrase"
        .value=${this.restoreValue}
        ?error=${this.restoreError !== ''}
        errorText=${this.restoreError}
        @input=${this.handleRestoreInput}
      ></md-filled-text-field>
    `;
  }

  private renderDone() {
    const body =
      this.mode === 'setup'
        ? 'Your files will be encrypted on this device before they sync. Keep your recovery phrase safe.'
        : 'Your encryption key is restored. Encrypted files can now be opened on this device.';
    return html`
      <div class="done">
        <span class="done-icon">${ICONS.check}</span>
        <p class="body">${body}</p>
      </div>
    `;
  }

  private renderBody() {
    if (this.completed) return this.renderDone();
    if (this.mode === 'restore') return this.renderRestore();
    switch (this.step) {
      case 'explain':
        return this.renderExplain();
      case 'generating':
        return this.renderGenerating();
      case 'show':
        return this.renderShow();
      case 'confirm':
        return this.renderConfirm();
    }
  }

  private renderActions() {
    if (this.completed) {
      return html`<md-filled-button @click=${this.close}>Done</md-filled-button>`;
    }

    if (this.mode === 'restore') {
      return html`
        <md-text-button @click=${this.close}>Cancel</md-text-button>
        <md-filled-button
          ?disabled=${this.restoring || this.restoreValue.trim() === ''}
          @click=${this.doRestore}
        >
          ${this.restoring ? 'Restoring…' : 'Restore'}
        </md-filled-button>
      `;
    }

    switch (this.step) {
      case 'explain':
        return html`
          <md-text-button @click=${this.close}>Cancel</md-text-button>
          <md-filled-button @click=${this.startSetup}>Continue</md-filled-button>
        `;
      case 'generating':
        return html`<md-text-button @click=${this.close}>Cancel</md-text-button>`;
      case 'show':
        return html`
          <md-text-button @click=${() => (this.step = 'explain')}>Back</md-text-button>
          <md-filled-button ?disabled=${!this.savedChecked} @click=${() => (this.step = 'confirm')}>
            Continue
          </md-filled-button>
        `;
      case 'confirm':
        return html`
          <md-text-button @click=${() => (this.step = 'show')}>Back</md-text-button>
          <md-filled-button ?disabled=${!this.confirmComplete || this.persisting} @click=${this.finish}>
            ${this.persisting ? 'Finishing…' : 'Finish'}
          </md-filled-button>
        `;
    }
  }

  render() {
    return html`
      <div class="backdrop" @mousedown=${this.handleBackdrop}>
        <div class="panel" role="dialog" aria-modal="true" aria-label=${this.heading} tabindex="-1">
          <header class="panel-header">
            <h2 class="panel-title">${this.heading}</h2>
            <md-icon-button aria-label="Close" @click=${this.close}>
              <md-icon>${ICONS.close}</md-icon>
            </md-icon-button>
          </header>
          <div class="panel-body">${this.renderBody()}</div>
          <footer class="panel-actions">${this.renderActions()}</footer>
        </div>
      </div>
    `;
  }
}

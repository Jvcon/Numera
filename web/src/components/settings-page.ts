import { LitElement, html, css, nothing, type TemplateResult } from 'lit';
import { customElement, state, property } from 'lit/decorators.js';
import {
  loadSettings,
  saveSettings,
  subscribeSettings,
  type NumeraSettings,
  type Region,
} from '../lib/settings';
import type { MdSwitch } from '@material/web/switch/switch.js';
import type { MdSlider } from '@material/web/slider/slider.js';
import type { MdFilledSelect } from '@material/web/select/filled-select.js';
import type { MdFilledTextField } from '@material/web/textfield/filled-text-field.js';
import { isEncryptionConfigured, resetEncryption } from '../lib/encryption';
import { WebDavClient } from '../lib/webdav';
import { runSync, type SyncResult } from '../lib/sync';
import './encryption-setup';

const APP_VERSION = '0.1.0';

/** Two-level navigation: master list → detail sub-page. */
type SettingsPage = 'home' | 'calculator' | 'data' | 'help' | 'about';

const ICONS = {
  back: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>`,
  chevronRight: html`<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>`,
  calculate: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19,3H5C3.9,3,3,3.9,3,5v14c0,1.1,0.9,2,2,2h14c1.1,0,2-0.9,2-2V5C21,3.9,20.1,3,19,3z M13.03,7.06L14.09,6l1.41,1.41L16.91,6l1.06,1.06l-1.41,1.41l1.41,1.41l-1.06,1.06L15.5,9.54l-1.41,1.41l-1.06-1.06l1.41-1.41L13.03,7.06z M6.25,7.72h5v1.5h-5V7.72z M11.5,16h-2v2H8v-2H6v-1.5h2v-2h1.5v2h2V16z M18,17.25h-5v-1.5h5V17.25z M18,14.75h-5v-1.5h5V14.75z"/></svg>`,
  data_usage: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M13 2.05v3.03c3.39.49 6 3.39 6 6.92 0 .9-.18 1.75-.48 2.54l2.6 1.53c.56-1.24.88-2.62.88-4.07 0-5.18-3.95-9.45-9-9.95zM12 19c-3.87 0-7-3.13-7-7 0-3.53 2.61-6.43 6-6.92V2.05c-5.06.5-9 4.76-9 9.95 0 5.52 4.47 10 9.99 10 3.31 0 6.24-1.61 8.06-4.09l-2.6-1.53C16.17 17.98 14.21 19 12 19z"/></svg>`,
  help: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/></svg>`,
  info: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`,
  tune: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>`,
  straighten: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h2v4h2V8h2v4h2V8h2v4h2V8h2v4h2V8h2v8z"/></svg>`,
  public: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>`,
  space_bar: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M18 9v4H6V9H4v6h16V9z"/></svg>`,
  format_size: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M9 4v3h5v12h3V7h5V4H9zm-6 8h3v7h3v-7h3V9H3v3z"/></svg>`,
  format_list_numbered: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z"/></svg>`,
  storage: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z"/></svg>`,
  feedback: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-7 12h-2v-2h2v2zm0-4h-2V6h2v4z"/></svg>`,
  privacy_tip: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12,1L3,5v6c0,5.55,3.84,10.74,9,12c5.16-1.26,9-6.45,9-12V5L12,1L12,1z M11,7h2v2h-2V7z M11,11h2v6h-2V11z"/></svg>`,
  attribution: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12,8.5c-0.91,0-2.75,0.46-2.75,1.38v4.62h1.5V19h2.5v-4.5h1.5V9.88C14.75,8.97,12.91,8.5,12,8.5z"/><path d="M12,2C6.47,2,2,6.47,2,12s4.47,10,10,10s10-4.48,10-10S17.52,2,12,2z M12,20c-4.42,0-8-3.58-8-8s3.58-8,8-8s8,3.58,8,8S16.42,20,12,20z"/><circle cx="12" cy="6.5" r="1.5"/></svg>`,
  code: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`,
  lock: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>`,
  cloud: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/></svg>`,
  checkCircle: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>`,
  warning: html`<svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>`,
};

/**
 * Full-page settings screen. Rendered in place of the workspace grid when the
 * user opens Settings from the sidebar gear. Every control writes back to the
 * settings store immediately — there is no save button.
 *
 * The screen is organised as a two-level navigation: a master list of four
 * rows (Calculator, Data & Sync, Help & Feedback, About) that each open a
 * detail sub-page. The back button closes the screen on the master list and
 * steps back to the master list from any sub-page.
 *
 * Events:
 *   - `settings-close` (bubbles, composed) — fired from the back button on the
 *     master list.
 */
@customElement('numera-settings-page')
export class NumeraSettingsPage extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: var(--md-sys-color-surface);
      color: var(--md-sys-color-on-surface);
    }

    .header {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-tight);
      flex-shrink: 0;
      height: var(--md-sys-app-bar-height);
      padding-inline: var(--md-sys-spacing-inline-tight) var(--md-sys-spacing-inline);
      background-color: var(--md-sys-color-surface-container-low);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
    }

    .back-button {
      color: var(--md-sys-color-on-surface-variant);
    }

    .title {
      font-family: var(--md-sys-typescale-title-large-font);
      font-size: var(--md-sys-typescale-title-large-size);
      line-height: var(--md-sys-typescale-title-large-line);
      font-weight: var(--md-sys-typescale-title-large-weight);
      letter-spacing: var(--md-sys-typescale-title-large-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .scroll {
      flex: 1;
      overflow-y: auto;
      overscroll-behavior: contain;
    }

    .content {
      max-width: 44rem;
      margin-inline: auto;
      padding-block: var(--md-sys-spacing-section);
      padding-inline: var(--md-sys-spacing-block);
    }

    .section {
      margin-block-end: var(--md-sys-spacing-section);
      animation: section-in var(--md-sys-motion-duration-emphasized)
        var(--md-sys-motion-easing-emphasized-decelerate) both;
    }

    .section:nth-child(1) { animation-delay: 0ms; }
    .section:nth-child(2) { animation-delay: 40ms; }
    .section:nth-child(3) { animation-delay: 80ms; }
    .section:nth-child(4) { animation-delay: 120ms; }

    @keyframes section-in {
      from {
        opacity: 0;
        transform: translateY(0.5rem);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .section-title {
      font-family: var(--md-sys-typescale-title-large-font);
      font-size: var(--md-sys-typescale-title-large-size);
      line-height: var(--md-sys-typescale-title-large-line);
      font-weight: var(--md-sys-typescale-title-large-weight);
      letter-spacing: var(--md-sys-typescale-title-large-tracking);
      color: var(--md-sys-color-on-surface);
      margin-block-end: var(--md-sys-spacing-block);
    }

    .group-title {
      margin-block: var(--md-sys-spacing-block-loose) var(--md-sys-spacing-inline);
      font-family: var(--md-sys-typescale-title-small-font);
      font-size: var(--md-sys-typescale-title-small-size);
      line-height: var(--md-sys-typescale-title-small-line);
      font-weight: var(--md-sys-typescale-title-small-weight);
      letter-spacing: var(--md-sys-typescale-title-small-tracking);
      text-transform: uppercase;
      color: var(--md-sys-color-on-surface-variant);
    }

    .card {
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: var(--md-sys-shape-corner-medium);
      background-color: var(--md-sys-color-surface-container-lowest);
      overflow: hidden;
    }

    /* Hairline dividers between sibling rows inside a card. */
    .card > :not(:first-child) {
      border-top: 1px solid var(--md-sys-color-outline-variant);
    }

    .row {
      display: flex;
      align-items: center;
      gap: var(--md-sys-spacing-inline-loose);
      min-height: 3.5rem;
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-block);
    }

    .row-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--md-sys-spacing-inline-tight);
    }

    .row-title {
      font-family: var(--md-sys-typescale-body-large-font);
      font-size: var(--md-sys-typescale-body-large-size);
      line-height: var(--md-sys-typescale-body-large-line);
      font-weight: var(--md-sys-typescale-body-large-weight);
      letter-spacing: var(--md-sys-typescale-body-large-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .row-hint {
      font-family: var(--md-sys-typescale-body-small-font);
      font-size: var(--md-sys-typescale-body-small-size);
      line-height: var(--md-sys-typescale-body-small-line);
      font-weight: var(--md-sys-typescale-body-small-weight);
      letter-spacing: var(--md-sys-typescale-body-small-tracking);
      color: var(--md-sys-color-on-surface-variant);
    }

    /* Interactive rows: master-list entries (buttons) and About links. */
    button.row,
    a.row {
      width: 100%;
      border: none;
      background: none;
      text-align: start;
      font: inherit;
      color: inherit;
      cursor: pointer;
    }

    a.row {
      text-decoration: none;
    }

    button.row:hover,
    a.row:hover {
      background-color: color-mix(
        in srgb,
        var(--md-sys-color-on-surface)
          calc(var(--md-sys-state-hover-state-layer-opacity) * 100%),
        transparent
      );
    }

    .chevron {
      flex-shrink: 0;
      color: var(--md-sys-color-on-surface-variant);
    }

    .leading-icon {
      flex-shrink: 0;
      color: var(--md-sys-color-on-surface-variant);
    }

    .leading-icon--primary {
      color: var(--md-sys-color-primary);
    }

    .value-badge {
      flex-shrink: 0;
      min-width: 3rem;
      text-align: end;
      font-variant-numeric: tabular-nums;
      font-family: var(--md-sys-typescale-label-large-font);
      font-size: var(--md-sys-typescale-label-large-size);
      line-height: var(--md-sys-typescale-label-large-line);
      font-weight: var(--md-sys-typescale-label-large-weight);
      letter-spacing: var(--md-sys-typescale-label-large-tracking);
      color: var(--md-sys-color-primary);
    }

    .field-row {
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-block)
        var(--md-sys-spacing-block);
    }

    .field-row md-filled-select {
      width: 100%;
    }

    .slider-block {
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-block)
        var(--md-sys-spacing-block);
    }

    .slider-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--md-sys-spacing-inline-loose);
    }

    .slider-block md-slider {
      width: 100%;
      margin-block-start: var(--md-sys-spacing-inline);
    }

    /* About hero: vertically stacked, centered app identity. */
    .about-header {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--md-sys-spacing-block);
      padding-block: var(--md-sys-spacing-block-loose);
      text-align: center;
    }

    .app-icon {
      width: calc(var(--md-sys-app-bar-height) + var(--md-sys-density-8)); /* 96px */
      height: calc(var(--md-sys-app-bar-height) + var(--md-sys-density-8));
      /* The icon SVG already carries its own 40px corner radius on a 192
         viewBox (~20%), so no additional radius is applied here. */
    }

    .about-title {
      font-family: var(--md-sys-typescale-headline-medium-font);
      font-size: var(--md-sys-typescale-headline-medium-size);
      line-height: var(--md-sys-typescale-headline-medium-line);
      font-weight: var(--md-sys-typescale-headline-medium-weight);
      letter-spacing: var(--md-sys-typescale-headline-medium-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .status-badge {
      flex-shrink: 0;
      font-family: var(--md-sys-typescale-label-large-font);
      font-size: var(--md-sys-typescale-label-large-size);
      line-height: var(--md-sys-typescale-label-large-line);
      font-weight: var(--md-sys-typescale-label-large-weight);
      letter-spacing: var(--md-sys-typescale-label-large-tracking);
      color: var(--md-sys-color-on-surface-variant);
    }

    .status-badge--ok {
      color: var(--md-sys-color-tertiary);
    }

    .note {
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-block);
      font-family: var(--md-sys-typescale-body-small-font);
      font-size: var(--md-sys-typescale-body-small-size);
      line-height: var(--md-sys-typescale-body-small-line);
      font-weight: var(--md-sys-typescale-body-small-weight);
      letter-spacing: var(--md-sys-typescale-body-small-tracking);
      color: var(--md-sys-color-on-surface-variant);
    }

    .actions-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--md-sys-spacing-inline);
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-block)
        var(--md-sys-spacing-block);
    }

    .reset-button {
      --md-sys-color-primary: var(--md-sys-color-error);
    }

    .danger-button {
      --md-sys-color-primary: var(--md-sys-color-error);
      --md-sys-color-on-primary: var(--md-sys-color-on-error);
    }

    .confirm-reset {
      display: flex;
      flex-direction: column;
      gap: var(--md-sys-spacing-inline);
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-block)
        var(--md-sys-spacing-block);
    }

    .confirm-reset-text {
      margin: 0;
      font-family: var(--md-sys-typescale-body-medium-font);
      font-size: var(--md-sys-typescale-body-medium-size);
      line-height: var(--md-sys-typescale-body-medium-line);
      font-weight: var(--md-sys-typescale-body-medium-weight);
      letter-spacing: var(--md-sys-typescale-body-medium-tracking);
      color: var(--md-sys-color-error);
    }

    .confirm-reset-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--md-sys-spacing-inline);
    }

    .form-stack {
      display: flex;
      flex-direction: column;
      gap: var(--md-sys-spacing-block);
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-block)
        var(--md-sys-spacing-block);
    }

    .form-stack md-filled-text-field {
      width: 100%;
    }

    .test-row,
    .sync-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: var(--md-sys-spacing-inline);
      padding: var(--md-sys-spacing-block-tight) var(--md-sys-spacing-block)
        var(--md-sys-spacing-block);
    }

    .result {
      display: flex;
      align-items: flex-start;
      gap: var(--md-sys-spacing-inline-tight);
      font-family: var(--md-sys-typescale-body-small-font);
      font-size: var(--md-sys-typescale-body-small-size);
      line-height: var(--md-sys-typescale-body-small-line);
      font-weight: var(--md-sys-typescale-body-small-weight);
      letter-spacing: var(--md-sys-typescale-body-small-tracking);
      color: var(--md-sys-color-on-surface-variant);
    }

    .result md-icon {
      flex-shrink: 0;
      color: inherit;
    }

    .result--ok {
      color: var(--md-sys-color-tertiary);
    }

    .result--error {
      color: var(--md-sys-color-error);
    }

    .result-text {
      display: flex;
      flex-direction: column;
      gap: var(--md-sys-spacing-inline-tight);
    }

    .result-hint {
      color: var(--md-sys-color-on-surface-variant);
    }

    .sync-status {
      display: flex;
      align-items: center;
      min-width: 0;
    }

    .sync-conflict {
      color: var(--md-sys-color-error);
    }

    @media (min-width: 1024px) {
      .content {
        padding-inline: var(--md-sys-spacing-block-loose);
      }
    }
  `;

  @state()
  private settings: NumeraSettings = loadSettings();

  @state()
  private page: SettingsPage = 'home';

  @state()
  private encryptionStatus: 'checking' | 'configured' | 'not-configured' = 'checking';

  @state()
  private wizardOpen = false;

  @state()
  private wizardMode: 'setup' | 'restore' = 'setup';

  @state()
  private testStatus: 'idle' | 'testing' | 'connected' | 'error' = 'idle';

  @state()
  private testError = '';

  @state()
  private testNetworkish = false;

  @state()
  private resetConfirmOpen = false;

  @property({ attribute: false })
  store!: import('../lib/workspace').WorkspaceStore;

  @state()
  private syncPhase: 'idle' | 'syncing' | 'done' | 'error' | 'needs-config' = 'idle';

  @state()
  private syncMessage = '';

  @state()
  private syncResult: SyncResult | null = null;

  @state()
  private syncError: string | null = null;

  private unsubscribe: (() => void) | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    this.unsubscribe = subscribeSettings((s) => {
      this.settings = s;
    });
    void this.refreshEncryptionState();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private updateMath = (patch: Partial<NumeraSettings['calculator']['math']>) => {
    this.settings = {
      ...this.settings,
      calculator: {
        ...this.settings.calculator,
        math: { ...this.settings.calculator.math, ...patch },
      },
    };
  };

  private updateEditor = (patch: Partial<NumeraSettings['calculator']['editor']>) => {
    this.settings = {
      ...this.settings,
      calculator: {
        ...this.settings.calculator,
        editor: { ...this.settings.calculator.editor, ...patch },
      },
    };
  };

  private handleClose = () => {
    this.dispatchEvent(
      new CustomEvent('settings-close', { bubbles: true, composed: true }),
    );
  };

  private handleBack = () => {
    if (this.page === 'home') {
      this.handleClose();
    } else {
      this.page = 'home';
    }
  };

  private async refreshEncryptionState() {
    this.encryptionStatus = 'checking';
    try {
      this.encryptionStatus = (await isEncryptionConfigured())
        ? 'configured'
        : 'not-configured';
    } catch {
      this.encryptionStatus = 'not-configured';
    }
  }

  private openWizard = (mode: 'setup' | 'restore') => {
    this.wizardMode = mode;
    this.wizardOpen = true;
  };

  private handleWizardClose = () => {
    this.wizardOpen = false;
    void this.refreshEncryptionState();
  };

  private async handleResetEncryption() {
    try {
      await resetEncryption();
    } finally {
      this.resetConfirmOpen = false;
      await this.refreshEncryptionState();
    }
  }

  private updateWebdav = (patch: Partial<NumeraSettings['sync']['webdav']>) => {
    this.settings = {
      ...this.settings,
      sync: {
        ...this.settings.sync,
        webdav: { ...this.settings.sync.webdav, ...patch },
      },
    };
    saveSettings(this.settings);
    // Editing the config invalidates any previous sync outcome.
    this.syncResult = null;
    this.syncError = null;
    this.syncMessage = '';
    if (this.syncPhase !== 'syncing') {
      this.syncPhase = 'idle';
    }
  };

  private handleWebdavUrl = (event: Event) => {
    this.updateWebdav({ url: (event.currentTarget as MdFilledTextField).value });
  };

  private handleWebdavFolder = (event: Event) => {
    this.updateWebdav({ folder: (event.currentTarget as MdFilledTextField).value });
  };

  private handleWebdavUsername = (event: Event) => {
    this.updateWebdav({ username: (event.currentTarget as MdFilledTextField).value });
  };

  private handleWebdavPassword = (event: Event) => {
    this.updateWebdav({ password: (event.currentTarget as MdFilledTextField).value });
  };

  private async handleTestConnection() {
    const { url, folder, username, password } = this.settings.sync.webdav;
    this.testStatus = 'testing';
    this.testError = '';
    this.testNetworkish = false;
    try {
      const client = new WebDavClient({ url, folder, username, password });
      const result = await client.checkConnection();
      if (result.ok) {
        this.testStatus = 'connected';
      } else {
        const error = result.error ?? 'Connection failed';
        this.testStatus = 'error';
        this.testError = error;
        this.testNetworkish = /network error|failed to fetch|cors/i.test(error.toLowerCase());
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.testStatus = 'error';
      this.testError = message;
      this.testNetworkish = /network error|failed to fetch|cors/i.test(message.toLowerCase());
    }
  }

  private async handleSyncNow() {
    const { url, folder, username, password } = this.settings.sync.webdav;
    if (!url) {
      this.syncPhase = 'needs-config';
      this.syncResult = null;
      this.syncError = null;
      return;
    }

    this.syncPhase = 'syncing';
    this.syncResult = null;
    this.syncError = null;
    this.syncMessage = '';
    try {
      const result = await runSync(
        this.store,
        { url, folder, username, password },
        (p) => {
          this.syncMessage = p.message;
        },
      );
      this.syncResult = result;
      this.syncPhase = 'done';
    } catch (err) {
      this.syncError = err instanceof Error ? err.message : String(err);
      this.syncPhase = 'error';
    }
  }

  private renderSyncSummary() {
    const result = this.syncResult;
    if (!result) return nothing;
    const { pushed, pulled, conflicts, deleted } = result;
    const hasConflicts = conflicts > 0;
    return html`
      <span class="result${hasConflicts ? '' : ' result--ok'}">
        <md-icon>${hasConflicts ? ICONS.warning : ICONS.checkCircle}</md-icon>
        <span class="result-text">
          <span>
            Uploaded ${pushed} · Downloaded ${pulled} ·
            <span class="sync-conflict">Conflicts ${conflicts}</span> ·
            Deleted ${deleted}
          </span>
          ${hasConflicts
            ? html`<span class="result-hint">
                Review conflict copies — saved as .conflict.numr files.
              </span>`
            : nothing}
        </span>
      </span>
    `;
  }

  private renderSyncStatus() {
    switch (this.syncPhase) {
      case 'syncing':
        return html`
          <span class="result">
            <md-icon>${ICONS.cloud}</md-icon>
            <span>${this.syncMessage || 'Syncing…'}</span>
          </span>
        `;
      case 'done':
        return this.renderSyncSummary();
      case 'error':
        return html`
          <span class="result result--error">
            <md-icon>${ICONS.warning}</md-icon>
            <span>${this.syncError}</span>
          </span>
        `;
      case 'needs-config':
        return html`
          <span class="result">
            <md-icon>${ICONS.info}</md-icon>
            <span>Set a WebDAV URL above to sync.</span>
          </span>
        `;
      default:
        return html`
          <span class="result">
            <md-icon>${ICONS.cloud}</md-icon>
            <span>Sync this device with the WebDAV server.</span>
          </span>
        `;
    }
  }

  private handleResultPrecision = (e: Event) => {
    const selected = (e.currentTarget as MdSwitch).selected;
    this.updateMath({ resultPrecisionEnabled: selected });
    saveSettings(this.settings);
  };

  private handleGroupingSeparators = (e: Event) => {
    const selected = (e.currentTarget as MdSwitch).selected;
    this.updateMath({ showGroupingSeparators: selected });
    saveSettings(this.settings);
  };

  private handleLineNumbers = (e: Event) => {
    const selected = (e.currentTarget as MdSwitch).selected;
    this.updateEditor({ showLineNumbers: selected });
    saveSettings(this.settings);
  };

  private handleRegionChange = (e: Event) => {
    const value = (e.currentTarget as MdFilledSelect).value as Region;
    this.updateMath({ region: value });
    saveSettings(this.settings);
  };

  private handlePrecisionSliderInput = (e: Event) => {
    const value = (e.currentTarget as MdSlider).value;
    if (typeof value === 'number') {
      this.updateMath({ precisionDigits: value });
    }
  };

  private handlePrecisionSliderChange = (e: Event) => {
    const value = (e.currentTarget as MdSlider).value;
    if (typeof value === 'number') {
      this.updateMath({ precisionDigits: value });
      saveSettings(this.settings);
    }
  };

  private handleFontSizeInput = (e: Event) => {
    const value = (e.currentTarget as MdSlider).value;
    if (typeof value === 'number') {
      this.updateEditor({ fontSize: value });
    }
  };

  private handleFontSizeChange = (e: Event) => {
    const value = (e.currentTarget as MdSlider).value;
    if (typeof value === 'number') {
      this.updateEditor({ fontSize: value });
      saveSettings(this.settings);
    }
  };

  private renderLeadingIcon(icon: TemplateResult, primary = false) {
    return html`
      <md-icon class="leading-icon${primary ? ' leading-icon--primary' : ''}"
        >${icon}</md-icon
      >
    `;
  }

  private renderSwitchRow(
    icon: TemplateResult,
    label: string,
    hint: string,
    selected: boolean,
    ariaLabel: string,
    onChange: (e: Event) => void,
  ) {
    return html`
      <div class="row">
        ${this.renderLeadingIcon(icon)}
        <div class="row-text">
          <div class="row-title">${label}</div>
          ${hint ? html`<div class="row-hint">${hint}</div>` : nothing}
        </div>
        <md-switch
          aria-label=${ariaLabel}
          ?selected=${selected}
          @change=${onChange}
        ></md-switch>
      </div>
    `;
  }

  private renderNavRow(icon: TemplateResult, label: string, target: SettingsPage) {
    return html`
      <button
        type="button"
        class="row"
        @click=${() => {
          this.page = target;
        }}
      >
        ${this.renderLeadingIcon(icon, true)}
        <span class="row-text">
          <span class="row-title">${label}</span>
        </span>
        <md-icon class="chevron">${ICONS.chevronRight}</md-icon>
      </button>
    `;
  }

  private renderLinkRow(icon: TemplateResult, label: string, href: string) {
    return html`
      <a class="row" href=${href} target="_blank" rel="noopener noreferrer">
        ${this.renderLeadingIcon(icon)}
        <span class="row-text">
          <span class="row-title">${label}</span>
        </span>
        <md-icon class="chevron">${ICONS.chevronRight}</md-icon>
      </a>
    `;
  }

  private renderHome() {
    return html`
      <section class="section" aria-label="Settings">
        <div class="card">
          ${this.renderNavRow(ICONS.calculate, 'Calculator', 'calculator')}
          ${this.renderNavRow(ICONS.data_usage, 'Data & Sync', 'data')}
          ${this.renderNavRow(ICONS.help, 'Help & Feedback', 'help')}
          ${this.renderNavRow(ICONS.info, 'About', 'about')}
        </div>
      </section>
    `;
  }

  private renderCalculator() {
    const { math, editor } = this.settings.calculator;

    return html`
      <section class="section" aria-labelledby="calculator-title">
        <h2 class="section-title" id="calculator-title">Calculator</h2>

        <h3 class="group-title">Math</h3>
        <div class="card">
          ${this.renderSwitchRow(
            ICONS.tune,
            'Result precision',
            'Limit displayed decimals in results',
            math.resultPrecisionEnabled,
            'Result precision',
            this.handleResultPrecision,
          )}
          ${math.resultPrecisionEnabled
            ? html`
                <div class="slider-block">
                  <div class="slider-head">
                    ${this.renderLeadingIcon(ICONS.straighten)}
                    <div class="row-text">
                      <div class="row-title">Precision digits</div>
                      <div class="row-hint">Limit displayed decimals in results</div>
                    </div>
                    <div class="value-badge">${math.precisionDigits}</div>
                  </div>
                  <md-slider
                    aria-label="Precision digits"
                    min="0"
                    max="12"
                    step="1"
                    labeled
                    .value=${math.precisionDigits}
                    @input=${this.handlePrecisionSliderInput}
                    @change=${this.handlePrecisionSliderChange}
                  ></md-slider>
                </div>
              `
            : nothing}
          <div class="field-row">
            <md-filled-select label="Region" @change=${this.handleRegionChange}>
              <md-icon slot="leading-icon" class="leading-icon"
                >${ICONS.public}</md-icon
              >
              <md-select-option value="system" ?selected=${math.region === 'system'}>
                <div slot="headline">System default</div>
              </md-select-option>
              <md-select-option value="en-US" ?selected=${math.region === 'en-US'}>
                <div slot="headline">English (United States)</div>
              </md-select-option>
              <md-select-option value="zh-CN" ?selected=${math.region === 'zh-CN'}>
                <div slot="headline">简体中文 (中国)</div>
              </md-select-option>
            </md-filled-select>
          </div>
          ${this.renderSwitchRow(
            ICONS.space_bar,
            'Show grouping separators',
            'Format numbers like 12,345.58',
            math.showGroupingSeparators,
            'Show grouping separators',
            this.handleGroupingSeparators,
          )}
        </div>

        <h3 class="group-title">Editor</h3>
        <div class="card">
          <div class="slider-block">
            <div class="slider-head">
              ${this.renderLeadingIcon(ICONS.format_size)}
              <div class="row-text">
                <div class="row-title">Font size</div>
                <div class="row-hint">Editor text size</div>
              </div>
              <div class="value-badge">${editor.fontSize}px</div>
            </div>
            <md-slider
              aria-label="Font size"
              min="10"
              max="24"
              step="1"
              labeled
              .value=${editor.fontSize}
              @input=${this.handleFontSizeInput}
              @change=${this.handleFontSizeChange}
            ></md-slider>
          </div>
          ${this.renderSwitchRow(
            ICONS.format_list_numbered,
            'Show line numbers',
            'Display line numbers in the editor',
            editor.showLineNumbers,
            'Show line numbers',
            this.handleLineNumbers,
          )}
        </div>
      </section>
    `;
  }

  private renderEncryptionState() {
    switch (this.encryptionStatus) {
      case 'configured':
        return html`<span class="status-badge status-badge--ok">Encrypted</span>`;
      case 'not-configured':
        return html`<span class="status-badge">Not set up</span>`;
      default:
        return html`<span class="status-badge">Checking…</span>`;
    }
  }

  private renderTestResult() {
    if (this.testStatus === 'connected') {
      return html`
        <span class="result result--ok">
          <md-icon>${ICONS.checkCircle}</md-icon>
          <span>Connected</span>
        </span>
      `;
    }
    if (this.testStatus === 'error') {
      return html`
        <span class="result result--error">
          <md-icon>${ICONS.warning}</md-icon>
          <span class="result-text">
            <span>${this.testError}</span>
            ${this.testNetworkish
              ? html`<span class="result-hint">
                  A network or fetch error usually means the server hasn't enabled
                  CORS (including the ETag header).
                </span>`
              : nothing}
          </span>
        </span>
      `;
    }
    return nothing;
  }

  private renderData() {
    const { url, folder, username, password } = this.settings.sync.webdav;
    const configured = this.encryptionStatus === 'configured';
    const notConfigured = this.encryptionStatus === 'not-configured';

    return html`
      <section class="section" aria-labelledby="data-sync-title">
        <h2 class="section-title" id="data-sync-title">Data &amp; Sync</h2>

        <h3 class="group-title">Encryption</h3>
        <div class="card">
          <div class="row">
            ${this.renderLeadingIcon(ICONS.lock, configured)}
            <div class="row-text">
              <div class="row-title">End-to-end encryption</div>
              <div class="row-hint">
                Files are encrypted on this device before they sync.
              </div>
            </div>
            ${this.renderEncryptionState()}
          </div>
          ${notConfigured
            ? html`
                <div class="actions-row">
                  <md-filled-button @click=${() => this.openWizard('setup')}>
                    Set up encryption
                  </md-filled-button>
                  <md-text-button @click=${() => this.openWizard('restore')}>
                    Restore from mnemonic
                  </md-text-button>
                </div>
              `
            : nothing}
          ${configured
            ? html`
                <div class="note">
                  Your recovery phrase is the only way to restore encrypted files on
                  a new device.
                </div>
                ${this.resetConfirmOpen
                  ? html`
                      <div class="confirm-reset">
                        <p class="confirm-reset-text">
                          This permanently removes encryption. Encrypted files become
                          unreadable until you restore your mnemonic.
                        </p>
                        <div class="confirm-reset-actions">
                          <md-text-button @click=${() => (this.resetConfirmOpen = false)}>
                            Cancel
                          </md-text-button>
                          <md-filled-button class="danger-button" @click=${this.handleResetEncryption}>
                            Confirm reset
                          </md-filled-button>
                        </div>
                      </div>
                    `
                  : html`
                      <div class="actions-row">
                        <md-text-button
                          class="reset-button"
                          @click=${() => (this.resetConfirmOpen = true)}
                        >
                          Reset encryption
                        </md-text-button>
                      </div>
                    `}
              `
            : nothing}
        </div>

        <h3 class="group-title">WebDAV sync</h3>
        <div class="card">
          <div class="note">Credentials are stored only on this device.</div>
          <div class="form-stack">
            <md-filled-text-field
              label="URL"
              placeholder="https://dav.example.com/remote.php/dav"
              .value=${url}
              @input=${this.handleWebdavUrl}
            ></md-filled-text-field>
            <md-filled-text-field
              label="Folder path"
              placeholder="numera"
              .value=${folder}
              @input=${this.handleWebdavFolder}
            ></md-filled-text-field>
            <md-filled-text-field
              label="Username"
              .value=${username}
              @input=${this.handleWebdavUsername}
            ></md-filled-text-field>
            <md-filled-text-field
              label="Password"
              type="password"
              .value=${password}
              @input=${this.handleWebdavPassword}
            ></md-filled-text-field>
          </div>
          <div class="test-row">
            <md-filled-tonal-button
              ?disabled=${this.testStatus === 'testing'}
              @click=${this.handleTestConnection}
            >
              ${this.testStatus === 'testing' ? 'Testing…' : 'Test connection'}
            </md-filled-tonal-button>
            ${this.renderTestResult()}
          </div>
          <div class="sync-row">
            <md-filled-button
              ?disabled=${this.syncPhase === 'syncing'}
              @click=${this.handleSyncNow}
            >
              ${this.syncPhase === 'syncing' ? 'Syncing…' : 'Sync now'}
            </md-filled-button>
            <div class="sync-status" role="status" aria-live="polite">
              ${this.renderSyncStatus()}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  private renderHelp() {
    return html`
      <section class="section" aria-labelledby="help-title">
        <h2 class="section-title" id="help-title">Help &amp; feedback</h2>
        <div class="card">
          <div class="row">
            ${this.renderLeadingIcon(ICONS.feedback)}
            <div class="row-text">
              <div class="row-title">Send feedback</div>
              <div class="row-hint">
                Share ideas or report an issue. A feedback entry point is coming soon.
              </div>
            </div>
            <md-text-button disabled>Send feedback</md-text-button>
          </div>
        </div>
      </section>
    `;
  }

  private renderAbout() {
    return html`
      <section class="section" aria-labelledby="about-title">
        <div class="about-header">
          <img class="app-icon" src="/icon-192.svg" alt="Numera" />
          <h2 class="about-title" id="about-title">Numera</h2>
        </div>
        <div class="card">
          <div class="row">
            ${this.renderLeadingIcon(ICONS.info)}
            <div class="row-text">
              <div class="row-title">Version</div>
              <div class="row-hint">${APP_VERSION}</div>
            </div>
          </div>
          ${this.renderLinkRow(
            ICONS.privacy_tip,
            'Privacy',
            'https://github.com/Jvcon/Numera/blob/main/PRIVACY.md',
          )}
          ${this.renderLinkRow(
            ICONS.attribution,
            'License',
            'https://github.com/Jvcon/Numera/blob/main/LICENSE',
          )}
          ${this.renderLinkRow(
            ICONS.code,
            'Source Code',
            'https://github.com/Jvcon/Numera',
          )}
        </div>
      </section>
    `;
  }

  private renderPage() {
    switch (this.page) {
      case 'calculator':
        return this.renderCalculator();
      case 'data':
        return this.renderData();
      case 'help':
        return this.renderHelp();
      case 'about':
        return this.renderAbout();
      default:
        return this.renderHome();
    }
  }

  render() {
    return html`
      <header class="header">
        <md-icon-button
          class="back-button"
          aria-label="Back"
          title="Back"
          @click=${this.handleBack}
        >
          <md-icon>${ICONS.back}</md-icon>
        </md-icon-button>
        <h1 class="title">Settings</h1>
      </header>

      <div class="scroll">
        <div class="content">${this.renderPage()}</div>
      </div>

      ${this.wizardOpen
        ? html`
            <numera-encryption-setup
              .mode=${this.wizardMode}
              @encryption-setup-close=${this.handleWizardClose}
            ></numera-encryption-setup>
          `
        : nothing}
    `;
  }
}

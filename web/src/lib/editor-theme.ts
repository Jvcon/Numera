/**
 * CodeMirror 6 theme tuned to Numera's Material 3 tokens. Reuses the
 * CSS custom properties defined in `web/src/styles/tokens.css` so the
 * editor always matches the surrounding app surface.
 *
 * Layout: 3-column table — line-number gutter | editor content | result
 * gutter. The result column mirrors the NerdCalci / numr layout: each
 * row shows the formatted evaluation outcome (or an info icon + "Err"
 * for error lines) right-aligned on the same y-coordinate as the
 * source line.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const numeraHighlight = HighlightStyle.define([
  { tag: tags.lineComment, color: 'var(--md-sys-color-on-surface-variant)', fontStyle: 'italic' },
  { tag: tags.number, color: 'var(--md-sys-color-tertiary)' },
  { tag: tags.keyword, color: 'var(--md-sys-color-primary)', fontWeight: '500' },
  { tag: tags.variableName, color: 'var(--md-sys-color-on-surface)' },
  { tag: tags.namespace, color: 'var(--md-sys-color-primary)' },
  { tag: tags.operator, color: 'var(--md-sys-color-on-surface-variant)' },
  { tag: tags.string, color: 'var(--md-sys-color-tertiary)' },
  { tag: tags.punctuation, color: 'var(--md-sys-color-on-surface-variant)' },
]);

export const numeraTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--md-sys-color-surface)',
      color: 'var(--md-sys-color-on-surface)',
      fontSize: 'var(--md-sys-typescale-mono-medium-size)',
      height: '100%',
    },
    '.cm-content': {
      fontFamily: 'var(--md-sys-typescale-font-mono)',
      caretColor: 'var(--md-sys-color-primary)',
      padding: 'var(--md-sys-spacing-block) 0',
    },
    '.cm-line': {
      padding: '0 var(--md-sys-spacing-block-loose)',
    },

    /* ── line-number gutter (left) ─────────────────────────────────── */
    '.cm-gutters': {
      backgroundColor: 'var(--md-sys-color-surface)',
      color: 'var(--md-sys-color-on-surface-variant)',
      border: 'none',
    },
    '.cm-gutter.cm-lineNumbers': {
      backgroundColor: 'transparent',
      minWidth: '2.5rem',
      paddingRight: 'var(--md-sys-spacing-inline-loose)',
    },
    '.cm-gutter.cm-lineNumbers .cm-gutterElement': {
      fontFamily: 'var(--md-sys-typescale-font-mono)',
      fontSize: 'var(--md-sys-typescale-label-small-size)',
      textAlign: 'right',
      padding: '0 var(--md-sys-spacing-inline-loose) 0 0',
    },

    /* ── result gutter (right) — numr-style results column ────────── */
    '.cm-gutter.cm-result-gutter': {
      backgroundColor: 'var(--md-sys-color-surface-container-low)',
      borderLeft: '1px solid var(--md-sys-color-outline-variant)',
      color: 'var(--md-sys-color-on-surface-variant)',
      minWidth: '8rem',
      maxWidth: '14rem',
      padding: '0',
    },
    '.cm-gutter.cm-result-gutter .cm-gutterElement': {
      position: 'relative',
      fontFamily: 'var(--md-sys-typescale-font-mono)',
      fontSize: 'var(--md-sys-typescale-mono-medium-size)',
      lineHeight: 'var(--md-sys-typescale-mono-medium-line)',
      fontWeight: '500',
      textAlign: 'right',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      padding: '0',
      maxWidth: '100%',
    },
    '.numera-result-cell': {
      display: 'inline-block',
      maxWidth: '100%',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      // Top-align so the inline error cell shares the gutter element's
      // line box (same line-height/font-size as the source line), keeping
      // its baseline in sync with the anchored value results at `top: 0`.
      verticalAlign: 'top',
    },
    '.numera-result-cell[data-numera-result-anchor]': {
      position: 'absolute',
      top: '0',
      right: 'var(--md-sys-spacing-inline-loose)',
    },
    '.numera-result-value': {
      color: 'var(--md-sys-color-tertiary)',
      fontWeight: '500',
    },
    '.numera-result-error': {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 'var(--md-sys-spacing-inline-tight)',
      // Match the anchored value results' right inset so the "Err" label
      // isn't flush against the gutter's right edge.
      paddingRight: 'var(--md-sys-spacing-inline-loose)',
      color: 'color-mix(in srgb, var(--md-sys-color-error) 72%, transparent)',
      fontWeight: '500',
    },
    '.numera-error-icon': {
      flexShrink: '0',
    },
    '.numera-error-label': {
      textDecoration: 'underline dashed',
      textUnderlineOffset: '3px',
    },
    '.numera-result-empty': {
      /* Keep the row height stable so the gutter line aligns with
         the source line; the cell stays visually empty. */
      opacity: '0',
    },

    /* ── active-line indicator (subtle, matches M3 focus tone) ─────── */
    '.cm-activeLineGutter': {
      backgroundColor: 'color-mix(in srgb, var(--md-sys-color-on-surface) calc(var(--md-sys-state-focus-state-layer-opacity) * 100%), transparent)',
      color: 'var(--md-sys-color-on-surface)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--md-sys-color-on-surface) calc(var(--md-sys-state-focus-state-layer-opacity) * 100%), transparent)',
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--md-sys-color-primary)',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'color-mix(in srgb, var(--md-sys-color-primary) 20%, transparent)',
    },

    /* ── inline error underline on the source line ─────────────────── */
    '.numera-error-line': {
      textDecoration: 'underline wavy var(--md-sys-color-error)',
      textUnderlineOffset: '4px',
    },
  },
  { dark: false },
);

export const numeraSyntax = syntaxHighlighting(numeraHighlight);

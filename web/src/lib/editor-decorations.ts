/**
 * Result-gutter + inline-error decorations for the Numera editor.
 *
 * This mirrors numr's web editor (https://numr.cc) which also uses
 * CodeMirror 6. The result column is a CodeMirror gutter placed on the
 * RIGHT side via `gutter({ side: "after" })`. Results are stored in
 * editor state (a `StateField`), not in a closure, so the gutter's
 * `lineMarkerChange` callback can detect when new results arrive and
 * force the gutter to re-render.
 *
 * Result anchoring: each result marker is rendered inside a
 * `position: relative` gutter element, then a `resultAlignment`
 * ViewPlugin measures the pixel position where the executable
 * expression ends and sets `top` so the answer lands next to the last
 * symbol — even when the line soft-wraps across visual rows.
 */

import {
  EditorView,
  Decoration,
  ViewPlugin,
  ViewUpdate,
  GutterMarker,
  gutter,
} from '@codemirror/view';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import type { LineOutcome } from './engine';

export type ResultKind = 'value' | 'error' | 'empty';

/** Material "info" (circled-i) glyph path, rendered at 16px. */
const INFO_ICON_PATH =
  'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z';

/** Build the inline-SVG info icon (fill="currentColor", ~16px). */
function createInfoIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('numera-error-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', INFO_ICON_PATH);
  svg.appendChild(path);
  return svg;
}

/**
 * Lightweight touch tooltip for error markers. The full message is
 * never rendered inline; on touch there is no native `title`, so a
 * `pointerup` tap reveals a brief, fixed-position popover appended to
 * the body (outside the gutter, which clips its own overflow).
 */
let errorTooltipEl: HTMLDivElement | null = null;
let errorTooltipTimer: ReturnType<typeof setTimeout> | null = null;

function dismissErrorTooltip(): void {
  if (errorTooltipTimer !== null) {
    clearTimeout(errorTooltipTimer);
    errorTooltipTimer = null;
  }
  errorTooltipEl?.remove();
  errorTooltipEl = null;
}

function showErrorTooltip(message: string, anchor: HTMLElement): void {
  dismissErrorTooltip();

  const tip = document.createElement('div');
  tip.className = 'numera-error-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = message;

  const styles: Record<string, string> = {
    position: 'fixed',
    zIndex: '2147483647',
    maxWidth: 'min(24rem, calc(100vw - 24px))',
    padding: 'var(--md-sys-spacing-inline) var(--md-sys-spacing-block)',
    'background-color': 'var(--md-sys-color-inverse-surface)',
    color: 'var(--md-sys-color-inverse-on-surface)',
    'border-radius': 'var(--md-sys-shape-tooltip)',
    'box-shadow': 'var(--md-sys-elevation-tooltip)',
    'font-family': 'var(--md-sys-typescale-font-plain)',
    'font-size': 'var(--md-sys-typescale-body-small-size)',
    'line-height': 'var(--md-sys-typescale-body-small-line)',
    'pointer-events': 'none',
    'white-space': 'pre-wrap',
    'overflow-wrap': 'anywhere',
  };
  for (const [prop, value] of Object.entries(styles)) {
    tip.style.setProperty(prop, value);
  }
  document.body.appendChild(tip);

  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, rect.left),
    Math.max(8, window.innerWidth - tipRect.width - 8),
  );
  tip.style.left = `${left}px`;
  tip.style.top = `${rect.bottom + 4}px`;

  errorTooltipEl = tip;
  errorTooltipTimer = setTimeout(dismissErrorTooltip, 2600);
}

/** Shape stored in editor state. */
export interface DocumentOutcomes {
  outcomes: readonly LineOutcome[];
}

/** Dispatch to replace the current outcomes in editor state. */
export const setOutcomes = StateEffect.define<DocumentOutcomes>();

const EMPTY_OUTCOMES: DocumentOutcomes = Object.freeze({ outcomes: [] });

/** Editor-state field holding the latest evaluation outcomes. */
export const outcomesField = StateField.define<DocumentOutcomes>({
  create: () => EMPTY_OUTCOMES,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setOutcomes)) return effect.value;
    }
    return value;
  },
});

/** True when a transaction changes either the doc or the outcomes state. */
function outcomesChanged(update: ViewUpdate): boolean {
  return (
    update.docChanged ||
    update.startState.field(outcomesField) !== update.state.field(outcomesField)
  );
}

/**
 * Result marker for the right-side gutter. `anchor` is the UTF-16
 * document offset where the executable expression ends (or null for
 * empty/error cells).
 */
class ResultMarker extends GutterMarker {
  constructor(
    readonly text: string,
    readonly kind: ResultKind,
    readonly anchor: number | null = null,
    readonly message: string | null = null,
  ) {
    super();
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `numera-result-cell numera-result-${this.kind}`;
    if (this.kind === 'value' && this.anchor !== null) {
      el.dataset['numeraResultAnchor'] = String(this.anchor);
    }

    if (this.kind === 'error') {
      // The full message is only shown on hover (title) / tap (tooltip);
      // inline we render a compact info icon + "Err" label.
      if (this.message) {
        el.title = this.message;
        el.addEventListener('pointerup', (event) => {
          if (event.pointerType === 'touch' && this.message) {
            showErrorTooltip(this.message, el);
          }
        });
      }
      el.appendChild(createInfoIcon());
      const label = document.createElement('span');
      label.className = 'numera-error-label';
      label.textContent = this.text;
      el.appendChild(label);
      return el;
    }

    el.textContent = this.text;
    return el;
  }

  eq(other: ResultMarker): boolean {
    return (
      other instanceof ResultMarker &&
      other.text === this.text &&
      other.kind === this.kind &&
      other.anchor === this.anchor &&
      other.message === this.message
    );
  }
}

/** Map a line outcome to a gutter marker (value / error / empty). */
function outcomeToMarker(
  outcome: LineOutcome | undefined,
  anchor: number | null,
): ResultMarker {
  if (!outcome) return new ResultMarker('', 'empty');
  if (outcome.isError) return new ResultMarker('Err', 'error', null, outcome.error);
  if (outcome.isEmpty || outcome.display.length === 0) {
    return new ResultMarker('', 'empty');
  }
  return new ResultMarker(outcome.display, 'value', anchor);
}

/**
 * Result gutter — `side: "after"` puts it on the RIGHT of the editor.
 * `lineMarker` builds the marker per line; `lineMarkerChange` forces a
 * re-render whenever the doc or the outcomes state change.
 */
export function resultGutter(expressionPrefixUtf16Len: (line: string) => number) {
  return gutter({
    class: 'cm-result-gutter',
    side: 'after',
    renderEmptyElements: true,
    lineMarker(view, line) {
      const docLine = view.state.doc.lineAt(line.from);
      const idx = docLine.number - 1;
      const outcomes = view.state.field(outcomesField).outcomes;
      const outcome = outcomes[idx];
      const anchor = line.from + expressionPrefixUtf16Len(docLine.text);
      return outcomeToMarker(outcome, anchor);
    },
    lineMarkerChange: outcomesChanged,
    initialSpacer: () => new ResultMarker('0'.repeat(10), 'value'),
  });
}

/**
 * Inline error underline on the source line. The result itself lives
 * in the gutter, so this ViewPlugin only emits marks.
 */
function errorLineDecoration() {
  return ViewPlugin.fromClass(
    class {
      decorations;
      view: EditorView;

      constructor(view: EditorView) {
        this.view = view;
        this.decorations = this.build(view);
      }

      update(update: ViewUpdate): void {
        if (outcomesChanged(update) || update.viewportChanged) {
          this.decorations = this.build(update.view);
        }
      }

      private build(view: EditorView) {
        const outcomes = view.state.field(outcomesField).outcomes;
        const builder = new RangeSetBuilder<Decoration>();
        const doc = view.state.doc;

        for (const { from, to } of view.visibleRanges) {
          for (let pos = from; pos <= to; ) {
            const line = doc.lineAt(pos);
            const outcome = outcomes[line.number - 1];
            if (outcome?.isError) {
              builder.add(
                line.from,
                line.from,
                Decoration.mark({ class: 'numera-error-line' }),
              );
            }
            pos = line.to + 1;
          }
        }

        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/**
 * Anchors each `.numera-result-cell[data-numera-result-anchor]` to the
 * end of its executable expression (wrapped-line aware), mirroring
 * numr's `resultAlignment` plugin.
 *
 * We use `requestMeasure` to read pixel coords and write the `top`
 * offset — this avoids reflow thrash during layout.
 */
const resultAlignment = ViewPlugin.fromClass(
  class {
    view: EditorView;

    constructor(view: EditorView) {
      this.view = view;
      this.schedule(view);
    }

    update(update: ViewUpdate): void {
      if (
        outcomesChanged(update) ||
        update.geometryChanged ||
        update.viewportChanged
      ) {
        this.schedule(update.view);
      }
    }

    schedule(view: EditorView): void {
      view.requestMeasure({
        key: this,
        read: (v) => {
          const anchors = Array.from(
            v.dom.querySelectorAll<HTMLElement>('[data-numera-result-anchor]'),
          );
          return anchors.map((el) => {
            const rect = el.getBoundingClientRect();
            const parentRect = el.parentElement!.getBoundingClientRect();
            const docOffset = Number(el.dataset['numeraResultAnchor']);
            const coords = v.coordsAtPos(docOffset, -1);
            const maxTop = Math.max(0, parentRect.height - rect.height);
            const top = coords
              ? Math.min(maxTop, Math.max(0, coords.top - parentRect.top))
              : 0;
            return { el, top };
          });
        },
        write: (entries) => {
          for (const { el, top } of entries) {
            el.style.top = `${top}px`;
          }
        },
      });
    }
  },
);

/**
 * Convenience bundle: outcomes field + gutter + inline error marks +
 * result alignment. Use this in the editor extension list.
 */
export function outcomeDecorations(expressionPrefixUtf16Len: (line: string) => number) {
  return [
    outcomesField,
    resultGutter(expressionPrefixUtf16Len),
    errorLineDecoration(),
    resultAlignment,
  ];
}

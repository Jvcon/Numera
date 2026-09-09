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
 * Copy `text` to the clipboard. Prefers the async Clipboard API
 * (secure contexts); falls back to a temporary hidden `<textarea>` +
 * `document.execCommand('copy')` when the async API is missing (e.g.
 * served over plain HTTP). Resolves to whether the copy succeeded.
 */
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy path below.
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    // Keep it off-screen but still selectable for the copy command.
    ta.style.position = 'fixed';
    ta.style.top = '0';
    ta.style.left = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Material 3 plain tooltip for error markers, built as a lightweight
 * `position: fixed` element appended to the document body (outside the
 * gutter, which clips its own overflow). It follows the M3 tooltip
 * tokens — inverse-surface container, inverse-on-surface text, tooltip
 * shape (4px), tooltip elevation, body-small typography — and is shown
 * on demand when the "Err" affordance is pressed.
 *
 * The element is reused across presses: switching to a different "Err"
 * marker animates the same node to its new position instead of tearing
 * it down and rebuilding it. Lifecycle is re-bound to the new anchor on
 * every press (outside-press / Escape / scroll / timeout dismissal), and
 * a window event (`numera-dismiss-tooltip`) lets the snackbar toast
 * dismiss it explicitly.
 */
let errorTooltipEl: HTMLDivElement | null = null;
let errorTooltipTimer: ReturnType<typeof setTimeout> | null = null;
let errorTooltipCleanup: (() => void) | null = null;
let errorTooltipAnimation: Animation | null = null;

const ERROR_TOOLTIP_TIMEOUT_MS = 5000;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Read a motion duration token from the computed style, in ms. */
function motionDurationMs(el: Element, token: string): number {
  const value = getComputedStyle(el).getPropertyValue(token).trim();
  const match = /^([\d.]+)(ms|s)$/.exec(value);
  if (!match) return 200;
  const amount = Number(match[1]);
  return match[2] === 's' ? amount * 1000 : amount;
}

/** Read the emphasized easing token from the computed style. */
function motionEasing(el: Element): string {
  const value = getComputedStyle(el)
    .getPropertyValue('--md-sys-motion-easing-emphasized')
    .trim();
  return value || 'cubic-bezier(0.2, 0, 0, 1)';
}

function dismissErrorTooltip(): void {
  if (errorTooltipTimer !== null) {
    clearTimeout(errorTooltipTimer);
    errorTooltipTimer = null;
  }
  errorTooltipCleanup?.();
  errorTooltipCleanup = null;
  errorTooltipAnimation?.cancel();
  errorTooltipAnimation = null;
  errorTooltipEl?.remove();
  errorTooltipEl = null;
}

/**
 * Compute where the tooltip should sit for `anchor`, kept inside the
 * viewport. The "Err" marker lives in a right-side gutter, so the
 * tooltip opens leftward (right-aligned to the marker) and flips above
 * the anchor when there isn't enough room below.
 */
function computeErrorTooltipPosition(
  tip: HTMLElement,
  anchor: HTMLElement,
): { left: number; top: number } {
  const margin = 8;
  const gap = 4;
  const rect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();

  let left = rect.right - tipRect.width;
  left = Math.min(
    Math.max(left, margin),
    Math.max(margin, window.innerWidth - tipRect.width - margin),
  );

  let top = rect.bottom + gap;
  if (top + tipRect.height > window.innerHeight - margin) {
    top = rect.top - gap - tipRect.height;
  }
  top = Math.min(
    Math.max(top, margin),
    Math.max(margin, window.innerHeight - tipRect.height - margin),
  );

  return { left: Math.round(left), top: Math.round(top) };
}

function resetErrorTooltipTimer(): void {
  if (errorTooltipTimer !== null) clearTimeout(errorTooltipTimer);
  errorTooltipTimer = setTimeout(dismissErrorTooltip, ERROR_TOOLTIP_TIMEOUT_MS);
}

/**
 * Bind the dismissal lifecycle to `anchor`. Any previous bindings are
 * removed first, so listeners are never duplicated or leaked. The
 * window-level `numera-dismiss-tooltip` listener exists only while the
 * tooltip is open (it is removed on dismiss).
 */
function bindErrorTooltipLifecycle(anchor: HTMLElement): void {
  errorTooltipCleanup?.();
  errorTooltipCleanup = null;

  const onDocumentMouseDown = (event: Event): void => {
    // The press that opened the tooltip (whose target is inside the
    // anchor) must not immediately dismiss it. The anchor lives inside
    // the editor's shadow DOM, so by the time this document-level
    // listener runs, `event.target` has been retargeted to the shadow
    // host and `anchor.contains(target)` would be false. Use the
    // composed path instead so the guard still matches the real target.
    if (event.composedPath().includes(anchor)) return;
    dismissErrorTooltip();
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismissErrorTooltip();
  };
  const onScroll = (): void => {
    dismissErrorTooltip();
  };
  const onDismissRequest = (): void => {
    dismissErrorTooltip();
  };

  document.addEventListener('mousedown', onDocumentMouseDown);
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('numera-dismiss-tooltip', onDismissRequest);

  errorTooltipCleanup = () => {
    document.removeEventListener('mousedown', onDocumentMouseDown);
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('numera-dismiss-tooltip', onDismissRequest);
  };
}

function showErrorTooltip(message: string, anchor: HTMLElement): void {
  // Coordinate with the snackbar toast: opening the tooltip dismisses
  // any open toast so the two overlays never coexist.
  window.dispatchEvent(new CustomEvent('numera-dismiss-snackbar'));

  const reduceMotion = prefersReducedMotion();

  if (errorTooltipEl && errorTooltipEl.isConnected) {
    moveErrorTooltip(message, anchor, reduceMotion);
    return;
  }

  const tip = document.createElement('div');
  tip.className = 'numera-error-tooltip';
  tip.setAttribute('role', 'tooltip');
  tip.textContent = message;

  const styles: Record<string, string> = {
    position: 'fixed',
    zIndex: '2147483647',
    maxWidth: 'min(20rem, calc(100vw - 32px))',
    padding: '4px 8px',
    'background-color': 'var(--md-sys-color-inverse-surface)',
    color: 'var(--md-sys-color-inverse-on-surface)',
    'border-radius': 'var(--md-sys-shape-tooltip)',
    'box-shadow': 'var(--md-sys-elevation-tooltip)',
    'font-family': 'var(--md-sys-typescale-body-small-font)',
    'font-size': 'var(--md-sys-typescale-body-small-size)',
    'line-height': 'var(--md-sys-typescale-body-small-line)',
    'font-weight': 'var(--md-sys-typescale-body-small-weight)',
    'letter-spacing': 'var(--md-sys-typescale-body-small-tracking)',
    'pointer-events': 'none',
    'white-space': 'pre-wrap',
    'overflow-wrap': 'anywhere',
  };
  for (const [prop, value] of Object.entries(styles)) {
    tip.style.setProperty(prop, value);
  }
  document.body.appendChild(tip);

  const { left, top } = computeErrorTooltipPosition(tip, anchor);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;

  errorTooltipEl = tip;

  // Subtle fade-in (skipped when the user prefers reduced motion).
  if (!reduceMotion && typeof tip.animate === 'function') {
    errorTooltipAnimation = tip.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 120, easing: 'ease-out' },
    );
  }

  bindErrorTooltipLifecycle(anchor);
  resetErrorTooltipTimer();
}

/**
 * Reuse the existing tooltip for a different "Err" marker: update the
 * text in place and animate `left`/`top` from the current position to
 * the newly computed one (skipped under reduced motion — the tooltip
 * simply jumps). Lifecycle is re-bound to the new anchor and the
 * auto-dismiss timer is reset.
 */
function moveErrorTooltip(
  message: string,
  anchor: HTMLElement,
  reduceMotion: boolean,
): void {
  const tip = errorTooltipEl as HTMLDivElement;

  // Stop any in-flight animation so the move starts from a stable spot.
  errorTooltipAnimation?.cancel();
  errorTooltipAnimation = null;

  const fromRect = tip.getBoundingClientRect();
  const fromLeft = fromRect.left;
  const fromTop = fromRect.top;

  tip.textContent = message;
  const { left, top } = computeErrorTooltipPosition(tip, anchor);

  // Commit the destination as the base style (it sticks once the
  // animation ends), then animate the move from the old position.
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;

  if (!reduceMotion && typeof tip.animate === 'function') {
    errorTooltipAnimation = tip.animate(
      [
        { left: `${fromLeft}px`, top: `${fromTop}px` },
        { left: `${left}px`, top: `${top}px` },
      ],
      {
        duration: motionDurationMs(tip, '--md-sys-motion-duration-medium'),
        easing: motionEasing(tip),
      },
    );
  }

  bindErrorTooltipLifecycle(anchor);
  resetErrorTooltipTimer();
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
      // A compact info icon + "Err" label. Interaction is handled via
      // the gutter's `domEventHandlers` (event delegation) so the
      // tooltip keeps working even when CodeMirror re-renders marker
      // DOM; inline we only render the static affordance.
      el.appendChild(createInfoIcon());
      const label = document.createElement('span');
      label.className = 'numera-error-label';
      label.textContent = this.text;
      el.appendChild(label);
      return el;
    }

    if (this.kind === 'value') {
      el.title = 'Click to copy';
      el.setAttribute('aria-label', 'Click to copy');
      el.addEventListener('click', () => {
        void copyText(this.text).then((copied) => {
          if (copied) {
            el.dispatchEvent(
              new CustomEvent('result-copied', {
                detail: { value: this.text },
                bubbles: true,
                composed: true,
              }),
            );
          }
        });
      });
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
    // Delegate the error affordance's press to the gutter itself (not
    // per-marker DOM) so it survives marker re-renders. CodeMirror's
    // content-selection handlers don't apply to this gutter, but a
    // delegated `mousedown` still gives us the most reliable, re-entrant
    // trigger for both mouse and touch.
    domEventHandlers: {
      mousedown(view, line, event) {
        const target = event.target;
        if (!(target instanceof Element)) return false;
        const anchor = target.closest('.numera-result-error');
        if (!(anchor instanceof HTMLElement)) return false;
        const lineNo = view.state.doc.lineAt(line.from).number;
        const outcome = view.state.field(outcomesField).outcomes[lineNo - 1];
        if (outcome?.isError && outcome.error) {
          showErrorTooltip(outcome.error, anchor);
          return true;
        }
        return false;
      },
    },
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

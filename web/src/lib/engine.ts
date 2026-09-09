/**
 * Numera engine — async wrapper around the WASM-compiled calculation
 * engine.
 *
 * The WASM bindings are copied into `web/src/wasm/` by the
 * `sync:wasm` npm script. Vite treats them as ES modules, so the
 * default `init` export and `WasmEngine` class are statically
 * importable and tree-shakable.
 *
 * Consumers do not touch WASM types directly: they receive plain
 * `LineOutcome` objects whose fields are JSON-friendly primitives.
 */

import init, { WasmEngine as RawWasmEngine } from '../wasm/numera_wasm.js';

export type OutcomeKind = 'number' | 'date' | 'string' | 'empty' | 'error';

export interface LineOutcome {
  /** Formatted result, or empty string for blank/comment/error lines. */
  display: string;
  /** Error message when the line failed to evaluate. */
  error: string | null;
  /** True for blank lines and comments (no computation performed). */
  isEmpty: boolean;
  /** True when this line produced an evaluation error. */
  isError: boolean;
  /** Value category, driving how `rawValue` is re-formatted with Intl. */
  kind: OutcomeKind;
  /**
   * Machine-readable original value: a number for `kind: 'number'`, an
   * ISO-8601 string for `kind: 'date'`, and `null` for `'empty'` /
   * `'error'`. `display` remains the engine-formatted fallback.
   */
  rawValue: number | string | null;
}

/** Shape returned by `initEngine()` so callers can reuse the WASM promise. */
export interface EngineHandle {
  /** Evaluate every line of `document` with the cached globals. */
  evaluateDocument(document: string): Promise<LineOutcome[]>;
  /** Replace the cached globals content (the `globals.numr` file). */
  setGlobals(content: string): Promise<void>;
  /** Evaluate a single expression. Globals must already be set. */
  eval(line: string): Promise<string>;
  /**
   * UTF-16 offset where the executable expression ends (trailing
   * comment excluded). Used to anchor the result marker next to the
   * last symbol, even on wrapped lines.
   */
  expressionPrefixUtf16Len(line: string): number;
}

let initPromise: Promise<RawWasmEngine> | null = null;

/**
 * Lazy-load and initialise the WASM module. Safe to call from
 * multiple components; subsequent callers receive the same promise.
 */
export async function initEngine(): Promise<EngineHandle> {
  if (!initPromise) {
    initPromise = (async () => {
      // The default export is an async `init()` that resolves the
      // `.wasm` file relative to the imported module URL and wires it
      // up. Calling it before instantiating `WasmEngine` is required.
      await init();
      return new RawWasmEngine();
    })();
  }
  const instance = await initPromise;

  return {
    async evaluateDocument(document: string): Promise<LineOutcome[]> {
      return instance.evaluateDocument(document) as unknown as LineOutcome[];
    },
    async setGlobals(content: string): Promise<void> {
      instance.setGlobals(content);
    },
    async eval(line: string): Promise<string> {
      return instance.eval(line);
    },
    expressionPrefixUtf16Len(line: string): number {
      return instance.expressionPrefixUtf16Len(line);
    },
  };
}

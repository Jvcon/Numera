//! Numera WASM - WebAssembly bindings
//!
//! This crate exposes the calculation engine to web browsers. The
//! primary entry point is [`WasmEngine`], which mirrors the editor's
//! mental model: globals are pushed in, a document is fed line by line,
//! and per-line outcomes are returned as plain JSON for the JS layer
//! to render.

use numera_engine::{Engine as CoreEngine, LineOutcome};
use wasm_bindgen::prelude::*;

/// Initialize the WASM module. Wired up by `#[wasm_bindgen(start)]`.
#[wasm_bindgen(start)]
pub fn init() {
    // Set up panic hook for better error messages.
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// One engine instance per workspace. The JS layer is expected to keep
/// a single `WasmEngine` alive for the duration of a session.
#[wasm_bindgen]
pub struct WasmEngine {
    engine: CoreEngine,
}

#[wasm_bindgen]
impl WasmEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            engine: CoreEngine::new(),
        }
    }

    /// Store the globals content (`globals.numr`). Subsequent
    /// [`evaluate_document`] calls re-inject globals before evaluating.
    #[wasm_bindgen(js_name = setGlobals)]
    pub fn set_globals(&mut self, content: &str) {
        self.engine.set_globals(content);
    }

    /// Evaluate every line of `document` and return one
    /// `{display, error, isEmpty, isError}` entry per input line, in
    /// order. Globals are pre-injected.
    #[wasm_bindgen(js_name = evaluateDocument)]
    pub fn evaluate_document(&mut self, document: &str) -> Result<JsValue, JsError> {
        let outcomes: Vec<LineOutcome> = self.engine.evaluate_document(document);
        serde_wasm_bindgen::to_value(&outcomes).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Single-line evaluation. Globals are NOT re-injected — call
    /// [`set_globals`] first or use [`evaluate_document`] for a fresh
    /// evaluation pass.
    #[wasm_bindgen]
    pub fn eval(&mut self, line: &str) -> Result<String, JsError> {
        self.engine
            .eval(line)
            .map_err(|e| JsError::new(&e.to_string()))
    }

    /// UTF-16 offset where the executable expression ends (trailing
    /// comments are excluded). The result gutter uses this to anchor
    /// its visual marker next to the last symbol of the expression,
    /// even when the line wraps across visual rows.
    #[wasm_bindgen(js_name = expressionPrefixUtf16Len)]
    pub fn expression_prefix_utf16_len(&self, line: &str) -> usize {
        numera_engine::expression_prefix::expression_prefix_utf16_len(line)
    }
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}

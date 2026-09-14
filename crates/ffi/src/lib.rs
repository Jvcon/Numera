//! Numera FFI - UniFFI bindings for Kotlin/Swift
//!
//! This crate provides FFI bindings for Android (Kotlin) and iOS (Swift).
//!
//! The engine is kept behind an `Arc<Mutex<...>>` so the generated foreign
//! wrapper can hold a shared handle. Every fallible core operation is mapped
//! to a safe default (`0`, `""`, `"[]"`) rather than panicking or unwinding
//! across the FFI boundary.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use numera_engine::eval::Decimal;

/// FFI-compatible engine wrapper.
pub struct NumeraEngine {
    engine: Arc<Mutex<numera_engine::Engine>>,
}

impl NumeraEngine {
    /// Create a new engine.
    pub fn new() -> Self {
        Self {
            engine: Arc::new(Mutex::new(numera_engine::Engine::new())),
        }
    }

    /// Store the globals content (`globals.numr`). Subsequent
    /// [`Self::evaluate_document`] calls re-inject globals before evaluating.
    pub fn set_globals(&self, content: String) {
        if let Ok(mut engine) = self.engine.lock() {
            engine.set_globals(&content);
        }
    }

    /// Replace the cross-file document table used to resolve
    /// `file("alias")` / `file("alias").member` references. `docs_json` is a
    /// JSON object mapping each alias to the referenced document's content,
    /// e.g. `{"daily": "total = 12 + 5"}`.
    ///
    /// Malformed JSON is ignored: the previous table is left in place.
    pub fn set_documents(&self, docs_json: String) {
        let Ok(docs) = serde_json::from_str::<HashMap<String, String>>(&docs_json) else {
            return;
        };
        if let Ok(mut engine) = self.engine.lock() {
            engine.set_documents(docs.into_iter().collect());
        }
    }

    /// Evaluate every line of `document` and return one
    /// `{display, error, isEmpty, isError, kind, rawValue}` entry per input
    /// line, in order, serialized as a JSON array string.
    pub fn evaluate_document(&self, document: String) -> String {
        let Ok(mut engine) = self.engine.lock() else {
            return "[]".to_string();
        };
        let outcomes = engine.evaluate_document(&document);
        serde_json::to_string(&outcomes).unwrap_or_else(|_| "[]".to_string())
    }

    /// Single-line evaluation. Errors map to the empty string.
    pub fn eval(&self, line: String) -> String {
        let Ok(mut engine) = self.engine.lock() else {
            return String::new();
        };
        engine.eval(&line).unwrap_or_default()
    }

    /// Apply exchange rates from a JSON object keyed by currency code:
    /// `{"EUR": 0.92, "BTC": 95000, ...}`. Returns the number of rates
    /// accepted, or `0` when the JSON is malformed or the rates are rejected.
    pub fn apply_rates(&self, rates_json: String) -> u32 {
        let Ok(rates) = serde_json::from_str::<HashMap<String, Decimal>>(&rates_json) else {
            return 0;
        };
        let Ok(mut engine) = self.engine.lock() else {
            return 0;
        };
        engine.apply_rates(rates).map(|n| n as u32).unwrap_or(0)
    }

    /// UTF-16 offset where the executable expression ends (trailing comments
    /// are excluded). The result gutter uses this to anchor its visual marker
    /// next to the last symbol of the expression.
    pub fn expression_prefix_utf16_len(&self, line: String) -> u32 {
        numera_engine::expression_prefix::expression_prefix_utf16_len(&line) as u32
    }
}

impl Default for NumeraEngine {
    fn default() -> Self {
        Self::new()
    }
}

// UniFFI scaffolding
uniffi::include_scaffolding!("numera");

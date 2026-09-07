//! Numera WASM - WebAssembly bindings
//!
//! This crate provides WASM bindings for the Numera engine
//! for use in web browsers.

use wasm_bindgen::prelude::*;

/// Initialize the WASM module
#[wasm_bindgen(start)]
pub fn init() {
    // Set up panic hook for better error messages
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Evaluate an expression
#[wasm_bindgen]
pub fn eval(expr: &str) -> Result<String, JsError> {
    let mut engine = numera_engine::Engine::new();
    engine.eval(expr).map_err(|e| JsError::new(&e.to_string()))
}

/// Create a new engine instance
#[wasm_bindgen]
pub struct WasmEngine {
    engine: numera_engine::Engine,
}

#[wasm_bindgen]
impl WasmEngine {
    /// Create a new engine
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            engine: numera_engine::Engine::new(),
        }
    }

    /// Evaluate an expression
    pub fn eval(&mut self, expr: &str) -> Result<String, JsError> {
        self.engine.eval(expr).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Load globals
    pub fn load_globals(&mut self, content: &str) -> Result<(), JsError> {
        self.engine.load_globals(content).map_err(|e| JsError::new(&e.to_string()))
    }

    /// Load a document
    pub fn load_document(&mut self, name: &str, content: &str) {
        self.engine.load_document(name, content);
    }

    /// Set current document
    pub fn set_current_document(&mut self, name: Option<String>) {
        self.engine.set_current_document(name);
    }
}

impl Default for WasmEngine {
    fn default() -> Self {
        Self::new()
    }
}

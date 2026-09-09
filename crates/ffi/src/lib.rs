//! Numera FFI - UniFFI bindings for Kotlin/Swift
//!
//! This crate provides FFI bindings for Android (Kotlin) and iOS (Swift).

use std::sync::{Arc, Mutex};

/// FFI-compatible engine wrapper
pub struct NumeraEngine {
    engine: Arc<Mutex<numera_engine::Engine>>,
}

impl NumeraEngine {
    /// Create a new engine
    pub fn new() -> Self {
        Self {
            engine: Arc::new(Mutex::new(numera_engine::Engine::new())),
        }
    }

    /// Evaluate an expression
    pub fn eval(&self, expr: &str) -> Result<String, String> {
        let mut engine = self.engine.lock().map_err(|e| e.to_string())?;
        engine.eval(expr).map_err(|e| e.to_string())
    }

    /// Load globals
    pub fn load_globals(&self, content: &str) -> Result<(), String> {
        let mut engine = self.engine.lock().map_err(|e| e.to_string())?;
        engine.set_globals(content);
        Ok(())
    }

    /// Load a document
    pub fn load_document(&self, name: &str, content: &str) {
        if let Ok(mut engine) = self.engine.lock() {
            engine.load_document(name, content);
        }
    }

    /// Set current document
    pub fn set_current_document(&self, name: Option<String>) {
        if let Ok(mut engine) = self.engine.lock() {
            engine.set_current_document(name);
        }
    }
}

impl Default for NumeraEngine {
    fn default() -> Self {
        Self::new()
    }
}

// UniFFI scaffolding
uniffi::include_scaffolding!("numera");

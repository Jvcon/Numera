use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Document metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMeta {
    pub name: String,
    pub path: String,
    pub display_name: Option<String>,
    pub tags: Vec<String>,
    pub pinned: bool,
    pub locked: bool,
    pub encrypted: bool,
}

/// Variable with metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Variable {
    pub name: String,
    pub value: String,
    pub source: VariableSource,
    pub is_global: bool,
}

/// Source of a variable
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum VariableSource {
    Global,
    Local,
    Reference(String),
}

/// Multi-document context for evaluation
#[derive(Debug, Clone)]
pub struct EngineContext {
    /// Currently active document
    pub current_document: Option<String>,
    /// Loaded documents content
    pub documents: HashMap<String, String>,
    /// Document metadata
    pub metadata: HashMap<String, DocumentMeta>,
    /// Global variables (from globals.numr)
    pub globals: HashMap<String, String>,
    /// Local variables per document
    pub locals: HashMap<String, HashMap<String, String>>,
    /// Aggregation results
    pub aggregations: HashMap<String, f64>,
    /// Search paths for file references
    pub search_paths: Vec<String>,
}

impl EngineContext {
    /// Create a new empty context
    pub fn new() -> Self {
        Self {
            current_document: None,
            documents: HashMap::new(),
            metadata: HashMap::new(),
            globals: HashMap::new(),
            locals: HashMap::new(),
            aggregations: HashMap::new(),
            search_paths: vec!["files/".to_string()],
        }
    }

    /// Set the current active document
    pub fn set_current_document(&mut self, name: Option<String>) {
        self.current_document = name;
    }

    /// Load a document into context
    pub fn load_document(&mut self, name: &str, content: &str) {
        self.documents.insert(name.to_string(), content.to_string());
    }

    /// Unload a document from context
    pub fn unload_document(&mut self, name: &str) {
        self.documents.remove(name);
    }

    /// Set global variables (from globals.numr)
    pub fn set_globals(&mut self, globals: HashMap<String, String>) {
        self.globals = globals;
    }

    /// Get variable value, checking locals first, then globals
    pub fn get_variable(&self, name: &str) -> Option<&String> {
        // Check local variables for current document
        if let Some(ref doc) = self.current_document {
            if let Some(locals) = self.locals.get(doc) {
                if let Some(value) = locals.get(name) {
                    return Some(value);
                }
            }
        }

        // Check globals
        self.globals.get(name)
    }

    /// Set a local variable for the current document
    pub fn set_local_variable(&mut self, name: &str, value: &str) {
        if let Some(ref doc) = self.current_document {
            let locals = self.locals.entry(doc.clone()).or_insert_with(HashMap::new);
            locals.insert(name.to_string(), value.to_string());
        }
    }

    /// Get document content
    pub fn get_document(&self, name: &str) -> Option<&String> {
        self.documents.get(name)
    }

    /// Set aggregation result
    pub fn set_aggregation(&mut self, name: &str, value: f64) {
        self.aggregations.insert(name.to_string(), value);
    }

    /// Get aggregation result
    pub fn get_aggregation(&self, name: &str) -> Option<f64> {
        self.aggregations.get(name).copied()
    }

    /// Resolve a file reference path
    pub fn resolve_file_path(&self, name: &str) -> Option<String> {
        // Try exact name first
        if self.documents.contains_key(name) {
            return Some(name.to_string());
        }

        // Try with .numr extension
        let with_ext = format!("{}.numr", name);
        if self.documents.contains_key(&with_ext) {
            return Some(with_ext);
        }

        // Try in search paths
        for path in &self.search_paths {
            let full_path = format!("{}{}", path, with_ext);
            if self.documents.contains_key(&full_path) {
                return Some(full_path);
            }
        }

        None
    }
}

impl Default for EngineContext {
    fn default() -> Self {
        Self::new()
    }
}

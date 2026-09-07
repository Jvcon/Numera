//! Numera Engine - Extended calculation engine
//!
//! This crate extends numr-core with additional features:
//! - Date/time/timezone expressions
//! - Cross-file references via file("name") syntax
//! - Aggregation variables (sum, avg, total, etc.)
//! - Multi-document context management

pub mod context;
pub mod date;
pub mod error;
pub mod eval;
pub mod reference;
pub mod aggregate;

// Re-export main types
pub use context::EngineContext;
pub use error::EngineError;
pub use eval::Engine;

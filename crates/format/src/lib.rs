//! Numera Format - Unified file format handling
//!
//! This crate handles the workspace file format including:
//! - manifest.json: workspace metadata
//! - globals.numr: global variables
//! - .numr files: calculation files

pub mod error;
pub mod manifest;
pub mod workspace;
pub mod globals;

// Re-export main types
pub use error::FormatError;
pub use manifest::{Manifest, FileInfo, EncryptionInfo};
pub use workspace::Workspace;
pub use globals::Globals;

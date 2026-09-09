//! Numera Sync - WebDAV sync client
//!
//! This crate provides WebDAV synchronization with:
//! - Conflict detection
//! - Incremental sync
//! - State management

pub mod error;
pub mod client;
pub mod state;
pub mod conflict;

// Re-export main types
pub use error::SyncError;
pub use client::{DavEntry, GetFileResult, WebDavClient};
pub use state::SyncState;
pub use conflict::ConflictResolver;

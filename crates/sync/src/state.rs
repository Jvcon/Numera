use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use crate::error::SyncError;

/// Local sync state (state.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncState {
    /// Last sync timestamp
    pub last_sync_at: Option<String>,
    /// File states
    pub files: HashMap<String, FileState>,
    /// Deleted files (tombstones)
    pub tombstones: HashMap<String, Tombstone>,
}

/// File sync state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileState {
    /// Local content hash
    pub local_hash: String,
    /// Remote content hash
    pub remote_hash: Option<String>,
    /// Remote ETag
    pub remote_etag: Option<String>,
    /// Last synced timestamp
    pub last_synced_at: Option<String>,
}

/// Tombstone for deleted files
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tombstone {
    /// Deletion timestamp
    pub deleted_at: String,
}

impl SyncState {
    /// Create a new empty sync state
    pub fn new() -> Self {
        Self {
            last_sync_at: None,
            files: HashMap::new(),
            tombstones: HashMap::new(),
        }
    }

    /// Load sync state from JSON
    pub fn from_json(json: &str) -> Result<Self, SyncError> {
        serde_json::from_str(json).map_err(SyncError::JsonError)
    }

    /// Serialize to JSON
    pub fn to_json(&self) -> Result<String, SyncError> {
        serde_json::to_string_pretty(self).map_err(SyncError::JsonError)
    }

    /// Update file state
    pub fn update_file(&mut self, path: &str, hash: &str) {
        self.files.insert(
            path.to_string(),
            FileState {
                local_hash: hash.to_string(),
                remote_hash: None,
                remote_etag: None,
                last_synced_at: None,
            },
        );
    }

    /// Mark file as synced
    pub fn mark_synced(&mut self, path: &str, remote_hash: &str, etag: &str) {
        if let Some(state) = self.files.get_mut(path) {
            state.remote_hash = Some(remote_hash.to_string());
            state.remote_etag = Some(etag.to_string());
            state.last_synced_at = Some(chrono::Utc::now().to_rfc3339());
        }
    }

    /// Add tombstone for deleted file
    pub fn add_tombstone(&mut self, path: &str) {
        self.files.remove(path);
        self.tombstones.insert(
            path.to_string(),
            Tombstone {
                deleted_at: chrono::Utc::now().to_rfc3339(),
            },
        );
    }

    /// Update last sync timestamp
    pub fn update_last_sync(&mut self) {
        self.last_sync_at = Some(chrono::Utc::now().to_rfc3339());
    }
}

impl Default for SyncState {
    fn default() -> Self {
        Self::new()
    }
}

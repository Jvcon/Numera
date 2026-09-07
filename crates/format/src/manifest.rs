use std::collections::HashMap;
use serde::{Deserialize, Serialize};

/// Workspace manifest (manifest.json)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// Manifest version
    pub version: u32,
    /// Creation timestamp
    pub created_at: String,
    /// Encryption settings
    pub encryption: EncryptionInfo,
    /// File entries
    pub files: HashMap<String, FileInfo>,
}

/// Encryption configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionInfo {
    /// Whether encryption is enabled
    pub enabled: bool,
    /// Key verification hash (for checking correct key)
    pub key_verify_hash: Option<String>,
}

/// File metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileInfo {
    /// Display name
    pub display_name: String,
    /// Tags
    #[serde(default)]
    pub tags: Vec<String>,
    /// Whether file is pinned
    #[serde(default)]
    pub pinned: bool,
    /// Whether file is locked
    #[serde(default)]
    pub locked: bool,
    /// Whether file is encrypted
    #[serde(default)]
    pub encrypted: bool,
    /// Sort order
    #[serde(default)]
    pub sort_order: i32,
}

impl Manifest {
    /// Create a new empty manifest
    pub fn new() -> Self {
        Self {
            version: 1,
            created_at: chrono::Utc::now().to_rfc3339(),
            encryption: EncryptionInfo {
                enabled: false,
                key_verify_hash: None,
            },
            files: HashMap::new(),
        }
    }

    /// Add a file to the manifest
    pub fn add_file(&mut self, path: &str, info: FileInfo) {
        self.files.insert(path.to_string(), info);
    }

    /// Remove a file from the manifest
    pub fn remove_file(&mut self, path: &str) -> Option<FileInfo> {
        self.files.remove(path)
    }

    /// Get file info
    pub fn get_file(&self, path: &str) -> Option<&FileInfo> {
        self.files.get(path)
    }

    /// Get all files sorted by sort_order
    pub fn sorted_files(&self) -> Vec<(&String, &FileInfo)> {
        let mut files: Vec<_> = self.files.iter().collect();
        files.sort_by_key(|(_, info)| info.sort_order);
        files
    }

    /// Get pinned files
    pub fn pinned_files(&self) -> Vec<(&String, &FileInfo)> {
        self.files.iter().filter(|(_, info)| info.pinned).collect()
    }

    /// Get files by tag
    pub fn files_by_tag(&self, tag: &str) -> Vec<(&String, &FileInfo)> {
        self.files
            .iter()
            .filter(|(_, info)| info.tags.contains(&tag.to_string()))
            .collect()
    }

    /// Merge with another manifest (for sync)
    pub fn merge(&mut self, other: &Manifest) {
        for (path, info) in &other.files {
            // Only add if not exists or if other is newer
            if !self.files.contains_key(path) {
                self.files.insert(path.clone(), info.clone());
            }
        }
    }

    /// Serialize to JSON
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Deserialize from JSON
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

impl Default for Manifest {
    fn default() -> Self {
        Self::new()
    }
}

impl FileInfo {
    /// Create a new file info
    pub fn new(display_name: &str) -> Self {
        Self {
            display_name: display_name.to_string(),
            tags: Vec::new(),
            pinned: false,
            locked: false,
            encrypted: false,
            sort_order: 0,
        }
    }

    /// Set tags
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    /// Set pinned status
    pub fn with_pinned(mut self, pinned: bool) -> Self {
        self.pinned = pinned;
        self
    }

    /// Set sort order
    pub fn with_sort_order(mut self, order: i32) -> Self {
        self.sort_order = order;
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_manifest_creation() {
        let manifest = Manifest::new();
        assert_eq!(manifest.version, 1);
        assert!(manifest.files.is_empty());
    }

    #[test]
    fn test_file_info() {
        let mut manifest = Manifest::new();
        let info = FileInfo::new("Budget 2024")
            .with_tags(vec!["finance".to_string()])
            .with_pinned(true);
        
        manifest.add_file("budget.numr", info);
        
        assert!(manifest.get_file("budget.numr").is_some());
        assert_eq!(manifest.pinned_files().len(), 1);
    }

    #[test]
    fn test_serialization() {
        let manifest = Manifest::new();
        let json = manifest.to_json().unwrap();
        let parsed = Manifest::from_json(&json).unwrap();
        assert_eq!(parsed.version, 1);
    }
}

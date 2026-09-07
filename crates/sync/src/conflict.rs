use crate::error::SyncError;

/// Conflict resolution strategies
#[derive(Debug, Clone, PartialEq)]
pub enum ConflictStrategy {
    /// Keep local version
    KeepLocal,
    /// Keep remote version
    KeepRemote,
    /// Keep both versions (rename one)
    KeepBoth,
    /// Manual resolution
    Manual,
}

/// Conflict resolver
pub struct ConflictResolver {
    strategy: ConflictStrategy,
}

impl ConflictResolver {
    /// Create a new conflict resolver
    pub fn new(strategy: ConflictStrategy) -> Self {
        Self { strategy }
    }

    /// Get the current strategy
    pub fn strategy(&self) -> &ConflictStrategy {
        &self.strategy
    }

    /// Set the strategy
    pub fn set_strategy(&mut self, strategy: ConflictStrategy) {
        self.strategy = strategy;
    }

    /// Resolve a conflict
    pub fn resolve(
        &self,
        path: &str,
        local_content: &[u8],
        remote_content: &[u8],
    ) -> Result<ConflictResolution, SyncError> {
        match self.strategy {
            ConflictStrategy::KeepLocal => Ok(ConflictResolution {
                resolved_path: path.to_string(),
                content: local_content.to_vec(),
                rename_original: false,
                conflict_path: None,
                conflict_content: None,
            }),
            ConflictStrategy::KeepRemote => Ok(ConflictResolution {
                resolved_path: path.to_string(),
                content: remote_content.to_vec(),
                rename_original: false,
                conflict_path: None,
                conflict_content: None,
            }),
            ConflictStrategy::KeepBoth => {
                let conflict_path = format!("{}.conflict.numr", path.trim_end_matches(".numr"));
                Ok(ConflictResolution {
                    resolved_path: path.to_string(),
                    content: local_content.to_vec(),
                    rename_original: true,
                    conflict_path: Some(conflict_path),
                    conflict_content: Some(remote_content.to_vec()),
                })
            }
            ConflictStrategy::Manual => Err(SyncError::Conflict(format!(
                "Manual resolution required for: {}",
                path
            ))),
        }
    }
}

/// Conflict resolution result
pub struct ConflictResolution {
    /// Path to write the resolved content
    pub resolved_path: String,
    /// Resolved content
    pub content: Vec<u8>,
    /// Whether to rename the original
    pub rename_original: bool,
    /// Path for the conflict copy (if keeping both)
    pub conflict_path: Option<String>,
    /// Content for the conflict copy
    pub conflict_content: Option<Vec<u8>>,
}

impl Default for ConflictResolver {
    fn default() -> Self {
        Self::new(ConflictStrategy::KeepBoth)
    }
}

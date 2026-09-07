use thiserror::Error;

/// Format error types
#[derive(Error, Debug)]
pub enum FormatError {
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Invalid manifest: {0}")]
    InvalidManifest(String),

    #[error("Invalid file format: {0}")]
    InvalidFormat(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Path error: {0}")]
    PathError(String),
}

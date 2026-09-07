use thiserror::Error;

/// Sync error types
#[derive(Error, Debug)]
pub enum SyncError {
    #[error("Network error: {0}")]
    NetworkError(#[from] reqwest::Error),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("HTTP error: {status} {message}")]
    HttpError { status: u16, message: String },

    #[error("Conflict detected: {0}")]
    Conflict(String),

    #[error("Authentication failed")]
    AuthError,

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Sync state error: {0}")]
    StateError(String),
}

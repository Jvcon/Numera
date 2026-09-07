use thiserror::Error;

/// Engine error types
#[derive(Error, Debug)]
pub enum EngineError {
    #[error("Evaluation error: {0}")]
    EvalError(String),

    #[error("Parse error: {0}")]
    ParseError(String),

    #[error("Reference error: {0}")]
    ReferenceError(String),

    #[error("Date/time error: {0}")]
    DateTimeError(String),

    #[error("File not found: {0}")]
    FileNotFound(String),

    #[error("Circular reference detected: {0}")]
    CircularReference(String),

    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    JsonError(#[from] serde_json::Error),

    #[error("Core engine error: {0}")]
    CoreError(String),
}

impl From<numr_core::EvalError> for EngineError {
    fn from(err: numr_core::EvalError) -> Self {
        EngineError::EvalError(err.to_string())
    }
}

impl From<numr_core::ParseError> for EngineError {
    fn from(err: numr_core::ParseError) -> Self {
        EngineError::ParseError(err.to_string())
    }
}

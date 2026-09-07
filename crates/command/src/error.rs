//! Error type for the command crate (spec §7).

use crate::scope::{Mode, Platform};
use thiserror::Error;

/// Errors produced across the command layer (spec §7).
///
/// Convention (spec §7 / §2): payloads are owned plain data, no `#[from]`
/// conversions (this crate has no IO/serde sources of error yet).
#[derive(Error, Debug)]
pub enum CommandError {
    #[error("Unknown command id: {0}")]
    UnknownCommand(String),

    #[error("Duplicate command id: {0}")]
    DuplicateId(String),

    #[error("Keybinding parse error: {0}")]
    KeybindingParseError(String),

    #[error("Command '{0}' not available on platform {1:?}")]
    PlatformMismatch(String, Platform),

    #[error("Command '{0}' not available in mode {1:?}")]
    ModeMismatch(String, Mode),

    #[error("Handler error: {0}")]
    HandlerError(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_text_is_stable() {
        assert_eq!(
            CommandError::UnknownCommand("nope".to_string()).to_string(),
            "Unknown command id: nope"
        );
        assert_eq!(
            CommandError::DuplicateId("file.save".to_string()).to_string(),
            "Duplicate command id: file.save"
        );
        assert_eq!(
            CommandError::KeybindingParseError("bad key".to_string()).to_string(),
            "Keybinding parse error: bad key"
        );
        assert_eq!(
            CommandError::PlatformMismatch("file.save".to_string(), Platform::Android).to_string(),
            "Command 'file.save' not available on platform Android"
        );
        assert_eq!(
            CommandError::ModeMismatch("vim.insert".to_string(), Mode::Insert).to_string(),
            "Command 'vim.insert' not available in mode Insert"
        );
        assert_eq!(
            CommandError::HandlerError("boom".to_string()).to_string(),
            "Handler error: boom"
        );
    }
}
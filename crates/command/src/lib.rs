//! Numera Command — command registry, keybinding, and dispatcher layer.
//!
//! This crate separates "what the user can do" from the UI as pure data +
//! pure logic (spec §1): the same commands work across Web / TUI / Android,
//! the Web keymap maps onto the TUI, and the command palette can be fed
//! directly from this crate.
//!
//! Dependency boundary: this crate is a leaf — it depends only on
//! `thiserror` + `serde_json` (spec §1.3). `numera-engine` and `numera-format`
//! implement the `EngineAccess` / `WorkspaceAccess` traits defined here
//! (M4, `context.rs`).
//!
//! Current milestones implemented: M1 (core types: `scope`, `key`,
//! `keybinding`, `command`, `error`), M2 (`registry`, `macros`, `builtins`)
//! and M3 (`matcher`). M4 (`context` + `dispatch`) comes in a subsequent
//! task and is intentionally absent.

pub mod scope;
pub mod key;
pub mod keybinding;
pub mod command;
pub mod error;
pub mod registry;
pub mod macros;
pub mod builtins;
pub mod matcher;

// Re-exports for host crates — the minimal set needed today (spec §2).
// `Ctx`, `Focus`, `Services`, `Notification` (context.rs) are added in M4.
pub use command::{Command, CommandFn, CommandOutcome};
pub use error::CommandError;
pub use key::{Key, KeyEvent, Modifiers};
pub use keybinding::{KeyChord, Keybinding};
pub use matcher::{KeyMatcher, KeyMatcherResult};
pub use registry::CommandRegistry;
pub use scope::{Mode, Platform, Scope};
// `command!` is `#[macro_export]`-ed in `macros.rs`, so it is already exported
// from the crate root as `numera_command::command!` (spec §3.6).
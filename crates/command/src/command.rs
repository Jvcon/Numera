//! Command model: `Command`, `CommandFn`, `CommandOutcome`, `Focus` (spec §3.5).

use crate::error::CommandError;
use crate::keybinding::Keybinding;
use crate::scope::{Mode, Platform, Scope};

/// Placeholder command context (spec §3.7 `Ctx`).
///
/// M4 (`context.rs`) will replace this with the real context carrying
/// `registry`, `platform`, `mode`, `focus`, `engine`, `workspace`, and
/// `services`. Until then, handlers are no-op stubs that ignore it.
///
/// TODO(M4): move to `context.rs` per spec §2/§3.7 and re-export from `lib.rs`.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ctx;

/// Command handler signature (spec §3.5): synchronous, short, re-entrant.
///
/// Long-running work is delegated via `ctx.services.spawn(...)` and the
/// handler returns immediately.
pub type CommandFn = fn(&mut Ctx) -> Result<CommandOutcome, CommandError>;

/// Result of executing a command (spec §3.5). Outcome handling is the host's
/// job (spec §6).
#[derive(Debug, Clone)]
pub enum CommandOutcome {
    /// Nothing to do — success marker only.
    None,
    /// Status message (command palette toast etc.).
    Message(String),
    /// Open a file (by ID or path).
    Open(String),
    /// Close the current UI surface (panel/dialog).
    Close,
    /// Move focus to an area.
    Focus(Focus),
    /// Extension point: host-recognized custom result.
    Custom(&'static str, serde_json::Value),
}

/// Focusable UI regions (spec §3.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Focus {
    Editor,
    Palette,
    Sidebar,
    StatusBar,
}

/// A command (spec §3.5).
///
/// Registration is static: `handler` is a `fn` pointer, not a closure, which
/// keeps `Command: 'static` and `Copy`. `Copy` is required so that
/// `register(cmd: Command)` takes the command by value while the originating
/// `static`/expression can still be reused.
#[derive(Debug, Clone, Copy)]
pub struct Command {
    /// Dot-separated id, e.g. `"file.save"`.
    pub id: &'static str,
    /// Human-readable label, e.g. `"Save File"`.
    pub label: &'static str,
    /// Tooltip / palette description.
    pub description: Option<&'static str>,
    /// Grouping category, e.g. `"File"`, `"Edit"`, `"View"`.
    pub category: Option<&'static str>,
    /// Global vs editor-only (spec §3.1).
    pub scope: Scope,
    /// Platforms the command is available on.
    pub platforms: &'static [Platform],
    /// Modes the command is active in — usually `[Mode::Any]`.
    pub modes: &'static [Mode],
    /// 0..N keybindings; supports multiple keybindings per command
    /// (e.g. Ctrl+S and Cmd+S).
    pub keybindings: &'static [Keybinding],
    /// The handler executed by `execute` (spec §6).
    pub handler: CommandFn,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::key::{Key, Modifiers};

    fn noop_handler(_ctx: &mut Ctx) -> Result<CommandOutcome, CommandError> {
        Ok(CommandOutcome::None)
    }

    #[test]
    fn command_macro_produces_expected_fields() {
        let cmd = crate::command!(
            id: "file.save",
            label: "Save File",
            description: "Write current document to storage",
            category: "File",
            scope: Global,
            platforms: [Web, Tui, Android],
            modes: [Any],
            key: "ctrl+s",
            handler: noop_handler
        );

        assert_eq!(cmd.id, "file.save");
        assert_eq!(cmd.label, "Save File");
        assert_eq!(cmd.description, Some("Write current document to storage"));
        assert_eq!(cmd.category, Some("File"));
        assert_eq!(cmd.scope, Scope::Global);
        assert_eq!(
            cmd.platforms,
            &[Platform::Web, Platform::Tui, Platform::Android]
        );
        assert_eq!(cmd.modes, &[Mode::Any]);
        assert_eq!(cmd.keybindings.len(), 1);
        assert_eq!(cmd.keybindings[0].when, None);
        assert_eq!(cmd.keybindings[0].chord.0.len(), 1);
        assert_eq!(cmd.keybindings[0].chord.0[0].mods, Modifiers::CTRL);
        assert_eq!(cmd.keybindings[0].chord.0[0].key, Key::Char('s'));

        let mut ctx = Ctx;
        match (cmd.handler)(&mut ctx).expect("handler should not error") {
            CommandOutcome::None => {}
            other => panic!("expected CommandOutcome::None, got {other:?}"),
        }
    }

    #[test]
    fn command_macro_multiple_keybindings_union() {
        // Two keybindings for one command (spec §3.5: 0..N keybindings).
        let cmd = crate::command!(
            id: "editor.find",
            label: "Find",
            scope: Editor,
            platforms: [Web, Tui],
            modes: [Normal, Visual],
            keys: ["ctrl+f", "f3"],
            handler: noop_handler
        );
        assert_eq!(cmd.keybindings.len(), 2);
        assert_eq!(cmd.keybindings[0].chord.0.len(), 1);
        assert_eq!(cmd.keybindings[1].chord.0[0].key, Key::F(3));
    }

    #[test]
    fn command_outcome_variants_construct() {
        let _ = CommandOutcome::None;
        let _ = CommandOutcome::Message("hi".to_string());
        let _ = CommandOutcome::Open("/tmp/a.numr".to_string());
        let _ = CommandOutcome::Close;
        let _ = CommandOutcome::Focus(Focus::Palette);
        let _ = CommandOutcome::Custom("palette.show", serde_json::json!({}));
    }

    #[test]
    fn command_is_copy() {
        let cmd = crate::command!(
            id: "copy.test",
            label: "Copy Test",
            key: "x",
            handler: noop_handler
        );
        let copy = cmd; // Command: Copy
        assert_eq!(copy.id, cmd.id);
    }
}
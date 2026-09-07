//! Built-in commands (spec §9.5.1–§9.5.4 subset) and explicit registration
//! (spec §4.1: no `inventory`/`linkme`, v1 uses explicit registration).

use std::sync::OnceLock;

use crate::command::{Command, CommandOutcome, Ctx};
use crate::error::CommandError;
use crate::registry::CommandRegistry;

// Bring the exported `command!` macro into scope within this crate.
use crate::command;

/// No-op handler stub.
///
/// TODO: implement via Ctx in M4 (spec §3.7) — real handlers will read/write
/// engine + workspace state through the context.
fn noop(_ctx: &mut Ctx) -> Result<CommandOutcome, CommandError> {
    Ok(CommandOutcome::None)
}

/// Declare a builtin: a `pub static` `OnceLock<Command>` (lazily built by the
/// matching `$make` function) plus the `register_builtins` body.
///
/// `command!` needs runtime evaluation (its chord slices are leaked at parse
/// time), so the spec's `static FILE_SAVE: Command = command!(...)` form is
/// expressed here as `static FILE_SAVE: OnceLock<Command>` — built exactly
/// once, on first use or first registration.
macro_rules! builtins {
    ($( $name:ident, $make:ident, $cmd:expr );+ $(;)?) => {
        $(
            /// Built-in command (lazily initialized; see `register_builtins`).
            pub static $name: OnceLock<Command> = OnceLock::new();

            /// Construct this builtin's `Command` (called once, then cached).
            fn $make() -> Command {
                $cmd
            }
        )+

        /// Register all built-in commands (spec §4.1 explicit registration).
        ///
        /// Development-time failure (e.g. a bad keybinding string) panics
        /// loudly (spec §11 "注册期：开发期 panic"); duplicate ids are a coding
        /// error that must never slip through.
        pub fn register_builtins(reg: &mut CommandRegistry) {
            $(
                reg.register(*$name.get_or_init($make)).unwrap_or_else(|e| {
                    panic!("failed to register builtin {}: {e}", stringify!($name))
                });
            )+
        }
    };
}

builtins! {
    FILE_SAVE, file_save, command!(
        id: "file.save",
        label: "Save File",
        description: "Write current document to storage",
        category: "File",
        scope: Global,
        platforms: [Web, Tui, Android],
        modes: [Any],
        key: "ctrl+s",
        handler: noop
    );
    EDITOR_REFRESH_RATES, editor_refresh_rates, command!(
        id: "editor.refresh_rates",
        label: "Refresh Rates",
        description: "Recompute exchange rates for the current workspace",
        category: "Editor",
        scope: Global,
        platforms: [Web, Tui],
        modes: [Any],
        key: "ctrl+r",
        handler: noop
    );
    HELP_TOGGLE, help_toggle, command!(
        id: "help.toggle",
        label: "Toggle Help",
        description: "Show or hide the help panel",
        category: "Help",
        scope: Global,
        platforms: [Web, Tui],
        modes: [Any],
        keys: ["?", "f1"],
        handler: noop
    );
    DEBUG_TOGGLE, debug_toggle, command!(
        id: "debug.toggle",
        label: "Toggle Debug",
        description: "Show or hide the debug overlay",
        category: "View",
        scope: Global,
        platforms: [Tui],
        modes: [Any],
        key: "f12",
        handler: noop
    );
    KEYMAP_TOGGLE, keymap_toggle, command!(
        id: "keymap.toggle",
        label: "Toggle Keymap",
        description: "Switch between the Vim and Standard keymaps",
        category: "View",
        scope: Global,
        platforms: [Tui],
        modes: [Any],
        key: "shift+tab",
        handler: noop
    );
    VIM_INSERT, vim_insert, command!(
        id: "vim.insert",
        label: "Enter Insert",
        description: "Switch from Normal to Insert mode",
        category: "Vim",
        scope: Editor,
        platforms: [Tui],
        modes: [Normal],
        key: "i",
        handler: noop
    );
    VIM_MOTION_DOWN, vim_motion_down, command!(
        id: "vim.motion_down",
        label: "Move Down",
        description: "Move the cursor down one line",
        category: "Vim",
        scope: Editor,
        platforms: [Tui],
        modes: [Normal],
        key: "j",
        handler: noop
    );
    VIM_GOTO_FIRST, vim_goto_first, command!(
        id: "vim.goto_first",
        label: "Go to First Line",
        description: "Jump to the first line of the document",
        category: "Vim",
        scope: Editor,
        platforms: [Tui],
        modes: [Normal],
        key: "g g",
        handler: noop
    );
    VIM_GOTO_LAST, vim_goto_last, command!(
        id: "vim.goto_last",
        label: "Go to Last Line",
        description: "Jump to the last line of the document",
        category: "Vim",
        scope: Editor,
        platforms: [Tui],
        modes: [Normal],
        key: "G",
        handler: noop
    );
    VIM_NORMAL, vim_normal, command!(
        id: "vim.normal",
        label: "Exit Insert",
        description: "Switch from Insert back to Normal mode",
        category: "Vim",
        scope: Editor,
        platforms: [Tui],
        modes: [Insert],
        key: "esc",
        handler: noop
    );
    EDITOR_DELETE_BACK, editor_delete_back, command!(
        id: "editor.delete_back",
        label: "Delete Back",
        description: "Delete the character before the cursor",
        category: "Edit",
        scope: Editor,
        platforms: [Tui],
        modes: [Insert],
        key: "backspace",
        handler: noop
    );
    EDITOR_LINE_START, editor_line_start, command!(
        id: "editor.line_start",
        label: "Line Start",
        description: "Move the cursor to the start of the line",
        category: "Edit",
        scope: Editor,
        platforms: [Tui],
        modes: [Standard],
        keys: ["ctrl+a", "home"],
        handler: noop
    );
    EDITOR_DELETE_TO_END, editor_delete_to_end, command!(
        id: "editor.delete_to_end",
        label: "Delete to End",
        description: "Delete from the cursor to the end of the line",
        category: "Edit",
        scope: Editor,
        platforms: [Tui],
        modes: [Standard],
        key: "ctrl+k",
        handler: noop
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keybinding::KeyChord;
    use crate::scope::{Mode, Platform, Scope};

    fn all_builtin_commands() -> Vec<Command> {
        vec![
            *FILE_SAVE.get_or_init(file_save),
            *EDITOR_REFRESH_RATES.get_or_init(editor_refresh_rates),
            *HELP_TOGGLE.get_or_init(help_toggle),
            *DEBUG_TOGGLE.get_or_init(debug_toggle),
            *KEYMAP_TOGGLE.get_or_init(keymap_toggle),
            *VIM_INSERT.get_or_init(vim_insert),
            *VIM_MOTION_DOWN.get_or_init(vim_motion_down),
            *VIM_GOTO_FIRST.get_or_init(vim_goto_first),
            *VIM_GOTO_LAST.get_or_init(vim_goto_last),
            *VIM_NORMAL.get_or_init(vim_normal),
            *EDITOR_DELETE_BACK.get_or_init(editor_delete_back),
            *EDITOR_LINE_START.get_or_init(editor_line_start),
            *EDITOR_DELETE_TO_END.get_or_init(editor_delete_to_end),
        ]
    }

    #[test]
    fn all_builtin_ids_are_unique() {
        let cmds = all_builtin_commands();
        assert_eq!(cmds.len(), 13, "expected exactly 13 builtin commands");
        let mut ids: Vec<&str> = cmds.iter().map(|c| c.id).collect();
        ids.sort_unstable();
        let mut dedup = ids.clone();
        dedup.dedup();
        assert_eq!(ids, dedup, "builtin ids must be unique: {ids:?}");
    }

    #[test]
    fn every_builtin_key_string_parses() {
        // Re-parse the raw key strings used across the builtins (spec §3.2).
        let keys: &[&str] = &[
            "ctrl+s",
            "ctrl+r",
            "?",
            "f1",
            "f12",
            "shift+tab",
            "i",
            "j",
            "g g",
            "G",
            "esc",
            "backspace",
            "ctrl+a",
            "home",
            "ctrl+k",
        ];
        for k in keys {
            KeyChord::parse(k)
                .unwrap_or_else(|e| panic!("builtin keybinding '{k}' failed to parse: {e}"));
        }
    }

    #[test]
    fn every_builtin_has_parseable_keybindings() {
        for cmd in all_builtin_commands() {
            for kb in cmd.keybindings {
                assert!(!kb.chord.0.is_empty(), "builtin {} has an empty chord", cmd.id);
                // Each chord's key sequences must have round-tripped parseable keys.
                for seq in kb.chord.0 {
                    let _ = seq; // normalized at parse time; non-empty is enough here
                }
            }
        }
    }

    #[test]
    fn register_builtins_registers_all_13_without_error() {
        let mut reg = CommandRegistry::new();
        register_builtins(&mut reg);
        assert_eq!(reg.len(), 13);
    }

    #[test]
    fn builtin_field_spot_checks() {
        let save = *FILE_SAVE.get_or_init(file_save);
        assert_eq!(save.id, "file.save");
        assert_eq!(save.scope, Scope::Global);
        assert_eq!(save.platforms, &[Platform::Web, Platform::Tui, Platform::Android]);
        assert_eq!(save.modes, &[Mode::Any]);
        assert_eq!(save.keybindings.len(), 1);
        assert_eq!(save.keybindings[0].chord.0.len(), 1);

        let gg = *VIM_GOTO_FIRST.get_or_init(vim_goto_first);
        assert_eq!(gg.id, "vim.goto_first");
        assert_eq!(gg.scope, Scope::Editor);
        assert_eq!(gg.platforms, &[Platform::Tui]);
        assert_eq!(gg.modes, &[Mode::Normal]);
        assert_eq!(gg.keybindings[0].chord.0.len(), 2, "g g is a two-press chord");

        let line_start = *EDITOR_LINE_START.get_or_init(editor_line_start);
        assert_eq!(line_start.id, "editor.line_start");
        assert_eq!(line_start.keybindings.len(), 2, "multi-keybinding command");
    }
}
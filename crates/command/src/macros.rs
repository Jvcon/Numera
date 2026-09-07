//! The `command!` declaration macro (spec §3.6).

// ---------------------------------------------------------------------------
// Hidden helper macros used by `command!` to fill in defaults when optional
// fields are omitted. They are `#[macro_export]`-ed because `command!` is
// expanded in downstream crates and references them through `$crate::`.
// ---------------------------------------------------------------------------

/// `scope:` default → `Scope::Global` (spec §3.1; §9.5 examples).
#[doc(hidden)]
#[macro_export]
macro_rules! __command_scope {
    () => {
        $crate::scope::Scope::Global
    };
    ($s:ident) => {
        $crate::scope::Scope::$s
    };
}

/// `platforms:` default → every platform (spec §3.6; omission means "no
/// restriction").
#[doc(hidden)]
#[macro_export]
macro_rules! __command_platforms {
    () => {
        &[
            $crate::scope::Platform::Web,
            $crate::scope::Platform::Tui,
            $crate::scope::Platform::Android,
            $crate::scope::Platform::Desktop,
        ]
    };
    ([$($p:ident),*]) => {
        &[$($crate::scope::Platform::$p),*]
    };
}

/// `modes:` default → `[Mode::Any]` (spec §3.1: Any is the default mode).
#[doc(hidden)]
#[macro_export]
macro_rules! __command_modes {
    () => {
        &[$crate::scope::Mode::Any]
    };
    ([$($m:ident),*]) => {
        &[$($crate::scope::Mode::$m),*]
    };
}

/// `description:` / `category:` default → `None`.
#[doc(hidden)]
#[macro_export]
macro_rules! __command_opt_lit {
    () => {
        None
    };
    ($v:literal) => {
        Some($v)
    };
}

/// `handler:` default → a no-op handler returning `CommandOutcome::None`.
#[doc(hidden)]
#[macro_export]
macro_rules! __command_handler {
    () => {
        |_ctx: &mut $crate::command::Ctx| Ok($crate::command::CommandOutcome::None)
    };
    ($h:path) => {
        $h
    };
}

/// Define a command with a terse syntax (spec §3.6).
///
/// ```ignore
/// pub static FILE_SAVE: Command = command!(
///     id: "file.save",
///     label: "Save File",
///     description: "Write current document to storage",
///     category: "File",
///     scope: Global,
///     platforms: [Web, Tui, Android],
///     modes: [Any],
///     key: "ctrl+s",
///     handler: cmd_file_save
/// );
/// ```
///
/// Supported fields:
/// - `id: <literal>` (required)
/// - `label: <literal>` (required)
/// - `description: <literal>` (optional)
/// - `category: <literal>` (optional)
/// - `scope: Global | Editor` (optional, default `Global`)
/// - `platforms: [Web, Tui, ...]` (optional, default all four)
/// - `modes: [Any, Normal, ...]` (optional, default `[Any]`)
/// - `key: <literal>` / `keys: [<literal>, ...]` (optional; union when both
///   are given; an empty set produces a palette-only command)
/// - `handler: <path>` (optional, default no-op)
///
/// Note: the key strings are parsed at runtime by `KeyChord::parse` (the
/// backing `&'static [KeySeq]` is allocated once and leaked), so `command!`
/// must be evaluated at runtime — it is an expression, not a `const`. Use it
/// in a function body or inside `register(...)`; a top-level
/// `static X: Command = command!(...)` is not supported on stable Rust 1.75.
#[macro_export]
macro_rules! command {
    (
        id: $id:literal,
        label: $label:literal
        $(, description: $desc:literal)?
        $(, category: $cat:literal)?
        $(, scope: $scope:ident)?
        $(, platforms: [ $($plat:ident),* ])?
        $(, modes: [ $($mode:ident),* ])?
        $(, key: $key:literal)?
        $(, keys: [ $($k:literal),* ])?
        $(, handler: $handler:path)?
    ) => {{
        $crate::command::Command {
            id: $id,
            label: $label,
            description: $crate::__command_opt_lit!($($desc)?),
            category: $crate::__command_opt_lit!($($cat)?),
            scope: $crate::__command_scope!($($scope)?),
            platforms: $crate::__command_platforms!($([$($plat),*])?),
            modes: $crate::__command_modes!($([$($mode),*])?),
            keybindings: $crate::keybinding::from_key_strings(&[
                $( $key, )?
                $( $($k),* )?
            ]),
            handler: $crate::__command_handler!($($handler)?),
        }
    }};
}

#[cfg(test)]
mod tests {
    use crate::command::{Command, CommandOutcome, Ctx};
    use crate::error::CommandError;
    use crate::scope::{Mode, Platform, Scope};

    fn noop(_ctx: &mut Ctx) -> Result<CommandOutcome, CommandError> {
        Ok(CommandOutcome::None)
    }

    #[test]
    fn full_field_invocation() {
        let cmd: Command = command!(
            id: "editor.find",
            label: "Find",
            description: "Search current buffer",
            category: "Edit",
            scope: Editor,
            platforms: [Web, Tui],
            modes: [Normal, Visual],
            keys: ["ctrl+f", "f3"],
            handler: noop
        );
        assert_eq!(cmd.id, "editor.find");
        assert_eq!(cmd.label, "Find");
        assert_eq!(cmd.description, Some("Search current buffer"));
        assert_eq!(cmd.category, Some("Edit"));
        assert_eq!(cmd.scope, Scope::Editor);
        assert_eq!(cmd.platforms, &[Platform::Web, Platform::Tui]);
        assert_eq!(cmd.modes, &[Mode::Normal, Mode::Visual]);
        assert_eq!(cmd.keybindings.len(), 2);
        assert_eq!(cmd.keybindings[0].chord.0.len(), 1);
        assert_eq!(cmd.keybindings[1].chord.0[0].key, crate::key::Key::F(3));
    }

    #[test]
    fn minimal_invocation_applies_defaults() {
        let cmd: Command = command!(
            id: "app.quit",
            label: "Quit",
            key: "ctrl+q",
            handler: noop
        );
        assert_eq!(cmd.id, "app.quit");
        assert_eq!(cmd.label, "Quit");
        assert_eq!(cmd.description, None);
        assert_eq!(cmd.category, None);
        assert_eq!(cmd.scope, Scope::Global);
        assert_eq!(
            cmd.platforms,
            &[
                Platform::Web,
                Platform::Tui,
                Platform::Android,
                Platform::Desktop,
            ]
        );
        assert_eq!(cmd.modes, &[Mode::Any]);
        assert_eq!(cmd.keybindings.len(), 1);
        assert_eq!(cmd.keybindings[0].chord.0[0].mods, crate::key::Modifiers::CTRL);
        assert_eq!(cmd.keybindings[0].chord.0[0].key, crate::key::Key::Char('q'));
    }

    #[test]
    fn default_handler_is_noop() {
        let cmd: Command = command!(
            id: "test.noop",
            label: "Noop",
            key: "x"
        );
        let mut ctx = Ctx;
        match (cmd.handler)(&mut ctx).expect("noop handler should succeed") {
            CommandOutcome::None => {}
            other => panic!("expected CommandOutcome::None, got {other:?}"),
        }
    }

    #[test]
    fn key_and_keys_union() {
        // `key` + `keys` are both accepted and combined (spec §3.6).
        let cmd: Command = command!(
            id: "editor.line_start",
            label: "Line Start",
            scope: Editor,
            platforms: [Tui],
            modes: [Standard],
            key: "ctrl+a",
            keys: ["home"],
            handler: noop
        );
        assert_eq!(cmd.keybindings.len(), 2);
    }

    #[test]
    fn no_keybinding_is_palette_only() {
        let cmd: Command = command!(
            id: "palette.only",
            label: "Palette Only",
            handler: noop
        );
        assert_eq!(cmd.keybindings.len(), 0);
    }
}
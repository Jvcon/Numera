//! Scope, platform, and editor-mode enums (spec §3.1).

/// Scope of a command.
///
/// - `Global`: cross-platform, cross-editor behavior (`file.save`, `palette.toggle`)
/// - `Editor`: only valid inside the editor (`editor.find`, `vim.*`, `editor.gotoLine`)
///
/// Hosts decide *what to load* at registration time (e.g. Android only registers
/// `Scope::Global` commands), so scope does **not** participate in the
/// `CommandRegistry::list` query filter (spec §3.1 "关键决策").
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Scope {
    Global,
    Editor,
}

/// Platforms a command supports (spec §3.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Platform {
    Web,
    Tui,
    Android,
    Desktop,
}

/// Editor mode (spec §3.1).
///
/// - `Any`: mode-independent (default; active in every keymap)
/// - `Normal` / `Insert` / `Visual` / `Command`: Vim modes
/// - `Standard`: non-modal standard editing keymap (mutually exclusive with Vim)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Mode {
    Any,
    Normal,
    Insert,
    Visual,
    Command,
    Standard,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn enums_derive_eq_copy_hash() {
        // Eq
        assert_eq!(Scope::Global, Scope::Global);
        assert_ne!(Scope::Global, Scope::Editor);
        assert_eq!(Platform::Tui, Platform::Tui);
        assert_ne!(Platform::Tui, Platform::Desktop);
        assert_eq!(Mode::Any, Mode::Any);
        assert_ne!(Mode::Normal, Mode::Insert);

        // Copy (use-after-copy keeps the value)
        let m = Mode::Normal;
        let m2 = m;
        assert_eq!(m, m2);

        // Hash
        let mut platforms = HashSet::new();
        platforms.insert(Platform::Tui);
        assert!(platforms.contains(&Platform::Tui));
        assert!(!platforms.contains(&Platform::Web));

        let mut modes = HashSet::new();
        modes.insert(Mode::Insert);
        assert!(modes.contains(&Mode::Insert));
        assert!(!modes.contains(&Mode::Normal));

        let mut scopes = HashSet::new();
        scopes.insert(Scope::Editor);
        assert!(scopes.contains(&Scope::Editor));
        assert!(!scopes.contains(&Scope::Global));
    }

    #[test]
    fn mode_any_is_default_usage() {
        // Mode::Any is the default mode; commands opt out by listing specific modes.
        let default_modes: &[Mode] = &[Mode::Any];
        assert!(default_modes.contains(&Mode::Any));
        // A command tagged only [Any] stays visible in any concrete mode query
        // (the registry filter is exercised in registry.rs).
        assert!(!default_modes.contains(&Mode::Normal));
    }
}
//! Command registry (spec §4).

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::command::Command;
use crate::error::CommandError;
use crate::scope::{Mode, Platform};

/// Registry of all commands (spec §4).
///
/// **Key invariants:**
/// - No platform/mode filtering happens at registration time — every command
///   goes into the table; filtering happens at query time (`list`).
/// - A duplicate id is rejected (`DuplicateId`).
/// - A duplicate `(platform, mode, chord)` is *not* an error — it is logged by
///   the host (spec §4 "关键不变量").
///
/// The `by_category` index feeds the command palette's alphabetically sorted
/// grouping (spec §12); it is written at registration and consumed by the
/// palette (wasm binding, M5).
pub struct CommandRegistry {
    by_id: HashMap<&'static str, Command>,
    by_category: BTreeMap<Option<&'static str>, Vec<&'static str>>,
}

impl CommandRegistry {
    /// Create an empty registry (spec §4).
    pub fn new() -> Self {
        Self {
            by_id: HashMap::new(),
            by_category: BTreeMap::new(),
        }
    }

    /// Register a single command. A duplicate id returns `DuplicateId` (spec §4).
    pub fn register(&mut self, cmd: Command) -> Result<(), CommandError> {
        if self.by_id.contains_key(cmd.id) {
            return Err(CommandError::DuplicateId(cmd.id.to_string()));
        }
        let id = cmd.id;
        self.by_id.insert(id, cmd);
        self.by_category.entry(cmd.category).or_default().push(id);
        Ok(())
    }

    /// Register many commands atomically: if any id duplicates (within the
    /// batch or against the registry), nothing is registered (spec §4).
    pub fn register_all<'a, I>(&mut self, cmds: I) -> Result<(), CommandError>
    where
        I: IntoIterator<Item = &'a Command>,
    {
        let cmds: Vec<&Command> = cmds.into_iter().collect();

        // Pre-validate the whole batch so a failure rolls back cleanly.
        let mut seen: HashSet<&'static str> = HashSet::new();
        for c in &cmds {
            if self.by_id.contains_key(c.id) || !seen.insert(c.id) {
                return Err(CommandError::DuplicateId(c.id.to_string()));
            }
        }

        for c in cmds {
            let cmd = *c;
            let id = cmd.id;
            self.by_id.insert(id, cmd);
            self.by_category.entry(cmd.category).or_default().push(id);
        }
        Ok(())
    }

    /// Look up a command by id (spec §4).
    pub fn get(&self, id: &str) -> Option<&Command> {
        self.by_id.get(id)
    }

    /// List commands visible for a `(platform, mode)` pair — the data the
    /// command palette needs (spec §4).
    ///
    /// Filtering: `cmd.platforms.contains(&platform)` **and**
    /// (`cmd.modes.contains(&mode)` or `cmd.modes.contains(&Mode::Any)`).
    /// Scope does not participate — loading decisions are made at
    /// registration time (spec §3.1).
    pub fn list(&self, platform: Platform, mode: Mode) -> Vec<&Command> {
        self.by_id
            .values()
            .filter(|cmd| {
                cmd.platforms.contains(&platform)
                    && (cmd.modes.contains(&mode) || cmd.modes.contains(&Mode::Any))
            })
            .collect()
    }

    /// Number of registered commands (spec §4).
    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    /// True when no commands are registered.
    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }
}

impl Default for CommandRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::{Command, CommandOutcome, Ctx};
    use crate::error::CommandError;
    use crate::scope::{Mode, Platform, Scope};

    fn noop(_ctx: &mut Ctx) -> Result<CommandOutcome, CommandError> {
        Ok(CommandOutcome::None)
    }

    fn make_cmd(
        id: &'static str,
        scope: Scope,
        platforms: &'static [Platform],
        modes: &'static [Mode],
    ) -> Command {
        Command {
            id,
            label: id,
            description: None,
            category: None,
            scope,
            platforms,
            modes,
            keybindings: &[],
            handler: noop,
        }
    }

    #[test]
    fn register_succeeds_then_duplicate_is_rejected() {
        let mut reg = CommandRegistry::new();
        reg.register(make_cmd("file.save", Scope::Global, &[Platform::Tui], &[Mode::Any]))
            .expect("first registration should succeed");
        assert_eq!(reg.len(), 1);

        let err = reg
            .register(make_cmd("file.save", Scope::Global, &[Platform::Tui], &[Mode::Any]))
            .expect_err("duplicate registration must fail");
        match err {
            CommandError::DuplicateId(id) => assert_eq!(id, "file.save"),
            other => panic!("expected DuplicateId, got {other:?}"),
        }
        assert_eq!(reg.len(), 1, "failed register must not insert");
    }

    #[test]
    fn register_all_rolls_back_on_error() {
        let mut reg = CommandRegistry::new();
        let a = make_cmd("cmd.a", Scope::Global, &[Platform::Tui], &[Mode::Any]);
        let b = make_cmd("cmd.b", Scope::Global, &[Platform::Tui], &[Mode::Any]);
        reg.register_all(&[a, b]).expect("fresh batch should register");
        assert_eq!(reg.len(), 2);

        // Duplicate within the batch → nothing new is registered.
        let c = make_cmd("cmd.c", Scope::Global, &[Platform::Tui], &[Mode::Any]);
        assert!(reg.register_all(&[a, c]).is_err());
        assert_eq!(reg.len(), 2);
        assert!(reg.get("cmd.c").is_none());

        // Duplicate against the existing registry → nothing new is registered.
        let d = make_cmd("cmd.d", Scope::Global, &[Platform::Tui], &[Mode::Any]);
        assert!(reg.register_all(&[b, d]).is_err());
        assert_eq!(reg.len(), 2);
        assert!(reg.get("cmd.d").is_none());
    }

    #[test]
    fn list_filters_by_platform_and_mode() {
        let mut reg = CommandRegistry::new();
        reg.register(make_cmd("vim.insert", Scope::Editor, &[Platform::Tui], &[Mode::Normal]))
            .unwrap();
        reg.register(make_cmd("file.save", Scope::Global, &[Platform::Tui], &[Mode::Any]))
            .unwrap();
        reg.register(make_cmd("vim.normal", Scope::Editor, &[Platform::Tui], &[Mode::Insert]))
            .unwrap();
        reg.register(make_cmd("editor.refresh", Scope::Global, &[Platform::Web], &[Mode::Any]))
            .unwrap();
        reg.register(make_cmd("help.toggle", Scope::Global, &[Platform::Android], &[Mode::Any]))
            .unwrap();

        // Tui × Normal → only commands tagged [Tui] AND ([Normal] or [Any]).
        let tui_normal: Vec<&str> = reg
            .list(Platform::Tui, Mode::Normal)
            .iter()
            .map(|c| c.id)
            .collect();
        assert!(tui_normal.contains(&"vim.insert"));
        assert!(tui_normal.contains(&"file.save"));
        assert!(!tui_normal.contains(&"vim.normal"), "Insert-mode command visible in Normal");
        assert!(!tui_normal.contains(&"editor.refresh"), "Web-only command visible in Tui");

        // Android × Any → only commands tagged [Android] AND [Any].
        let android_any: Vec<&str> = reg
            .list(Platform::Android, Mode::Any)
            .iter()
            .map(|c| c.id)
            .collect();
        assert!(android_any.contains(&"help.toggle"));
        assert!(!android_any.contains(&"vim.insert"));
        assert!(!android_any.contains(&"file.save"));
        assert!(!android_any.contains(&"editor.refresh"));
    }

    #[test]
    fn get_returns_some_or_none() {
        let mut reg = CommandRegistry::new();
        reg.register(make_cmd("file.save", Scope::Global, &[Platform::Tui], &[Mode::Any]))
            .unwrap();
        assert!(reg.get("file.save").is_some());
        assert_eq!(reg.get("file.save").unwrap().id, "file.save");
        assert!(reg.get("missing.id").is_none());
    }

    #[test]
    fn len_tracks_registered_commands() {
        let mut reg = CommandRegistry::new();
        assert_eq!(reg.len(), 0);
        reg.register(make_cmd("cmd.a", Scope::Global, &[Platform::Tui], &[Mode::Any]))
            .unwrap();
        reg.register(make_cmd("cmd.b", Scope::Global, &[Platform::Tui], &[Mode::Any]))
            .unwrap();
        assert_eq!(reg.len(), 2);
    }

    #[test]
    fn by_category_index_groups_command_ids() {
        let mut reg = CommandRegistry::new();
        let a = Command {
            id: "file.save",
            label: "Save",
            description: None,
            category: Some("File"),
            scope: Scope::Global,
            platforms: &[Platform::Tui],
            modes: &[Mode::Any],
            keybindings: &[],
            handler: noop,
        };
        let b = Command {
            id: "help.toggle",
            label: "Help",
            description: None,
            category: Some("Help"),
            scope: Scope::Global,
            platforms: &[Platform::Tui],
            modes: &[Mode::Any],
            keybindings: &[],
            handler: noop,
        };
        let uncategorized = make_cmd("app.quit", Scope::Global, &[Platform::Tui], &[Mode::Any]);
        reg.register(a).unwrap();
        reg.register(b).unwrap();
        reg.register(uncategorized).unwrap();

        assert_eq!(reg.by_category.get(&Some("File")).unwrap(), &vec!["file.save"]);
        assert_eq!(reg.by_category.get(&Some("Help")).unwrap(), &vec!["help.toggle"]);
        assert_eq!(reg.by_category.get(&None).unwrap(), &vec!["app.quit"]);
    }
}
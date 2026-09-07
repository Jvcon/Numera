//! KeyMatcher — chord matching state machine (spec §5).

use std::time::{Duration, Instant};

use crate::command::Command;
use crate::key::KeyEvent;
use crate::registry::CommandRegistry;
use crate::scope::{Mode, Platform};

/// Result of feeding one key event into the matcher (spec §5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyMatcherResult {
    /// No match, and not a chord prefix. Host should pass through to editor.
    NoMatch,
    /// Matched a command id. Host should execute it.
    Matched(&'static str),
    /// The current key was a chord prefix; waiting for the next key.
    PartialMatch,
}

/// Chord-matching state machine (spec §5).
#[derive(Debug)]
pub struct KeyMatcher {
    // ⚠️ wasm: Instant::now() relies on performance.now() in wasm32-unknown-unknown.
    // Most browsers/Workers support it; restricted environments may panic.
    // v1 accepts this risk; v2 can inject an external clock trait.
    pending: Option<PendingChord>,
    timeout: Duration,
}

/// An in-flight chord wait (spec §5.1).
#[derive(Debug)]
struct PendingChord {
    /// Index of the next segment expected (0 when the chord just started).
    next_index: usize,
    started_at: Instant,
    /// Command ids still in the running — any of their keybindings matches
    /// the prefix fed so far (possibly the same id twice, from multiple
    /// keybindings; harmless, id is compared, not counted).
    candidates: Vec<&'static str>,
}

impl Default for KeyMatcher {
    fn default() -> Self {
        Self {
            pending: None,
            timeout: Duration::from_millis(1500), // spec §5.1
        }
    }
}

impl KeyMatcher {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_timeout(timeout: Duration) -> Self {
        Self {
            pending: None,
            timeout,
        }
    }

    /// Optional hint for the host status bar (spec §9.2).
    ///
    /// v1 returns `None` (no UI); v2 can expose the pending prefix string.
    #[allow(clippy::unnecessary_wraps)] // API mandated by spec; always None in v1
    pub fn pending_hint(&self) -> Option<&'static str> {
        None
    }

    /// Clear any in-flight chord when the mode changes (spec §5.4).
    ///
    /// The spec's signature carries `new_mode: Mode`; the mode value is not
    /// needed in v1 because pending is always cleared unconditionally.
    pub fn on_mode_change(&mut self) {
        self.pending = None;
    }

    /// Feed one normalized-ready key event (spec §5.2).
    ///
    /// The event, platform and mode determine the visible command set; the
    /// matcher only decides match / partial / pass-through.
    pub fn feed(
        &mut self,
        ev: KeyEvent,
        platform: Platform,
        mode: Mode,
        reg: &CommandRegistry,
    ) -> KeyMatcherResult {
        // Step 0 (§5.2 step 1): expire an over-long pending chord and fall
        // through — the current event is then treated as a fresh start.
        let expired = match &self.pending {
            Some(pend) => Instant::now().duration_since(pend.started_at) > self.timeout,
            None => false,
        };
        if expired {
            self.pending = None;
        }

        let visible = reg.list(platform, mode);
        let ev_n = ev.normalize(); // §3.3

        // Step 1 (§5.2 step 1): a live pending chord dispatches to the
        // continuation path; otherwise the event starts fresh.
        if self.pending.is_some() {
            return self.feed_continuation(ev_n, &visible, reg);
        }

        // Step 2 + 3 (§5.2 step 2-3): fresh-start matching.
        self.feed_fresh(ev_n, &visible)
    }

    /// Continuation path for an in-flight chord (spec §5.2 `feed_continuation`).
    ///
    /// The pending chord is taken (cancelled) up-front; a `PartialMatch`
    /// restore re-arms it with the advanced candidate set.
    fn feed_continuation(
        &mut self,
        ev: KeyEvent,
        visible: &[&Command],
        reg: &CommandRegistry,
    ) -> KeyMatcherResult {
        let pend = self
            .pending
            .take()
            .expect("feed_continuation is only called with a live pending chord");
        let next_idx = pend.next_index + 1;

        // (a) Continuation candidates: commands still in the running whose
        //     next segment matches the event.
        let next_cmds: Vec<&Command> = pend
            .candidates
            .iter()
            .filter_map(|id| reg.get(id))
            .filter(|cmd| {
                cmd.keybindings.iter().any(|kb| {
                    let seqs = kb.chord.0;
                    seqs.len() > next_idx && seqs[next_idx].matches(&ev)
                })
            })
            .collect();

        // (b) Fresh single-segment matches for the current event.
        let fresh_singles: Vec<&Command> = visible
            .iter()
            .copied()
            .filter(|cmd| {
                cmd.keybindings
                    .iter()
                    .any(|kb| kb.chord.0.len() == 1 && kb.chord.0[0].matches(&ev))
            })
            .collect();

        // (c) Fresh multi-segment prefixes for the current event.
        let fresh_prefixes: Vec<&Command> = visible
            .iter()
            .copied()
            .filter(|cmd| {
                cmd.keybindings.iter().any(|kb| {
                    let seqs = kb.chord.0;
                    seqs.len() >= 2 && seqs[0].matches(&ev)
                })
            })
            .collect();

        // Priority 1 (§5.2 续接路径优先级 1): the chord completes. Greedy —
        // the shortest completing chord fires immediately, like VSCode (§5.3).
        if !next_cmds.is_empty() {
            let completed: Vec<&Command> = next_cmds
                .iter()
                .copied()
                .filter(|cmd| {
                    cmd.keybindings
                        .iter()
                        .any(|kb| kb.chord.0.len() == next_idx + 1)
                })
                .collect();
            if !completed.is_empty() {
                return KeyMatcherResult::Matched(completed[0].id);
            }
            // Still a prefix → advance the wait.
            self.pending = Some(PendingChord {
                candidates: next_cmds.iter().map(|c| c.id).collect(),
                next_index: next_idx,
                started_at: Instant::now(),
            });
            return KeyMatcherResult::PartialMatch;
        }

        // Priority 2 (§5.2 续接路径优先级 2): a fresh single fires immediately
        // (the old pending was already cancelled by `take()`).
        if !fresh_singles.is_empty() {
            return KeyMatcherResult::Matched(fresh_singles[0].id);
        }

        // Priority 3 (§5.2 续接路径优先级 3): the event starts a new chord.
        if !fresh_prefixes.is_empty() {
            self.pending = Some(PendingChord {
                candidates: fresh_prefixes.iter().map(|c| c.id).collect(),
                next_index: 0,
                started_at: Instant::now(),
            });
            return KeyMatcherResult::PartialMatch;
        }

        // Complete mismatch → pass the key through to the editor (§5.2).
        KeyMatcherResult::NoMatch
    }

    /// Fresh-start path with no pending chord (spec §5.2 step 2-3).
    fn feed_fresh(&mut self, ev: KeyEvent, visible: &[&Command]) -> KeyMatcherResult {
        let mut exact_hits: Vec<&Command> = Vec::new();
        let mut prefix_hits: Vec<&Command> = Vec::new();

        for cmd in visible {
            for kb in cmd.keybindings {
                let seqs = kb.chord.0;
                if seqs.is_empty() {
                    continue;
                }
                if !seqs[0].matches(&ev) {
                    continue;
                }
                if seqs.len() == 1 {
                    exact_hits.push(cmd);
                } else {
                    prefix_hits.push(cmd);
                }
            }
        }

        // §5.2 step 3 decision.
        if exact_hits.len() == 1 && prefix_hits.is_empty() {
            return KeyMatcherResult::Matched(exact_hits[0].id);
        }

        if exact_hits.is_empty() && !prefix_hits.is_empty() {
            self.pending = Some(PendingChord {
                candidates: prefix_hits.iter().map(|c| c.id).collect(),
                next_index: 0,
                started_at: Instant::now(),
            });
            return KeyMatcherResult::PartialMatch;
        }

        // Multiple exact matches (with or without a prefix): fire the
        // lexicographically smallest id for determinism.
        //
        // Note: §5.2's literal decision tree only handles "multiple exact" in
        // the ambiguous branch (exact AND prefix). For `exact > 1` with no
        // prefix it falls through to NoMatch, which contradicts §5.3
        // ("多条命令键位完全相同 → 匹配时按注册顺序取首条"). We extend it to
        // always fire the lexicographically smallest id (registry iteration
        // order is unspecified, so registration order is not observable).
        if exact_hits.len() > 1 {
            let mut ids: Vec<&'static str> = exact_hits.iter().map(|c| c.id).collect();
            ids.sort_unstable();
            self.pending = None;
            return KeyMatcherResult::Matched(ids[0]);
        }

        // Ambiguous: one exact + one-or-more prefixes — the single wins
        // immediately (VSCode behavior, spec §5.2).
        if !exact_hits.is_empty() && !prefix_hits.is_empty() {
            self.pending = None;
            return KeyMatcherResult::Matched(exact_hits[0].id);
        }

        KeyMatcherResult::NoMatch
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    use crate::command::{Command, CommandOutcome, Ctx};
    use crate::error::CommandError;
    use crate::key::{Key, Modifiers};
    use crate::scope::Scope;

    fn noop(_ctx: &mut Ctx) -> Result<CommandOutcome, CommandError> {
        Ok(CommandOutcome::None)
    }

    /// Plain lowercase letter press.
    fn key(c: char) -> KeyEvent {
        KeyEvent {
            key: Key::Char(c),
            mods: Modifiers::NONE,
        }
    }

    /// Uppercase letter pressed with Shift held.
    fn shifted(c: char) -> KeyEvent {
        KeyEvent {
            key: Key::Char(c),
            mods: Modifiers::SHIFT,
        }
    }

    fn feed(m: &mut KeyMatcher, ev: KeyEvent, reg: &CommandRegistry) -> KeyMatcherResult {
        m.feed(ev, Platform::Tui, Mode::Normal, reg)
    }

    /// Build a registry from test-local `command!` invocations.
    fn registry(cmds: &[Command]) -> CommandRegistry {
        let mut reg = CommandRegistry::new();
        for c in cmds {
            reg.register(*c).expect("test command registration");
        }
        reg
    }

    /// Spec §9.5.2: `g g` → vim.goto_first (Normal/Tui chord command).
    fn goto_first() -> Command {
        crate::command!(
            id: "vim.goto_first",
            label: "Go to First Line",
            scope: Editor,
            platforms: [Tui],
            modes: [Normal],
            key: "g g",
            handler: noop
        )
    }

    /// Spec §9.5.2: `d d` → editor.delete_line (Normal/Tui chord command).
    fn delete_line() -> Command {
        crate::command!(
            id: "editor.delete_line",
            label: "Delete Line",
            scope: Editor,
            platforms: [Tui],
            modes: [Normal],
            key: "d d",
            handler: noop
        )
    }

    // ------------------------------------------------------------------
    // The 8 key scenarios from spec §10.
    // ------------------------------------------------------------------

    #[test]
    fn single_key_matches_unique_command() {
        let reg = registry(&[crate::command!(
            id: "vim.insert",
            label: "Enter Insert",
            scope: Editor,
            platforms: [Tui],
            modes: [Normal],
            key: "i",
            handler: noop
        )]);
        let mut m = KeyMatcher::default();
        assert_eq!(
            feed(&mut m, key('i'), &reg),
            KeyMatcherResult::Matched("vim.insert")
        );
    }

    #[test]
    fn chord_completes_after_two_keys_within_timeout() {
        let reg = registry(&[goto_first()]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        assert_eq!(
            feed(&mut m, key('g'), &reg),
            KeyMatcherResult::Matched("vim.goto_first")
        );
    }

    #[test]
    fn chord_resets_after_timeout() {
        let reg = registry(&[goto_first()]);
        let mut m = KeyMatcher::with_timeout(Duration::from_millis(20));
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        thread::sleep(Duration::from_millis(30));
        // Pending expired (§5.2 step 0): 'g' is re-treated as a fresh prefix,
        // NOT as the chord's second segment → PartialMatch, not Matched.
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
    }

    #[test]
    fn ambiguous_key_prefers_single_when_chord_prefix_exists() {
        let reg = registry(&[
            crate::command!(
                id: "editor.delete_char",
                label: "Delete Char",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "d",
                handler: noop
            ),
            delete_line(),
        ]);
        let mut m = KeyMatcher::default();
        // 'd' is both an exact single and the prefix of "d d" (§5.2 step 3):
        // the single fires immediately and the chord is not armed.
        assert_eq!(
            feed(&mut m, key('d'), &reg),
            KeyMatcherResult::Matched("editor.delete_char")
        );
        assert!(m.pending.is_none());
    }

    #[test]
    fn pending_cleared_on_mode_change() {
        let reg = registry(&[goto_first()]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        m.on_mode_change(); // §5.4: mode switch clears pending
        // Pending was cleared → this 'g' is a fresh prefix, not a completion
        // of "g g" (had pending survived, the second 'g' would be Matched).
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
    }

    #[test]
    fn no_match_passes_through() {
        let reg = registry(&[crate::command!(
            id: "vim.insert",
            label: "Enter Insert",
            scope: Editor,
            platforms: [Tui],
            modes: [Normal],
            key: "i",
            handler: noop
        )]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('z'), &reg), KeyMatcherResult::NoMatch);
    }

    #[test]
    fn same_id_with_multiple_keybindings_matches_any() {
        let reg = registry(&[crate::command!(
            id: "editor.line_start",
            label: "Line Start",
            scope: Editor,
            platforms: [Tui],
            modes: [Standard],
            keys: ["ctrl+a", "home"],
            handler: noop
        )]);
        let mut m = KeyMatcher::default();
        let ctrl_a = KeyEvent {
            key: Key::Char('a'),
            mods: Modifiers::CTRL,
        };
        let home = KeyEvent {
            key: Key::Home,
            mods: Modifiers::NONE,
        };
        // Spec §5.3: 同 id 多键位，任意一个命中即触发。
        assert_eq!(
            m.feed(ctrl_a, Platform::Tui, Mode::Standard, &reg),
            KeyMatcherResult::Matched("editor.line_start")
        );
        assert_eq!(
            m.feed(home, Platform::Tui, Mode::Standard, &reg),
            KeyMatcherResult::Matched("editor.line_start")
        );
    }

    // ------------------------------------------------------------------
    // Spec §9.5.5 verification-table scenarios.
    // ------------------------------------------------------------------

    #[test]
    fn pending_d_then_d_fires_delete_line_chord_completion() {
        let reg = registry(&[delete_line()]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('d'), &reg), KeyMatcherResult::PartialMatch);
        // Priority 1: chord completes (§9.5.5 table row).
        assert_eq!(
            feed(&mut m, key('d'), &reg),
            KeyMatcherResult::Matched("editor.delete_line")
        );
    }

    #[test]
    fn pending_d_then_capital_d_fires_delete_to_end_pending_canceled() {
        // Spec §9.5.5 row: pending='d' (delete_line chord prefix), new key 'D'
        // (delete_to_end single).
        //
        // Vim semantics (this test): 'd' and 'D' are distinct keys, so a plain
        // 'd' press only arms the "d d" chord — no single fires (no 'd' single
        // is registered). Then 'D' (Shift+d) enters the continuation path,
        // finds no next-segment match for dd (mods differ), but matches the
        // fresh "D" single via priority 2. Pending 'd' is cancelled (already
        // taken), delete_to_end fires.
        let reg = registry(&[
            delete_line(),
            crate::command!(
                id: "editor.delete_to_end",
                label: "Delete to End",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "D",
                handler: noop
            ),
        ]);
        let mut m = KeyMatcher::default();
        // Plain 'd' arms the dd chord (no 'd' single is registered).
        assert_eq!(feed(&mut m, key('d'), &reg), KeyMatcherResult::PartialMatch);
        assert!(m.pending.is_some(), "'d' should arm the dd chord");
        // 'D' (Shift+d) does NOT continue dd (mods differ); priority 2 fires
        // delete_to_end via fresh single; pending is cleared.
        assert_eq!(
            feed(&mut m, shifted('D'), &reg),
            KeyMatcherResult::Matched("editor.delete_to_end")
        );
        assert!(m.pending.is_none(), "pending should be cleared after fire");
        // After the fire the dd chord is still armable: a fresh 'd' re-arms.
        assert_eq!(feed(&mut m, key('d'), &reg), KeyMatcherResult::PartialMatch);
        // ... and a second 'd' completes it.
        assert_eq!(
            feed(&mut m, key('d'), &reg),
            KeyMatcherResult::Matched("editor.delete_line")
        );
    }

    #[test]
    fn pending_g_then_g_fires_goto_first() {
        let reg = registry(&[goto_first()]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        assert_eq!(
            feed(&mut m, key('g'), &reg),
            KeyMatcherResult::Matched("vim.goto_first")
        );
    }

    #[test]
    fn pending_d_then_j_fires_motion_down_pending_canceled() {
        let reg = registry(&[
            delete_line(),
            crate::command!(
                id: "vim.motion_down",
                label: "Move Down",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "j",
                handler: noop
            ),
        ]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('d'), &reg), KeyMatcherResult::PartialMatch);
        // 'j' does not continue "d d"; priority 2 fires vim.motion_down and
        // the 'd' pending is cancelled (§9.5.5 table row).
        assert_eq!(
            feed(&mut m, key('j'), &reg),
            KeyMatcherResult::Matched("vim.motion_down")
        );
    }

    #[test]
    fn vim_mode_immediate_cancel_on_unmatched_key() {
        let reg = registry(&[goto_first()]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        // Unmatched key in vim mode cancels pending immediately (§5.3: 立即清
        // pending，不等超时) → NoMatch, key passes through.
        assert_eq!(feed(&mut m, key('q'), &reg), KeyMatcherResult::NoMatch);
        assert!(m.pending.is_none());
        // Pending was indeed cleared: 'g' again starts a fresh chord.
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
    }

    // ------------------------------------------------------------------
    // Additional algorithmic tests.
    // ------------------------------------------------------------------

    #[test]
    fn fresh_path_prefix_only_sets_pending() {
        let reg = registry(&[goto_first()]);
        let mut m = KeyMatcher::default();
        // Only a prefix hit, no exact hit (§5.2 step 3) → PartialMatch + pending.
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        assert!(m.pending.is_some());
        assert_eq!(m.pending.as_ref().unwrap().next_index, 0);
    }

    #[test]
    fn continuation_priority_2_fresh_single_beats_priority_3_fresh_prefix() {
        let reg = registry(&[
            goto_first(), // 'g' starts a pending chord
            crate::command!(
                id: "vim.motion_down",
                label: "Move Down",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "j",
                handler: noop
            ),
            // 'j' is also the first segment of a fresh chord.
            crate::command!(
                id: "editor.join_lines",
                label: "Join Lines",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "j j",
                handler: noop
            ),
        ]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        // 'j' continues nothing, but matches both a fresh single and a fresh
        // prefix → priority 2 (fresh single) fires, priority 3 is skipped.
        assert_eq!(
            feed(&mut m, key('j'), &reg),
            KeyMatcherResult::Matched("vim.motion_down")
        );
    }

    #[test]
    fn feed_with_empty_registry_returns_no_match() {
        let reg = CommandRegistry::new();
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::NoMatch);
        assert_eq!(feed(&mut m, key('j'), &reg), KeyMatcherResult::NoMatch);
        assert!(m.pending.is_none());
    }

    #[test]
    fn timeout_zero_means_pending_expires_immediately() {
        let reg = registry(&[goto_first()]);
        let mut m = KeyMatcher::with_timeout(Duration::ZERO);
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        thread::sleep(Duration::from_millis(2));
        // Any elapsed time exceeds Duration::ZERO → pending expired, so the
        // second 'g' is re-treated as a fresh prefix, not a chord completion.
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
    }

    // ------------------------------------------------------------------
    // Extra coverage.
    // ------------------------------------------------------------------

    /// Vim semantics (this test): 'g' and 'G' are distinct keys — a plain 'g'
    /// press only arms the "g g" chord prefix (no single fires; no 'g' single
    /// is registered). Pressing Shift+g fires the "G" single immediately
    /// (via priority 2 in the continuation path if 'g' was pending, or
    /// directly in fresh-start otherwise).
    ///
    /// The gg chord is keyboard-reachable: press 'g' then 'g' (no shift) to
    /// fire vim.goto_first.
    #[test]
    fn case_distinct_vim_letters_g_vs_G() {
        let reg = registry(&[
            goto_first(),
            crate::command!(
                id: "vim.goto_last",
                label: "Go to Last Line",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "G",
                handler: noop
            ),
        ]);

        // Plain 'g' arms the gg chord (no single fires).
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        assert!(m.pending.is_some());

        // Second plain 'g' completes the chord → vim.goto_first.
        assert_eq!(
            feed(&mut m, key('g'), &reg),
            KeyMatcherResult::Matched("vim.goto_first")
        );
        assert!(m.pending.is_none());

        // Shift+g (after the previous matcher was cleared) fires vim.goto_last
        // directly — single-segment match in fresh path.
        let mut m = KeyMatcher::default();
        assert_eq!(
            feed(&mut m, shifted('G'), &reg),
            KeyMatcherResult::Matched("vim.goto_last")
        );

        // And the §9.5.5 verification table scenario: pending 'g', new Shift+g
        // → priority 2 (fresh single), pending cancelled, vim.goto_last fires.
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        assert_eq!(
            feed(&mut m, shifted('G'), &reg),
            KeyMatcherResult::Matched("vim.goto_last")
        );
        assert!(m.pending.is_none());
    }

    /// Multiple exact matches on the same key → lexicographically smallest id
    /// wins, independent of (unspecified) registry iteration order (§5.2).
    #[test]
    fn ambiguous_multiple_exact_matches_pick_lexicographically_smallest() {
        let reg = registry(&[
            crate::command!(
                id: "b.second",
                label: "Second",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "x",
                handler: noop
            ),
            crate::command!(
                id: "a.first",
                label: "First",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "x",
                handler: noop
            ),
        ]);
        let mut m = KeyMatcher::default();
        assert_eq!(
            feed(&mut m, key('x'), &reg),
            KeyMatcherResult::Matched("a.first")
        );
    }

    /// Greedy completion: a shorter chord that completes fires before a
    /// longer chord sharing the same prefix (§5.3).
    #[test]
    fn greedy_short_chord_completes_before_longer_chord() {
        let reg = registry(&[
            crate::command!(
                id: "view.toggle_header",
                label: "Toggle Header",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "g h",
                handler: noop
            ),
            crate::command!(
                id: "view.toggle_header_word",
                label: "Toggle Header Word",
                scope: Editor,
                platforms: [Tui],
                modes: [Normal],
                key: "g h h",
                handler: noop
            ),
        ]);
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        // 'h' completes "g h" (len 2 == next_idx+1 == 2) → fires immediately;
        // "g h h" (len 3) is unreachable, matching VSCode (§5.3).
        assert_eq!(
            feed(&mut m, key('h'), &reg),
            KeyMatcherResult::Matched("view.toggle_header")
        );
    }

    /// Integration: the real builtins (M2) drive the matcher, validating spec
    /// §9.5 keymap wiring end-to-end.
    #[test]
    fn builtins_registry_matches_spec_keymap() {
        let mut reg = CommandRegistry::new();
        crate::builtins::register_builtins(&mut reg);

        // 'i' in Normal → vim.insert (§9.5.2).
        let mut m = KeyMatcher::default();
        assert_eq!(
            feed(&mut m, key('i'), &reg),
            KeyMatcherResult::Matched("vim.insert")
        );

        // Plain 'g' in Normal arms the gg chord (§9.5.2). No single fires
        // (no 'g' single is registered). Vim case-distinct semantics: 'g' and
        // 'G' are different keys.
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('g'), &reg), KeyMatcherResult::PartialMatch);
        assert!(m.pending.is_some());
        // A second 'g' completes the chord → vim.goto_first.
        assert_eq!(
            feed(&mut m, key('g'), &reg),
            KeyMatcherResult::Matched("vim.goto_first")
        );

        // 'G' (Shift+G) → vim.goto_last directly (single fires immediately).
        let mut m = KeyMatcher::default();
        assert_eq!(
            feed(&mut m, shifted('G'), &reg),
            KeyMatcherResult::Matched("vim.goto_last")
        );

        // 'd' / 'D' / dd: NOT in builtins (M2 ships 13 commands — see
        // builtins.rs doc). The dd chord + D single + their interaction are
        // exercised in `pending_d_then_capital_d_fires_delete_to_end_pending_canceled`
        // and `pending_d_then_d_fires_delete_line_chord_completion` via the
        // local `delete_line()` helper. Here we just confirm 'd' is unbound
        // in the builtin set → NoMatch.
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('d'), &reg), KeyMatcherResult::NoMatch);

        // 'j' in Normal → vim.motion_down (§9.5.2).
        let mut m = KeyMatcher::default();
        assert_eq!(
            feed(&mut m, key('j'), &reg),
            KeyMatcherResult::Matched("vim.motion_down")
        );

        // 'esc' in Insert → vim.normal (§9.5.3).
        let mut m = KeyMatcher::default();
        assert_eq!(
            m.feed(
                KeyEvent {
                    key: Key::Escape,
                    mods: Modifiers::NONE,
                },
                Platform::Tui,
                Mode::Insert,
                &reg
            ),
            KeyMatcherResult::Matched("vim.normal")
        );

        // 'ctrl+k' in Standard → editor.delete_to_end (§9.5.4).
        let mut m = KeyMatcher::default();
        assert_eq!(
            m.feed(
                KeyEvent {
                    key: Key::Char('k'),
                    mods: Modifiers::CTRL,
                },
                Platform::Tui,
                Mode::Standard,
                &reg
            ),
            KeyMatcherResult::Matched("editor.delete_to_end")
        );
    }

    /// Commands with no keybindings (palette-only) can never produce a match
    /// and never arm a pending chord (§3.5: `keybindings` is 0..N).
    #[test]
    fn commands_with_no_keybindings_never_match() {
        let cmd = Command {
            id: "palette.only",
            label: "Palette Only",
            description: None,
            category: None,
            scope: Scope::Global,
            platforms: &[Platform::Tui],
            modes: &[Mode::Any],
            keybindings: &[],
            handler: noop,
        };
        let mut reg = CommandRegistry::new();
        reg.register(cmd).unwrap();
        let mut m = KeyMatcher::default();
        assert_eq!(feed(&mut m, key('x'), &reg), KeyMatcherResult::NoMatch);
        assert!(m.pending.is_none());
    }
}
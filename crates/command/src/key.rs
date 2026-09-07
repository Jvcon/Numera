//! Keyboard primitives: `Modifiers`, `Key`, `KeyEvent` (spec §3.2, §3.3).

/// Modifier bitmask.
///
/// **Cross-platform modifier mapping is the host input layer's job, not this
/// crate's (spec §3.2).** The command layer only recognizes the four semantic
/// modifiers `Ctrl` / `Alt` / `Shift` / `Meta`; physical keys (macOS
/// Option/Cmd, Windows Win, Linux Super) are mapped to `Modifiers` by the host
/// before feeding a `KeyEvent`. The string parser likewise accepts only the
/// semantic names `ctrl` / `alt` / `shift` / `meta` — not `cmd` / `win` /
/// `option` / `super`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub struct Modifiers(pub u8);

impl Modifiers {
    pub const NONE: Modifiers = Modifiers(0);
    pub const CTRL: Modifiers = Modifiers(1 << 0);
    pub const ALT: Modifiers = Modifiers(1 << 1);
    pub const SHIFT: Modifiers = Modifiers(1 << 2);
    pub const META: Modifiers = Modifiers(1 << 3); // macOS Cmd / Windows Win

    pub fn contains(self, other: Modifiers) -> bool {
        (self.0 & other.0) == other.0
    }

    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
}

/// A single key (spec §3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Key {
    Char(char),
    Enter,
    Backspace,
    Tab,
    Escape,
    Up,
    Down,
    Left,
    Right,
    Home,
    End,
    PageUp,
    PageDown,
    F(u8), // F1..F12
    Insert,
    Delete,
}

impl Key {
    /// Fold uppercase letters to lowercase (spec §3.3).
    ///
    /// `'A'..'Z'` → `'a'..'z'`; everything else is left untouched.
    pub fn normalize(&self) -> Key {
        match self {
            Key::Char(c) if c.is_ascii_uppercase() => Key::Char(c.to_ascii_lowercase()),
            other => *other,
        }
    }
}

/// A keyboard event from the host platform (spec §3.2).
///
/// Each platform's input layer is responsible for normalizing its own events
/// into this shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyEvent {
    pub key: Key,
    pub mods: Modifiers,
}

impl KeyEvent {
    /// Normalize for matching (spec §3.3).
    ///
    /// - `'A'..'Z'` folds to `'a'..'z'`
    /// - **all modifiers are preserved** — SHIFT is NOT cleared
    ///
    /// Rationale (vim semantics): `d` and `D` must remain distinct
    /// commands. The parser stores uppercase letters as `{ SHIFT, lowercase }`
    /// (see `KeySeq::normalized`), so an OS-produced event for pressing
    /// Shift+D (`{ SHIFT, 'd' }`) matches the `D` command and does NOT match
    /// the `d` command or arm a `dd` chord.
    ///
    /// For `Ctrl+letter`, users typically press only Ctrl (not Shift), so
    /// OS-produced events are `{ CTRL, 's' }` (no SHIFT). Both `ctrl+s` and
    /// `ctrl+S` resolve to the same chord after normalization.
    pub fn normalize(&self) -> KeyEvent {
        let mut ev = *self;
        if let Key::Char(_) = ev.key {
            ev.key = ev.key.normalize();
            // SHIFT preserved: 'D' press ≠ 'd' press for command dispatch.
        }
        ev
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn modifiers_contains_works() {
        // `contains` takes `Modifiers` by value per spec §3.2.
        assert!(Modifiers::CTRL.contains(Modifiers::CTRL));
        assert!(Modifiers::CTRL.contains(Modifiers::NONE));
        assert!(Modifiers::SHIFT.contains(Modifiers::SHIFT));
        assert!(!Modifiers::CTRL.contains(Modifiers::ALT));
        let ctrl_shift = Modifiers(Modifiers::CTRL.0 | Modifiers::SHIFT.0);
        assert!(ctrl_shift.contains(Modifiers::CTRL));
        assert!(ctrl_shift.contains(Modifiers::SHIFT));
        assert!(!ctrl_shift.contains(Modifiers::META));
    }

    #[test]
    fn modifiers_is_empty_works() {
        assert!(Modifiers::NONE.is_empty());
        assert!(!Modifiers::META.is_empty());
    }

    #[test]
    fn key_normalize_folds_uppercase() {
        // 'S' folds to 's' ...
        assert_eq!(Key::Char('S').normalize(), Key::Char('s'));
        // ... lowercase is kept as-is ...
        assert_eq!(Key::Char('a').normalize(), Key::Char('a'));
        // ... and non-letter keys are untouched.
        assert_eq!(Key::Enter.normalize(), Key::Enter);
        assert_eq!(Key::F(1).normalize(), Key::F(1));
    }

    #[test]
    fn key_event_normalize_preserves_shift_for_letters() {
        // Vim semantics: 'd' and 'D' must remain distinct. SHIFT is preserved
        // through normalization so `D` (Shift+d) matches the registered `D`
        // command and does NOT arm a `dd` chord or match `d`.

        // 'S' alone (no SHIFT) folds to 's' with no SHIFT
        let s_alone = KeyEvent {
            key: Key::Char('S'),
            mods: Modifiers::NONE,
        };
        assert_eq!(
            s_alone.normalize(),
            KeyEvent {
                key: Key::Char('s'),
                mods: Modifiers::NONE,
            }
        );

        // 'S' + SHIFT → 's' with SHIFT kept (vim: uppercase D = lowercase d + SHIFT)
        let s_shift = KeyEvent {
            key: Key::Char('S'),
            mods: Modifiers::SHIFT,
        };
        assert_eq!(
            s_shift.normalize(),
            KeyEvent {
                key: Key::Char('s'),
                mods: Modifiers::SHIFT,
            }
        );

        // lowercase + SHIFT stays lowercase + SHIFT
        let a_shift = KeyEvent {
            key: Key::Char('a'),
            mods: Modifiers::SHIFT,
        };
        assert_eq!(
            a_shift.normalize(),
            KeyEvent {
                key: Key::Char('a'),
                mods: Modifiers::SHIFT,
            }
        );

        // Ctrl+Shift+S normalizes to Ctrl+Shift+s (SHIFT kept on top of Ctrl)
        let ctrl_shift_s = KeyEvent {
            key: Key::Char('S'),
            mods: Modifiers(Modifiers::CTRL.0 | Modifiers::SHIFT.0),
        };
        assert_eq!(
            ctrl_shift_s.normalize(),
            KeyEvent {
                key: Key::Char('s'),
                mods: Modifiers(Modifiers::CTRL.0 | Modifiers::SHIFT.0),
            }
        );

        // non-letter keys preserve modifiers as-is (no case to fold)
        let shift_tab = KeyEvent {
            key: Key::Tab,
            mods: Modifiers::SHIFT,
        };
        assert_eq!(shift_tab.normalize(), shift_tab);
    }
}
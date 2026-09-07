//! Keybinding model: `KeySeq`, `KeyChord`, `Keybinding` (spec §3.2, §3.4).

use crate::error::CommandError;
use crate::key::{Key, KeyEvent, Modifiers};

/// One key of a chord (a single press, e.g. `ctrl+s`) (spec §3.4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeySeq {
    pub mods: Modifiers,
    pub key: Key,
}

/// A key sequence — one chord (spec §3.2, §3.4).
///
/// A chord is a sequence of 1..N key presses:
/// - 1 element = single key (`"ctrl+s"`)
/// - 2+ elements = multi-press chord (`"g g"`, `"ctrl+k ctrl+s"`)
///
/// ⚠️ Multi-char shorthand without spaces (`"gg"`) is **not** supported — it
/// must be written `"g g"` so parsing stays unambiguous (spec §3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct KeyChord(pub &'static [KeySeq]);

/// A command's keybinding: a chord plus an optional `when` context string
/// (spec §3.4).
///
/// `KeyMatcher` never evaluates `when` — it is pure data. Evaluation is done
/// by the host (`eval_when(when_str, ctx)`) after a `Matched(id)` result or
/// when rendering the command palette. v1 recognizes only the literals
/// `editorFocus` / `!editorFocus` / `readOnly`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Keybinding {
    pub chord: KeyChord,
    pub when: Option<&'static str>,
}

impl KeySeq {
    /// True when this sequence matches the (normalized) event (spec §3.4).
    ///
    /// Both sides are normalized first (§3.3), then:
    /// - modifiers must match **exactly** (SHIFT distinguishes `d` from `D`)
    /// - `Key::Char` is compared case-insensitively (so a stored `Char('d')`
    ///   matches an event `Char('D')` once both sides fold to lowercase)
    /// - non-Char keys (`Enter`, `F(1)`, etc.) must match exactly
    pub fn matches(&self, ev: &KeyEvent) -> bool {
        let self_n = self.normalized();
        let ev_n = ev.normalize();
        self_n.mods == ev_n.mods && keys_equivalent(&self_n.key, &ev_n.key)
    }

    /// Parse a single key sequence like `"ctrl+s"`, `"shift+tab"` or `"g"`.
    ///
    /// Syntax (spec §3.2):
    /// - letters `a-z`, `A-Z` (case-distinct: uppercase letter auto-adds SHIFT
    ///   so `D` becomes `{ SHIFT, 'd' }` and `d` becomes `{ NONE, 'd' }`)
    /// - digits `0-9`
    /// - named keys: `enter`, `backspace`, `tab`, `escape`, `up`, `down`,
    ///   `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `insert`,
    ///   `delete`, `f1`-`f12`, `space`
    /// - punctuation keys: `plus`, `minus`, `equal`, `comma`, `period`,
    ///   `slash`, `semicolon`, `quote`, `bracketleft`, `bracketright`,
    ///   `backslash`, `grave` (⚠️ `+` must be written `plus` — it conflicts
    ///   with the modifier separator)
    /// - modifiers: `ctrl`, `alt`, `shift`, `meta` (⚠️ no `cmd`/`win`/
    ///   `option`/`super` — the host input layer maps those)
    /// - literal `?` and `/`
    ///
    /// After parsing, the sequence is normalized once (§3.3): uppercase
    /// letters fold to lowercase and `SHIFT` is **added** (not cleared), so
    /// `D` and `d` register as distinct chords.
    pub fn parse(s: &str) -> Result<KeySeq, CommandError> {
        let parts: Vec<&str> = s.split('+').collect();
        if parts.iter().any(|p| p.is_empty()) {
            return Err(CommandError::KeybindingParseError(format!(
                "empty segment in key sequence '{s}'"
            )));
        }

        let (mod_parts, key_part) = parts.split_at(parts.len() - 1);
        let mut mods = Modifiers::NONE;
        for m in mod_parts {
            let m = parse_modifier(m).ok_or_else(|| {
                CommandError::KeybindingParseError(format!("unknown modifier '{m}' in '{s}'"))
            })?;
            mods = Modifiers(mods.0 | m.0);
        }

        let key_name = key_part[0];
        if parse_modifier(key_name).is_some() {
            return Err(CommandError::KeybindingParseError(format!(
                "missing key after modifiers in '{s}'"
            )));
        }
        let key = parse_key_name(key_name)?;

        Ok(KeySeq { mods, key }.normalized())
    }

    /// Apply the §3.3 normalization rule to a parsed sequence.
    ///
    /// Vim semantics: uppercase letters auto-add SHIFT (so `D` and `d` are
    /// distinct) and the char is folded to lowercase. Modifiers other than
    /// SHIFT on an uppercase letter (`ctrl+S`) keep their existing modifiers
    /// AND gain SHIFT — the user wrote `ctrl+S` explicitly and we respect that.
    fn normalized(self) -> KeySeq {
        let mut seq = self;
        if let Key::Char(c) = seq.key {
            if c.is_ascii_uppercase() {
                seq.mods = Modifiers(seq.mods.0 | Modifiers::SHIFT.0);
            }
            seq.key = Key::Char(c.to_ascii_lowercase());
        }
        seq
    }
}

/// Case-insensitive key equality for `Key::Char`, exact for all other variants.
fn keys_equivalent(a: &Key, b: &Key) -> bool {
    match (a, b) {
        (Key::Char(c1), Key::Char(c2)) => c1.eq_ignore_ascii_case(c2),
        _ => a == b,
    }
}

impl KeyChord {
    /// Parse a chord from a space-separated string (spec §3.2, §3.4).
    ///
    /// Examples:
    /// - `"ctrl+s"` → single-segment chord (Ctrl+S)
    /// - `"ctrl+k ctrl+s"` → two-segment chord (Ctrl+K then Ctrl+S)
    /// - `"g g"` → two-segment chord (Vim-style `gg`)
    /// - `"esc"` → single-segment chord
    ///
    /// The resulting `KeyChord` holds a `&'static [KeySeq]`; the backing slice
    /// is allocated once (leaked) at parse time. `parse` is therefore called
    /// at registration/construction time, never in a hot loop.
    pub fn parse(s: &'static str) -> Result<KeyChord, CommandError> {
        let segs: Result<Vec<KeySeq>, CommandError> =
            s.split_whitespace().map(KeySeq::parse).collect();
        let segs = segs?;
        if segs.is_empty() {
            return Err(CommandError::KeybindingParseError(format!(
                "empty chord string '{s}'"
            )));
        }
        let leaked: &'static [KeySeq] = Box::leak(segs.into_boxed_slice());
        Ok(KeyChord(leaked))
    }

    /// True when the chord fully matches the given events in order (spec §3.4).
    pub fn matches(&self, events: &[KeyEvent]) -> bool {
        self.0.len() == events.len()
            && self
                .0
                .iter()
                .zip(events.iter())
                .all(|(seq, ev)| seq.matches(ev))
    }
}

/// Build a `&'static [Keybinding]` from key strings (used by the `command!`
/// macro, spec §3.6). `when` is always `None` in the macro-generated form.
///
/// Panics on an invalid key string — this is a development-time registration
/// error and is reported loudly (spec §11 "注册期：开发期 panic").
pub fn from_key_strings(keys: &[&'static str]) -> &'static [Keybinding] {
    let kbs: Vec<Keybinding> = keys
        .iter()
        .map(|k| {
            let chord = KeyChord::parse(k)
                .unwrap_or_else(|e| panic!("invalid keybinding string '{k}': {e}"));
            Keybinding { chord, when: None }
        })
        .collect();
    Box::leak(kbs.into_boxed_slice())
}

fn parse_modifier(name: &str) -> Option<Modifiers> {
    match name {
        "ctrl" => Some(Modifiers::CTRL),
        "alt" => Some(Modifiers::ALT),
        "shift" => Some(Modifiers::SHIFT),
        "meta" => Some(Modifiers::META),
        _ => None,
    }
}

fn parse_key_name(name: &str) -> Result<Key, CommandError> {
    let err = || CommandError::KeybindingParseError(format!("unknown key '{name}'"));

    match name {
        "enter" => return Ok(Key::Enter),
        "backspace" => return Ok(Key::Backspace),
        "tab" => return Ok(Key::Tab),
        // "esc" is the shorthand used in chord examples (spec §3.2); "escape"
        // is the named-key form from the syntax list. Both map to `Key::Escape`.
        "escape" | "esc" => return Ok(Key::Escape),
        "up" => return Ok(Key::Up),
        "down" => return Ok(Key::Down),
        "left" => return Ok(Key::Left),
        "right" => return Ok(Key::Right),
        "home" => return Ok(Key::Home),
        "end" => return Ok(Key::End),
        "pageup" => return Ok(Key::PageUp),
        "pagedown" => return Ok(Key::PageDown),
        "insert" => return Ok(Key::Insert),
        "delete" => return Ok(Key::Delete),
        "space" => return Ok(Key::Char(' ')),
        "plus" => return Ok(Key::Char('+')),
        "minus" => return Ok(Key::Char('-')),
        "equal" => return Ok(Key::Char('=')),
        "comma" => return Ok(Key::Char(',')),
        "period" => return Ok(Key::Char('.')),
        "slash" => return Ok(Key::Char('/')),
        "semicolon" => return Ok(Key::Char(';')),
        "quote" => return Ok(Key::Char('\'')),
        "bracketleft" => return Ok(Key::Char('[')),
        "bracketright" => return Ok(Key::Char(']')),
        "backslash" => return Ok(Key::Char('\\')),
        "grave" => return Ok(Key::Char('`')),
        "?" => return Ok(Key::Char('?')),
        "/" => return Ok(Key::Char('/')),
        _ => {}
    }

    // f1..f12 (spec §3.2)
    if let Some(num) = name.strip_prefix('f') {
        if let Ok(n) = num.parse::<u8>() {
            if (1..=12).contains(&n) {
                return Ok(Key::F(n));
            }
        }
    }

    // single alphanumeric character: a-z, A-Z, 0-9 (spec §3.2)
    if name.len() == 1 {
        let c = name.chars().next().expect("len()==1 implies one char");
        if c.is_ascii_alphanumeric() {
            return Ok(Key::Char(c));
        }
    }

    Err(err())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keyseq_parse_ctrl_s() {
        let seq = KeySeq::parse("ctrl+s").expect("ctrl+s should parse");
        assert_eq!(seq.mods, Modifiers::CTRL);
        assert_eq!(seq.key, Key::Char('s'));
    }

    #[test]
    fn keyseq_parse_ctrl_plus() {
        let seq = KeySeq::parse("ctrl+plus").expect("ctrl+plus should parse");
        assert_eq!(seq.mods, Modifiers::CTRL);
        assert_eq!(seq.key, Key::Char('+'));
    }

    #[test]
    fn keyseq_parse_rejects_too_many_keys() {
        // 'plus' after 'ctrl' is not a modifier, so the key part ('minus')
        // can never be reached — parse must fail.
        assert!(KeySeq::parse("ctrl+plus+minus").is_err());
    }

    #[test]
    fn keyseq_parse_named_and_function_keys() {
        assert_eq!(KeySeq::parse("esc").unwrap().key, Key::Escape);
        assert_eq!(KeySeq::parse("shift+tab").unwrap().mods, Modifiers::SHIFT);
        assert_eq!(KeySeq::parse("shift+tab").unwrap().key, Key::Tab);
        assert_eq!(KeySeq::parse("f3").unwrap().key, Key::F(3));
        assert_eq!(KeySeq::parse("f12").unwrap().key, Key::F(12));
        assert!(KeySeq::parse("f13").is_err());
        assert_eq!(KeySeq::parse("space").unwrap().key, Key::Char(' '));
        assert_eq!(KeySeq::parse("?").unwrap().key, Key::Char('?'));
        assert_eq!(KeySeq::parse("backspace").unwrap().key, Key::Backspace);
        assert_eq!(KeySeq::parse("meta+backspace").unwrap().mods, Modifiers::META);
    }

    #[test]
    fn keyseq_parse_uppercase_auto_adds_shift() {
        // Vim semantics: uppercase letters auto-add SHIFT so `D` and `d` are
        // distinct chords (delete-to-end vs delete-line start).
        let d_lower = KeySeq::parse("d").unwrap();
        assert_eq!(d_lower.mods, Modifiers::NONE);
        assert_eq!(d_lower.key, Key::Char('d'));

        let d_upper = KeySeq::parse("D").unwrap();
        assert_eq!(d_upper.mods, Modifiers::SHIFT, "uppercase letter auto-adds SHIFT");
        assert_eq!(d_upper.key, Key::Char('d'), "char folded to lowercase");

        // Explicit shift + uppercase: idempotent (already has SHIFT)
        let shift_d = KeySeq::parse("shift+D").unwrap();
        assert_eq!(shift_d.mods, Modifiers::SHIFT);
        assert_eq!(shift_d.key, Key::Char('d'));

        // ctrl+S: SHIFT added on top of CTRL (rare but allowed)
        let ctrl_s_upper = KeySeq::parse("ctrl+S").unwrap();
        assert_eq!(
            ctrl_s_upper.mods,
            Modifiers(Modifiers::CTRL.0 | Modifiers::SHIFT.0)
        );
        assert_eq!(ctrl_s_upper.key, Key::Char('s'));
    }

    #[test]
    fn keychord_parse_two_segments() {
        let chord = KeyChord::parse("g g").expect("g g should parse");
        assert_eq!(chord.0.len(), 2);
        assert_eq!(
            chord.0[0],
            KeySeq {
                mods: Modifiers::NONE,
                key: Key::Char('g'),
            }
        );
        assert_eq!(
            chord.0[1],
            KeySeq {
                mods: Modifiers::NONE,
                key: Key::Char('g'),
            }
        );
    }

    #[test]
    fn keychord_parse_ctrl_k_ctrl_p() {
        let chord = KeyChord::parse("ctrl+k ctrl+p").expect("ctrl+k ctrl+p should parse");
        assert_eq!(chord.0.len(), 2);
        assert_eq!(chord.0[0].mods, Modifiers::CTRL);
        assert_eq!(chord.0[0].key, Key::Char('k'));
        assert_eq!(chord.0[1].mods, Modifiers::CTRL);
        assert_eq!(chord.0[1].key, Key::Char('p'));
    }

    #[test]
    fn keychord_parse_esc_single_segment() {
        let chord = KeyChord::parse("esc").expect("esc should parse");
        assert_eq!(chord.0.len(), 1);
        assert_eq!(chord.0[0].key, Key::Escape);
    }

    #[test]
    fn keychord_parse_rejects_empty() {
        assert!(KeyChord::parse("").is_err());
        assert!(KeyChord::parse("   ").is_err());
    }

    #[test]
    fn keyseq_matches_events() {
        let seq = KeySeq::parse("ctrl+s").expect("ctrl+s should parse");

        // exact match
        assert!(seq.matches(&KeyEvent {
            key: Key::Char('s'),
            mods: Modifiers::CTRL,
        }));
        // 'S' alone (no SHIFT held) folds to 's' → still matches ctrl+s
        // (most hosts send Ctrl+S as { 's'/'S', CTRL } with no SHIFT modifier)
        assert!(seq.matches(&KeyEvent {
            key: Key::Char('S'),
            mods: Modifiers::CTRL,
        }));
        // ctrl+shift+s does NOT match ctrl+s (mods differ; SHIFT is meaningful)
        assert!(!seq.matches(&KeyEvent {
            key: Key::Char('S'),
            mods: Modifiers(Modifiers::CTRL.0 | Modifiers::SHIFT.0),
        }));
        // wrong key
        assert!(!seq.matches(&KeyEvent {
            key: Key::Char('a'),
            mods: Modifiers::CTRL,
        }));
        // missing modifier
        assert!(!seq.matches(&KeyEvent {
            key: Key::Char('s'),
            mods: Modifiers::NONE,
        }));
        // extra modifier
        assert!(!seq.matches(&KeyEvent {
            key: Key::Char('s'),
            mods: Modifiers(Modifiers::CTRL.0 | Modifiers::ALT.0),
        }));

        // d and D are distinct (vim semantics)
        let d_seq = KeySeq::parse("d").unwrap();
        let d_upper = KeySeq::parse("D").unwrap();
        assert!(d_seq.matches(&KeyEvent { key: Key::Char('d'), mods: Modifiers::NONE }));
        // user pressing Shift+d (event { SHIFT, 'D' } → normalizes to { SHIFT, 'd' })
        // must NOT match the 'd' chord prefix
        assert!(!d_seq.matches(&KeyEvent { key: Key::Char('D'), mods: Modifiers::SHIFT }));
        // ... and must match the 'D' command
        assert!(d_upper.matches(&KeyEvent { key: Key::Char('D'), mods: Modifiers::SHIFT }));
        assert!(!d_upper.matches(&KeyEvent { key: Key::Char('d'), mods: Modifiers::NONE }));
    }

    #[test]
    fn keychord_matches_event_sequence() {
        let chord = KeyChord::parse("g g").expect("g g should parse");
        assert!(chord.matches(&[
            KeyEvent {
                key: Key::Char('g'),
                mods: Modifiers::NONE,
            },
            KeyEvent {
                key: Key::Char('g'),
                mods: Modifiers::NONE,
            },
        ]));
        // wrong length
        assert!(!chord.matches(&[KeyEvent {
            key: Key::Char('g'),
            mods: Modifiers::NONE,
        }]));
        // wrong second key (plain 'x')
        assert!(!chord.matches(&[
            KeyEvent {
                key: Key::Char('g'),
                mods: Modifiers::NONE,
            },
            KeyEvent {
                key: Key::Char('x'),
                mods: Modifiers::NONE,
            },
        ]));
        // Vim semantics: 'G' (Shift+g) is a *different* key from 'g'.
        // User pressing Shift+g produces { SHIFT, 'g' } which does NOT match
        // the 'g g' chord segment { NONE, 'g' } (mods differ).
        assert!(!chord.matches(&[
            KeyEvent {
                key: Key::Char('g'),
                mods: Modifiers::NONE,
            },
            KeyEvent {
                key: Key::Char('G'),
                mods: Modifiers::SHIFT,
            },
        ]));
    }

    #[test]
    fn from_key_strings_builds_static_slice() {
        let kbs: &'static [Keybinding] = from_key_strings(&["ctrl+s", "g g"]);
        assert_eq!(kbs.len(), 2);
        assert_eq!(kbs[0].chord.0.len(), 1);
        assert_eq!(kbs[1].chord.0.len(), 2);
        assert_eq!(kbs[1].when, None);
    }
}
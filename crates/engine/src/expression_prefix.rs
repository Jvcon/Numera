//! Compute the UTF-16 offset where the executable expression ends.
//!
//! A `.numr` line can be:
//!
//!   `tax = price * 0.13   # VAT comment`
//!
//! The "executable expression" is everything up to the first `#` or
//! `//` comment marker, with leading and trailing whitespace trimmed.
//! The result gutter and the result-alignment plugin both anchor
//! their visuals to the END of this prefix, so the formatted answer
//! lands right next to the last meaningful symbol the user typed —
//! even when the line wraps across visual rows.
//!
//! Comment markers:
//!   - `#` (hash) starts a line comment to end-of-line
//!   - `//` starts a line comment to end-of-line
//!
//! Both markers are recognised only at the start of the line or
//! after whitespace — this prevents false positives on characters
//! that happen to be `#` inside expressions.

/// Return the UTF-16 code-unit offset where the executable prefix
/// ends. Returns 0 for blank lines and comment-only lines.
pub fn expression_prefix_utf16_len(line: &str) -> usize {
    if line.trim().is_empty() {
        return 0;
    }

    let leading_ws_byte = line.len() - line.trim_start().len();
    let leading_ws_utf16 = utf16_len(&line[..leading_ws_byte]);
    let stripped = &line[leading_ws_byte..];

    let bytes = stripped.as_bytes();
    let bytes_len = bytes.len();
    let mut comment_at: Option<usize> = None;
    for (i, _) in stripped.char_indices() {
        if is_comment_start(bytes, i) {
            comment_at = Some(i);
            break;
        }
    }
    let expr_end_byte = comment_at.unwrap_or(bytes_len);

    // Walk the expression portion, tracking the offset right after
    // the last non-whitespace character.
    let expr = &stripped[..expr_end_byte];
    let expr_bytes = expr.as_bytes();
    let mut last_non_ws_utf16_end = 0;
    let mut utf16_offset = 0;
    for (i, ch) in expr.char_indices() {
        let ch_utf16 = ch.len_utf16();
        if !ch.is_whitespace() {
            last_non_ws_utf16_end = utf16_offset + ch_utf16;
        }
        // Defensive: keep `i` referenced for the byte position; we
        // don't actually need it but it documents intent.
        let _ = i;
        utf16_offset += ch_utf16;
        // Stop early once we run past expr.
        let _ = expr_bytes;
    }

    leading_ws_utf16 + last_non_ws_utf16_end
}

fn utf16_len(s: &str) -> usize {
    s.encode_utf16().count()
}

fn is_comment_start(bytes: &[u8], i: usize) -> bool {
    if i >= bytes.len() {
        return false;
    }
    // `#` line comment — must be at the start or after whitespace.
    if bytes[i] == b'#' {
        return i == 0 || bytes[i - 1].is_ascii_whitespace();
    }
    // `//` line comment — same rule.
    if bytes[i] == b'/' && i + 1 < bytes.len() && bytes[i + 1] == b'/' {
        return i == 0 || bytes[i - 1].is_ascii_whitespace();
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_line_has_zero_prefix() {
        assert_eq!(expression_prefix_utf16_len(""), 0);
        assert_eq!(expression_prefix_utf16_len("   "), 0);
        assert_eq!(expression_prefix_utf16_len("\t  "), 0);
    }

    #[test]
    fn plain_expression_returns_full_length() {
        assert_eq!(expression_prefix_utf16_len("100 + 50"), 8);
    }

    #[test]
    fn strips_trailing_hash_comment() {
        assert_eq!(expression_prefix_utf16_len("x = 1  # comment"), 5);
    }

    #[test]
    fn strips_trailing_slash_comment() {
        assert_eq!(expression_prefix_utf16_len("x = 1  // comment"), 5);
    }

    #[test]
    fn hash_at_start_is_a_comment() {
        assert_eq!(expression_prefix_utf16_len("# whole line is comment"), 0);
    }

    #[test]
    fn hash_without_leading_whitespace_is_data() {
        // '#' as a non-comment character — shouldn't happen often, but
        // the parser is conservative.
        assert_eq!(expression_prefix_utf16_len("tag#1 = 5"), 9);
    }

    #[test]
    fn leading_whitespace_is_skipped() {
        assert_eq!(expression_prefix_utf16_len("   x = 1"), 8);
    }

    #[test]
    fn utf16_length_for_non_ascii() {
        // "变量 = 42" — two CJK chars (BMP, 1 UTF-16 unit each) + 5 spaces/ASCII.
        assert_eq!(expression_prefix_utf16_len("变量 = 42"), 7);
        // High-plane characters encode as 2 UTF-16 units (surrogate pair).
        // Mathematical '𝐀' (U+1D400) is 2 UTF-16 units.
        assert_eq!(expression_prefix_utf16_len("𝐀 = 1"), 6);
    }

    #[test]
    fn trailing_whitespace_trimmed() {
        assert_eq!(expression_prefix_utf16_len("x = 1   "), 5);
    }

    #[test]
    fn wrapped_expression_keeps_compact_prefix() {
        // Soft wrapping in the editor shouldn't change the anchor.
        assert_eq!(
            expression_prefix_utf16_len("savings = monthly_income * (1 - tax_rate) - rent"),
            48,
        );
    }
}

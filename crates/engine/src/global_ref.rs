//! Rewrites `global.<name>` references to plain `<name>` so that the
//! underlying numr-core engine resolves them through its normal variable
//! table. Globals must already be injected into numr-core via
//! [`crate::eval::Engine::load_globals`].
//!
//! The rewrite is intentionally narrow: it matches `global.` followed by
//! an identifier (`[A-Za-z_][A-Za-z0-9_]*`). Anything else is left alone
//! so we never corrupt literal text.

/// Returns `expr` with every `global.<ident>` occurrence rewritten to
/// `<ident>`. Identifiers are Rust-style: leading letter or underscore,
/// followed by alphanumerics or underscores.
///
/// Function-shaped references (`global.tax(price)`) are left intact —
/// they are handled by [`crate::function_call::expand_global_calls`],
/// which inlines the function body.
pub fn rewrite_global_refs(expr: &str) -> String {
    let bytes = expr.as_bytes();
    let mut out = String::with_capacity(expr.len());
    let mut i = 0;

    while i < bytes.len() {
        if matches_keyword(bytes, i, b"global")
            && i + 7 < bytes.len()
            && bytes[i + 6] == b'.'
            && is_ident_start(bytes[i + 7])
        {
            // Find the end of the identifier that follows.
            let mut j = i + 8;
            while j < bytes.len() && is_ident_continue(bytes[j]) {
                j += 1;
            }
            // If the next non-identifier char is `(`, leave the prefix in
            // place — the function-call expander will rewrite this match.
            let mut k = j;
            while k < bytes.len() && bytes[k].is_ascii_whitespace() {
                k += 1;
            }
            if k < bytes.len() && bytes[k] == b'(' {
                out.push_str(&expr[i..j]);
                i = j;
                continue;
            }
            // Plain variable reference — strip the `global.` prefix.
            out.push_str(&expr[i + 7..j]);
            i = j;
            continue;
        }
        out.push(expr[i..].chars().next().unwrap());
        i += expr[i..].chars().next().unwrap().len_utf8();
    }

    out
}

fn matches_keyword(bytes: &[u8], i: usize, keyword: &[u8]) -> bool {
    if i + keyword.len() > bytes.len() {
        return false;
    }
    if &bytes[i..i + keyword.len()] != keyword {
        return false;
    }
    // Must not be a prefix of a longer identifier (e.g. "globalize").
    if i > 0 && is_ident_continue(bytes[i - 1]) {
        return false;
    }
    true
}

fn is_ident_start(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_'
}

fn is_ident_continue(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_simple_global_ref() {
        assert_eq!(rewrite_global_refs("price * global.tax"), "price * tax");
    }

    #[test]
    fn rewrites_multiple_refs() {
        assert_eq!(
            rewrite_global_refs("price * global.vat + global.fee"),
            "price * vat + fee"
        );
    }

    #[test]
    fn leaves_function_call_unchanged_for_expander() {
        // `global.tax(price)` is a function call, not a variable reference;
        // the identifier stripper leaves it for `expand_global_calls`.
        assert_eq!(
            rewrite_global_refs("tax_amount = global.tax(price)"),
            "tax_amount = global.tax(price)"
        );
    }

    #[test]
    fn leaves_non_global_alone() {
        assert_eq!(rewrite_global_refs("total = price * tax"), "total = price * tax");
    }

    #[test]
    fn does_not_match_substring() {
        // "globalize" must not be treated as the keyword.
        assert_eq!(rewrite_global_refs("globalize(x)"), "globalize(x)");
    }

    #[test]
    fn handles_underscore_ident() {
        assert_eq!(
            rewrite_global_refs("result = global.vat_rate * 2"),
            "result = vat_rate * 2"
        );
    }

    #[test]
    fn preserves_unicode_text() {
        assert_eq!(
            rewrite_global_refs("# 中文注释 global.x stays 中文"),
            "# 中文注释 x stays 中文"
        );
    }
}

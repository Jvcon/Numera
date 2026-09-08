//! Expand `global.<name>(<args>)` calls by inlining the function body
//! defined in the globals file.
//!
//! `numr-core` stores variables but not user-defined function bodies, so
//! any `global.tax(price)` reference must be substituted at the call
//! site with the equivalent arithmetic expression. This module does a
//! single-pass rewrite using the `context.globals` map populated by
//! [`crate::eval::Engine::set_globals`].
//!
//! Supported grammar (deliberately narrow):
//!
//! ```text
//! definition := <ident> "(" <params> ")" "=" <body>
//! params     := <ident> ("," <ident>)*
//! call       := <ident> "(" <args> ")"
//! args       := <arg> ("," <arg>)*
//! arg        := any balanced expression (balanced parens, no strings)
//! ```
//!
//! Function bodies are inlined once per call site. The body is itself
//! run through this expander so a global function can call another.

use std::collections::HashMap;

#[derive(Debug)]
struct FunctionDef {
    params: Vec<String>,
    body: String,
}

/// Expand every `global.<name>(<args>)` call in `expr`, using `globals`
/// as the source for function definitions. `global.<ident>` (no parens)
/// is left to [`super::global_ref::rewrite_global_refs`].
pub fn expand_global_calls(expr: &str, globals: &HashMap<String, String>) -> String {
    let defs = parse_function_defs(globals);
    if defs.is_empty() {
        return expr.to_string();
    }

    let mut out = String::with_capacity(expr.len());
    let bytes = expr.as_bytes();
    let mut i = 0;
    let n = bytes.len();

    while i < n {
        // Look for "global." followed by an identifier and "(".
        if i + 7 < n
            && matches_keyword(bytes, i, b"global")
            && bytes[i + 6] == b'.'
            && is_ident_start(bytes[i + 7])
        {
            // Find end of identifier.
            let mut j = i + 8;
            while j < n && is_ident_continue(bytes[j]) {
                j += 1;
            }
            let name = &expr[i + 7..j];

            // Skip whitespace.
            let mut k = j;
            while k < n && bytes[k].is_ascii_whitespace() {
                k += 1;
            }

            if k < n && bytes[k] == b'(' && defs.contains_key(name) {
                // Parse the call's argument list (balanced parens).
                if let Some((args_text, end_pos)) = parse_call_args(expr, k) {
                    let args: Vec<String> = split_args(&args_text);
                    let def = &defs[name];
                    let body_substituted = substitute(&def.body, &def.params, &args);
                    // Recursively expand nested calls inside the inlined body.
                    let expanded = expand_global_calls(&body_substituted, globals);
                    out.push_str(&expanded);
                    i = end_pos;
                    continue;
                }
            }
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

fn parse_function_defs(globals: &HashMap<String, String>) -> HashMap<String, FunctionDef> {
    let mut out = HashMap::new();
    for (key, body) in globals {
        // The key is the LHS of `=`. For function definitions it is shaped
        // like `tax(price, fee)`; for plain values it is just an identifier.
        let bytes = key.as_bytes();
        if bytes.is_empty() || !is_ident_start(bytes[0]) {
            continue;
        }
        let mut j = 1;
        while j < bytes.len() && is_ident_continue(bytes[j]) {
            j += 1;
        }
        let name = &key[..j];
        let mut k = j;
        while k < bytes.len() && bytes[k].is_ascii_whitespace() {
            k += 1;
        }
        if k >= bytes.len() || bytes[k] != b'(' {
            continue;
        }
        let (params_text, _close_pos) = match parse_call_args(key, k) {
            Some(v) => v,
            None => continue,
        };
        let params: Vec<String> = split_args(&params_text)
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let body = body.trim();
        if params.is_empty() || body.is_empty() {
            continue;
        }
        out.insert(
            name.to_string(),
            FunctionDef {
                params,
                body: body.to_string(),
            },
        );
    }
    out
}

/// Given a string starting at `start` (which must point at `(`), return
/// `(args_inside, position_after_closing_paren)`. Returns `None` if the
/// parens are unbalanced.
fn parse_call_args(s: &str, start: usize) -> Option<(String, usize)> {
    let bytes = s.as_bytes();
    debug_assert_eq!(bytes[start], b'(');
    let mut depth = 1;
    let mut i = start + 1;
    while i < bytes.len() && depth > 0 {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => depth -= 1,
            _ => {}
        }
        if depth == 0 {
            return Some((s[start + 1..i].to_string(), i + 1));
        }
        i += 1;
    }
    None
}

/// Split a comma-separated argument list, respecting nested parens.
/// Each resulting segment is trimmed so the substitution step doesn't
/// carry spurious whitespace into the inlined body.
fn split_args(args: &str) -> Vec<String> {
    let bytes = args.as_bytes();
    let mut out = Vec::new();
    let mut start = 0usize;
    let mut depth: i32 = 0;
    for (i, &b) in bytes.iter().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b',' if depth == 0 => {
                out.push(args[start..i].trim().to_string());
                start = i + 1;
            }
            _ => {}
        }
    }
    if start < bytes.len() {
        out.push(args[start..].trim().to_string());
    }
    out
}

/// Replace each occurrence of `params[i]` with `args[i]` in `body`.
/// `params[i]` and `args[i]` are guaranteed to be non-empty by callers.
fn substitute(body: &str, params: &[String], args: &[String]) -> String {
    // Build a regex-like substitution by walking bytes and matching each
    // identifier; if it matches a param name we splice in the arg text.
    let bytes = body.as_bytes();
    let mut out = String::with_capacity(body.len());
    let mut i = 0;
    while i < bytes.len() {
        if is_ident_start(bytes[i]) {
            let mut j = i + 1;
            while j < bytes.len() && is_ident_continue(bytes[j]) {
                j += 1;
            }
            let word = &body[i..j];
            if let Some(idx) = params.iter().position(|p| p == word) {
                if let Some(arg) = args.get(idx) {
                    out.push_str(arg);
                    i = j;
                    continue;
                }
            }
            out.push_str(word);
            i = j;
        } else {
            out.push(body[i..].chars().next().unwrap());
            i += body[i..].chars().next().unwrap().len_utf8();
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn g(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn no_function_defs_returns_input() {
        let globals = g(&[("vat_rate", "0.2")]);
        let expr = "price * global.vat_rate";
        assert_eq!(expand_global_calls(expr, &globals), expr);
    }

    #[test]
    fn expands_single_arg_call() {
        let globals = g(&[("tax(price)", "price * 0.13")]);
        assert_eq!(
            expand_global_calls("tax_amount = global.tax(200)", &globals),
            "tax_amount = 200 * 0.13"
        );
    }

    #[test]
    fn expands_multi_arg_call() {
        let globals = g(&[("add(a, b)", "a + b")]);
        assert_eq!(
            expand_global_calls("result = global.add(3, 4)", &globals),
            "result = 3 + 4"
        );
    }

    #[test]
    fn supports_nested_calls() {
        let globals = g(&[
            ("tax(price)", "price * 0.13"),
            ("double(x)", "x * 2"),
        ]);
        assert_eq!(
            expand_global_calls("y = global.double(global.tax(100))", &globals),
            "y = 100 * 0.13 * 2"
        );
    }

    #[test]
    fn does_not_match_non_function_global() {
        // `global.vat_rate` (no parens) is left for the identifier stripper.
        let globals = g(&[("vat_rate", "0.2")]);
        let expr = "total = price * global.vat_rate";
        assert_eq!(expand_global_calls(expr, &globals), expr);
    }

    #[test]
    fn handles_nested_parens_in_args() {
        let globals = g(&[("scale(x, n)", "x * n")]);
        assert_eq!(
            expand_global_calls("y = global.scale(2 + 3, 4)", &globals),
            "y = 2 + 3 * 4"
        );
    }
}

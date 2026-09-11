//! Chinese / local unit preprocessing.
//!
//! numr-core's unit registry is a read-only `LazyLock` table and its Pest
//! grammar only accepts **ASCII** identifiers, so Chinese unit tokens such as
//! `斤` / `两` / `亩` / `尺` / `元` can never reach the parser. The only viable
//! approach is to rewrite `number + Chinese unit` sequences into an equivalent
//! ASCII expression *before* numr-core sees them.
//!
//! ## Rewrite format
//!
//! Physical units are rewritten as an exact rational expression:
//!
//! ```text
//! 3斤   -> (3 * 1 kg / 2)        // 1 斤 = 1/2 kg = 500 g
//! 2两   -> (2 * 1 kg / 20)       // 1 两 = 1/20 kg = 50 g
//! 5亩   -> (5 * 2000 m2 / 3)     // 1 亩 = 2000/3 m²
//! 3尺   -> (3 * 1 m / 3)         // 1 尺 = 1/3 m
//! 3寸   -> (3 * 1 m / 30)        // 1 寸 = 1/30 m
//! 3里   -> (3 * 1 km / 2)        // 1 里 = 1/2 km = 500 m
//! 800大卡 -> (800 * 1 kcal / 1)  // 1 大卡 = 1 千卡 = 1 kcal
//! ```
//!
//! Currency is rewritten without a multiplication factor:
//!
//! ```text
//! 100元 -> (100 CNY)
//! 3块   -> (3 CNY)
//! ```
//!
//! The rational form (`num * numerator target / denominator`) is deliberate:
//! a truncated decimal factor such as `0.3333333333` makes `3尺` evaluate to
//! `0.9999999999 m` instead of exactly `1 m`. Keeping the factor as a fraction
//! lets numr-core's exact `Decimal` arithmetic produce the exact result.
//!
//! The area target is `m2` (the ASCII alias registered by numr-core) rather
//! than the Unicode `m²`, because the grammar's `identifier` rule is ASCII
//! only. numr-core still *displays* the result as `m²`.
//!
//! Every replacement is wrapped in parentheses so it composes safely with the
//! surrounding expression regardless of operator precedence.
//!
//! ## Scope (MVP)
//!
//! Only `arabic number + single Chinese unit suffix` is handled. Compound
//! expressions (`3斤2两`), Chinese numerals (`三斤`), SI names (`公斤`/`公里`),
//! and ambiguous single-character units (`钱`/`分`/`卡`) are intentionally out
//! of scope.

/// How a matched Chinese unit maps onto a numr-core-compatible expression.
enum ZhUnit {
    /// `<num> * <numerator> <target> / <denominator>` — an exact rational
    /// scaling into an ASCII unit.
    Physical {
        numerator: &'static str,
        target: &'static str,
        denominator: &'static str,
    },
    /// `<num> <target>` — a currency amount (no scaling factor).
    Currency { target: &'static str },
}

/// Chinese unit tokens, longest-first so multi-character tokens win.
///
/// Factors are the exact market-system (市制) definitions:
/// - 斤 = 500 g = 1/2 kg
/// - 两 = 50 g = 1/20 kg
/// - 亩 = 2000/3 m² ≈ 666.6666666667 m²
/// - 尺 = 1/3 m ≈ 0.3333333333 m
/// - 寸 = 1/30 m ≈ 0.0333333333 m
/// - 里 = 500 m = 1/2 km
/// - 大卡 / 千卡 = 1 kcal
/// - 元 / 块 = 1 CNY
const ZH_UNITS: &[(&str, ZhUnit)] = &[
    (
        "大卡",
        ZhUnit::Physical {
            numerator: "1",
            target: "kcal",
            denominator: "1",
        },
    ),
    (
        "千卡",
        ZhUnit::Physical {
            numerator: "1",
            target: "kcal",
            denominator: "1",
        },
    ),
    (
        "斤",
        ZhUnit::Physical {
            numerator: "1",
            target: "kg",
            denominator: "2",
        },
    ),
    (
        "两",
        ZhUnit::Physical {
            numerator: "1",
            target: "kg",
            denominator: "20",
        },
    ),
    (
        "亩",
        ZhUnit::Physical {
            numerator: "2000",
            target: "m2",
            denominator: "3",
        },
    ),
    (
        "尺",
        ZhUnit::Physical {
            numerator: "1",
            target: "m",
            denominator: "3",
        },
    ),
    (
        "寸",
        ZhUnit::Physical {
            numerator: "1",
            target: "m",
            denominator: "30",
        },
    ),
    (
        "里",
        ZhUnit::Physical {
            numerator: "1",
            target: "km",
            denominator: "2",
        },
    ),
    ("元", ZhUnit::Currency { target: "CNY" }),
    ("块", ZhUnit::Currency { target: "CNY" }),
];

/// Rewrite `number + Chinese unit` sequences in `expr` into an expression
/// numr-core can parse. Non-matching text is copied through verbatim.
///
/// The scan is comment- and string-aware: everything after a `#` or `//`
/// comment marker (outside a `"..."` string) is copied unchanged, so a Chinese
/// unit mentioned in a comment is never rewritten. A number is only considered
/// when it is not glued to a preceding identifier character (`[A-Za-z0-9_.]`),
/// which keeps names like `x1斤` or `斤价` untouched.
pub fn rewrite_zh_units(expr: &str) -> String {
    let chars: Vec<char> = expr.chars().collect();
    let mut out = String::with_capacity(expr.len());
    let mut i = 0usize;
    let mut in_string = false;

    while i < chars.len() {
        let c = chars[i];

        // Comment start (outside a string): copy the remainder verbatim.
        if !in_string && (c == '#' || (c == '/' && chars.get(i + 1) == Some(&'/'))) {
            out.extend(chars[i..].iter());
            break;
        }

        if c == '"' {
            in_string = !in_string;
            out.push(c);
            i += 1;
            continue;
        }

        if !in_string && c.is_ascii_digit() {
            let boundary_ok = i == 0 || {
                let prev = chars[i - 1];
                !(prev.is_ascii_alphanumeric() || prev == '_' || prev == '.')
            };
            if boundary_ok {
                if let Some(num_end) = scan_number(&chars, i) {
                    if let Some((unit_end, replacement)) = match_unit(&chars, num_end, i) {
                        out.push('(');
                        out.push_str(&replacement);
                        out.push(')');
                        i = unit_end;
                        continue;
                    }
                }
            }
        }

        out.push(c);
        i += 1;
    }

    out
}

/// Scan an integer or decimal number starting at `start` (an ASCII digit).
/// Returns the exclusive end index, or `None` when no digits are present.
///
/// A `.` is only consumed when followed by a digit, so `3.` / `3.斤` keep the
/// dot out of the number.
fn scan_number(chars: &[char], start: usize) -> Option<usize> {
    let mut i = start;
    while i < chars.len() && chars[i].is_ascii_digit() {
        i += 1;
    }
    if i == start {
        return None;
    }
    if i + 1 < chars.len() && chars[i] == '.' && chars[i + 1].is_ascii_digit() {
        i += 1; // consume '.'
        while i < chars.len() && chars[i].is_ascii_digit() {
            i += 1;
        }
    }
    Some(i)
}

/// Try to match a Chinese unit immediately after `num_end`, allowing spaces
/// and tabs between the number and the unit. Returns the exclusive end index
/// of the unit and its numr-core replacement expression, or `None`.
fn match_unit(chars: &[char], num_end: usize, num_start: usize) -> Option<(usize, String)> {
    let mut j = num_end;
    while j < chars.len() && (chars[j] == ' ' || chars[j] == '\t') {
        j += 1;
    }

    for (token, kind) in ZH_UNITS {
        let token_chars: Vec<char> = token.chars().collect();
        if chars[j..].starts_with(&token_chars) {
            let end = j + token_chars.len();
            let number: String = chars[num_start..num_end].iter().collect();
            return Some((end, render(&number, kind)));
        }
    }

    None
}

/// Render the numr-core expression for `number` scaled by `kind`.
fn render(number: &str, kind: &ZhUnit) -> String {
    match kind {
        ZhUnit::Physical {
            numerator,
            target,
            denominator,
        } => format!("{number} * {numerator} {target} / {denominator}"),
        ZhUnit::Currency { target } => format!("{number} {target}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rewrites_jin_to_exact_kg() {
        assert_eq!(rewrite_zh_units("3斤"), "(3 * 1 kg / 2)");
    }

    #[test]
    fn rewrites_liang_to_exact_kg() {
        assert_eq!(rewrite_zh_units("2两"), "(2 * 1 kg / 20)");
    }

    #[test]
    fn rewrites_mu_to_ascii_square_meters() {
        assert_eq!(rewrite_zh_units("5亩"), "(5 * 2000 m2 / 3)");
    }

    #[test]
    fn rewrites_chi_and_cun() {
        assert_eq!(rewrite_zh_units("3尺"), "(3 * 1 m / 3)");
        assert_eq!(rewrite_zh_units("3寸"), "(3 * 1 m / 30)");
    }

    #[test]
    fn rewrites_li_to_km() {
        assert_eq!(rewrite_zh_units("3里"), "(3 * 1 km / 2)");
    }

    #[test]
    fn rewrites_kilocalorie_aliases() {
        assert_eq!(rewrite_zh_units("800大卡"), "(800 * 1 kcal / 1)");
        assert_eq!(rewrite_zh_units("800千卡"), "(800 * 1 kcal / 1)");
    }

    #[test]
    fn rewrites_yuan_and_kuai_to_cny() {
        assert_eq!(rewrite_zh_units("100元"), "(100 CNY)");
        assert_eq!(rewrite_zh_units("3块"), "(3 CNY)");
    }

    #[test]
    fn allows_a_single_space_between_number_and_unit() {
        assert_eq!(rewrite_zh_units("3 斤"), "(3 * 1 kg / 2)");
    }

    #[test]
    fn supports_decimals() {
        assert_eq!(rewrite_zh_units("1.5斤"), "(1.5 * 1 kg / 2)");
    }

    #[test]
    fn rewrites_units_inside_arithmetic() {
        assert_eq!(
            rewrite_zh_units("3斤 + 2斤"),
            "(3 * 1 kg / 2) + (2 * 1 kg / 2)"
        );
    }

    #[test]
    fn leaves_comments_untouched() {
        assert_eq!(rewrite_zh_units("# 3斤"), "# 3斤");
        assert_eq!(rewrite_zh_units("1 + 2 # 3斤"), "1 + 2 # 3斤");
        assert_eq!(rewrite_zh_units("1 + 2 // 3斤"), "1 + 2 // 3斤");
    }

    #[test]
    fn does_not_rewrite_when_number_is_glued_to_identifier() {
        // `x1斤` / `斤价` must not be treated as a numeric unit suffix.
        assert_eq!(rewrite_zh_units("x1斤"), "x1斤");
        assert_eq!(rewrite_zh_units("斤价 = 3"), "斤价 = 3");
        assert_eq!(rewrite_zh_units("price_1斤"), "price_1斤");
    }

    #[test]
    fn does_not_rewrite_unknown_measure_words() {
        assert_eq!(rewrite_zh_units("3 个"), "3 个");
        assert_eq!(rewrite_zh_units("3公斤"), "3公斤");
    }

    #[test]
    fn rewrite_is_idempotent() {
        let once = rewrite_zh_units("3斤 + 100元");
        assert_eq!(rewrite_zh_units(&once), once);
    }

    #[test]
    fn leaves_plain_ascii_expressions_unchanged() {
        assert_eq!(rewrite_zh_units("1 + 2 * 3"), "1 + 2 * 3");
    }
}

/// A parsed cross-file reference.
///
/// `file("name")` has no member and resolves to the first exported
/// variable of the target document (legacy behaviour). `file("name").var`
/// carries `member = Some("var")` and resolves to that specific variable.
#[derive(Debug, Clone, PartialEq)]
pub struct FileReference {
    pub filename: String,
    pub member: Option<String>,
}

/// Cross-file reference parser.
///
/// Resolution (turning a reference into a computed value) lives in
/// [`crate::eval::Engine::resolve_value_references`]; this type only finds
/// and describes `file(...)` occurrences inside an expression.
pub struct ReferenceEvaluator;

impl ReferenceEvaluator {
    /// Check if an expression contains a file reference.
    ///
    /// Reuses the real parser so the answer is case-insensitive and
    /// word-boundary aware: `profile(...)` / `files(...)` are not
    /// references, while `FiLe(...)` is.
    pub fn contains_reference(expr: &str) -> bool {
        !Self::extract_file_references(expr).is_empty()
    }

    /// Extract the file names from `file(...)` references in an expression.
    ///
    /// Kept for backward compatibility; use [`Self::extract_file_references`]
    /// when the optional `.member` part is needed.
    pub fn extract_references(expr: &str) -> Vec<String> {
        Self::extract_file_references(expr)
            .into_iter()
            .map(|reference| reference.filename)
            .collect()
    }

    /// Extract full cross-file references, including the optional member
    /// variable (`file("budget").food` → `{ filename: "budget", member:
    /// Some("food") }`).
    pub fn extract_file_references(expr: &str) -> Vec<FileReference> {
        let chars: Vec<char> = expr.chars().collect();
        let mut references = Vec::new();
        let mut i = 0usize;

        while i < chars.len() {
            if let Some((reference, next)) = Self::parse_reference_at(&chars, i) {
                references.push(reference);
                i = next;
            } else {
                i += 1;
            }
        }

        references
    }

    /// Try to parse a `file("name")` / `file("name").member` reference
    /// starting exactly at `start`. Returns the parsed reference and the
    /// index just past it (including the member, when present).
    pub(crate) fn parse_reference_at(chars: &[char], start: usize) -> Option<(FileReference, usize)> {
        // The `file` keyword must start at a word boundary.
        if start > 0 && is_ident_char(chars[start - 1]) {
            return None;
        }
        if !matches!(chars.get(start), Some('f') | Some('F')) {
            return None;
        }
        if start + 4 > chars.len()
            || !chars[start + 1].eq_ignore_ascii_case(&'i')
            || !chars[start + 2].eq_ignore_ascii_case(&'l')
            || !chars[start + 3].eq_ignore_ascii_case(&'e')
        {
            return None;
        }
        // Must not be part of a longer identifier (e.g. `files(`).
        if chars.get(start + 4).map_or(false, |c| is_ident_char(*c)) {
            return None;
        }

        // Skip whitespace between `file` and `(`.
        let mut i = start + 4;
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        if chars.get(i) != Some(&'(') {
            return None;
        }
        i += 1;

        // Read the filename up to the closing parenthesis, ignoring quotes.
        let mut filename = String::new();
        while i < chars.len() && chars[i] != ')' {
            if chars[i] != '"' && chars[i] != '\'' {
                filename.push(chars[i]);
            }
            i += 1;
        }
        if i < chars.len() {
            i += 1; // consume ')'
        }
        let filename = filename.trim().to_string();
        if filename.is_empty() {
            return None;
        }

        // Optional `.member` suffix.
        let mut j = i;
        while j < chars.len() && chars[j].is_whitespace() {
            j += 1;
        }
        let mut member = None;
        if chars.get(j) == Some(&'.') {
            j += 1;
            let member_start = j;
            while j < chars.len() && is_ident_char(chars[j]) {
                j += 1;
            }
            if j > member_start {
                member = Some(chars[member_start..j].iter().collect::<String>());
            }
        }

        let end = if member.is_some() { j } else { i };
        Some((FileReference { filename, member }, end))
    }
}

/// True for characters that can appear in an identifier.
fn is_ident_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::context::EngineContext;

    fn refs(expr: &str) -> Vec<FileReference> {
        ReferenceEvaluator::extract_file_references(expr)
    }

    fn ref_names(expr: &str) -> Vec<String> {
        ReferenceEvaluator::extract_references(expr)
    }

    #[test]
    fn test_extract_references() {
        let names = ref_names("file(\"budget\") + file('savings')");
        assert_eq!(names, vec!["budget", "savings"]);
    }

    #[test]
    fn test_extract_file_references_with_members() {
        let parsed = refs("file(\"budget\").food + file('savings')");
        assert_eq!(
            parsed,
            vec![
                FileReference {
                    filename: "budget".to_string(),
                    member: Some("food".to_string()),
                },
                FileReference {
                    filename: "savings".to_string(),
                    member: None,
                },
            ]
        );
    }

    #[test]
    fn test_contains_reference() {
        assert!(ReferenceEvaluator::contains_reference("file(\"test\")"));
        assert!(!ReferenceEvaluator::contains_reference("100 + 200"));
    }

    #[test]
    fn test_simple_file_reference_by_path() {
        assert_eq!(
            refs("x = file(\"daily\")"),
            vec![FileReference {
                filename: "daily".to_string(),
                member: None,
            }]
        );
    }

    #[test]
    fn test_numr_suffix_is_part_of_the_name() {
        assert_eq!(
            refs("x = file(\"daily.numr\")"),
            vec![FileReference {
                filename: "daily.numr".to_string(),
                member: None,
            }]
        );
    }

    #[test]
    fn test_subdirectory_path() {
        assert_eq!(
            refs("x = file(\"daily/2026-09-07\")"),
            vec![FileReference {
                filename: "daily/2026-09-07".to_string(),
                member: None,
            }]
        );
    }

    #[test]
    fn test_bare_reference_has_no_member() {
        assert_eq!(
            refs("x = file(\"multi\")"),
            vec![FileReference {
                filename: "multi".to_string(),
                member: None,
            }]
        );
    }

    #[test]
    fn test_single_quote_style_also_works() {
        assert_eq!(
            refs("x = file('daily')"),
            vec![FileReference {
                filename: "daily".to_string(),
                member: None,
            }]
        );
    }

    #[test]
    fn test_member_access_resolves_named_export() {
        assert_eq!(
            refs("x = file(\"budget\").food"),
            vec![FileReference {
                filename: "budget".to_string(),
                member: Some("food".to_string()),
            }]
        );
    }

    #[test]
    fn test_member_access_resolves_non_first_export() {
        assert_eq!(
            refs("x = file(\"budget\").rent"),
            vec![FileReference {
                filename: "budget".to_string(),
                member: Some("rent".to_string()),
            }]
        );
    }

    #[test]
    fn test_member_access_with_single_quotes() {
        assert_eq!(
            refs("x = File('budget').rent"),
            vec![FileReference {
                filename: "budget".to_string(),
                member: Some("rent".to_string()),
            }]
        );
    }

    #[test]
    fn test_mixed_member_references_in_one_expression() {
        assert_eq!(
            refs("x = sum(file(\"budget\").food, file(\"budget\").rent)"),
            vec![
                FileReference {
                    filename: "budget".to_string(),
                    member: Some("food".to_string()),
                },
                FileReference {
                    filename: "budget".to_string(),
                    member: Some("rent".to_string()),
                },
            ]
        );
    }

    #[test]
    fn test_profile_call_is_not_mistaken_for_file_reference() {
        // `profile(` contains the `file(` substring but is a different
        // identifier: the word-boundary check must reject it (regression: the
        // old TS regex used to match it).
        assert!(refs("x = profile(\"daily\")").is_empty());
        assert!(!ReferenceEvaluator::contains_reference("x = profile(\"daily\")"));
    }

    #[test]
    fn test_mixed_case_keyword_is_recognized() {
        assert_eq!(
            refs("FiLe(\"a\").food + fIlE('a').rent"),
            vec![
                FileReference {
                    filename: "a".to_string(),
                    member: Some("food".to_string()),
                },
                FileReference {
                    filename: "a".to_string(),
                    member: Some("rent".to_string()),
                },
            ]
        );
    }

    #[test]
    fn test_files_identifier_is_not_a_reference() {
        assert!(refs("x = files(\"a\")").is_empty());
    }

    #[test]
    fn test_resolve_document_path_prefers_exact_then_extension() {
        let mut context = EngineContext::new();
        context.load_document("daily", "x = 1");
        context.load_document("budget.numr", "y = 2");
        assert_eq!(
            context.resolve_file_path("daily"),
            Some("daily".to_string())
        );
        assert_eq!(
            context.resolve_file_path("budget"),
            Some("budget.numr".to_string())
        );
        assert_eq!(context.resolve_file_path("ghost"), None);
    }
}

use crate::context::EngineContext;
use crate::error::EngineError;

/// Cross-file reference evaluator
pub struct ReferenceEvaluator;

impl ReferenceEvaluator {
    /// Check if an expression contains a file reference
    pub fn contains_reference(expr: &str) -> bool {
        expr.contains("file(") || expr.contains("File(")
    }

    /// Extract file references from an expression
    pub fn extract_references(expr: &str) -> Vec<String> {
        let mut references = Vec::new();
        let mut chars = expr.chars().peekable();

        while let Some(c) = chars.next() {
            if c == 'f' || c == 'F' {
                let mut word = String::from(c);
                while let Some(&next) = chars.peek() {
                    if next.is_alphanumeric() {
                        word.push(next);
                        chars.next();
                    } else {
                        break;
                    }
                }

                if word.to_lowercase() == "file" {
                    // Skip whitespace
                    while let Some(&next) = chars.peek() {
                        if next.is_whitespace() {
                            chars.next();
                        } else {
                            break;
                        }
                    }

                    // Expect opening parenthesis
                    if chars.peek() == Some(&'(') {
                        chars.next();
                        let mut filename = String::new();

                        // Read until closing parenthesis
                        while let Some(next) = chars.next() {
                            if next == ')' {
                                break;
                            }
                            if next == '"' || next == '\'' {
                                continue;
                            }
                            filename.push(next);
                        }

                        let filename = filename.trim().to_string();
                        if !filename.is_empty() {
                            references.push(filename);
                        }
                    }
                }
            }
        }

        references
    }

    /// Evaluate a file reference, returning the exported variables
    pub fn evaluate_reference(
        filename: &str,
        context: &EngineContext,
    ) -> Result<Vec<(String, String)>, EngineError> {
        let resolved_path = context.resolve_file_path(filename)
            .ok_or_else(|| EngineError::FileNotFound(filename.to_string()))?;

        let content = context.get_document(&resolved_path)
            .ok_or_else(|| EngineError::FileNotFound(resolved_path.clone()))?;

        // Parse the file and extract variable assignments
        let mut variables = Vec::new();
        for line in content.lines() {
            let line = line.trim();
            
            // Skip comments and empty lines
            if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
                continue;
            }

            // Look for variable assignments
            if let Some(eq_pos) = line.find('=') {
                let var_name = line[..eq_pos].trim();
                let var_value = line[eq_pos + 1..].trim();

                // Only export non-empty variables
                if !var_name.is_empty() && !var_value.is_empty() {
                    variables.push((var_name.to_string(), var_value.to_string()));
                }
            }
        }

        Ok(variables)
    }

    /// Replace file references in an expression with their values
    pub fn resolve_references(
        expr: &str,
        context: &EngineContext,
    ) -> Result<String, EngineError> {
        let mut result = expr.to_string();
        let references = Self::extract_references(expr);

        for filename in references {
            let ref_pattern = format!("file(\"{}\")", filename);
            let alt_ref_pattern = format!("file('{}')", filename);
            let cap_ref_pattern = format!("File(\"{}\")", filename);

            // Get the first variable value from the referenced file
            if let Ok(vars) = Self::evaluate_reference(&filename, context) {
                if let Some((_, value)) = vars.first() {
                    result = result.replace(&ref_pattern, value);
                    result = result.replace(&alt_ref_pattern, value);
                    result = result.replace(&cap_ref_pattern, value);
                }
            }
        }

        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_references() {
        let refs = ReferenceEvaluator::extract_references("file(\"budget\") + file('savings')");
        assert_eq!(refs, vec!["budget", "savings"]);
    }

    #[test]
    fn test_contains_reference() {
        assert!(ReferenceEvaluator::contains_reference("file(\"test\")"));
        assert!(!ReferenceEvaluator::contains_reference("100 + 200"));
    }
}

use std::collections::HashMap;
use numr_core::{Engine as CoreEngine, Value};
use serde::{Deserialize, Serialize};
use crate::context::EngineContext;
use crate::date::DateTimeEvaluator;
use crate::error::EngineError;
use crate::function_call::expand_global_calls;
use crate::global_ref::rewrite_global_refs;
use crate::reference::ReferenceEvaluator;
use crate::aggregate::AggregationEvaluator;

/// Per-line evaluation outcome exposed to the editor layer.
///
/// `display` is the formatted result the editor renders inline. For empty
/// lines and comments it is the empty string and `is_empty` is true.
/// `error` carries the human-readable failure message when `is_error`
/// is true.
///
/// Serialized field names use camelCase to match the JS `LineOutcome`
/// interface in `web/src/lib/engine.ts` (`isEmpty`, `isError`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineOutcome {
    pub display: String,
    pub error: Option<String>,
    pub is_empty: bool,
    pub is_error: bool,
}

impl LineOutcome {
    fn empty() -> Self {
        Self {
            display: String::new(),
            error: None,
            is_empty: true,
            is_error: false,
        }
    }

    fn value(display: String) -> Self {
        Self {
            display,
            error: None,
            is_empty: false,
            is_error: false,
        }
    }

    fn failure(message: String) -> Self {
        Self {
            display: String::new(),
            error: Some(message),
            is_empty: false,
            is_error: true,
        }
    }
}

/// Main engine that extends numr-core with additional features
pub struct Engine {
    core: CoreEngine,
    context: EngineContext,
    /// Cached globals content, replayed before every document evaluation
    /// so subsequent calls don't have to remember to inject.
    globals_content: String,
}

impl Engine {
    /// Create a new engine instance
    pub fn new() -> Self {
        Self {
            core: CoreEngine::new(),
            context: EngineContext::new(),
            globals_content: String::new(),
        }
    }

    /// Create an engine with a specific context
    pub fn with_context(context: EngineContext) -> Self {
        Self {
            core: CoreEngine::new(),
            context,
            globals_content: String::new(),
        }
    }

    pub fn context(&self) -> &EngineContext {
        &self.context
    }

    pub fn context_mut(&mut self) -> &mut EngineContext {
        &mut self.context
    }

    /// Set the globals content (`globals.numr`).
    ///
    /// Globals are split into two buckets:
    ///   - **Variables** (`vat_rate = 0.2`) — injected into numr-core so
    ///     subsequent expressions resolve them as plain variables.
    ///   - **Functions** (`tax(price) = price * 0.13`) — kept in the
    ///     engine context and inlined at call sites by
    ///     [`crate::function_call::expand_global_calls`]. numr-core does
    ///     not support user-defined functions, so we never push them
    ///     into its variable table.
    pub fn set_globals(&mut self, content: &str) {
        let mut globals = HashMap::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
                continue;
            }
            if let Some(eq_pos) = line.find('=') {
                let name = line[..eq_pos].trim().to_string();
                let value = line[eq_pos + 1..].trim().to_string();
                if !name.is_empty() {
                    globals.insert(name, value);
                }
            }
        }
        self.context.set_globals(globals);
        self.globals_content = content.to_string();
    }

    /// Inject the variable-shaped globals (those without `(...)` in the
    /// LHS) into the underlying numr-core engine. Function-shaped
    /// globals are intentionally left out — they are expanded on demand
    /// during eval.
    fn inject_globals(&mut self) -> Result<(), String> {
        for (key, value) in &self.context.globals {
            if !looks_like_function_def(key) {
                let line = format!("{} = {}", key, value);
                let outcome = self.core.eval(&line);
                if outcome.is_error() {
                    return Err(outcome.to_string());
                }
            }
        }
        Ok(())
    }

    /// Evaluate a single expression in the current engine state.
    /// `global.<name>` references are rewritten to plain `<name>`; globals
    /// must already be loaded (via [`set_globals`]) so numr-core can find
    /// them.
    pub fn eval(&mut self, expr: &str) -> Result<String, EngineError> {
        let trimmed = expr.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
            return Ok(String::new());
        }

        if DateTimeEvaluator::is_datetime_expression(trimmed) {
            return DateTimeEvaluator::evaluate(trimmed);
        }

        if AggregationEvaluator::is_aggregation(trimmed) {
            let result = AggregationEvaluator::evaluate(trimmed)
                .map_err(|e| EngineError::EvalError(e.to_string()))?;
            return Ok(self.format_number(result));
        }

        let rewritten = rewrite_global_refs(trimmed);
        let expanded = expand_global_calls(&rewritten, &self.context.globals);
        let resolved = if ReferenceEvaluator::contains_reference(&expanded) {
            ReferenceEvaluator::resolve_references(&expanded, &self.context)
                .map_err(|e| EngineError::ReferenceError(e.to_string()))?
        } else {
            expanded
        };

        let value = self.core.eval(&resolved);
        if let Some(err) = value.as_error() {
            // numr-core returns computation failures as `Value::Error`;
            // surface them as a typed error so the editor marks the line
            // `is_error` and shows the message on demand.
            return Err(EngineError::EvalError(err.to_string()));
        }
        Ok(format_value(&value))
    }

    fn format_number(&self, value: f64) -> String {
        if value == value.floor() && value.abs() < 1e15 {
            format!("{}", value as i64)
        } else {
            format!("{}", value)
        }
    }

    /// Evaluate every line of a document with the cached globals as
    /// setup. Returns one [`LineOutcome`] per input line, in order.
    ///
    /// This is the primary entry point for editor integrations: globals
    /// are pre-injected into numr-core, then each document line is
    /// evaluated sequentially so variable assignments compound (just like
    /// a user types them top to bottom).
    pub fn evaluate_document(&mut self, document: &str) -> Vec<LineOutcome> {
        self.core.clear();

        let globals_failed = match self.inject_globals() {
            Ok(()) => None,
            Err(msg) => Some(msg),
        };

        let mut outcomes = Vec::with_capacity(document.lines().count());
        for line in document.lines() {
            let outcome = if let Some(msg) = globals_failed.as_ref() {
                LineOutcome::failure(msg.clone())
            } else {
                match self.eval(line) {
                    Ok(display) if display.is_empty() => LineOutcome::empty(),
                    Ok(display) => LineOutcome::value(display),
                    Err(e) => LineOutcome::failure(e.to_string()),
                }
            };
            outcomes.push(outcome);
        }
        outcomes
    }

    pub fn load_document(&mut self, name: &str, content: &str) {
        self.context.load_document(name, content);
    }

    pub fn set_current_document(&mut self, name: Option<String>) {
        self.context.set_current_document(name);
    }

    pub fn clear(&mut self) {
        self.core.clear();
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

/// Format a numr-core [`Value`] for display in the editor gutter.
fn format_value(value: &Value) -> String {
    value.to_string()
}

/// True when a globals map key encodes a function definition —
/// i.e. `name(params)`. Plain variables never contain `(`.
fn looks_like_function_def(key: &str) -> bool {
    key.contains('(')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic_eval() {
        let mut engine = Engine::new();
        let result = engine.eval("100 + 200").unwrap();
        assert_eq!(result, "300");
    }

    #[test]
    fn test_variable_assignment() {
        let mut engine = Engine::new();
        engine.eval("x = 100").unwrap();
        let result = engine.eval("x + 50").unwrap();
        assert_eq!(result, "150");
    }

    #[test]
    fn test_comment_yields_empty_string() {
        let mut engine = Engine::new();
        let result = engine.eval("# This is a comment").unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_globals_are_injected_into_document_eval() {
        let mut engine = Engine::new();
        engine.set_globals(
            r#"
                tax_rate = 13%
                vat_rate = 0.2
            "#,
        );
        let outcomes = engine.evaluate_document(
            "price = 100\ntotal = price * global.vat_rate\n# done",
        );
        assert_eq!(outcomes.len(), 3);
        assert!(outcomes[0].display.contains("100"), "{}", outcomes[0].display);
        assert!(outcomes[1].display.contains("20"), "{}", outcomes[1].display);
        assert!(outcomes[2].is_empty, "comment should be empty");
    }

    #[test]
    fn test_global_function_call_rewritten() {
        let mut engine = Engine::new();
        // numr-core supports simple function definition syntax; we just
        // need the rewrite to feed it the right name.
        engine.set_globals(
            r#"
                tax(price) = price * 0.13
            "#,
        );
        let outcomes = engine.evaluate_document(
            "price = 200\ntax_amount = global.tax(price)",
        );
        assert_eq!(outcomes.len(), 2);
        assert!(outcomes[1].display.contains("26"), "{}", outcomes[1].display);
    }

    #[test]
    fn test_globals_failure_propagates_per_line() {
        let mut engine = Engine::new();
        // Globals that reference an undefined RHS variable must fail in
        // numr-core; the engine should surface the diagnostic on every
        // document line so the editor highlights them.
        engine.set_globals("bad = unknown_var + 1");
        let outcomes = engine.evaluate_document("100 + 200");
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].is_error, "globals failure must surface on every line");
    }

    #[test]
    fn test_empty_lines_and_comments_skip_eval() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("\n# hi\n\n42\n");
        assert_eq!(outcomes.len(), 4);
        assert!(outcomes[0].is_empty);
        assert!(outcomes[1].is_empty);
        assert!(outcomes[2].is_empty);
        assert!(!outcomes[3].is_empty);
    }

    #[test]
    fn test_no_globals_still_evaluates() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("1 + 1");
        assert_eq!(outcomes[0].display, "2");
    }

    #[test]
    fn test_error_value_is_marked_as_error() {
        let mut engine = Engine::new();
        // `unknown_thing` is undefined → numr-core yields `Value::Error`.
        // The engine must mark the line `is_error`, not return it as a
        // successful display value.
        let outcomes = engine.evaluate_document("1 + unknown_thing");
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].is_error, "undefined variable must be an error");
        assert!(outcomes[0].error.is_some());
        assert!(outcomes[0].display.is_empty());
    }

    #[test]
    fn test_successful_value_is_not_marked_as_error() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("2 + 3");
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].is_error);
        assert!(outcomes[0].error.is_none());
        assert_eq!(outcomes[0].display, "5");
    }

    #[test]
    fn test_line_outcome_serializes_camel_case() {
        // The JS `LineOutcome` interface uses camelCase (`isEmpty`,
        // `isError`); a snake_case serialization would silently break
        // error rendering in the editor.
        let outcome = LineOutcome {
            display: String::new(),
            error: Some("bad".to_string()),
            is_empty: false,
            is_error: true,
        };
        let json = serde_json::to_value(&outcome).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("isEmpty"), "missing isEmpty: {json}");
        assert!(obj.contains_key("isError"), "missing isError: {json}");
        assert!(!obj.contains_key("is_empty"));
        assert!(!obj.contains_key("is_error"));
        assert_eq!(obj["isError"], serde_json::json!(true));
    }
}

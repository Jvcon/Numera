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
/// `kind` classifies the result value (`"number" | "date" | "string" |
/// "empty" | "error"`) and `raw_value` carries the machine-readable
/// original — a JSON number for numbers, an ISO-8601 string for dates,
/// `Null` for empty/error lines. The JS layer uses these two fields to
/// re-format results with `Intl` per locale / precision / grouping
/// settings; `display` remains the engine-formatted fallback.
///
/// Serialized field names use camelCase to match the JS `LineOutcome`
/// interface in `web/src/lib/engine.ts` (`isEmpty`, `isError`,
/// `rawValue`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineOutcome {
    pub display: String,
    pub error: Option<String>,
    pub is_empty: bool,
    pub is_error: bool,
    pub kind: String,
    pub raw_value: serde_json::Value,
}

impl LineOutcome {
    fn empty() -> Self {
        Self {
            display: String::new(),
            error: None,
            is_empty: true,
            is_error: false,
            kind: "empty".to_string(),
            raw_value: serde_json::Value::Null,
        }
    }

    fn value(display: String, kind: &str, raw_value: serde_json::Value) -> Self {
        Self {
            display,
            error: None,
            is_empty: false,
            is_error: false,
            kind: kind.to_string(),
            raw_value,
        }
    }

    fn failure(message: String) -> Self {
        Self {
            display: String::new(),
            error: Some(message),
            is_empty: false,
            is_error: true,
            kind: "error".to_string(),
            raw_value: serde_json::Value::Null,
        }
    }
}

/// Typed evaluation result: the formatted `display` string plus the
/// metadata the JS layer needs to re-format the raw value locally.
pub(crate) struct EvalValue {
    pub display: String,
    pub kind: &'static str,
    pub raw_value: serde_json::Value,
}

impl EvalValue {
    fn empty() -> Self {
        Self {
            display: String::new(),
            kind: "empty",
            raw_value: serde_json::Value::Null,
        }
    }

    /// Number result. `raw_value` is the exact f64 when it is JSON
    /// representable; NaN / Inf (which `serde_json` cannot carry) fall
    /// back to `Null` while keeping the display string.
    fn number(display: String, value: f64) -> Self {
        let raw_value = serde_json::Number::from_f64(value)
            .map(serde_json::Value::Number)
            .unwrap_or(serde_json::Value::Null);
        Self {
            display,
            kind: "number",
            raw_value,
        }
    }

    fn date(display: String, iso: String) -> Self {
        Self {
            display,
            kind: "date",
            raw_value: serde_json::Value::String(iso),
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
    ///
    /// Returns only the display string; callers needing the typed raw
    /// value (kind / raw_value) should use [`Self::eval_typed`].
    pub fn eval(&mut self, expr: &str) -> Result<String, EngineError> {
        self.eval_typed(expr).map(|v| v.display)
    }

    /// Typed variant of [`Self::eval`]: additionally classifies the result
    /// (`kind`) and exposes the raw machine-readable value (`raw_value`)
    /// so the JS layer can re-format numbers and dates with `Intl`.
    pub(crate) fn eval_typed(&mut self, expr: &str) -> Result<EvalValue, EngineError> {
        let trimmed = expr.trim();

        if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
            return Ok(EvalValue::empty());
        }

        if DateTimeEvaluator::is_datetime_expression(trimmed) {
            let dt = DateTimeEvaluator::evaluate_typed(trimmed)?;
            return Ok(EvalValue::date(dt.display, dt.iso));
        }

        if AggregationEvaluator::is_aggregation(trimmed) {
            let result = AggregationEvaluator::evaluate(trimmed)
                .map_err(|e| EngineError::EvalError(e.to_string()))?;
            return Ok(EvalValue::number(self.format_number(result), result));
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

        match value {
            Value::Empty => Ok(EvalValue::empty()),
            // Every remaining numr-core value variant is numeric (Decimal
            // based): Number, BaseNumber, Percentage, Currency,
            // WithCompoundUnit. There is no string variant in numr-core,
            // so all successful non-empty lines are reported as numbers.
            other => {
                let display = format_value(&other);
                let raw_value = other
                    .as_f64()
                    .and_then(serde_json::Number::from_f64)
                    .map(serde_json::Value::Number)
                    .unwrap_or(serde_json::Value::Null);
                Ok(EvalValue {
                    display,
                    kind: "number",
                    raw_value,
                })
            }
        }
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
                match self.eval_typed(line) {
                    Ok(ev) if ev.kind == "empty" => LineOutcome::empty(),
                    Ok(ev) => LineOutcome::value(ev.display, ev.kind, ev.raw_value),
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
        // `isError`, `rawValue`); a snake_case serialization would
        // silently break error rendering in the editor.
        let outcome = LineOutcome {
            display: String::new(),
            error: Some("bad".to_string()),
            is_empty: false,
            is_error: true,
            kind: "error".to_string(),
            raw_value: serde_json::Value::Null,
        };
        let json = serde_json::to_value(&outcome).unwrap();
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("isEmpty"), "missing isEmpty: {json}");
        assert!(obj.contains_key("isError"), "missing isError: {json}");
        assert!(obj.contains_key("rawValue"), "missing rawValue: {json}");
        assert!(obj.contains_key("kind"), "missing kind: {json}");
        assert!(!obj.contains_key("is_empty"));
        assert!(!obj.contains_key("is_error"));
        assert_eq!(obj["isError"], serde_json::json!(true));
    }

    #[test]
    fn test_number_line_carries_kind_and_raw_value() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("100 + 200");
        assert_eq!(outcomes.len(), 1);
        assert_eq!(outcomes[0].display, "300");
        assert_eq!(outcomes[0].kind, "number");
        assert_eq!(outcomes[0].raw_value.as_f64(), Some(300.0));
        assert_eq!(
            outcomes[0].raw_value,
            serde_json::json!(300.0),
            "raw_value must serialize as a JSON number"
        );
    }

    #[test]
    fn test_empty_error_and_date_lines_carry_kind_and_raw_value() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("\n# hi\n2026-09-07\n1 + unknown\n42");
        assert_eq!(outcomes.len(), 5);

        assert_eq!(outcomes[0].kind, "empty");
        assert!(outcomes[0].raw_value.is_null());

        assert_eq!(outcomes[1].kind, "empty");
        assert!(outcomes[1].raw_value.is_null());

        assert_eq!(outcomes[2].kind, "date");
        assert_eq!(outcomes[2].raw_value, serde_json::json!("2026-09-07"));
        assert_eq!(outcomes[2].raw_value.as_str(), Some("2026-09-07"));

        assert_eq!(outcomes[3].kind, "error");
        assert!(outcomes[3].raw_value.is_null());
        assert!(outcomes[3].is_error);

        // Non-empty numeric line must not be mistaken for empty.
        assert_eq!(outcomes[4].kind, "number");
        assert!(!outcomes[4].is_empty);
        assert_eq!(outcomes[4].raw_value.as_f64(), Some(42.0));
    }
}

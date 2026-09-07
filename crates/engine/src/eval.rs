use std::collections::HashMap;
use numr_core::{Engine as CoreEngine, Value};
use crate::context::EngineContext;
use crate::date::DateTimeEvaluator;
use crate::error::EngineError;
use crate::reference::ReferenceEvaluator;
use crate::aggregate::AggregationEvaluator;

/// Main engine that extends numr-core with additional features
pub struct Engine {
    core: CoreEngine,
    context: EngineContext,
}

impl Engine {
    /// Create a new engine instance
    pub fn new() -> Self {
        Self {
            core: CoreEngine::new(),
            context: EngineContext::new(),
        }
    }

    /// Create an engine with a specific context
    pub fn with_context(context: EngineContext) -> Self {
        Self {
            core: CoreEngine::new(),
            context,
        }
    }

    /// Get a reference to the engine context
    pub fn context(&self) -> &EngineContext {
        &self.context
    }

    /// Get a mutable reference to the engine context
    pub fn context_mut(&mut self) -> &mut EngineContext {
        &mut self.context
    }

    /// Evaluate an expression with extended features
    pub fn eval(&mut self, expr: &str) -> Result<String, EngineError> {
        let expr = expr.trim();

        // Skip empty lines and comments
        if expr.is_empty() || expr.starts_with('#') || expr.starts_with("//") {
            return Ok(String::new());
        }

        // Check for date/time expressions
        if DateTimeEvaluator::is_datetime_expression(expr) {
            return DateTimeEvaluator::evaluate(expr);
        }

        // Check for aggregation functions
        if AggregationEvaluator::is_aggregation(expr) {
            let result = AggregationEvaluator::evaluate(expr)
                .map_err(|e| EngineError::EvalError(e.to_string()))?;
            return Ok(self.format_number(result));
        }

        // Resolve file references if present
        let resolved_expr = if ReferenceEvaluator::contains_reference(expr) {
            ReferenceEvaluator::resolve_references(expr, &self.context)
                .map_err(|e| EngineError::ReferenceError(e.to_string()))?
        } else {
            expr.to_string()
        };

        // Use numr-core for evaluation
        let value = self.core.eval(&resolved_expr);
        
        // Format the result
        Ok(value.to_string())
    }

    /// Format a number for display
    fn format_number(&self, value: f64) -> String {
        if value == value.floor() && value.abs() < 1e15 {
            format!("{}", value as i64)
        } else {
            format!("{}", value)
        }
    }

    /// Evaluate multiple lines
    pub fn eval_lines(&mut self, lines: &[&str]) -> Result<Vec<String>, EngineError> {
        let mut results = Vec::new();

        for line in lines {
            let result = self.eval(line)?;
            
            // Track variable assignments in context
            if let Some(eq_pos) = result.find('=') {
                let var_name = result[..eq_pos].trim();
                let var_value = result[eq_pos + 1..].trim();
                self.context.set_local_variable(var_name, var_value);
            }

            results.push(result);
        }

        Ok(results)
    }

    /// Load globals from content
    pub fn load_globals(&mut self, content: &str) -> Result<(), EngineError> {
        let mut globals = HashMap::new();

        for line in content.lines() {
            let line = line.trim();
            
            if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
                continue;
            }

            if let Some(eq_pos) = line.find('=') {
                let name = line[..eq_pos].trim().to_string();
                let value = line[eq_pos + 1..].trim().to_string();
                globals.insert(name, value);
            }
        }

        self.context.set_globals(globals);
        Ok(())
    }

    /// Load a document into context
    pub fn load_document(&mut self, name: &str, content: &str) {
        self.context.load_document(name, content);
    }

    /// Set the current document
    pub fn set_current_document(&mut self, name: Option<String>) {
        self.context.set_current_document(name);
    }

    /// Get the sum of all values
    pub fn sum(&self) -> Value {
        self.core.sum()
    }

    /// Get grouped totals
    pub fn grouped_totals(&self) -> Vec<Value> {
        self.core.grouped_totals()
    }

    /// Clear the engine state
    pub fn clear(&mut self) {
        self.core.clear();
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
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
    fn test_comment() {
        let mut engine = Engine::new();
        let result = engine.eval("# This is a comment").unwrap();
        assert_eq!(result, "");
    }

    #[test]
    fn test_percentage() {
        let mut engine = Engine::new();
        let result = engine.eval("20% of 150").unwrap();
        assert_eq!(result, "30");
    }

    #[test]
    fn test_currency() {
        let mut engine = Engine::new();
        let result = engine.eval("$100 + $50").unwrap();
        assert!(result.contains("150"));
    }
}

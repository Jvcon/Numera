use std::collections::HashMap;
use crate::error::EngineError;

/// Aggregation function types retained in the Numera layer.
///
/// numr-core now implements `sum`/`total`/`avg`/`average`/`min`/`max`/
/// `median` natively and resolves variable/expression arguments while
/// evaluating them, so those calls are routed straight to the core
/// evaluator from [`crate::eval::Engine::eval_typed`]. Only
/// `count`/`len`/`length` remain here because numr-core has no
/// equivalent for them.
#[derive(Debug, Clone, PartialEq)]
pub enum AggregationType {
    Count,
}

impl AggregationType {
    /// Parse aggregation type from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "count" | "len" | "length" => Some(Self::Count),
            _ => None,
        }
    }

    /// Get the function name
    pub fn name(&self) -> &'static str {
        match self {
            Self::Count => "count",
        }
    }
}

/// Aggregation evaluator
pub struct AggregationEvaluator;

impl AggregationEvaluator {
    /// Check if an expression is an aggregation function handled by the
    /// Numera layer. Only `count`/`len`/`length` are intercepted now;
    /// `sum`/`total`/`avg`/`average`/`min`/`max`/`median` are left to
    /// numr-core so that variable and cross-file arguments work.
    pub fn is_aggregation(expr: &str) -> bool {
        let lower = expr.trim().to_lowercase();
        lower.starts_with("count(") ||
        lower.starts_with("len(") ||
        lower.starts_with("length(")
    }

    /// Parse and evaluate an aggregation expression
    pub fn evaluate(expr: &str) -> Result<f64, EngineError> {
        let expr = expr.trim();

        // Extract function name and arguments
        let (func_name, args_str) = Self::parse_function_call(expr)?;

        let agg_type = AggregationType::from_str(&func_name)
            .ok_or_else(|| EngineError::EvalError(format!("Unknown aggregation function: {}", func_name)))?;

        // Parse arguments as numbers
        let values = Self::parse_number_list(&args_str)?;

        if values.is_empty() {
            return Err(EngineError::EvalError("Empty aggregation arguments".to_string()));
        }

        let result = match agg_type {
            AggregationType::Count => values.len() as f64,
        };

        Ok(result)
    }

    /// Parse function call into name and arguments string
    fn parse_function_call(expr: &str) -> Result<(String, String), EngineError> {
        let open_paren = expr.find('(')
            .ok_or_else(|| EngineError::EvalError("Missing opening parenthesis".to_string()))?;
        let close_paren = expr.rfind(')')
            .ok_or_else(|| EngineError::EvalError("Missing closing parenthesis".to_string()))?;

        if close_paren <= open_paren {
            return Err(EngineError::EvalError("Invalid function syntax".to_string()));
        }

        let func_name = expr[..open_paren].trim().to_lowercase();
        let args_str = expr[open_paren + 1..close_paren].trim().to_string();

        Ok((func_name, args_str))
    }

    /// Parse comma-separated number list
    fn parse_number_list(args: &str) -> Result<Vec<f64>, EngineError> {
        if args.trim().is_empty() {
            return Ok(Vec::new());
        }

        let mut values = Vec::new();
        for arg in args.split(',') {
            let arg = arg.trim();
            if arg.is_empty() {
                continue;
            }

            let value: f64 = arg.parse()
                .map_err(|_| EngineError::EvalError(format!("Invalid number: {}", arg)))?;
            values.push(value);
        }

        Ok(values)
    }
}

/// Running aggregation tracker
#[derive(Debug, Clone)]
pub struct AggregationTracker {
    /// Values collected for each aggregation type
    values: HashMap<String, Vec<f64>>,
    /// Cached results
    results: HashMap<String, f64>,
}

impl AggregationTracker {
    /// Create a new tracker
    pub fn new() -> Self {
        Self {
            values: HashMap::new(),
            results: HashMap::new(),
        }
    }

    /// Add a value to a named aggregation group
    pub fn add_value(&mut self, group: &str, value: f64) {
        self.values
            .entry(group.to_string())
            .or_insert_with(Vec::new)
            .push(value);
        // Invalidate cached result
        self.results.remove(group);
    }

    /// Get the sum of a group
    pub fn sum(&mut self, group: &str) -> f64 {
        if let Some(cached) = self.results.get(group) {
            return *cached;
        }

        let values = self.values.get(group).cloned().unwrap_or_default();
        let result: f64 = values.iter().sum();
        self.results.insert(group.to_string(), result);
        result
    }

    /// Get the average of a group
    pub fn average(&mut self, group: &str) -> f64 {
        let values = self.values.get(group).cloned().unwrap_or_default();
        if values.is_empty() {
            return 0.0;
        }
        let sum: f64 = values.iter().sum();
        sum / values.len() as f64
    }

    /// Get the count of a group
    pub fn count(&self, group: &str) -> usize {
        self.values.get(group).map(|v| v.len()).unwrap_or(0)
    }

    /// Clear all values
    pub fn clear(&mut self) {
        self.values.clear();
        self.results.clear();
    }
}

impl Default for AggregationTracker {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_count_family() {
        assert_eq!(AggregationEvaluator::evaluate("count(1, 2, 3)").unwrap(), 3.0);
        assert_eq!(AggregationEvaluator::evaluate("len(1, 2)").unwrap(), 2.0);
        assert_eq!(AggregationEvaluator::evaluate("length(4)").unwrap(), 1.0);
    }

    #[test]
    fn test_only_count_family_is_intercepted() {
        assert!(AggregationEvaluator::is_aggregation("count(1, 2)"));
        assert!(AggregationEvaluator::is_aggregation("len(1, 2)"));
        assert!(AggregationEvaluator::is_aggregation("length(1, 2)"));
        // These are delegated to numr-core, which resolves variables.
        assert!(!AggregationEvaluator::is_aggregation("sum(1, 2)"));
        assert!(!AggregationEvaluator::is_aggregation("total(1, 2)"));
        assert!(!AggregationEvaluator::is_aggregation("avg(1, 2)"));
        assert!(!AggregationEvaluator::is_aggregation("average(1, 2)"));
        assert!(!AggregationEvaluator::is_aggregation("min(1, 2)"));
        assert!(!AggregationEvaluator::is_aggregation("max(1, 2)"));
        assert!(!AggregationEvaluator::is_aggregation("median(1, 2)"));
    }
}

use std::collections::HashMap;
use crate::error::EngineError;

/// Aggregation function types
#[derive(Debug, Clone, PartialEq)]
pub enum AggregationType {
    Sum,
    Average,
    Min,
    Max,
    Median,
    Count,
    Total,
}

impl AggregationType {
    /// Parse aggregation type from string
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "sum" => Some(Self::Sum),
            "avg" | "average" | "mean" => Some(Self::Average),
            "min" | "minimum" => Some(Self::Min),
            "max" | "maximum" => Some(Self::Max),
            "median" => Some(Self::Median),
            "count" | "len" | "length" => Some(Self::Count),
            "total" => Some(Self::Total),
            _ => None,
        }
    }

    /// Get the function name
    pub fn name(&self) -> &'static str {
        match self {
            Self::Sum => "sum",
            Self::Average => "avg",
            Self::Min => "min",
            Self::Max => "max",
            Self::Median => "median",
            Self::Count => "count",
            Self::Total => "total",
        }
    }
}

/// Aggregation evaluator
pub struct AggregationEvaluator;

impl AggregationEvaluator {
    /// Check if an expression is an aggregation function
    pub fn is_aggregation(expr: &str) -> bool {
        let lower = expr.trim().to_lowercase();
        lower.starts_with("sum(") ||
        lower.starts_with("avg(") ||
        lower.starts_with("average(") ||
        lower.starts_with("mean(") ||
        lower.starts_with("min(") ||
        lower.starts_with("max(") ||
        lower.starts_with("median(") ||
        lower.starts_with("count(") ||
        lower.starts_with("total(")
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
            AggregationType::Sum | AggregationType::Total => {
                values.iter().sum::<f64>()
            }
            AggregationType::Average => {
                let sum: f64 = values.iter().sum();
                sum / values.len() as f64
            }
            AggregationType::Min => {
                values.iter().cloned().fold(f64::INFINITY, f64::min)
            }
            AggregationType::Max => {
                values.iter().cloned().fold(f64::NEG_INFINITY, f64::max)
            }
            AggregationType::Median => {
                let mut sorted = values.clone();
                sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
                let mid = sorted.len() / 2;
                if sorted.len() % 2 == 0 {
                    (sorted[mid - 1] + sorted[mid]) / 2.0
                } else {
                    sorted[mid]
                }
            }
            AggregationType::Count => {
                values.len() as f64
            }
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
    fn test_sum() {
        let result = AggregationEvaluator::evaluate("sum(1, 2, 3, 4, 5)").unwrap();
        assert_eq!(result, 15.0);
    }

    #[test]
    fn test_average() {
        let result = AggregationEvaluator::evaluate("avg(10, 20, 30)").unwrap();
        assert_eq!(result, 20.0);
    }

    #[test]
    fn test_median() {
        let result = AggregationEvaluator::evaluate("median(3, 1, 2)").unwrap();
        assert_eq!(result, 2.0);
    }

    #[test]
    fn test_count() {
        let result = AggregationEvaluator::evaluate("count(1, 2, 3)").unwrap();
        assert_eq!(result, 3.0);
    }
}

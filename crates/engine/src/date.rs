use chrono::{Local, NaiveDate};
use crate::error::EngineError;

/// Typed date/time evaluation result.
///
/// `display` keeps the engine's current human-facing formatting (the
/// fallback the editor shows); `iso` carries the raw ISO-8601 value the
/// JS layer re-formats with `Intl.DateTimeFormat`. Date-only results
/// (today / yesterday / tomorrow / date arithmetic / parsed literals)
/// use a `YYYY-MM-DD` ISO string; `now` uses a full `YYYY-MM-DDTHH:MM:SS`
/// local datetime.
#[derive(Debug, Clone, PartialEq)]
pub struct DateTimeValue {
    pub display: String,
    pub iso: String,
}

impl DateTimeValue {
    fn new(display: String, iso: String) -> Self {
        Self { display, iso }
    }

    /// Date-only value: display and ISO coincide (`YYYY-MM-DD`).
    fn date_only(formatted: String) -> Self {
        Self {
            iso: formatted.clone(),
            display: formatted,
        }
    }
}

/// Date/time expression evaluator
pub struct DateTimeEvaluator;

impl DateTimeEvaluator {
    /// Check if an expression is a date/time expression
    pub fn is_datetime_expression(expr: &str) -> bool {
        let lower = expr.trim().to_lowercase();
        
        // Check for date patterns
        lower.contains("today") ||
        lower.contains("now") ||
        lower.contains("yesterday") ||
        lower.contains("tomorrow") ||
        lower.contains("date(") ||
        lower.contains("time(") ||
        lower.contains("datetime(") ||
        // ISO date patterns
        lower.chars().filter(|c| *c == '-').count() == 2 && lower.len() >= 8
    }

    /// Evaluate a date/time expression, returning only the display string.
    pub fn evaluate(expr: &str) -> Result<String, EngineError> {
        Self::evaluate_typed(expr).map(|v| v.display)
    }

    /// Evaluate a date/time expression, returning the display string and
    /// the raw ISO-8601 value together.
    pub fn evaluate_typed(expr: &str) -> Result<DateTimeValue, EngineError> {
        let lower = expr.trim().to_lowercase();

        if lower == "now" {
            let now = Local::now();
            return Ok(DateTimeValue::new(
                now.format("%Y-%m-%d %H:%M:%S").to_string(),
                now.format("%Y-%m-%dT%H:%M:%S").to_string(),
            ));
        }

        if lower == "today" {
            return Ok(DateTimeValue::date_only(
                Local::now().format("%Y-%m-%d").to_string(),
            ));
        }

        if lower == "yesterday" {
            let yesterday = Local::now() - chrono::Duration::days(1);
            return Ok(DateTimeValue::date_only(
                yesterday.format("%Y-%m-%d").to_string(),
            ));
        }

        if lower == "tomorrow" {
            let tomorrow = Local::now() + chrono::Duration::days(1);
            return Ok(DateTimeValue::date_only(
                tomorrow.format("%Y-%m-%d").to_string(),
            ));
        }

        // Parse date arithmetic
        if lower.contains(" + ") || lower.contains(" - ") {
            return Self::evaluate_date_arithmetic(expr);
        }

        // Try to parse as date
        if let Ok(date) = NaiveDate::parse_from_str(expr.trim(), "%Y-%m-%d") {
            return Ok(DateTimeValue::date_only(
                date.format("%Y-%m-%d").to_string(),
            ));
        }

        Err(EngineError::DateTimeError(format!("Unknown date/time expression: {}", expr)))
    }

    /// Evaluate date arithmetic like "2024-01-15 + 30 days"
    fn evaluate_date_arithmetic(expr: &str) -> Result<DateTimeValue, EngineError> {
        let parts: Vec<&str> = if expr.contains(" + ") {
            expr.split(" + ").collect()
        } else {
            expr.split(" - ").collect()
        };

        if parts.len() != 2 {
            return Err(EngineError::DateTimeError("Invalid date arithmetic".to_string()));
        }

        let date_str = parts[0].trim();
        let duration_str = parts[1].trim().to_lowercase();

        let date = NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
            .map_err(|e| EngineError::DateTimeError(e.to_string()))?;

        let is_negative = expr.contains(" - ");
        let duration_num: i64 = duration_str
            .split_whitespace()
            .next()
            .and_then(|s| s.parse().ok())
            .ok_or_else(|| EngineError::DateTimeError("Invalid duration number".to_string()))?;

        let duration_num = if is_negative { -duration_num } else { duration_num };

        let result = if duration_str.contains("day") {
            date + chrono::Duration::days(duration_num)
        } else if duration_str.contains("week") {
            date + chrono::Duration::weeks(duration_num)
        } else if duration_str.contains("month") {
            // Approximate month as 30 days
            date + chrono::Duration::days(duration_num * 30)
        } else if duration_str.contains("year") {
            // Approximate year as 365 days
            date + chrono::Duration::days(duration_num * 365)
        } else {
            return Err(EngineError::DateTimeError("Unknown duration unit".to_string()));
        };

        Ok(DateTimeValue::date_only(
            result.format("%Y-%m-%d").to_string(),
        ))
    }

    /// Get the number of days between two dates
    pub fn days_between(date1: &str, date2: &str) -> Result<i64, EngineError> {
        let d1 = NaiveDate::parse_from_str(date1, "%Y-%m-%d")
            .map_err(|e| EngineError::DateTimeError(e.to_string()))?;
        let d2 = NaiveDate::parse_from_str(date2, "%Y-%m-%d")
            .map_err(|e| EngineError::DateTimeError(e.to_string()))?;

        Ok((d2 - d1).num_days())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_datetime_expression() {
        assert!(DateTimeEvaluator::is_datetime_expression("today"));
        assert!(DateTimeEvaluator::is_datetime_expression("now"));
        assert!(DateTimeEvaluator::is_datetime_expression("2024-01-15"));
        assert!(!DateTimeEvaluator::is_datetime_expression("100 + 200"));
    }

    #[test]
    fn test_date_arithmetic() {
        let result = DateTimeEvaluator::evaluate("2024-01-15 + 30 days").unwrap();
        assert_eq!(result, "2024-02-14");
    }

    #[test]
    fn test_evaluate_typed_carries_display_and_iso() {
        let typed = DateTimeEvaluator::evaluate_typed("2024-01-15").unwrap();
        assert_eq!(typed.display, "2024-01-15");
        assert_eq!(typed.iso, "2024-01-15");

        let typed = DateTimeEvaluator::evaluate_typed("2024-01-15 + 30 days").unwrap();
        assert_eq!(typed.display, "2024-02-14");
        assert_eq!(typed.iso, "2024-02-14");
    }
}

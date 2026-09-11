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
            let result = if duration_num < 0 {
                date.checked_sub_months(chrono::Months::new(duration_num.unsigned_abs() as u32))
            } else {
                date.checked_add_months(chrono::Months::new(duration_num as u32))
            };
            result.ok_or_else(|| {
                EngineError::DateTimeError("Date arithmetic out of range".to_string())
            })?
        } else if duration_str.contains("year") {
            // Year arithmetic is month arithmetic: 1 year = 12 months.
            // `checked_add_months` / `checked_sub_months` clamp dates that do
            // not exist in the target month to the end of that month
            // (e.g. 2024-02-29 + 1 year -> 2025-02-28), matching .NET
            // `DateTime.AddYears` and `java.time.Period.ofYears`. Neither
            // chrono 0.4 nor the unreleased chrono 0.5 has a `Years` type.
            let result = if duration_num < 0 {
                i64::try_from(duration_num.unsigned_abs())
                    .ok()
                    .and_then(|years| Self::sub_years(date, years))
            } else {
                Self::add_years(date, duration_num)
            };
            result.ok_or_else(|| {
                EngineError::DateTimeError("Date arithmetic out of range".to_string())
            })?
        } else {
            return Err(EngineError::DateTimeError("Unknown duration unit".to_string()));
        };

        Ok(DateTimeValue::date_only(
            result.format("%Y-%m-%d").to_string(),
        ))
    }

    /// Add a non-negative number of whole years to `date`.
    ///
    /// Implemented as `date + 12 * years` months because neither chrono 0.4
    /// nor the unreleased chrono 0.5 has a `Years` type. `checked_add_months`
    /// clamps non-existent target dates to the end of the month
    /// (2024-02-29 + 1 year -> 2025-02-28), matching .NET `DateTime.AddYears`
    /// and `java.time.Period.ofYears`. The caller routes the sign, so `years`
    /// must be non-negative.
    fn add_years(date: NaiveDate, years: i64) -> Option<NaiveDate> {
        let months = u32::try_from(years).ok()?.checked_mul(12)?;
        date.checked_add_months(chrono::Months::new(months))
    }

    /// Subtract a non-negative number of whole years from `date`.
    ///
    /// See [`Self::add_years`] for the month-based semantics. The caller
    /// routes the sign, so `years` must be non-negative.
    fn sub_years(date: NaiveDate, years: i64) -> Option<NaiveDate> {
        let months = u32::try_from(years).ok()?.checked_mul(12)?;
        date.checked_sub_months(chrono::Months::new(months))
    }

    /// Get the number of days between two dates
    pub fn days_between(date1: &str, date2: &str) -> Result<i64, EngineError> {
        let d1 = NaiveDate::parse_from_str(date1, "%Y-%m-%d")
            .map_err(|e| EngineError::DateTimeError(e.to_string()))?;
        let d2 = NaiveDate::parse_from_str(date2, "%Y-%m-%d")
            .map_err(|e| EngineError::DateTimeError(e.to_string()))?;

        Ok((d2 - d1).num_days())
    }

    /// 解析 `days_between(a, b)` 表达式,返回两个日期之间的天数。
    /// 非 days_between 表达式返回 None。
    pub fn days_between_expression(expr: &str) -> Option<Result<i64, EngineError>> {
        let trimmed = expr.trim();
        let lower = trimmed.to_lowercase();

        const PREFIX: &str = "days_between(";
        if !lower.starts_with(PREFIX) {
            return None;
        }

        if !trimmed.ends_with(')') {
            return Some(Err(EngineError::DateTimeError(
                "Invalid days_between expression: missing closing ')'".to_string(),
            )));
        }

        let inner = &trimmed[PREFIX.len()..trimmed.len() - 1];
        let parts: Vec<&str> = inner.split(',').collect();
        if parts.len() != 2 {
            return Some(Err(EngineError::DateTimeError(
                "days_between expects exactly two arguments".to_string(),
            )));
        }

        let d1 = match Self::parse_date_token(parts[0]) {
            Ok(d) => d,
            Err(e) => return Some(Err(e)),
        };
        let d2 = match Self::parse_date_token(parts[1]) {
            Ok(d) => d,
            Err(e) => return Some(Err(e)),
        };

        Some(Ok((d2 - d1).num_days()))
    }

    /// Parse a single date argument: an ISO `YYYY-MM-DD` literal or one of the
    /// relative words `today` / `yesterday` / `tomorrow` (based on `Local::now()`).
    fn parse_date_token(token: &str) -> Result<NaiveDate, EngineError> {
        let t = token.trim().to_lowercase();
        match t.as_str() {
            "today" => Ok(Local::now().date_naive()),
            "yesterday" => Ok((Local::now() - chrono::Duration::days(1)).date_naive()),
            "tomorrow" => Ok((Local::now() + chrono::Duration::days(1)).date_naive()),
            _ => NaiveDate::parse_from_str(token.trim(), "%Y-%m-%d")
                .map_err(|e| EngineError::DateTimeError(e.to_string())),
        }
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

    #[test]
    fn test_month_arithmetic_clamps_to_end_of_month() {
        // Leap year: Jan 31 + 1 month clamps to Feb 29.
        assert_eq!(
            DateTimeEvaluator::evaluate("2024-01-31 + 1 month").unwrap(),
            "2024-02-29"
        );
        // Non-leap year: Jan 31 + 1 month clamps to Feb 28.
        assert_eq!(
            DateTimeEvaluator::evaluate("2023-01-31 + 1 month").unwrap(),
            "2023-02-28"
        );
        // Crossing a year boundary.
        assert_eq!(
            DateTimeEvaluator::evaluate("2024-12-15 + 1 month").unwrap(),
            "2025-01-15"
        );
        // Negative month arithmetic.
        assert_eq!(
            DateTimeEvaluator::evaluate("2024-03-31 - 1 month").unwrap(),
            "2024-02-29"
        );
    }

    #[test]
    fn test_year_arithmetic_clamps_leap_day() {
        // Leap day + 1 year clamps to Feb 28 in a non-leap year.
        assert_eq!(
            DateTimeEvaluator::evaluate("2024-02-29 + 1 year").unwrap(),
            "2025-02-28"
        );
        // Leap day - 1 year also clamps to Feb 28 in a non-leap year.
        assert_eq!(
            DateTimeEvaluator::evaluate("2024-02-29 - 1 year").unwrap(),
            "2023-02-28"
        );
    }

    #[test]
    fn test_year_arithmetic_restores_leap_day() {
        // 2028 is a leap year, so the Feb 29 is restored.
        assert_eq!(
            DateTimeEvaluator::evaluate("2024-02-29 + 4 years").unwrap(),
            "2028-02-29"
        );
    }

    #[test]
    fn test_year_arithmetic_shifts_plain_date() {
        // Plain dates simply shift by the year with no clamping.
        assert_eq!(
            DateTimeEvaluator::evaluate("2024-03-31 + 1 year").unwrap(),
            "2025-03-31"
        );
    }

    #[test]
    fn test_days_between_expression() {
        // `EngineError` does not implement `PartialEq`, so map it to its
        // string form to keep `assert_eq!` usable here.
        let as_strings = |expr: &str| {
            DateTimeEvaluator::days_between_expression(expr)
                .map(|r| r.map_err(|e| e.to_string()))
        };

        assert_eq!(
            as_strings("days_between(2024-01-01, 2024-01-15)"),
            Some(Ok(14))
        );
        assert_eq!(as_strings("days_between(today, today)"), Some(Ok(0)));
        assert_eq!(as_strings("100 + 200"), None);
    }
}

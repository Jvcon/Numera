//! Typed cross-file export values and lossless literal conversion.
//!
//! The cross-file resolver evaluates a referenced document and stores each
//! exported variable as an [`ExportValue`]. To splice an export back into a
//! consumer expression it must be rendered as a literal that numr-core parses
//! back to an *equal* value.
//!
//! `Value`'s `Display` implementation is presentation-oriented (it rounds to
//! two decimals), so it must never be used here. Instead every variant is
//! rendered from its exact [`Decimal`] amount plus an explicit type tag:
//! a `%` sign, an ISO currency code, a unit symbol, an `in <base>` conversion,
//! or an ISO date.

use numr_core::{Decimal, NumberBase, Value};

/// A computed export from a referenced document.
#[derive(Debug, Clone, PartialEq)]
pub enum ExportValue {
    /// A numr-core value (number, percentage, currency, unit, base number).
    Value(Value),
    /// An ISO-8601 date literal produced by the date/time interceptor.
    ///
    /// Dates are not representable as a numr-core [`Value`], so they travel
    /// separately and are spliced back without parentheses (the date parsers
    /// tokenize their arguments and would reject wrapping parentheses).
    Date(String),
}

/// An evaluated document: exported variables in document (line) order.
///
/// Order matters: a bare `file("name")` resolves to the *first* export.
pub type EvaluatedDocument = Vec<(String, ExportValue)>;

/// Render a numr-core [`Value`] as a lossless literal (no surrounding parens).
///
/// Returns `None` for `Empty`/`Error`, which never enter the export table.
pub fn value_to_literal(value: &Value) -> Option<String> {
    match value {
        Value::Number(n) => Some(n.to_string()),
        Value::BaseNumber { amount, base } => {
            // numr-core has no `0x`/`0b` literal syntax; a base number is
            // reproduced with the `in <base>` conversion operator instead.
            let target = match base {
                NumberBase::Binary => "bin",
                NumberBase::Hexadecimal => "hex",
            };
            Some(format!("{} in {}", amount, target))
        }
        Value::Percentage(p) => {
            // Percentages are stored as decimals (0.2 == 20%); scale back up
            // and tag with `%` so parsing divides by 100 again. `normalize`
            // drops the trailing zeros multiplication can introduce.
            let percent = p.checked_mul(Decimal::from(100))?.normalize();
            Some(format!("{}%", percent))
        }
        Value::Currency { amount, currency } => {
            // Use the ISO code (not the symbol) so the literal is unambiguous.
            Some(format!("{} {}", amount, currency.code()))
        }
        Value::WithCompoundUnit { amount, unit } => Some(format!("{} {}", amount, unit.symbol)),
        Value::Empty | Value::Error(_) => None,
    }
}

/// Render an [`ExportValue`] as a lossless literal (no surrounding parens).
pub fn export_to_literal(export: &ExportValue) -> Option<String> {
    match export {
        ExportValue::Value(value) => value_to_literal(value),
        ExportValue::Date(iso) => Some(iso.clone()),
    }
}

/// Render an export for splicing into a consumer expression.
///
/// Typed values are wrapped in parentheses so the consumer's operator
/// precedence is preserved (`2 * file("a")` must not become `2 * 3 + 4`).
/// Dates are deliberately left unwrapped: they are only meaningful as whole
/// arguments to the date evaluators, whose parsers split on `,`/operators and
/// would choke on the parentheses.
pub fn export_to_substitution(export: &ExportValue) -> Option<String> {
    match export {
        ExportValue::Value(value) => value_to_literal(value).map(|lit| format!("( {} )", lit)),
        ExportValue::Date(iso) => Some(iso.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::date::DateTimeEvaluator;
    use numr_core::types::unit::parse_unit;
    use numr_core::{decimal, Currency, Engine as CoreEngine};

    /// A literal must parse back to a value equal to the one it was rendered
    /// from, or the cross-file substitution silently changes the result.
    fn assert_round_trip(value: Value) {
        let literal = value_to_literal(&value).expect("value must have a literal");
        let mut core = CoreEngine::new();
        let parsed = core.eval(&literal);
        assert_eq!(parsed, value, "literal `{literal}` did not round-trip");
    }

    #[test]
    fn number_literal_round_trips_exactly() {
        // A value that `Display` would round to two decimals.
        assert_round_trip(Value::Number(decimal("3.14159")));
        assert_round_trip(Value::Number(decimal("0.000001")));
        assert_round_trip(Value::Number(decimal("-42.5")));
        assert_round_trip(Value::Number(decimal("1000")));
    }

    #[test]
    fn percentage_literal_round_trips() {
        assert_round_trip(Value::Percentage(decimal("0.2")));
        assert_round_trip(Value::Percentage(decimal("0.125")));
        assert_round_trip(Value::Percentage(decimal("1.5")));
        // `Display` would render 0.2 as "20%"; verify the literal is exact.
        assert_eq!(
            value_to_literal(&Value::Percentage(decimal("0.2"))).unwrap(),
            "20%"
        );
    }

    #[test]
    fn currency_literal_round_trips() {
        assert_round_trip(Value::currency(decimal("250"), Currency::USD));
        assert_round_trip(Value::currency(decimal("92.5"), Currency::EUR));
        assert_round_trip(Value::currency(decimal("-5"), Currency::RUB));
        assert_eq!(
            value_to_literal(&Value::currency(decimal("250"), Currency::USD)).unwrap(),
            "250 USD"
        );
    }

    #[test]
    fn unit_literal_round_trips() {
        let km = parse_unit("km").expect("km unit");
        assert_round_trip(Value::with_compound_unit(decimal("5"), km));
        let h = parse_unit("h").expect("h unit");
        assert_round_trip(Value::with_compound_unit(decimal("2.5"), h));
        assert_eq!(
            value_to_literal(&Value::with_compound_unit(
                decimal("5"),
                parse_unit("km").unwrap()
            ))
            .unwrap(),
            "5 km"
        );
    }

    #[test]
    fn base_number_literal_round_trips() {
        assert_round_trip(Value::with_base(decimal("22"), NumberBase::Hexadecimal));
        assert_round_trip(Value::with_base(decimal("22"), NumberBase::Binary));
        assert_round_trip(Value::with_base(decimal("-10"), NumberBase::Hexadecimal));
        assert_eq!(
            value_to_literal(&Value::with_base(decimal("22"), NumberBase::Hexadecimal)).unwrap(),
            "22 in hex"
        );
    }

    #[test]
    fn empty_and_error_have_no_literal() {
        assert!(value_to_literal(&Value::Empty).is_none());
        assert!(value_to_literal(&Value::error("boom")).is_none());
    }

    #[test]
    fn date_export_round_trips() {
        let export = ExportValue::Date("2024-01-01".to_string());
        let literal = export_to_literal(&export).unwrap();
        assert_eq!(literal, "2024-01-01");
        let typed = DateTimeEvaluator::evaluate_typed(&literal).unwrap();
        assert_eq!(typed.iso, "2024-01-01");
    }

    #[test]
    fn substitution_wraps_values_but_not_dates() {
        let number = ExportValue::Value(Value::Number(decimal("3.5")));
        assert_eq!(export_to_substitution(&number).unwrap(), "( 3.5 )");

        let currency = ExportValue::Value(Value::currency(decimal("250"), Currency::USD));
        assert_eq!(export_to_substitution(&currency).unwrap(), "( 250 USD )");

        let date = ExportValue::Date("2024-01-01".to_string());
        assert_eq!(export_to_substitution(&date).unwrap(), "2024-01-01");
    }
}

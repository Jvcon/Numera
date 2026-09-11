use std::collections::HashMap;
use numr_core::{Engine as CoreEngine, Value};
use serde::{Deserialize, Serialize};

// Re-exported so downstream crates (e.g. the WASM bindings) can name the
// exact `Decimal` type accepted by [`Engine::apply_rates`] without taking a
// direct dependency on `numr-core`.
pub use numr_core::Decimal;
use crate::context::EngineContext;
use crate::date::DateTimeEvaluator;
use crate::error::EngineError;
use crate::function_call::expand_global_calls;
use crate::global_ref::rewrite_global_refs;
use crate::reference::{FileReference, ReferenceEvaluator};
use crate::aggregate::AggregationEvaluator;
use crate::value_ref::{export_to_substitution, value_to_literal, EvaluatedDocument, ExportValue};
use crate::zh_units::rewrite_zh_units;

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
    /// Derived cache of evaluated cross-file exports, keyed by the stored
    /// document path. Invalidated whenever documents, globals, or rates
    /// change.
    document_cache: HashMap<String, EvaluatedDocument>,
    /// Exchange rates applied via [`Engine::apply_rates`], replayed onto
    /// the fresh core used to evaluate referenced documents.
    rates: HashMap<String, Decimal>,
}

impl Engine {
    /// Create a new engine instance
    pub fn new() -> Self {
        Self {
            core: CoreEngine::new(),
            context: EngineContext::new(),
            globals_content: String::new(),
            document_cache: HashMap::new(),
            rates: HashMap::new(),
        }
    }

    /// Create an engine with a specific context
    pub fn with_context(context: EngineContext) -> Self {
        Self {
            core: CoreEngine::new(),
            context,
            globals_content: String::new(),
            document_cache: HashMap::new(),
            rates: HashMap::new(),
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
        // Exports may reference globals, so any cached evaluation is stale.
        self.document_cache.clear();
    }

    /// Inject the variable-shaped globals (those without `(...)` in the
    /// LHS) into the underlying numr-core engine. Function-shaped
    /// globals are intentionally left out — they are expanded on demand
    /// during eval.
    fn inject_globals(&mut self) -> Result<(), String> {
        inject_globals_into(&mut self.core, &self.context.globals)
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

        // Resolve `file("name")` / `file("name").member` references BEFORE
        // the datetime and aggregation interception branches. Those branches
        // parse their arguments directly (rather than delegating to
        // numr-core), so a reference left in place would be handed to them
        // unresolved — e.g. `count(file("a").x)` or
        // `days_between(file("a").x, file("b").y)`. Unresolvable references
        // are left untouched so the core evaluator surfaces the error.
        let resolved = if ReferenceEvaluator::contains_reference(trimmed) {
            self.resolve_value_references(trimmed)?
        } else {
            trimmed.to_string()
        };

        // Translate Chinese/local units (`3斤`, `100元`, ...) into ASCII
        // numr-core expressions before the datetime / aggregation branches
        // or the core evaluator see the line, so every path observes the
        // same ASCII form.
        let resolved = rewrite_zh_units(&resolved);

        if DateTimeEvaluator::is_datetime_expression(&resolved)
            && !resolved.to_lowercase().starts_with("days_between(")
        {
            let dt = DateTimeEvaluator::evaluate_typed(&resolved)?;
            return Ok(EvalValue::date(dt.display, dt.iso));
        }

        // `days_between(...)` yields a plain day count, not a date, so it
        // must bypass the datetime branch above — especially when its
        // arguments are relative words like `today`, which would otherwise
        // trip `is_datetime_expression`.
        if let Some(res) = DateTimeEvaluator::days_between_expression(&resolved) {
            return match res {
                Ok(n) => Ok(EvalValue::number(self.format_number(n as f64), n as f64)),
                Err(e) => Err(e),
            };
        }

        if AggregationEvaluator::is_aggregation(&resolved) {
            // Substituted file values arrive parenthesized; the count parser
            // only understands bare numbers, so peel one wrapper layer.
            let result = AggregationEvaluator::evaluate(&normalize_count_expression(&resolved))
                .map_err(|e| EngineError::EvalError(e.to_string()))?;
            return Ok(EvalValue::number(self.format_number(result), result));
        }

        let rewritten = rewrite_global_refs(&resolved);
        let expanded = expand_global_calls(&rewritten, &self.context.globals);
        // numr-core implements `avg`/`average` but not the `mean` alias, so
        // normalize it before handing the expression to the core evaluator.
        let expanded = normalize_aggregation_aliases(&expanded);
        // Global function bodies are inlined after the first Chinese-unit
        // pass, so re-run the rewrite to cover units they may contain. The
        // rewrite is idempotent.
        let expanded = rewrite_zh_units(&expanded);

        let value = self.core.eval(&expanded);
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
        self.document_cache.clear();
    }

    /// Remove a previously loaded document and drop its cached exports.
    pub fn unload_document(&mut self, name: &str) {
        self.context.unload_document(name);
        self.document_cache.clear();
    }

    /// Replace the entire cross-file document table with `docs`, where
    /// each entry is `(alias, content)`. Delegates to
    /// [`EngineContext::set_documents`].
    pub fn set_documents(&mut self, docs: Vec<(String, String)>) {
        self.context.set_documents(docs);
        self.document_cache.clear();
    }

    pub fn set_current_document(&mut self, name: Option<String>) {
        self.context.set_current_document(name);
    }

    pub fn clear(&mut self) {
        self.core.clear();
    }

    /// Apply exchange rates from a currency-code → rate map, delegating to
    /// the numr-core rate cache. Returns the number of rates accepted.
    ///
    /// Fiat codes are interpreted as "1 USD = X <code>" and crypto codes as
    /// "1 <code> = X USD", matching numr-core's `apply_raw_rates`. The
    /// accepted table is retained so referenced documents can be evaluated
    /// against the same rates.
    pub fn apply_rates(
        &mut self,
        rates: HashMap<String, Decimal>,
    ) -> Result<usize, EngineError> {
        let applied = self
            .core
            .apply_raw_rates(&rates)
            .map_err(|e| EngineError::CoreError(e.to_string()))?;
        self.rates = rates;
        // Currency exports depend on the rate table.
        self.document_cache.clear();
        Ok(applied)
    }

    /// Resolve every `file("name")[.member]` in `expr` to a typed, lossless
    /// literal and return the rewritten expression.
    ///
    /// Each referenced document is evaluated once (memoized in
    /// `document_cache`) against a fresh core seeded with the current globals
    /// and exchange rates. Cycles are reported as
    /// [`EngineError::CircularReference`]. References that cannot be resolved
    /// are left untouched so the core evaluator surfaces the error.
    pub(crate) fn resolve_value_references(&mut self, expr: &str) -> Result<String, EngineError> {
        if !ReferenceEvaluator::contains_reference(expr) {
            return Ok(expr.to_string());
        }
        let mut resolver = RefResolver {
            context: &self.context,
            rates: &self.rates,
            cache: &mut self.document_cache,
            visiting: Vec::new(),
        };
        resolver.resolve_expr(expr)
    }

    /// Evaluate the document stored under `name` and return its exports in
    /// document order, memoizing the result. Returns `Ok(None)` when no such
    /// document is loaded.
    ///
    /// This is exposed for tests and tooling; the engine itself reaches it
    /// through [`Self::resolve_value_references`].
    pub fn evaluate_document_exports(
        &mut self,
        name: &str,
    ) -> Result<Option<EvaluatedDocument>, EngineError> {
        let mut resolver = RefResolver {
            context: &self.context,
            rates: &self.rates,
            cache: &mut self.document_cache,
            visiting: Vec::new(),
        };
        resolver.ensure_exports(name)
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

/// Build a fresh numr-core engine seeded with the current globals (variable
/// definitions only) and exchange rates.
///
/// Referenced documents are evaluated in isolation from the consumer, so they
/// get their own core rather than sharing the consumer's variable table.
fn fresh_core_with(
    globals: &HashMap<String, String>,
    rates: &HashMap<String, Decimal>,
) -> CoreEngine {
    let mut core = CoreEngine::new();
    // Rates were validated when applied; a replay failure only means the
    // document's currency lines will surface their own error.
    let _ = core.apply_raw_rates(rates);
    let _ = inject_globals_into(&mut core, globals);
    core
}

/// Inject the variable-shaped globals into `core`. Function-shaped globals
/// (`name(...)`) are skipped: numr-core has no user-defined functions and they
/// are inlined by [`expand_global_calls`] instead.
fn inject_globals_into(
    core: &mut CoreEngine,
    globals: &HashMap<String, String>,
) -> Result<(), String> {
    for (key, value) in globals {
        if !looks_like_function_def(key) {
            // Globals bypass `eval_typed`, so apply the Chinese-unit rewrite
            // here too (e.g. `weight = 3斤`).
            let line = format!("{} = {}", key, rewrite_zh_units(value));
            let outcome = core.eval(&line);
            if outcome.is_error() {
                return Err(outcome.to_string());
            }
        }
    }
    Ok(())
}

/// Apply the Numera-level rewrites that run before numr-core: `global.x`
/// references, global function inlining, and the `mean` → `avg` alias.
fn process_expression(expr: &str, globals: &HashMap<String, String>) -> String {
    let rewritten = rewrite_global_refs(expr);
    let expanded = expand_global_calls(&rewritten, globals);
    // Apply the Chinese-unit rewrite last so units introduced by inlined
    // global function bodies are converted as well.
    rewrite_zh_units(&normalize_aggregation_aliases(&expanded))
}

/// Split `name = rhs` into its parts. Returns `None` for a non-assignment
/// line. Numera has no comparison operators, so the first `=` is the
/// assignment separator.
fn split_assignment(line: &str) -> Option<(String, &str)> {
    let eq = line.find('=')?;
    let name = line[..eq].trim();
    if name.is_empty() {
        return None;
    }
    Some((name.to_string(), line[eq + 1..].trim()))
}

/// Set `name` in `core` to a computed value by re-parsing its lossless
/// literal, so later lines in the same document can reference it.
///
/// No-op when the line was not an assignment or the value has no literal
/// (dates, errors).
fn set_core_variable(core: &mut CoreEngine, name: Option<&str>, value: &Value) {
    let Some(name) = name else { return };
    let Some(literal) = value_to_literal(value) else {
        return;
    };
    let _ = core.eval(&format!("{} = {}", name, literal));
}

/// Peel one layer of wrapping parentheses from each comma-separated argument
/// of a `count`/`len`/`length` call.
///
/// Substituted file references arrive as `( 30 )`; the Numera count parser
/// only understands bare numbers, so `count(( 30 ))` must become `count(30)`.
fn normalize_count_expression(expr: &str) -> String {
    let trimmed = expr.trim();
    let (Some(open), Some(close)) = (trimmed.find('('), trimmed.rfind(')')) else {
        return trimmed.to_string();
    };
    if close <= open {
        return trimmed.to_string();
    }
    let func = &trimmed[..open];
    let inner = &trimmed[open + 1..close];
    let args: Vec<String> = inner
        .split(',')
        .map(|arg| {
            let arg = arg.trim();
            if arg.len() >= 2 && arg.starts_with('(') && arg.ends_with(')') {
                arg[1..arg.len() - 1].trim().to_string()
            } else {
                arg.to_string()
            }
        })
        .collect();
    format!("{}({})", func, args.join(", "))
}

/// Evaluate one line of a referenced document, returning its exported
/// `(name, value)` when the line is a successful assignment.
///
/// Mirrors the Numera line semantics used for consumer documents, in the same
/// order: date interception, then `days_between`/`count`, then the global
/// rewrites and numr-core. `line` must already have its own file references
/// resolved by the caller.
fn evaluate_export_line(
    core: &mut CoreEngine,
    line: &str,
    globals: &HashMap<String, String>,
) -> Option<(String, ExportValue)> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') || trimmed.starts_with("//") {
        return None;
    }

    let (name, rhs) = match split_assignment(trimmed) {
        Some((name, rhs)) => (Some(name), rhs),
        None => (None, trimmed),
    };
    if rhs.is_empty() {
        return None;
    }

    // Translate Chinese/local units before the date / aggregation branches
    // and the core evaluator, so `file("a")` documents containing `3斤`
    // evaluate just like the consumer document.
    let rhs_owned = rewrite_zh_units(rhs);
    let rhs = rhs_owned.as_str();

    // 1. Date interception. This must run before numr-core, which would
    //    otherwise read `start = 2024-01-01` as `2024 - 1 - 1`.
    if DateTimeEvaluator::is_datetime_expression(rhs)
        && !rhs.to_lowercase().starts_with("days_between(")
    {
        if let Ok(dt) = DateTimeEvaluator::evaluate_typed(rhs) {
            return name.map(|name| (name, ExportValue::Date(dt.iso)));
        }
    }

    // 2. `days_between(...)` yields a plain day count.
    if let Some(result) = DateTimeEvaluator::days_between_expression(rhs) {
        let n = result.ok()?;
        let value = Value::Number(Decimal::from(n));
        set_core_variable(core, name.as_deref(), &value);
        return name.map(|name| (name, ExportValue::Value(value)));
    }

    // 3. `count`/`len`/`length` are intercepted by the Numera layer.
    if AggregationEvaluator::is_aggregation(rhs) {
        let n = AggregationEvaluator::evaluate(&normalize_count_expression(rhs)).ok()?;
        let value = Value::Number(Decimal::from(n as i64));
        set_core_variable(core, name.as_deref(), &value);
        return name.map(|name| (name, ExportValue::Value(value)));
    }

    // 4. Everything else goes through the full line so assignments set their
    //    variable in `core` for subsequent lines.
    let processed = process_expression(rhs, globals);
    let full = match &name {
        Some(name) => format!("{} = {}", name, processed),
        None => processed,
    };
    let value = core.eval(&full);
    if value.is_empty() || value.is_error() {
        return None;
    }
    name.map(|name| (name, ExportValue::Value(value)))
}

/// Depth-first, memoizing resolver for cross-file references.
///
/// It borrows the immutable context/rates and the mutable export cache from
/// [`Engine`] as separate fields, so the mutually-recursive resolution can
/// re-enter without a `&mut self` self-borrow conflict.
struct RefResolver<'a> {
    context: &'a EngineContext,
    rates: &'a HashMap<String, Decimal>,
    cache: &'a mut HashMap<String, EvaluatedDocument>,
    /// Canonical document paths currently being evaluated, used for cycle
    /// detection (a path may appear only once in this stack).
    visiting: Vec<String>,
}

impl<'a> RefResolver<'a> {
    /// Replace every file reference in `expr` with its computed literal.
    fn resolve_expr(&mut self, expr: &str) -> Result<String, EngineError> {
        if !ReferenceEvaluator::contains_reference(expr) {
            return Ok(expr.to_string());
        }
        let chars: Vec<char> = expr.chars().collect();
        let mut result = String::with_capacity(expr.len());
        let mut i = 0usize;

        while i < chars.len() {
            if let Some((reference, next)) = ReferenceEvaluator::parse_reference_at(&chars, i) {
                let original: String = chars[i..next].iter().collect();
                match self.lookup_substitution(&reference)? {
                    Some(substitution) => result.push_str(&substitution),
                    None => result.push_str(&original),
                }
                i = next;
            } else {
                result.push(chars[i]);
                i += 1;
            }
        }
        Ok(result)
    }

    /// Look up a single reference's substitution text (parenthesized for
    /// typed values, bare for dates), or `None` when it does not resolve.
    fn lookup_substitution(
        &mut self,
        reference: &FileReference,
    ) -> Result<Option<String>, EngineError> {
        let Some(exports) = self.ensure_exports(&reference.filename)? else {
            return Ok(None);
        };
        let export = match reference.member.as_deref() {
            Some(member) => exports
                .iter()
                .find(|(name, _)| name == member)
                .map(|(_, value)| value),
            None => exports.first().map(|(_, value)| value),
        };
        Ok(export.and_then(export_to_substitution))
    }

    /// Ensure `alias` has a cached export table, evaluating (and recursively
    /// resolving) the document on a cache miss.
    fn ensure_exports(
        &mut self,
        alias: &str,
    ) -> Result<Option<EvaluatedDocument>, EngineError> {
        let Some(path) = self.context.resolve_file_path(alias) else {
            return Ok(None);
        };

        if let Some(cached) = self.cache.get(&path) {
            return Ok(Some(cached.clone()));
        }

        if let Some(position) = self.visiting.iter().position(|p| p == &path) {
            let mut chain = self.visiting[position..].to_vec();
            chain.push(path);
            return Err(EngineError::CircularReference(chain.join(" -> ")));
        }

        let Some(content) = self.context.get_document(&path).cloned() else {
            return Ok(None);
        };

        self.visiting.push(path.clone());
        let mut core = fresh_core_with(&self.context.globals, self.rates);
        let mut exports = EvaluatedDocument::new();
        for line in content.lines() {
            let resolved = self.resolve_expr(line)?;
            if let Some(entry) = evaluate_export_line(&mut core, &resolved, &self.context.globals)
            {
                exports.push(entry);
            }
        }
        self.visiting.pop();

        self.cache.insert(path, exports.clone());
        Ok(Some(exports))
    }
}

/// numr-core understands `avg`/`average` but not the `mean` alias that the
/// editor exposes. Rewrite `mean(` call tokens to `avg(` (case-insensitively,
/// only at an identifier boundary) so the core evaluator resolves variable
/// and cross-file arguments correctly.
fn normalize_aggregation_aliases(expr: &str) -> String {
    let bytes = expr.as_bytes();
    let mut out = String::with_capacity(expr.len());
    let mut i = 0usize;

    while i < bytes.len() {
        let is_mean = bytes[i].eq_ignore_ascii_case(&b'm')
            && bytes.len() - i >= 5
            && bytes[i + 1].eq_ignore_ascii_case(&b'e')
            && bytes[i + 2].eq_ignore_ascii_case(&b'a')
            && bytes[i + 3].eq_ignore_ascii_case(&b'n')
            && bytes[i + 4] == b'('
            && (i == 0 || !is_ident_byte(bytes[i - 1]));

        if is_mean {
            out.push_str("avg(");
            i += 5;
        } else {
            // `i` sits on an ASCII byte in the `mean` case only; advance by
            // whole chars so multi-byte content is copied verbatim.
            let ch = expr[i..].chars().next().expect("char boundary");
            out.push(ch);
            i += ch.len_utf8();
        }
    }

    out
}

/// ASCII identifier byte: `[A-Za-z0-9_]`.
fn is_ident_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
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

    // ------------------------------------------------------------------
    // Aggregation routing (numr-core handles sum/total/avg/average/min/
    // max/median; Numera only intercepts count/len/length)
    // ------------------------------------------------------------------

    #[test]
    fn test_sum_resolves_variable_arguments() {
        let mut engine = Engine::new();
        engine.eval("x = 10").unwrap();
        let result = engine.eval("sum(x, 5)").unwrap();
        assert_eq!(result, "15");
    }

    #[test]
    fn test_min_max_resolve_variable_arguments() {
        let mut engine = Engine::new();
        engine.eval("a = 3").unwrap();
        engine.eval("b = 7").unwrap();
        assert_eq!(engine.eval("min(a, b, 5)").unwrap(), "3");
        assert_eq!(engine.eval("max(a, b, 5)").unwrap(), "7");
    }

    #[test]
    fn test_sum_resolves_global_reference() {
        let mut engine = Engine::new();
        engine.set_globals("vat = 0.2");
        let outcomes = engine.evaluate_document("sum(global.vat, 10)");
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].is_error, "{:?}", outcomes[0].error);
        assert_eq!(outcomes[0].raw_value.as_f64(), Some(10.2));
    }

    #[test]
    fn test_mean_alias_is_normalized_to_avg() {
        let mut engine = Engine::new();
        engine.eval("x = 10").unwrap();
        assert_eq!(engine.eval("mean(x, 20)").unwrap(), "15");
    }

    #[test]
    fn test_count_is_still_intercepted() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("count(1, 2, 3)").unwrap(), "3");
        assert_eq!(engine.eval("len(4, 5)").unwrap(), "2");
    }

    #[test]
    fn test_sum_resolves_cross_file_member_references() {
        let mut engine = Engine::new();
        engine.load_document("a", "food = 30\nrent = 20");
        let result = engine
            .eval("sum(file(\"a\").food, file(\"a\").rent)")
            .unwrap();
        assert_eq!(result, "50");
    }

    #[test]
    fn test_bare_cross_file_reference_uses_first_variable() {
        let mut engine = Engine::new();
        engine.load_document("a", "food = 30\nrent = 20");
        assert_eq!(engine.eval("file(\"a\") + 5").unwrap(), "35");
    }

    #[test]
    fn test_count_resolves_cross_file_member_references() {
        // Regression: `count(...)` is intercepted before numr-core runs, so
        // the file references inside its arguments must be resolved first.
        let mut engine = Engine::new();
        engine.load_document("a", "x = 30\ny = 5");
        assert_eq!(engine.eval("count(file(\"a\").x)").unwrap(), "1");
        assert_eq!(
            engine.eval("count(file(\"a\").x, file(\"a\").y)").unwrap(),
            "2"
        );
    }

    #[test]
    fn test_days_between_resolves_cross_file_member_references() {
        let mut engine = Engine::new();
        engine.load_document("a", "start = 2024-01-01");
        engine.load_document("b", "end = 2024-01-15");
        let outcomes = engine.evaluate_document("days_between(file(\"a\").start, file(\"b\").end)");
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].is_error, "{:?}", outcomes[0].error);
        assert_eq!(outcomes[0].display, "14");
        assert_eq!(outcomes[0].kind, "number");
    }

    #[test]
    fn test_mixed_case_file_reference_is_resolved_by_engine() {
        let mut engine = Engine::new();
        engine.load_document("a", "food = 30\nrent = 20");
        assert_eq!(engine.eval("FiLe(\"a\").food + 5").unwrap(), "35");
    }

    // ------------------------------------------------------------------
    // days_between wiring
    // ------------------------------------------------------------------

    #[test]
    fn test_days_between_expression_is_wired() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("days_between(2024-01-01, 2024-01-15)");
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].is_error, "{:?}", outcomes[0].error);
        assert_eq!(outcomes[0].display, "14");
        assert_eq!(outcomes[0].kind, "number");
        assert_eq!(outcomes[0].raw_value.as_f64(), Some(14.0));
    }

    #[test]
    fn test_days_between_accepts_relative_date_words() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("days_between(today, today)").unwrap(), "0");
    }

    // ------------------------------------------------------------------
    // Exchange-rate backend
    // ------------------------------------------------------------------

    #[test]
    fn test_apply_rates_delegates_to_core() {
        let mut engine = Engine::new();
        let mut rates = HashMap::new();
        rates.insert("EUR".to_string(), numr_core::decimal("0.92"));
        let applied = engine.apply_rates(rates).unwrap();
        assert_eq!(applied, 1);
    }

    #[test]
    fn test_apply_rates_rejects_unknown_currency() {
        let mut engine = Engine::new();
        let mut rates = HashMap::new();
        rates.insert("NOT_A_CURRENCY".to_string(), numr_core::decimal("1"));
        assert!(engine.apply_rates(rates).is_err());
    }

    // ------------------------------------------------------------------
    // Value-based cross-file references (MVP semantics)
    // ------------------------------------------------------------------

    fn engine_with(docs: &[(&str, &str)]) -> Engine {
        let mut engine = Engine::new();
        for (name, content) in docs {
            engine.load_document(name, content);
        }
        engine
    }

    #[test]
    fn test_evaluate_document_exports_preserves_line_order() {
        let mut engine = engine_with(&[("a", "# comment\nfood = 30\nrent = 20\nbad = missing")]);
        let exports = engine.evaluate_document_exports("a").unwrap().unwrap();
        let names: Vec<&str> = exports.iter().map(|(name, _)| name.as_str()).collect();
        assert_eq!(names, vec!["food", "rent"]);
        assert_eq!(
            crate::value_ref::export_to_literal(&exports[0].1).unwrap(),
            "30"
        );
        assert_eq!(
            crate::value_ref::export_to_literal(&exports[1].1).unwrap(),
            "20"
        );
    }

    #[test]
    fn test_evaluate_document_exports_returns_none_for_unknown_document() {
        let mut engine = Engine::new();
        assert!(engine.evaluate_document_exports("ghost").unwrap().is_none());
    }

    #[test]
    fn test_precedence_is_preserved_by_parenthesized_substitution() {
        // Text substitution would produce `2 * 3 + 4 == 10`; computed-value
        // substitution must produce `2 * ( 7 ) == 14`.
        let mut engine = engine_with(&[("a", "x = 3 + 4")]);
        assert_eq!(engine.eval("2 * file(\"a\").x").unwrap(), "14");
    }

    #[test]
    fn test_member_references_are_computed_values() {
        let mut engine = engine_with(&[("a", "food = 30\nrent = 20")]);
        assert_eq!(
            engine.eval("file(\"a\").food + file(\"a\").rent").unwrap(),
            "50"
        );
        // Mixed member and bare (first-export) references.
        assert_eq!(engine.eval("file(\"a\").rent + file(\"a\")").unwrap(), "50");
    }

    #[test]
    fn test_transitive_reference_is_resolved_recursively() {
        let mut engine = engine_with(&[("a", "x = file(\"b\").y + 1"), ("b", "y = 4")]);
        assert_eq!(engine.eval("file(\"a\").x").unwrap(), "5");
    }

    #[test]
    fn test_transitive_reference_through_bare_reference() {
        let mut engine = engine_with(&[("a", "x = file(\"b\") + 1"), ("b", "y = 41")]);
        assert_eq!(engine.eval("file(\"a\").x").unwrap(), "42");
    }

    #[test]
    fn test_circular_reference_is_reported() {
        let mut engine = engine_with(&[("a", "x = file(\"b\").y"), ("b", "y = file(\"a\").x")]);
        let err = engine.eval("file(\"a\").x").unwrap_err();
        match err {
            EngineError::CircularReference(chain) => {
                assert!(chain.contains('a'), "chain missing a: {chain}");
                assert!(chain.contains('b'), "chain missing b: {chain}");
                assert_eq!(chain, "a -> b -> a");
            }
            other => panic!("expected CircularReference, got {other:?}"),
        }
    }

    #[test]
    fn test_self_reference_is_reported() {
        let mut engine = engine_with(&[("a", "x = file(\"a\").x + 1")]);
        let err = engine.eval("file(\"a\").x").unwrap_err();
        assert!(matches!(err, EngineError::CircularReference(_)));
    }

    #[test]
    fn test_cross_file_currency_arithmetic_keeps_type() {
        let mut engine = engine_with(&[("a", "price = 250 USD")]);
        assert_eq!(engine.eval("file(\"a\").price * 2").unwrap(), "$500.00");
        assert_eq!(
            engine.eval("file(\"a\").price + 50 USD").unwrap(),
            "$300.00"
        );
    }

    #[test]
    fn test_cross_file_currency_conversion_uses_rates() {
        let mut engine = engine_with(&[("a", "price = 100 USD")]);
        let mut rates = HashMap::new();
        rates.insert("EUR".to_string(), numr_core::decimal("0.92"));
        engine.apply_rates(rates).unwrap();
        assert_eq!(engine.eval("file(\"a\").price in EUR").unwrap(), "€92.00");
    }

    #[test]
    fn test_referenced_document_can_convert_currency_using_rates() {
        // The referenced document itself performs the conversion, so its
        // fresh core must have the rates applied.
        let mut engine = engine_with(&[("a", "price = 100 USD in EUR")]);
        let mut rates = HashMap::new();
        rates.insert("EUR".to_string(), numr_core::decimal("0.92"));
        engine.apply_rates(rates).unwrap();
        assert_eq!(engine.eval("file(\"a\").price").unwrap(), "€92.00");
    }

    #[test]
    fn test_cross_file_unit_arithmetic_keeps_type() {
        let mut engine = engine_with(&[("a", "dist = 5 km")]);
        assert_eq!(engine.eval("file(\"a\").dist * 2").unwrap(), "10 km");
    }

    #[test]
    fn test_cross_file_unit_conversion() {
        let mut engine = engine_with(&[("a", "dist = 5000 m")]);
        assert_eq!(engine.eval("file(\"a\").dist in km").unwrap(), "5 km");
    }

    #[test]
    fn test_cross_file_percentage_keeps_type() {
        let mut engine = engine_with(&[("a", "rate = 20%")]);
        assert_eq!(engine.eval("file(\"a\").rate").unwrap(), "20%");
        assert_eq!(engine.eval("200 * file(\"a\").rate").unwrap(), "40");
    }

    #[test]
    fn test_cross_file_base_number_keeps_type() {
        let mut engine = engine_with(&[("a", "n = 22 in hex")]);
        assert_eq!(engine.eval("file(\"a\").n").unwrap(), "0x16");
    }

    #[test]
    fn test_cross_file_date_reference() {
        let mut engine = engine_with(&[("a", "start = 2024-01-01")]);
        // Bare date reference is classified as a date.
        let outcomes = engine.evaluate_document("file(\"a\").start");
        assert_eq!(outcomes[0].kind, "date");
        assert_eq!(outcomes[0].raw_value, serde_json::json!("2024-01-01"));
    }

    #[test]
    fn test_days_between_with_cross_file_date() {
        let mut engine = engine_with(&[("a", "start = 2024-01-01")]);
        assert_eq!(
            engine
                .eval("days_between(file(\"a\").start, 2024-01-15)")
                .unwrap(),
            "14"
        );
    }

    #[test]
    fn test_date_arithmetic_with_cross_file_date() {
        let mut engine = engine_with(&[("a", "start = 2024-01-01")]);
        assert_eq!(
            engine.eval("file(\"a\").start + 30 days").unwrap(),
            "2024-01-31"
        );
    }

    #[test]
    fn test_referenced_document_uses_globals() {
        let mut engine = engine_with(&[("a", "total = 100 * global.vat")]);
        engine.set_globals("vat = 0.2");
        assert_eq!(engine.eval("file(\"a\").total").unwrap(), "20");
    }

    #[test]
    fn test_referenced_document_uses_global_functions() {
        let mut engine = engine_with(&[("a", "amount = global.tax(200)")]);
        engine.set_globals("tax(price) = price * 0.13");
        assert_eq!(engine.eval("file(\"a\").amount").unwrap(), "26");
    }

    #[test]
    fn test_count_with_parenthesized_substitution_still_counts() {
        let mut engine = engine_with(&[("a", "x = 30\ny = 5")]);
        assert_eq!(engine.eval("count(file(\"a\").x)").unwrap(), "1");
        assert_eq!(
            engine.eval("count(file(\"a\").x, file(\"a\").y)").unwrap(),
            "2"
        );
    }

    #[test]
    fn test_unknown_member_is_left_for_core_to_report() {
        let mut engine = engine_with(&[("a", "food = 30")]);
        assert!(engine.eval("file(\"a\").missing").is_err());
    }

    #[test]
    fn test_unknown_document_is_left_for_core_to_report() {
        let mut engine = engine_with(&[("a", "food = 30")]);
        assert!(engine.eval("file(\"ghost\").food").is_err());
    }

    #[test]
    fn test_document_cache_is_invalidated_by_load_document() {
        let mut engine = engine_with(&[("a", "x = 1")]);
        assert_eq!(engine.eval("file(\"a\").x").unwrap(), "1");
        engine.load_document("a", "x = 2");
        assert_eq!(engine.eval("file(\"a\").x").unwrap(), "2");
    }

    #[test]
    fn test_document_cache_is_invalidated_by_set_globals() {
        let mut engine = engine_with(&[("a", "x = global.vat")]);
        engine.set_globals("vat = 1");
        assert_eq!(engine.eval("file(\"a\").x").unwrap(), "1");
        engine.set_globals("vat = 2");
        assert_eq!(engine.eval("file(\"a\").x").unwrap(), "2");
    }

    #[test]
    fn test_document_cache_is_invalidated_by_apply_rates() {
        let mut engine = engine_with(&[("a", "price = 100 USD in EUR")]);
        let mut first = HashMap::new();
        first.insert("EUR".to_string(), numr_core::decimal("0.92"));
        engine.apply_rates(first).unwrap();
        assert_eq!(engine.eval("file(\"a\").price").unwrap(), "€92.00");

        let mut second = HashMap::new();
        second.insert("EUR".to_string(), numr_core::decimal("0.5"));
        engine.apply_rates(second).unwrap();
        assert_eq!(engine.eval("file(\"a\").price").unwrap(), "€50.00");
    }

    #[test]
    fn test_document_cache_is_invalidated_by_set_documents() {
        let mut engine = engine_with(&[("a", "x = 1")]);
        assert_eq!(engine.eval("file(\"a\").x").unwrap(), "1");
        engine.set_documents(vec![("a".to_string(), "x = 9".to_string())]);
        assert_eq!(engine.eval("file(\"a\").x").unwrap(), "9");
    }

    #[test]
    fn test_extension_alias_is_resolved_by_engine() {
        // A document stored as `daily.numr` is reachable via `file("daily")`.
        let mut engine = engine_with(&[("daily.numr", "x = 42")]);
        assert_eq!(engine.eval("file(\"daily\").x").unwrap(), "42");
    }

    #[test]
    fn test_first_export_still_wins_for_bare_reference() {
        let mut engine = engine_with(&[("a", "first = 10\nsecond = 20")]);
        assert_eq!(engine.eval("file(\"a\")").unwrap(), "10");
    }

    #[test]
    fn test_referenced_document_is_isolated_from_consumer_variables() {
        // The referenced document is evaluated in its own core; a variable
        // defined only in the consumer must not be visible there.
        let mut engine = engine_with(&[("a", "x = y + 1")]);
        assert_eq!(engine.eval("y = 99").unwrap(), "99");
        assert!(engine.eval("file(\"a\").x").is_err());
    }

    // ------------------------------------------------------------------
    // Chinese / local unit preprocessing
    // ------------------------------------------------------------------

    #[test]
    fn test_zh_jin_evaluates_to_half_kg() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("3斤").unwrap(), "1.50 kg");
    }

    #[test]
    fn test_zh_liang_evaluates_to_fiftieth_kg() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("2两").unwrap(), "0.10 kg");
    }

    #[test]
    fn test_zh_jin_units_add_correctly() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("3斤 + 2斤").unwrap(), "2.50 kg");
    }

    #[test]
    fn test_zh_mu_evaluates_to_square_meters() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("5亩");
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].is_error, "{:?}", outcomes[0].error);
        assert!(
            outcomes[0].display.contains("m²"),
            "expected m² display, got {}",
            outcomes[0].display
        );
        let value = outcomes[0].raw_value.as_f64().unwrap();
        assert!((value - 3333.3333333).abs() < 0.01, "got {value}");
    }

    #[test]
    fn test_zh_chi_evaluates_to_exactly_one_meter() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("3尺").unwrap(), "1 m");
    }

    #[test]
    fn test_zh_cun_evaluates_to_tenth_meter() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("3寸").unwrap(), "0.10 m");
    }

    #[test]
    fn test_zh_li_evaluates_to_half_km() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("3里").unwrap(), "1.50 km");
    }

    #[test]
    fn test_zh_kilocalorie_parses() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("800大卡").unwrap(), "800 kcal");
        assert_eq!(engine.eval("800千卡").unwrap(), "800 kcal");
    }

    #[test]
    fn test_zh_yuan_parses_as_cny() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("100元");
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].is_error, "{:?}", outcomes[0].error);
        assert_eq!(outcomes[0].display, "¥100.00");
        assert_eq!(engine.eval("3块").unwrap(), "¥3.00");
    }

    #[test]
    fn test_zh_units_mix_with_ascii_units() {
        let mut engine = Engine::new();
        assert_eq!(engine.eval("3 kg + 2斤").unwrap(), "4 kg");
    }

    #[test]
    fn test_zh_units_in_comment_are_not_rewritten() {
        let mut engine = Engine::new();
        let outcomes = engine.evaluate_document("# 3斤");
        assert_eq!(outcomes.len(), 1);
        assert!(outcomes[0].is_empty);
        assert!(!outcomes[0].is_error);
    }

    #[test]
    fn test_zh_units_in_inline_comment_do_not_break_expression() {
        let mut engine = Engine::new();
        // The `# 3斤` tail must survive untouched and not turn into an error.
        let outcomes = engine.evaluate_document("1 + 2 # 3斤");
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].is_error, "{:?}", outcomes[0].error);
        assert_eq!(outcomes[0].display, "3");
    }

    #[test]
    fn test_zh_unit_in_referenced_document() {
        let mut engine = engine_with(&[("a", "w = 3斤")]);
        assert_eq!(engine.eval("file(\"a\").w").unwrap(), "1.50 kg");
    }

    #[test]
    fn test_zh_unit_in_global_variable() {
        let mut engine = Engine::new();
        engine.set_globals("weight = 3斤");
        let outcomes = engine.evaluate_document("weight");
        assert_eq!(outcomes.len(), 1);
        assert!(!outcomes[0].is_error, "{:?}", outcomes[0].error);
        assert_eq!(outcomes[0].display, "1.50 kg");
    }
}

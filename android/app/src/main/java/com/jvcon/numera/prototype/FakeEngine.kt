package com.jvcon.numera.prototype

/**
 * Throwaway mirror of the engine's camelCase `LineOutcome`
 * (`crates/engine/src/eval.rs`, serialized camelCase to match the JS contract).
 *
 * Deliberately local to the `prototype` package: ticket #7 owns the real engine
 * binding and must not be touched here. The prototype only needs the six fields
 * the gutter reads.
 */
data class LineOutcome(
    val display: String,
    val error: String? = null,
    val isEmpty: Boolean = false,
    val isError: Boolean = false,
    val kind: String = "empty",
    val rawValue: String? = null,
) {
    companion object {
        fun empty() = LineOutcome(display = "", isEmpty = true, kind = "empty")

        fun value(display: String, kind: String) =
            LineOutcome(display = display, kind = kind, rawValue = display)

        fun error(message: String) =
            LineOutcome(display = "", error = message, isError = true, kind = "error")
    }
}

/**
 * Hardcoded stand-in for `Engine::evaluate_document`. It exists only to give
 * the gutter something to align; it performs no real evaluation and is keyed
 * to the sample document in [ResultGutterPrototype].
 */
internal object FakeEngine {

    fun evaluateDocument(content: String): List<LineOutcome> =
        content.split('\n').map(::evaluateLine)

    private fun evaluateLine(line: String): LineOutcome {
        val trimmed = line.trim()
        return when {
            // Empty lines and comments are `isEmpty` and render invisibly.
            trimmed.isEmpty() -> LineOutcome.empty()
            trimmed.startsWith("#") || trimmed.startsWith("//") -> LineOutcome.empty()

            // Deliberate error line: error color + warning glyph.
            trimmed.contains("/ 0") -> LineOutcome.error("division by zero")

            // Date-typed result.
            trimmed.contains("date(") -> LineOutcome.value("2026-09-30", kind = "date")

            // Long wrapping line: short display so the gutter stays narrow.
            trimmed.startsWith("savings") -> LineOutcome.value("3124", kind = "number")

            // Assignment: echo the right-hand side, like the design's `→ $6,500`.
            trimmed.contains('=') ->
                LineOutcome.value(trimmed.substringAfter('=').trim(), kind = "number")

            else -> LineOutcome.value("42", kind = "number")
        }
    }
}

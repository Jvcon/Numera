package com.jvcon.numera.engine

/**
 * The engine surface the editor state store depends on.
 *
 * This interface is the seam between the Compose/UI layer and the Rust engine
 * (seam S2). The production implementation is [UniFfiEngine]; tests can supply
 * an in-memory fake without touching native code.
 *
 * All methods that cross into the engine are `suspend` so callers never block
 * the main thread; implementations are expected to hop to a background
 * dispatcher.
 */
interface EnginePort {
    /** Replaces the globals content (`globals.numr`). */
    suspend fun setGlobals(content: String)

    /**
     * Replaces the cross-file document table used to resolve
     * `file("alias")` / `file("alias").member` references.
     */
    suspend fun setDocuments(aliases: Map<String, String>)

    /** Evaluates every line of [document], one [LineOutcome] per input line. */
    suspend fun evaluateDocument(document: String): List<LineOutcome>

    /** Evaluates a single expression; returns the formatted display string. */
    suspend fun eval(line: String): String

    /** Applies exchange rates; returns the number of rates accepted. */
    suspend fun applyRates(rates: Map<String, Double>): Int

    /**
     * UTF-16 offset where the executable expression ends (trailing comments
     * excluded). Pure and cheap, so it stays synchronous for use during text
     * layout.
     */
    fun expressionPrefixUtf16Len(line: String): Int
}

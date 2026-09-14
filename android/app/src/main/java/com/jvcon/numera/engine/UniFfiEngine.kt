package com.jvcon.numera.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import uniffi.numera.NumeraEngine

/**
 * [EnginePort] backed by the UniFFI-generated [NumeraEngine].
 *
 * The generated wrapper is synchronous and CPU-bound (and internally
 * `Arc<Mutex<..>>`-guarded, so it is safe to share), so every engine call is
 * dispatched to [Dispatchers.Default]. The only exception is
 * [expressionPrefixUtf16Len], which is a pure string computation and is called
 * directly from layout code.
 *
 * JSON is used for the two structured payloads (`LineOutcome` arrays and the
 * alias/rate maps) because UniFFI's UDL surface only exposes simple types.
 */
class UniFfiEngine(
    private val engine: NumeraEngine = NumeraEngine(),
    private val json: Json = NumeraJson,
) : EnginePort {

    override suspend fun setGlobals(content: String) {
        withContext(Dispatchers.Default) {
            engine.setGlobals(content)
        }
    }

    override suspend fun setDocuments(aliases: Map<String, String>) {
        withContext(Dispatchers.Default) {
            engine.setDocuments(json.encodeToString(aliases))
        }
    }

    override suspend fun evaluateDocument(document: String): List<LineOutcome> =
        withContext(Dispatchers.Default) {
            val payload = engine.evaluateDocument(document)
            if (payload.isBlank()) {
                emptyList()
            } else {
                runCatching { json.decodeFromString<List<LineOutcome>>(payload) }
                    .getOrElse { emptyList() }
            }
        }

    override suspend fun eval(line: String): String =
        withContext(Dispatchers.Default) {
            engine.eval(line)
        }

    override suspend fun applyRates(rates: Map<String, Double>): Int =
        withContext(Dispatchers.Default) {
            engine.applyRates(json.encodeToString(rates)).toInt()
        }

    override fun expressionPrefixUtf16Len(line: String): Int =
        engine.expressionPrefixUtf16Len(line).toInt()
}

package com.jvcon.numera.engine

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * One engine outcome per document line, mirroring the camelCase JSON contract
 * emitted by `Engine::evaluate_document` in `crates/engine/src/eval.rs`.
 *
 * The Rust side serializes `LineOutcome` with `#[serde(rename_all =
 * "camelCase")]`, so the wire keys are `display`, `error`, `isEmpty`,
 * `isError`, `kind`, `rawValue`. The Kotlin property names below already match
 * those keys, so no `@SerialName` overrides are required.
 *
 * `rawValue` stays a raw [JsonElement] because it is polymorphic: a JSON number
 * for `kind == "number"`, an ISO-8601 string for `kind == "date"`, and `null`
 * for `empty` / `error` lines.
 */
@Serializable
data class LineOutcome(
    val display: String,
    val error: String? = null,
    val isEmpty: Boolean,
    val isError: Boolean,
    val kind: String,
    val rawValue: JsonElement? = null,
)

/**
 * Parser for every engine JSON payload crossing the FFI boundary.
 *
 * `ignoreUnknownKeys` keeps older clients working if the engine grows new
 * `kind`-specific fields.
 */
val NumeraJson: Json = Json {
    ignoreUnknownKeys = true
}

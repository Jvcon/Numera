package com.jvcon.numera.engine

import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.Test

/**
 * Golden-JSON contract test (seam S2).
 *
 * The engine serializes `Vec<LineOutcome>` to JSON and hands it to Kotlin as a
 * single string. This test pins the exact camelCase wire shape and proves
 * kotlinx.serialization parses all four outcome kinds (number, date, empty,
 * error) without an Android device or the native library.
 */
class LineOutcomeTest {

    private val golden = """
        [
          {
            "display": "2",
            "error": null,
            "isEmpty": false,
            "isError": false,
            "kind": "number",
            "rawValue": 2.0
          },
          {
            "display": "2026-09-07",
            "error": null,
            "isEmpty": false,
            "isError": false,
            "kind": "date",
            "rawValue": "2026-09-07"
          },
          {
            "display": "",
            "error": null,
            "isEmpty": true,
            "isError": false,
            "kind": "empty",
            "rawValue": null
          },
          {
            "display": "",
            "error": "unknown variable: nope",
            "isEmpty": false,
            "isError": true,
            "kind": "error",
            "rawValue": null
          }
        ]
    """.trimIndent()

    @Test
    fun parsesAllFourOutcomeKinds() {
        val outcomes = NumeraJson.decodeFromString<List<LineOutcome>>(golden)
        assertEquals(4, outcomes.size)

        val number = outcomes[0]
        assertEquals("2", number.display)
        assertEquals("number", number.kind)
        assertFalse(number.isEmpty)
        assertFalse(number.isError)
        assertNull(number.error)
        assertEquals(2.0, number.rawValue?.jsonPrimitive?.double)

        val date = outcomes[1]
        assertEquals("2026-09-07", date.display)
        assertEquals("date", date.kind)
        assertFalse(date.isError)
        assertEquals("2026-09-07", date.rawValue?.jsonPrimitive?.content)

        val empty = outcomes[2]
        assertEquals("", empty.display)
        assertEquals("empty", empty.kind)
        assertTrue(empty.isEmpty)
        assertFalse(empty.isError)
        assertNull(empty.rawValue)

        val error = outcomes[3]
        assertEquals("error", error.kind)
        assertTrue(error.isError)
        assertFalse(error.isEmpty)
        assertEquals("unknown variable: nope", error.error)
        assertNull(error.rawValue)
    }

    @Test
    fun emptyJsonArrayYieldsNoOutcomes() {
        assertEquals(emptyList<LineOutcome>(), NumeraJson.decodeFromString<List<LineOutcome>>("[]"))
    }

    @Test
    fun unknownFieldsAreIgnored() {
        val payload = """
            [{"display":"1","isEmpty":false,"isError":false,"kind":"number","futureField":true}]
        """.trimIndent()
        val outcomes = NumeraJson.decodeFromString<List<LineOutcome>>(payload)
        assertEquals(1, outcomes.size)
        assertEquals("1", outcomes.single().display)
        assertNull(outcomes.single().rawValue)
    }
}

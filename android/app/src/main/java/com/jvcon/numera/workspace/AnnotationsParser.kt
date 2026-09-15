package com.jvcon.numera.workspace

/**
 * Tiny `# @...` annotation parser for input/result highlighting.
 *
 * Faithful port of `parseAnnotations` in `web/src/lib/templates.ts`.
 *
 * A comment line is any line whose trimmed form starts with `#`. For an
 * `@input`/`@result` marker, the annotated line is the immediately following
 * line (`index + 2` in 1-based terms). Markers that trail the document (no
 * following line) are ignored. Everything else is ignored.
 */
internal fun parseAnnotations(content: String): Annotations {
    val lines = content.split('\n')
    val inputs = mutableListOf<Int>()
    val results = mutableListOf<Int>()
    var money = false

    for (i in lines.indices) {
        val trimmed = lines[i].trimStart()
        if (!trimmed.startsWith("#")) continue

        // Drop the leading `#` and surrounding whitespace.
        val body = trimmed.substring(1).trim()

        if (body == "@money") {
            money = true
            continue
        }

        val isInput = body == "@input" || body.startsWith("@input ")
        val isResult = body == "@result" || body.startsWith("@result ")
        if (!isInput && !isResult) continue

        val nextLine = i + 2 // 1-based line number of the following line
        if (nextLine > lines.size) continue
        if (isInput) {
            inputs.add(nextLine)
        } else {
            results.add(nextLine)
        }
    }

    return Annotations(
        money = money,
        inputs = inputs,
        results = results,
        firstInputLine = inputs.firstOrNull(),
    )
}

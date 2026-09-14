package com.jvcon.numera.prototype

/*
 * Throwaway local port of the engine's `expression_prefix_utf16_len`
 * (`crates/engine/src/expression_prefix.rs`).
 *
 * The real editor anchors the result to the END of a line's executable
 * expression — everything up to the first `#` or `//` comment marker, with
 * leading/trailing whitespace trimmed — not to the end of the raw line (which
 * may carry a trailing comment). In this prototype the fake engine's *values*
 * do not depend on it; the anchor is used solely to pick which *visual* row of
 * a soft-wrapped logical line the result hangs off.
 *
 * Keeping the same UTF-16 offset contract as the engine means the anchoring
 * math here drops straight into ticket #11's real `LineOutcome` pipeline.
 */

/**
 * Returns the UTF-16 code-unit offset within [line] just past the last
 * non-whitespace character of the executable expression. Returns 0 for blank
 * and comment-only lines.
 */
internal fun expressionPrefixUtf16Len(line: String): Int {
    if (line.isBlank()) return 0

    var leading = 0
    while (leading < line.length && line[leading].isWhitespace()) leading++
    val leadingUtf16 = leading

    val body = line.substring(leading)
    var commentAt = -1
    var i = 0
    while (i < body.length) {
        val isHash = body[i] == '#'
        val isSlashSlash = body[i] == '/' && i + 1 < body.length && body[i + 1] == '/'
        // Comment markers only count at line start or after whitespace, so a
        // `#` inside an expression (e.g. `tag#1 = 5`) is not mistaken for one.
        val atBoundary = i == 0 || body[i - 1].isWhitespace()
        if ((isHash || isSlashSlash) && atBoundary) {
            commentAt = i
            break
        }
        i++
    }

    val expr = if (commentAt >= 0) body.substring(0, commentAt) else body
    var exprEnd = expr.length
    while (exprEnd > 0 && expr[exprEnd - 1].isWhitespace()) exprEnd--

    return leadingUtf16 + exprEnd
}

/** UTF-16 start offset of every logical line in [text], split on '\n'. */
internal fun logicalLineStarts(text: CharSequence): List<Int> {
    val starts = ArrayList<Int>()
    starts += 0
    for (i in text.indices) {
        if (text[i] == '\n') starts += i + 1
    }
    return starts
}

/**
 * For each logical line in [content], the absolute UTF-16 offset of the end of
 * its executable expression — the anchor the result gutter hangs off. The
 * result list is index-aligned with `FakeEngine.evaluateDocument(content)`.
 */
internal fun expressionAnchorOffsets(content: String): List<Int> {
    val starts = logicalLineStarts(content)
    return content.split('\n').mapIndexed { index, line ->
        starts[index] + expressionPrefixUtf16Len(line)
    }
}

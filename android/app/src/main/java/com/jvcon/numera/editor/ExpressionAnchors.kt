package com.jvcon.numera.editor

import com.jvcon.numera.engine.EnginePort

/**
 * Anchoring math for the result gutter.
 *
 * Faithful port of the prototype's `ExpressionPrefix.kt`, with one change: the
 * per-line executable-expression prefix length comes from the real engine
 * ([EnginePort.expressionPrefixUtf16Len]) instead of the prototype's local
 * re-implementation. The offset contract is identical, so the anchoring math
 * drops straight into the real `LineOutcome` pipeline.
 */

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
 * result list is index-aligned with the engine's `evaluateDocument` outcomes.
 */
internal fun expressionAnchorOffsets(content: String, engine: EnginePort): List<Int> {
    val starts = logicalLineStarts(content)
    return content.split('\n').mapIndexed { index, line ->
        starts[index] + engine.expressionPrefixUtf16Len(line)
    }
}

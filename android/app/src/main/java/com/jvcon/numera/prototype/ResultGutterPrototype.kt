package com.jvcon.numera.prototype

import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldDecorator
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import com.jvcon.numera.ui.theme.JetBrainsMono
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.ui.theme.NumeraMonoType
import com.jvcon.numera.ui.theme.NumeraTheme
import kotlin.math.roundToInt

/*
 * THROWAWAY SPIKE for issue #10 — de-risks the one open question blocking the
 * real editor (#11): can a parallel result-gutter column stay locked to a
 * state-based `BasicTextField` through scroll, soft-wrap, and line-height
 * changes?
 *
 * The chosen technique is "same-layout overlay": the gutter is rendered inside
 * the text field's `TextFieldDecorator.Decoration` slot, next to the
 * `innerTextField`, and each result's Y comes from the live `TextLayoutResult`
 * captured by `onTextLayout`. Because the gutter shares the text field's
 * layout AND its `ScrollState`, it is locked for free. See README.md.
 *
 * Not wired into MainActivity; not part of the shipping editor.
 */

private val RESULT_GUTTER_WIDTH = 104.dp

/**
 * Sample document exercising every gutter state: comments, assignments, a long
 * expression that soft-wraps across several visual rows, a blank line, a
 * date-typed value, and an error.
 */
private val SAMPLE_DOCUMENT = """
    # monthly budget
    monthly_income = ${'$'}6,500
    tax_rate       = 22%
    rent           = ${'$'}1,800
    savings = monthly_income * (1 - tax_rate) - rent - groceries - utilities - transport - insurance
    next_payday    = date("2026-09-30")

    ratio = 1 / 0
""".trimIndent()

/**
 * Prototype screen: one multi-line [BasicTextField] (the whole document) plus a
 * parallel result gutter. Not intended to be called from the app.
 */
@Composable
fun ResultGutterPrototype(modifier: Modifier = Modifier) {
    val state = rememberTextFieldState(SAMPLE_DOCUMENT)
    val scrollState = rememberScrollState()
    val layoutResultState = remember { mutableStateOf<TextLayoutResult?>(null) }

    // `state.text` is a live CharSequence; snapshot it so it is a stable
    // `remember` key and so every offset below is a well-defined UTF-16 index.
    val content = state.text.toString()
    val outcomes = remember(content) { FakeEngine.evaluateDocument(content) }
    val anchors = remember(content) { expressionAnchorOffsets(content) }

    val editorStyle = TextStyle(
        fontFamily = JetBrainsMono,
        fontSize = NumeraMonoType.mediumSize,
        lineHeight = NumeraMonoType.mediumLineHeight,
        color = MaterialTheme.colorScheme.onSurface,
    )
    val resultStyle = editorStyle.copy(
        color = MaterialTheme.colorScheme.tertiary,
        fontWeight = FontWeight.Medium,
    )
    val errorStyle = editorStyle.copy(
        color = MaterialTheme.colorScheme.error,
        fontWeight = FontWeight.Medium,
    )

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Column(Modifier.fillMaxSize()) {
            Text(
                text = "Result gutter prototype · issue #10",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(
                    horizontal = NumeraDimens.space3,
                    vertical = NumeraDimens.space2,
                ),
            )
            BasicTextField(
                state = state,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                textStyle = editorStyle,
                lineLimits = TextFieldLineLimits.MultiLine(),
                // The gutter reads this SAME ScrollState, which is what keeps
                // the two columns in lock-step.
                scrollState = scrollState,
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                onTextLayout = { getResult ->
                    // `getResult` is the lazy provider from BasicTextField's
                    // onTextLayout; reading it subscribes to layout changes.
                    layoutResultState.value = getResult()
                },
                decorator = ResultGutterDecorator(
                    layoutResultState = layoutResultState,
                    outcomes = outcomes,
                    anchors = anchors,
                    scrollState = scrollState,
                    resultStyle = resultStyle,
                    errorStyle = errorStyle,
                ),
            )
        }
    }
}

/**
 * Decorator that puts the text field and the result gutter side by side inside
 * the field's own decoration slot. It reads [layoutResultState] only inside
 * [Decoration] so that a layout change recomposes the gutter, not the field.
 */
private class ResultGutterDecorator(
    private val layoutResultState: State<TextLayoutResult?>,
    private val outcomes: List<LineOutcome>,
    private val anchors: List<Int>,
    private val scrollState: ScrollState,
    private val resultStyle: TextStyle,
    private val errorStyle: TextStyle,
) : TextFieldDecorator {

    @Composable
    override fun Decoration(innerTextField: @Composable () -> Unit) {
        Row(Modifier.fillMaxSize()) {
            Box(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxHeight(),
            ) {
                innerTextField()
            }
            ResultGutter(
                layoutResult = layoutResultState.value,
                outcomes = outcomes,
                anchors = anchors,
                scrollState = scrollState,
                resultStyle = resultStyle,
                errorStyle = errorStyle,
                modifier = Modifier
                    .width(RESULT_GUTTER_WIDTH)
                    .fillMaxHeight(),
            )
        }
    }
}

/**
 * Draws one right-aligned result per non-empty logical line.
 *
 * Y is derived from the shared [layoutResult]: for each logical line we take the
 * end-of-expression anchor offset, ask the layout which *visual* line contains
 * the last character of that expression (this is what makes soft-wrap correct),
 * and use that visual line's top. Subtracting [scrollState].value puts the
 * result in the same viewport frame as the text, which is itself laid out at
 * `-scrollState.value` inside the field.
 */
@Composable
private fun ResultGutter(
    layoutResult: TextLayoutResult?,
    outcomes: List<LineOutcome>,
    anchors: List<Int>,
    scrollState: ScrollState,
    resultStyle: TextStyle,
    errorStyle: TextStyle,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .clipToBounds()
            .padding(end = NumeraDimens.space2),
    ) {
        val layout = layoutResult ?: return@Box
        val textLength = layout.layoutInput.text.length
        if (textLength == 0) return@Box

        outcomes.forEachIndexed { index, outcome ->
            // Empty / comment lines render nothing but still occupy a logical
            // line; skipping them is what keeps result-to-line alignment exact.
            if (outcome.isEmpty) return@forEachIndexed

            val anchor = anchors.getOrNull(index) ?: return@forEachIndexed
            val anchorChar = (anchor - 1).coerceIn(0, textLength - 1)
            val visualLine = layout.getLineForOffset(anchorChar)
            val lineTop = layout.getLineTop(visualLine)

            val isError = outcome.isError
            Text(
                text = if (isError) "⚠ ${outcome.error ?: "Err"}" else outcome.display,
                style = if (isError) errorStyle else resultStyle,
                maxLines = 1,
                softWrap = false,
                overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End,
                modifier = Modifier
                    .fillMaxWidth()
                    // `offset {}` reads scrollState in the layout phase, so
                    // scrolling relayouts the gutter without recomposing it.
                    .offset { IntOffset(0, (lineTop - scrollState.value).roundToInt()) },
            )
        }
    }
}

@Preview(showBackground = true, widthDp = 360, heightDp = 640)
@Composable
private fun ResultGutterPrototypePreview() {
    NumeraTheme {
        ResultGutterPrototype()
    }
}

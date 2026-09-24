package com.jvcon.numera.editor

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.input.TextFieldDecorator
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import com.jvcon.numera.engine.LineOutcome
import com.jvcon.numera.ui.theme.NumeraDimens
import kotlin.math.roundToInt

/**
 * Decorator that lays the text field, the error-underline overlay, and the
 * result gutter side by side inside the field's own decoration slot.
 *
 * [layoutResultState] is read only inside [Decoration] so a layout change
 * recomposes the gutter/overlay, not the text field itself.
 */
internal class ResultGutterDecorator(
    private val layoutResultState: State<TextLayoutResult?>,
    private val outcomes: List<LineOutcome>,
    private val anchors: List<Int>,
    private val scrollState: ScrollState,
    private val resultStyle: TextStyle,
    private val errorStyle: TextStyle,
    private val onCopyValue: (String) -> Unit,
    private val onErrorTap: (String) -> Unit,
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
                ErrorUnderlineOverlay(
                    layoutResult = layoutResultState.value,
                    outcomes = outcomes,
                    anchors = anchors,
                    scrollState = scrollState,
                    color = MaterialTheme.colorScheme.error,
                )
            }
            ResultGutter(
                layoutResult = layoutResultState.value,
                outcomes = outcomes,
                anchors = anchors,
                scrollState = scrollState,
                resultStyle = resultStyle,
                errorStyle = errorStyle,
                onCopyValue = onCopyValue,
                onErrorTap = onErrorTap,
                modifier = Modifier
                    .width(NumeraDimens.resultGutterWidth)
                    .fillMaxHeight(),
            )
        }
    }
}

/**
 * Draws one right-aligned result per non-empty logical line.
 *
 * Y is derived from the shared [layoutResult]: for each logical line we take
 * the end-of-expression anchor offset, ask the layout which *visual* line
 * contains the last character of that expression (this is what makes soft-wrap
 * correct), and use that visual line's top. Subtracting [scrollState].value
 * puts the result in the same viewport frame as the text.
 */
@Composable
private fun ResultGutter(
    layoutResult: TextLayoutResult?,
    outcomes: List<LineOutcome>,
    anchors: List<Int>,
    scrollState: ScrollState,
    resultStyle: TextStyle,
    errorStyle: TextStyle,
    onCopyValue: (String) -> Unit,
    onErrorTap: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            // Distinct results column (web: surface-container-low + a 1dp
            // outline-variant border between source and results).
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .clipToBounds()
            .testTag("result-gutter"),
    ) {
        VerticalDivider(
            modifier = Modifier.align(Alignment.CenterStart),
            color = MaterialTheme.colorScheme.outlineVariant,
        )

        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(end = NumeraDimens.space2),
        ) {
            val layout = layoutResult ?: return@Box
            val textLength = layout.layoutInput.text.length
            if (textLength == 0) return@Box

            outcomes.forEachIndexed { index, outcome ->
                // Error cells win over empty cells (matches the web `outcomeToMarker`
                // ordering: isError, then isEmpty, then value).
                if (outcome.isError) {
                    val anchor = anchors.getOrNull(index) ?: return@forEachIndexed
                    val lineTop = visualLineTop(layout, anchor, textLength)
                    ErrorCell(
                        onTap = { onErrorTap(outcome.error ?: "Error") },
                        style = errorStyle,
                        modifier = Modifier
                            .fillMaxWidth()
                            // `offset {}` reads scrollState in the layout phase, so
                            // scrolling relayouts the gutter without recomposing it.
                            .offset { IntOffset(0, (lineTop - scrollState.value).roundToInt()) }
                            .testTag("error-$index"),
                    )
                    return@forEachIndexed
                }

                // Empty / comment lines render nothing but keep their row.
                if (outcome.isEmpty || outcome.display.isEmpty()) return@forEachIndexed

                val anchor = anchors.getOrNull(index) ?: return@forEachIndexed
                val lineTop = visualLineTop(layout, anchor, textLength)
                ValueCell(
                    text = outcome.display,
                    style = resultStyle,
                    onTap = { onCopyValue(outcome.display) },
                    modifier = Modifier
                        .fillMaxWidth()
                        .offset { IntOffset(0, (lineTop - scrollState.value).roundToInt()) }
                        .testTag("result-$index"),
                )
            }
        }
    }
}

/** The unscrolled layout Y of the visual line holding [anchor]'s last char. */
private fun visualLineTop(
    layout: TextLayoutResult,
    anchor: Int,
    textLength: Int,
): Float {
    val anchorChar = (anchor - 1).coerceIn(0, textLength - 1)
    val visualLine = layout.getLineForOffset(anchorChar)
    return layout.getLineTop(visualLine)
}

/** A copyable value result cell: right-aligned tertiary mono text. */
@Composable
private fun ValueCell(
    text: String,
    style: TextStyle,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = style,
        maxLines = 1,
        softWrap = false,
        overflow = TextOverflow.Ellipsis,
        textAlign = TextAlign.End,
        modifier = modifier.clickable(onClick = onTap),
    )
}

/**
 * An error cell: `[warning] Err [info]`, tinted with the error color. Tapping
 * anywhere on it surfaces the message.
 */
@Composable
private fun ErrorCell(
    style: TextStyle,
    onTap: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.clickable(onClick = onTap),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.End,
    ) {
        Icon(
            imageVector = Icons.Filled.Warning,
            contentDescription = null,
            tint = style.color,
            modifier = Modifier.size(NumeraDimens.iconSmall),
        )
        Spacer(Modifier.width(NumeraDimens.space1))
        Text(
            text = "Err",
            style = style,
            maxLines = 1,
            softWrap = false,
        )
        Spacer(Modifier.width(NumeraDimens.space1))
        Icon(
            imageVector = Icons.Outlined.Info,
            contentDescription = "Show error",
            tint = style.color,
            modifier = Modifier.size(NumeraDimens.iconSmall),
        )
    }
}

/**
 * Dashed underline drawn under each error source line. Shares the text field's
 * [TextLayoutResult] and [ScrollState] so it stays locked to the source text
 * through scroll and soft-wrap.
 */
@Composable
private fun ErrorUnderlineOverlay(
    layoutResult: TextLayoutResult?,
    outcomes: List<LineOutcome>,
    anchors: List<Int>,
    scrollState: ScrollState,
    color: Color,
) {
    Canvas(Modifier.fillMaxSize()) {
        val layout = layoutResult ?: return@Canvas
        val textLength = layout.layoutInput.text.length
        if (textLength == 0) return@Canvas

        val scroll = scrollState.value.toFloat()
        val stroke = NumeraDimens.errorUnderlineStroke.toPx()
        val dash = floatArrayOf(
            NumeraDimens.errorUnderlineDash.toPx(),
            NumeraDimens.errorUnderlineGap.toPx(),
        )

        outcomes.forEachIndexed { index, outcome ->
            if (!outcome.isError) return@forEachIndexed
            val anchor = anchors.getOrNull(index) ?: return@forEachIndexed
            val anchorChar = (anchor - 1).coerceIn(0, textLength - 1)
            val visualLine = layout.getLineForOffset(anchorChar)
            val left = layout.getLineLeft(visualLine)
            val right = layout.getLineRight(visualLine)
            val bottom = layout.getLineBottom(visualLine)
            val y = bottom - scroll - NumeraDimens.errorUnderlineOffset.toPx()
            drawLine(
                color = color,
                start = Offset(left, y),
                end = Offset(right, y),
                strokeWidth = stroke,
                pathEffect = PathEffect.dashPathEffect(dash),
            )
        }
    }
}

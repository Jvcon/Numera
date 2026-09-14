# Result-gutter prototype (issue #10) — findings

Throwaway spike for the one open question blocking the real editor (#11):

> Can a parallel "result gutter" column be locked to a multi-line
> `BasicTextField2` so results stay aligned per logical line through scroll,
> soft-wrap, and line-height changes?

**Answer: yes — and no fallback is needed.** The state-based text field exposes
the live `TextLayoutResult`, so the gutter is drawn from the *same layout the
text is drawn from*. Details below.

> This package is not wired into `MainActivity` and is not part of the shipping
> editor. It does not touch the real `engine/` package (ticket #7).

---

## 0. The API reality on BOM `2024.10.01` (Compose Foundation/UI 1.7.5)

The ADR names `BasicTextField2`. On this BOM **there is no `BasicTextField2`
symbol**: it was renamed in 1.7.0 to the state-based overload
`androidx.compose.foundation.text.BasicTextField(state: TextFieldState, …)`.
(Verified against the 1.7.5 sources jar.) Two other changes matter:

| Old (`BasicTextField` v1) | State-based `BasicTextField` (1.7.x) |
|---|---|
| `value` / `onValueChange` | `state: TextFieldState` |
| `decorationBox: @Composable (inner) -> Unit` | `decorator: TextFieldDecorator?` (`Decoration(innerTextField)`) |
| `onTextLayout: (TextLayoutResult) -> Unit` | `onTextLayout: (Density.(getResult: () -> TextLayoutResult?) -> Unit)?` |
| internal scroll | **`scrollState: ScrollState = rememberScrollState()` is a public parameter** |

### Key finding: line metrics ARE available

The state-based field exposes exactly what the gutter needs:

```kotlin
BasicTextField(
    state = state,
    onTextLayout = { getResult -> layoutResultState.value = getResult() },
    scrollState = scrollState,          // hoistable → shared with the gutter
    lineLimits = TextFieldLineLimits.MultiLine(),
    decorator = ResultGutterDecorator(…),
)
```

`onTextLayout` hands back a **lazy provider** (`getResult()`) because the layout
is not ready during composition; reading it subscribes the caller to layout
changes. From the resulting `TextLayoutResult` we use the full line-metric
surface: `lineCount`, `getLineTop(i)`, `getLineBottom(i)`, `getLineForOffset(o)`,
`getHorizontalPosition(o, …)`, `getLineStart/End(i)`, `layoutInput.text`.

So the recommendation for #11 is: **use the state-based `BasicTextField` +
`TextFieldDecorator` + `onTextLayout`; do not fall back to v1.**

---

## 1. Technique chosen: same-layout gutter overlay

The gutter is rendered **inside the field's own decoration slot**, as a sibling
of `innerTextField`, not as an independently-scrolling column:

```
BasicTextField.decorator = ResultGutterDecorator {
    Row {
        Box(weight(1f)) { innerTextField() }      // the editor
        ResultGutter(width = 104.dp)              // the gutter
    }
}
```

Per result:

1. **Logical → visual line.** For logical line *i* compute its
   end-of-expression anchor offset (§3). Ask the layout which visual line
   contains the last character of that expression:
   `layout.getLineForOffset(anchor - 1)`. This is what makes soft-wrap correct:
   a logical line that wraps to N visual rows places its result on the row where
   the expression actually ends.
2. **Y.** `layout.getLineTop(visualLine)` (px, from the live layout).
3. **Scroll.** Subtract the field's own `scrollState.value`. Internally
   `TextFieldCoreModifier` places the text layout at
   `placeRelative(0, -scrollState.value)`, so the gutter uses the identical
   offset. The subtraction is done in the **layout phase** via
   `Modifier.offset { IntOffset(0, y) }`, so scrolling relayouts the gutter
   without recomposing it.
4. **X.** Right-aligned: `Text(fillMaxWidth, textAlign = TextAlign.End)`.
   The design's right-aligned gutter is X-independent of the anchor; the anchor
   only picks the row.

`TextFieldDecorator` is read only inside `Decoration`, so a layout change
recomposes the gutter, not the text field.

### Why it locks

- **Scroll:** the gutter and the text share the *same* `ScrollState` instance
  and the same subtraction the field itself uses.
- **Soft-wrap:** the gutter reads the field's actual `TextLayoutResult`; it never
  re-derives break positions.
- **Line-height / font changes:** `getLineTop` comes from the current layout, so
  it tracks automatically.
- There is no second text layout to keep in sync — one source of truth.

---

## 2. Anchoring: end-of-expression vs end-of-line

`ExpressionPrefix.kt` ports the engine's `expression_prefix_utf16_len`
(`crates/engine/src/expression_prefix.rs`) verbatim in contract (UTF-16
code-unit offset just past the last non-whitespace char before a `#` / `//`
comment, boundary-aware so `tag#1 = 5` is not treated as a comment).

`expressionAnchorOffsets(content)` = `lineStart + expressionPrefixUtf16Len(line)`
per logical line, index-aligned with the fake engine's outcomes. To switch
policies:

- **End-of-expression (chosen):** `getLineForOffset(anchor - 1)` → the visual row
  where the expression ends (ignores a trailing comment).
- **End-of-line:** use `lineStart + line.length - 1` (or `layout.getLineEnd` of
  the last visual row) instead of the prefix length.
- **Result immediately after the expression** (rather than a right-aligned
  gutter): also use `layout.getHorizontalPosition(anchor, usePrimaryDirection = true)`
  for X; `usePrimaryDirection` matters for RTL/bidi.

The fake engine's *values* deliberately do not depend on the anchor — only the
row selection does — so the anchor math can be lifted into #11 unchanged.

---

## 3. Caveats / risks for #11

1. **Per-result composables are O(lines).** The prototype emits one `Text` per
   result. For the real editor, draw all results in a single `Canvas` with
   `rememberTextMeasurer()` + `DrawScope.drawText`, using the same line math.
   That also gives a place to draw the inline error underline.
2. **Coordinate-frame assumption.** The gutter assumes the text layout origin
   equals the `innerTextField` origin. I checked `textFieldMinSize` /
   `heightInLines` / `TextFieldCoreModifier` in 1.7.5: they only set constraints
   and place at `(0, -scroll)` with no padding, so it holds. A future Compose
   version could add internal padding; the robust fix is to draw the gutter in
   the same scrollable frame rather than a sibling.
3. **Transformations break offset identity.** `layoutInput.text` is the
   *transformed* text. The prototype applies no transformation, so offsets map
   1:1 to the document. The real editor wants syntax highlighting; if that uses
   an `OutputTransformation` that changes text length, anchors computed on the
   raw document will be wrong. Either use a length-preserving transformation, or
   map anchor offsets through the transformation. **This is the main open item
   for #11.**
4. **Recomposition from `onTextLayout`.** Writing the layout result to snapshot
   state from the layout callback is the documented pattern, but adds a frame of
   lag on fast input. Evaluation should be debounced anyway (engine cost).
5. **IME composition.** CJK/composing text changes mid-composition; anchors are
   recomputed per change and may briefly lag. Debounce covers it.
6. **Accessibility.** Gutter `Text` nodes are separate semantics; merge/clear
   them (`clearAndSetSemantics`) so screen readers don't read results as a
   second document.
7. **Verification level.** Not run on a device/emulator. The code was
   type-checked against real Compose 1.7.x (a throwaway JVM Compose 1.7.3
   project compiled `compileKotlin` green) with only the Android
   `@Preview` annotation stubbed out. The internal `-scrollState.value`
   placement was read from the 1.7.5 foundation sources, not observed at runtime.

---

## 4. Fallbacks considered and rejected

- **Separate `Canvas`/`Column` beside the field, synced only by a shared
  `ScrollState`.** Rejected: Y still requires re-deriving soft-wrap breaks for
  the same width/text/style (a second `TextMeasurer`/`Paragraph`), which drifts
  on wrap and on line-height/font changes. The hard part is exactly the layout,
  so reuse the field's.
- **V1 `BasicTextField` (`decorationBox` + `onTextLayout: (TextLayoutResult) -> Unit`).**
  Works and exposes metrics directly, but scroll is internal (no hoistable
  `ScrollState`), so scroll-lock would mean reimplementing scroll. Kept only as a
  fallback if the state-based API regresses.
- **Read line metrics off `TextFieldState`.** There is no public layout result on
  `TextFieldState`; `onTextLayout` is the supported path.
- **Fully custom editor** (`BasicText` + own cursor/selection/IME/undo).
  Rejected for now — it reimplements everything the field gives us and is only
  warranted if the decorator approach hits a wall.

---

## Files

| File | Role |
|---|---|
| `ResultGutterPrototype.kt` | Screen, `TextFieldDecorator`, gutter, sample document |
| `ExpressionPrefix.kt` | `expressionPrefixUtf16Len`, logical-line starts, anchors |
| `FakeEngine.kt` | Local `LineOutcome` mirror + hardcoded fake evaluator |

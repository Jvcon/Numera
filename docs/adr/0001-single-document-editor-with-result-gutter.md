# Single-document editor with synchronized result gutter (reject the line-row model)

The Android client needs a native editor that reproduces the web's three-column
table (line number | content | result). The reference Kotlin project NerdCalci
implements this as a **line-row model**: each line is its own Room entity and its
own `BasicTextField`, with per-line results stored in the database. We rejected
that model and chose a **single-document editor**: one state-based
`BasicTextField` (Compose 1.7+, formerly `BasicTextField2`) holds the whole file
`content`, and a separately-drawn result gutter renders `Vec<LineOutcome>`
aligned to each line.

Numera's engine and storage are document-based — a file is one `content` string,
and `Engine::evaluate_document(String) -> Vec<LineOutcome>` evaluates it
top-to-bottom. A single editor maps 1:1 to that contract and preserves free
cross-line selection, multi-line paste, and cursor movement for free. NerdCalci's
line-row model exists to serve *its* line-based engine and line-based Room schema,
and pays for it with roughly 900 lines of hacks: a dummy leading space to detect
backspace-at-start (merge/delete), manual Enter splitting, no cross-line text
selection (only whole-line "selection mode"), a bespoke multi-line paste path,
hand-wired up/down arrow navigation, and custom per-file undo.

## Consequences

- The result gutter must stay synchronized with the text field's scroll, soft-wrap,
  and line height. The prototype (issue #10) resolved this: render the gutter in
  the field's own `TextFieldDecorator` slot and derive each result's row/`y` from
  the live `TextLayoutResult` (`getLineForOffset` + `getLineTop`, minus the shared
  `ScrollState`), so scroll/soft-wrap/line-height stay locked with one source of
  truth. Note `BasicTextField2` was renamed to the state-based `BasicTextField`
  in Compose 1.7.
- We adopt NerdCalci's *result-cell* interaction (right-aligned, success/error
  states, copy-on-tap, dashed error underline + tooltip) and its
  `VisualTransformation` syntax-highlighting approach — both already specified for
  the web in `design-spec.md` §12.5, so this is alignment, not copying.

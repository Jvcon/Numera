# Leading-slot exclusivity and trailing editing-target exits

The top bar's leading navigation slot holds **at most one affordance at any
time, on any size class**. The slot is exactly one of `menu` (where a drawer
exists), `none`, or `up` (reserved for destinations such as Settings). The exit
of a non-list editing target (`globals`, `draft`) is **always a trailing
action**, rendered as a Close (X), never as an up/back arrow and never in the
leading slot.

Android's shell rendered the hamburger and the Globals back arrow into the same
`navigationIcon` slot simultaneously, so they overlapped. The code comment even
claimed the back arrow *replaced* the hamburger; it did not. Web avoided the
overlap only because its two buttons are sibling flex children — but it too
rendered both, so it also violated the exclusivity rule on compact widths.

Placing the editing-target exit in the trailing actions (rather than hiding the
hamburger) is deliberate: web's drawer has no edge-swipe gesture, so hiding the
`menu` affordance would strand navigation whenever a draft or Globals was open.
Keeping the exit trailing preserves `menu` at all times and keeps the leading
slot unambiguous.

Icon choice follows the same reasoning: leaving a transient editing target is a
**mode exit**, so it is a Close (X); only a destination uses an up/back arrow.

## Consequences

- Android's `EditorTopBar` renders only `menu` in the leading slot and moves the
  editing-target exit into the actions row; the exit icon changes from
  `ArrowBack` to `Close`.
- Web's top bar moves the Globals exit out of the inline leading row into its
  actions.
- The resolved leading affordance per size class and the trailing actions per
  editing target are recorded in `contracts/interaction.json` (`topBar`) and
  asserted by conformance tests: leading count ≤ 1, trailing list matches.
- A future destination (Settings) may use `up` in the leading slot, but still
  never simultaneously with `menu`.

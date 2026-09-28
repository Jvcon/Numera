# The Command surface: one name for the palette and the FAB action

The overlay that switches files and runs commands is named **Command**
everywhere: the canonical surface id is `command`, the UI label and result title
are "Command", and `palette`, `command-palette`, and `search` are forbidden
synonyms. Both clients expose the same two entries: `fab:command` and
`keybinding:cmd+k`.

Previously the feature had three names for one concept. Web called it the
"command palette" internally (`numera-command-palette`, `palette-*` events,
`paletteOpen`). Both FABs labelled their third action "Search". And on Android
that "Search" action was not the overlay at all — it revealed an inline filter
field inside the file list, a genuinely different interaction wearing the same
name.

The decision separates the two interactions rather than merging them: the file
filter is deleted, and Android implements a Command overlay matching web's
entries and behavior. Names are corrected at both the user-visible and internal
levels, because leaving `palette-*` identifiers in place would keep the old
vocabulary alive in code and tests.

## Consequences

- Web's command palette is renamed end to end — visible strings, custom-event
  names, state fields, the component class, and its file — as a behavior-neutral
  refactor.
- Android removes the inline file-list filter and introduces a Command overlay
  with the same two entries (`fab:command`, `keybinding:cmd+k`); its FAB third
  action is relabelled "Command".
- `forbiddenSynonyms.command` in `contracts/interaction.json` makes the naming
  machine-checkable, and `CONTEXT.md` records `command` as the term.
- Inline file filtering is not a surface and must not be presented or named as
  Command.

# Globals and drafts are editing targets, not navigation destinations

The editor's subject is modelled as a single **editing target** with exactly
three values: `file`, `globals`, and `draft`. Only `file` is a member of the
file list; `globals` and `draft` are **non-list editing targets** and must never
appear as rows in the file list, the navigation drawer, or the Command results.

This makes explicit the divergence the two clients had drifted into. Web's
sidebar never listed Globals — it was entered solely from the top bar's
function action and exited with a Close (X) — while Android's `FileListPane`
added a `GlobalsRow`, presenting Globals as a second navigation destination.
Web additionally already distinguished a destination exit (Settings uses an
up/back arrow) from an editing-target exit (Globals uses X); Android used an
up/back arrow for Globals, implying spatial navigation where the state is
really a transient change of what the editor shows.

Both clients already implement a draft as a file flagged `draft: true` with
`editingTarget == file`. That internal encoding is permitted, but it is not the
model: normatively a draft is its own editing target with its own title
(`Draft {n}`), excluded from every list.

## Consequences

- Android drops the `GlobalsRow`; Globals is entered only from the top bar
  (`top-bar:open-globals`) and drafts only from the FAB / top bar.
  Discoverability is carried by those entries, not by the file list.
- `globals` and `draft` share one exit mechanism, `exit-editing-target`, which
  returns the editor to the previously active `file`. They differ only in title
  and persistence (drafts are memory-only), not in navigation.
- The three editing targets are enumerated in `contracts/interaction.json`
  (`editingTargets`) and asserted by every client's conformance tests.
- State encodings that fold a draft into `file` remain legal, but a client must
  not expose it as a list member.

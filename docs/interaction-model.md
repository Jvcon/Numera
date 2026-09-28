# Numera — Interaction Model

**Status:** Active — normative source of truth for navigation and interaction
across all clients.
**Applies to:** Web, Android. iOS is deferred (see §7).
**Companion:** `docs/design-spec.md` is now the **visual token** specification
only (color, type, shape, elevation, motion). Anything about *where the user can
go, how they get there, and how they leave* is normative **here**.

This document is the contract. Every client (web, Android, and eventually iOS)
must match `contracts/interaction.json`, the machine-readable form of this
document. A deviation from this document is a bug, not a platform choice. New
vocabulary must come from `CONTEXT.md`; the terms marked _Avoid_ there are
forbidden.

---

## 1. Model

Numera has **one navigation surface**: the **Workspace** (the file list plus the
editor). Everything else is either an **editing target** shown by the editor, an
**overlay** floating above the workspace, or transient feedback.

### 1.1 Vocabulary

| Term | Meaning |
|---|---|
| **surface** | A distinct piece of UI the user can be shown. Its `kind` says how it relates to navigation. |
| **destination** | A surface you navigate to and leave with an up/back action. Enters a back stack. |
| **editing target** | What the editor is currently showing — a `file`, `globals`, or a `draft`. Not a navigation destination. |
| **overlay** | A transient surface dismissed by `dismiss-overlay` (scrim tap, Escape, system back). Not a deep destination. |
| **navigation entry** | An affordance that brings a surface/editing target into view. |
| **exit action** | The canonical action that leaves a surface. See §3. |

### 1.2 Editing targets

The editor's **editing target** is exactly one of:

| Target | Title | In the file list? | Exit action |
|---|---|---|---|
| `file` | the file's `displayName` | **yes** | none (switching files is selection) |
| `globals` | `Globals` | **no** | `exit-editing-target` |
| `draft` | `Draft {n}` | **no** | `exit-editing-target` |

**Rule:** `globals` and `draft` are **non-list editing targets**. They must never
appear as rows in the file list, the navigation drawer, or the command results.
`file` is the only editing target that is a list member.

`globals` and `draft` share **one** exit mechanism: `exit-editing-target`, which
returns the editor to the previously active `file`. They differ only in title
and persistence (drafts are memory-only), not in navigation semantics.

> Implementation note. Clients may encode a draft internally as a file flagged
> `draft: true` (web does). That is an internal detail. **Normatively** it is a
> distinct editing target: it has its own title and it is excluded from every
> file list.

### 1.3 Surfaces

| Surface | Kind | Status |
|---|---|---|
| `workspace` | destination (root) | active |
| `navigation-drawer` | overlay | active |
| `command` | overlay | active |
| `template-chooser` | overlay | active |
| `name-dialog` | overlay | active |
| `file-actions-menu` | overlay | active |
| `settings` | destination | future |
| `encryption-setup` | overlay | future |
| `dev-overlay` | overlay | dev-only |

Not surfaces: the **FAB speed-dial** (a control) and the **snackbar**
(transient feedback). They never own navigation state.

`command` is the surface previously called the "command palette". Its canonical
name, UI label, and result title are **Command**; `palette`, `command-palette`,
and `search` are forbidden synonyms (§8).

`settings` is defined now so future Android/iOS clients share the model, but its
Android implementation is out of scope for the current phase.

---

## 2. Entries

An entry is `source:affordance`. Entries are listed per surface: the full matrix
lives in `contracts/interaction.json` (`surfaces[].entry`). The invariants:

- **`globals` is entered only from the top bar** (`top-bar:open-globals`). It is
  never an entry in the file list or the drawer.
- **`draft` is entered from the FAB** (`fab:new-draft`). It is never an entry in
  the file list or the top bar.
- **`command` is entered from the FAB and a key binding** (`fab:command`,
  `keybinding:cmd+k`). Web and Android must expose the same two entries.
- **`navigation-drawer` is entered from the top-bar menu** where a drawer
  exists, and (Android only) the system edge-swipe gesture.
- **Inline file filtering is not a surface.** A client must not present an
  inline "search/filter" field as the Command feature; Command is an overlay.

---

## 3. Exit & back

### 3.1 Canonical actions

| Action | Meaning |
|---|---|
| `dismiss-overlay` | Close the topmost overlay. |
| `close-drawer` | Close the navigation drawer. |
| `exit-editing-target` | Leave a non-list editing target, returning to the previously active file. |
| `exit-destination` | Up/back out of a destination (`settings`), like a back-stack pop. |
| `root-exit` | Leave the app (platform-defined). |

### 3.2 Back precedence

When the platform reports a back gesture (Android system back, web Escape, web
browser back where integrated), the client applies **exactly this order**:

```
dismiss-overlay  →  close-drawer  →  exit-editing-target  →  root-exit
```

The first applicable action wins and consumes the event. A client must not skip
a step (e.g. it must not exit an editing target while an overlay is open).

The **browser-back integration is out of scope** for the current phase: web
does not push history for overlays or editing targets today, so browser back
leaves the app. This is a known, accepted gap, not a licence to diverge.

---

## 4. Top bar contract

### 4.1 Leading-slot exclusivity (invariant)

**The leading slot holds at most one affordance, at any time, on any size
class.** The leading slot is exactly one of:

- `menu` — opens the navigation drawer (present only where a drawer exists), or
- `none` — resolved for the size class, or
- `up` — reserved for destinations (`settings`).

Rendering two affordances into the leading slot simultaneously (the historical
Android bug: hamburger + back arrow) is forbidden.

### 4.2 Resolved leading affordance

| Size class | Leading |
|---|---|
| Compact | `menu` |
| Medium | `menu` |
| Expanded | `none` |

### 4.3 Trailing actions

The exit of a non-list editing target is **always a trailing action**, never the
leading slot. This keeps `menu` reachable at all times (web's drawer has no
edge-swipe gesture, so hiding `menu` would strand navigation).

| Editing target | Trailing actions (in order) |
|---|---|
| `file` | `template`, `open-globals` |
| `globals` | `template`, `exit-editing-target` |
| `draft` | `template`, `exit-editing-target` |

### 4.4 Icons

| Action | Icon | Not |
|---|---|---|
| `exit-editing-target` | **Close (X)** | an up/back arrow |
| `exit-destination` | up/back arrow | Close |
| `menu` | hamburger | — |

Rationale: leaving a transient editing target is a **mode exit**, not spatial
navigation; only destinations use up/back.

---

## 5. Adaptive layout

Form factor is **chrome-only**. `editingTarget`, `globalsContent`, drafts, and
file selection are layout-independent; the same state drives every size class.

| Size class | Width | Navigation chrome |
|---|---|---|
| Compact | < 600dp | modal drawer (`menu` in leading slot) |
| Medium | 600–840dp | modal drawer; no two-pane split |
| Expanded | ≥ 840dp | persistent 280dp sidebar; no `menu` affordance |

Dimension tokens, fold posture, hinge/occlusion rules, and the expanded
two-pane split remain in `docs/design-spec.md` §13. This document is
normative only for **which affordance appears and what it does** — not for its
size or placement geometry.

---

## 6. Platform bindings

`contracts/interaction.json` `bindings` is normative. Summary:

| Action | Android | Web |
|---|---|---|
| `dismiss-overlay` | system back, scrim tap | Escape, scrim tap |
| `close-drawer` | system back, scrim tap, select file | Escape, scrim tap, select file |
| `exit-editing-target` | system back, top-bar X | Escape, top-bar X |
| `exit-destination` | system back, top-bar up | top-bar up |
| `root-exit` | system back | browser back (out of scope) |

Legitimate platform differences are limited to the **input** that triggers an
action (a system key vs a key binding). The **action, its precedence, its icon,
and its slot are identical**.

---

## 7. Forbidden patterns (navigation)

A PR that introduces any of these is blocking:

1. Two affordances in the top-bar leading slot.
2. `globals` or `draft` rendered as a file-list / drawer / command result row.
3. An up/back arrow used to exit a non-list editing target (must be X).
4. An editing-target exit placed in the leading slot (must be trailing).
5. A `back` handler that skips a precedence step (§3.2).
6. The Command surface labelled or keyed as `palette` / `search`.
7. An inline file-filter presented as, or named, Command.
8. Client navigation behavior that contradicts `contracts/interaction.json`.

If a forbidden pattern is genuinely right, change this document **first**, then
the fixture, then the clients.

---

## 8. Conformance

`contracts/interaction.json` is read by one pure navigation-model module **per
platform** (a TypeScript module and a Kotlin module), and each platform's UI
tests assert against that model. The fixture is the shared source; the platform
modules must not fork its rules.

Minimum assertions (per platform, and per size class × editing target):

- the leading slot exposes ≤ 1 affordance;
- `globals` / `draft` are absent from the file list;
- trailing actions match §4.3 for the active editing target;
- back precedence resolves in the order of §3.2.

Tests run under the platforms' existing test commands (web `npm test`,
Android `./gradlew test`) so drift fails CI without new infrastructure.

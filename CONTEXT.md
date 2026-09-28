# Numera

A natural-language text calculator that runs on web and Android, sharing one Rust
engine. This context holds the cross-platform domain language both clients speak.

## Language

### Core

**workspace**:
The user's collection of files, folders, and globals — the single calculable space synced across devices.
_Avoid_: project, space

**file**:
A single `.numr` document stored as one plain-text `content` string, evaluated top-to-bottom by the engine.
_Avoid_: document, sheet

**folder**:
One level of grouping for files; a file's path is `"folder/file.numr"` or `"file.numr"`.
_Avoid_: directory, group

**globals**:
The shared `globals.numr` document whose variables and functions are available to every file as `global.<name>`.
_Avoid_: shared context, constants

**draft**:
An ephemeral in-memory scratch file that is never persisted and never appears in the file list.
_Avoid_: scratchpad, temp file

**editing target**:
What the editor is currently showing — a `file`, the `globals` document, or an
ephemeral `draft`. A `file` is a list member; `globals` and `draft` are
**non-list** editing targets, never rows in the file list.
_Avoid_: active document

### Navigation

The normative model lives in `docs/interaction-model.md`; these terms are its
vocabulary.

**surface**:
A distinct piece of UI the user can be shown. Every surface has a `kind` —
destination, editing target, or overlay.
_Avoid_: screen, page, view

**destination**:
A surface you navigate to and leave with an up/back action; it enters a back
stack (e.g. `settings`).
_Avoid_: page, route

**overlay**:
A transient surface dismissed by a single `dismiss-overlay` action (scrim tap,
Escape, system back) — e.g. `command`, dialogs, the navigation drawer.
_Avoid_: popup, modal

**navigation entry**:
An affordance that brings a surface or editing target into view, written
`source:affordance` (e.g. `top-bar:open-globals`).
_Avoid_: trigger, link

**exit-editing-target**:
The canonical action that leaves a non-list editing target (`globals`, `draft`)
and returns the editor to the previously active `file`. Rendered as a trailing
Close (X), never an up arrow.
_Avoid_: back, close mode

**back precedence**:
The fixed order a back gesture resolves in:
`dismiss-overlay → close-drawer → exit-editing-target → root-exit`.
_Avoid_: back stack

**command**:
The overlay surface for switching files and running commands, entered from the
FAB and Ctrl/Cmd+K. UI label and result title: "Command".
_Avoid_: palette, command palette, search

**parity**:
The property that every client matches `contracts/interaction.json`. A client
difference is legitimate only in the input binding that triggers an action —
never in the action, its slot, or the precedence.
_Avoid_: consistency, sameness

### Editor

**line outcome**:
The engine's per-line evaluation result (`display`, `error`, `isEmpty`, `isError`, `kind`, `rawValue`) for one line of a document.

**result gutter**:
The right-aligned column that renders each line's `line outcome`, scrolling in lock-step with the editor.
_Avoid_: result column, answer pane

**annotation**:
A directive comment (`# @money`, `# @input`, `# @result`) on a file that drives result formatting.
_Avoid_: metadata, hint

### Adaptive layout

**window size class**:
The screen-width bucket that drives chrome choice — `compact` (<600dp), `medium` (600–840dp), `expanded` (≥840dp).
_Avoid_: breakpoint, form factor

**hinge**:
The physical fold seam on a foldable device. It is the natural divider for the
expanded two-pane split, and a hard margin for floating overlays (FAB, snackbar,
dialog) that must never land on it.
_Avoid_: seam, gap

**fold posture**:
The arrangement implied by a half-opened `hinge` — `tabletop` (horizontal fold;
content splits top/bottom) or `book` (vertical fold; content splits left/right).
_Avoid_: orientation, mode

**occlusion type**:
Whether a `hinge` physically blocks content — `full` (dual-screen; nothing renders
in the seam) or `none` (flexible crease; drawing across is allowed but floating
content keeps clear).
_Avoid_: hinge kind, seam type

**two-pane split**:
The Expanded-width shell that places the file list and the editor side by side,
divided at the `hinge`.
_Avoid_: split view, sidebar mode

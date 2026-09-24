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
What the editor is currently showing — a `file`, or the `globals` document.
_Avoid_: active document

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

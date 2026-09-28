package com.jvcon.numera.workspace

/**
 * Default workspace fixtures.
 *
 * Faithful port of `DEFAULT_GLOBALS` / `DEFAULT_FILES` from
 * `web/src/lib/workspace.ts`. A brand-new install seeds a single `Quick Start`
 * example; the persisted snapshot (including an intentionally empty one) is
 * authoritative after that. `folderId`/`order` are placeholders: the
 * [WorkspaceViewModel] constructor normalizes every scope to sequential integer
 * orders.
 */

internal const val DEFAULT_GLOBALS: String = """# Globals — shared across all files in this workspace.
"""

internal val DEFAULT_FILES: List<WorkspaceFile> = listOf(
    WorkspaceFile(
        id = "quick-start",
        path = "quick-start.numr",
        displayName = "Quick Start",
        pinned = false,
        folderId = null,
        order = 0,
        content = """# Quick Start — Numera
# Type arithmetic on any line; the result appears in the right gutter.
# Assign a name to reuse a value later:

price = 42
quantity = 3
subtotal = price * quantity

# Percentages and units work too:
tax = subtotal * 8.5%
total = subtotal + tax
""",
    ),
)

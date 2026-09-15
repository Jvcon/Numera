package com.jvcon.numera.workspace

/**
 * Default workspace fixtures.
 *
 * Faithful port of `DEFAULT_GLOBALS` / `DEFAULT_FILES` from
 * `web/src/lib/workspace.ts`. `folderId`/`order` are placeholders: the
 * [WorkspaceViewModel] constructor derives the "daily" folder from the
 * `daily/2026-09-07.numr` path prefix and normalizes every scope to sequential
 * integer orders.
 */

internal const val DEFAULT_GLOBALS: String = """# Globals — shared across all files in this workspace.
# Variables and functions defined here are referenced as `global.<name>`.

tax_rate = 13%
vat_rate = 0.2

# Cross-file references work via `file("name")`. Try them in any file:
#   profit = file("daily")
"""

internal val DEFAULT_FILES: List<WorkspaceFile> = listOf(
    WorkspaceFile(
        id = "budget",
        path = "budget-2026.numr",
        displayName = "Budget 2026",
        pinned = true,
        folderId = null,
        order = 0,
        content = """# September 2026 budget
# Globals live in globals.numr and are referenced as `global.<name>`.

monthly_income = $6,500
tax_rate       = 22%
rent           = $1,800
savings        = monthly_income * (1 - tax_rate) - rent

vat_total      = (rent + savings) * global.vat_rate
take_home      = monthly_income * (1 - tax_rate) - rent

# Cross-file reference: pulls the first export from daily.numr.
daily_net      = file("daily")
""",
    ),
    WorkspaceFile(
        id = "daily",
        path = "daily/2026-09-07.numr",
        displayName = "Daily — Sep 7",
        pinned = false,
        folderId = null,
        order = 0,
        content = """# Daily snapshot — Sep 7, 2026
expense_breakfast = $12.50
expense_lunch     = $18.20
expense_coffee    = $4.80

total = expense_breakfast + expense_lunch + expense_coffee
""",
    ),
    WorkspaceFile(
        id = "cheatsheet",
        path = "unit-cheatsheet.numr",
        displayName = "Unit Cheatsheet",
        pinned = false,
        folderId = null,
        order = 1,
        content = """# Unit conversion cheatsheet
meters   = 100
kilometers = meters / 1000
feet     = meters * 3.281
miles    = feet / 5280
""",
    ),
)

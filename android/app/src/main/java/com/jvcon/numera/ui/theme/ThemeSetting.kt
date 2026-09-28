package com.jvcon.numera.ui.theme

/**
 * User theme preference — mirrors the web `ThemeSetting`
 * (`'light' | 'dark' | 'auto'` in `web/src/lib/theme.ts`).
 *
 * [label] is the lowercase string shown in Command's "Current theme: …"
 * detail, matching the web UI.
 */
enum class ThemeSetting(val label: String) {
    LIGHT("light"),
    DARK("dark"),
    AUTO("auto"),
    ;

    /** Cycle light → dark → auto, mirroring web `getNextTheme`. */
    fun next(): ThemeSetting = values()[(ordinal + 1) % values().size]

    companion object {
        /** Parse a stored/web label; unknown values fall back to [AUTO]. */
        fun fromLabel(label: String?): ThemeSetting =
            values().firstOrNull { it.label == label } ?: AUTO
    }
}

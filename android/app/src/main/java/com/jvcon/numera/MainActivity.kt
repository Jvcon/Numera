package com.jvcon.numera

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.lifecycle.lifecycleScope
import androidx.room.Room
import com.jvcon.numera.engine.UniFfiEngine
import com.jvcon.numera.persistence.AppDatabase
import com.jvcon.numera.persistence.RoomWorkspacePersister
import com.jvcon.numera.shell.AppShell
import com.jvcon.numera.ui.theme.NumeraTheme
import com.jvcon.numera.ui.theme.ThemeSetting
import com.jvcon.numera.workspace.WorkspaceViewModel
import kotlinx.coroutines.launch

/**
 * Single-activity shell. Wires the persistence + engine seams together and
 * renders [AppShell] — file list chrome + editor (issues #11, #12).
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Draw behind the system bars; Compose insets are applied by the
        // individual surfaces (top bar, drawer sheet, editor body).
        enableEdgeToEdge()

        val viewModel = buildViewModel()
        lifecycleScope.launch { viewModel.hydrate() }

        setContent {
            val prefs = remember {
                applicationContext.getSharedPreferences("numera-theme", Context.MODE_PRIVATE)
            }
            var themeLabel by rememberSaveable {
                mutableStateOf(prefs.getString("theme", ThemeSetting.AUTO.label) ?: ThemeSetting.AUTO.label)
            }
            val theme = ThemeSetting.fromLabel(themeLabel)
            val darkTheme = when (theme) {
                ThemeSetting.AUTO -> isSystemInDarkTheme()
                ThemeSetting.LIGHT -> false
                ThemeSetting.DARK -> true
            }
            NumeraTheme(darkTheme = darkTheme) {
                // Keep the system-bar icon contrast in lockstep with the
                // resolved Compose theme (teal-on-light ↔ light-on-dark),
                // including when the platform re-creates the activity.
                val view = LocalView.current
                if (!view.isInEditMode) {
                    SideEffect {
                        WindowCompat.getInsetsController(window, view).apply {
                            isAppearanceLightStatusBars = !darkTheme
                            isAppearanceLightNavigationBars = !darkTheme
                        }
                    }
                }
                AppShell(
                    viewModel = viewModel,
                    theme = theme,
                    onToggleTheme = {
                        val next = theme.next()
                        themeLabel = next.label
                        prefs.edit().putString("theme", next.label).apply()
                    },
                )
            }
        }
    }

    private fun buildViewModel(): WorkspaceViewModel {
        val db = Room.databaseBuilder(
            applicationContext,
            AppDatabase::class.java,
            "numera.db",
        ).build()
        val persister = RoomWorkspacePersister(db)
        return WorkspaceViewModel(
            engine = UniFfiEngine(),
            persister = persister,
        )
    }
}

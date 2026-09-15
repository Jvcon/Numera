package com.jvcon.numera

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import androidx.room.Room
import com.jvcon.numera.editor.EditorScreen
import com.jvcon.numera.engine.UniFfiEngine
import com.jvcon.numera.persistence.AppDatabase
import com.jvcon.numera.persistence.RoomWorkspacePersister
import com.jvcon.numera.ui.theme.NumeraTheme
import com.jvcon.numera.workspace.WorkspaceViewModel
import kotlinx.coroutines.launch

/**
 * Single-activity shell. Wires the persistence + engine seams together and
 * renders the editor (issue #11).
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val viewModel = buildViewModel()
        lifecycleScope.launch { viewModel.hydrate() }

        setContent {
            NumeraTheme {
                EditorScreen(viewModel = viewModel)
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

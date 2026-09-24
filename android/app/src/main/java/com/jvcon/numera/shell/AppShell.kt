package com.jvcon.numera.shell

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.focusable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.jvcon.numera.editor.EditorScreen
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.workspace.WorkspaceViewModel
import kotlinx.coroutines.launch

/**
 * The app shell: file list chrome + editor (issue #12).
 *
 * Chrome adapts to [layout] — Compact/Medium use a modal drawer, Expanded uses a
 * persistent 280dp sidebar — while the editor and state layer stay identical
 * (design-spec §13.4). A separating fold hinge is applied as a hard margin to
 * the whole guarded area, so neither content nor the FAB can land on it.
 *
 * [layout] is an explicit parameter (not read inside) so every form factor is
 * directly exercisable from tests.
 */
@Composable
fun AppShell(
    viewModel: WorkspaceViewModel,
    modifier: Modifier = Modifier,
    layout: AppWindowLayout = rememberAppWindowLayout(),
) {
    val state by viewModel.state.collectAsState()
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val interactionSource = remember { MutableInteractionSource() }

    var speedDialExpanded by remember { mutableStateOf(false) }
    var searchVisible by remember { mutableStateOf(false) }
    var newFileDialog by remember { mutableStateOf(false) }
    var newFolderDialog by remember { mutableStateOf(false) }

    val closeDrawer: () -> Unit = {
        if (drawerState.isOpen) scope.launch { drawerState.close() }
    }

    val pane: @Composable (Modifier) -> Unit = { paneModifier ->
        FileListPane(
            state = state,
            onSelectFile = { id ->
                viewModel.selectFile(id)
                searchVisible = false
                closeDrawer()
            },
            onToggleFilePin = viewModel::togglePin,
            onDeleteFile = viewModel::deleteFile,
            onToggleFolderPin = viewModel::toggleFolderPin,
            onToggleFolderCollapsed = viewModel::toggleFolderCollapsed,
            onDeleteFolder = viewModel::deleteFolder,
            onCreateFile = { newFileDialog = true },
            onCreateFolder = { newFolderDialog = true },
            onOpenGlobals = {
                viewModel.openGlobals()
                closeDrawer()
            },
            modifier = paneModifier,
            searchVisible = searchVisible,
        )
    }

    val hingePadding = Modifier.padding(
        start = if (layout.hinge.edge == HingeEdge.START) layout.hinge.size else 0.dp,
        end = if (layout.hinge.edge == HingeEdge.END) layout.hinge.size else 0.dp,
    )

    // The guarded area = everything that must stay clear of the hinge.
    Box(
        modifier = modifier
            .fillMaxSize()
            .then(hingePadding)
            .testTag("hinge-guard")
            .focusable(interactionSource = interactionSource)
            .onPreviewKeyEvent { event ->
                if (
                    speedDialExpanded &&
                    event.type == KeyEventType.KeyDown &&
                    event.key == Key.Escape
                ) {
                    speedDialExpanded = false
                    true
                } else {
                    false
                }
            },
    ) {
        when (layout.sizeClass) {
            AppWindowSizeClass.COMPACT, AppWindowSizeClass.MEDIUM -> {
                ModalNavigationDrawer(
                    drawerState = drawerState,
                    drawerContent = {
                        // Zero insets: FileListPane owns its own, so the drawer
                        // and the expanded pane inset identically.
                        ModalDrawerSheet(
                            modifier = Modifier.width(NumeraDimens.sidePanelWidth),
                            windowInsets = WindowInsets(0.dp),
                        ) {
                            pane(Modifier.fillMaxSize())
                        }
                    },
                    modifier = Modifier.fillMaxSize(),
                ) {
                    EditorScreen(
                        viewModel = viewModel,
                        modifier = Modifier.fillMaxSize(),
                        onOpenNavigation = { scope.launch { drawerState.open() } },
                    )
                }
            }

            AppWindowSizeClass.EXPANDED -> {
                Row(modifier = Modifier.fillMaxSize()) {
                    pane(
                        Modifier
                            .width(NumeraDimens.sidePanelWidth)
                            .fillMaxHeight(),
                    )
                    // The pane's right border, full height (web: border-inline-end).
                    VerticalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    EditorScreen(
                        viewModel = viewModel,
                        modifier = Modifier.weight(1f),
                        onOpenNavigation = null,
                    )
                }
            }
        }

        if (speedDialExpanded) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    // Web scrim: 32% of the scrim color.
                    .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f))
                    .clickable(
                        interactionSource = interactionSource,
                        indication = null,
                        onClick = { speedDialExpanded = false },
                    )
                    .testTag("fab-scrim"),
            )
        }

        FabSpeedDial(
            expanded = speedDialExpanded,
            onExpandedChange = { speedDialExpanded = it },
            onNewFile = { newFileDialog = true },
            onNewDraft = { viewModel.createDraft() },
            onSearch = { searchVisible = true },
            modifier = Modifier
                .align(fabAlignmentFor(layout.hinge))
                .navigationBarsPadding()
                .padding(NumeraDimens.spacingBlockLoose),
        )
    }

    BackHandler(enabled = speedDialExpanded) { speedDialExpanded = false }

    if (newFileDialog) {
        NameDialog(
            title = "New file",
            tag = "new-file-dialog",
            confirmLabel = "Create",
            onConfirm = { name ->
                viewModel.createFile(path = "$name.numr")
                newFileDialog = false
            },
            onDismiss = { newFileDialog = false },
        )
    }

    if (newFolderDialog) {
        NameDialog(
            title = "New folder",
            tag = "new-folder-dialog",
            confirmLabel = "Create",
            onConfirm = { name ->
                viewModel.createFolder(name)
                newFolderDialog = false
            },
            onDismiss = { newFolderDialog = false },
        )
    }
}

/** FAB corner: away from a separating hinge, else the conventional bottom-end. */
private fun fabAlignmentFor(hinge: HingeInsets): Alignment =
    if (fabEdgeFor(hinge) == HingeEdge.START) Alignment.BottomStart else Alignment.BottomEnd

@Composable
private fun NameDialog(
    title: String,
    tag: String,
    confirmLabel: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var name by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                singleLine = true,
                label = { Text("Name") },
                modifier = Modifier.testTag("$tag-field"),
            )
        },
        confirmButton = {
            TextButton(
                onClick = { if (name.isNotBlank()) onConfirm(name.trim()) },
                modifier = Modifier.testTag("$tag-confirm"),
            ) {
                Text(confirmLabel)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel") }
        },
        modifier = Modifier.testTag(tag),
    )
}

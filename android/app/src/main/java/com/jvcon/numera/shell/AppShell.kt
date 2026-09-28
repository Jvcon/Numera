package com.jvcon.numera.shell

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.jvcon.numera.R
import com.jvcon.numera.editor.EditorScreen
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.ui.theme.ThemeSetting
import com.jvcon.numera.workspace.BUILT_IN_TEMPLATES
import com.jvcon.numera.workspace.EditingTarget
import com.jvcon.numera.workspace.WorkspaceFile
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
    theme: ThemeSetting = ThemeSetting.AUTO,
    onToggleTheme: () -> Unit = {},
    layout: AppWindowLayout = rememberAppWindowLayout(),
) {
    val state by viewModel.state.collectAsState()
    val scope = rememberCoroutineScope()
    val drawerState = rememberDrawerState(DrawerValue.Closed)
    val interactionSource = remember { MutableInteractionSource() }
    val context = LocalContext.current

    var speedDialExpanded by remember { mutableStateOf(false) }
    var commandVisible by remember { mutableStateOf(false) }
    var templateChooserVisible by remember { mutableStateOf(false) }
    var newFileDialog by remember { mutableStateOf(false) }

    // Export uses the Storage Access Framework: write the file's content to the
    // URI the user picks in the system document picker.
    var exportTarget by remember { mutableStateOf<WorkspaceFile?>(null) }
    val exportLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("text/plain"),
    ) { uri ->
        val file = exportTarget
        if (uri != null && file != null) {
            runCatching {
                context.contentResolver.openOutputStream(uri)?.use {
                    it.write(file.content.toByteArray(Charsets.UTF_8))
                }
            }
        }
        exportTarget = null
    }

    val closeDrawer: () -> Unit = {
        if (drawerState.isOpen) scope.launch { drawerState.close() }
    }

    val pane: @Composable (Modifier) -> Unit = { paneModifier ->
        FileListPane(
            state = state,
            onSelectFile = { id ->
                viewModel.selectFile(id)
                closeDrawer()
            },
            onToggleFilePin = viewModel::togglePin,
            onRenameFile = viewModel::renameFile,
            onDeleteFile = viewModel::deleteFile,
            onMoveFile = viewModel::moveFileToFolder,
            onExportFile = { id ->
                state.files.firstOrNull { it.id == id }?.let { file ->
                    exportTarget = file
                    exportLauncher.launch("${file.displayName}.numr")
                }
            },
            onToggleFolderPin = viewModel::toggleFolderPin,
            onRenameFolder = viewModel::renameFolder,
            onToggleFolderCollapsed = viewModel::toggleFolderCollapsed,
            onDeleteFolder = viewModel::deleteFolder,
            onCreateFolder = { name -> viewModel.createFolder(name).id },
            onToggleTheme = onToggleTheme,
            modifier = paneModifier,
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
                        onOpenTemplate = { templateChooserVisible = true },
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
                        onOpenTemplate = { templateChooserVisible = true },
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
            onCommand = { commandVisible = true },
            onTemplate = { templateChooserVisible = true },
            modifier = Modifier
                .align(fabAlignmentFor(layout.hinge))
                .navigationBarsPadding()
                .padding(NumeraDimens.spacingBlockLoose),
        )

        if (commandVisible) {
            CommandOverlay(
                files = state.files,
                theme = theme.label,
                onSelectFile = { id ->
                    viewModel.selectFile(id)
                    commandVisible = false
                },
                onNewFile = {
                    commandVisible = false
                    newFileDialog = true
                },
                onToggleTheme = { onToggleTheme() },
                onFromTemplate = {
                    commandVisible = false
                    templateChooserVisible = true
                },
                onDismiss = { commandVisible = false },
            )
        }

        if (templateChooserVisible) {
            TemplateChooser(
                templates = BUILT_IN_TEMPLATES,
                onSelect = { id ->
                    BUILT_IN_TEMPLATES.firstOrNull { it.id == id }?.let {
                        viewModel.createFromTemplate(it)
                    }
                    templateChooserVisible = false
                },
                onDismiss = { templateChooserVisible = false },
            )
        }
    }

    // Contract back precedence (docs/interaction-model.md §3):
    // dismiss-overlay → close-drawer → exit-editing-target → root-exit.
    val activeFile = state.files.firstOrNull { it.id == state.activeFileId }
    val canExitEditingTarget =
        state.editingTarget == EditingTarget.GLOBALS || activeFile?.draft == true
    BackHandler(
        enabled = speedDialExpanded || commandVisible || templateChooserVisible ||
            drawerState.isOpen || canExitEditingTarget,
    ) {
        when {
            speedDialExpanded -> speedDialExpanded = false
            commandVisible -> commandVisible = false
            templateChooserVisible -> templateChooserVisible = false
            drawerState.isOpen -> scope.launch { drawerState.close() }
            else -> viewModel.closeEditingTarget()
        }
    }

    if (newFileDialog) {
        NameDialog(
            title = stringResource(R.string.new_file),
            tag = "new-file-dialog",
            confirmLabel = stringResource(R.string.create),
            onConfirm = { name ->
                viewModel.createFile(path = "$name.numr")
                newFileDialog = false
            },
            onDismiss = { newFileDialog = false },
        )
    }
}

/** FAB corner: away from a separating hinge, else the conventional bottom-end. */
private fun fabAlignmentFor(hinge: HingeInsets): Alignment =
    if (fabEdgeFor(hinge) == HingeEdge.START) Alignment.BottomStart else Alignment.BottomEnd

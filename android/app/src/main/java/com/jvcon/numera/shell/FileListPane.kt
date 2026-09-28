package com.jvcon.numera.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.DarkMode
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import com.jvcon.numera.R
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.workspace.EditingTarget
import com.jvcon.numera.workspace.WorkspaceFile
import com.jvcon.numera.workspace.WorkspaceFolder
import com.jvcon.numera.workspace.WorkspaceState

/**
 * The workspace file list: folder/file rows and the sidebar header actions.
 *
 * Mirrors the web sidebar (`web/src/components/sidebar.ts`): a header with the
 * brand and New folder / Toggle theme actions, folder/file rows with an
 * overflow (⋮) menu, and rename / move / export / delete dialogs. New file is
 * entered from the FAB and Command — not from the pane.
 *
 * Stateless except for its own dialogs/menus — every mutation is routed out
 * through a callback, so the pane stays a pure function of [state].
 *
 * `globals` and `draft` are non-list editing targets and must never appear here
 * (docs/interaction-model.md §1.2); Globals is entered only from the top bar.
 */
@Composable
fun FileListPane(
    state: WorkspaceState,
    onSelectFile: (String) -> Unit,
    onToggleFilePin: (String) -> Unit,
    onRenameFile: (String, String) -> Unit,
    onDeleteFile: (String) -> Unit,
    onMoveFile: (String, String?) -> Unit,
    onExportFile: (String) -> Unit,
    onToggleFolderPin: (String) -> Unit,
    onRenameFolder: (String, String) -> Unit,
    onToggleFolderCollapsed: (String) -> Unit,
    onDeleteFolder: (String) -> Unit,
    onCreateFolder: (String) -> String,
    onToggleTheme: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val rows = remember(state.files, state.folders) {
        buildFileListRows(state.files, state.folders)
    }

    var renameTarget by remember { mutableStateOf<RenameTarget?>(null) }
    var deleteTarget by remember { mutableStateOf<DeleteTarget?>(null) }
    var moveTarget by remember { mutableStateOf<WorkspaceFile?>(null) }
    var createFolderTarget by remember { mutableStateOf<CreateFolderTarget?>(null) }

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .windowInsetsPadding(
                WindowInsets.safeDrawing.only(
                    WindowInsetsSides.Vertical + WindowInsetsSides.Start,
                ),
            ),
    ) {
        // Header — 64dp to line up with the editor top bar.
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(NumeraDimens.appBarHeight)
                .padding(horizontal = NumeraDimens.spacingInline),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = { createFolderTarget = CreateFolderTarget(moveFileId = null) },
                modifier = Modifier.testTag("new-folder"),
            ) {
                Icon(
                    imageVector = Icons.Filled.CreateNewFolder,
                    contentDescription = stringResource(R.string.new_folder),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(NumeraDimens.iconMedium),
                )
            }
            IconButton(
                onClick = onToggleTheme,
                modifier = Modifier.testTag("toggle-theme"),
            ) {
                Icon(
                    imageVector = Icons.Filled.DarkMode,
                    contentDescription = stringResource(R.string.toggle_theme),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(NumeraDimens.iconMedium),
                )
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        if (rows.isEmpty()) {
            EmptyState(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth(),
            )
        } else {
            LazyColumn(
                modifier = Modifier
                    .weight(1f)
                    .fillMaxWidth()
                    .testTag("file-list"),
            ) {
                items(items = rows, key = { it.key() }) { row ->
                    when (row) {
                        is FileListRow.FolderHeader -> FolderRow(
                            folder = row.folder,
                            childCount = row.childCount,
                            onToggleCollapsed = { onToggleFolderCollapsed(row.folder.id) },
                            onTogglePin = { onToggleFolderPin(row.folder.id) },
                            onRename = {
                                renameTarget = RenameTarget(
                                    kind = TargetKind.FOLDER,
                                    id = row.folder.id,
                                    name = row.folder.name,
                                )
                            },
                            onDelete = {
                                deleteTarget = DeleteTarget(
                                    kind = TargetKind.FOLDER,
                                    id = row.folder.id,
                                    name = row.folder.name,
                                )
                            },
                        )

                        is FileListRow.FileRow -> FileRow(
                            file = row.file,
                            depth = row.depth,
                            selected = state.activeFileId == row.file.id &&
                                state.editingTarget == EditingTarget.FILE,
                            onSelect = { onSelectFile(row.file.id) },
                            onTogglePin = { onToggleFilePin(row.file.id) },
                            onRename = {
                                renameTarget = RenameTarget(
                                    kind = TargetKind.FILE,
                                    id = row.file.id,
                                    name = row.file.displayName,
                                )
                            },
                            onMove = { moveTarget = row.file },
                            onExport = { onExportFile(row.file.id) },
                            onDelete = {
                                deleteTarget = DeleteTarget(
                                    kind = TargetKind.FILE,
                                    id = row.file.id,
                                    name = row.file.displayName,
                                )
                            },
                        )
                    }
                }
            }
        }
    }

    renameTarget?.let { target ->
        NameDialog(
            title = if (target.kind == TargetKind.FOLDER) {
                stringResource(R.string.rename_folder)
            } else {
                stringResource(R.string.rename_file)
            },
            tag = "rename-dialog",
            confirmLabel = stringResource(R.string.rename),
            fieldLabel = stringResource(R.string.name),
            initialName = target.name,
            onConfirm = { name ->
                if (target.kind == TargetKind.FOLDER) {
                    onRenameFolder(target.id, name)
                } else {
                    onRenameFile(target.id, name)
                }
                renameTarget = null
            },
            onDismiss = { renameTarget = null },
        )
    }

    deleteTarget?.let { target ->
        ConfirmDialog(
            title = if (target.kind == TargetKind.FOLDER) {
                stringResource(R.string.delete_folder)
            } else {
                stringResource(R.string.delete_file)
            },
            message = if (target.kind == TargetKind.FOLDER) {
                stringResource(R.string.delete_folder_confirm, target.name)
            } else {
                stringResource(R.string.delete_file_confirm, target.name)
            },
            tag = "delete-dialog",
            confirmLabel = stringResource(R.string.delete),
            onConfirm = {
                if (target.kind == TargetKind.FOLDER) {
                    onDeleteFolder(target.id)
                } else {
                    onDeleteFile(target.id)
                }
                deleteTarget = null
            },
            onDismiss = { deleteTarget = null },
        )
    }

    createFolderTarget?.let { target ->
        NameDialog(
            title = stringResource(R.string.new_folder),
            tag = "create-folder-dialog",
            confirmLabel = stringResource(R.string.create),
            fieldLabel = stringResource(R.string.folder_name),
            onConfirm = { name ->
                val folderId = onCreateFolder(name)
                target.moveFileId?.let { onMoveFile(it, folderId) }
                createFolderTarget = null
            },
            onDismiss = { createFolderTarget = null },
        )
    }

    moveTarget?.let { file ->
        MoveToFolderDialog(
            folders = state.folders,
            currentFolderId = file.folderId,
            onPick = { folderId ->
                onMoveFile(file.id, folderId)
                moveTarget = null
            },
            onNewFolder = {
                createFolderTarget = CreateFolderTarget(moveFileId = file.id)
                moveTarget = null
            },
            onDismiss = { moveTarget = null },
        )
    }
}

private enum class TargetKind { FILE, FOLDER }

private data class RenameTarget(val kind: TargetKind, val id: String, val name: String)

private data class DeleteTarget(val kind: TargetKind, val id: String, val name: String)

private data class CreateFolderTarget(val moveFileId: String?)

private fun FileListRow.key(): String = when (this) {
    is FileListRow.FolderHeader -> "folder-${folder.id}"
    is FileListRow.FileRow -> "file-${file.id}"
}

@Composable
private fun EmptyState(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.padding(NumeraDimens.spacingBlockLoose),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = stringResource(R.string.no_files_title),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
        Spacer(Modifier.height(NumeraDimens.spacingInlineTight))
        Text(
            text = stringResource(R.string.no_files_body),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun FolderRow(
    folder: WorkspaceFolder,
    childCount: Int,
    onToggleCollapsed: () -> Unit,
    onTogglePin: () -> Unit,
    onRename: () -> Unit,
    onDelete: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(NumeraDimens.touchTargetComfortable)
            .testTag("folder-row-${folder.id}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .clickable(onClick = onToggleCollapsed)
                .padding(
                    start = NumeraDimens.spacingInline,
                    end = NumeraDimens.spacingInlineTight,
                )
                .testTag("collapse-folder-${folder.id}"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = if (folder.collapsed) {
                    Icons.AutoMirrored.Filled.KeyboardArrowRight
                } else {
                    Icons.Filled.ExpandMore
                },
                contentDescription = if (folder.collapsed) {
                    stringResource(R.string.expand_folder)
                } else {
                    stringResource(R.string.collapse_folder)
                },
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(NumeraDimens.iconMedium),
            )
            Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
            Icon(
                imageVector = Icons.Filled.Folder,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(NumeraDimens.iconMedium),
            )
            Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
            Text(
                text = folder.name,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (childCount > 0) {
                Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
                Text(
                    text = childCount.toString(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (folder.pinned) {
            RowAction(
                icon = Icons.Filled.PushPin,
                tint = MaterialTheme.colorScheme.primary,
                tag = "pin-folder-${folder.id}",
                description = stringResource(R.string.unpin_folder),
                onClick = onTogglePin,
            )
        }
        RowActionMenu(
            tag = "folder-menu-${folder.id}",
            description = stringResource(R.string.folder_actions),
        ) { dismiss ->
            DropdownMenuItem(
                text = { Text(stringResource(R.string.rename)) },
                onClick = { onRename(); dismiss() },
                modifier = Modifier.testTag("rename-folder-${folder.id}"),
            )
            DropdownMenuItem(
                text = {
                    Text(
                        if (folder.pinned) {
                            stringResource(R.string.unpin)
                        } else {
                            stringResource(R.string.pin)
                        },
                    )
                },
                onClick = { onTogglePin(); dismiss() },
                modifier = Modifier.testTag("pin-menu-folder-${folder.id}"),
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.delete)) },
                onClick = { onDelete(); dismiss() },
                modifier = Modifier.testTag("delete-folder-${folder.id}"),
            )
        }
        Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
    }
}

@Composable
private fun FileRow(
    file: WorkspaceFile,
    depth: Int,
    selected: Boolean,
    onSelect: () -> Unit,
    onTogglePin: () -> Unit,
    onRename: () -> Unit,
    onMove: () -> Unit,
    onExport: () -> Unit,
    onDelete: () -> Unit,
) {
    val background = if (selected) {
        MaterialTheme.colorScheme.secondaryContainer
    } else {
        Color.Transparent
    }
    val contentColor = if (selected) {
        MaterialTheme.colorScheme.onSecondaryContainer
    } else {
        MaterialTheme.colorScheme.onSurface
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(background)
            .height(NumeraDimens.touchTargetComfortable)
            .testTag("file-row-${file.id}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier
                .weight(1f)
                .clickable(onClick = onSelect)
                .padding(
                    start = NumeraDimens.spacingInline + NumeraDimens.spacingBlock * depth,
                    end = NumeraDimens.spacingInlineTight,
                ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(
                imageVector = Icons.Outlined.Description,
                contentDescription = null,
                tint = if (selected) {
                    MaterialTheme.colorScheme.onSecondaryContainer
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
                modifier = Modifier.size(NumeraDimens.iconMedium),
            )
            Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
            Text(
                text = file.displayName,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                color = contentColor,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        if (file.pinned) {
            RowAction(
                icon = Icons.Filled.PushPin,
                tint = MaterialTheme.colorScheme.primary,
                tag = "pin-file-${file.id}",
                description = stringResource(R.string.unpin_file),
                onClick = onTogglePin,
            )
        }
        RowActionMenu(
            tag = "file-menu-${file.id}",
            description = stringResource(R.string.file_actions),
        ) { dismiss ->
            DropdownMenuItem(
                text = { Text(stringResource(R.string.rename)) },
                onClick = { onRename(); dismiss() },
                modifier = Modifier.testTag("rename-file-${file.id}"),
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.move_to_folder)) },
                onClick = { onMove(); dismiss() },
                modifier = Modifier.testTag("move-file-${file.id}"),
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.export)) },
                onClick = { onExport(); dismiss() },
                modifier = Modifier.testTag("export-file-${file.id}"),
            )
            DropdownMenuItem(
                text = {
                    Text(
                        if (file.pinned) {
                            stringResource(R.string.unpin)
                        } else {
                            stringResource(R.string.pin)
                        },
                    )
                },
                onClick = { onTogglePin(); dismiss() },
                modifier = Modifier.testTag("pin-menu-file-${file.id}"),
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.delete)) },
                onClick = { onDelete(); dismiss() },
                modifier = Modifier.testTag("delete-file-${file.id}"),
            )
        }
        Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
    }
}

@Composable
private fun MoveToFolderDialog(
    folders: List<WorkspaceFolder>,
    currentFolderId: String?,
    onPick: (String?) -> Unit,
    onNewFolder: () -> Unit,
    onDismiss: () -> Unit,
) {
    val sorted = remember(folders) {
        folders.sortedWith(
            compareByDescending<WorkspaceFolder> { it.pinned }.thenBy { it.order },
        )
    }
    androidx.compose.material3.AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.move_to_folder)) },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .verticalScroll(rememberScrollState()),
            ) {
                MoveOption(
                    label = stringResource(R.string.no_folder),
                    selected = currentFolderId == null,
                    tag = "move-no-folder",
                    onClick = { onPick(null) },
                )
                sorted.forEach { folder ->
                    MoveOption(
                        label = folder.name,
                        selected = currentFolderId == folder.id,
                        tag = "move-folder-${folder.id}",
                        onClick = { onPick(folder.id) },
                    )
                }
                MoveOption(
                    label = stringResource(R.string.new_folder_ellipsis),
                    selected = false,
                    tag = "move-new-folder",
                    onClick = onNewFolder,
                )
            }
        },
        confirmButton = {},
        dismissButton = {
            androidx.compose.material3.TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.cancel))
            }
        },
        modifier = Modifier.testTag("move-dialog"),
    )
}

@Composable
private fun MoveOption(
    label: String,
    selected: Boolean,
    tag: String,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(
                horizontal = NumeraDimens.spacingInline,
                vertical = NumeraDimens.spacingInline,
            )
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            Text(
                text = "✓",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.primary,
            )
        }
    }
}

@Composable
private fun RowAction(
    icon: ImageVector,
    tint: Color,
    tag: String,
    description: String,
    onClick: () -> Unit,
) {
    Box(
        modifier = Modifier
            .size(NumeraDimens.touchTargetMin)
            .semantics { contentDescription = description }
            .clickable(onClick = onClick)
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = tint,
            modifier = Modifier.size(NumeraDimens.iconMedium),
        )
    }
}

@Composable
private fun RowActionMenu(
    tag: String,
    description: String,
    menuItems: @Composable ColumnScope.(dismiss: () -> Unit) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Box {
        Box(
            modifier = Modifier
                .size(NumeraDimens.touchTargetMin)
                .semantics { contentDescription = description }
                .clickable { expanded = true }
                .testTag(tag),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                imageVector = Icons.Filled.MoreVert,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(NumeraDimens.iconMedium),
            )
        }
        DropdownMenu(
            expanded = expanded,
            onDismissRequest = { expanded = false },
        ) {
            menuItems { expanded = false }
        }
    }
}

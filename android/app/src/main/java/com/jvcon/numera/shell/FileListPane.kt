package com.jvcon.numera.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CreateNewFolder
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Folder
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Functions
import androidx.compose.material.icons.outlined.PushPin
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.workspace.EditingTarget
import com.jvcon.numera.workspace.WorkspaceFile
import com.jvcon.numera.workspace.WorkspaceFolder
import com.jvcon.numera.workspace.WorkspaceState

/**
 * The workspace file list: globals entry, folder/file rows, and the
 * create/search affordances (issue #12).
 *
 * Stateless apart from the search field's own text — every mutation is routed
 * out through a callback so the pane stays a pure function of [state].
 *
 * Insets are owned here (not by the caller) so the pane looks identical whether
 * it is hosted by the modal drawer or by the expanded persistent column: the
 * `surfaceContainerLow` background runs edge-to-edge under the system bars
 * while the content stays clear of them.
 */
@Composable
fun FileListPane(
    state: WorkspaceState,
    onSelectFile: (String) -> Unit,
    onToggleFilePin: (String) -> Unit,
    onDeleteFile: (String) -> Unit,
    onToggleFolderPin: (String) -> Unit,
    onToggleFolderCollapsed: (String) -> Unit,
    onDeleteFolder: (String) -> Unit,
    onCreateFile: () -> Unit,
    onCreateFolder: () -> Unit,
    onOpenGlobals: () -> Unit,
    modifier: Modifier = Modifier,
    searchVisible: Boolean = false,
) {
    var query by remember { mutableStateOf("") }
    val rows = remember(state.files, state.folders) {
        buildFileListRows(state.files, state.folders)
    }
    val visibleRows = if (searchVisible) rows.filter { it.matchesQuery(query) } else rows

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
                text = "Workspace",
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        if (searchVisible) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                placeholder = { Text("Search files") },
                leadingIcon = {
                    Icon(
                        imageVector = Icons.Outlined.Search,
                        contentDescription = null,
                        modifier = Modifier.size(NumeraDimens.iconMedium),
                    )
                },
                shape = MaterialTheme.shapes.extraSmall,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = {}),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(
                        horizontal = NumeraDimens.spacingInline,
                        vertical = NumeraDimens.spacingInlineTight,
                    )
                    .testTag("search-field"),
            )
        }

        GlobalsRow(
            selected = state.editingTarget == EditingTarget.GLOBALS,
            onClick = onOpenGlobals,
        )

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .testTag("file-list"),
        ) {
            items(items = visibleRows, key = { it.key() }) { row ->
                when (row) {
                    is FileListRow.FolderHeader -> FolderRow(
                        folder = row.folder,
                        childCount = row.childCount,
                        onToggleCollapsed = { onToggleFolderCollapsed(row.folder.id) },
                        onTogglePin = { onToggleFolderPin(row.folder.id) },
                        onDelete = { onDeleteFolder(row.folder.id) },
                    )

                    is FileListRow.FileRow -> FileRow(
                        file = row.file,
                        depth = row.depth,
                        selected = state.activeFileId == row.file.id &&
                            state.editingTarget == EditingTarget.FILE,
                        onSelect = { onSelectFile(row.file.id) },
                        onTogglePin = { onToggleFilePin(row.file.id) },
                        onDelete = { onDeleteFile(row.file.id) },
                    )
                }
            }
        }

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    horizontal = NumeraDimens.spacingInlineTight,
                    vertical = NumeraDimens.spacingInlineTight,
                ),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(NumeraDimens.spacingInlineTight),
        ) {
            TextButton(
                onClick = onCreateFile,
                modifier = Modifier.testTag("new-file"),
            ) {
                Icon(
                    imageVector = Icons.Filled.Add,
                    contentDescription = null,
                    modifier = Modifier.size(NumeraDimens.iconSmall),
                )
                Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
                Text("File")
            }
            TextButton(
                onClick = onCreateFolder,
                modifier = Modifier.testTag("new-folder"),
            ) {
                Icon(
                    imageVector = Icons.Filled.CreateNewFolder,
                    contentDescription = null,
                    modifier = Modifier.size(NumeraDimens.iconSmall),
                )
                Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
                Text("Folder")
            }
        }
    }
}

private fun FileListRow.key(): String = when (this) {
    is FileListRow.FolderHeader -> "folder-${folder.id}"
    is FileListRow.FileRow -> "file-${file.id}"
}

@Composable
private fun GlobalsRow(selected: Boolean, onClick: () -> Unit) {
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
            .clickable(onClick = onClick)
            .height(NumeraDimens.touchTargetComfortable)
            .padding(horizontal = NumeraDimens.spacingInline)
            .testTag("globals-row"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = Icons.Outlined.Functions,
            contentDescription = null,
            tint = if (selected) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            modifier = Modifier.size(NumeraDimens.iconMedium),
        )
        Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
        Text(
            text = "Globals",
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = contentColor,
        )
    }
}

@Composable
private fun FolderRow(
    folder: WorkspaceFolder,
    childCount: Int,
    onToggleCollapsed: () -> Unit,
    onTogglePin: () -> Unit,
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
                contentDescription = if (folder.collapsed) "Expand folder" else "Collapse folder",
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
        RowAction(
            icon = if (folder.pinned) Icons.Filled.PushPin else Icons.Outlined.PushPin,
            tint = if (folder.pinned) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            tag = "pin-folder-${folder.id}",
            description = if (folder.pinned) "Unpin folder" else "Pin folder",
            onClick = onTogglePin,
        )
        RowAction(
            icon = Icons.Outlined.Delete,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            tag = "delete-folder-${folder.id}",
            description = "Delete folder",
            onClick = onDelete,
        )
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
        RowAction(
            icon = if (file.pinned) Icons.Filled.PushPin else Icons.Outlined.PushPin,
            tint = if (file.pinned) {
                MaterialTheme.colorScheme.primary
            } else {
                MaterialTheme.colorScheme.onSurfaceVariant
            },
            tag = "pin-file-${file.id}",
            description = if (file.pinned) "Unpin file" else "Pin file",
            onClick = onTogglePin,
        )
        RowAction(
            icon = Icons.Outlined.Delete,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            tag = "delete-file-${file.id}",
            description = "Delete file",
            onClick = onDelete,
        )
        Spacer(Modifier.width(NumeraDimens.spacingInlineTight))
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

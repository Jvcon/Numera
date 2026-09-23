package com.jvcon.numera.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
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

    Column(modifier = modifier) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(
                    horizontal = NumeraDimens.spacingInline,
                    vertical = NumeraDimens.spacingBlockTight,
                ),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = "Workspace",
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.weight(1f),
            )
        }

        GlobalsRow(
            selected = state.editingTarget == EditingTarget.GLOBALS,
            onClick = onOpenGlobals,
        )

        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

        if (searchVisible) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                label = { Text("Search files") },
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
                .padding(horizontal = NumeraDimens.spacingInlineTight),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TextButton(
                onClick = onCreateFile,
                modifier = Modifier.testTag("new-file"),
            ) {
                Text("+ File")
            }
            TextButton(
                onClick = onCreateFolder,
                modifier = Modifier.testTag("new-folder"),
            ) {
                Text("+ Folder")
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
        MaterialTheme.colorScheme.surface
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
        Text(
            text = "Globals",
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
            color = MaterialTheme.colorScheme.onSurface,
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
                .padding(start = NumeraDimens.spacingInline)
                .testTag("collapse-folder-${folder.id}"),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = if (folder.collapsed) "▸" else "▾",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.width(NumeraDimens.space1))
            Text(
                text = folder.name,
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            if (childCount > 0) {
                Text(
                    text = childCount.toString(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        RowAction(
            label = if (folder.pinned) "★" else "☆",
            tag = "pin-folder-${folder.id}",
            contentDescription = if (folder.pinned) "Unpin folder" else "Pin folder",
            onClick = onTogglePin,
        )
        RowAction(
            label = "✕",
            tag = "delete-folder-${folder.id}",
            contentDescription = "Delete folder",
            onClick = onDelete,
        )
        Spacer(Modifier.width(NumeraDimens.space1))
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
        MaterialTheme.colorScheme.surface
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
                .padding(start = NumeraDimens.spacingInline * (depth + 1)),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = file.displayName,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Normal,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
        }
        RowAction(
            label = if (file.pinned) "★" else "☆",
            tag = "pin-file-${file.id}",
            contentDescription = if (file.pinned) "Unpin file" else "Pin file",
            onClick = onTogglePin,
        )
        RowAction(
            label = "✕",
            tag = "delete-file-${file.id}",
            contentDescription = "Delete file",
            onClick = onDelete,
        )
        Spacer(Modifier.width(NumeraDimens.space1))
    }
}

@Composable
private fun RowAction(
    label: String,
    tag: String,
    contentDescription: String,
    onClick: () -> Unit,
) {
    val description = contentDescription
    Box(
        modifier = Modifier
            .size(NumeraDimens.touchTargetMin)
            .semantics { contentDescription = description }
            .clickable(onClick = onClick)
            .testTag(tag),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

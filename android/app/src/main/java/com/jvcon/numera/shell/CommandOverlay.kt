package com.jvcon.numera.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.ui.theme.NumeraElevation
import com.jvcon.numera.workspace.WorkspaceFile

/**
 * The Command surface — a keyboard-first overlay for switching files and running
 * commands, mirroring the web's Command panel (docs/interaction-model.md §2).
 *
 * Entered from the FAB (`fab:command`) or Ctrl/Cmd+K and dismissed by
 * `dismiss-overlay` (scrim tap or system back). It lists only list files plus
 * commands; `globals` and `draft` are non-list editing targets and never appear
 * as Command results.
 */
@Composable
fun CommandOverlay(
    files: List<WorkspaceFile>,
    onSelectFile: (String) -> Unit,
    onNewFile: () -> Unit,
    onNewDraft: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var query by remember { mutableStateOf("") }
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    val q = query.trim().lowercase()
    val matchingFiles = files
        .filter { !it.draft }
        .filter {
            q.isEmpty() ||
                it.displayName.lowercase().contains(q) ||
                it.path.lowercase().contains(q)
        }
    val commands: List<Pair<String, () -> Unit>> = buildList {
        if (q.isEmpty() || "new file".contains(q)) add("New file" to onNewFile)
        if (q.isEmpty() || "new draft".contains(q)) add("New draft" to onNewDraft)
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss,
            )
            .testTag("command-overlay"),
    ) {
        Surface(
            modifier = Modifier
                .align(Alignment.TopCenter)
                .padding(
                    start = NumeraDimens.spacingBlock,
                    end = NumeraDimens.spacingBlock,
                    top = NumeraDimens.spacingBlockLoose,
                )
                .fillMaxWidth()
                .heightIn(max = 480.dp)
                // Consume taps on the panel so they do not dismiss via the scrim.
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {},
                )
                .testTag("command-panel"),
            shape = MaterialTheme.shapes.extraLarge,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            tonalElevation = NumeraElevation.level3,
            shadowElevation = NumeraElevation.level3,
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    singleLine = true,
                    placeholder = { Text("Command") },
                    leadingIcon = {
                        Icon(Icons.Filled.Search, contentDescription = null)
                    },
                    shape = MaterialTheme.shapes.extraSmall,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = {}),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(NumeraDimens.spacingInline)
                        .focusRequester(focusRequester)
                        .testTag("command-field"),
                )

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                LazyColumn(modifier = Modifier.fillMaxWidth()) {
                    if (matchingFiles.isNotEmpty()) {
                        item { CommandGroupLabel("Files") }
                        items(matchingFiles, key = { it.id }) { file ->
                            CommandRow(
                                label = file.displayName,
                                detail = file.path,
                                tag = "command-file-${file.id}",
                                icon = Icons.Outlined.Description,
                                onClick = { onSelectFile(file.id) },
                            )
                        }
                    }
                    if (commands.isNotEmpty()) {
                        item { CommandGroupLabel("Commands") }
                        items(commands) { (label, action) ->
                            CommandRow(
                                label = label,
                                detail = null,
                                tag = "command-action-${label.lowercase().replace(' ', '-')}",
                                icon = if (label == "New draft") {
                                    Icons.Filled.Bolt
                                } else {
                                    Icons.Filled.Add
                                },
                                onClick = action,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CommandGroupLabel(text: String) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(
            horizontal = NumeraDimens.spacingInlineLoose,
            vertical = NumeraDimens.spacingInlineTight,
        ),
    )
}

@Composable
private fun CommandRow(
    label: String,
    detail: String?,
    tag: String,
    icon: ImageVector,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(
                horizontal = NumeraDimens.spacingInlineLoose,
                vertical = NumeraDimens.spacingInline,
            )
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(NumeraDimens.iconMedium),
        )
        Spacer(Modifier.width(NumeraDimens.spacingInlineLoose))
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = label,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.Normal,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (detail != null) {
                Text(
                    text = detail,
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
    }
}

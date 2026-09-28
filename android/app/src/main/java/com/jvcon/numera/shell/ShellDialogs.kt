package com.jvcon.numera.shell

import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.jvcon.numera.R

/**
 * Shared shell dialogs: a single-field name prompt and a confirm prompt.
 *
 * Mirrors the web sidebar dialogs (`web/src/components/sidebar.ts`): the name
 * prompt backs New file / New folder / Rename, and the confirm prompt backs
 * Delete.
 */
@Composable
internal fun NameDialog(
    title: String,
    tag: String,
    confirmLabel: String,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
    fieldLabel: String? = null,
    initialName: String = "",
) {
    var name by remember(initialName) { mutableStateOf(initialName) }
    val resolvedFieldLabel = fieldLabel ?: stringResource(R.string.name)
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = name,
                onValueChange = { name = it },
                singleLine = true,
                label = { Text(resolvedFieldLabel) },
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
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
        modifier = Modifier.testTag(tag),
    )
}

@Composable
internal fun ConfirmDialog(
    title: String,
    message: String,
    tag: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(message) },
        confirmButton = {
            TextButton(
                onClick = onConfirm,
                modifier = Modifier.testTag("$tag-confirm"),
            ) {
                Text(confirmLabel)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) }
        },
        modifier = Modifier.testTag(tag),
    )
}

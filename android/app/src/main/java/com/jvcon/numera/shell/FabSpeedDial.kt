package com.jvcon.numera.shell

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.jvcon.numera.ui.theme.NumeraDimens

/**
 * Bottom-end FAB that expands into the three workspace actions (issue #12):
 * new file, new draft, and file search.
 *
 * Purely presentational — expansion state and the actions themselves are owned
 * by [AppShell], which also clears the dial on scrim tap / Escape.
 */
@Composable
fun FabSpeedDial(
    expanded: Boolean,
    onExpandedChange: (Boolean) -> Unit,
    onNewFile: () -> Unit,
    onNewDraft: () -> Unit,
    onSearch: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.End,
        verticalArrangement = Arrangement.spacedBy(NumeraDimens.spacingInline),
    ) {
        if (expanded) {
            SpeedDialAction(
                label = "New file",
                tag = "fab-new-file",
                onClick = {
                    onNewFile()
                    onExpandedChange(false)
                },
            )
            SpeedDialAction(
                label = "New draft",
                tag = "fab-new-draft",
                onClick = {
                    onNewDraft()
                    onExpandedChange(false)
                },
            )
            SpeedDialAction(
                label = "Search",
                tag = "fab-search",
                onClick = {
                    onSearch()
                    onExpandedChange(false)
                },
            )
        }

        FloatingActionButton(
            onClick = { onExpandedChange(!expanded) },
            shape = MaterialTheme.shapes.extraLarge,
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.testTag("fab"),
        ) {
            Text(
                text = if (expanded) "×" else "+",
                style = MaterialTheme.typography.titleLarge,
            )
        }
    }
}

@Composable
private fun SpeedDialAction(
    label: String,
    tag: String,
    onClick: () -> Unit,
) {
    ExtendedFloatingActionButton(
        onClick = onClick,
        containerColor = MaterialTheme.colorScheme.secondaryContainer,
        contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
        modifier = Modifier.testTag(tag),
    ) {
        Text(text = label, style = MaterialTheme.typography.labelLarge)
    }
}

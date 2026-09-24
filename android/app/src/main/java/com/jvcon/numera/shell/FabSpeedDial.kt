package com.jvcon.numera.shell

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Bolt
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.ui.theme.NumeraElevation
import com.jvcon.numera.ui.theme.NumeraMotion

/**
 * Bottom-end FAB that expands into the three workspace actions (issue #12):
 * new file, new draft, and file search.
 *
 * Mirrors the web FAB: a `primaryContainer` round-square that swaps `+` for
 * `×`, with a staggered column of round `secondaryContainer` action buttons and
 * pill labels. Expansion state and the actions themselves are owned by
 * [AppShell], which also clears the dial on scrim tap / Escape.
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
        verticalArrangement = Arrangement.spacedBy(NumeraDimens.spacingBlockTight),
    ) {
        AnimatedVisibility(
            visible = expanded,
            enter = fadeIn(
                animationSpec = tween(
                    durationMillis = NumeraMotion.durationMedium,
                    easing = NumeraMotion.emphasizedDecelerate,
                ),
            ) + slideInVertically(
                animationSpec = tween(
                    durationMillis = NumeraMotion.durationMedium,
                    easing = NumeraMotion.emphasizedDecelerate,
                ),
                initialOffsetY = { height -> height / 3 },
            ),
            exit = fadeOut(
                animationSpec = tween(
                    durationMillis = NumeraMotion.durationFast,
                    easing = NumeraMotion.emphasizedAccelerate,
                ),
            ) + slideOutVertically(
                animationSpec = tween(
                    durationMillis = NumeraMotion.durationFast,
                    easing = NumeraMotion.emphasizedAccelerate,
                ),
                targetOffsetY = { height -> height / 3 },
            ),
        ) {
            Column(
                horizontalAlignment = Alignment.End,
                verticalArrangement = Arrangement.spacedBy(NumeraDimens.spacingBlockTight),
            ) {
                SpeedDialAction(
                    icon = Icons.Filled.Add,
                    label = "New file",
                    tag = "fab-new-file",
                    onClick = {
                        onNewFile()
                        onExpandedChange(false)
                    },
                )
                SpeedDialAction(
                    icon = Icons.Filled.Bolt,
                    label = "New draft",
                    tag = "fab-new-draft",
                    onClick = {
                        onNewDraft()
                        onExpandedChange(false)
                    },
                )
                SpeedDialAction(
                    icon = Icons.Filled.Search,
                    label = "Search",
                    tag = "fab-search",
                    onClick = {
                        onSearch()
                        onExpandedChange(false)
                    },
                )
            }
        }

        FloatingActionButton(
            onClick = { onExpandedChange(!expanded) },
            shape = MaterialTheme.shapes.extraLarge,
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            elevation = FloatingActionButtonDefaults.elevation(
                defaultElevation = NumeraElevation.level3,
            ),
            modifier = Modifier
                .size(NumeraDimens.fabSize)
                .testTag("fab"),
        ) {
            Icon(
                imageVector = if (expanded) Icons.Filled.Close else Icons.Filled.Add,
                contentDescription = if (expanded) "Close menu" else "Open menu",
            )
        }
    }
}

@Composable
private fun SpeedDialAction(
    icon: ImageVector,
    label: String,
    tag: String,
    onClick: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(NumeraDimens.spacingInline),
    ) {
        Surface(
            shape = MaterialTheme.shapes.extraLarge,
            color = MaterialTheme.colorScheme.surfaceContainerHighest,
            tonalElevation = NumeraElevation.level1,
            shadowElevation = NumeraElevation.level1,
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.padding(
                    horizontal = NumeraDimens.spacingInlineLoose,
                    vertical = NumeraDimens.spacingInlineTight,
                ),
            )
        }
        FloatingActionButton(
            onClick = onClick,
            shape = CircleShape,
            containerColor = MaterialTheme.colorScheme.secondaryContainer,
            contentColor = MaterialTheme.colorScheme.onSecondaryContainer,
            elevation = FloatingActionButtonDefaults.elevation(
                defaultElevation = NumeraElevation.level2,
            ),
            modifier = Modifier
                .size(NumeraDimens.speedDialActionSize)
                .testTag(tag),
        ) {
            Icon(
                imageVector = icon,
                contentDescription = label,
            )
        }
    }
}

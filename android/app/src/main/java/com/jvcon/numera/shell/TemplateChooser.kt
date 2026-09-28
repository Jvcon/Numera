package com.jvcon.numera.shell

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jvcon.numera.R
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.ui.theme.NumeraElevation
import com.jvcon.numera.workspace.Template

/**
 * The template chooser overlay — mirrors the web surface
 * (`web/src/components/template-chooser.ts`, `docs/interaction-model.md`).
 *
 * Entered from the top bar (`top-bar:template`), the FAB (`fab:template`) and
 * Command; dismissed by `dismiss-overlay` (scrim tap or system back). Picking a
 * template emits its id via [onSelect] so the shell can instantiate it.
 */
@Composable
fun TemplateChooser(
    templates: List<Template>,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.scrim.copy(alpha = 0.32f))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss,
            )
            .testTag("template-chooser"),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            modifier = Modifier
                .padding(NumeraDimens.spacingBlockLoose)
                .fillMaxWidth()
                .heightIn(max = 480.dp)
                // Consume taps on the panel so they do not dismiss via the scrim.
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {},
                )
                .testTag("template-panel"),
            shape = MaterialTheme.shapes.extraLarge,
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            tonalElevation = NumeraElevation.level3,
            shadowElevation = NumeraElevation.level3,
        ) {
            Column(modifier = Modifier.fillMaxWidth()) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(
                            horizontal = NumeraDimens.spacingBlockLoose,
                            vertical = NumeraDimens.spacingBlock,
                        ),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.new_from_template),
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurface,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier.testTag("template-close"),
                    ) {
                        Icon(
                            imageVector = Icons.Filled.Close,
                            contentDescription = stringResource(R.string.close),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                if (templates.isEmpty()) {
                    Text(
                        text = stringResource(R.string.no_templates),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(NumeraDimens.spacingBlockLoose),
                    )
                } else {
                    LazyColumn(modifier = Modifier.fillMaxWidth()) {
                        items(templates, key = { it.id }) { template ->
                            TemplateRow(
                                template = template,
                                onClick = { onSelect(template.id) },
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TemplateRow(
    template: Template,
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
            .testTag("template-${template.id}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(NumeraDimens.spacingInlineLoose),
    ) {
        Icon(
            imageVector = Icons.Filled.GridView,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.size(NumeraDimens.iconMedium),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = template.name,
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = template.description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

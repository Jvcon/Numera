package com.jvcon.numera.editor

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import com.jvcon.numera.engine.EnginePort
import com.jvcon.numera.engine.LineOutcome
import com.jvcon.numera.ui.theme.JetBrainsMono
import com.jvcon.numera.ui.theme.NumeraDimens
import com.jvcon.numera.ui.theme.NumeraMonoType
import com.jvcon.numera.workspace.EditingTarget
import com.jvcon.numera.workspace.WorkspaceViewModel
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch

/** Stable display identity for the globals document. */
private const val GLOBALS_IDENTITY = "globals"

/** Fallback identity when FILE mode has no active file. */
private const val NO_FILE_IDENTITY = "no-file"

/**
 * The Numera editor: the whole document in ONE state-based [BasicTextField]
 * plus a parallel result gutter that evaluates live.
 *
 * Receives the [WorkspaceViewModel] (state + engine + mutators) and reads
 * `viewModel.state` for content, outcomes, and mode.
 */
@Composable
fun EditorScreen(
    viewModel: WorkspaceViewModel,
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsState()

    val isGlobals = state.editingTarget == EditingTarget.GLOBALS
    val identity = if (isGlobals) GLOBALS_IDENTITY else state.activeFileId ?: NO_FILE_IDENTITY
    val content = if (isGlobals) {
        state.globalsContent
    } else {
        state.files.firstOrNull { it.id == state.activeFileId }?.content ?: ""
    }
    val title = if (isGlobals) {
        "Globals"
    } else {
        state.files.firstOrNull { it.id == state.activeFileId }?.displayName ?: "Numera"
    }

    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    Surface(
        modifier = modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.surface,
    ) {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                EditorTopBar(
                    title = title,
                    isGlobals = isGlobals,
                    onBack = viewModel::closeGlobals,
                    onOpenGlobals = viewModel::openGlobals,
                    onNewDraft = { viewModel.createDraft() },
                )
                if (state.hydrating) {
                    LoadingState(Modifier.weight(1f))
                } else {
                    EditorBody(
                        modifier = Modifier.weight(1f),
                        identity = identity,
                        content = content,
                        outcomes = state.outcomes,
                        engine = viewModel.getEngine(),
                        onContentChange = viewModel::setActiveContent,
                        onCopyValue = { value ->
                            clipboard.setText(AnnotatedString(value))
                            scope.launch {
                                snackbarHostState.showSnackbar(
                                    message = "Copied",
                                    duration = SnackbarDuration.Short,
                                )
                            }
                        },
                        onErrorTap = { message ->
                            scope.launch {
                                snackbarHostState.showSnackbar(
                                    message = message,
                                    duration = SnackbarDuration.Short,
                                )
                            }
                        },
                    )
                }
            }
            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .testTag("copy-snackbar"),
            )
        }
    }
}

/** Minimal chrome: back arrow (globals mode), title, and draft/globals actions. */
@Composable
private fun EditorTopBar(
    title: String,
    isGlobals: Boolean,
    onBack: () -> Unit,
    onOpenGlobals: () -> Unit,
    onNewDraft: () -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(NumeraDimens.appBarHeight)
            .padding(horizontal = NumeraDimens.space2),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (isGlobals) {
            IconButton(
                onClick = onBack,
                modifier = Modifier.testTag("editor-back"),
            ) {
                Text(
                    text = "←",
                    style = MaterialTheme.typography.titleLarge,
                    color = MaterialTheme.colorScheme.onSurface,
                )
            }
        } else {
            Spacer(Modifier.width(NumeraDimens.space2))
        }

        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .testTag("editor-title"),
        )

        TextButton(
            onClick = onNewDraft,
            modifier = Modifier.testTag("new-draft"),
        ) {
            Text("New draft")
        }

        if (!isGlobals) {
            TextButton(
                onClick = onOpenGlobals,
                modifier = Modifier.testTag("open-globals"),
            ) {
                Text("Globals")
            }
        }
    }
}

/** The whole-document text field plus its live result gutter. */
@Composable
private fun EditorBody(
    modifier: Modifier = Modifier,
    identity: String,
    content: String,
    outcomes: List<LineOutcome>,
    engine: EnginePort,
    onContentChange: (String) -> Unit,
    onCopyValue: (String) -> Unit,
    onErrorTap: (String) -> Unit,
) {
    // Keyed on the display identity so switching files/globals resets the field.
    val textFieldState = remember(identity) { rememberTextFieldState(content) }
    val scrollState = rememberScrollState()
    val layoutResultState = remember { mutableStateOf<TextLayoutResult?>(null) }

    // Push user edits to the VM (which re-evaluates and, in globals mode,
    // delegates to setGlobals). `drop(1)` skips the initial snapshot, which is
    // the content we just seeded the field with from the VM.
    LaunchedEffect(textFieldState) {
        snapshotFlow { textFieldState.text.toString() }
            .drop(1)
            .collect(onContentChange)
    }

    // `state.text` is a live CharSequence; snapshot it so it is a stable key
    // and every offset below is a well-defined UTF-16 index.
    val liveContent = textFieldState.text.toString()
    val anchors = remember(liveContent) { expressionAnchorOffsets(liveContent, engine) }

    val editorStyle = TextStyle(
        fontFamily = JetBrainsMono,
        fontSize = NumeraMonoType.mediumSize,
        lineHeight = NumeraMonoType.mediumLineHeight,
        color = MaterialTheme.colorScheme.onSurface,
    )
    val resultStyle = editorStyle.copy(
        color = MaterialTheme.colorScheme.tertiary,
        fontWeight = FontWeight.Medium,
    )
    val errorStyle = editorStyle.copy(
        color = MaterialTheme.colorScheme.error,
        fontWeight = FontWeight.Medium,
    )

    BasicTextField(
        state = textFieldState,
        modifier = modifier
            .fillMaxWidth()
            .testTag("editor"),
        textStyle = editorStyle,
        lineLimits = TextFieldLineLimits.MultiLine(),
        // The gutter reads this SAME ScrollState, which keeps the two columns
        // in lock-step through scrolling.
        scrollState = scrollState,
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        onTextLayout = { getResult ->
            layoutResultState.value = getResult()
        },
        decorator = ResultGutterDecorator(
            layoutResultState = layoutResultState,
            outcomes = outcomes,
            anchors = anchors,
            scrollState = scrollState,
            resultStyle = resultStyle,
            errorStyle = errorStyle,
            onCopyValue = onCopyValue,
            onErrorTap = onErrorTap,
        ),
    )
}

/** Minimal loading state shown while the first hydrate-from-persistence runs. */
@Composable
private fun LoadingState(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        CircularProgressIndicator(
            modifier = Modifier.testTag("editor-loading"),
        )
    }
}

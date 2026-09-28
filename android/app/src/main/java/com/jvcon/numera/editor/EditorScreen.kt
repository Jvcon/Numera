package com.jvcon.numera.editor

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.input.TextFieldLineLimits
import androidx.compose.foundation.text.input.rememberTextFieldState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Functions
import androidx.compose.material.icons.filled.GridView
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.jvcon.numera.R
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
    onOpenNavigation: (() -> Unit)? = null,
    onOpenTemplate: () -> Unit = {},
) {
    val state by viewModel.state.collectAsState()

    val isGlobals = state.editingTarget == EditingTarget.GLOBALS
    val activeFile = state.files.firstOrNull { it.id == state.activeFileId }
    val identity = if (isGlobals) GLOBALS_IDENTITY else state.activeFileId ?: NO_FILE_IDENTITY
    val content = if (isGlobals) {
        state.globalsContent
    } else {
        activeFile?.content ?: ""
    }
    val globalsTitle = stringResource(R.string.globals)
    val title = if (isGlobals) {
        globalsTitle
    } else {
        activeFile?.displayName ?: stringResource(R.string.app_name)
    }

    // A non-list editing target (`globals` or a `draft`) exits with a trailing
    // Close (X); a `file` instead shows the globals entry point.
    // See docs/interaction-model.md §4.
    val isDraft = !isGlobals && activeFile?.draft == true
    val showExit = isGlobals || isDraft
    val exitDescription = if (isGlobals) {
        stringResource(R.string.exit_globals)
    } else {
        stringResource(R.string.exit_draft)
    }
    val copiedLabel = stringResource(R.string.copied)

    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    Scaffold(
        modifier = modifier.fillMaxSize(),
        containerColor = MaterialTheme.colorScheme.surface,
        // The top bar owns the status-bar inset; the body owns the
        // navigation-bar/IME insets, so Scaffold itself adds none.
        contentWindowInsets = WindowInsets(0.dp),
        topBar = {
            Column {
                EditorTopBar(
                    title = title,
                    showExit = showExit,
                    exitDescription = exitDescription,
                    onBack = viewModel::closeEditingTarget,
                    onOpenGlobals = viewModel::openGlobals,
                    onTemplate = onOpenTemplate,
                    onOpenNavigation = onOpenNavigation,
                )
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        },
        snackbarHost = {
            SnackbarHost(
                hostState = snackbarHostState,
                modifier = Modifier
                    .testTag("copy-snackbar")
                    .imePadding()
                    .navigationBarsPadding(),
            )
        },
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                // Keyboard + gesture/3-button nav never overlap the document.
                .imePadding()
                .navigationBarsPadding(),
        ) {
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
                                message = copiedLabel,
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
    }
}

/**
 * Chrome mirroring the web top bar: 64dp, `surfaceContainerLow`. The leading slot
 * holds at most one affordance — the drawer menu, or nothing; it is never a back
 * arrow. A non-list editing target (`globals`, `draft`) exits through a trailing
 * Close (X) in the actions, per docs/interaction-model.md §4.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EditorTopBar(
    title: String,
    showExit: Boolean,
    exitDescription: String,
    onBack: () -> Unit,
    onOpenGlobals: () -> Unit,
    onTemplate: () -> Unit,
    onOpenNavigation: (() -> Unit)? = null,
) {
    TopAppBar(
        title = {
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("editor-title"),
            )
        },
        navigationIcon = {
            if (onOpenNavigation != null) {
                IconButton(
                    onClick = onOpenNavigation,
                    modifier = Modifier.testTag("open-nav"),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Menu,
                        contentDescription = stringResource(R.string.open_navigation),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        actions = {
            IconButton(
                onClick = onTemplate,
                modifier = Modifier.testTag("open-templates"),
            ) {
                Icon(
                    imageVector = Icons.Filled.GridView,
                    contentDescription = stringResource(R.string.new_from_template),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            if (showExit) {
                IconButton(
                    onClick = onBack,
                    modifier = Modifier.testTag("editor-exit"),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Close,
                        contentDescription = exitDescription,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                IconButton(
                    onClick = onOpenGlobals,
                    modifier = Modifier.testTag("open-globals"),
                ) {
                    Icon(
                        imageVector = Icons.Filled.Functions,
                        contentDescription = stringResource(R.string.global_variables),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        },
        expandedHeight = NumeraDimens.appBarHeight,
        colors = TopAppBarDefaults.topAppBarColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerLow,
            titleContentColor = MaterialTheme.colorScheme.onSurface,
            navigationIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
            actionIconContentColor = MaterialTheme.colorScheme.onSurfaceVariant,
        ),
    )
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
    val textFieldState = key(identity) { rememberTextFieldState(content) }
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
            // Web editor padding: spacing-block-loose inline, spacing-block block.
            .padding(
                horizontal = NumeraDimens.spacingBlockLoose,
                vertical = NumeraDimens.spacingBlock,
            )
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

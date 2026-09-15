package com.jvcon.numera.workspace

/**
 * Cross-file reference alias generation.
 *
 * Faithful port of `collectFileAliases` in `web/src/lib/file-ref.ts`. The
 * actual `file("name")` / `file("name").member` resolution lives in the Rust
 * engine; this only computes the names a workspace file can be referenced by.
 *
 * The returned list may contain duplicate entries (e.g. when a path already
 * ends in `.numr`, the "with extension" alias equals the raw path). That is
 * intended: deduplication is FIRST-WINS and happens in
 * [WorkspaceViewModel.buildDocumentAliases], never here.
 */
internal fun collectFileAliases(file: WorkspaceFile): List<String> {
    val out = mutableListOf<String>()
    val path = file.path
    val withExt = if (path.endsWith(".numr")) path else "$path.numr"
    val withoutExt = withExt.removeSuffix(".numr")

    out.add(path)
    out.add(withExt)
    out.add(withoutExt)

    val baseName = path.split('/').lastOrNull() ?: withoutExt
    out.add(baseName)
    if (baseName.endsWith(".numr")) {
        out.add(baseName.removeSuffix(".numr"))
    }
    if (file.displayName.isNotEmpty()) {
        out.add(file.displayName)
    }
    return out
}

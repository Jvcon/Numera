/**
 * Cross-file reference alias generation.
 *
 * The actual `file("name")` / `file("name").member` resolution lives in
 * the Rust engine (`numera-engine::ReferenceEvaluator`) and is the single
 * source of truth for reference semantics. This module only computes the
 * set of names a workspace file can be referenced by, so the web layer
 * can register `alias -> content` with the engine before evaluating.
 *
 * Each alias maps to the referenced file's raw content; the engine then
 * extracts the first export (`file("name")`) or a named export
 * (`file("name").member`) at evaluation time.
 */

import type { WorkspaceFile } from './workspace';

/**
 * Mapping of file-name aliases (the argument to `file("...")`) to the
 * resolved `WorkspaceFile`. Built once per evaluation pass.
 */
export type FileIndex = ReadonlyMap<string, WorkspaceFile>;

export function buildFileIndex(files: readonly WorkspaceFile[]): FileIndex {
  const index = new Map<string, WorkspaceFile>();
  for (const file of files) {
    // Allow lookup by full path, by basename (with or without .numr),
    // or by display name. First alias wins (see collectFileAliases).
    const aliases = collectFileAliases(file);
    for (const alias of aliases) {
      if (!index.has(alias)) {
        index.set(alias, file);
      }
    }
  }
  return index;
}

/**
 * All names `file` may use to reference `file`: its full path, the path
 * with a `.numr` extension appended, the path without a `.numr`
 * extension, its basename (with and without `.numr`), and its display
 * name.
 */
export function collectFileAliases(file: WorkspaceFile): string[] {
  const out: string[] = [];
  const path = file.path;
  const withExt = path.endsWith('.numr') ? path : `${path}.numr`;
  const withoutExt = withExt.replace(/\.numr$/, '');

  out.push(path, withExt, withoutExt);

  const baseName = path.split('/').pop() ?? withoutExt;
  out.push(baseName);
  if (baseName.endsWith('.numr')) {
    out.push(baseName.replace(/\.numr$/, ''));
  }
  if (file.displayName) {
    out.push(file.displayName);
  }
  return out;
}

/**
 * Cross-file reference resolver. Mirrors the `file("name")` syntax
 * already supported by `numera-engine::ReferenceEvaluator`, but
 * implemented in TypeScript so we can iterate on semantics without
 * re-walking the WASM build cycle.
 *
 * Each `file("name")` occurrence in `expr` is replaced by the first
 * exported variable's value from the named file. An exported variable
 * is any `name = value` line that is not empty or a comment.
 *
 * If the file is missing or has no exports, the original reference is
 * left untouched so the engine surfaces the upstream error in the
 * gutter.
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
    // or by display name.
    const aliases = collectAliases(file);
    for (const alias of aliases) {
      if (!index.has(alias)) {
        index.set(alias, file);
      }
    }
  }
  return index;
}

function collectAliases(file: WorkspaceFile): string[] {
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

/**
 * Find the first exported variable's value in a file's content. Empty
 * lines and lines starting with `#` or `//` are skipped.
 */
function findFirstExport(content: string): { name: string; value: string } | null {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (name && value) return { name, value };
  }
  return null;
}

/**
 * Replace every `file("name")` and `File('name')` occurrence with the
 * referenced file's first export value. References that don't resolve
 * are left as-is so the engine reports the error.
 */
export function resolveFileReferences(
  expr: string,
  files: readonly WorkspaceFile[],
): string {
  const index = buildFileIndex(files);
  if (index.size === 0) return expr;

  return expr.replace(
    /(?:file|File)\s*\(\s*(?:"([^"]+)"|'([^']+)')\s*\)/g,
    (_match, double: string | undefined, single: string | undefined) => {
      const alias = (double ?? single ?? '').trim();
      const file = index.get(alias);
      if (!file) return _match;

      const exp = findFirstExport(file.content);
      if (!exp) return _match;
      return exp.value;
    },
  );
}

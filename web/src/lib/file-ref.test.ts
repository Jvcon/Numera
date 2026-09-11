/**
 * Tests for cross-file alias generation. Run with:
 *   node --import tsx --test src/lib/file-ref.test.ts
 *
 * The resolution semantics themselves live in the Rust engine and are
 * covered by `crates/engine/src/reference.rs` tests; here we only verify
 * that the web layer produces the alias set the engine is registered
 * with (including first-wins deduplication).
 */

import { collectFileAliases, buildFileIndex } from './file-ref';
import type { WorkspaceFile } from './workspace';

function makeFile(overrides: Partial<WorkspaceFile> & { path: string }): WorkspaceFile {
  return {
    id: overrides.path,
    displayName: overrides.path.replace(/\.numr$/, ''),
    pinned: false,
    folderId: null,
    order: 0,
    content: '',
    ...overrides,
  };
}

let failed = 0;

function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    expected: ${e}`);
    console.log(`    actual:   ${a}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

check(
  'path with .numr exposes path, basename and display name',
  collectFileAliases(makeFile({ path: 'daily.numr', displayName: 'Daily' })),
  ['daily.numr', 'daily.numr', 'daily', 'daily.numr', 'daily', 'Daily'],
);

check(
  'subdirectory path exposes full path and basename',
  collectFileAliases(makeFile({ path: 'daily/2026-09-07.numr', displayName: 'Daily — Sep 7' })),
  [
    'daily/2026-09-07.numr',
    'daily/2026-09-07.numr',
    'daily/2026-09-07',
    '2026-09-07.numr',
    '2026-09-07',
    'Daily — Sep 7',
  ],
);

check(
  'path without extension gets a .numr alias appended',
  collectFileAliases(makeFile({ path: 'notes', displayName: 'Notes' })),
  ['notes', 'notes.numr', 'notes', 'notes', 'Notes'],
);

// First-wins deduplication: two files sharing the basename "shared.numr";
// the earlier file in the workspace array must own the alias.
const first = makeFile({ id: 'first', path: 'a/shared.numr', content: 'x = 1' });
const second = makeFile({ id: 'second', path: 'b/shared.numr', content: 'x = 2' });
const index = buildFileIndex([first, second]);
check('first file wins a shared basename alias', index.get('shared.numr')?.id, 'first');
check('first file wins a shared basename alias (no ext)', index.get('shared')?.id, 'first');
check('later file still owns its unique full path', index.get('b/shared.numr')?.id, 'second');

if (failed > 0) {
  console.log(`\n${failed} case(s) failed`);
  process.exit(1);
} else {
  console.log('\nall cases passed');
}

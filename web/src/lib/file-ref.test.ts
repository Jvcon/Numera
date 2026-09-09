/**
 * Smoke test for the file-ref resolver. Run with:
 *   node --import tsx --test web/src/lib/file-ref.test.ts
 * or just inline-import from a probe harness. Standalone here so
 * we don't need vitest wired up yet.
 */

import { resolveFileReferences } from './file-ref';
import type { WorkspaceFile } from './workspace';

const cases: { name: string; expr: string; expected: string; files: WorkspaceFile[] }[] = [
  {
    name: 'simple file() by path',
    expr: 'x = file("daily")',
    expected: 'x = expense_breakfast + expense_lunch + expense_coffee',
    files: [
      {
        id: 'daily',
        path: 'daily.numr',
        displayName: 'Daily',
        pinned: false,
        folderId: null,
        order: 0,
        content: 'total = expense_breakfast + expense_lunch + expense_coffee',
      },
    ],
  },
  {
    name: '.numr suffix is optional',
    expr: 'x = file("daily.numr")',
    expected: 'x = 42',
    files: [
      {
        id: 'd',
        path: 'daily.numr',
        displayName: 'd',
        pinned: false,
        folderId: null,
        order: 0,
        content: 'result = 42',
      },
    ],
  },
  {
    name: 'subdirectory path',
    expr: 'x = file("daily/2026-09-07")',
    expected: 'x = 99',
    files: [
      {
        id: 'd',
        path: 'daily/2026-09-07.numr',
        displayName: 'd',
        pinned: false,
        folderId: null,
        order: 0,
        content: 'first = 99',
      },
    ],
  },
  {
    name: 'first export wins',
    expr: 'x = file("multi")',
    expected: 'x = 100',
    files: [
      {
        id: 'm',
        path: 'multi.numr',
        displayName: 'm',
        pinned: false,
        folderId: null,
        order: 0,
        content: '# comment\nfirst = 100\nsecond = 200',
      },
    ],
  },
  {
    name: 'unknown file is left as-is',
    expr: 'x = file("ghost")',
    expected: 'x = file("ghost")',
    files: [
      {
        id: 'kg',
        path: 'known.numr',
        displayName: 'Known',
        pinned: false,
        folderId: null,
        order: 0,
        content: 'first = 1',
      },
    ],
  },
  {
    name: 'single-quote style also works',
    expr: "x = file('daily')",
    expected: 'x = 7',
    files: [
      {
        id: 'd',
        path: 'daily.numr',
        displayName: 'd',
        pinned: false,
        folderId: null,
        order: 0,
        content: 'first = 7',
      },
    ],
  },
];

let failed = 0;
for (const c of cases) {
  const actual = resolveFileReferences(c.expr, c.files);
  const ok = actual === c.expected;
  if (!ok) {
    failed += 1;
    console.log(`✗ ${c.name}`);
    console.log(`    expected: ${c.expected}`);
    console.log(`    actual:   ${actual}`);
  } else {
    console.log(`✓ ${c.name}`);
  }
}

if (failed > 0) {
  console.log(`\n${failed}/${cases.length} cases failed`);
  process.exit(1);
} else {
  console.log(`\n${cases.length}/${cases.length} cases passed`);
}

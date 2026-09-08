/**
 * Round-trip test for the IndexedDB persistence layer
 * (web/src/lib/persistence.ts). Run with:
 *   node --import tsx --test web/src/lib/persistence.test.ts
 * or from the web workspace:
 *   npm run test:persistence
 *
 * Uses fake-indexeddb/auto so `indexedDB` is available in Node.
 * The DB connection (`dbPromise`) is a module-level singleton and is
 * reused across tests, so each test clears state (via afterEach) to
 * stay independent.
 *
 * Note: saveWorkspace ignores the snapshot files' `updatedAt` and stamps
 * every persisted row with `Date.now()` at save time (persistence.ts:140),
 * so tests that assert exact stored values freeze the clock with
 * `t.mock.method(Date, 'now', ...)`.
 */

import 'fake-indexeddb/auto';

import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { clearWorkspace, loadWorkspace, saveWorkspace } from './persistence';

/** PersistedFile and WorkspaceSnapshot aren't exported, so snapshots are
 * built as plain object literals via these small helpers. */
function file(
  id: string,
  path: string,
  displayName: string,
  pinned: boolean,
  content: string,
  updatedAt: number,
) {
  return { id, path, displayName, pinned, content, updatedAt };
}

function snapshot(files: ReturnType<typeof file>[], globalsContent: string) {
  return { files, globalsContent };
}

/** `saveWorkspace` restamps updatedAt to `Date.now()`, so a snapshot that
 * was saved while the clock read `at` comes back with `updatedAt === at`. */
function savedAs(files: ReturnType<typeof file>[], at: number) {
  return files.map((f) => ({ ...f, updatedAt: at }));
}

afterEach(async () => {
  await clearWorkspace();
});

test('round-trip: save then load returns the stored snapshot exactly', async (t) => {
  const savedAt = 1_752_000_111_222;
  t.mock.method(Date, 'now', () => savedAt);

  const snap = snapshot(
    [
      file('a', 'daily/2026-09-01.numr', 'Mon', false, 'x = 1\ny = 2', 111),
      file('b', 'daily/2026-09-02.numr', 'Tue', true, 'z = 3', 222),
    ],
    'rate = 0.25',
  );

  await saveWorkspace(snap);
  const loaded = await loadWorkspace();

  assert.ok(loaded, 'loadWorkspace should return a snapshot after a save');
  // Files come back exactly as stored (same fields, same order — the files
  // store keys by id and getAll() returns them in key order, which matches
  // the insertion order above). updatedAt is the save timestamp.
  assert.deepEqual(loaded.files, savedAs(snap.files, savedAt));
  assert.deepEqual(
    loaded.files.map((f) => f.id),
    ['a', 'b'],
  );
  assert.equal(loaded.globalsContent, snap.globalsContent);
});

test('first run (empty stores) returns null', async () => {
  await clearWorkspace();
  assert.equal(await loadWorkspace(), null);
});

test('save overwrites the previous snapshot entirely', async (t) => {
  await saveWorkspace(
    snapshot(
      [
        file('a', 'one.numr', 'One', false, 'a = 1', 1000),
        file('b', 'two.numr', 'Two', true, 'b = 2', 2000),
      ],
      'old globals',
    ),
  );

  const savedAtB = 1_752_000_333_444;
  t.mock.method(Date, 'now', () => savedAtB);
  const snapB = snapshot(
    [file('c', 'three.numr', 'Three', false, 'c = 3', 3000)],
    'new globals',
  );
  await saveWorkspace(snapB);

  const loaded = await loadWorkspace();
  assert.ok(loaded);
  // files store is cleared before each save (persistence.ts:147), so only
  // snapshot B's file survives and updatedAt is snapshot B's save timestamp.
  assert.deepEqual(loaded.files, savedAs(snapB.files, savedAtB));
  assert.equal(loaded.globalsContent, 'new globals');
});

test('clear removes everything', async () => {
  await saveWorkspace(
    snapshot([file('x', 'x.numr', 'X', true, 'x = 42', 1234)], 'globals'),
  );
  await clearWorkspace();
  assert.equal(await loadWorkspace(), null);
});

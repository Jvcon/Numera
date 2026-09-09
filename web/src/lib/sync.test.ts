/**
 * Unit tests for the pure three-way reconcile function used by the WebDAV
 * sync engine (web/src/lib/sync.ts). Run with:
 *   node --import tsx --test web/src/lib/sync.test.ts
 *
 * These tests deliberately exercise ONLY the pure `reconcile` function — no
 * network, no store, no crypto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { reconcile, type ReconcileInput, type ReconcileAction } from './sync';

/** Hash aliases: distinct strings = distinct plaintext content. */
const H = (n: number) => `sha256-${n}`;

function run(
  overrides: Partial<ReconcileInput> & Pick<ReconcileInput, 'local' | 'remote'>,
): ReconcileAction[] {
  return reconcile({
    prev: {},
    localEncryptionEnabled: false,
    remoteEncryptionEnabled: false,
    ...overrides,
  });
}

test('new local file (only local, no prev) -> push', () => {
  const actions = run({ local: [{ path: 'notes.numr', hash: H(1) }], remote: [] });
  assert.deepEqual(actions, [{ kind: 'push', path: 'notes.numr' }]);
});

test('new remote file (only remote, no prev) -> pull', () => {
  const actions = run({ local: [], remote: [{ path: 'budget-2026.numr', hash: H(1) }] });
  assert.deepEqual(actions, [{ kind: 'pull', path: 'budget-2026.numr' }]);
});

test('unchanged file (identical both sides + prev) -> skip', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(1) }],
    remote: [{ path: 'a.numr', hash: H(1) }],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'skip', path: 'a.numr' }]);
});

test('local-only change (remote matches prev) -> push', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(2) }],
    remote: [{ path: 'a.numr', hash: H(1) }],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'push', path: 'a.numr' }]);
});

test('remote-only change (local matches prev) -> pull', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(1) }],
    remote: [{ path: 'a.numr', hash: H(2) }],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'pull', path: 'a.numr' }]);
});

test('both sides changed with different content -> conflict', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(2) }],
    remote: [{ path: 'a.numr', hash: H(3) }],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'conflict', path: 'a.numr' }]);
});

test('both sides changed to the SAME content -> skip (converged)', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(2) }],
    remote: [{ path: 'a.numr', hash: H(2) }],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'skip', path: 'a.numr' }]);
});

test('local delete, remote unchanged, prev tracked -> deleteRemote', () => {
  const actions = run({
    local: [],
    remote: [{ path: 'a.numr', hash: H(1) }],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'deleteRemote', path: 'a.numr' }]);
});

test('remote delete, local unchanged, prev tracked -> deleteLocal', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(1) }],
    remote: [],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'deleteLocal', path: 'a.numr' }]);
});

test('both sides deleted since last sync (prev-only) -> no action', () => {
  const actions = run({
    local: [],
    remote: [],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, []);
});

test('local edited while remote deleted -> push (keep local work)', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(2) }],
    remote: [],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'push', path: 'a.numr' }]);
});

test('remote edited while local deleted -> pull (keep remote work)', () => {
  const actions = run({
    local: [],
    remote: [{ path: 'a.numr', hash: H(2) }],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
  });
  assert.deepEqual(actions, [{ kind: 'pull', path: 'a.numr' }]);
});

test('both appear since last sync with different content -> conflict', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(1) }],
    remote: [{ path: 'a.numr', hash: H(2) }],
  });
  assert.deepEqual(actions, [{ kind: 'conflict', path: 'a.numr' }]);
});

test('both appear since last sync with identical content -> skip', () => {
  const actions = run({
    local: [{ path: 'a.numr', hash: H(1) }],
    remote: [{ path: 'a.numr', hash: H(1) }],
  });
  assert.deepEqual(actions, [{ kind: 'skip', path: 'a.numr' }]);
});

test('encryption mismatch forces a push of every local path (no pulls)', () => {
  const actions = reconcile({
    // Local file is byte-identical to remote AND prev — normally a skip, but
    // a mismatch pass must re-encode and re-push it anyway.
    local: [
      { path: 'a.numr', hash: H(1) },
      { path: 'b.numr', hash: H(2) },
    ],
    remote: [{ path: 'a.numr', hash: H(1) }],
    prev: { 'a.numr': { localHash: H(1), remoteHash: H(1) } },
    localEncryptionEnabled: true,
    remoteEncryptionEnabled: false,
  });
  assert.deepEqual(actions, [
    { kind: 'push', path: 'a.numr' },
    { kind: 'push', path: 'b.numr' },
  ]);
});

test('encryption mismatch in the other direction also pushes every local path', () => {
  const actions = reconcile({
    local: [{ path: 'a.numr', hash: H(1) }],
    remote: [{ path: 'a.numr', hash: H(2) }],
    prev: {},
    localEncryptionEnabled: false,
    remoteEncryptionEnabled: true,
  });
  // Remote-only mismatch pass ignores even differing remote content: local is
  // the source of truth right after a toggle, so it must be a pure push.
  assert.deepEqual(actions, [{ kind: 'push', path: 'a.numr' }]);
});

test('defensive: both present, differ, prev matches neither side -> conflict', () => {
  // Corrupt/inconsistent prev (prev.local != prev.remote): neither side is
  // "the changed one", so preserve both copies.
  const actions = run({
    local: [{ path: 'a.numr', hash: H(2) }],
    remote: [{ path: 'a.numr', hash: H(3) }],
    prev: { 'a.numr': { localHash: H(9), remoteHash: H(8) } },
  });
  assert.deepEqual(actions, [{ kind: 'conflict', path: 'a.numr' }]);
});

test('deletion that happened before prev was recorded behaves like a fresh remote -> pull', () => {
  const actions = run({
    local: [],
    remote: [{ path: 'a.numr', hash: H(5) }],
    // no prev entry: cannot know it was ever synced
  });
  assert.deepEqual(actions, [{ kind: 'pull', path: 'a.numr' }]);
});

test('multiple files reconcile in deterministic path order and mix of kinds', () => {
  const actions = run({
    local: [
      { path: 'zeta.numr', hash: H(1) }, // local-only -> push
      { path: 'daily/2026-09-07.numr', hash: H(2) }, // both changed -> conflict
      { path: 'mid.numr', hash: H(1) }, // unchanged -> skip
    ],
    remote: [
      { path: 'aaa.numr', hash: H(7) }, // remote-only -> pull
      { path: 'daily/2026-09-07.numr', hash: H(3) },
      { path: 'mid.numr', hash: H(1) },
    ],
    prev: {
      'daily/2026-09-07.numr': { localHash: H(9), remoteHash: H(9) },
      'mid.numr': { localHash: H(1), remoteHash: H(1) },
    },
  });
  assert.deepEqual(actions, [
    { kind: 'pull', path: 'aaa.numr' },
    { kind: 'conflict', path: 'daily/2026-09-07.numr' },
    { kind: 'skip', path: 'mid.numr' },
    { kind: 'push', path: 'zeta.numr' },
  ]);
});

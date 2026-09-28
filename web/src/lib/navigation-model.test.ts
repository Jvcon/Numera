import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  type InteractionContract,
  type SizeClass,
  editingTarget,
  isInFileList,
  leadingAffordances,
  resolveBack,
  trailingActions,
} from './navigation-model.ts';

const contract = JSON.parse(
  readFileSync(new URL('../../../contracts/interaction.json', import.meta.url), 'utf8'),
) as InteractionContract;

const SIZE_CLASSES: SizeClass[] = ['compact', 'medium', 'expanded'];

test('invariant: leading slot exposes at most one affordance on every size class', () => {
  for (const sizeClass of SIZE_CLASSES) {
    const leading = leadingAffordances(contract, sizeClass);
    assert.ok(
      leading.length <= 1,
      `leading slot must hold ≤ 1 affordance on ${sizeClass}, got ${leading.length}`,
    );
  }
});

test('invariant: leading is menu on compact/medium and none on expanded', () => {
  assert.deepEqual(leadingAffordances(contract, 'compact'), ['menu']);
  assert.deepEqual(leadingAffordances(contract, 'medium'), ['menu']);
  assert.deepEqual(leadingAffordances(contract, 'expanded'), []);
});

test('invariant: globals and draft are non-list editing targets; file is a list member', () => {
  assert.equal(isInFileList(contract, 'file'), true);
  assert.equal(isInFileList(contract, 'globals'), false);
  assert.equal(isInFileList(contract, 'draft'), false);
});

test('invariant: non-list targets exit with exit-editing-target and expose a trailing X', () => {
  for (const id of ['globals', 'draft'] as const) {
    assert.equal(editingTarget(contract, id)?.exit, 'exit-editing-target');
    const trailing = trailingActions(contract, id);
    assert.ok(
      trailing.includes('exit-editing-target'),
      `${id} trailing actions must include exit-editing-target`,
    );
    assert.ok(
      !trailing.includes('up'),
      `${id} must not use an up/back action to exit`,
    );
  }
  assert.equal(contract.topBar.exitIcon, 'close');
});

test('invariant: file target trailing actions have no exit', () => {
  assert.deepEqual(trailingActions(contract, 'file'), ['new-draft', 'open-globals']);
});

test('back precedence: overlay beats drawer beats editing target beats root', () => {
  assert.equal(
    resolveBack(contract, { overlayOpen: true, drawerOpen: true, editingTarget: 'globals' }),
    'dismiss-overlay',
  );
  assert.equal(
    resolveBack(contract, { overlayOpen: false, drawerOpen: true, editingTarget: 'globals' }),
    'close-drawer',
  );
  assert.equal(
    resolveBack(contract, { overlayOpen: false, drawerOpen: false, editingTarget: 'globals' }),
    'exit-editing-target',
  );
  assert.equal(
    resolveBack(contract, { overlayOpen: false, drawerOpen: false, editingTarget: 'draft' }),
    'exit-editing-target',
  );
  assert.equal(
    resolveBack(contract, { overlayOpen: false, drawerOpen: false, editingTarget: 'file' }),
    'root-exit',
  );
});

test('command surface is named Command and never uses a forbidden synonym', () => {
  const command = contract.surfaces.find((s) => s.id === 'command');
  assert.ok(command, 'command surface must exist');
  assert.equal(command.label, 'Command');
  assert.ok(command.entry.includes('fab:command'));
  assert.ok(command.entry.includes('keybinding:cmd+k'));

  const forbidden = contract.forbiddenSynonyms.command ?? [];
  for (const surface of contract.surfaces) {
    assert.ok(
      !forbidden.includes(surface.id),
      `surface id "${surface.id}" is a forbidden synonym for command`,
    );
    if (surface.label) {
      assert.ok(
        !forbidden.includes(surface.label.toLowerCase()),
        `surface label "${surface.label}" is a forbidden synonym for command`,
      );
    }
  }
});

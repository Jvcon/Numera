/**
 * Platform-neutral navigation model (web side).
 *
 * A thin, pure projection over `contracts/interaction.json` — the machine
 * readable form of `docs/interaction-model.md`. This module owns no state and
 * imports no DOM; the conformance test feeds it the fixture and the UI reads
 * the same rules. Android has a mirror of this module
 * (`com.jvcon.numera.shell.InteractionContract`), so the two can be diffed
 * against one source.
 */

export type SizeClass = 'compact' | 'medium' | 'expanded';

export type EditingTargetId = 'file' | 'globals' | 'draft';

export interface EditingTargetSpec {
  id: EditingTargetId;
  title: string;
  inFileList: boolean;
  exit: string | null;
}

export interface SurfaceSpec {
  id: string;
  kind: 'destination' | 'overlay';
  status: 'active' | 'future' | 'dev-only';
  label?: string;
  entry: string[];
  exit: string;
}

export interface InteractionContract {
  version: number;
  sourceOfTruth: string;
  editingTargets: EditingTargetSpec[];
  surfaces: SurfaceSpec[];
  nonSurfaces: { id: string; kind: string }[];
  topBar: {
    invariant: string;
    leading: Record<SizeClass, string>;
    trailing: Record<EditingTargetId, string[]>;
    exitIcon: string;
  };
  backPrecedence: string[];
  bindings: Record<string, Record<string, string[]>>;
  forbiddenSynonyms: Record<string, string[]>;
}

/** The editing target a top-bar state is rendered for. */
export function editingTarget(
  contract: InteractionContract,
  id: EditingTargetId,
): EditingTargetSpec | undefined {
  return contract.editingTargets.find((t) => t.id === id);
}

/** Whether an editing target appears as a row in the file list. */
export function isInFileList(
  contract: InteractionContract,
  id: EditingTargetId,
): boolean {
  return editingTarget(contract, id)?.inFileList === true;
}

/**
 * The affordances resolved into the top-bar leading slot for a size class.
 *
 * The leading-slot exclusivity invariant (`topBar.invariant`) means this list
 * has length ≤ 1 on every size class.
 */
export function leadingAffordances(
  contract: InteractionContract,
  sizeClass: SizeClass,
): string[] {
  const value = contract.topBar.leading[sizeClass];
  return value && value !== 'none' ? [value] : [];
}

/** The trailing actions for an editing target, in order. */
export function trailingActions(
  contract: InteractionContract,
  id: EditingTargetId,
): string[] {
  return contract.topBar.trailing[id] ?? [];
}

export interface BackState {
  overlayOpen: boolean;
  drawerOpen: boolean;
  editingTarget: EditingTargetId;
}

/**
 * Resolve a back gesture against the contract's fixed precedence
 * (`dismiss-overlay → close-drawer → exit-editing-target → root-exit`).
 */
export function resolveBack(
  contract: InteractionContract,
  state: BackState,
): string {
  for (const action of contract.backPrecedence) {
    const applies =
      (action === 'dismiss-overlay' && state.overlayOpen) ||
      (action === 'close-drawer' && state.drawerOpen) ||
      (action === 'exit-editing-target' &&
        !isInFileList(contract, state.editingTarget)) ||
      action === 'root-exit';
    if (applies) return action;
  }
  return 'root-exit';
}

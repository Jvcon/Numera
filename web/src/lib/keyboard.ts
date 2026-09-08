export interface KeyInput {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export type Mode = 'Any' | 'Normal' | 'Insert' | 'Visual' | 'Command' | 'Standard';

export interface KeyEventDetail {
  input: KeyInput;
  mode: Mode;
  timestamp: number;
  raw: KeyboardEvent;
}

function buildKeyInput(event: KeyboardEvent): KeyInput {
  return {
    key: event.key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
}

function shouldIgnoreEvent(event: KeyboardEvent): boolean {
  // When typing in an editor we still want chorded shortcuts like Ctrl/Cmd+K.
  // We do not ignore here; the consumer decides whether to call preventDefault().
  if (event.key === 'Control' || event.key === 'Alt' || event.key === 'Shift' || event.key === 'Meta') {
    return true;
  }

  return false;
}

/**
 * Initializes a platform-agnostic keyboard bridge.
 *
 * Mirrors the future wasm-exposed `numera-command` KeyEvent shape so that this
 * scaffold can later be wired into `matcher.feed()` without changing consumers.
 *
 * @param target The window to listen on.
 * @param onKeyEvent Called for every relevant keydown.
 * @returns A cleanup function that removes listeners.
 */
export function initKeyboardBridge(
  target: Window,
  onKeyEvent: (detail: KeyEventDetail) => void,
  options: { mode?: Mode } = {},
): () => void {
  const mode = options.mode ?? 'Any';

  const handleKeyDown = (event: KeyboardEvent) => {
    if (shouldIgnoreEvent(event)) {
      return;
    }

    const input = buildKeyInput(event);
    const detail: KeyEventDetail = {
      input,
      mode,
      timestamp: Date.now(),
      raw: event,
    };

    onKeyEvent(detail);
  };

  // Capture phase so the bridge sees keys before any focused input swallows them.
  target.addEventListener('keydown', handleKeyDown, true);

  return () => {
    target.removeEventListener('keydown', handleKeyDown, true);
  };
}

export function formatKeyInput(input: KeyInput): string {
  const parts: string[] = [];
  if (input.ctrl) parts.push('Ctrl');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');
  if (input.meta) parts.push('Meta');
  if (input.key) parts.push(input.key);
  return parts.join('+');
}

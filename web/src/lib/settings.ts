/**
 * Numera settings — persisted user preferences.
 *
 * Follows the same localStorage + small functional-API pattern as
 * `./theme.ts`. Settings are stored as a single JSON document under
 * the `numera-settings` localStorage key and cached in a module-level
 * singleton. Every read and write is normalised against
 * `DEFAULT_SETTINGS`, so the active settings object always has a
 * complete, valid structure no matter how partial the stored payload
 * is.
 *
 * When `window` is unavailable (unit tests, SSR) localStorage is
 * never touched; an in-memory store stands in for it.
 */

export type Region = 'system' | 'en-US' | 'zh-CN';

export interface NumeraSettings {
  calculator: {
    math: {
      resultPrecisionEnabled: boolean; // default false
      precisionDigits: number; // default 2
      region: Region; // default 'system'
      showGroupingSeparators: boolean; // default false
    };
    editor: {
      fontSize: number; // px integer, default 14
      showLineNumbers: boolean; // default true
    };
  };
  sync: {
    webdav: {
      url: string; // default ''
      folder: string; // default ''
      username: string; // default ''
      password: string; // default ''
    };
  };
}

export const DEFAULT_SETTINGS: NumeraSettings = {
  calculator: {
    math: {
      resultPrecisionEnabled: false,
      precisionDigits: 2,
      region: 'system',
      showGroupingSeparators: false,
    },
    editor: {
      fontSize: 14,
      showLineNumbers: true,
    },
  },
  sync: {
    webdav: {
      url: '',
      folder: '',
      username: '',
      password: '',
    },
  },
};

const STORAGE_KEY = 'numera-settings';

const REGIONS: readonly Region[] = ['system', 'en-US', 'zh-CN'];

/** In-memory storage fallback used when `window`/localStorage is unavailable. */
let memoryStore: string | null = null;

/** Normalised settings cache; `null` until first load/save. */
let cachedSettings: NumeraSettings | null = null;

type SettingsListener = (settings: NumeraSettings) => void;

const listeners = new Set<SettingsListener>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asRegion(value: unknown, fallback: Region): Region {
  return typeof value === 'string' && (REGIONS as readonly string[]).includes(value)
    ? (value as Region)
    : fallback;
}

/** Non-negative integer usable by Intl; anything else falls back to 2. */
function asPrecisionDigits(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) {
    return Math.trunc(value);
  }
  return DEFAULT_SETTINGS.calculator.math.precisionDigits;
}

/** Finite, positive integer px size; anything else falls back to 14. */
function asFontSize(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  return DEFAULT_SETTINGS.calculator.editor.fontSize;
}

/**
 * Deep-normalise arbitrary (possibly partial / malformed) input into a
 * complete, valid `NumeraSettings`. Unknown or missing keys are
 * replaced by their defaults; known keys are validated and coerced.
 */
function normalizeSettings(input: unknown): NumeraSettings {
  const root = isRecord(input) ? input : {};
  const calculator = isRecord(root.calculator) ? root.calculator : {};
  const math = isRecord(calculator.math) ? calculator.math : {};
  const editor = isRecord(calculator.editor) ? calculator.editor : {};
  const sync = isRecord(root.sync) ? root.sync : {};
  const webdav = isRecord(sync.webdav) ? sync.webdav : {};

  return {
    calculator: {
      math: {
        resultPrecisionEnabled: asBoolean(
          math.resultPrecisionEnabled,
          DEFAULT_SETTINGS.calculator.math.resultPrecisionEnabled,
        ),
        precisionDigits: asPrecisionDigits(math.precisionDigits),
        region: asRegion(math.region, DEFAULT_SETTINGS.calculator.math.region),
        showGroupingSeparators: asBoolean(
          math.showGroupingSeparators,
          DEFAULT_SETTINGS.calculator.math.showGroupingSeparators,
        ),
      },
      editor: {
        fontSize: asFontSize(editor.fontSize),
        showLineNumbers: asBoolean(
          editor.showLineNumbers,
          DEFAULT_SETTINGS.calculator.editor.showLineNumbers,
        ),
      },
    },
    sync: {
      webdav: {
        url: asString(webdav.url, DEFAULT_SETTINGS.sync.webdav.url),
        folder: asString(webdav.folder, DEFAULT_SETTINGS.sync.webdav.folder),
        username: asString(webdav.username, DEFAULT_SETTINGS.sync.webdav.username),
        password: asString(webdav.password, DEFAULT_SETTINGS.sync.webdav.password),
      },
    },
  };
}

/** Raw string currently persisted in localStorage, or the memory store outside a browser. */
function readRaw(): string | null {
  if (typeof window !== 'undefined') {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // localStorage access can throw (sandboxed iframe / disabled storage).
      return null;
    }
  }
  return memoryStore;
}

/** Persist a raw JSON string, falling back to the in-memory store when storage is unavailable. */
function writeRaw(json: string): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // Storage full or unavailable — the in-memory cache still holds settings.
    }
    return;
  }
  memoryStore = json;
}

/** Read, parse and normalise the persisted settings (fresh from storage). */
export function loadSettings(): NumeraSettings {
  const raw = readRaw();
  let parsed: unknown = null;
  if (raw !== null) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null; // Corrupt payload — fall back to defaults below.
    }
  }
  const settings = normalizeSettings(parsed);
  cachedSettings = settings;
  return settings;
}

/** Return the cached settings, loading from storage on first access. */
export function getSettings(): NumeraSettings {
  if (cachedSettings === null) {
    cachedSettings = loadSettings();
  }
  return cachedSettings;
}

/** Normalise, persist and broadcast new settings to every subscriber. */
export function saveSettings(settings: NumeraSettings): void {
  const normalized = normalizeSettings(settings);
  cachedSettings = normalized;
  writeRaw(JSON.stringify(normalized));
  for (const listener of [...listeners]) {
    try {
      listener(normalized);
    } catch {
      // A throwing subscriber must not prevent the others from running.
    }
  }
}

/** Subscribe to setting changes; returns an unsubscribe function. */
export function subscribeSettings(listener: (settings: NumeraSettings) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

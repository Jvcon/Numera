/**
 * Live exchange rates — network fetch plus a localStorage cache.
 *
 * Data source: the free, key-less Open Exchange Rates endpoint
 * `https://open.er-api.com/v6/latest/USD`. It sends CORS headers, so the
 * browser can call it directly, and its `rates` object is already the
 * `currency code -> value relative to USD` map the WASM engine expects.
 *
 * Everything here is pure logic (no UI), so it can be unit-tested and
 * reused by the workspace store. Network access only happens when
 * `fetchExchangeRates()` is called; nothing in this module fetches on
 * import. All localStorage access is guarded with try/catch because
 * storage can be disabled (sandboxed iframes, private mode).
 */

const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';

const STORAGE_KEY = 'numera-exchange-rates';

/** How long a cached rate table is considered fresh. */
export const RATE_TTL_MS = 60 * 60 * 1000;

export interface CachedRates {
  rates: Record<string, number>;
  fetchedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A rates table is a flat object whose values are all finite numbers. */
function isRates(value: unknown): value is Record<string, number> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(
    (rate) => typeof rate === 'number' && Number.isFinite(rate),
  );
}

/**
 * Fetch the latest USD-based exchange rates. Throws on a non-OK HTTP
 * status or a malformed/unexpected payload.
 */
export async function fetchExchangeRates(): Promise<Record<string, number>> {
  const response = await fetch(ENDPOINT, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Exchange rate request failed (HTTP ${response.status})`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Exchange rate response was not valid JSON');
  }

  if (
    !isRecord(payload) ||
    payload.result !== 'success' ||
    !isRates(payload.rates)
  ) {
    throw new Error('Exchange rate response was malformed');
  }
  return payload.rates;
}

/**
 * Read the cached rates. Returns null when nothing is stored, the
 * payload cannot be parsed, or its fields are missing/invalid.
 */
export function getCachedRates(): CachedRates | null {
  if (typeof window === 'undefined') return null;

  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // localStorage access can throw (sandboxed iframe / disabled storage).
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // Corrupt payload — treat as absent.
  }

  if (
    !isRecord(parsed) ||
    typeof parsed.fetchedAt !== 'number' ||
    !Number.isFinite(parsed.fetchedAt) ||
    !isRates(parsed.rates)
  ) {
    return null;
  }
  return { rates: parsed.rates, fetchedAt: parsed.fetchedAt };
}

/** Persist a rate table together with the current timestamp. Best-effort. */
export function saveCachedRates(rates: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  const payload: CachedRates = { rates, fetchedAt: Date.now() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Storage full or unavailable — caching is best-effort.
  }
}

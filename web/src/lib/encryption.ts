/**
 * Numera encryption — end-to-end master-key keyring + crypto helpers.
 *
 * Owns the E2E master key and wraps the WASM crypto functions. The master
 * key is persisted (base64) under the `numera-encryption` localStorage key
 * together with a hex `SHA-256` verification hash. Recovery is via the
 * BIP39 mnemonic shown at setup time — the keyring itself is never meant
 * to be exported.
 *
 * When `window` is unavailable (unit tests, SSR) localStorage is never
 * touched; an in-memory store stands in for it (mirrors `./settings.ts`).
 *
 * The WASM module must be initialised (`await init()`) before any binding
 * is used; every async entry point awaits the same memoised promise first.
 */

import init, {
  generateMnemonic as wasmGenerateMnemonic,
  masterKeyFromMnemonic,
  deriveSpaceKey,
  encryptFile as wasmEncryptFile,
  decryptFile as wasmDecryptFile,
  isEncrypted as wasmIsEncrypted,
} from '../wasm/numera_wasm.js';

/** localStorage key holding the serialised keyring JSON document. */
const STORAGE_KEY = 'numera-encryption';

/** Space id used for every file encrypted through this service. */
const SPACE_ID = 'default';

/** Private shape of the persisted keyring. */
interface Keyring {
  /** base64 of the 32-byte master key. */
  masterKey: string;
  /** hex sha256 of the 32-byte master key. */
  keyVerifyHash: string;
}

/** In-memory storage fallback used when `window`/localStorage is unavailable. */
let memoryStore: string | null = null;

let initPromise: Promise<unknown> | null = null;

/** Await the WASM module exactly once; later callers share the same promise. */
async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init();
  }
  await initPromise;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/** Hex-encode bytes (lowercase). Used for the key-verification hash. */
function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/** Base64-encode bytes. Used for the persisted master key. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Decode a base64 string into bytes. */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Raw string currently persisted, or the memory store outside a browser. */
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

/** Persist a raw JSON string, falling back to the in-memory store. */
function writeRaw(json: string): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // Storage full or unavailable — the in-memory store still holds it.
    }
    return;
  }
  memoryStore = json;
}

/** Clear the persisted keyring. */
function clearRaw(): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable — nothing to clear beyond the memory store.
    }
    return;
  }
  memoryStore = null;
}

/** True when `value` is a plain object (not null/array). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read and validate the persisted keyring. Missing, malformed or
 * inconsistent payloads all read as `null` ("not configured").
 */
function readKeyring(): Keyring | null {
  const raw = readRaw();
  if (raw === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }
    const { masterKey, keyVerifyHash } = parsed;
    if (typeof masterKey !== 'string' || typeof keyVerifyHash !== 'string') {
      return null;
    }
    // The master key must be exactly 32 bytes; reject anything else so a
    // corrupted payload surfaces as "not configured" instead of a crypto
    // error later.
    if (base64ToBytes(masterKey).byteLength !== 32) {
      return null;
    }
    return { masterKey, keyVerifyHash };
  } catch {
    return null; // Corrupt payload.
  }
}

/** Derive the space key for `SPACE_ID` from a decoded master key. */
function spaceKey(masterKey: Uint8Array): Uint8Array {
  return deriveSpaceKey(masterKey, SPACE_ID);
}

/** Compute the hex SHA-256 verification hash of the master key. */
async function keyVerifyHashOf(masterKey: Uint8Array): Promise<string> {
  // Copy into a plain `ArrayBuffer`-backed view: `subtle.digest`'s
  // `BufferSource` typing (newer TS) rejects `ArrayBufferLike`-backed views.
  const copy = new Uint8Array(masterKey);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return bytesToHex(new Uint8Array(digest));
}

/** Persist `masterKey` (as base64) plus its hex verification hash. */
async function persistKeyring(masterKey: Uint8Array): Promise<string> {
  const keyVerifyHash = await keyVerifyHashOf(masterKey);
  const keyring: Keyring = { masterKey: bytesToBase64(masterKey), keyVerifyHash };
  writeRaw(JSON.stringify(keyring));
  return keyVerifyHash;
}

/** Whether a keyring is currently stored (missing/malformed counts as no). */
export async function isEncryptionConfigured(): Promise<boolean> {
  await ensureInit();
  return readKeyring() !== null;
}

/**
 * Generate a fresh 12-word BIP39 mnemonic. This does NOT persist anything —
 * the caller is expected to show the phrase, confirm the user saved it, and
 * only then call `applyMnemonic` to persist the derived key.
 */
export async function generateMnemonic(): Promise<string> {
  await ensureInit();
  return wasmGenerateMnemonic().trim();
}

/**
 * Derive the master key from a mnemonic and persist the keyring. Throws when
 * the mnemonic is invalid. Used both for fresh setup (after the user confirms
 * the backup) and for restoring a keyring from a saved phrase.
 */
export async function applyMnemonic(mnemonic: string): Promise<void> {
  await ensureInit();
  let masterKey: Uint8Array;
  try {
    masterKey = masterKeyFromMnemonic(mnemonic.trim());
  } catch (error) {
    throw new Error(
      `Invalid mnemonic: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  await persistKeyring(masterKey);
}

/** Clear the keyring (local data stays on disk; remote data stays remote). */
export async function resetEncryption(): Promise<void> {
  await ensureInit();
  clearRaw();
}

/**
 * Encrypt UTF-8 `text` for `path` under the `'default'` space. Requires a
 * configured keyring.
 */
export async function encryptFile(path: string, text: string): Promise<Uint8Array> {
  await ensureInit();
  const keyring = readKeyring();
  if (keyring === null) {
    throw new Error('Encryption is not configured');
  }
  const masterKey = base64ToBytes(keyring.masterKey);
  return wasmEncryptFile(spaceKey(masterKey), path, textEncoder.encode(text));
}

/**
 * Decrypt `bytes` previously encrypted for `path` under the `'default'`
 * space and decode the result as UTF-8. Requires a configured keyring.
 * Throws on the wrong key or tampered data.
 */
export async function decryptFile(path: string, bytes: Uint8Array): Promise<string> {
  await ensureInit();
  const keyring = readKeyring();
  if (keyring === null) {
    throw new Error('Encryption is not configured');
  }
  const masterKey = base64ToBytes(keyring.masterKey);
  const plaintext = wasmDecryptFile(spaceKey(masterKey), path, bytes);
  return textDecoder.decode(plaintext);
}

/**
 * Check whether `bytes` carries the encrypted-file magic bytes. The only
 * synchronous export: the WASM module must already be initialised (any
 * other call into this module or `./webdav.ts` performs that init).
 */
export function isEncrypted(bytes: Uint8Array): boolean {
  return wasmIsEncrypted(bytes);
}

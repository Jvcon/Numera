/**
 * Numera WebDAV sync engine.
 *
 * Remote layout under the configured WebDAV folder:
 *   - `manifest.json` — `{ version: 1, encryption: { enabled }, files: { path:
 *     { display_name, pinned, encrypted } } }` (path keys are workspace paths
 *     such as "daily/2026-09-07.numr")
 *   - `globals.numr`  — the globals document (encrypted when enabled)
 *   - `files/<path>`  — one resource per workspace file
 *
 * Change detection is a three-way merge against the previous sync state
 * (`localStorage["numera-sync-state"]`), which records the SHA-256 hex of the
 * PLAINTEXT content of every file that was in sync after the last run, keyed
 * by path. Because hashes are computed over plaintext, hashing a remote file
 * requires decrypting it first (which this module does while reading).
 *
 * The reconciliation itself is a standalone pure function (`reconcile`) so it
 * can be unit-tested without any network/storage access.
 */

import { WebDavClient } from './webdav';
import {
  isEncryptionConfigured,
  encryptFile,
  decryptFile,
  isEncrypted,
} from './encryption';
import type { WorkspaceStore } from './workspace';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SyncResult {
  /** Files uploaded. */
  pushed: number;
  /** Files downloaded (content pulled from remote into the workspace). */
  pulled: number;
  /** Files with both-sides changes (a local-side copy was kept and a remote
   *  copy was written to `<path>.conflict`). */
  conflicts: number;
  /** Files deleted — either a local deletion propagated to the remote, or a
   *  remote deletion applied locally. */
  deleted: number;
  /** Files left untouched (identical on both sides). */
  skipped: number;
}

export interface SyncProgress {
  phase: 'reading' | 'planning' | 'uploading' | 'downloading' | 'applying' | 'done' | 'error';
  message: string;
  error?: string;
}

/** Run a full bidirectional sync against the configured WebDAV folder.
 *
 * Progress is reported through `onProgress`; phases follow the algorithm in
 * order: reading local state, downloading remote state, planning (reconcile),
 * uploading (pushes + remote deletes + conflict pushes), applying (manifest /
 * globals writes + local apply + flush + sync-state persist), done.
 *
 * On failure the error is reported via `onProgress({ phase: 'error', ... })`
 * and then rethrown — `runSync` never returns a partial result.
 */
export async function runSync(
  store: WorkspaceStore,
  config: { url: string; folder: string; username: string; password: string },
  onProgress?: (p: SyncProgress) => void,
): Promise<SyncResult> {
  const report = (phase: SyncProgress['phase'], message: string, error?: string) =>
    onProgress?.({ phase, message, error });

  try {
    report('reading', 'Reading local workspace');

    // -- Step 1: local ----------------------------------------------------
    const localEncryptionEnabled = await isEncryptionConfigured();
    const localState = store.getState();
    // Drafts are ephemeral scratch files and are never synced.
    const localFiles = new Map<
      string,
      { content: string; displayName: string; pinned: boolean }
    >();
    for (const f of localState.files) {
      if (f.draft) continue;
      if (!localFiles.has(f.path)) {
        localFiles.set(f.path, {
          content: f.content,
          displayName: f.displayName,
          pinned: f.pinned,
        });
      }
    }
    const globalsContent = localState.globalsContent;

    // -- Step 2: remote ---------------------------------------------------
    const client = new WebDavClient(config);

    // Ensure the "files" collection exists. MKCOL on an existing collection is
    // answered with 405 by most servers and is treated as success by the Rust
    // client; swallow any "already exists" flavour just in case.
    try {
      await client.createDirectory('files');
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err;
    }

    report('downloading', 'Downloading remote files');

    let manifest: RemoteManifest | null = null;
    try {
      const bytes = await client.getFile('manifest.json');
      manifest = parseManifest(decodeUtf8(bytes));
    } catch (err) {
      if (!isFileNotFoundError(err)) throw err; // 404 => remote is empty
    }

    const remoteEncryptionEnabled = manifest?.encryption.enabled ?? false;

    let remoteGlobalsPlaintext = '';
    try {
      const bytes = await client.getFile('globals.numr');
      remoteGlobalsPlaintext = await remoteBytesToPlaintext(
        GLOBALS_PATH,
        bytes,
        localEncryptionEnabled,
      );
    } catch (err) {
      if (!isFileNotFoundError(err)) throw err; // 404 => no remote globals yet
    }

    // path -> { plaintext, meta }. Only files listed in the manifest are
    // authoritative remote content.
    const remoteFiles = new Map<
      string,
      { plaintext: string; meta: RemoteFileMeta | undefined }
    >();
    if (manifest) {
      for (const [path, meta] of Object.entries(manifest.files)) {
        let bytes: Uint8Array;
        try {
          bytes = await client.getFile(`${FILES_PREFIX}/${path}`);
        } catch (err) {
          if (isFileNotFoundError(err)) continue; // listed but gone — skip
          throw err;
        }
        const plaintext = await remoteBytesToPlaintext(
          path,
          bytes,
          localEncryptionEnabled,
        );
        remoteFiles.set(path, { plaintext, meta });
      }
    }

    report('planning', 'Comparing local and remote changes');

    // -- Hashing (plaintext, async WebCrypto SHA-256) ---------------------
    const localHashes = new Map<string, string>();
    for (const [path, f] of localFiles) {
      localHashes.set(path, await sha256HexOfText(f.content));
    }
    const remoteHashes = new Map<string, string>();
    for (const [path, rf] of remoteFiles) {
      remoteHashes.set(path, await sha256HexOfText(rf.plaintext));
    }
    const localGlobalsHash = await sha256HexOfText(globalsContent);
    const remoteGlobalsHash = await sha256HexOfText(remoteGlobalsPlaintext);

    const prevSyncState = readSyncState();

    // -- Step 3: reconcile ------------------------------------------------
    const plan = reconcile({
      local: [...localHashes].map(([path, hash]) => ({ path, hash })),
      remote: [...remoteHashes].map(([path, hash]) => ({ path, hash })),
      prev: prevSyncState.files,
      localEncryptionEnabled,
      remoteEncryptionEnabled,
    });

    // -- Step 4: execute ---------------------------------------------------
    const result: SyncResult = { pushed: 0, pulled: 0, conflicts: 0, deleted: 0, skipped: 0 };

    const deleteRemotePaths: string[] = [];
    const deleteLocalPaths: string[] = [];
    const pulls: Array<{ path: string; existingLocal: boolean }> = [];
    const conflictCopies: Array<{ path: string; content: string }> = [];

    // Partition actions into remote writes, remote deletes and local applies.
    const reportUpload = () =>
      report('uploading', `Uploading ${result.pushed} file(s)`);

    for (const action of plan) {
      switch (action.kind) {
        case 'push':
          reportUpload();
          await ensureRemoteDirs(client, `${FILES_PREFIX}/${action.path}`);
          await client.putFile(
            `${FILES_PREFIX}/${action.path}`,
            await localTextToRemoteBytes(
              action.path,
              localFiles.get(action.path)!.content,
              localEncryptionEnabled,
            ),
          );
          result.pushed += 1;
          break;
        case 'pull':
          pulls.push({ path: action.path, existingLocal: localFiles.has(action.path) });
          result.pulled += 1;
          break;
        case 'deleteRemote':
          deleteRemotePaths.push(action.path);
          result.deleted += 1;
          break;
        case 'deleteLocal':
          deleteLocalPaths.push(action.path);
          result.deleted += 1;
          break;
        case 'conflict': {
          const localFile = localFiles.get(action.path);
          if (!localFile) {
            // Cannot happen for a well-formed plan (conflict requires the path
            // on both sides), but be defensive: fall back to pulling.
            pulls.push({ path: action.path, existingLocal: false });
            result.pulled += 1;
            break;
          }
          reportUpload();
          await ensureRemoteDirs(client, `${FILES_PREFIX}/${action.path}`);
          await client.putFile(
            `${FILES_PREFIX}/${action.path}`,
            await localTextToRemoteBytes(
              action.path,
              localFile.content,
              localEncryptionEnabled,
            ),
          );
          const remotePlain = remoteFiles.get(action.path)?.plaintext;
          if (remotePlain !== undefined) {
            // Preserve the remote version as a normal (local, plaintext) file;
            // it is pushed on the next sync like any other new local file.
            conflictCopies.push({
              path: conflictPathFor(action.path),
              content: remotePlain,
            });
          }
          result.conflicts += 1;
          break;
        }
        case 'skip':
          result.skipped += 1;
          break;
      }
    }

    // Remote deletions (a local deletion propagated to the server).
    if (deleteRemotePaths.length > 0) {
      report('uploading', `Deleting ${deleteRemotePaths.length} remote file(s)`);
      for (const path of deleteRemotePaths) {
        try {
          await client.deleteFile(`${FILES_PREFIX}/${path}`);
        } catch (err) {
          if (!isFileNotFoundError(err)) throw err;
        }
      }
    }

    report('applying', 'Applying changes');

    // -- Step 5: write manifest + globals ---------------------------------
    // Files that remain on the remote after reconciliation are exactly the
    // files that will exist locally after step 6 (each push/conflict keeps the
    // local file and overwrote the remote copy, each pull/skip keeps a local
    // file with identical content to the remote), PLUS any remote-only files
    // that were intentionally left alone (only possible during an encryption
    // mismatch pass, where we never pull). Project that set for the manifest.
    const deletedLocalSet = new Set(deleteLocalPaths);
    const manifestFiles = new Map<
      string,
      { display_name: string; pinned: boolean; encrypted: boolean }
    >();
    for (const [path, local] of localFiles) {
      if (deletedLocalSet.has(path)) continue; // remote deleted it -> gone
      manifestFiles.set(path, {
        display_name: local.displayName,
        pinned: local.pinned,
        encrypted: localEncryptionEnabled,
      });
    }
    for (const p of pulls) {
      const remotePlain = remoteFiles.get(p.path)?.plaintext;
      if (remotePlain === undefined) continue;
      if (manifestFiles.has(p.path)) {
        // Content updated in place — local metadata stays authoritative.
        manifestFiles.set(p.path, {
          ...manifestFiles.get(p.path)!,
          display_name:
            manifestFiles.get(p.path)!.display_name ||
            remoteMetaDisplayName(remoteFiles.get(p.path)?.meta, p.path),
          encrypted: manifestFiles.get(p.path)!.encrypted,
        });
      } else {
        const meta = remoteFiles.get(p.path)?.meta;
        manifestFiles.set(p.path, {
          display_name: remoteMetaDisplayName(meta, p.path),
          pinned: meta?.pinned ?? false,
          encrypted: localEncryptionEnabled,
        });
      }
    }
    // Note: conflict copies are NOT added to the manifest — they only exist
    // locally this run and are pushed (and then manifest-listed) next sync.
    // Merge in remote-only files that survived untouched (only possible during
    // an encryption-mismatch pass, where we never pull). Their bytes were not
    // rewritten, so their `encrypted` flag must keep describing the bytes that
    // are actually on the server. Files that got an action this run (deleted /
    // pulled / pushed) or that no longer exist on the server are not re-added.
    const actionPaths = new Set(plan.map((a) => a.path));
    if (manifest) {
      for (const [path, meta] of Object.entries(manifest.files)) {
        if (manifestFiles.has(path)) continue;
        if (actionPaths.has(path)) continue;
        if (!remoteFiles.has(path)) continue; // listed in manifest but gone
        manifestFiles.set(path, {
          display_name: meta.display_name || displayNameForPath(path),
          pinned: meta.pinned ?? false,
          encrypted: meta.encrypted ?? false,
        });
      }
    }

    const nextManifest: RemoteManifest = {
      version: 1,
      encryption: { enabled: localEncryptionEnabled },
      files: Object.fromEntries(manifestFiles),
    };
    await client.putFile('manifest.json', encodeUtf8(JSON.stringify(nextManifest)));

    // Globals: local content is authoritative. Re-upload when it differs from
    // the remote copy OR the wire encoding changed (encryption toggle).
    const globalsNeedPush =
      localGlobalsHash !== remoteGlobalsHash ||
      localEncryptionEnabled !== remoteEncryptionEnabled;
    if (globalsNeedPush) {
      await client.putFile(
        GLOBALS_PATH,
        await localTextToRemoteBytes(
          GLOBALS_PATH,
          globalsContent,
          localEncryptionEnabled,
        ),
      );
    }

    // -- Step 6: apply local changes ---------------------------------------
    const upserts: Array<{
      path: string;
      content: string;
      displayName?: string;
      pinned?: boolean;
    }> = [];
    for (const p of pulls) {
      const remotePlain = remoteFiles.get(p.path)?.plaintext;
      if (remotePlain === undefined) continue;
      const upsert: (typeof upserts)[number] = { path: p.path, content: remotePlain };
      if (!p.existingLocal) {
        const meta = remoteFiles.get(p.path)?.meta;
        upsert.displayName = remoteMetaDisplayName(meta, p.path);
        upsert.pinned = meta?.pinned ?? false;
      }
      upserts.push(upsert);
    }
    for (const c of conflictCopies) {
      upserts.push({ path: c.path, content: c.content });
    }

    store.applyRemoteChanges({
      upsert: upserts,
      deletePaths: deleteLocalPaths,
      ...(globalsNeedPush ? { globalsContent } : {}),
    });
    store.flush();

    // -- Step 7: persist the reconciled sync state -------------------------
    const nextState: SyncState = { files: {} };
    for (const action of plan) {
      let hash: string | undefined;
      switch (action.kind) {
        case 'push':
        case 'conflict':
          hash = localHashes.get(action.path);
          break;
        case 'pull':
          hash = remoteHashes.get(action.path);
          break;
        case 'skip':
          hash = localHashes.get(action.path) ?? remoteHashes.get(action.path);
          break;
        default:
          hash = undefined; // deleteLocal/deleteRemote/tombstone -> dropped
          break;
      }
      if (hash !== undefined) {
        nextState.files[action.path] = { localHash: hash, remoteHash: hash };
      }
    }
    // Note: conflict copies and encryption-mismatch remote-only files are not
    // recorded — the copies are local-only (and will be pushed on the next
    // run), and untouched remote-only files were never reconciled.
    writeSyncState(nextState);

    report('done', 'Sync complete');
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    report('error', message, message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Three-way reconciliation (PURE — no network, no storage)
// ---------------------------------------------------------------------------

export interface ReconcileInput {
  local: Array<{ path: string; hash: string }>;
  remote: Array<{ path: string; hash: string }>;
  prev: Record<string, { localHash: string; remoteHash: string }>;
  localEncryptionEnabled: boolean;
  remoteEncryptionEnabled: boolean;
}

export type ReconcileAction =
  | { kind: 'push'; path: string }
  | { kind: 'pull'; path: string }
  | { kind: 'deleteRemote'; path: string }
  | { kind: 'deleteLocal'; path: string }
  | { kind: 'conflict'; path: string }
  | { kind: 'skip'; path: string };

/**
 * Pure three-way reconcile. For every path in union(local, remote, prev)
 * emits the action that keeps both copies safe. See the branch table below.
 *
 * Branch table (L/R/K = present locally / remotely / in prev; all hashes are
 * PLAINTEXT SHA-256):
 *
 *   Encryption mismatch (local != remote enabled):
 *     - path in local  -> push        (re-encode & re-push everything; local is
 *                                      the source of truth right after a toggle)
 *     - otherwise      -> (none)      (never pull during a toggle pass)
 *
 *   Encryption states match:
 *     K && !L && !R            -> (none)       both deleted since last sync
 *     L && !R && !K            -> push         new local file
 *     L && !R && K             -> push         local edited while remote deleted
 *                                              (data-preserving: restore local)
 *     L && !R && K, lh==prevL  -> deleteLocal  remote deleted it, local
 *                                              unchanged -> honour deletion
 *     R && !L && !K            -> pull         new remote file
 *     R && !L && K             -> pull         remote edited while local deleted
 *                                              (data-preserving: remote wins)
 *     R && !L && K, rh==prevR  -> deleteRemote local deleted it, remote
 *                                              unchanged -> propagate deletion
 *     L && R,  lh === rh       -> skip         identical, nothing to do
 *     L && R,  !K              -> conflict     both appeared since last sync
 *     L && R,  lh!=prevL && rh!=prevR -> conflict  both sides changed
 *     L && R,  lh!=prevL       -> push         local changed only
 *     L && R,  rh!=prevR       -> pull         remote changed only
 *     L && R,  otherwise       -> conflict     differ but neither side reports
 *                                              a change -> preserve both copies
 */
export function reconcile(input: ReconcileInput): ReconcileAction[] {
  const localMap = new Map<string, string>();
  for (const f of input.local) localMap.set(f.path, f.hash);
  const remoteMap = new Map<string, string>();
  for (const f of input.remote) remoteMap.set(f.path, f.hash);

  const paths = new Set<string>([
    ...localMap.keys(),
    ...remoteMap.keys(),
    ...Object.keys(input.prev),
  ]);
  const sortedPaths = [...paths].sort();

  const actions: ReconcileAction[] = [];
  const encryptionMismatch =
    input.localEncryptionEnabled !== input.remoteEncryptionEnabled;

  for (const path of sortedPaths) {
    const lh = localMap.get(path);
    const rh = remoteMap.get(path);
    const prev = input.prev[path];
    const inLocal = lh !== undefined;
    const inRemote = rh !== undefined;

    if (encryptionMismatch) {
      // Skip conflict detection entirely this pass: re-encode and re-push
      // every local file; never pull.
      if (inLocal) actions.push({ kind: 'push', path });
      continue;
    }

    if (inLocal && inRemote) {
      if (lh === rh) {
        actions.push({ kind: 'skip', path });
      } else if (!prev) {
        // Both appeared since the last sync with different content.
        actions.push({ kind: 'conflict', path });
      } else if (lh !== prev.localHash && rh !== prev.remoteHash) {
        actions.push({ kind: 'conflict', path });
      } else if (lh !== prev.localHash) {
        actions.push({ kind: 'push', path });
      } else if (rh !== prev.remoteHash) {
        actions.push({ kind: 'pull', path });
      } else {
        // Defensive: recorded prev says neither side moved, yet the hashes
        // differ — preserve both copies rather than silently dropping one.
        actions.push({ kind: 'conflict', path });
      }
    } else if (inLocal) {
      // Remote side no longer has it.
      if (!prev) {
        actions.push({ kind: 'push', path });
      } else if (lh === prev.localHash) {
        // Remote deleted it and local content never changed: honour the
        // deletion instead of resurrecting a stale copy.
        actions.push({ kind: 'deleteLocal', path });
      } else {
        // Local was edited while remote deleted it: keep the local work and
        // restore it to the remote.
        actions.push({ kind: 'push', path });
      }
    } else if (inRemote) {
      // Local side no longer has it.
      if (!prev) {
        actions.push({ kind: 'pull', path });
      } else if (rh === prev.remoteHash) {
        // Local deleted it and remote content never changed: propagate the
        // deletion to the remote.
        actions.push({ kind: 'deleteRemote', path });
      } else {
        // Remote was edited while local deleted it: keep the remote work and
        // restore it locally (never silently drop the edited copy).
        actions.push({ kind: 'pull', path });
      }
    }
    // else: prev-only tombstone (both deleted) -> no action, drop from state.
  }

  return actions;
}

// ---------------------------------------------------------------------------
// Remote storage format helpers
// ---------------------------------------------------------------------------

const GLOBALS_PATH = 'globals.numr';
const FILES_PREFIX = 'files';

interface RemoteFileMeta {
  display_name?: string;
  pinned?: boolean;
  encrypted?: boolean;
}

interface RemoteManifest {
  version: number;
  encryption: { enabled: boolean };
  files: Record<string, RemoteFileMeta>;
}

/** Lenient manifest parser (remote manifests may carry extra fields). */
function parseManifest(json: string): RemoteManifest | null {
  const parsed: unknown = JSON.parse(json);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('manifest.json has an unexpected shape');
  }
  const root = parsed as Record<string, unknown>;
  const encryptionRaw = root.encryption;
  const encryption =
    typeof encryptionRaw === 'object' && encryptionRaw !== null
      ? { enabled: Boolean((encryptionRaw as { enabled?: unknown }).enabled) }
      : { enabled: false };
  const filesRaw = root.files;
  const files: Record<string, RemoteFileMeta> = {};
  if (typeof filesRaw === 'object' && filesRaw !== null && !Array.isArray(filesRaw)) {
    for (const [path, metaRaw] of Object.entries(filesRaw)) {
      if (typeof metaRaw !== 'object' || metaRaw === null) continue;
      const meta = metaRaw as Record<string, unknown>;
      files[path] = {
        display_name:
          typeof meta.display_name === 'string' ? meta.display_name : undefined,
        pinned: typeof meta.pinned === 'boolean' ? meta.pinned : undefined,
        encrypted: typeof meta.encrypted === 'boolean' ? meta.encrypted : undefined,
      };
    }
  }
  return { version: 1, encryption, files };
}

/** "<dir>/budget-2026.numr" -> "<dir>/budget-2026.conflict.numr". */
function conflictPathFor(path: string): string {
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
  const base = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
  const stem = base.replace(/\.numr$/, '');
  return `${folder}${stem}.conflict.numr`;
}

/** Default display name for a workspace path (mirrors createFile). */
function displayNameForPath(path: string): string {
  const base = path.split('/').filter(Boolean).pop() ?? path;
  return base.replace(/\.numr$/, '');
}

function remoteMetaDisplayName(meta: RemoteFileMeta | undefined, path: string): string {
  if (meta?.display_name) return meta.display_name;
  return displayNameForPath(path);
}

// ---------------------------------------------------------------------------
// Crypto / encoding helpers
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const ENCRYPTED_NO_KEY_ERROR =
  'Encrypted files exist but no encryption key is set up on this device.';

function encodeUtf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/** Hex-encode a SHA-256 digest. */
function digestToHex(digest: ArrayBuffer): string {
  let hex = '';
  for (const byte of new Uint8Array(digest)) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

async function sha256HexOfBytes(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh Uint8Array: subtle.digest's BufferSource typing rejects
  // ArrayBufferLike-backed views (mirrors ./encryption.ts).
  const copy = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return digestToHex(digest);
}

async function sha256HexOfText(text: string): Promise<string> {
  return sha256HexOfBytes(encodeUtf8(text));
}

/** Remote bytes -> plaintext, decrypting when the magic bytes say so. */
async function remoteBytesToPlaintext(
  path: string,
  bytes: Uint8Array,
  localEncryptionEnabled: boolean,
): Promise<string> {
  if (!isEncrypted(bytes)) return decodeUtf8(bytes);
  if (!localEncryptionEnabled) {
    throw new Error(ENCRYPTED_NO_KEY_ERROR);
  }
  return decryptFile(path, bytes);
}

/** Local plaintext -> wire bytes (encrypted when encryption is enabled). */
async function localTextToRemoteBytes(
  path: string,
  text: string,
  localEncryptionEnabled: boolean,
): Promise<Uint8Array> {
  if (!localEncryptionEnabled) return encodeUtf8(text);
  return encryptFile(path, text);
}

// ---------------------------------------------------------------------------
// Error classification (errors surface from the WASM client as Error objects
// whose message is the Rust error Display string)
// ---------------------------------------------------------------------------

/** True when the thrown value is the WebDAV "File not found: <path>" error. */
function isFileNotFoundError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /file not found/i.test(message) || /HTTP error: 404/i.test(message);
}

/** True when a MKCOL failed only because the collection already exists. */
function isAlreadyExistsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return (
    /405/i.test(message) ||
    /method not allowed/i.test(message) ||
    /already exists/i.test(message) ||
    /file not found/i.test(message)
  );
}

/** Ensure the WebDAV collections above `relFilePath` exist (e.g. pushing
 *  `files/daily/x.numr` also creates `files/daily`). `relFilePath` must be
 *  under `files/`. */
async function ensureRemoteDirs(client: WebDavClient, relFilePath: string): Promise<void> {
  const segments = relFilePath.split('/');
  // e.g. ["files", "daily", "x.numr"]: parent dirs are "files" and "files/daily".
  if (segments.length <= 2) return;
  let dir = segments[0];
  for (let i = 1; i < segments.length - 1; i++) {
    dir = `${dir}/${segments[i]}`;
    try {
      await client.createDirectory(dir);
    } catch (err) {
      if (!isAlreadyExistsError(err)) throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Sync-state persistence (localStorage with in-memory fallback)
// ---------------------------------------------------------------------------

const SYNC_STATE_KEY = 'numera-sync-state';

export interface SyncState {
  files: Record<string, { localHash: string; remoteHash: string }>;
}

/** In-memory fallback used when `window`/localStorage is unavailable. */
let memorySyncState: string | null = null;

function readSyncStateRaw(): string | null {
  if (typeof window !== 'undefined') {
    try {
      return window.localStorage.getItem(SYNC_STATE_KEY);
    } catch {
      return null;
    }
  }
  return memorySyncState;
}

function writeSyncStateRaw(json: string): void {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SYNC_STATE_KEY, json);
    } catch {
      // Storage unavailable — in-memory copy still applies for this session.
    }
    return;
  }
  memorySyncState = json;
}

function readSyncState(): SyncState {
  const raw = readSyncStateRaw();
  if (raw === null) return { files: {} };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { files: {} };
    const filesRaw = (parsed as { files?: unknown }).files;
    const files: SyncState['files'] = {};
    if (typeof filesRaw === 'object' && filesRaw !== null && !Array.isArray(filesRaw)) {
      for (const [path, entry] of Object.entries(filesRaw)) {
        const e = entry as { localHash?: unknown; remoteHash?: unknown };
        if (
          typeof e === 'object' &&
          e !== null &&
          typeof e.localHash === 'string' &&
          typeof e.remoteHash === 'string'
        ) {
          files[path] = { localHash: e.localHash, remoteHash: e.remoteHash };
        }
      }
    }
    return { files };
  } catch {
    return { files: {} };
  }
}

function writeSyncState(state: SyncState): void {
  writeSyncStateRaw(JSON.stringify(state));
}

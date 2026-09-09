/**
 * Numera WebDAV — thin typed adapter over the WASM `WasmDavClient`.
 *
 * This module owns NO storage. A `WebDavClient` is constructed from a
 * `WebDavConfig` (url + auth + remote folder prefix) and lazily wraps a
 * single `WasmDavClient` instance on first use.
 *
 * Every file operation takes a path *relative to the configured folder*;
 * the folder prefix is applied internally, so callers never prepend it.
 */

import init, { WasmDavClient as RawWasmDavClient } from '../wasm/numera_wasm.js';

/** Remote configuration used to construct a `WebDavClient`. */
export interface WebDavConfig {
  /** e.g. "https://dav.example.com/remote.php/dav" */
  url: string;
  /** e.g. "numera" or "numera/sub" (relative to `url`). */
  folder: string;
  username: string;
  password: string;
}

/** A single entry returned from a `listFiles` PROPFIND listing. */
export interface DavEntry {
  href: string;
  etag: string | null;
  contentLength: number | null;
  isCollection: boolean;
}

/** Outcome of `checkConnection()`; `ok: false` carries an error string. */
export interface ConnectionResult {
  ok: boolean;
  error?: string;
}

/** Raw (unvalidated) entry shape as produced by the WASM `listFiles`. */
interface RawDavEntry {
  href?: unknown;
  etag?: unknown;
  contentLength?: unknown;
  isCollection?: unknown;
}

let initPromise: Promise<unknown> | null = null;

/** Await the WASM module exactly once; later callers share the same promise. */
async function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = init();
  }
  await initPromise;
}

/** Strip leading and trailing slashes from `value`. */
function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

export class WebDavClient {
  private readonly baseUrl: string;
  private readonly folder: string;
  private readonly username: string | null;
  private readonly password: string | null;
  private client: RawWasmDavClient | null = null;

  constructor(config: WebDavConfig) {
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.folder = trimSlashes(config.folder);
    // Empty credentials disable Basic auth entirely in the Rust client.
    this.username = config.username === '' ? null : config.username;
    this.password = config.password === '' ? null : config.password;
  }

  /** Apply the folder prefix to a folder-relative path. */
  private fullPath(rel: string): string {
    return this.folder !== '' ? `${this.folder}/${rel}` : rel;
  }

  /** Lazily construct (and cache) the underlying WASM client. */
  private async raw(): Promise<RawWasmDavClient> {
    let client = this.client;
    if (client === null) {
      await ensureInit();
      client = new RawWasmDavClient(this.baseUrl, this.username, this.password);
      this.client = client;
    }
    return client;
  }

  /** Probe reachability + auth; never throws. */
  async checkConnection(): Promise<ConnectionResult> {
    try {
      const client = await this.raw();
      await client.checkConnection();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  /** List the direct children of the collection at folder-relative `path`. */
  async listFiles(path: string): Promise<DavEntry[]> {
    const client = await this.raw();
    const raw = (await client.listFiles(this.fullPath(path))) as RawDavEntry[];
    return raw.map((entry) => ({
      href: typeof entry.href === 'string' ? entry.href : '',
      etag: typeof entry.etag === 'string' ? entry.etag : null,
      contentLength:
        typeof entry.contentLength === 'number' && Number.isFinite(entry.contentLength)
          ? entry.contentLength
          : null,
      isCollection: Boolean(entry.isCollection),
    }));
  }

  /** Download the file at folder-relative `path`; returns raw bytes. */
  async getFile(path: string): Promise<Uint8Array> {
    const client = await this.raw();
    return client.getFile(this.fullPath(path));
  }

  /**
   * Upload `content` to folder-relative `path`. When `ifMatch` is given the
   * server only overwrites the resource if its current ETag matches.
   */
  async putFile(path: string, content: Uint8Array, ifMatch?: string): Promise<void> {
    const client = await this.raw();
    await client.putFile(this.fullPath(path), content, ifMatch ?? null);
  }

  /** Delete the resource at folder-relative `path`. */
  async deleteFile(path: string): Promise<void> {
    const client = await this.raw();
    await client.deleteFile(this.fullPath(path));
  }

  /** Create a collection (directory) at folder-relative `path`. */
  async createDirectory(path: string): Promise<void> {
    const client = await this.raw();
    await client.createDirectory(this.fullPath(path));
  }
}

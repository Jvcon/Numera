/**
 * IndexedDB persistence for the Numera workspace.
 *
 * Stores a single workspace snapshot:
 *   - `files`      — one row per file, keyed by id
 *   - `globals`    — single row keyed by a constant
 *   - `meta`       — schema version + last-saved timestamp
 *
 * All writes are debounced by the caller (the workspace store), not
 * here — this module just exposes typed get/put/delete operations.
 *
 * The DB connection is opened once and reused. The schema is created
 * on first open via `IDBOpenDBRequest.onupgradeneeded`.
 */

const DB_NAME = 'numera-workspace';
const DB_VERSION = 1;

const STORE_FILES = 'files';
const STORE_GLOBALS = 'globals';
const STORE_META = 'meta';

const GLOBALS_KEY = 'current';

export interface PersistedFile {
  id: string;
  path: string;
  displayName: string;
  pinned: boolean;
  content: string;
  updatedAt: number;
}

export interface PersistedMeta {
  schemaVersion: number;
  lastSavedAt: number;
}

interface WorkspaceSnapshot {
  files: PersistedFile[];
  globalsContent: string;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_GLOBALS)) {
        db.createObjectStore(STORE_GLOBALS);
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
    request.onblocked = () => reject(new Error('indexedDB upgrade blocked'));
  });

  return dbPromise;
}

function tx<T>(
  db: IDBDatabase,
  stores: string | string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T> | T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(stores, mode);
    let result: T;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error ?? new Error('indexedDB tx failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('indexedDB tx aborted'));
    Promise.resolve(body(transaction)).then((value) => {
      result = value;
    }, reject);
  });
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
  });
}

/**
 * Read the persisted workspace. Returns `null` if the workspace has
 * never been written before (first run on a fresh browser).
 */
export async function loadWorkspace(): Promise<WorkspaceSnapshot | null> {
  const db = await openDb();

  const hasAnyData = await tx(db, [STORE_META], 'readonly', async (txn) => {
    const req = txn.objectStore(STORE_META).get(GLOBALS_KEY);
    return reqToPromise(req);
  });
  if (!hasAnyData) return null;

  return tx(db, [STORE_FILES, STORE_GLOBALS], 'readonly', async (txn) => {
    const fileStore = txn.objectStore(STORE_FILES);
    const globalsStore = txn.objectStore(STORE_GLOBALS);

    const filesReq = fileStore.getAll();
    const globalsReq = globalsStore.get(GLOBALS_KEY);

    const [persistedFiles, globalsRaw] = await Promise.all([
      reqToPromise<PersistedFile[]>(filesReq),
      reqToPromise<{ content: string } | undefined>(globalsReq),
    ]);

    return {
      files: (persistedFiles ?? []).map((p) => ({
        id: p.id,
        path: p.path,
        displayName: p.displayName,
        pinned: p.pinned,
        content: p.content,
        updatedAt: p.updatedAt,
      })),
      globalsContent: globalsRaw?.content ?? '',
    };
  });
}

/** Atomically write the full workspace snapshot. */
export async function saveWorkspace(snapshot: WorkspaceSnapshot): Promise<void> {
  const db = await openDb();
  const now = Date.now();

  await tx(db, [STORE_FILES, STORE_GLOBALS, STORE_META], 'readwrite', async (txn) => {
    const fileStore = txn.objectStore(STORE_FILES);
    const globalsStore = txn.objectStore(STORE_GLOBALS);
    const metaStore = txn.objectStore(STORE_META);

    fileStore.clear();
    for (const file of snapshot.files) {
      fileStore.put({
        id: file.id,
        path: file.path,
        displayName: file.displayName,
        pinned: file.pinned,
        content: file.content,
        updatedAt: now,
      });
    }

    globalsStore.put({ content: snapshot.globalsContent }, GLOBALS_KEY);

    metaStore.put(
      {
        schemaVersion: DB_VERSION,
        lastSavedAt: now,
      },
      GLOBALS_KEY,
    );
  });
}

/** Erase the entire workspace. Used by tests and a future "reset" action. */
export async function clearWorkspace(): Promise<void> {
  const db = await openDb();
  await tx(db, [STORE_FILES, STORE_GLOBALS, STORE_META], 'readwrite', async (txn) => {
    txn.objectStore(STORE_FILES).clear();
    txn.objectStore(STORE_GLOBALS).clear();
    txn.objectStore(STORE_META).clear();
  });
}

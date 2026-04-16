/**
 * idbStorage.ts — IndexedDB key-value store for all persistent game data.
 *
 * Provides a simple async key-value interface over a single IndexedDB database
 * and object store. This is the primary (and only) storage backend — saves,
 * settings, and design library data all live here.
 *
 * @module idbStorage
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAME = 'spaceAgencySaves';
const DB_VERSION = 1;
const STORE_NAME = 'saves';

// ---------------------------------------------------------------------------
// Database Connection
// ---------------------------------------------------------------------------

let _db: IDBDatabase | null = null;

let _dbPromise: Promise<IDBDatabase> | null = null;

let _onConnectionLost: ((msg: string) => void) | null = null;

/**
 * Opens (or returns the cached) IndexedDB database connection.
 * Creates the object store on first open.
 */
function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      _db = request.result;
      _db.onclose = () => {
        _db = null;
        _dbPromise = null;
        if (_onConnectionLost) {
          _onConnectionLost(
            'The storage connection was unexpectedly closed. ' +
            'Your recent progress may not be saved. Try refreshing the page.',
          );
        }
      };
      _dbPromise = null;
      resolve(_db);
    };

    request.onerror = () => {
      _dbPromise = null;
      reject(request.error ?? new Error('Failed to open IndexedDB'));
    };
  });

  return _dbPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if IndexedDB appears to be available in this environment.
 * Does not guarantee operations will succeed (e.g. quota, permissions).
 */
export function isIdbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Registers a handler to be called if the IndexedDB connection is
 * unexpectedly closed mid-session (e.g. storage eviction, user clearing
 * site data).
 */
export function registerIdbErrorHandler(handler: (msg: string) => void): void {
  _onConnectionLost = handler;
}

/**
 * Stores a value in IndexedDB under the given key.
 *
 * @param key - The key to store under.
 * @param value - JSON string to store.
 */
export async function idbSet(key: string, value: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves a value from IndexedDB by key.
 *
 * @param key - The key to retrieve.
 * @returns The stored JSON string, or null if not found.
 */
export async function idbGet(key: string): Promise<string | null> {
  const db = await openDB();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes a key from IndexedDB.
 *
 * @param key - The key to delete.
 */
export async function idbDelete(key: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Returns all keys currently stored in the IndexedDB object store.
 *
 * @returns Array of all stored key strings.
 */
export async function idbGetAllKeys(): Promise<string[]> {
  const db = await openDB();
  return new Promise<string[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store: IDBObjectStore = tx.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve(request.result as string[]);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Resets the cached DB connection. Exported only for testing — do not call
 * from game logic.
 */
export function _resetDbForTesting(): void {
  if (_db) {
    _db.close();
  }
  _db = null;
  _dbPromise = null;
  _onConnectionLost = null;
}

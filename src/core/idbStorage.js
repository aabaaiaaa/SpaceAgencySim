/**
 * idbStorage.js — IndexedDB key-value store that mirrors localStorage saves.
 *
 * Provides a simple async key-value interface over a single IndexedDB database
 * and object store. Keys match localStorage keys for consistency.
 *
 * All operations handle IndexedDB unavailability gracefully by resolving/
 * rejecting without crashing — callers can fall back to localStorage-only.
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

/** @type {IDBDatabase | null} */
let _db = null;

/** @type {Promise<IDBDatabase> | null} */
let _dbPromise = null;

/**
 * Opens (or returns the cached) IndexedDB database connection.
 * Creates the object store on first open.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  if (_db) return Promise.resolve(_db);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    let request;
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
 *
 * @returns {boolean}
 */
export function isIdbAvailable() {
  return typeof indexedDB !== 'undefined';
}

/**
 * Stores a value in IndexedDB under the given key.
 *
 * @param {string} key
 * @param {string} value - JSON string to store.
 * @returns {Promise<void>}
 */
export async function idbSet(key, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieves a value from IndexedDB by key.
 *
 * @param {string} key
 * @returns {Promise<string | null>} The stored JSON string, or null if not found.
 */
export async function idbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Deletes a key from IndexedDB.
 *
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function idbDelete(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Resets the cached DB connection. Exported only for testing — do not call
 * from game logic.
 */
export function _resetDbForTesting() {
  if (_db) {
    _db.close();
  }
  _db = null;
  _dbPromise = null;
}

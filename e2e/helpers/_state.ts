/**
 * State seeding and query helpers for E2E tests.
 */

import type { Page } from '@playwright/test';
import LZString from 'lz-string';

import { SAVE_KEY } from './_constants.js';
import type { SaveEnvelope } from './_saveFactory.js';

/** LZC-compress a JSON string, matching the format expected by saveload.ts. */
export function compressSaveString(json: string): string {
  return 'LZC:' + LZString.compressToUTF16(json);
}

interface PhysicsSnapshot {
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  grounded: boolean;
  landed: boolean;
  crashed: boolean;
}

// ---------------------------------------------------------------------------
// IndexedDB constants (must match src/core/idbStorage.ts)
// ---------------------------------------------------------------------------

const IDB_NAME = 'spaceAgencySaves';
const IDB_VERSION = 1;
const IDB_STORE = 'saves';

// ---------------------------------------------------------------------------
// IndexedDB seeding helpers
// ---------------------------------------------------------------------------

/**
 * Write a key-value pair into the app's IndexedDB store.
 *
 * Must be called after the page has navigated to the app's origin so that
 * IndexedDB is available. The value should be the raw string to store
 * (typically `JSON.stringify(envelope)`).
 */
export async function seedIdb(
  page: Page,
  key: string,
  value: string,
): Promise<void> {
  await page.evaluate(
    async ({ key, value, dbName, dbVersion, storeName }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, 'readwrite');
          tx.objectStore(storeName).put(value, key);
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });
    },
    { key, value, dbName: IDB_NAME, dbVersion: IDB_VERSION, storeName: IDB_STORE },
  );
}

/**
 * Write multiple key-value pairs into the app's IndexedDB store in a single
 * transaction.
 */
export async function seedIdbMulti(
  page: Page,
  entries: { key: string; value: string }[],
): Promise<void> {
  await page.evaluate(
    async ({ entries, dbName, dbVersion, storeName }) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          for (const { key, value } of entries) {
            store.put(value, key);
          }
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      });
    },
    { entries, dbName: IDB_NAME, dbVersion: IDB_VERSION, storeName: IDB_STORE },
  );
}

/**
 * Read a value from the app's IndexedDB store.
 * Returns null if the key is not found.
 */
export async function readIdb(
  page: Page,
  key: string,
): Promise<string | null> {
  return page.evaluate(
    async ({ key, dbName, dbVersion, storeName }) => {
      return new Promise<string | null>((resolve, reject) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, 'readonly');
          const getReq = tx.objectStore(storeName).get(key);
          getReq.onsuccess = () => {
            db.close();
            resolve((getReq.result as string | undefined) ?? null);
          };
          getReq.onerror = () => { db.close(); reject(getReq.error); };
        };
        req.onerror = () => reject(req.error);
      });
    },
    { key, dbName: IDB_NAME, dbVersion: IDB_VERSION, storeName: IDB_STORE },
  );
}

/**
 * Return all keys currently stored in the app's IndexedDB store.
 */
export async function readIdbAllKeys(
  page: Page,
): Promise<string[]> {
  return page.evaluate(
    async ({ dbName, dbVersion, storeName }) => {
      return new Promise<string[]>((resolve, reject) => {
        const req = indexedDB.open(dbName, dbVersion);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(storeName, 'readonly');
          const keysReq = tx.objectStore(storeName).getAllKeys();
          keysReq.onsuccess = () => {
            db.close();
            resolve(keysReq.result as string[]);
          };
          keysReq.onerror = () => { db.close(); reject(keysReq.error); };
        };
        req.onerror = () => reject(req.error);
      });
    },
    { dbName: IDB_NAME, dbVersion: IDB_VERSION, storeName: IDB_STORE },
  );
}

// ---------------------------------------------------------------------------
// High-level seeding
// ---------------------------------------------------------------------------

/**
 * Seed IndexedDB with a save envelope, navigate to '/', load slot 0,
 * and wait for the hub overlay to confirm the game is loaded.
 */
export async function seedAndLoadSave(page: Page, envelope: SaveEnvelope | Record<string, unknown>): Promise<void> {
  // Navigate to establish origin so IndexedDB is accessible.
  await page.goto('/');
  await seedIdb(page, SAVE_KEY, compressSaveString(JSON.stringify(envelope)));
  // Reload so the app reads the freshly-seeded IDB data on startup.
  await page.goto('/');
  await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
  await page.click('[data-action="load"][data-slot="0"]');
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
}

/**
 * Read the current game state from the running game.
 */
export async function getGameState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const gs = window.__gameState;
    if (!gs) return null;
    return JSON.parse(JSON.stringify(gs)) as Record<string, unknown>;
  });
}

/**
 * Read the live flight state (from the flightState object synced by physics).
 * Returns null when no flight is active.
 */
export async function getFlightState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(() => {
    const gs = window.__gameState;
    if (!gs?.currentFlight) return null;
    return JSON.parse(JSON.stringify(gs.currentFlight)) as Record<string, unknown>;
  });
}

/**
 * Read the current physics state (posY, velX, velY, etc.).
 * Returns null when no flight is active.
 */
export async function getPhysicsSnapshot(page: Page): Promise<PhysicsSnapshot | null> {
  return page.evaluate(() => {
    const ps = window.__flightPs;
    if (!ps) return null;
    return {
      posX: ps.posX,
      posY: ps.posY,
      velX: ps.velX,
      velY: ps.velY,
      grounded: ps.grounded,
      landed: ps.landed,
      crashed: ps.crashed,
    };
  });
}

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  saveGame,
  loadGame,
  deleteSave,
  _setSessionStartTimeForTesting,
  decompressSaveData,
} from '../core/saveload.ts';
import {
  idbSet,
  idbGet,
  idbDelete,
  idbGetAllKeys,
  isIdbAvailable,
  _resetDbForTesting,
} from '../core/idbStorage.ts';

import type { GameState } from '../core/gameState.ts';

interface TestSaveEnvelope {
  saveName: string;
  timestamp: string;
  version: number;
  state: GameState;
}

// ---------------------------------------------------------------------------
// IndexedDB mock — in-memory implementation for Node.js
// ---------------------------------------------------------------------------

interface MockIdbFactory {
  open(_name: string, _version?: number): MockIDBRequest;
  _stores: Map<string, Map<string, unknown>>;
  _clear(): void;
}

class MockIDBRequest {
  result: unknown = undefined;
  error: DOMException | null = null;
  onsuccess: ((ev: { target: MockIDBRequest }) => void) | null = null;
  onerror: ((ev: { target: MockIDBRequest }) => void) | null = null;
  onupgradeneeded: ((ev: { target: MockIDBRequest }) => void) | null = null;

  _succeed(result: unknown): void {
    this.result = result;
    if (this.onsuccess) this.onsuccess({ target: this });
  }
  _fail(error: DOMException): void {
    this.error = error;
    if (this.onerror) this.onerror({ target: this });
  }
}

function createIdbMock(): MockIdbFactory {
  const stores = new Map<string, Map<string, unknown>>();

  class MockIDBObjectStore {
    _name: string;
    constructor(name: string) {
      this._name = name;
      if (!stores.has(name)) stores.set(name, new Map());
    }
    get _data(): Map<string, unknown> | undefined { return stores.get(this._name); }
    put(value: unknown, key: string): MockIDBRequest {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        this._data!.set(key, value);
        req._succeed(key);
      });
      return req;
    }
    get(key: string): MockIDBRequest {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        req._succeed(this._data!.get(key));
      });
      return req;
    }
    delete(key: string): MockIDBRequest {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        this._data!.delete(key);
        req._succeed(undefined);
      });
      return req;
    }
    getAllKeys(): MockIDBRequest {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        req._succeed(Array.from(this._data!.keys()));
      });
      return req;
    }
  }

  class MockIDBTransaction {
    _db: MockIDBDatabase;
    _storeNames: string | string[];
    constructor(db: MockIDBDatabase, storeNames: string | string[]) {
      this._db = db;
      this._storeNames = storeNames;
    }
    objectStore(name: string): MockIDBObjectStore {
      return new MockIDBObjectStore(name);
    }
  }

  class MockIDBDatabase {
    objectStoreNames = {
      contains(name: string): boolean { return stores.has(name); }
    };
    createObjectStore(name: string): void {
      stores.set(name, new Map());
    }
    transaction(storeNames: string | string[], _mode?: string): MockIDBTransaction {
      return new MockIDBTransaction(this, storeNames);
    }
    close(): void {}
  }

  const mockDb = new MockIDBDatabase();

  const mockIndexedDB: MockIdbFactory = {
    open(_name: string, _version?: number): MockIDBRequest {
      const req = new MockIDBRequest();
      queueMicrotask(() => {
        if (req.onupgradeneeded) {
          req.result = mockDb;
          req.onupgradeneeded({ target: req });
        }
        req._succeed(mockDb);
      });
      return req;
    },
    _stores: stores,
    _clear(): void { stores.clear(); },
  };

  return mockIndexedDB;
}

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

interface MockLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  readonly length: number;
}

function createLocalStorageMock(): MockLocalStorage {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null { return store.has(key) ? store.get(key)! : null; },
    setItem(key: string, value: string): void { store.set(key, String(value)); },
    removeItem(key: string): void { store.delete(key); },
    clear(): void { store.clear(); },
    get length(): number { return store.size; },
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

let mockStorage: MockLocalStorage;
let mockIdb: MockIdbFactory;

beforeEach(() => {
  mockStorage = createLocalStorageMock();
  mockIdb = createIdbMock();
  vi.stubGlobal('localStorage', mockStorage);
  vi.stubGlobal('indexedDB', mockIdb);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  _setSessionStartTimeForTesting(0);
  _resetDbForTesting();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  _resetDbForTesting();
});

function freshState(): GameState {
  return createGameState();
}

// ---------------------------------------------------------------------------
// idbStorage module — direct API tests
// ---------------------------------------------------------------------------

describe('idbStorage module', () => {
  describe('isIdbAvailable()', () => {
    it('returns true when indexedDB is defined', () => {
      expect(isIdbAvailable()).toBe(true);
    });

    it('returns false when indexedDB is undefined', () => {
      vi.stubGlobal('indexedDB', undefined);
      expect(isIdbAvailable()).toBe(false);
    });
  });

  describe('idbSet() and idbGet()', () => {
    it('stores and retrieves a value', async () => {
      await idbSet('testKey', 'testValue');
      const result = await idbGet('testKey');
      expect(result).toBe('testValue');
    });

    it('returns null for a missing key', async () => {
      const result = await idbGet('nonexistent');
      expect(result).toBeNull();
    });

    it('overwrites an existing key', async () => {
      await idbSet('key', 'first');
      await idbSet('key', 'second');
      const result = await idbGet('key');
      expect(result).toBe('second');
    });

    it('stores different keys independently', async () => {
      await idbSet('a', '1');
      await idbSet('b', '2');
      expect(await idbGet('a')).toBe('1');
      expect(await idbGet('b')).toBe('2');
    });
  });

  describe('idbDelete()', () => {
    it('removes a stored key', async () => {
      await idbSet('key', 'value');
      await idbDelete('key');
      const result = await idbGet('key');
      expect(result).toBeNull();
    });

    it('does not throw when deleting a nonexistent key', async () => {
      await expect(idbDelete('nonexistent')).resolves.toBeUndefined();
    });
  });

  describe('idbGetAllKeys()', () => {
    it('returns an empty array when the store is empty', async () => {
      const keys = await idbGetAllKeys();
      expect(keys).toEqual([]);
    });

    it('returns all stored keys', async () => {
      await idbSet('alpha', '1');
      await idbSet('beta', '2');
      await idbSet('gamma', '3');
      const keys = await idbGetAllKeys();
      expect(keys.sort()).toEqual(['alpha', 'beta', 'gamma']);
    });

    it('reflects deletions', async () => {
      await idbSet('a', '1');
      await idbSet('b', '2');
      await idbDelete('a');
      const keys = await idbGetAllKeys();
      expect(keys).toEqual(['b']);
    });
  });

  describe('IndexedDB unavailable', () => {
    it('idbSet rejects when indexedDB is undefined', async () => {
      vi.stubGlobal('indexedDB', undefined);
      _resetDbForTesting();
      await expect(idbSet('key', 'val')).rejects.toThrow(/not available/i);
    });

    it('idbGet rejects when indexedDB is undefined', async () => {
      vi.stubGlobal('indexedDB', undefined);
      _resetDbForTesting();
      await expect(idbGet('key')).rejects.toThrow(/not available/i);
    });
  });
});

// ---------------------------------------------------------------------------
// saveGame() — IDB-only persistence
// ---------------------------------------------------------------------------

describe('saveGame() IDB persistence', () => {
  it('writes to IndexedDB', async () => {
    const state = freshState();
    state.money = 42_000;
    await saveGame(state, 0, 'IDB Test');

    const idbRaw = await idbGet('spaceAgencySave_0');
    expect(idbRaw).not.toBeNull();
    const idbJson = decompressSaveData(idbRaw!);
    const idbEnvelope = JSON.parse(idbJson) as TestSaveEnvelope;
    expect(idbEnvelope.state.money).toBe(42_000);
  });
});

// ---------------------------------------------------------------------------
// deleteSave() — IDB deletion
// ---------------------------------------------------------------------------

describe('deleteSave() IDB deletion', () => {
  it('removes from IndexedDB', async () => {
    const state = freshState();
    await saveGame(state, 1, 'To Delete');

    expect(await idbGet('spaceAgencySave_1')).not.toBeNull();

    await deleteSave(1);

    expect(await idbGet('spaceAgencySave_1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadGame()
// ---------------------------------------------------------------------------

describe('loadGame()', () => {
  it('loads a saved game from IDB', async () => {
    const state = freshState();
    state.money = 50_000;
    await saveGame(state, 0, 'Test');

    const restored = await loadGame(0);
    expect(restored.money).toBe(50_000);
  });

  it('throws when slot is empty', async () => {
    await expect(loadGame(3)).rejects.toThrow(/empty/i);
  });

  it('throws RangeError for invalid slot index', async () => {
    await expect(loadGame(-1)).rejects.toThrow(RangeError);
    await expect(loadGame(5)).rejects.toThrow(RangeError);
  });
});

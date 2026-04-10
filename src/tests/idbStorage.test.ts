import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  saveGame,
  loadGame,
  loadGameAsync,
  deleteSave,
  _setSessionStartTimeForTesting,
  decompressSaveData,
} from '../core/saveload.ts';
import {
  idbSet,
  idbGet,
  idbDelete,
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
// saveGame() — IndexedDB mirroring
// ---------------------------------------------------------------------------

describe('saveGame() IndexedDB mirroring', () => {
  it('writes to both localStorage and IndexedDB', async () => {
    const state = freshState();
    state.money = 42_000;
    await saveGame(state, 0, 'Mirror Test');

    // localStorage should have the save immediately.
    const lsRaw = localStorage.getItem('spaceAgencySave_0');
    expect(lsRaw).not.toBeNull();

    // IndexedDB write is fire-and-forget; flush microtasks.
    await vi.runAllTimersAsync();

    const idbRaw = await idbGet('spaceAgencySave_0');
    expect(idbRaw).not.toBeNull();
    const idbJson = decompressSaveData(idbRaw!);
    const idbEnvelope = JSON.parse(idbJson) as TestSaveEnvelope;
    expect(idbEnvelope.state.money).toBe(42_000);
  });

  it('still saves to localStorage when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    _resetDbForTesting();

    const state = freshState();
    state.money = 99_000;
    await saveGame(state, 0, 'LS Only');

    const raw = localStorage.getItem('spaceAgencySave_0');
    expect(raw).not.toBeNull();
    const json = decompressSaveData(raw!);
    const envelope = JSON.parse(json) as TestSaveEnvelope;
    expect(envelope.state.money).toBe(99_000);
  });
});

// ---------------------------------------------------------------------------
// deleteSave() — IndexedDB mirroring
// ---------------------------------------------------------------------------

describe('deleteSave() IndexedDB mirroring', () => {
  it('removes from both localStorage and IndexedDB', async () => {
    const state = freshState();
    await saveGame(state, 1, 'To Delete');
    await vi.runAllTimersAsync();

    // Verify both have the save.
    expect(localStorage.getItem('spaceAgencySave_1')).not.toBeNull();
    expect(await idbGet('spaceAgencySave_1')).not.toBeNull();

    deleteSave(1);
    await vi.runAllTimersAsync();

    expect(localStorage.getItem('spaceAgencySave_1')).toBeNull();
    expect(await idbGet('spaceAgencySave_1')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// loadGameAsync() — dual-layer loading
// ---------------------------------------------------------------------------

describe('loadGameAsync()', () => {
  it('loads from localStorage when both layers have the same save', async () => {
    const state = freshState();
    state.money = 50_000;
    await saveGame(state, 0, 'Dual');
    await vi.runAllTimersAsync();

    const restored = await loadGameAsync(0);
    expect(restored.money).toBe(50_000);
  });

  it('uses the more recent save when IndexedDB has a newer timestamp', async () => {
    // Write an older save to localStorage.
    const oldState = freshState();
    oldState.money = 10_000;
    const oldEnvelope: TestSaveEnvelope = {
      saveName: 'Old',
      timestamp: '2025-01-01T00:00:00.000Z',
      version: 1,
      state: JSON.parse(JSON.stringify(oldState)) as GameState,
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(oldEnvelope));

    // Write a newer save directly to IndexedDB.
    const newState = freshState();
    newState.money = 99_000;
    const newEnvelope: TestSaveEnvelope = {
      saveName: 'New',
      timestamp: '2025-06-01T00:00:00.000Z',
      version: 1,
      state: JSON.parse(JSON.stringify(newState)) as GameState,
    };
    await idbSet('spaceAgencySave_0', JSON.stringify(newEnvelope));

    const restored = await loadGameAsync(0);
    expect(restored.money).toBe(99_000);
  });

  it('uses localStorage save when it is more recent than IndexedDB', async () => {
    // Write an older save to IndexedDB.
    const oldState = freshState();
    oldState.money = 10_000;
    const oldEnvelope: TestSaveEnvelope = {
      saveName: 'Old IDB',
      timestamp: '2025-01-01T00:00:00.000Z',
      version: 1,
      state: JSON.parse(JSON.stringify(oldState)) as GameState,
    };
    await idbSet('spaceAgencySave_0', JSON.stringify(oldEnvelope));

    // Write a newer save to localStorage.
    const newState = freshState();
    newState.money = 77_000;
    const newEnvelope: TestSaveEnvelope = {
      saveName: 'New LS',
      timestamp: '2025-06-01T00:00:00.000Z',
      version: 1,
      state: JSON.parse(JSON.stringify(newState)) as GameState,
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(newEnvelope));

    const restored = await loadGameAsync(0);
    expect(restored.money).toBe(77_000);
  });

  it('falls back to IndexedDB when localStorage is empty', async () => {
    const state = freshState();
    state.money = 88_000;
    const envelope: TestSaveEnvelope = {
      saveName: 'IDB Only',
      timestamp: '2025-03-01T00:00:00.000Z',
      version: 1,
      state: JSON.parse(JSON.stringify(state)) as GameState,
    };
    await idbSet('spaceAgencySave_2', JSON.stringify(envelope));

    const restored = await loadGameAsync(2);
    expect(restored.money).toBe(88_000);
  });

  it('falls back to localStorage when IndexedDB is unavailable', async () => {
    const state = freshState();
    state.money = 33_000;
    // Save while IDB is available.
    await saveGame(state, 0, 'LS Fallback');
    await vi.runAllTimersAsync();

    // Now make IDB unavailable.
    vi.stubGlobal('indexedDB', undefined);
    _resetDbForTesting();

    const restored = await loadGameAsync(0);
    expect(restored.money).toBe(33_000);
  });

  it('throws when both layers are empty', async () => {
    await expect(loadGameAsync(3)).rejects.toThrow(/empty/i);
  });

  it('throws RangeError for invalid slot index', async () => {
    await expect(loadGameAsync(-1)).rejects.toThrow(RangeError);
    await expect(loadGameAsync(5)).rejects.toThrow(RangeError);
  });

  it('restores IndexedDB save to localStorage for subsequent sync loads', async () => {
    // Put a save only in IndexedDB.
    const state = freshState();
    state.money = 55_000;
    const envelope: TestSaveEnvelope = {
      saveName: 'Sync Restore',
      timestamp: '2025-04-01T00:00:00.000Z',
      version: 1,
      state: JSON.parse(JSON.stringify(state)) as GameState,
    };
    await idbSet('spaceAgencySave_0', JSON.stringify(envelope));

    // loadGameAsync should write it back to localStorage.
    await loadGameAsync(0);

    // Now loadGame should work.
    const syncRestored = await loadGame(0);
    expect(syncRestored.money).toBe(55_000);
  });
});

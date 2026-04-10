/**
 * storageErrors.test.js — Tests for localStorage quota handling and
 * error logging in saveload.js and designLibrary.js.
 *
 * Covers:
 *   - saveGame() catching QuotaExceededError and throwing user-friendly message
 *   - importSave() catching QuotaExceededError and throwing user-friendly message
 *   - saveSharedLibrary() catching QuotaExceededError
 *   - loadSharedLibrary() logging console.warn on corrupt JSON
 *   - Non-quota errors are re-thrown unchanged
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  saveGame,
  importSave,
  _setSessionStartTimeForTesting,
} from '../core/saveload.ts';
import {
  saveSharedLibrary,
  loadSharedLibrary,
} from '../core/designLibrary.ts';

import type { GameState, RocketDesign } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// localStorage mock with configurable setItem behavior
// ---------------------------------------------------------------------------

interface MockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  readonly length: number;
  _store: Map<string, string>;
}

function createLocalStorageMock(): MockStorage {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null { return store.has(key) ? store.get(key)! : null; },
    setItem(key: string, value: string): void { store.set(key, String(value)); },
    removeItem(key: string): void { store.delete(key); },
    clear(): void { store.clear(); },
    get length(): number { return store.size; },
    _store: store,
  };
}

let mockStorage: MockStorage;

beforeEach(() => {
  mockStorage = createLocalStorageMock();
  vi.stubGlobal('localStorage', mockStorage);
  vi.useFakeTimers();
  vi.setSystemTime(0);
  _setSessionStartTimeForTesting(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  return createGameState();
}

function makeQuotaError(): DOMException {
  const err = new DOMException('quota exceeded', 'QuotaExceededError');
  return err;
}

function minimalEnvelopeJSON(): string {
  const state = freshState();
  return JSON.stringify({
    saveName: 'Test Save',
    timestamp: new Date(0).toISOString(),
    state,
  });
}

// ---------------------------------------------------------------------------
// saveGame — QuotaExceededError
// ---------------------------------------------------------------------------

describe('saveGame() quota handling', () => {
  it('throws a user-friendly message on QuotaExceededError', async () => {
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
      throw makeQuotaError();
    });

    await expect(saveGame(freshState(), 0, 'test')).rejects.toThrow(
      /storage full/i,
    );
  });

  it('does not swallow non-quota errors', async () => {
    const otherError = new TypeError('something else broke');
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
      throw otherError;
    });

    await expect(saveGame(freshState(), 0, 'test')).rejects.toThrow(otherError);
  });
});

// ---------------------------------------------------------------------------
// importSave — QuotaExceededError
// ---------------------------------------------------------------------------

describe('importSave() quota handling', () => {
  it('throws a user-friendly message on QuotaExceededError', () => {
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
      throw makeQuotaError();
    });

    expect(() => importSave(minimalEnvelopeJSON(), 0)).toThrow(
      /storage full/i,
    );
  });

  it('does not swallow non-quota errors', () => {
    const otherError = new Error('disk on fire');
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
      throw otherError;
    });

    expect(() => importSave(minimalEnvelopeJSON(), 0)).toThrow(otherError);
  });
});

// ---------------------------------------------------------------------------
// saveSharedLibrary — QuotaExceededError
// ---------------------------------------------------------------------------

describe('saveSharedLibrary() quota handling', () => {
  it('throws a user-friendly message on QuotaExceededError', () => {
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
      throw makeQuotaError();
    });

    expect(() => saveSharedLibrary([{ id: 'd1', name: 'Test' } as RocketDesign])).toThrow(
      /storage full/i,
    );
  });

  it('does not swallow non-quota errors', () => {
    const otherError = new RangeError('boom');
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
      throw otherError;
    });

    expect(() => saveSharedLibrary([])).toThrow(otherError);
  });
});

// ---------------------------------------------------------------------------
// loadSharedLibrary — console.warn on corrupt JSON
// ---------------------------------------------------------------------------

describe('loadSharedLibrary() error logging', () => {
  it('returns empty array on corrupt JSON', () => {
    mockStorage._store.set('spaceAgencyDesignLibrary', '{not valid json!!!');

    const result = loadSharedLibrary();
    expect(result).toEqual([]);
  });

  it('logs a console.warn when JSON parse fails', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockStorage._store.set('spaceAgencyDesignLibrary', '{corrupt}}}');

    loadSharedLibrary();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/designLibrary/i);
  });

  it('does not warn when data is valid', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockStorage._store.set(
      'spaceAgencyDesignLibrary',
      JSON.stringify([{ id: 'd1', name: 'Good Design' }]),
    );

    const result = loadSharedLibrary();
    expect(result).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

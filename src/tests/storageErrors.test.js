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
import { createGameState } from '../core/gameState.js';
import {
  saveGame,
  importSave,
  _setSessionStartTimeForTesting,
} from '../core/saveload.js';
import {
  saveSharedLibrary,
  loadSharedLibrary,
} from '../core/designLibrary.js';

// ---------------------------------------------------------------------------
// localStorage mock with configurable setItem behavior
// ---------------------------------------------------------------------------

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
    get length() { return store.size; },
    /** Direct access to the store for test setup */
    _store: store,
  };
}

let mockStorage;

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

function freshState() {
  return createGameState();
}

function makeQuotaError() {
  const err = new DOMException('quota exceeded', 'QuotaExceededError');
  return err;
}

function minimalEnvelopeJSON() {
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
  it('throws a user-friendly message on QuotaExceededError', () => {
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
      throw makeQuotaError();
    });

    expect(() => saveGame(freshState(), 0, 'test')).toThrow(
      /storage full/i,
    );
  });

  it('does not swallow non-quota errors', () => {
    const otherError = new TypeError('something else broke');
    vi.spyOn(mockStorage, 'setItem').mockImplementation(() => {
      throw otherError;
    });

    expect(() => saveGame(freshState(), 0, 'test')).toThrow(otherError);
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

    expect(() => saveSharedLibrary([{ id: 'd1', name: 'Test' }])).toThrow(
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

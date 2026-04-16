/**
 * storageErrors.test.js — Tests for storage error handling and
 * error logging in saveload.js and designLibrary.js.
 *
 * Covers:
 *   - saveGame() catching IDB write errors and throwing user-friendly message
 *   - importSave() catching IDB write errors and throwing user-friendly message
 *   - saveSharedLibrary() propagating IDB write errors
 *   - loadSharedLibrary() logging console.warn on corrupt JSON
 *   - Non-quota errors are re-thrown unchanged
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.ts';

import type { GameState, RocketDesign } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// In-memory IDB mock — shared between mock factory and test code
// ---------------------------------------------------------------------------

const _idbStore = new Map<string, string>();

vi.mock('../core/idbStorage.js', () => ({
  idbSet: vi.fn((key: string, value: string) => {
    _idbStore.set(key, value);
    return Promise.resolve();
  }),
  idbGet: vi.fn((key: string) => {
    return Promise.resolve(_idbStore.has(key) ? _idbStore.get(key)! : null);
  }),
  idbDelete: vi.fn((key: string) => {
    _idbStore.delete(key);
    return Promise.resolve();
  }),
  idbGetAllKeys: vi.fn(() => {
    return Promise.resolve([..._idbStore.keys()]);
  }),
}));

import {
  saveGame,
  importSave,
  compressSaveData,
  _setSessionStartTimeForTesting,
} from '../core/saveload.ts';
import {
  saveSharedLibrary,
  loadSharedLibrary,
} from '../core/designLibrary.ts';
import { idbSet } from '../core/idbStorage.ts';
import { crc32 } from '../core/crc32.ts';

beforeEach(() => {
  _idbStore.clear();
  vi.useFakeTimers();
  vi.setSystemTime(0);
  _setSessionStartTimeForTesting(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  return createGameState();
}

/** Build a base64-encoded SASV binary envelope from a JSON envelope object. */
function buildBinaryImport(data: Record<string, unknown>): string {
  const json = JSON.stringify(data);
  const lzc = compressSaveData(json);
  const encoder = new TextEncoder();
  const payloadBytes = encoder.encode(lzc);
  const checksum = crc32(payloadBytes);

  const header = new Uint8Array(14);
  const view = new DataView(header.buffer);
  header[0] = 0x53; header[1] = 0x41; header[2] = 0x53; header[3] = 0x56;
  view.setUint16(4, 1, false);
  view.setUint32(6, checksum, false);
  view.setUint32(10, payloadBytes.length, false);

  const envelope = new Uint8Array(14 + payloadBytes.length);
  envelope.set(header, 0);
  envelope.set(payloadBytes, 14);

  let binary = '';
  for (let i = 0; i < envelope.length; i++) {
    binary += String.fromCharCode(envelope[i]);
  }
  return btoa(binary);
}

function minimalBinaryImport(): string {
  return buildBinaryImport({
    saveName: 'Test Save',
    timestamp: new Date(0).toISOString(),
    state: freshState(),
  });
}

// ---------------------------------------------------------------------------
// saveGame — IDB write errors
// ---------------------------------------------------------------------------

describe('saveGame() error handling', () => {
  it('throws a user-friendly message on IDB write failure', async () => {
    // saveGame calls idbSet multiple times (settings + save data).
    // Reject ALL calls so the save data write also fails.
    vi.mocked(idbSet).mockRejectedValue(new Error('IDB write failed'));

    await expect(saveGame(freshState(), 0, 'test')).rejects.toThrow(
      /IDB write failed/i,
    );

    // Restore default mock behavior.
    vi.mocked(idbSet).mockImplementation((key: string, value: string) => {
      _idbStore.set(key, value);
      return Promise.resolve();
    });
  });

  it('does not swallow non-quota errors', async () => {
    const otherError = new TypeError('something else broke');
    vi.mocked(idbSet).mockRejectedValue(otherError);

    await expect(saveGame(freshState(), 0, 'test')).rejects.toThrow(otherError);

    vi.mocked(idbSet).mockImplementation((key: string, value: string) => {
      _idbStore.set(key, value);
      return Promise.resolve();
    });
  });
});

// ---------------------------------------------------------------------------
// importSave — IDB write errors
// ---------------------------------------------------------------------------

describe('importSave() error handling', () => {
  it('throws on IDB write failure', async () => {
    const base64 = minimalBinaryImport();
    vi.mocked(idbSet).mockRejectedValueOnce(new Error('IDB write failed'));

    await expect(importSave(base64, 0)).rejects.toThrow(
      /IDB write failed/i,
    );
  });

  it('does not swallow other errors', async () => {
    const base64 = minimalBinaryImport();
    const otherError = new Error('disk on fire');
    vi.mocked(idbSet).mockRejectedValueOnce(otherError);

    await expect(importSave(base64, 0)).rejects.toThrow(otherError);
  });
});

// ---------------------------------------------------------------------------
// saveSharedLibrary — IDB write errors
// ---------------------------------------------------------------------------

describe('saveSharedLibrary() error handling', () => {
  it('propagates IDB write errors', async () => {
    vi.mocked(idbSet).mockRejectedValueOnce(new Error('IDB write failed'));

    await expect(saveSharedLibrary([{ id: 'd1', name: 'Test' } as RocketDesign])).rejects.toThrow(
      /IDB write failed/i,
    );
  });

  it('does not swallow other errors', async () => {
    const otherError = new RangeError('boom');
    vi.mocked(idbSet).mockRejectedValueOnce(otherError);

    await expect(saveSharedLibrary([])).rejects.toThrow(otherError);
  });
});

// ---------------------------------------------------------------------------
// loadSharedLibrary — console.warn on corrupt JSON
// ---------------------------------------------------------------------------

describe('loadSharedLibrary() error logging', () => {
  it('returns empty array on corrupt JSON', async () => {
    _idbStore.set('spaceAgencyDesignLibrary', '{not valid json!!!');

    const result = await loadSharedLibrary();
    expect(result).toEqual([]);
  });

  it('logs a console.warn when JSON parse fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _idbStore.set('spaceAgencyDesignLibrary', '{corrupt}}}');

    await loadSharedLibrary();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/designLibrary/i);
  });

  it('does not warn when data is valid', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    _idbStore.set(
      'spaceAgencyDesignLibrary',
      JSON.stringify([{ id: 'd1', name: 'Good Design' }]),
    );

    const result = await loadSharedLibrary();
    expect(result).toHaveLength(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

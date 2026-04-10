// @ts-nocheck
/**
 * autoSave.test.js — Unit tests for the auto-save system.
 *
 * Tests cover:
 *   - isAutoSaveEnabled()   — reads autoSaveEnabled from state
 *   - performAutoSave()     — writes to the dedicated auto-save slot
 *   - hasAutoSave()         — checks for existing auto-save
 *   - deleteAutoSave()      — removes auto-save from storage
 *   - QuotaExceededError handling
 *   - IndexedDB fallback
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.ts';

// Mock idbStorage before importing autoSave.
vi.mock('../core/idbStorage.js', () => ({
  idbSet: vi.fn(() => Promise.resolve()),
  idbGet: vi.fn(() => Promise.resolve(null)),
  idbDelete: vi.fn(() => Promise.resolve()),
  isIdbAvailable: vi.fn(() => true),
}));

import {
  isAutoSaveEnabled,
  performAutoSave,
  hasAutoSave,
  deleteAutoSave,
  AUTO_SAVE_KEY,
  _setSessionStartTimeForTesting,
  _resetAutoSaveSlotForTesting,
} from '../core/autoSave.ts';

import { decompressSaveData } from '../core/saveload.ts';
import { idbSet, idbDelete, isIdbAvailable } from '../core/idbStorage.ts';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

function createLocalStorageMock() {
  const store = new Map();
  return {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); },
    clear() { store.clear(); },
    get length() { return store.size; },
  };
}

let mockStorage;

beforeEach(() => {
  mockStorage = createLocalStorageMock();
  vi.stubGlobal('localStorage', mockStorage);
  vi.useFakeTimers();
  _setSessionStartTimeForTesting(Date.now());
  _resetAutoSaveSlotForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function freshState() {
  return createGameState();
}

// ---------------------------------------------------------------------------
// isAutoSaveEnabled
// ---------------------------------------------------------------------------

describe('isAutoSaveEnabled', () => {
  it('returns true when autoSaveEnabled is true', () => {
    const state = freshState();
    state.autoSaveEnabled = true;
    expect(isAutoSaveEnabled(state)).toBe(true);
  });

  it('returns true when autoSaveEnabled is undefined (default)', () => {
    const state = freshState();
    delete state.autoSaveEnabled;
    expect(isAutoSaveEnabled(state)).toBe(true);
  });

  it('returns false when autoSaveEnabled is false', () => {
    const state = freshState();
    state.autoSaveEnabled = false;
    expect(isAutoSaveEnabled(state)).toBe(false);
  });

  it('returns false for null state', () => {
    expect(isAutoSaveEnabled(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// performAutoSave
// ---------------------------------------------------------------------------

describe('performAutoSave', () => {
  it('saves to first empty manual slot when no manual saves exist @smoke', async () => {
    const state = freshState();
    state.agencyName = 'Test Agency';

    const result = await performAutoSave(state);

    expect(result.success).toBe(true);
    // With no manual saves, auto-save goes to slot 0.
    const raw = mockStorage.getItem('spaceAgencySave_0');
    expect(raw).not.toBeNull();

    const json = decompressSaveData(raw);
    const envelope = JSON.parse(json);
    expect(envelope.saveName).toBe('Auto-Save');
    expect(envelope.state.agencyName).toBe('Test Agency');
    expect(typeof envelope.timestamp).toBe('string');
    expect(envelope.version).toBe(2);
  });

  it('accumulates session play time', async () => {
    const state = freshState();
    state.playTimeSeconds = 100;

    // Advance 30 seconds.
    vi.advanceTimersByTime(30_000);

    await performAutoSave(state);

    expect(state.playTimeSeconds).toBe(130);
  });

  it('mirrors to IndexedDB when available', async () => {
    const state = freshState();
    await performAutoSave(state);

    // With no manual saves, uses slot 0.
    expect(idbSet).toHaveBeenCalledWith('spaceAgencySave_0', expect.any(String));
  });

  it('returns failure for null state', async () => {
    const result = await performAutoSave(null);
    expect(result.success).toBe(false);
    expect(result.error).toBe('No state provided');
  });

  it('falls back to IndexedDB on QuotaExceededError @smoke', async () => {
    const state = freshState();
    const quotaError = new DOMException('quota exceeded', 'QuotaExceededError');
    mockStorage.setItem = vi.fn(() => { throw quotaError; });

    const result = await performAutoSave(state);

    expect(result.success).toBe(true);
    expect(idbSet).toHaveBeenCalled();
  });

  it('returns failure when localStorage full and IDB unavailable', async () => {
    const state = freshState();
    const quotaError = new DOMException('quota exceeded', 'QuotaExceededError');
    mockStorage.setItem = vi.fn(() => { throw quotaError; });
    isIdbAvailable.mockReturnValue(false);

    const result = await performAutoSave(state);

    expect(result.success).toBe(false);
    expect(result.error).toBe('Storage full');
  });

  it('creates a deep clone of state in the envelope', async () => {
    const state = freshState();
    state.agencyName = 'Before';

    await performAutoSave(state);

    // Mutate state after save.
    state.agencyName = 'After';

    // With no manual saves, auto-save goes to slot 0.
    const json = decompressSaveData(mockStorage.getItem('spaceAgencySave_0'));
    const envelope = JSON.parse(json);
    expect(envelope.state.agencyName).toBe('Before');
  });

  it('uses next available slot when initial slots are occupied', async () => {
    // Fill slots 0-4.
    for (let i = 0; i < 5; i++) {
      mockStorage.setItem(`spaceAgencySave_${i}`, 'occupied');
    }
    _resetAutoSaveSlotForTesting();

    const state = freshState();
    const result = await performAutoSave(state);
    expect(result.success).toBe(true);
    // Should use slot 5 (first empty beyond the occupied ones).
    expect(mockStorage.getItem('spaceAgencySave_5')).not.toBeNull();
  });

  it('falls back to AUTO_SAVE_KEY when all 100 slots are occupied @smoke', async () => {
    // Fill all 100 manual save slots (0-99).
    for (let i = 0; i < 100; i++) {
      mockStorage.setItem(`spaceAgencySave_${i}`, 'occupied');
    }
    _resetAutoSaveSlotForTesting();

    const state = freshState();
    state.agencyName = 'Fallback Agency';

    const result = await performAutoSave(state);

    expect(result.success).toBe(true);
    // Should have fallen back to the dedicated auto-save key.
    const raw = mockStorage.getItem(AUTO_SAVE_KEY);
    expect(raw).not.toBeNull();

    const json = decompressSaveData(raw);
    const envelope = JSON.parse(json);
    expect(envelope.saveName).toBe('Auto-Save');
    expect(envelope.state.agencyName).toBe('Fallback Agency');
  });
});

// ---------------------------------------------------------------------------
// hasAutoSave
// ---------------------------------------------------------------------------

describe('hasAutoSave', () => {
  it('returns false when no auto-save exists', () => {
    expect(hasAutoSave()).toBe(false);
  });

  it('returns true when the dedicated auto-save key has data', async () => {
    // Directly place data at the dedicated key (legacy or manual).
    mockStorage.setItem(AUTO_SAVE_KEY, 'data');
    expect(hasAutoSave()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteAutoSave
// ---------------------------------------------------------------------------

describe('deleteAutoSave', () => {
  it('removes the auto-save from localStorage', async () => {
    // Place data at the dedicated key.
    mockStorage.setItem(AUTO_SAVE_KEY, 'data');
    expect(hasAutoSave()).toBe(true);

    deleteAutoSave();
    expect(hasAutoSave()).toBe(false);
  });

  it('also deletes from IndexedDB', async () => {
    await performAutoSave(freshState());
    deleteAutoSave();

    expect(idbDelete).toHaveBeenCalledWith(AUTO_SAVE_KEY);
  });

  it('does not crash when no auto-save exists', () => {
    expect(() => deleteAutoSave()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AUTO_SAVE_KEY is separate from manual slots
// ---------------------------------------------------------------------------

describe('auto-save slot isolation', () => {
  it('uses a key distinct from manual save slots (0-4)', () => {
    expect(AUTO_SAVE_KEY).toBe('spaceAgencySave_auto');
    expect(AUTO_SAVE_KEY).not.toMatch(/spaceAgencySave_\d/);
  });
});

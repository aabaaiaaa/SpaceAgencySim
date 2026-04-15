/**
 * autoSave.test.ts — Unit tests for the auto-save system.
 *
 * Tests cover:
 *   - isAutoSaveEnabled()   — reads autoSaveEnabled from state
 *   - performAutoSave()     — writes to the dedicated auto-save slot
 *   - hasAutoSave()         — checks for existing auto-save in IDB
 *   - deleteAutoSave()      — removes auto-save from IDB
 *   - IDB write failure handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.ts';

import type { GameState } from '../core/gameState.ts';

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
  isAutoSaveEnabled,
  performAutoSave,
  hasAutoSave,
  deleteAutoSave,
  AUTO_SAVE_KEY,
  _setSessionStartTimeForTesting,
  _resetAutoSaveSlotForTesting,
} from '../core/autoSave.ts';

import { compressSaveData, decompressSaveData } from '../core/saveload.ts';
import { idbSet, idbDelete } from '../core/idbStorage.ts';

beforeEach(() => {
  _idbStore.clear();
  vi.useFakeTimers();
  _setSessionStartTimeForTesting(Date.now());
  _resetAutoSaveSlotForTesting();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function freshState(): GameState {
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
    // @ts-expect-error — intentionally deleting required property to test undefined fallback
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
    const raw = _idbStore.get('spaceAgencySave_0');
    expect(raw).toBeDefined();

    const json = decompressSaveData(raw!);
    const envelope = JSON.parse(json);
    expect(envelope.saveName).toBe('Test Agency');
    expect(envelope.autoSave).toBe(true);
    expect(envelope.state.agencyName).toBe('Test Agency');
    expect(typeof envelope.timestamp).toBe('string');
    expect(envelope.version).toBe(6);
  });

  it('accumulates session play time', async () => {
    const state = freshState();
    state.playTimeSeconds = 100;

    // Advance 30 seconds.
    vi.advanceTimersByTime(30_000);

    await performAutoSave(state);

    expect(state.playTimeSeconds).toBe(130);
  });

  it('writes to IndexedDB', async () => {
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

  it('returns failure when IDB write fails @smoke', async () => {
    const state = freshState();
    vi.mocked(idbSet).mockRejectedValueOnce(new Error('IDB write failed'));

    const result = await performAutoSave(state);

    expect(result.success).toBe(false);
    expect(result.error).toBe('IDB write failed');
  });

  it('creates a deep clone of state in the envelope', async () => {
    const state = freshState();
    state.agencyName = 'Before';

    await performAutoSave(state);

    // Mutate state after save.
    state.agencyName = 'After';

    // With no manual saves, auto-save goes to slot 0.
    const raw = _idbStore.get('spaceAgencySave_0')!;
    const json = decompressSaveData(raw);
    const envelope = JSON.parse(json);
    expect(envelope.state.agencyName).toBe('Before');
  });

  it('uses next available slot when initial slots are occupied', async () => {
    // Fill slots 0-4 in IDB.
    for (let i = 0; i < 5; i++) {
      _idbStore.set(`spaceAgencySave_${i}`, 'occupied');
    }
    _resetAutoSaveSlotForTesting();

    const state = freshState();
    const result = await performAutoSave(state);
    expect(result.success).toBe(true);
    // Should use slot 5 (first empty beyond the occupied ones).
    expect(_idbStore.has('spaceAgencySave_5')).toBe(true);
  });

  it('falls back to AUTO_SAVE_KEY when all 100 slots are occupied @smoke', async () => {
    // Fill all 100 manual save slots (0-99) in IDB.
    for (let i = 0; i < 100; i++) {
      _idbStore.set(`spaceAgencySave_${i}`, 'occupied');
    }
    _resetAutoSaveSlotForTesting();

    const state = freshState();
    state.agencyName = 'Fallback Agency';

    const result = await performAutoSave(state);

    expect(result.success).toBe(true);
    // Should have fallen back to the dedicated auto-save key.
    const raw = _idbStore.get(AUTO_SAVE_KEY);
    expect(raw).toBeDefined();

    const json = decompressSaveData(raw!);
    const envelope = JSON.parse(json);
    expect(envelope.saveName).toBe('Fallback Agency');
    expect(envelope.autoSave).toBe(true);
    expect(envelope.state.agencyName).toBe('Fallback Agency');
  });
});

// ---------------------------------------------------------------------------
// hasAutoSave
// ---------------------------------------------------------------------------

describe('hasAutoSave', () => {
  it('returns false when no auto-save exists', async () => {
    expect(await hasAutoSave()).toBe(false);
  });

  it('returns true when the dedicated auto-save key has data', async () => {
    // Directly place data at the dedicated key in IDB.
    _idbStore.set(AUTO_SAVE_KEY, 'data');
    expect(await hasAutoSave()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// deleteAutoSave
// ---------------------------------------------------------------------------

describe('deleteAutoSave', () => {
  it('removes the auto-save from IDB', async () => {
    // Place data at the dedicated key.
    _idbStore.set(AUTO_SAVE_KEY, 'data');
    expect(await hasAutoSave()).toBe(true);

    await deleteAutoSave();
    expect(await hasAutoSave()).toBe(false);
  });

  it('calls idbDelete with the auto-save key', async () => {
    await performAutoSave(freshState());
    await deleteAutoSave();

    expect(idbDelete).toHaveBeenCalledWith(AUTO_SAVE_KEY);
  });

  it('does not crash when no auto-save exists', async () => {
    await expect(deleteAutoSave()).resolves.not.toThrow();
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

// ---------------------------------------------------------------------------
// auto-save slot reuse
// ---------------------------------------------------------------------------

describe('auto-save slot reuse', () => {
  it('@smoke reuses existing auto-save slot for same agency', async () => {
    // Pre-populate slot 3 with a compressed auto-save for "NASA" in IDB
    const envelope = JSON.stringify({
      saveName: 'Auto-Save',
      timestamp: new Date().toISOString(),
      version: 6,
      state: { agencyName: 'NASA' },
    });
    const compressed = compressSaveData(envelope);
    _idbStore.set('spaceAgencySave_3', compressed);

    // Fill slots 0-2 with manual saves (not auto-saves)
    for (let i = 0; i < 3; i++) {
      const manualEnvelope = JSON.stringify({
        saveName: `Save ${i}`,
        timestamp: new Date().toISOString(),
        version: 6,
        state: { agencyName: 'NASA' },
      });
      _idbStore.set(`spaceAgencySave_${i}`, compressSaveData(manualEnvelope));
    }

    const state = freshState();
    state.agencyName = 'NASA';
    const result = await performAutoSave(state);

    expect(result.success).toBe(true);
    // Should have reused slot 3 (the existing auto-save for NASA)
    const raw = _idbStore.get('spaceAgencySave_3');
    expect(raw).toBeDefined();
    const json = decompressSaveData(raw!);
    const saved = JSON.parse(json);
    expect(saved.saveName).toBe('NASA');
    expect(saved.autoSave).toBe(true);
    expect(saved.state.agencyName).toBe('NASA');
  });

  it('finds first empty slot when no prior auto-save exists', async () => {
    // Fill slots 0-2 with manual saves in IDB
    for (let i = 0; i < 3; i++) {
      const manualEnvelope = JSON.stringify({
        saveName: `Save ${i}`,
        timestamp: new Date().toISOString(),
        version: 6,
        state: { agencyName: 'SpaceX' },
      });
      _idbStore.set(`spaceAgencySave_${i}`, compressSaveData(manualEnvelope));
    }

    const state = freshState();
    state.agencyName = 'SpaceX';
    const result = await performAutoSave(state);

    expect(result.success).toBe(true);
    // Should use slot 3 (first empty after 0-2)
    expect(_idbStore.has('spaceAgencySave_3')).toBe(true);
  });
});

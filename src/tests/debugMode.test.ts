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
  saveGame,
  loadGame,
  compressSaveData,
  SAVE_VERSION,
  _setSessionStartTimeForTesting,
} from '../core/saveload.ts';
import { _resetCacheForTesting as _resetSettingsCache } from '../core/settingsStore.ts';

beforeEach(() => {
  _idbStore.clear();
  _resetSettingsCache();
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

// ---------------------------------------------------------------------------
// debugMode default
// ---------------------------------------------------------------------------

describe('debugMode default', () => {
  it('defaults to false in createGameState()', () => {
    const state = freshState();
    expect(state.debugMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// debugMode toggle
// ---------------------------------------------------------------------------

describe('debugMode toggle', () => {
  it('can be toggled to true', () => {
    const state = freshState();
    expect(state.debugMode).toBe(false);
    state.debugMode = true;
    expect(state.debugMode).toBe(true);
  });

  it('can be toggled back to false', () => {
    const state = freshState();
    state.debugMode = true;
    state.debugMode = false;
    expect(state.debugMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// debugMode persistence
// ---------------------------------------------------------------------------

describe('debugMode persistence', () => {
  it('persists debugMode=true through save/load round-trip', async () => {
    const state = freshState();
    state.debugMode = true;
    state.agencyName = 'Debug Test Agency';

    await saveGame(state, 0);
    const restored = await loadGame(0);

    expect(restored.debugMode).toBe(true);
  });

  it('persists debugMode=false through save/load round-trip', async () => {
    const state = freshState();
    state.debugMode = false;
    state.agencyName = 'No Debug Agency';

    await saveGame(state, 0);
    const restored = await loadGame(0);

    expect(restored.debugMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// debugMode save migration
// ---------------------------------------------------------------------------

describe('debugMode save migration', () => {
  it('defaults debugMode to false for legacy saves missing the field', async () => {
    const state = freshState();
    // @ts-expect-error Simulating a legacy save missing the debugMode field
    delete state.debugMode;
    state.agencyName = 'Legacy Agency';

    const legacyEnvelope = {
      saveName: 'Legacy Save',
      timestamp: new Date().toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)),
    };
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify(legacyEnvelope)));

    const restored = await loadGame(0);
    expect(restored.debugMode).toBe(false);
  });

  it('preserves debugMode=true from existing saves', async () => {
    const state = freshState();
    state.debugMode = true;
    state.agencyName = 'Debug Agency';

    const envelope = {
      saveName: 'Debug Save',
      timestamp: new Date().toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)),
    };
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify(envelope)));

    const restored = await loadGame(0);
    expect(restored.debugMode).toBe(true);
  });
});

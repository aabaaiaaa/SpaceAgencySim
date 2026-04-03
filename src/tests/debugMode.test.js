/**
 * debugMode.test.js — Unit tests for the debug mode toggle feature.
 *
 * Tests cover:
 *   - debugMode defaults to false in createGameState()
 *   - debugMode persists through save/load round-trip
 *   - Save migration defaults debugMode to false for legacy saves
 *   - debugMode toggle mutates state correctly
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.js';
import {
  saveGame,
  loadGame,
  _setSessionStartTimeForTesting,
} from '../core/saveload.js';

// ---------------------------------------------------------------------------
// localStorage mock (same pattern as saveload.test.js)
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
  vi.setSystemTime(0);
  _setSessionStartTimeForTesting(0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshState() {
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
  it('persists debugMode=true through save/load round-trip', () => {
    const state = freshState();
    state.debugMode = true;
    state.agencyName = 'Debug Test Agency';

    saveGame(state, 0);
    const restored = loadGame(0);

    expect(restored.debugMode).toBe(true);
  });

  it('persists debugMode=false through save/load round-trip', () => {
    const state = freshState();
    state.debugMode = false;
    state.agencyName = 'No Debug Agency';

    saveGame(state, 0);
    const restored = loadGame(0);

    expect(restored.debugMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// debugMode save migration
// ---------------------------------------------------------------------------

describe('debugMode save migration', () => {
  it('defaults debugMode to false for legacy saves missing the field', () => {
    const state = freshState();
    delete state.debugMode;
    state.agencyName = 'Legacy Agency';

    const legacyEnvelope = {
      saveName: 'Legacy Save',
      timestamp: new Date().toISOString(),
      version: 1,
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(legacyEnvelope));

    const restored = loadGame(0);
    expect(restored.debugMode).toBe(false);
  });

  it('preserves debugMode=true from existing saves', () => {
    const state = freshState();
    state.debugMode = true;
    state.agencyName = 'Debug Agency';

    const envelope = {
      saveName: 'Debug Save',
      timestamp: new Date().toISOString(),
      version: 1,
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(envelope));

    const restored = loadGame(0);
    expect(restored.debugMode).toBe(true);
  });
});

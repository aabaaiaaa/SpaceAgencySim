import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import {
  saveGame,
  loadGame,
  _setSessionStartTimeForTesting,
} from '../core/saveload.ts';

// ---------------------------------------------------------------------------
// localStorage mock (same pattern as saveload.test.js)
// ---------------------------------------------------------------------------

interface LocalStorageMock {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  readonly length: number;
}

function createLocalStorageMock(): LocalStorageMock {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null { return store.has(key) ? store.get(key)! : null; },
    setItem(key: string, value: string): void { store.set(key, String(value)); },
    removeItem(key: string): void { store.delete(key); },
    clear(): void { store.clear(); },
    get length(): number { return store.size; },
  };
}

let mockStorage: LocalStorageMock;

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
      version: 1,
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(legacyEnvelope));

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
      version: 1,
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(envelope));

    const restored = await loadGame(0);
    expect(restored.debugMode).toBe(true);
  });
});

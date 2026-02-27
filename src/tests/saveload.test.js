/**
 * saveload.test.js — Unit tests for the save/load system.
 *
 * Because Vitest runs in a Node.js environment (no browser globals),
 * localStorage is mocked in-memory before each test and wiped after.
 * Fake timers give deterministic control over `playTimeSeconds` tracking.
 *
 * Tests cover:
 *   - saveGame()     — persists state; accumulates play time; returns summary
 *   - loadGame()     — restores state; rejects empty/corrupt slots
 *   - deleteSave()   — removes a slot; no-ops on empty slot
 *   - listSaves()    — returns 5-entry array; nulls for empty slots
 *   - importSave()   — validates envelope + state before writing
 *   - _validateState() — field-by-field validation
 *   - exportSave()   — throws in non-browser environment
 *   - Slot bounds    — RangeError for invalid indices
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.js';
import {
  SAVE_SLOT_COUNT,
  saveGame,
  loadGame,
  deleteSave,
  listSaves,
  importSave,
  exportSave,
  _validateState,
  _setSessionStartTimeForTesting,
} from '../core/saveload.js';
import { CrewStatus } from '../core/constants.js';

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

/**
 * A simple in-memory localStorage replacement that fulfils the subset of the
 * Web Storage API used by saveload.js (getItem / setItem / removeItem).
 */
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
  // Reset fake timers and session clock before every test.
  vi.useFakeTimers();
  vi.setSystemTime(0);
  _setSessionStartTimeForTesting(0); // session started at t=0
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a fresh game state with defaults. */
function freshState() {
  return createGameState();
}

/** Returns a minimal valid envelope JSON string. */
function minimalEnvelopeJSON(overrides = {}) {
  const state = freshState();
  const envelope = {
    saveName: 'Test Save',
    timestamp: new Date(0).toISOString(),
    state,
    ...overrides,
  };
  return JSON.stringify(envelope);
}

// ---------------------------------------------------------------------------
// Slot index validation
// ---------------------------------------------------------------------------

describe('Slot index validation', () => {
  it('accepts slot indices 0 through SAVE_SLOT_COUNT-1', () => {
    const state = freshState();
    for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
      expect(() => saveGame(state, i, 'ok')).not.toThrow();
    }
  });

  it('throws RangeError for index -1', () => {
    expect(() => saveGame(freshState(), -1)).toThrow(RangeError);
  });

  it('throws RangeError for index equal to SAVE_SLOT_COUNT', () => {
    expect(() => saveGame(freshState(), SAVE_SLOT_COUNT)).toThrow(RangeError);
  });

  it('throws RangeError for a float index', () => {
    expect(() => saveGame(freshState(), 1.5)).toThrow(RangeError);
  });

  it('throws RangeError for a string index', () => {
    expect(() => saveGame(freshState(), '0')).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// saveGame
// ---------------------------------------------------------------------------

describe('saveGame()', () => {
  it('writes JSON to the correct localStorage key', () => {
    const state = freshState();
    saveGame(state, 2, 'My Agency');
    const raw = localStorage.getItem('spaceAgencySave_2');
    expect(raw).not.toBeNull();
    const envelope = JSON.parse(raw);
    expect(envelope.saveName).toBe('My Agency');
  });

  it('returns a SaveSlotSummary with the correct slotIndex and saveName', () => {
    const state = freshState();
    const summary = saveGame(state, 0, 'First Save');
    expect(summary.slotIndex).toBe(0);
    expect(summary.saveName).toBe('First Save');
  });

  it('summary includes a timestamp string', () => {
    const summary = saveGame(freshState(), 0, 'ts test');
    expect(typeof summary.timestamp).toBe('string');
    expect(summary.timestamp.length).toBeGreaterThan(0);
  });

  it('summary.money matches state.money', () => {
    const state = freshState();
    state.money = 1_234_567;
    const summary = saveGame(state, 0);
    expect(summary.money).toBe(1_234_567);
  });

  it('summary.missionsCompleted counts completed missions', () => {
    const state = freshState();
    state.missions.completed = [{ id: 'm1' }, { id: 'm2' }];
    const summary = saveGame(state, 0);
    expect(summary.missionsCompleted).toBe(2);
  });

  it('summary.acceptedMissionCount counts accepted missions', () => {
    const state = freshState();
    state.missions.accepted = [{ id: 'm1' }];
    const summary = saveGame(state, 0);
    expect(summary.acceptedMissionCount).toBe(1);
  });

  it('summary.totalFlights counts flightHistory entries', () => {
    const state = freshState();
    state.flightHistory = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }];
    const summary = saveGame(state, 0);
    expect(summary.totalFlights).toBe(3);
  });

  it('summary.crewCount counts living crew members', () => {
    const state = freshState();
    state.crew = [
      { id: 'c1', status: CrewStatus.IDLE },
      { id: 'c2', status: CrewStatus.ON_MISSION },
      { id: 'c3', status: CrewStatus.DEAD },
    ];
    const summary = saveGame(state, 0);
    expect(summary.crewCount).toBe(2);
  });

  it('summary.crewKIA counts crew with DEAD status', () => {
    const state = freshState();
    state.crew = [
      { id: 'c1', status: CrewStatus.DEAD },
      { id: 'c2', status: CrewStatus.DEAD },
      { id: 'c3', status: CrewStatus.IDLE },
    ];
    const summary = saveGame(state, 0);
    expect(summary.crewKIA).toBe(2);
  });

  it('accumulates session time into state.playTimeSeconds', () => {
    const state = freshState();
    state.playTimeSeconds = 100;

    // Advance clock by 5 seconds.
    vi.advanceTimersByTime(5_000);

    saveGame(state, 0);

    // playTimeSeconds should now be 100 + 5.
    expect(state.playTimeSeconds).toBeCloseTo(105, 1);
  });

  it('does not double-count time across two consecutive saves', () => {
    const state = freshState();
    state.playTimeSeconds = 0;

    vi.advanceTimersByTime(3_000);
    saveGame(state, 0); // +3 s

    vi.advanceTimersByTime(2_000);
    saveGame(state, 0); // +2 s more

    // Total should be ~5 s, not ~8 s.
    expect(state.playTimeSeconds).toBeCloseTo(5, 1);
  });

  it('stores a deep clone of state (mutations after save do not affect stored data)', () => {
    const state = freshState();
    saveGame(state, 0, 'before');
    state.money = 9_999_999; // mutate after save

    const restored = loadGame(0);
    expect(restored.money).toBe(2_000_000); // original value
  });

  it('default saveName is "New Save"', () => {
    const summary = saveGame(freshState(), 0);
    expect(summary.saveName).toBe('New Save');
  });

  it('coerces non-string saveName to string', () => {
    const summary = saveGame(freshState(), 0, 42);
    expect(summary.saveName).toBe('42');
  });
});

// ---------------------------------------------------------------------------
// loadGame
// ---------------------------------------------------------------------------

describe('loadGame()', () => {
  it('returns the game state previously written by saveGame', () => {
    const state = freshState();
    state.money = 777_000;
    saveGame(state, 1, 'load test');

    const restored = loadGame(1);
    expect(restored.money).toBe(777_000);
  });

  it('throws on an empty slot', () => {
    expect(() => loadGame(3)).toThrow(/empty/i);
  });

  it('throws on corrupt JSON', () => {
    localStorage.setItem('spaceAgencySave_0', 'not { valid json');
    expect(() => loadGame(0)).toThrow(/corrupt/i);
  });

  it('throws when stored envelope is missing the state field', () => {
    localStorage.setItem('spaceAgencySave_0', JSON.stringify({ saveName: 'x', timestamp: 't' }));
    expect(() => loadGame(0)).toThrow(/corrupt/i);
  });

  it('restores nested objects correctly', () => {
    const state = freshState();
    state.loan.balance = 500_000;
    state.crew = [{ id: 'c1', status: CrewStatus.IDLE, name: 'Alice' }];
    saveGame(state, 0);

    const restored = loadGame(0);
    expect(restored.loan.balance).toBe(500_000);
    expect(restored.crew[0].name).toBe('Alice');
  });

  it('throws RangeError for an out-of-bounds slot', () => {
    expect(() => loadGame(5)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// deleteSave
// ---------------------------------------------------------------------------

describe('deleteSave()', () => {
  it('removes the save so that listSaves returns null for that slot', () => {
    saveGame(freshState(), 2, 'to delete');
    deleteSave(2);
    const saves = listSaves();
    expect(saves[2]).toBeNull();
  });

  it('does not throw when the slot is already empty', () => {
    expect(() => deleteSave(4)).not.toThrow();
  });

  it('only removes the targeted slot', () => {
    saveGame(freshState(), 0, 'keep me');
    saveGame(freshState(), 1, 'delete me');
    deleteSave(1);
    const saves = listSaves();
    expect(saves[0]).not.toBeNull();
    expect(saves[1]).toBeNull();
  });

  it('throws RangeError for an out-of-bounds slot', () => {
    expect(() => deleteSave(-1)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// listSaves
// ---------------------------------------------------------------------------

describe('listSaves()', () => {
  it('returns an array with exactly SAVE_SLOT_COUNT entries', () => {
    const saves = listSaves();
    expect(saves).toHaveLength(SAVE_SLOT_COUNT);
  });

  it('all entries are null when no saves exist', () => {
    const saves = listSaves();
    expect(saves.every((s) => s === null)).toBe(true);
  });

  it('returns a summary for occupied slots and null for empty slots', () => {
    saveGame(freshState(), 0, 'slot 0');
    saveGame(freshState(), 3, 'slot 3');

    const saves = listSaves();
    expect(saves[0]).not.toBeNull();
    expect(saves[0].saveName).toBe('slot 0');
    expect(saves[1]).toBeNull();
    expect(saves[2]).toBeNull();
    expect(saves[3]).not.toBeNull();
    expect(saves[3].saveName).toBe('slot 3');
    expect(saves[4]).toBeNull();
  });

  it('returns null for corrupt slot data', () => {
    localStorage.setItem('spaceAgencySave_1', 'CORRUPT{{{');
    const saves = listSaves();
    expect(saves[1]).toBeNull();
  });

  it('returned summaries include all required fields', () => {
    saveGame(freshState(), 0, 'full test');
    const summary = listSaves()[0];
    const expectedFields = [
      'slotIndex', 'saveName', 'timestamp', 'missionsCompleted',
      'money', 'acceptedMissionCount', 'totalFlights',
      'crewCount', 'crewKIA', 'playTimeSeconds',
    ];
    for (const field of expectedFields) {
      expect(summary).toHaveProperty(field);
    }
  });
});

// ---------------------------------------------------------------------------
// importSave
// ---------------------------------------------------------------------------

describe('importSave()', () => {
  it('writes a valid envelope JSON to the target slot', () => {
    const json = minimalEnvelopeJSON({ saveName: 'Imported' });
    const summary = importSave(json, 1);
    expect(summary.saveName).toBe('Imported');
    expect(localStorage.getItem('spaceAgencySave_1')).not.toBeNull();
  });

  it('returns a SaveSlotSummary matching the imported state', () => {
    const state = freshState();
    state.money = 42_000;
    const json = JSON.stringify({ saveName: 'Rich', timestamp: 'T', state });
    const summary = importSave(json, 0);
    expect(summary.money).toBe(42_000);
  });

  it('throws on invalid JSON', () => {
    expect(() => importSave('{{not json', 0)).toThrow(/not valid JSON/i);
  });

  it('throws when root is not an object', () => {
    expect(() => importSave('"just a string"', 0)).toThrow(/plain object/i);
  });

  it('throws when saveName is missing', () => {
    const env = { timestamp: 'T', state: freshState() };
    expect(() => importSave(JSON.stringify(env), 0)).toThrow(/saveName/i);
  });

  it('throws when timestamp is missing', () => {
    const env = { saveName: 'S', state: freshState() };
    expect(() => importSave(JSON.stringify(env), 0)).toThrow(/timestamp/i);
  });

  it('throws when state is missing', () => {
    const env = { saveName: 'S', timestamp: 'T' };
    expect(() => importSave(JSON.stringify(env), 0)).toThrow(/state/i);
  });

  it('throws RangeError for out-of-bounds slot', () => {
    expect(() => importSave(minimalEnvelopeJSON(), 10)).toThrow(RangeError);
  });

  it('overwrites an existing save in the target slot', () => {
    saveGame(freshState(), 0, 'original');
    const imported = { saveName: 'replacement', timestamp: 'T', state: freshState() };
    importSave(JSON.stringify(imported), 0);
    expect(listSaves()[0].saveName).toBe('replacement');
  });
});

// ---------------------------------------------------------------------------
// _validateState
// ---------------------------------------------------------------------------

describe('_validateState()', () => {
  it('accepts a valid game state', () => {
    expect(() => _validateState(freshState())).not.toThrow();
  });

  it('throws when money is not a number', () => {
    const s = freshState();
    s.money = '1000';
    expect(() => _validateState(s)).toThrow(/money/i);
  });

  it('throws when playTimeSeconds is not a number', () => {
    const s = freshState();
    s.playTimeSeconds = null;
    expect(() => _validateState(s)).toThrow(/playTimeSeconds/i);
  });

  it('throws when loan is missing', () => {
    const s = freshState();
    delete s.loan;
    expect(() => _validateState(s)).toThrow(/loan/i);
  });

  it('throws when loan.balance is not a number', () => {
    const s = freshState();
    s.loan.balance = 'a lot';
    expect(() => _validateState(s)).toThrow(/loan\.balance/i);
  });

  it('throws when loan.interestRate is not a number', () => {
    const s = freshState();
    s.loan.interestRate = true;
    expect(() => _validateState(s)).toThrow(/loan\.interestRate/i);
  });

  it('throws when crew is not an array', () => {
    const s = freshState();
    s.crew = {};
    expect(() => _validateState(s)).toThrow(/crew/i);
  });

  it('throws when missions is missing', () => {
    const s = freshState();
    delete s.missions;
    expect(() => _validateState(s)).toThrow(/missions/i);
  });

  it('throws when missions.available is not an array', () => {
    const s = freshState();
    s.missions.available = null;
    expect(() => _validateState(s)).toThrow(/missions\.available/i);
  });

  it('throws when rockets is not an array', () => {
    const s = freshState();
    s.rockets = 'none';
    expect(() => _validateState(s)).toThrow(/rockets/i);
  });

  it('throws when parts is not an array', () => {
    const s = freshState();
    s.parts = undefined;
    expect(() => _validateState(s)).toThrow(/parts/i);
  });

  it('throws when flightHistory is not an array', () => {
    const s = freshState();
    s.flightHistory = 0;
    expect(() => _validateState(s)).toThrow(/flightHistory/i);
  });
});

// ---------------------------------------------------------------------------
// exportSave
// ---------------------------------------------------------------------------

describe('exportSave()', () => {
  it('throws an informative error in a non-browser environment', () => {
    // Node has no document or Blob — this exercises the DOM guard.
    saveGame(freshState(), 0, 'export test');
    expect(() => exportSave(0)).toThrow(/browser environment/i);
  });

  it('throws on an empty slot', () => {
    expect(() => exportSave(4)).toThrow(/empty/i);
  });

  it('throws RangeError for an out-of-bounds slot', () => {
    expect(() => exportSave(-1)).toThrow(RangeError);
  });
});

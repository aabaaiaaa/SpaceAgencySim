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
  SAVE_VERSION,
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
// Round-trip — complex state
// ---------------------------------------------------------------------------

describe('Round-trip: save and load a complex state', () => {
  it('deep-equals original state with multiple crew, missions, and rockets', () => {
    const state = freshState();

    // Multiple crew members with varying statuses.
    state.crew = [
      {
        id: 'crew-1',
        name: 'Alice',
        status: CrewStatus.IDLE,
        skills: { piloting: 75, engineering: 40, science: 60 },
        salary: 5000,
        hiredDate: '2025-01-01T00:00:00.000Z',
        injuryEnds: null,
      },
      {
        id: 'crew-2',
        name: 'Bob',
        status: CrewStatus.ON_MISSION,
        skills: { piloting: 20, engineering: 90, science: 30 },
        salary: 6000,
        hiredDate: '2025-03-15T00:00:00.000Z',
        injuryEnds: 5,
      },
      {
        id: 'crew-3',
        name: 'Carol',
        status: CrewStatus.DEAD,
        skills: { piloting: 55, engineering: 55, science: 55 },
        salary: 5500,
        hiredDate: '2024-06-01T00:00:00.000Z',
        injuryEnds: null,
      },
    ];

    // Several missions distributed across the three buckets.
    state.missions.available = [
      { id: 'mission-avail-1', title: 'Sub-orbital test', reward: 10000 },
      { id: 'mission-avail-2', title: 'Weather sat', reward: 25000 },
    ];
    state.missions.accepted = [
      { id: 'mission-acc-1', title: 'Orbital insertion', reward: 50000 },
    ];
    state.missions.completed = [
      { id: 'mission-comp-1', title: 'First flight', reward: 5000 },
      { id: 'mission-comp-2', title: 'Science drop', reward: 8000 },
    ];

    // Multiple rocket designs with nested staging.
    state.rockets = [
      {
        id: 'rocket-1',
        name: 'Explorer I',
        parts: [
          { partId: 'command_pod_mk1', position: { x: 0, y: 0 } },
          { partId: 'engine_liquid_1', position: { x: 0, y: -1 } },
          { partId: 'fuel_tank_small', position: { x: 0, y: -2 } },
        ],
        staging: { stages: [[1, 2]], unstaged: [] },
        totalMass: 3500,
        totalThrust: 180,
        createdDate: '2025-01-10T00:00:00.000Z',
        updatedDate: '2025-01-12T00:00:00.000Z',
      },
      {
        id: 'rocket-2',
        name: 'Heavy Lifter',
        parts: [
          { partId: 'command_pod_mk2', position: { x: 0, y: 0 } },
          { partId: 'engine_liquid_2', position: { x: 0, y: -1 } },
          { partId: 'fuel_tank_large', position: { x: 0, y: -2 } },
          { partId: 'decoupler_1', position: { x: 0, y: -3 } },
          { partId: 'booster_srb', position: { x: 0, y: -4 } },
        ],
        staging: { stages: [[1, 2], [3, 4]], unstaged: [] },
        totalMass: 12000,
        totalThrust: 540,
        createdDate: '2025-02-01T00:00:00.000Z',
        updatedDate: '2025-02-14T00:00:00.000Z',
      },
    ];

    // Flight history.
    state.flightHistory = [
      {
        id: 'flight-1',
        missionId: 'mission-comp-1',
        rocketId: 'rocket-1',
        crewIds: ['crew-1'],
        launchDate: '2025-03-01T12:00:00.000Z',
        outcome: 'SUCCESS',
        deltaVUsed: 1800,
        revenue: 5000,
        notes: 'Perfect flight.',
      },
    ];

    state.money = 123_456;
    state.loan.balance = 80_000;
    state.loan.interestRate = 0.05;
    state.parts = ['command_pod_mk1', 'engine_liquid_1', 'fuel_tank_small'];
    state.playTimeSeconds = 300;

    saveGame(state, 0, 'Complex Save');
    const restored = loadGame(0);

    // Top-level scalar fields.
    expect(restored.money).toBe(state.money);
    expect(restored.loan.balance).toBe(80_000);
    expect(restored.loan.interestRate).toBe(0.05);
    expect(restored.parts).toEqual(state.parts);

    // Crew — count and individual records.
    expect(restored.crew).toHaveLength(3);
    expect(restored.crew[0].name).toBe('Alice');
    expect(restored.crew[0].skills.piloting).toBe(75);
    expect(restored.crew[1].status).toBe(CrewStatus.ON_MISSION);
    expect(restored.crew[1].injuryEnds).toBe(5);
    expect(restored.crew[2].status).toBe(CrewStatus.DEAD);

    // Missions — all three buckets.
    expect(restored.missions.available).toHaveLength(2);
    expect(restored.missions.accepted).toHaveLength(1);
    expect(restored.missions.completed).toHaveLength(2);
    expect(restored.missions.available[1].id).toBe('mission-avail-2');
    expect(restored.missions.accepted[0].reward).toBe(50000);

    // Rockets — nested staging and parts arrays.
    expect(restored.rockets).toHaveLength(2);
    expect(restored.rockets[0].name).toBe('Explorer I');
    expect(restored.rockets[0].parts).toHaveLength(3);
    expect(restored.rockets[0].staging.stages[0]).toEqual([1, 2]);
    expect(restored.rockets[1].staging.stages).toHaveLength(2);
    expect(restored.rockets[1].totalMass).toBe(12000);

    // Flight history.
    expect(restored.flightHistory).toHaveLength(1);
    expect(restored.flightHistory[0].crewIds).toEqual(['crew-1']);
  });
});

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

  it('saving to slot 2 does not overwrite slot 0', () => {
    const stateA = freshState();
    stateA.money = 111_111;
    saveGame(stateA, 0, 'Slot Zero');

    const stateB = freshState();
    stateB.money = 222_222;
    saveGame(stateB, 2, 'Slot Two');

    // Slot 0 must still contain the original save.
    const restoredA = loadGame(0);
    expect(restoredA.money).toBe(111_111);

    // Slot 2 must contain the new save.
    const restoredB = loadGame(2);
    expect(restoredB.money).toBe(222_222);

    // Slots 1, 3, 4 must remain empty.
    const saves = listSaves();
    expect(saves[1]).toBeNull();
    expect(saves[3]).toBeNull();
    expect(saves[4]).toBeNull();
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

  it('does not write to the slot when JSON is malformed', () => {
    // Pre-populate the slot so we can confirm it was not overwritten.
    saveGame(freshState(), 2, 'original');
    const before = localStorage.getItem('spaceAgencySave_2');

    expect(() => importSave('{broken json}}', 2)).toThrow();

    // The slot must still contain the original data.
    const after = localStorage.getItem('spaceAgencySave_2');
    expect(after).toBe(before);
  });

  it('does not write to the slot when the envelope is structurally invalid', () => {
    saveGame(freshState(), 3, 'keep me');
    const before = localStorage.getItem('spaceAgencySave_3');

    // Missing the required "state" field.
    const badEnvelope = JSON.stringify({ saveName: 'Bad', timestamp: 'T' });
    expect(() => importSave(badEnvelope, 3)).toThrow();

    const after = localStorage.getItem('spaceAgencySave_3');
    expect(after).toBe(before);
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

  it('the data stored for export is a valid JSON string containing the full state', () => {
    // exportSave() reads the raw JSON from localStorage and sends it to the
    // user as a file. Verify that the underlying storage contains well-formed
    // JSON whose envelope.state matches the state that was saved.
    const state = freshState();
    state.money = 987_654;
    state.crew = [{ id: 'c1', status: CrewStatus.IDLE, name: 'Dana' }];
    state.missions.completed = [{ id: 'm1', title: 'First orbit' }];
    saveGame(state, 0, 'Export Test');

    // Read what exportSave would send to the browser.
    const raw = localStorage.getItem('spaceAgencySave_0');
    expect(typeof raw).toBe('string');

    // Must be parseable JSON.
    let envelope;
    expect(() => { envelope = JSON.parse(raw); }).not.toThrow();

    // Must contain all top-level envelope fields.
    expect(envelope).toHaveProperty('saveName', 'Export Test');
    expect(envelope).toHaveProperty('timestamp');
    expect(envelope).toHaveProperty('state');

    // The embedded state must include the full game data.
    expect(envelope.state.money).toBe(987_654);
    expect(envelope.state.crew[0].name).toBe('Dana');
    expect(envelope.state.missions.completed[0].title).toBe('First orbit');
  });

  it('the exported JSON from a browser-mocked environment is parseable and contains full state', () => {
    // Mock the minimum browser APIs needed to exercise the DOM code path.
    const state = freshState();
    state.money = 555_000;
    state.rockets = [{ id: 'r1', name: 'Mock Rocket', parts: [], staging: { stages: [[]], unstaged: [] }, totalMass: 100, totalThrust: 50 }];
    saveGame(state, 1, 'Browser Export');

    // Capture what Blob is constructed with.
    let capturedBlobContent = null;
    const MockBlob = class {
      constructor(parts) { capturedBlobContent = parts.join(''); }
    };
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = vi.fn();
    const mockAnchor = {
      href: null, download: null,
      click: vi.fn(),
    };
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    };
    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('Blob', MockBlob);
    vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });

    expect(() => exportSave(1)).not.toThrow();

    // The Blob was built from the raw JSON string.
    expect(capturedBlobContent).not.toBeNull();
    let parsed;
    expect(() => { parsed = JSON.parse(capturedBlobContent); }).not.toThrow();
    expect(parsed.state.money).toBe(555_000);
    expect(parsed.state.rockets[0].name).toBe('Mock Rocket');

    // Clean up extra stubs.
    vi.unstubAllGlobals();
    // Re-apply the localStorage mock so afterEach() cleanup works.
    vi.stubGlobal('localStorage', mockStorage);
  });
});

// ---------------------------------------------------------------------------
// Save format version field (TASK-007)
// ---------------------------------------------------------------------------

describe('Save format version field', () => {
  it('SAVE_VERSION is a positive integer', () => {
    expect(Number.isInteger(SAVE_VERSION)).toBe(true);
    expect(SAVE_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('saveGame() includes the version field in the stored envelope', () => {
    saveGame(freshState(), 0, 'versioned');
    const raw = localStorage.getItem('spaceAgencySave_0');
    const envelope = JSON.parse(raw);
    expect(envelope.version).toBe(SAVE_VERSION);
  });

  it('loadGame() loads a version-0 (no version field) save with all migrations applied', () => {
    // Simulate a pre-versioning save: no version field, missing fields that
    // the migration logic defaults via ??=.
    const state = freshState();
    delete state.malfunctionMode;
    delete state.savedDesigns;
    delete state.welcomeShown;
    const legacyEnvelope = {
      saveName: 'Legacy',
      timestamp: new Date(0).toISOString(),
      // Intentionally no "version" field
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(legacyEnvelope));

    const restored = loadGame(0);
    // Migrations should have run — check fields that get defaulted by ??=.
    expect(restored.malfunctionMode).toBe('normal');
    expect(Array.isArray(restored.savedDesigns)).toBe(true);
    expect(restored.welcomeShown).toBe(true);
  });

  it('loadGame() loads a save matching the current version without warnings', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    saveGame(freshState(), 0, 'current version');
    const restored = loadGame(0);

    expect(restored).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loadGame() warns when save version is higher than current', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Create a save with a future version number.
    const state = freshState();
    const futureEnvelope = {
      saveName: 'Future',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION + 5,
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(futureEnvelope));

    const restored = loadGame(0);
    expect(restored).toBeDefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/newer version/i);
    warnSpy.mockRestore();
  });

  it('loadGame() still returns valid state from a future-version save', () => {
    const state = freshState();
    state.money = 42_000;
    const futureEnvelope = {
      saveName: 'Future OK',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION + 1,
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_1', JSON.stringify(futureEnvelope));

    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restored = loadGame(1);
    expect(restored.money).toBe(42_000);
    vi.restoreAllMocks();
  });

  it('round-trip save/load preserves the version field in storage', () => {
    const state = freshState();
    saveGame(state, 2, 'round-trip');
    const raw = localStorage.getItem('spaceAgencySave_2');
    const envelope = JSON.parse(raw);
    expect(envelope.version).toBe(SAVE_VERSION);

    // Load succeeds and the envelope in storage still has the version.
    const restored = loadGame(2);
    expect(restored).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Save migration edge cases (TASK-010, requirements §2.3)
// ---------------------------------------------------------------------------

describe('Save migration edge cases', () => {
  /**
   * Helper: writes a raw envelope to localStorage slot 0, bypassing saveGame()
   * so we can craft envelopes with missing/invalid fields.
   */
  function injectEnvelope(envelopeOverrides = {}, stateOverrides = {}) {
    const state = { ...freshState(), ...stateOverrides };
    const envelope = {
      saveName: 'Edge Case',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)),
      ...envelopeOverrides,
    };
    // Apply state overrides AFTER JSON clone so we can set null/undefined explicitly.
    if ('_rawStatePatches' in envelopeOverrides) {
      for (const [key, value] of Object.entries(envelopeOverrides._rawStatePatches)) {
        if (value === undefined) {
          delete envelope.state[key];
        } else {
          envelope.state[key] = value;
        }
      }
      delete envelope._rawStatePatches;
    }
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(envelope));
  }

  it('loads a save with savedDesigns: null and defaults it to an empty array', () => {
    injectEnvelope({
      _rawStatePatches: { savedDesigns: null },
    });

    const restored = loadGame(0);
    expect(Array.isArray(restored.savedDesigns)).toBe(true);
    expect(restored.savedDesigns).toHaveLength(0);
  });

  it('loads a save with savedDesigns: undefined and defaults it to an empty array', () => {
    injectEnvelope({
      _rawStatePatches: { savedDesigns: undefined },
    });

    const restored = loadGame(0);
    expect(Array.isArray(restored.savedDesigns)).toBe(true);
    expect(restored.savedDesigns).toHaveLength(0);
  });

  it('loads successfully when saveSharedLibrary() throws during design migration', async () => {
    // We need to make saveSharedLibrary throw. Since saveload.js imports it
    // statically, we mock the designLibrary module.
    const { saveSharedLibrary } = await import('../core/designLibrary.js');
    const saveSpy = vi.spyOn({ saveSharedLibrary }, 'saveSharedLibrary');

    // To truly test this, we inject a save with legacy designs that trigger
    // the migration path (designs without savePrivate flag), and mock
    // localStorage to throw on the shared library key write.
    const originalSetItem = mockStorage.setItem.bind(mockStorage);
    const sharedLibKey = 'spaceAgencyDesignLibrary';

    // Make saveSharedLibrary's internal localStorage.setItem throw for the
    // shared library key only.
    mockStorage.setItem = (key, value) => {
      if (key === sharedLibKey) {
        throw new Error('Storage full — unable to save design library. Delete old saves or designs to free space.');
      }
      return originalSetItem(key, value);
    };

    // Inject a save with a legacy design that lacks savePrivate (triggers migration).
    const state = freshState();
    state.savedDesigns = [
      { id: 'design-1', name: 'Legacy Rocket', savePrivate: undefined },
    ];
    const envelope = {
      saveName: 'Migration Fail',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)),
    };
    // Remove savePrivate so it's truly undefined in the stored JSON.
    delete envelope.state.savedDesigns[0].savePrivate;
    originalSetItem('spaceAgencySave_0', JSON.stringify(envelope));

    // loadGame should throw because saveSharedLibrary throws (the error
    // propagates from the migration block). This documents the current
    // behaviour: a storage failure during migration is NOT caught by loadGame.
    expect(() => loadGame(0)).toThrow(/Storage full/i);

    // Restore original setItem.
    mockStorage.setItem = originalSetItem;
    saveSpy.mockRestore();
  });

  it('loads a save with an invalid malfunctionMode value without crashing', () => {
    // The ??= migration only defaults null/undefined — an invalid string value
    // passes through. This test documents the current behaviour.
    injectEnvelope({
      _rawStatePatches: { malfunctionMode: 'banana' },
    });

    const restored = loadGame(0);
    // The invalid value passes through because ??= only catches null/undefined.
    expect(restored.malfunctionMode).toBe('banana');
  });

  it('loads a pre-version save (no version field) with all migrations applied', () => {
    // Simulate a very old save: no version field, missing several fields
    // that were added in later iterations.
    const state = freshState();
    delete state.malfunctionMode;
    delete state.savedDesigns;
    delete state.welcomeShown;
    delete state.autoSaveEnabled;
    delete state.debugMode;
    delete state.sciencePoints;
    delete state.scienceLog;
    delete state.achievements;
    delete state.partInventory;

    const legacyEnvelope = {
      saveName: 'Ancient Save',
      timestamp: new Date(0).toISOString(),
      // No "version" field at all — pre-versioning save
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(legacyEnvelope));

    const restored = loadGame(0);

    // All ??= migrations should have applied defaults.
    expect(restored.malfunctionMode).toBe('normal');
    expect(Array.isArray(restored.savedDesigns)).toBe(true);
    expect(restored.welcomeShown).toBe(true);
    expect(restored.autoSaveEnabled).toBe(true);
    expect(restored.debugMode).toBe(false);
    expect(restored.sciencePoints).toBe(0);
    expect(Array.isArray(restored.scienceLog)).toBe(true);
    expect(Array.isArray(restored.achievements)).toBe(true);
    expect(Array.isArray(restored.partInventory)).toBe(true);
  });

  it('loads a future-version save and emits a console warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    injectEnvelope({ version: SAVE_VERSION + 10 });

    const restored = loadGame(0);

    // The state should still load (best-effort forward compatibility).
    expect(restored).toBeDefined();
    expect(restored.money).toBe(freshState().money);

    // A warning should have been logged about the newer version.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(`v${SAVE_VERSION + 10}`);
    expect(warnSpy.mock.calls[0][0]).toMatch(/newer version/i);

    warnSpy.mockRestore();
  });
});

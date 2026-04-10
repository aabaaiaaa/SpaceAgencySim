/**
 * saveload.test.ts — Unit tests for the save/load system.
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
import { createGameState } from '../core/gameState.ts';
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
  _validateNestedStructures,
  _setSessionStartTimeForTesting,
  compressSaveData,
  decompressSaveData,
} from '../core/saveload.ts';
import { crc32 } from '../core/crc32.ts';
import { AstronautStatus, CrewStatus } from '../core/constants.ts';

import type { GameState, CrewMember, MissionInstance, RocketDesign, FlightResult } from '../core/gameState.ts';
import type { SaveSlotSummary } from '../core/saveload.ts';

// Node.js Buffer is available in Vitest's Node environment but @types/node is not installed.
declare const Buffer: {
  from(str: string, encoding: string): { toString(encoding: string): string };
};

/** Minimal localStorage-compatible interface used by the mock. */
interface MockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  readonly length: number;
}

/** Shape of the parsed save envelope in localStorage. */
interface SaveEnvelope {
  saveName: string;
  timestamp: string;
  version?: number;
  state: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

/**
 * A simple in-memory localStorage replacement that fulfils the subset of the
 * Web Storage API used by saveload.js (getItem / setItem / removeItem).
 */
function createLocalStorageMock(): MockStorage {
  const store = new Map<string, string>();
  return {
    getItem(key: string): string | null { return store.has(key) ? store.get(key)! : null; },
    setItem(key: string, value: string): void { store.set(key, String(value)); },
    removeItem(key: string): void { store.delete(key); },
    clear(): void { store.clear(); },
    get length(): number { return store.size; },
  };
}

let mockStorage: MockStorage;

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
function freshState(): GameState {
  return createGameState();
}

/** Returns a minimal valid envelope JSON string. */
function minimalEnvelopeJSON(overrides: Record<string, unknown> = {}): string {
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
  it('deep-equals original state with multiple crew, missions, and rockets', async () => {
    const state = freshState();

    // Multiple crew members with varying statuses.
    state.crew = [
      {
        id: 'crew-1',
        name: 'Alice',
        status: CrewStatus.IDLE,
        skills: { piloting: 75, engineering: 40, science: 60 },
        salary: 5000,
        hireDate: '2025-01-01T00:00:00.000Z',
        injuryEnds: null,
      },
      {
        id: 'crew-2',
        name: 'Bob',
        status: CrewStatus.ON_MISSION,
        skills: { piloting: 20, engineering: 90, science: 30 },
        salary: 6000,
        hireDate: '2025-03-15T00:00:00.000Z',
        injuryEnds: 5,
      },
      {
        id: 'crew-3',
        name: 'Carol',
        status: AstronautStatus.KIA,
        skills: { piloting: 55, engineering: 55, science: 55 },
        salary: 5500,
        hireDate: '2024-06-01T00:00:00.000Z',
        injuryEnds: null,
      },
    ] as unknown as CrewMember[];

    // Several missions distributed across the three buckets.
    state.missions.available = [
      { id: 'mission-avail-1', title: 'Sub-orbital test', reward: 10000 },
      { id: 'mission-avail-2', title: 'Weather sat', reward: 25000 },
    ] as unknown as MissionInstance[];
    state.missions.accepted = [
      { id: 'mission-acc-1', title: 'Orbital insertion', reward: 50000 },
    ] as unknown as MissionInstance[];
    state.missions.completed = [
      { id: 'mission-comp-1', title: 'First flight', reward: 5000 },
      { id: 'mission-comp-2', title: 'Science drop', reward: 8000 },
    ] as unknown as MissionInstance[];

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
    ] as RocketDesign[];

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
    ] as unknown as FlightResult[];

    state.money = 123_456;
    state.loan.balance = 80_000;
    state.loan.interestRate = 0.05;
    state.parts = ['command_pod_mk1', 'engine_liquid_1', 'fuel_tank_small'];
    state.playTimeSeconds = 300;

    await saveGame(state, 0, 'Complex Save');
    const restored = await loadGame(0);

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
    expect(restored.crew[2].status).toBe(AstronautStatus.KIA);

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
  it('accepts slot indices 0 through SAVE_SLOT_COUNT-1', async () => {
    const state = freshState();
    for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
      await expect(saveGame(state, i, 'ok')).resolves.toBeDefined();
    }
  });

  it('throws RangeError for index -1', async () => {
    await expect(saveGame(freshState(), -1)).rejects.toThrow(RangeError);
  });

  it('throws RangeError for index equal to SAVE_SLOT_COUNT', async () => {
    await expect(saveGame(freshState(), SAVE_SLOT_COUNT)).rejects.toThrow(RangeError);
  });

  it('throws RangeError for a float index', async () => {
    await expect(saveGame(freshState(), 1.5)).rejects.toThrow(RangeError);
  });

  it('throws RangeError for a string index', async () => {
    // @ts-expect-error — intentionally passing wrong type to test runtime validation
    await expect(saveGame(freshState(), '0')).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// saveGame
// ---------------------------------------------------------------------------

describe('saveGame()', () => {
  it('writes compressed data to the correct localStorage key', async () => {
    const state = freshState();
    await saveGame(state, 2, 'My Agency');
    const raw = localStorage.getItem('spaceAgencySave_2');
    expect(raw).not.toBeNull();
    const json = decompressSaveData(raw!);
    const envelope = JSON.parse(json) as SaveEnvelope;
    expect(envelope.saveName).toBe('My Agency');
  });

  it('returns a SaveSlotSummary with the correct slotIndex and saveName', async () => {
    const state = freshState();
    const summary = await saveGame(state, 0, 'First Save');
    expect(summary.slotIndex).toBe(0);
    expect(summary.saveName).toBe('First Save');
  });

  it('summary includes a timestamp string', async () => {
    const summary = await saveGame(freshState(), 0, 'ts test');
    expect(typeof summary.timestamp).toBe('string');
    expect(summary.timestamp.length).toBeGreaterThan(0);
  });

  it('summary.money matches state.money', async () => {
    const state = freshState();
    state.money = 1_234_567;
    const summary = await saveGame(state, 0);
    expect(summary.money).toBe(1_234_567);
  });

  it('summary.missionsCompleted counts completed missions', async () => {
    const state = freshState();
    state.missions.completed = [{ id: 'm1' }, { id: 'm2' }] as unknown as MissionInstance[];
    const summary = await saveGame(state, 0);
    expect(summary.missionsCompleted).toBe(2);
  });

  it('summary.acceptedMissionCount counts accepted missions', async () => {
    const state = freshState();
    state.missions.accepted = [{ id: 'm1' }] as unknown as MissionInstance[];
    const summary = await saveGame(state, 0);
    expect(summary.acceptedMissionCount).toBe(1);
  });

  it('summary.totalFlights counts flightHistory entries', async () => {
    const state = freshState();
    state.flightHistory = [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }] as unknown as FlightResult[];
    const summary = await saveGame(state, 0);
    expect(summary.totalFlights).toBe(3);
  });

  it('summary.crewCount counts living crew members', async () => {
    const state = freshState();
    state.crew = [
      { id: 'c1', status: CrewStatus.IDLE },
      { id: 'c2', status: CrewStatus.ON_MISSION },
      { id: 'c3', status: AstronautStatus.KIA },
    ] as unknown as CrewMember[];
    const summary = await saveGame(state, 0);
    expect(summary.crewCount).toBe(2);
  });

  it('summary.crewKIA counts crew with KIA status', async () => {
    const state = freshState();
    state.crew = [
      { id: 'c1', status: AstronautStatus.KIA },
      { id: 'c2', status: AstronautStatus.KIA },
      { id: 'c3', status: CrewStatus.IDLE },
    ] as unknown as CrewMember[];
    const summary = await saveGame(state, 0);
    expect(summary.crewKIA).toBe(2);
  });

  it('accumulates session time into state.playTimeSeconds', async () => {
    const state = freshState();
    state.playTimeSeconds = 100;

    // Advance clock by 5 seconds.
    vi.advanceTimersByTime(5_000);

    await saveGame(state, 0);

    // playTimeSeconds should now be 100 + 5.
    expect(state.playTimeSeconds).toBeCloseTo(105, 1);
  });

  it('does not double-count time across two consecutive saves', async () => {
    const state = freshState();
    state.playTimeSeconds = 0;

    vi.advanceTimersByTime(3_000);
    await saveGame(state, 0); // +3 s

    vi.advanceTimersByTime(2_000);
    await saveGame(state, 0); // +2 s more

    // Total should be ~5 s, not ~8 s.
    expect(state.playTimeSeconds).toBeCloseTo(5, 1);
  });

  it('stores a deep clone of state (mutations after save do not affect stored data)', async () => {
    const state = freshState();
    await saveGame(state, 0, 'before');
    state.money = 9_999_999; // mutate after save

    const restored = await loadGame(0);
    expect(restored.money).toBe(2_000_000); // original value
  });

  it('default saveName is "New Save"', async () => {
    const summary = await saveGame(freshState(), 0);
    expect(summary.saveName).toBe('New Save');
  });

  it('coerces non-string saveName to string', async () => {
    // @ts-expect-error — intentionally passing wrong type to test runtime coercion
    const summary = await saveGame(freshState(), 0, 42);
    expect(summary.saveName).toBe('42');
  });

  it('saving to slot 2 does not overwrite slot 0', async () => {
    const stateA = freshState();
    stateA.money = 111_111;
    await saveGame(stateA, 0, 'Slot Zero');

    const stateB = freshState();
    stateB.money = 222_222;
    await saveGame(stateB, 2, 'Slot Two');

    // Slot 0 must still contain the original save.
    const restoredA = await loadGame(0);
    expect(restoredA.money).toBe(111_111);

    // Slot 2 must contain the new save.
    const restoredB = await loadGame(2);
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
  it('returns the game state previously written by saveGame', async () => {
    const state = freshState();
    state.money = 777_000;
    await saveGame(state, 1, 'load test');

    const restored = await loadGame(1);
    expect(restored.money).toBe(777_000);
  });

  it('throws on an empty slot', async () => {
    await expect(loadGame(3)).rejects.toThrow(/empty/i);
  });

  it('throws on corrupt JSON', async () => {
    localStorage.setItem('spaceAgencySave_0', 'not { valid json');
    await expect(loadGame(0)).rejects.toThrow(/corrupt/i);
  });

  it('throws when stored envelope is missing the state field', async () => {
    localStorage.setItem('spaceAgencySave_0', JSON.stringify({ saveName: 'x', timestamp: 't' }));
    await expect(loadGame(0)).rejects.toThrow(/corrupt/i);
  });

  it('restores nested objects correctly', async () => {
    const state = freshState();
    state.loan.balance = 500_000;
    state.crew = [{ id: 'c1', status: CrewStatus.IDLE, name: 'Alice', skills: { piloting: 50, engineering: 50, science: 50 } }] as unknown as CrewMember[];
    await saveGame(state, 0);

    const restored = await loadGame(0);
    expect(restored.loan.balance).toBe(500_000);
    expect(restored.crew[0].name).toBe('Alice');
  });

  it('throws RangeError for an out-of-bounds slot', async () => {
    await expect(loadGame(5)).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// deleteSave
// ---------------------------------------------------------------------------

describe('deleteSave()', () => {
  it('removes the save so that listSaves returns null for that slot', async () => {
    await saveGame(freshState(), 2, 'to delete');
    deleteSave(2);
    const saves = listSaves();
    expect(saves[2]).toBeNull();
  });

  it('does not throw when the slot is already empty', () => {
    expect(() => deleteSave(4)).not.toThrow();
  });

  it('only removes the targeted slot', async () => {
    await saveGame(freshState(), 0, 'keep me');
    await saveGame(freshState(), 1, 'delete me');
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

  it('returns a summary for occupied slots and null for empty slots', async () => {
    await saveGame(freshState(), 0, 'slot 0');
    await saveGame(freshState(), 3, 'slot 3');

    const saves = listSaves();
    expect(saves[0]).not.toBeNull();
    expect(saves[0]!.saveName).toBe('slot 0');
    expect(saves[1]).toBeNull();
    expect(saves[2]).toBeNull();
    expect(saves[3]).not.toBeNull();
    expect(saves[3]!.saveName).toBe('slot 3');
    expect(saves[4]).toBeNull();
  });

  it('returns null for corrupt slot data', () => {
    localStorage.setItem('spaceAgencySave_1', 'CORRUPT{{{');
    const saves = listSaves();
    expect(saves[1]).toBeNull();
  });

  it('returned summaries include all required fields', async () => {
    await saveGame(freshState(), 0, 'full test');
    const summary = listSaves()[0]!;
    const expectedFields: (keyof SaveSlotSummary)[] = [
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

  it('does not write to the slot when JSON is malformed', async () => {
    // Pre-populate the slot so we can confirm it was not overwritten.
    await saveGame(freshState(), 2, 'original');
    const before = localStorage.getItem('spaceAgencySave_2');

    expect(() => importSave('{broken json}}', 2)).toThrow();

    // The slot must still contain the original data.
    const after = localStorage.getItem('spaceAgencySave_2');
    expect(after).toBe(before);
  });

  it('does not write to the slot when the envelope is structurally invalid', async () => {
    await saveGame(freshState(), 3, 'keep me');
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

  it('overwrites an existing save in the target slot', async () => {
    await saveGame(freshState(), 0, 'original');
    const imported = { saveName: 'replacement', timestamp: 'T', state: freshState() };
    importSave(JSON.stringify(imported), 0);
    expect(listSaves()[0]!.saveName).toBe('replacement');
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
    const s = freshState() as unknown as Record<string, unknown>;
    s.money = '1000';
    expect(() => _validateState(s)).toThrow(/money/i);
  });

  it('throws when playTimeSeconds is not a number', () => {
    const s = freshState() as unknown as Record<string, unknown>;
    s.playTimeSeconds = null;
    expect(() => _validateState(s)).toThrow(/playTimeSeconds/i);
  });

  it('throws when loan is missing', () => {
    const s = freshState() as unknown as Record<string, unknown>;
    delete s.loan;
    expect(() => _validateState(s)).toThrow(/loan/i);
  });

  it('throws when loan.balance is not a number', () => {
    const s = freshState();
    // @ts-expect-error — intentionally assigning wrong type to test validation
    s.loan.balance = 'a lot';
    expect(() => _validateState(s)).toThrow(/loan\.balance/i);
  });

  it('throws when loan.interestRate is not a number', () => {
    const s = freshState();
    // @ts-expect-error — intentionally assigning wrong type to test validation
    s.loan.interestRate = true;
    expect(() => _validateState(s)).toThrow(/loan\.interestRate/i);
  });

  it('throws when crew is not an array', () => {
    const s = freshState() as unknown as Record<string, unknown>;
    s.crew = {};
    expect(() => _validateState(s)).toThrow(/crew/i);
  });

  it('throws when missions is missing', () => {
    const s = freshState() as unknown as Record<string, unknown>;
    delete s.missions;
    expect(() => _validateState(s)).toThrow(/missions/i);
  });

  it('throws when missions.available is not an array', () => {
    const s = freshState();
    // @ts-expect-error — intentionally assigning wrong type to test validation
    s.missions.available = null;
    expect(() => _validateState(s)).toThrow(/missions\.available/i);
  });

  it('throws when rockets is not an array', () => {
    const s = freshState() as unknown as Record<string, unknown>;
    s.rockets = 'none';
    expect(() => _validateState(s)).toThrow(/rockets/i);
  });

  it('throws when parts is not an array', () => {
    const s = freshState() as unknown as Record<string, unknown>;
    s.parts = undefined;
    expect(() => _validateState(s)).toThrow(/parts/i);
  });

  it('throws when flightHistory is not an array', () => {
    const s = freshState() as unknown as Record<string, unknown>;
    s.flightHistory = 0;
    expect(() => _validateState(s)).toThrow(/flightHistory/i);
  });
});

// ---------------------------------------------------------------------------
// exportSave
// ---------------------------------------------------------------------------

describe('exportSave()', () => {
  it('throws an informative error in a non-browser environment', async () => {
    // Node has no document or Blob — this exercises the DOM guard.
    await saveGame(freshState(), 0, 'export test');
    expect(() => exportSave(0)).toThrow(/browser environment/i);
  });

  it('throws on an empty slot', () => {
    expect(() => exportSave(4)).toThrow(/empty/i);
  });

  it('throws RangeError for an out-of-bounds slot', () => {
    expect(() => exportSave(-1)).toThrow(RangeError);
  });

  it('the data stored for export is a valid JSON string containing the full state', async () => {
    // exportSave() reads the raw (possibly compressed) data from localStorage
    // and decompresses it before sending to the user as a file. Verify that
    // the underlying storage decompresses to well-formed JSON whose
    // envelope.state matches the state that was saved.
    const state = freshState();
    state.money = 987_654;
    state.crew = [{ id: 'c1', status: CrewStatus.IDLE, name: 'Dana' }] as unknown as CrewMember[];
    state.missions.completed = [{ id: 'm1', title: 'First orbit' }] as unknown as MissionInstance[];
    await saveGame(state, 0, 'Export Test');

    // Read what's in storage and decompress it.
    const raw = localStorage.getItem('spaceAgencySave_0');
    expect(typeof raw).toBe('string');
    const json = decompressSaveData(raw!);

    // Must be parseable JSON.
    let envelope: SaveEnvelope | undefined;
    expect(() => { envelope = JSON.parse(json) as SaveEnvelope; }).not.toThrow();

    // Must contain all top-level envelope fields.
    expect(envelope!).toHaveProperty('saveName', 'Export Test');
    expect(envelope!).toHaveProperty('timestamp');
    expect(envelope!).toHaveProperty('state');

    // The embedded state must include the full game data.
    const envelopeState = envelope!.state as unknown as GameState;
    expect(envelopeState.money).toBe(987_654);
    expect(envelopeState.crew[0].name).toBe('Dana');
    expect(envelopeState.missions.completed[0].title).toBe('First orbit');
  });

  it('the exported JSON from a browser-mocked environment is parseable and contains full state', async () => {
    // Mock the minimum browser APIs needed to exercise the DOM code path.
    const state = freshState();
    state.money = 555_000;
    state.rockets = [{ id: 'r1', name: 'Mock Rocket', parts: [], staging: { stages: [[]], unstaged: [] }, totalMass: 100, totalThrust: 50 }] as unknown as RocketDesign[];
    await saveGame(state, 1, 'Browser Export');

    // Capture what Blob is constructed with.
    let capturedBlobContent: string | null = null;
    const MockBlob = class {
      constructor(parts: string[]) { capturedBlobContent = parts.join(''); }
    };
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = vi.fn();
    const mockAnchor: Record<string, unknown> = {
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

    // The Blob content is now a base64-encoded binary envelope (TASK-012).
    // Verify it round-trips through importSave into a different slot.
    expect(capturedBlobContent).not.toBeNull();
    expect(typeof capturedBlobContent).toBe('string');
    expect(capturedBlobContent!.length).toBeGreaterThan(0);

    // Round-trip: import the exported content into slot 2 and verify state.
    expect(() => importSave(capturedBlobContent!, 2)).not.toThrow();
    const loaded = await loadGame(2);
    expect(loaded.money).toBe(555_000);
    expect(loaded.rockets[0].name).toBe('Mock Rocket');

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

  it('saveGame() includes the version field in the stored envelope', async () => {
    await saveGame(freshState(), 0, 'versioned');
    const raw = localStorage.getItem('spaceAgencySave_0');
    const json = decompressSaveData(raw!);
    const envelope = JSON.parse(json) as SaveEnvelope;
    expect(envelope.version).toBe(SAVE_VERSION);
  });

  it('loadGame() loads a version-0 (no version field) save with all migrations applied', async () => {
    // Simulate a pre-versioning save: no version field, missing fields that
    // the migration logic defaults via ??=.
    const state = freshState() as unknown as Record<string, unknown>;
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

    const restored = await loadGame(0);
    // Migrations should have run — check fields that get defaulted by ??=.
    expect(restored.malfunctionMode).toBe('normal');
    expect(Array.isArray(restored.savedDesigns)).toBe(true);
    expect(restored.welcomeShown).toBe(true);
  });

  it('loadGame() loads a save matching the current version without warnings', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await saveGame(freshState(), 0, 'current version');
    const restored = await loadGame(0);

    expect(restored).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loadGame() warns when save version is higher than current', async () => {
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

    const restored = await loadGame(0);
    expect(restored).toBeDefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/newer version/i);
    warnSpy.mockRestore();
  });

  it('loadGame() still returns valid state from a future-version save', async () => {
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
    const restored = await loadGame(1);
    expect(restored.money).toBe(42_000);
    vi.restoreAllMocks();
  });

  it('round-trip save/load preserves the version field in storage', async () => {
    const state = freshState();
    await saveGame(state, 2, 'round-trip');
    const raw = localStorage.getItem('spaceAgencySave_2');
    const json = decompressSaveData(raw!);
    const envelope = JSON.parse(json) as SaveEnvelope;
    expect(envelope.version).toBe(SAVE_VERSION);

    // Load succeeds and the envelope in storage still has the version.
    const restored = await loadGame(2);
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
  interface EnvelopeOverrides extends Record<string, unknown> {
    _rawStatePatches?: Record<string, unknown>;
  }

  function injectEnvelope(envelopeOverrides: EnvelopeOverrides = {}, stateOverrides: Record<string, unknown> = {}): void {
    const state = { ...freshState(), ...stateOverrides };
    const envelope: Record<string, unknown> = {
      saveName: 'Edge Case',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)) as Record<string, unknown>,
      ...envelopeOverrides,
    };
    // Apply state overrides AFTER JSON clone so we can set null/undefined explicitly.
    if ('_rawStatePatches' in envelopeOverrides) {
      const patches = envelopeOverrides._rawStatePatches!;
      const envelopeState = envelope.state as Record<string, unknown>;
      for (const [key, value] of Object.entries(patches)) {
        if (value === undefined) {
          delete envelopeState[key];
        } else {
          envelopeState[key] = value;
        }
      }
      delete envelope._rawStatePatches;
    }
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(envelope));
  }

  it('loads a save with savedDesigns: null and defaults it to an empty array', async () => {
    injectEnvelope({
      _rawStatePatches: { savedDesigns: null },
    });

    const restored = await loadGame(0);
    expect(Array.isArray(restored.savedDesigns)).toBe(true);
    expect(restored.savedDesigns).toHaveLength(0);
  });

  it('loads a save with savedDesigns: undefined and defaults it to an empty array', async () => {
    injectEnvelope({
      _rawStatePatches: { savedDesigns: undefined },
    });

    const restored = await loadGame(0);
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
    mockStorage.setItem = (key: string, value: string): void => {
      if (key === sharedLibKey) {
        throw new Error('Storage full — unable to save design library. Delete old saves or designs to free space.');
      }
      return originalSetItem(key, value);
    };

    // Inject a save with a legacy design that lacks savePrivate (triggers migration).
    const state = freshState();
    state.savedDesigns = [
      { id: 'design-1', name: 'Legacy Rocket', savePrivate: undefined },
    ] as unknown as RocketDesign[];
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
    await expect(loadGame(0)).rejects.toThrow(/Storage full/i);

    // Restore original setItem.
    mockStorage.setItem = originalSetItem;
    saveSpy.mockRestore();
  });

  it('loads a save with an invalid malfunctionMode value without crashing', async () => {
    // The ??= migration only defaults null/undefined — an invalid string value
    // passes through. This test documents the current behaviour.
    injectEnvelope({
      _rawStatePatches: { malfunctionMode: 'banana' },
    });

    const restored = await loadGame(0);
    // The invalid value passes through because ??= only catches null/undefined.
    expect(restored.malfunctionMode).toBe('banana');
  });

  it('loads a pre-version save (no version field) with all migrations applied', async () => {
    // Simulate a very old save: no version field, missing several fields
    // that were added in later iterations.
    const state = freshState() as unknown as Record<string, unknown>;
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

    const restored = await loadGame(0);

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

  it('loads a future-version save and emits a console warning', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    injectEnvelope({ version: SAVE_VERSION + 10 });

    const restored = await loadGame(0);

    // The state should still load (best-effort forward compatibility).
    expect(restored).toBeDefined();
    expect(restored.money).toBe(freshState().money);

    // A warning should have been logged about the newer version.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(`"saveVersion":${SAVE_VERSION + 10}`);
    expect(warnSpy.mock.calls[0][0]).toMatch(/newer version/i);

    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// _validateNestedStructures — deeper save validation (TASK-007)
// ---------------------------------------------------------------------------

describe('_validateNestedStructures()', () => {
  // Helper: a valid mission entry.
  function validMission(id = 'mission-1'): Partial<MissionInstance> {
    return { id, title: 'Test Mission', reward: 5000, description: 'desc', deadline: '2025-12-31' };
  }

  // Helper: a valid crew entry.
  function validCrew(name = 'Alice'): Partial<CrewMember> {
    return { id: 'crew-1', name, status: CrewStatus.IDLE as unknown as CrewMember['status'], skills: { piloting: 50, engineering: 50, science: 50 }, salary: 5000, hireDate: '2025-01-01' };
  }

  // Helper: a valid orbital object entry.
  function validOrbitalObject(id = 'obj-1'): Record<string, unknown> {
    return { id, bodyId: 'EARTH', type: 'SATELLITE', name: 'Sat-1', elements: { a: 7000, e: 0.01, i: 0 } };
  }

  // Helper: a valid saved design entry.
  function validDesign(name = 'Rocket-1'): Partial<RocketDesign> {
    return { id: 'design-1', name, parts: [{ partId: 'pod', position: { x: 0, y: 0 } }], staging: { stages: [], unstaged: [] }, totalMass: 100, totalThrust: 50 };
  }

  // Helper: a valid contract entry.
  function validContract(id = 'contract-1'): Record<string, unknown> {
    return { id, title: 'Test Contract', reward: 10000, category: 'LAUNCH', objectives: [] };
  }

  // --- Missions ---

  it('filters out corrupted missions.accepted entries (missing id)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.missions.accepted = [
      validMission('m1'),
      { title: 'No ID', reward: 100 }, // missing id
      validMission('m3'),
    ] as unknown as MissionInstance[];

    _validateNestedStructures(state);

    expect(state.missions.accepted).toHaveLength(2);
    expect(state.missions.accepted[0].id).toBe('m1');
    expect(state.missions.accepted[1].id).toBe('m3');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('filters out corrupted missions.completed entries (missing reward)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.missions.completed = [
      validMission('m1'),
      { id: 'm2', title: 'No Reward' }, // missing reward
    ] as unknown as MissionInstance[];

    _validateNestedStructures(state);

    expect(state.missions.completed).toHaveLength(1);
    expect(state.missions.completed[0].id).toBe('m1');
    warnSpy.mockRestore();
  });

  it('filters out null and non-object mission entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.missions.accepted = [null, 42, 'garbage', validMission('m1')] as unknown as MissionInstance[];

    _validateNestedStructures(state);

    expect(state.missions.accepted).toHaveLength(1);
    expect(state.missions.accepted[0].id).toBe('m1');
    warnSpy.mockRestore();
  });

  // --- Crew ---

  it('filters out corrupted crew entries (missing name)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.crew = [
      validCrew('Alice'),
      { id: 'c2', status: CrewStatus.IDLE, skills: { piloting: 10, engineering: 10, science: 10 } }, // missing name
      validCrew('Bob'),
    ] as unknown as CrewMember[];

    _validateNestedStructures(state);

    expect(state.crew).toHaveLength(2);
    expect(state.crew[0].name).toBe('Alice');
    expect(state.crew[1].name).toBe('Bob');
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('filters out crew entries with null status', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.crew = [
      validCrew('Alice'),
      { id: 'c2', name: 'Bad Status', status: null, skills: { piloting: 0, engineering: 0, science: 0 } },
    ] as unknown as CrewMember[];

    _validateNestedStructures(state);

    expect(state.crew).toHaveLength(1);
    expect(state.crew[0].name).toBe('Alice');
    warnSpy.mockRestore();
  });

  it('filters out crew entries with missing skills object', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.crew = [
      { id: 'c1', name: 'NoSkills', status: CrewStatus.IDLE, skills: null },
      validCrew('Bob'),
    ] as unknown as CrewMember[];

    _validateNestedStructures(state);

    expect(state.crew).toHaveLength(1);
    expect(state.crew[0].name).toBe('Bob');
    warnSpy.mockRestore();
  });

  // --- Orbital objects ---

  it('filters out corrupted orbital object entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.orbitalObjects = [
      validOrbitalObject('o1'),
      { id: 'o2', bodyId: 'EARTH' }, // missing elements
      validOrbitalObject('o3'),
    ] as unknown as GameState['orbitalObjects'];

    _validateNestedStructures(state);

    expect(state.orbitalObjects).toHaveLength(2);
    expect(state.orbitalObjects[0].id).toBe('o1');
    expect(state.orbitalObjects[1].id).toBe('o3');
    warnSpy.mockRestore();
  });

  // --- Saved designs ---

  it('filters out corrupted saved design entries (missing parts array)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.savedDesigns = [
      validDesign('Rocket-1'),
      { id: 'd2', name: 'No Parts' }, // missing parts
    ] as unknown as RocketDesign[];

    _validateNestedStructures(state);

    expect(state.savedDesigns).toHaveLength(1);
    expect(state.savedDesigns[0].name).toBe('Rocket-1');
    warnSpy.mockRestore();
  });

  // --- Contracts ---

  it('filters out corrupted contracts.active entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.contracts = { board: [], active: [
      validContract('c1'),
      { id: 'c2' }, // missing reward
      validContract('c3'),
    ], completed: [], failed: [] } as unknown as GameState['contracts'];

    _validateNestedStructures(state);

    expect(state.contracts.active).toHaveLength(2);
    expect(state.contracts.active[0].id).toBe('c1');
    expect(state.contracts.active[1].id).toBe('c3');
    warnSpy.mockRestore();
  });

  // --- Valid data preserved ---

  it('preserves all valid entries when nothing is corrupted', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.missions.accepted = [validMission('m1'), validMission('m2')] as unknown as MissionInstance[];
    state.missions.completed = [validMission('m3')] as unknown as MissionInstance[];
    state.crew = [validCrew('Alice'), validCrew('Bob')] as unknown as CrewMember[];
    state.orbitalObjects = [validOrbitalObject('o1')] as unknown as GameState['orbitalObjects'];
    state.savedDesigns = [validDesign('R1')] as unknown as RocketDesign[];
    state.contracts = { board: [], active: [validContract('c1')], completed: [], failed: [] } as unknown as GameState['contracts'];

    _validateNestedStructures(state);

    expect(state.missions.accepted).toHaveLength(2);
    expect(state.missions.completed).toHaveLength(1);
    expect(state.crew).toHaveLength(2);
    expect(state.orbitalObjects).toHaveLength(1);
    expect(state.savedDesigns).toHaveLength(1);
    expect(state.contracts.active).toHaveLength(1);
    // No warnings logged when all entries are valid.
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // --- Skips missing optional arrays ---

  it('does not crash when optional arrays are absent', () => {
    const state = freshState() as unknown as Record<string, unknown>;
    delete state.orbitalObjects;
    delete state.savedDesigns;
    delete state.contracts;

    expect(() => _validateNestedStructures(state)).not.toThrow();
  });

  // --- Integration: _validateState calls nested validation ---

  it('_validateState also filters corrupted nested entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.crew = [
      validCrew('Alice'),
      { id: 'bad', name: 123, status: CrewStatus.IDLE, skills: {} }, // name is not a string
    ] as unknown as CrewMember[];

    _validateState(state);

    expect(state.crew).toHaveLength(1);
    expect(state.crew[0].name).toBe('Alice');
    warnSpy.mockRestore();
  });

  // --- Integration: loadGame filters corrupted entries ---

  it('loadGame filters corrupted crew and mission entries from a save', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.missions.accepted = [
      validMission('m1'),
      { title: 'Corrupt', reward: 'not a number' }, // invalid
    ] as unknown as MissionInstance[];
    state.crew = [
      validCrew('Good'),
      null, // invalid
    ] as unknown as CrewMember[];

    const envelope = {
      saveName: 'Nested Validation',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)),
    };
    localStorage.setItem('spaceAgencySave_0', JSON.stringify(envelope));

    const restored = await loadGame(0);

    expect(restored.missions.accepted).toHaveLength(1);
    expect(restored.missions.accepted[0].id).toBe('m1');
    expect(restored.crew).toHaveLength(1);
    expect(restored.crew[0].name).toBe('Good');
    warnSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Save Compression
// ---------------------------------------------------------------------------

describe('Save compression', () => {
  describe('compressSaveData / decompressSaveData', () => {
    it('round-trips a JSON string through compress → decompress', () => {
      const json = JSON.stringify({ hello: 'world', nested: { a: [1, 2, 3] } });
      const compressed = compressSaveData(json);
      const decompressed = decompressSaveData(compressed);
      expect(decompressed).toBe(json);
    });

    it('compressed output starts with LZC: prefix', () => {
      const json = JSON.stringify({ test: true });
      const compressed = compressSaveData(json);
      expect(compressed.startsWith('LZC:')).toBe(true);
    });

    it('compressed output differs from the raw JSON', () => {
      const json = JSON.stringify({ data: 'some test data that should be compressed' });
      const compressed = compressSaveData(json);
      expect(compressed).not.toBe(json);
    });

    it('decompressSaveData passes through uncompressed JSON (no prefix)', () => {
      const json = JSON.stringify({ saveName: 'Test', state: {} });
      // No LZC: prefix — treated as uncompressed.
      const result = decompressSaveData(json);
      expect(result).toBe(json);
    });
  });

  describe('round-trip save/load with compression', () => {
    it('@smoke preserves full game state through compressed save/load cycle', async () => {
      const state = freshState();
      state.agencyName = 'Compressed Agency';
      state.money = 999999;
      state.crew = [
        {
          id: 'c1', name: 'Test Pilot', status: 'idle',
          skills: { piloting: 80, engineering: 50, science: 60 },
          salary: 5000, hireDate: '2025-01-01', injuryEnds: null,
        },
      ] as unknown as CrewMember[];
      state.missions.accepted = [
        { id: 'm1', title: 'Orbital Test', reward: 50000 },
      ] as unknown as MissionInstance[];
      state.missions.completed = [
        { id: 'm2', title: 'First Flight', reward: 10000 },
      ] as unknown as MissionInstance[];

      await saveGame(state, 0, 'Compression Test');

      // Verify localStorage contains compressed data (LZC: prefix).
      const raw = localStorage.getItem('spaceAgencySave_0');
      expect(raw).not.toBeNull();
      expect(raw!.startsWith('LZC:')).toBe(true);

      const restored = await loadGame(0);

      expect(restored.agencyName).toBe('Compressed Agency');
      expect(restored.money).toBe(999999);
      expect(restored.crew).toHaveLength(1);
      expect(restored.crew[0].name).toBe('Test Pilot');
      expect(restored.missions.accepted).toHaveLength(1);
      expect(restored.missions.accepted[0].id).toBe('m1');
      expect(restored.missions.completed).toHaveLength(1);
      expect(restored.missions.completed[0].id).toBe('m2');
    });

    it('listSaves reads compressed save slots correctly', async () => {
      const state = freshState();
      state.agencyName = 'Listed Agency';
      await saveGame(state, 2, 'Slot 2 Save');

      const saves = listSaves();
      expect(saves[2]).not.toBeNull();
      expect(saves[2]!.saveName).toBe('Slot 2 Save');
      expect(saves[2]!.agencyName).toBe('Listed Agency');
    });
  });

  describe('backward compatibility with uncompressed saves', () => {
    it('loadGame reads an uncompressed (pre-compression) save', async () => {
      const state = freshState();
      state.agencyName = 'Old Agency';
      state.money = 12345;

      const envelope = {
        saveName: 'Legacy Save',
        timestamp: new Date(0).toISOString(),
        version: 1, // Pre-compression version.
        state: JSON.parse(JSON.stringify(state)),
      };
      // Write as uncompressed JSON (simulating old save format).
      localStorage.setItem('spaceAgencySave_0', JSON.stringify(envelope));

      const restored = await loadGame(0);

      expect(restored.agencyName).toBe('Old Agency');
      expect(restored.money).toBe(12345);
    });

    it('loadGame reads an uncompressed save with no version field (version 0)', async () => {
      const state = freshState();
      state.agencyName = 'Ancient Agency';

      const envelope = {
        saveName: 'Ancient Save',
        timestamp: new Date(0).toISOString(),
        // No version field — pre-versioning save.
        state: JSON.parse(JSON.stringify(state)),
      };
      localStorage.setItem('spaceAgencySave_1', JSON.stringify(envelope));

      const restored = await loadGame(1);

      expect(restored.agencyName).toBe('Ancient Agency');
    });

    it('listSaves handles a mix of compressed and uncompressed slots', async () => {
      // Slot 0: uncompressed (legacy).
      const legacyState = freshState();
      legacyState.agencyName = 'Legacy';
      const legacyEnvelope = {
        saveName: 'Legacy',
        timestamp: new Date(0).toISOString(),
        version: 1,
        state: JSON.parse(JSON.stringify(legacyState)),
      };
      localStorage.setItem('spaceAgencySave_0', JSON.stringify(legacyEnvelope));

      // Slot 1: compressed (current).
      const newState = freshState();
      newState.agencyName = 'Modern';
      await saveGame(newState, 1, 'Modern');

      const saves = listSaves();
      expect(saves[0]).not.toBeNull();
      expect(saves[0]!.saveName).toBe('Legacy');
      expect(saves[1]).not.toBeNull();
      expect(saves[1]!.saveName).toBe('Modern');
    });

    it('importSave compresses the imported data', () => {
      const state = freshState();
      const envelope = {
        saveName: 'Imported',
        timestamp: new Date(0).toISOString(),
        version: 1,
        state: JSON.parse(JSON.stringify(state)),
      };
      const json = JSON.stringify(envelope);

      importSave(json, 3);

      const raw = localStorage.getItem('spaceAgencySave_3');
      expect(raw).not.toBeNull();
      expect(raw!.startsWith('LZC:')).toBe(true);
    });
  });

  describe('save version bump', () => {
    it('SAVE_VERSION is 2 (bumped for compression)', () => {
      expect(SAVE_VERSION).toBe(2);
    });

    it('saved envelopes contain version 2', async () => {
      const state = freshState();
      await saveGame(state, 0, 'Version Test');

      const raw = localStorage.getItem('spaceAgencySave_0');
      const json = decompressSaveData(raw!);
      const envelope = JSON.parse(json) as SaveEnvelope;
      expect(envelope.version).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Save export format (binary envelope)
// ---------------------------------------------------------------------------

describe('Save export format', () => {
  // Polyfill btoa/atob for Node.js test environment.
  beforeEach(() => {
    vi.stubGlobal('btoa', (str: string) => Buffer.from(str, 'binary').toString('base64'));
    vi.stubGlobal('atob', (str: string) => Buffer.from(str, 'base64').toString('binary'));
  });

  /**
   * Helper: builds a binary envelope from a raw LZC string, returning a
   * base64-encoded string suitable for `importSave()`.
   */
  interface BuildEnvelopeOptions {
    corruptCrc?: boolean;
    badMagic?: boolean;
    truncatePayload?: boolean;
  }

  function buildTestEnvelope(rawLZC: string, { corruptCrc = false, badMagic = false, truncatePayload = false }: BuildEnvelopeOptions = {}): string {
    const encoder = new TextEncoder();
    const payloadBytes = encoder.encode(rawLZC);
    const checksum = crc32(payloadBytes);

    const header = new Uint8Array(14);
    const view = new DataView(header.buffer);

    // Magic bytes (0-3)
    if (badMagic) {
      header[0] = 0x58; header[1] = 0x58; header[2] = 0x58; header[3] = 0x58; // "XXXX"
    } else {
      header[0] = 0x53; header[1] = 0x41; header[2] = 0x53; header[3] = 0x56; // "SASV"
    }

    // Format version (4-5), uint16 big-endian
    view.setUint16(4, 1, false);

    // CRC-32 checksum (6-9), uint32 big-endian
    if (corruptCrc) {
      // Flip some bits in the checksum to make it invalid.
      view.setUint32(6, checksum ^ 0xDEADBEEF, false);
    } else {
      view.setUint32(6, checksum, false);
    }

    // Payload length (10-13), uint32 big-endian
    view.setUint32(10, payloadBytes.length, false);

    // Build final envelope bytes.
    let actualPayload = payloadBytes;
    if (truncatePayload) {
      // Truncate: keep the header claiming the full length but only include half.
      actualPayload = payloadBytes.slice(0, Math.max(1, Math.floor(payloadBytes.length / 2)));
    }

    const envelope = new Uint8Array(14 + actualPayload.length);
    envelope.set(header, 0);
    envelope.set(actualPayload, 14);

    // Base64-encode.
    let binary = '';
    for (let i = 0; i < envelope.length; i++) {
      binary += String.fromCharCode(envelope[i]);
    }
    return btoa(binary);
  }

  it('round-trips a save through the binary envelope import path', async () => {
    // Save a game state to slot 0 via the normal path.
    const state = freshState();
    state.money = 314_159;
    state.agencyName = 'Binary Test Agency';
    state.crew = [
      {
        id: 'c1', name: 'Pilot', status: CrewStatus.IDLE,
        skills: { piloting: 90, engineering: 40, science: 50 },
        salary: 5000, hireDate: '2025-06-01T00:00:00.000Z', injuryEnds: null,
      },
    ] as unknown as CrewMember[];
    await saveGame(state, 0, 'Binary Export Test');

    // Read the raw LZC string from localStorage.
    const rawLZC = localStorage.getItem('spaceAgencySave_0');
    expect(rawLZC).not.toBeNull();

    // Build a valid binary envelope manually and base64-encode it.
    const base64 = buildTestEnvelope(rawLZC!);

    // Import the binary envelope into slot 1.
    const summary = importSave(base64, 1);
    expect(summary.slotIndex).toBe(1);
    expect(summary.saveName).toBe('Binary Export Test');

    // Load from slot 1 and verify key data matches.
    const restored = await loadGame(1);
    expect(restored.money).toBe(314_159);
    expect(restored.agencyName).toBe('Binary Test Agency');
    expect(restored.crew).toHaveLength(1);
    expect(restored.crew[0].name).toBe('Pilot');
    expect(restored.crew[0].skills.piloting).toBe(90);
  });

  it('detects corrupted CRC-32 checksum and throws', async () => {
    // Save a game state to create a valid LZC string.
    const state = freshState();
    state.money = 42_000;
    await saveGame(state, 0, 'CRC Test');

    const rawLZC = localStorage.getItem('spaceAgencySave_0');
    const base64 = buildTestEnvelope(rawLZC!, { corruptCrc: true });

    // importSave should throw with a message about checksum or CRC.
    expect(() => importSave(base64, 1)).toThrow(/checksum|CRC/i);
  });

  it('falls through to legacy import on wrong magic bytes and fails on invalid JSON', async () => {
    // Save a game state to create a valid LZC string.
    const state = freshState();
    await saveGame(state, 0, 'Magic Test');

    const rawLZC = localStorage.getItem('spaceAgencySave_0');
    const base64 = buildTestEnvelope(rawLZC!, { badMagic: true });

    // Without SASV magic bytes, importSave falls back to legacy JSON import.
    // The base64 string is not valid JSON, so it should throw about invalid JSON.
    expect(() => importSave(base64, 1)).toThrow(/not valid JSON|plain object/i);
  });

  it('detects truncated payload and throws', async () => {
    // Save a game state to create a valid LZC string.
    const state = freshState();
    state.money = 99_000;
    await saveGame(state, 0, 'Truncate Test');

    const rawLZC = localStorage.getItem('spaceAgencySave_0');
    const base64 = buildTestEnvelope(rawLZC!, { truncatePayload: true });

    // importSave should throw with a message about corrupted or payload length.
    expect(() => importSave(base64, 1)).toThrow(/corrupted|payload length/i);
  });

  it('imports a legacy JSON envelope string (old-format backward compatibility)', () => {
    // Create a plain JSON envelope (no binary wrapping, no LZC compression).
    const state = freshState();
    state.money = 88_888;
    state.agencyName = 'Legacy Import Agency';

    const legacyJSON = JSON.stringify({
      saveName: 'Legacy Save File',
      timestamp: new Date(0).toISOString(),
      state: JSON.parse(JSON.stringify(state)),
    });

    // importSave should accept this as a legacy JSON import.
    const summary = importSave(legacyJSON, 2);
    expect(summary.slotIndex).toBe(2);
    expect(summary.saveName).toBe('Legacy Save File');
    expect(summary.money).toBe(88_888);

    // Verify the data is persisted and can be loaded back.
    const saves = listSaves();
    expect(saves[2]).not.toBeNull();
    expect(saves[2]!.saveName).toBe('Legacy Save File');
  });
});

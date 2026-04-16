/**
 * saveload.test.ts — Unit tests for the save/load system.
 *
 * Because Vitest runs in a Node.js environment (no browser globals),
 * IndexedDB is mocked via vi.mock() on idbStorage before each test.
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

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
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
  StorageQuotaError,
} from '../core/saveload.ts';
import { idbSet } from '../core/idbStorage.ts';
import { crc32 } from '../core/crc32.ts';
import { AstronautStatus, MiningModuleType, ResourceState, ResourceType } from '../core/constants.ts';

import type { GameState, Contract, CrewMember, MissionInstance, OrbitalObject, RocketDesign } from '../core/gameState.ts';
import type { SaveSlotSummary } from '../core/saveload.ts';
import { makeContract, makeCrewMember, makeFlightResult, makeMissionInstance, makeOrbitalObject, makeRocketDesign } from './_factories.js';
import { _resetCacheForTesting as _resetSettingsCache } from '../core/settingsStore.ts';
import { logger } from '../core/logger.ts';
import type { LogLevel } from '../core/logger.ts';

// Node.js Buffer is available in Vitest's Node environment but @types/node is not installed.
declare const Buffer: {
  from(str: string, encoding: string): { toString(encoding: string): string };
};

/** Shape of the parsed save envelope in storage. */
interface SaveEnvelope {
  saveName: string;
  timestamp: string;
  version?: number;
  state: GameState;
}

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

let _savedLogLevel: LogLevel;

beforeAll(() => {
  _savedLogLevel = logger.getLevel();
  logger.setLevel('warn');
});

afterAll(() => {
  logger.setLevel(_savedLogLevel);
});

beforeEach(() => {
  _idbStore.clear();
  _resetSettingsCache();
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

/**
 * Build a base64-encoded SASV binary envelope from arbitrary data.
 * Used by importSave() tests to test the binary import path.
 */
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

// ---------------------------------------------------------------------------
// Round-trip — complex state
// ---------------------------------------------------------------------------

describe('Round-trip: save and load a complex state', () => {
  it('deep-equals original state with multiple crew, missions, and rockets', async () => {
    const state = freshState();

    // Multiple crew members with varying statuses.
    state.crew = [
      makeCrewMember({
        id: 'crew-1',
        name: 'Alice',
        status: AstronautStatus.ACTIVE,
        skills: { piloting: 75, engineering: 40, science: 60 },
        salary: 5000,
        hireDate: '2025-01-01T00:00:00.000Z',
      }),
      makeCrewMember({
        id: 'crew-2',
        name: 'Bob',
        status: AstronautStatus.ACTIVE,
        skills: { piloting: 20, engineering: 90, science: 30 },
        salary: 6000,
        hireDate: '2025-03-15T00:00:00.000Z',
        injuryEnds: 5,
      }),
      makeCrewMember({
        id: 'crew-3',
        name: 'Carol',
        status: AstronautStatus.KIA,
        skills: { piloting: 55, engineering: 55, science: 55 },
        salary: 5500,
        hireDate: '2024-06-01T00:00:00.000Z',
      }),
    ];

    // Several missions distributed across the three buckets.
    state.missions.available = [
      makeMissionInstance({ id: 'mission-avail-1', title: 'Sub-orbital test', reward: 10000 }),
      makeMissionInstance({ id: 'mission-avail-2', title: 'Weather sat', reward: 25000 }),
    ];
    state.missions.accepted = [
      makeMissionInstance({ id: 'mission-acc-1', title: 'Orbital insertion', reward: 50000 }),
    ];
    state.missions.completed = [
      makeMissionInstance({ id: 'mission-comp-1', title: 'First flight', reward: 5000 }),
      makeMissionInstance({ id: 'mission-comp-2', title: 'Science drop', reward: 8000 }),
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
    ] as RocketDesign[];

    // Flight history.
    state.flightHistory = [
      makeFlightResult({
        id: 'flight-1',
        missionId: 'mission-comp-1',
        rocketId: 'rocket-1',
        crewIds: ['crew-1'],
        launchDate: '2025-03-01T12:00:00.000Z',
        outcome: 'SUCCESS',
        deltaVUsed: 1800,
        revenue: 5000,
        notes: 'Perfect flight.',
      }),
    ];

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
    expect(restored.crew[1].status).toBe(AstronautStatus.ACTIVE);
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
  it('writes compressed data to the correct IDB key', async () => {
    const state = freshState();
    await saveGame(state, 2, 'My Agency');
    const raw = _idbStore.get('spaceAgencySave_2');
    expect(raw).toBeDefined();
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
    state.missions.completed = [makeMissionInstance({ id: 'm1' }), makeMissionInstance({ id: 'm2' })];
    const summary = await saveGame(state, 0);
    expect(summary.missionsCompleted).toBe(2);
  });

  it('summary.acceptedMissionCount counts accepted missions', async () => {
    const state = freshState();
    state.missions.accepted = [makeMissionInstance({ id: 'm1' })];
    const summary = await saveGame(state, 0);
    expect(summary.acceptedMissionCount).toBe(1);
  });

  it('summary.totalFlights counts flightHistory entries', async () => {
    const state = freshState();
    state.flightHistory = [makeFlightResult({ id: 'f1' }), makeFlightResult({ id: 'f2' }), makeFlightResult({ id: 'f3' })];
    const summary = await saveGame(state, 0);
    expect(summary.totalFlights).toBe(3);
  });

  it('summary.crewCount counts living crew members', async () => {
    const state = freshState();
    state.crew = [
      makeCrewMember({ id: 'c1', status: AstronautStatus.ACTIVE }),
      makeCrewMember({ id: 'c2', status: AstronautStatus.ACTIVE }),
      makeCrewMember({ id: 'c3', status: AstronautStatus.KIA }),
    ];
    const summary = await saveGame(state, 0);
    expect(summary.crewCount).toBe(2);
  });

  it('summary.crewKIA counts crew with KIA status', async () => {
    const state = freshState();
    state.crew = [
      makeCrewMember({ id: 'c1', status: AstronautStatus.KIA }),
      makeCrewMember({ id: 'c2', status: AstronautStatus.KIA }),
      makeCrewMember({ id: 'c3', status: AstronautStatus.ACTIVE }),
    ];
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
    const saves = await listSaves();
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
    _idbStore.set('spaceAgencySave_0', 'not { valid json');
    await expect(loadGame(0)).rejects.toThrow(/corrupt/i);
  });

  it('throws when stored envelope is missing the state field', async () => {
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify({ saveName: 'x', timestamp: 't' })));
    await expect(loadGame(0)).rejects.toThrow(/corrupt/i);
  });

  it('restores nested objects correctly', async () => {
    const state = freshState();
    state.loan.balance = 500_000;
    state.crew = [makeCrewMember({ id: 'c1', name: 'Alice', skills: { piloting: 50, engineering: 50, science: 50 } })];
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
    await deleteSave(2);
    const saves = await listSaves();
    expect(saves[2]).toBeNull();
  });

  it('does not throw when the slot is already empty', async () => {
    await deleteSave(4);
  });

  it('only removes the targeted slot', async () => {
    await saveGame(freshState(), 0, 'keep me');
    await saveGame(freshState(), 1, 'delete me');
    await deleteSave(1);
    const saves = await listSaves();
    expect(saves[0]).not.toBeNull();
    expect(saves[1]).toBeNull();
  });

  it('throws RangeError for an out-of-bounds slot', async () => {
    await expect(deleteSave(-1)).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// listSaves
// ---------------------------------------------------------------------------

describe('listSaves()', () => {
  it('returns an array with exactly SAVE_SLOT_COUNT entries', async () => {
    const saves = await listSaves();
    expect(saves).toHaveLength(SAVE_SLOT_COUNT);
  });

  it('all entries are null when no saves exist', async () => {
    const saves = await listSaves();
    expect(saves.every((s) => s === null)).toBe(true);
  });

  it('returns a summary for occupied slots and null for empty slots', async () => {
    await saveGame(freshState(), 0, 'slot 0');
    await saveGame(freshState(), 3, 'slot 3');

    const saves = await listSaves();
    expect(saves[0]).not.toBeNull();
    expect(saves[0]!.saveName).toBe('slot 0');
    expect(saves[1]).toBeNull();
    expect(saves[2]).toBeNull();
    expect(saves[3]).not.toBeNull();
    expect(saves[3]!.saveName).toBe('slot 3');
    expect(saves[4]).toBeNull();
  });

  it('returns null for corrupt slot data', async () => {
    _idbStore.set('spaceAgencySave_1', 'CORRUPT{{{');
    const saves = await listSaves();
    expect(saves[1]).toBeNull();
  });

  it('returned summaries include all required fields', async () => {
    await saveGame(freshState(), 0, 'full test');
    const summary = (await listSaves())[0]!;
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
// listSaves — dynamic slot discovery
// ---------------------------------------------------------------------------

describe('listSaves — dynamic slot discovery', () => {
  /** Helper to create a minimal save envelope JSON string. */
  function makeEnvelopeJSON(overrides: Partial<SaveEnvelope> = {}): string {
    const state = freshState();
    return JSON.stringify({
      saveName: 'Test',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)),
      ...overrides,
    });
  }

  it('empty storage returns 5 nulls', async () => {
    const saves = await listSaves();
    expect(saves).toHaveLength(SAVE_SLOT_COUNT);
    expect(saves.every(s => s === null)).toBe(true);
  });

  it('discovers overflow slot 7', async () => {
    _idbStore.set('spaceAgencySave_7', compressSaveData(makeEnvelopeJSON({ saveName: 'Overflow 7' })));

    const saves = await listSaves();
    expect(saves.length).toBeGreaterThan(SAVE_SLOT_COUNT);
    const overflow = saves.find(s => s !== null && s.storageKey === 'spaceAgencySave_7');
    expect(overflow).toBeDefined();
    expect(overflow!.saveName).toBe('Overflow 7');
    expect(overflow!.slotIndex).toBe(-1);
  });

  it('discovers auto-save key', async () => {
    _idbStore.set('spaceAgencySave_auto', compressSaveData(makeEnvelopeJSON({ saveName: 'Auto Save' })));

    const saves = await listSaves();
    const autoSave = saves.find(s => s !== null && s.storageKey === 'spaceAgencySave_auto');
    expect(autoSave).toBeDefined();
    expect(autoSave!.saveName).toBe('Auto Save');
    expect(autoSave!.slotIndex).toBe(-1);
  });

  it('storageKey present on all summaries', async () => {
    await saveGame(freshState(), 0, 'Slot Zero');

    const saves = await listSaves();
    expect(saves[0]).not.toBeNull();
    expect(saves[0]!.storageKey).toBe('spaceAgencySave_0');
  });

  it('incompatible version saves still appear', async () => {
    const state = freshState();
    const envelope = {
      saveName: 'Old Version',
      timestamp: new Date(0).toISOString(),
      version: 1,
      state: JSON.parse(JSON.stringify(state)),
    };
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify(envelope)));

    const saves = await listSaves();
    expect(saves[0]).not.toBeNull();
    expect(saves[0]!.saveName).toBe('Old Version');
    expect(saves[0]!.version).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// importSave
// ---------------------------------------------------------------------------

describe('importSave()', () => {
  it('writes a valid binary envelope to the target slot', async () => {
    const base64 = buildBinaryImport({ saveName: 'Imported', timestamp: new Date(0).toISOString(), state: freshState() });
    const summary = await importSave(base64, 1);
    expect(summary.saveName).toBe('Imported');
    expect(_idbStore.has('spaceAgencySave_1')).toBe(true);
  });

  it('returns a SaveSlotSummary matching the imported state', async () => {
    const state = freshState();
    state.money = 42_000;
    const base64 = buildBinaryImport({ saveName: 'Rich', timestamp: 'T', state });
    const summary = await importSave(base64, 0);
    expect(summary.money).toBe(42_000);
  });

  it('throws on non-binary input', async () => {
    await expect(importSave('{{not json', 0)).rejects.toThrow(/unrecognized save format/i);
  });

  it('does not write to the slot when input is not a valid envelope', async () => {
    // Pre-populate the slot so we can confirm it was not overwritten.
    await saveGame(freshState(), 2, 'original');
    const before = _idbStore.get('spaceAgencySave_2');

    await expect(importSave('{broken json}}', 2)).rejects.toThrow();

    // The slot must still contain the original data.
    const after = _idbStore.get('spaceAgencySave_2');
    expect(after).toBe(before);
  });

  it('does not write to the slot when the envelope is structurally invalid', async () => {
    await saveGame(freshState(), 3, 'keep me');
    const before = _idbStore.get('spaceAgencySave_3');

    // Missing the required "state" field — build as binary envelope.
    const base64 = buildBinaryImport({ saveName: 'Bad', timestamp: 'T' });
    await expect(importSave(base64, 3)).rejects.toThrow(/state/i);

    const after = _idbStore.get('spaceAgencySave_3');
    expect(after).toBe(before);
  });

  it('throws when saveName is missing', async () => {
    const base64 = buildBinaryImport({ timestamp: 'T', state: freshState() });
    await expect(importSave(base64, 0)).rejects.toThrow(/saveName/i);
  });

  it('throws when timestamp is missing', async () => {
    const base64 = buildBinaryImport({ saveName: 'S', state: freshState() });
    await expect(importSave(base64, 0)).rejects.toThrow(/timestamp/i);
  });

  it('throws when state is missing', async () => {
    const base64 = buildBinaryImport({ saveName: 'S', timestamp: 'T' });
    await expect(importSave(base64, 0)).rejects.toThrow(/state/i);
  });

  it('throws RangeError for out-of-bounds slot', async () => {
    const base64 = buildBinaryImport({ saveName: 'X', timestamp: 'T', state: freshState() });
    await expect(importSave(base64, 10)).rejects.toThrow(RangeError);
  });

  it('overwrites an existing save in the target slot', async () => {
    await saveGame(freshState(), 0, 'original');
    const base64 = buildBinaryImport({ saveName: 'replacement', timestamp: 'T', state: freshState() });
    await importSave(base64, 0);
    expect((await listSaves())[0]!.saveName).toBe('replacement');
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
    // @ts-expect-error — deliberately passing invalid type for validation test
    s.money = '1000';
    expect(() => _validateState(s)).toThrow(/money/i);
  });

  it('throws when playTimeSeconds is not a number', () => {
    const s = freshState();
    // @ts-expect-error — deliberately passing invalid type for validation test
    s.playTimeSeconds = null;
    expect(() => _validateState(s)).toThrow(/playTimeSeconds/i);
  });

  it('throws when loan is missing', () => {
    const s = freshState();
    // @ts-expect-error — deliberately deleting required field for validation test
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
    const s = freshState();
    // @ts-expect-error — deliberately passing invalid type for validation test
    s.crew = {};
    expect(() => _validateState(s)).toThrow(/crew/i);
  });

  it('throws when missions is missing', () => {
    const s = freshState();
    // @ts-expect-error — deliberately deleting required field for validation test
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
    const s = freshState();
    // @ts-expect-error — deliberately passing invalid type for validation test
    s.rockets = 'none';
    expect(() => _validateState(s)).toThrow(/rockets/i);
  });

  it('throws when parts is not an array', () => {
    const s = freshState();
    // @ts-expect-error — deliberately passing invalid type for validation test
    s.parts = undefined;
    expect(() => _validateState(s)).toThrow(/parts/i);
  });

  it('throws when flightHistory is not an array', () => {
    const s = freshState();
    // @ts-expect-error — deliberately passing invalid type for validation test
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
    await expect(exportSave(0)).rejects.toThrow(/browser environment/i);
  });

  it('throws on an empty slot', async () => {
    await expect(exportSave(4)).rejects.toThrow(/empty/i);
  });

  it('throws RangeError for an out-of-bounds slot', async () => {
    await expect(exportSave(-1)).rejects.toThrow(RangeError);
  });

  it('the data stored for export is a valid JSON string containing the full state', async () => {
    // exportSave() reads the raw (possibly compressed) data from IDB
    // and decompresses it before sending to the user as a file. Verify that
    // the underlying storage decompresses to well-formed JSON whose
    // envelope.state matches the state that was saved.
    const state = freshState();
    state.money = 987_654;
    state.crew = [makeCrewMember({ id: 'c1', name: 'Dana' })];
    state.missions.completed = [makeMissionInstance({ id: 'm1', title: 'First orbit' })];
    await saveGame(state, 0, 'Export Test');

    // Read what's in storage and decompress it.
    const raw = _idbStore.get('spaceAgencySave_0');
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
    const envelopeState = envelope!.state;
    expect(envelopeState.money).toBe(987_654);
    expect(envelopeState.crew[0].name).toBe('Dana');
    expect(envelopeState.missions.completed[0].title).toBe('First orbit');
  });

  it('the exported JSON from a browser-mocked environment is parseable and contains full state', async () => {
    // Mock the minimum browser APIs needed to exercise the DOM code path.
    const state = freshState();
    state.money = 555_000;
    state.rockets = [makeRocketDesign({ id: 'r1', name: 'Mock Rocket', parts: [], staging: { stages: [[]], unstaged: [] }, totalMass: 100, totalThrust: 50 })];
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

    await exportSave(1);

    // The Blob content is now a base64-encoded binary envelope (TASK-012).
    // Verify it round-trips through importSave into a different slot.
    expect(capturedBlobContent).not.toBeNull();
    expect(typeof capturedBlobContent).toBe('string');
    expect(capturedBlobContent!.length).toBeGreaterThan(0);

    // Round-trip: import the exported content into slot 2 and verify state.
    await importSave(capturedBlobContent!, 2);
    const loaded = await loadGame(2);
    expect(loaded.money).toBe(555_000);
    expect(loaded.rockets[0].name).toBe('Mock Rocket');

    // Clean up extra stubs.
    vi.unstubAllGlobals();
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
    const raw = _idbStore.get('spaceAgencySave_0')!;
    const json = decompressSaveData(raw);
    const envelope = JSON.parse(json) as SaveEnvelope;
    expect(envelope.version).toBe(SAVE_VERSION);
  });

  it('loadGame() rejects a version-0 (no version field) save as incompatible', async () => {
    const state = freshState();
    const legacyEnvelope = {
      saveName: 'Legacy',
      timestamp: new Date(0).toISOString(),
      // Intentionally no "version" field — treated as version 0
      state: JSON.parse(JSON.stringify(state)),
    };
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify(legacyEnvelope)));

    await expect(loadGame(0)).rejects.toThrow(/incompatible version/i);
  });

  it('loadGame() loads a save matching the current version without warnings', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await saveGame(freshState(), 0, 'current version');
    const restored = await loadGame(0);

    expect(restored).toBeDefined();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('loadGame() rejects a save from a newer version', async () => {
    const state = freshState();
    const futureEnvelope = {
      saveName: 'Future',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION + 5,
      state: JSON.parse(JSON.stringify(state)),
    };
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify(futureEnvelope)));

    await expect(loadGame(0)).rejects.toThrow(/incompatible version/i);
  });

  it('loadGame() rejects a save from an older version', async () => {
    const state = freshState();
    const oldEnvelope = {
      saveName: 'Old',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION - 1,
      state: JSON.parse(JSON.stringify(state)),
    };
    _idbStore.set('spaceAgencySave_1', compressSaveData(JSON.stringify(oldEnvelope)));

    await expect(loadGame(1)).rejects.toThrow(/incompatible version/i);
  });

  it('round-trip save/load preserves the version field in storage', async () => {
    const state = freshState();
    await saveGame(state, 2, 'round-trip');
    const raw = _idbStore.get('spaceAgencySave_2')!;
    const json = decompressSaveData(raw);
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
   * Helper: writes a raw envelope to IDB slot 0, bypassing saveGame()
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
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify(envelope)));
  }

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

  it('rejects a pre-version save (no version field) as incompatible', async () => {
    const rawState = JSON.parse(JSON.stringify(freshState())) as Record<string, unknown>;
    const legacyEnvelope = {
      saveName: 'Ancient Save',
      timestamp: new Date(0).toISOString(),
      // No "version" field at all — treated as version 0
      state: rawState,
    };
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify(legacyEnvelope)));

    await expect(loadGame(0)).rejects.toThrow(/incompatible version/i);
  });

  it('rejects a future-version save as incompatible', async () => {
    injectEnvelope({ version: SAVE_VERSION + 10 });

    await expect(loadGame(0)).rejects.toThrow(/incompatible version/i);
  });
});

// ---------------------------------------------------------------------------
// _validateNestedStructures — deeper save validation (TASK-007)
// ---------------------------------------------------------------------------

describe('_validateNestedStructures()', () => {
  // Helper: a valid mission entry.
  function validMission(id = 'mission-1'): MissionInstance {
    return makeMissionInstance({ id, title: 'Test Mission', reward: 5000, description: 'desc', deadline: '2025-12-31' });
  }

  // Helper: a valid crew entry.
  function validCrew(name = 'Alice'): CrewMember {
    return makeCrewMember({ id: 'crew-1', name, status: AstronautStatus.ACTIVE, skills: { piloting: 50, engineering: 50, science: 50 }, salary: 5000, hireDate: '2025-01-01' });
  }

  // Helper: a valid orbital object entry.
  function validOrbitalObject(id = 'obj-1'): OrbitalObject {
    return makeOrbitalObject({ id, bodyId: 'EARTH', type: 'SATELLITE', name: 'Sat-1' });
  }

  // Helper: a valid saved design entry.
  function validDesign(name = 'Rocket-1'): RocketDesign {
    return makeRocketDesign({ id: 'design-1', name, parts: [{ partId: 'pod', position: { x: 0, y: 0 } }], staging: { stages: [], unstaged: [] }, totalMass: 100, totalThrust: 50 });
  }

  // Helper: a valid contract entry.
  function validContract(id = 'contract-1'): Contract {
    return makeContract({ id, title: 'Test Contract', reward: 10000 });
  }

  // --- Missions ---

  it('filters out corrupted missions.accepted entries (missing id)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.missions.accepted = [
      validMission('m1'),
      // @ts-expect-error — deliberately including invalid entry (missing id) for validation test
      { title: 'No ID', reward: 100 }, // missing id
      validMission('m3'),
    ];

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
      // @ts-expect-error — deliberately including invalid entry (missing reward) for validation test
      { id: 'm2', title: 'No Reward' }, // missing reward
    ];

    _validateNestedStructures(state);

    expect(state.missions.completed).toHaveLength(1);
    expect(state.missions.completed[0].id).toBe('m1');
    warnSpy.mockRestore();
  });

  it('filters out null and non-object mission entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    // @ts-expect-error — deliberately including null, number, and string entries for validation test
    state.missions.accepted = [null, 42, 'garbage', validMission('m1')];

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
      // @ts-expect-error — deliberately including invalid entry (missing name) for validation test
      { id: 'c2', status: AstronautStatus.ACTIVE, skills: { piloting: 10, engineering: 10, science: 10 } }, // missing name
      validCrew('Bob'),
    ];

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
      // @ts-expect-error — deliberately including invalid entry (null status) for validation test
      { id: 'c2', name: 'Bad Status', status: null, skills: { piloting: 0, engineering: 0, science: 0 } },
    ];

    _validateNestedStructures(state);

    expect(state.crew).toHaveLength(1);
    expect(state.crew[0].name).toBe('Alice');
    warnSpy.mockRestore();
  });

  it('filters out crew entries with missing skills object', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.crew = [
      // @ts-expect-error — deliberately including invalid entry (null skills) for validation test
      { id: 'c1', name: 'NoSkills', status: AstronautStatus.ACTIVE, skills: null },
      validCrew('Bob'),
    ];

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
      // @ts-expect-error — deliberately including invalid entry (missing elements) for validation test
      { id: 'o2', bodyId: 'EARTH' }, // missing elements
      validOrbitalObject('o3'),
    ];

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
      // @ts-expect-error — deliberately including invalid entry (missing parts) for validation test
      { id: 'd2', name: 'No Parts' }, // missing parts
    ];

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
      // @ts-expect-error — deliberately including invalid entry (missing reward) for validation test
      { id: 'c2' }, // missing reward
      validContract('c3'),
    ], completed: [], failed: [] };

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
    state.missions.accepted = [makeMissionInstance({ id: 'm1' }), makeMissionInstance({ id: 'm2' })];
    state.missions.completed = [makeMissionInstance({ id: 'm3' })];
    state.crew = [makeCrewMember({ name: 'Alice' }), makeCrewMember({ name: 'Bob' })];
    state.orbitalObjects = [makeOrbitalObject({ id: 'o1' })];
    state.savedDesigns = [makeRocketDesign({ name: 'R1' })];
    state.contracts = { board: [], active: [validContract('c1')], completed: [], failed: [] };

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
    const state = freshState();
    // @ts-expect-error — deliberately deleting required field to simulate legacy save
    delete state.orbitalObjects;
    // @ts-expect-error — deliberately deleting required field to simulate legacy save
    delete state.savedDesigns;
    // @ts-expect-error — deliberately deleting required field to simulate legacy save
    delete state.contracts;

    expect(() => _validateNestedStructures(state)).not.toThrow();
  });

  // --- Integration: _validateState calls nested validation ---

  it('_validateState also filters corrupted nested entries', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const state = freshState();
    state.crew = [
      validCrew('Alice'),
      // @ts-expect-error — deliberately including invalid entry (name is number, skills is empty) for validation test
      { id: 'bad', name: 123, status: AstronautStatus.ACTIVE, skills: {} }, // name is not a string
    ];

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
      // @ts-expect-error — deliberately including invalid entry (reward is string) for validation test
      { title: 'Corrupt', reward: 'not a number' }, // invalid
    ];
    state.crew = [
      validCrew('Good'),
      // @ts-expect-error — deliberately including null entry for validation test
      null, // invalid
    ];

    const envelope = {
      saveName: 'Nested Validation',
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)),
    };
    _idbStore.set('spaceAgencySave_0', compressSaveData(JSON.stringify(envelope)));

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

    it('decompressSaveData throws on uncompressed JSON (no prefix)', () => {
      const json = JSON.stringify({ saveName: 'Test', state: {} });
      expect(() => decompressSaveData(json)).toThrow(/missing the compressed prefix/i);
    });
  });

  describe('round-trip save/load with compression', () => {
    it('@smoke preserves full game state through compressed save/load cycle', async () => {
      const state = freshState();
      state.agencyName = 'Compressed Agency';
      state.money = 999999;
      state.crew = [
        makeCrewMember({
          id: 'c1', name: 'Test Pilot',
          skills: { piloting: 80, engineering: 50, science: 60 },
          salary: 5000, hireDate: '2025-01-01', injuryEnds: null,
        }),
      ];
      state.missions.accepted = [
        makeMissionInstance({ id: 'm1', title: 'Orbital Test', reward: 50000 }),
      ];
      state.missions.completed = [
        makeMissionInstance({ id: 'm2', title: 'First Flight', reward: 10000 }),
      ];

      await saveGame(state, 0, 'Compression Test');

      // Verify IDB contains compressed data (LZC: prefix).
      const raw = _idbStore.get('spaceAgencySave_0');
      expect(raw).toBeDefined();
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

    it('listSaves reads compressed save slots correctly @smoke', async () => {
      const state = freshState();
      state.agencyName = 'Listed Agency';
      await saveGame(state, 2, 'Slot 2 Save');

      const saves = await listSaves();
      expect(saves[2]).not.toBeNull();
      expect(saves[2]!.saveName).toBe('Slot 2 Save');
      expect(saves[2]!.agencyName).toBe('Listed Agency');
    });
  });

  describe('save version bump', () => {
    it('SAVE_VERSION is 6 (incompatible saves rejected)', () => {
      expect(SAVE_VERSION).toBe(6);
    });

    it('saved envelopes contain version 6', async () => {
      const state = freshState();
      await saveGame(state, 0, 'Version Test');

      const raw = _idbStore.get('spaceAgencySave_0')!;
      const json = decompressSaveData(raw);
      const envelope = JSON.parse(json) as SaveEnvelope;
      expect(envelope.version).toBe(6);
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
      makeCrewMember({
        id: 'c1', name: 'Pilot',
        skills: { piloting: 90, engineering: 40, science: 50 },
        salary: 5000, hireDate: '2025-06-01T00:00:00.000Z', injuryEnds: null,
      }),
    ];
    await saveGame(state, 0, 'Binary Export Test');

    // Read the raw LZC string from IDB mock.
    const rawLZC = _idbStore.get('spaceAgencySave_0') ?? null;
    expect(rawLZC).not.toBeNull();

    // Build a valid binary envelope manually and base64-encode it.
    const base64 = buildTestEnvelope(rawLZC!);

    // Import the binary envelope into slot 1.
    const summary = await importSave(base64, 1);
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

    const rawLZC = _idbStore.get('spaceAgencySave_0')!;
    const base64 = buildTestEnvelope(rawLZC, { corruptCrc: true });

    // importSave should throw with a message about checksum or CRC.
    await expect(importSave(base64, 1)).rejects.toThrow(/checksum|CRC/i);
  });

  it('rejects wrong magic bytes as unrecognized format', async () => {
    // Save a game state to create a valid LZC string.
    const state = freshState();
    await saveGame(state, 0, 'Magic Test');

    const rawLZC = _idbStore.get('spaceAgencySave_0')!;
    const base64 = buildTestEnvelope(rawLZC, { badMagic: true });

    // Without SASV magic bytes, importSave rejects as unrecognized format.
    await expect(importSave(base64, 1)).rejects.toThrow(/unrecognized save format/i);
  });

  it('detects truncated payload and throws', async () => {
    // Save a game state to create a valid LZC string.
    const state = freshState();
    state.money = 99_000;
    await saveGame(state, 0, 'Truncate Test');

    const rawLZC = _idbStore.get('spaceAgencySave_0')!;
    const base64 = buildTestEnvelope(rawLZC, { truncatePayload: true });

    // importSave should throw with a message about corrupted or payload length.
    await expect(importSave(base64, 1)).rejects.toThrow(/corrupted|payload length/i);
  });

});

// ---------------------------------------------------------------------------
// Mining / Route fields round-trip
// ---------------------------------------------------------------------------

describe('Save/load round-trip for mining/route fields', () => {
  it('miningSites survive save/load round-trip', async () => {
    const state = createGameState();
    // Push a mining site with modules and storage
    state.miningSites.push({
      id: 'test-site-1',
      name: 'Lunar Base Alpha',
      bodyId: 'MOON',
      coordinates: { x: 100, y: 200 },
      controlUnit: { partId: 'base-control-unit-mk1' },
      modules: [{
        id: 'mod-1',
        partId: 'mining-drill-mk1',
        type: MiningModuleType.MINING_DRILL,
        powerDraw: 25,
        connections: [],
      }, {
        id: 'mod-2',
        partId: 'storage-silo-mk1',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 2,
        connections: [],
        stored: { [ResourceType.WATER_ICE]: 500 },
        storageCapacityKg: 2000,
        storageState: ResourceState.SOLID,
      }],
      storage: { [ResourceType.WATER_ICE]: 500 },
      powerGenerated: 100,
      powerRequired: 37,
      orbitalBuffer: {},
    });

    await saveGame(state, 0, 'test');
    const loaded = await loadGame(0);

    expect(loaded.miningSites).toHaveLength(1);
    expect(loaded.miningSites[0].name).toBe('Lunar Base Alpha');
    expect(loaded.miningSites[0].modules).toHaveLength(2);
    expect(loaded.miningSites[0].storage).toEqual({ WATER_ICE: 500 });
  });

  it('provenLegs survive save/load round-trip', async () => {
    const state = createGameState();
    state.provenLegs.push({
      id: 'leg-1',
      origin: { bodyId: 'MOON', locationType: 'surface', hubId: null },
      destination: { bodyId: 'MOON', locationType: 'orbit', altitude: 50000, hubId: null },
      craftDesignId: 'design-1',
      cargoCapacityKg: 500,
      costPerRun: 10000,
      provenFlightId: 'flight-1',
      dateProven: 5,
    });

    await saveGame(state, 0, 'test');
    const loaded = await loadGame(0);

    expect(loaded.provenLegs).toHaveLength(1);
    expect(loaded.provenLegs[0].origin.bodyId).toBe('MOON');
  });

  it('routes survive save/load round-trip', async () => {
    const state = createGameState();
    state.routes.push({
      id: 'route-1',
      name: 'Lunar Ice Express',
      status: 'active',
      resourceType: ResourceType.WATER_ICE,
      legs: [{
        id: 'rleg-1',
        origin: { bodyId: 'MOON', locationType: 'surface', hubId: null },
        destination: { bodyId: 'EARTH', locationType: 'orbit', altitude: 200000, hubId: null },
        craftDesignId: 'design-1',
        craftCount: 2,
        cargoCapacityKg: 500,
        costPerRun: 10000,
        provenFlightId: 'flight-1',
      }],
      throughputPerPeriod: 1000,
      totalCostPerPeriod: 20000,
    });

    await saveGame(state, 0, 'test');
    const loaded = await loadGame(0);

    expect(loaded.routes).toHaveLength(1);
    expect(loaded.routes[0].name).toBe('Lunar Ice Express');
    expect(loaded.routes[0].legs).toHaveLength(1);
  });

  it('per-module stored/storageCapacityKg/storageState survive save/load round-trip', async () => {
    const state = createGameState();
    state.miningSites.push({
      id: 'site-storage-rt',
      name: 'Storage Round-Trip Site',
      bodyId: 'MOON',
      coordinates: { x: 50, y: 50 },
      controlUnit: { partId: 'base-control-unit-mk1' },
      modules: [{
        id: 'silo-1',
        partId: 'storage-silo-mk1',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 2,
        connections: [],
        stored: { [ResourceType.IRON_ORE]: 250, [ResourceType.WATER_ICE]: 100 },
        storageCapacityKg: 2000,
        storageState: ResourceState.SOLID,
      }, {
        id: 'pv-1',
        partId: 'pressure-vessel-mk1',
        type: MiningModuleType.PRESSURE_VESSEL,
        powerDraw: 5,
        connections: [],
        stored: { [ResourceType.OXYGEN]: 400 },
        storageCapacityKg: 1000,
        storageState: ResourceState.GAS,
      }],
      storage: { [ResourceType.IRON_ORE]: 250, [ResourceType.WATER_ICE]: 100, [ResourceType.OXYGEN]: 400 },
      powerGenerated: 100,
      powerRequired: 17,
      orbitalBuffer: {},
    });

    await saveGame(state, 0, 'storage-test');
    const loaded = await loadGame(0);

    expect(loaded.miningSites).toHaveLength(1);
    const site = loaded.miningSites[0];
    expect(site.modules).toHaveLength(2);

    const silo = site.modules.find(m => m.id === 'silo-1')!;
    expect(silo.stored).toEqual({ IRON_ORE: 250, WATER_ICE: 100 });
    expect(silo.storageCapacityKg).toBe(2000);
    expect(silo.storageState).toBe(ResourceState.SOLID);

    const pv = site.modules.find(m => m.id === 'pv-1')!;
    expect(pv.stored).toEqual({ OXYGEN: 400 });
    expect(pv.storageCapacityKg).toBe(1000);
    expect(pv.storageState).toBe(ResourceState.GAS);

    // site.storage should be recomputed from module stored values
    expect(site.storage).toEqual({ IRON_ORE: 250, WATER_ICE: 100, OXYGEN: 400 });
  });

});

// ---------------------------------------------------------------------------
// Overflow save load & export (storageKey parameter)
// ---------------------------------------------------------------------------

describe('Overflow saves via storageKey parameter', () => {
  /**
   * Writes a compressed save envelope directly to the IDB mock under the
   * given key, bypassing saveGame() (which only accepts slots 0-4).
   */
  function seedOverflowSave(key: string, state: GameState, saveName = 'Overflow Save'): void {
    const envelope = {
      saveName,
      timestamp: new Date(0).toISOString(),
      version: SAVE_VERSION,
      state: JSON.parse(JSON.stringify(state)),
    };
    const json = JSON.stringify(envelope);
    const compressed = compressSaveData(json);
    _idbStore.set(key, compressed);
  }

  it('loads a save from overflow slot 7 via storageKey', async () => {
    const state = freshState();
    state.money = 77_777;
    state.agencyName = 'Overflow Agency 7';

    seedOverflowSave('spaceAgencySave_7', state, 'Slot 7 Save');
    const loaded = await loadGame(-1, 'spaceAgencySave_7');

    expect(loaded.money).toBe(77_777);
    expect(loaded.agencyName).toBe('Overflow Agency 7');
  });

  it('loads a save from auto-save key via storageKey', async () => {
    const state = freshState();
    state.money = 99_999;
    state.agencyName = 'Auto Agency';

    seedOverflowSave('spaceAgencySave_auto', state, 'Auto Save');
    const loaded = await loadGame(-1, 'spaceAgencySave_auto');

    expect(loaded.money).toBe(99_999);
    expect(loaded.agencyName).toBe('Auto Agency');
  });

  it('exports an overflow save without throwing (browser mocks)', async () => {
    const state = freshState();
    state.money = 42_000;
    seedOverflowSave('spaceAgencySave_7', state, 'Export Overflow');

    // Mock the minimum browser APIs needed for the export DOM path.
    const mockAnchor: Record<string, unknown> = {
      href: null, download: null,
      click: vi.fn(),
    };
    const mockDocument = {
      createElement: vi.fn().mockReturnValue(mockAnchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    };
    const MockBlob = class {
      constructor(_parts: string[]) { /* no-op */ }
    };
    const mockCreateObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    const mockRevokeObjectURL = vi.fn();

    vi.stubGlobal('document', mockDocument);
    vi.stubGlobal('Blob', MockBlob);
    vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL, revokeObjectURL: mockRevokeObjectURL });

    await exportSave(-1, 'spaceAgencySave_7');
    expect(mockDocument.createElement).toHaveBeenCalledWith('a');
    expect(mockCreateObjectURL).toHaveBeenCalled();

    // Clean up extra stubs.
    vi.unstubAllGlobals();
  });

});

// ---------------------------------------------------------------------------
// saveGame — QuotaExceededError propagation
// ---------------------------------------------------------------------------

describe('saveGame() — QuotaExceededError propagation', () => {
  /**
   * saveGame calls idbSet twice: once (unawaited) for settings under
   * 'spaceAgency_settings', and once (awaited) for the save slot under
   * 'spaceAgencySave_N'. To test the main-save error path deterministically
   * without tripping on the settings write, install a mock that rejects only
   * for the save-slot key.
   */
  function rejectSaveSlotOnce(err: unknown): void {
    vi.mocked(idbSet).mockImplementation((key: string, value: string) => {
      if (key.startsWith('spaceAgencySave_')) {
        // Restore the default mock for any subsequent calls in the same test.
        vi.mocked(idbSet).mockImplementation((k: string, v: string) => {
          _idbStore.set(k, v);
          return Promise.resolve();
        });
        return Promise.reject(err);
      }
      _idbStore.set(key, value);
      return Promise.resolve();
    });
  }

  afterEach(() => {
    // Restore the original in-memory idbSet mock between tests.
    vi.mocked(idbSet).mockImplementation((key: string, value: string) => {
      _idbStore.set(key, value);
      return Promise.resolve();
    });
  });

  it('throws StorageQuotaError when idbSet throws QuotaExceededError', async () => {
    const state = freshState();
    const quotaErr = Object.assign(new Error('The quota has been exceeded.'), {
      name: 'QuotaExceededError',
    });
    rejectSaveSlotOnce(quotaErr);

    await expect(saveGame(state, 0, 'quota test')).rejects.toBeInstanceOf(StorageQuotaError);
  });

  it('StorageQuotaError preserves the original error as cause', async () => {
    const state = freshState();
    const quotaErr = Object.assign(new Error('The quota has been exceeded.'), {
      name: 'QuotaExceededError',
    });
    rejectSaveSlotOnce(quotaErr);

    try {
      await saveGame(state, 0, 'quota test');
      expect.fail('saveGame should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(StorageQuotaError);
      expect((err as StorageQuotaError).cause).toBe(quotaErr);
    }
  });

  it('rethrows non-quota errors unchanged', async () => {
    const state = freshState();
    const genericErr = new Error('Connection lost');
    rejectSaveSlotOnce(genericErr);

    await expect(saveGame(state, 0, 'generic test')).rejects.toBe(genericErr);
  });
});

// ---------------------------------------------------------------------------
// saveGame — settings-sync failure handling
// ---------------------------------------------------------------------------

describe('saveGame() — settings-sync failure handling', () => {
  /**
   * Install a mock that rejects only on the settings-key write, so the
   * main save-slot write succeeds. The settings write in saveGame is
   * intentionally not awaited — its failure must not kill the main save.
   */
  function rejectSettingsWrite(err: unknown): void {
    vi.mocked(idbSet).mockImplementation((key: string, value: string) => {
      if (key === 'spaceAgency_settings') {
        return Promise.reject(err);
      }
      _idbStore.set(key, value);
      return Promise.resolve();
    });
  }

  afterEach(() => {
    vi.mocked(idbSet).mockImplementation((key: string, value: string) => {
      _idbStore.set(key, value);
      return Promise.resolve();
    });
  });

  it('main save still completes when settings sync fails, and failure is logged', async () => {
    const state = freshState();
    const settingsErr = Object.assign(new Error('The quota has been exceeded.'), {
      name: 'QuotaExceededError',
    });
    rejectSettingsWrite(settingsErr);

    const warnSpy = vi.spyOn(logger, 'warn');

    // The main save must succeed despite the settings-write rejection.
    const summary = await saveGame(state, 0, 'settings fail test');
    expect(summary).toBeDefined();
    expect(summary.saveName).toBe('settings fail test');

    // Allow the unawaited settings promise's .catch() to run.
    await Promise.resolve();
    await Promise.resolve();

    // The failure must be surfaced through the logger.
    const calls = warnSpy.mock.calls;
    const matched = calls.some(
      (args) => args[0] === 'save' && String(args[1]).includes('Settings sync failed during save'),
    );
    expect(matched).toBe(true);

    warnSpy.mockRestore();
  });
});

/**
 * missions.test.js — Unit tests for the mission data model and core missions module.
 *
 * Tests cover:
 *   - ObjectiveType enum        — frozen, correct values
 *   - MissionStatus enum        — frozen, correct values
 *   - initializeMissions()      — seeds available missions from catalog
 *   - getAvailableMissions()    — returns current available bucket
 *   - acceptMission()           — moves mission to accepted, guards against bad IDs
 *   - completeMission()         — moves to completed, awards reward, unlocks parts/missions
 *   - getUnlockedMissions()     — surfaces missions whose prereqs are now met
 *   - getUnlockedParts()        — union of state.parts + mission unlockedParts
 *   - checkObjectiveCompletion()— all 10 objective types, HOLD_ALTITUDE timer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createGameState } from '../core/gameState.js';
import {
  initializeMissions,
  getAvailableMissions,
  acceptMission,
  completeMission,
  getUnlockedMissions,
  getUnlockedParts,
  checkObjectiveCompletion,
} from '../core/missions.js';
import { processFlightReturn } from '../core/flightReturn.js';
import { MISSIONS, ObjectiveType, MissionStatus } from '../data/missions.js';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

/** Returns a fresh game state with empty mission buckets. */
function freshState() {
  return createGameState();
}

/**
 * Build a minimal mission definition for testing.
 * Callers can override any field via `overrides`.
 */
function makeMissionDef(overrides = {}) {
  return {
    id: 'test-mission-001',
    title: 'Test Mission',
    description: 'A mission for testing.',
    location: 'desert',
    objectives: [],
    reward: 10_000,
    unlocksAfter: [],
    unlockedParts: [],
    status: MissionStatus.AVAILABLE,
    ...overrides,
  };
}

/**
 * Build a minimal accepted mission instance (already in state.missions.accepted).
 * Adds the mission to the state and returns it.
 */
function seedAcceptedMission(state, def) {
  const instance = {
    ...def,
    objectives: def.objectives.map((o) => ({ ...o })),
    unlocksAfter: [...def.unlocksAfter],
    unlockedParts: [...def.unlockedParts],
    status: MissionStatus.ACCEPTED,
  };
  state.missions.accepted.push(instance);
  return instance;
}

/**
 * Build a minimal FlightState for a given mission ID.
 * Callers can override any field.
 */
function makeFlightState(missionId, overrides = {}) {
  return {
    missionId,
    rocketId: 'rocket-1',
    crewIds: [],
    timeElapsed: 0,
    altitude: 0,
    velocity: 0,
    fuelRemaining: 1000,
    deltaVRemaining: 5000,
    events: [],
    aborted: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Catalog surgery helpers
//
// The MISSIONS array is module-level state shared across tests.  We splice in
// test missions before each test and restore the array after.  This avoids
// mutating the live export between test files.
// ---------------------------------------------------------------------------

/**
 * Temporarily replace the entire MISSIONS catalog with `defs` and return a
 * cleanup function that restores the original contents.
 *
 * Using a full replacement (rather than an append) ensures that the real
 * catalog missions (e.g. mission-001 with unlocksAfter: []) do not bleed
 * into tests that inject synthetic missions.
 */
function withMissions(...defs) {
  const saved = MISSIONS.splice(0, MISSIONS.length); // save & clear
  MISSIONS.push(...defs);
  return () => {
    MISSIONS.splice(0, MISSIONS.length); // clear injected
    MISSIONS.push(...saved);             // restore original
  };
}

// ---------------------------------------------------------------------------
// ObjectiveType enum
// ---------------------------------------------------------------------------

describe('ObjectiveType enum', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(ObjectiveType)).toBe(true);
  });

  it('has all 10 required types', () => {
    const expected = [
      'REACH_ALTITUDE',
      'REACH_SPEED',
      'SAFE_LANDING',
      'ACTIVATE_PART',
      'HOLD_ALTITUDE',
      'RETURN_SCIENCE_DATA',
      'CONTROLLED_CRASH',
      'EJECT_CREW',
      'RELEASE_SATELLITE',
      'REACH_ORBIT',
    ];
    for (const key of expected) {
      expect(ObjectiveType[key]).toBe(key);
    }
  });

  it('values equal their keys (string enum pattern)', () => {
    for (const [key, val] of Object.entries(ObjectiveType)) {
      expect(val).toBe(key);
    }
  });
});

// ---------------------------------------------------------------------------
// MissionStatus enum
// ---------------------------------------------------------------------------

describe('MissionStatus enum', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(MissionStatus)).toBe(true);
  });

  it('has lowercase values', () => {
    expect(MissionStatus.LOCKED).toBe('locked');
    expect(MissionStatus.AVAILABLE).toBe('available');
    expect(MissionStatus.ACCEPTED).toBe('accepted');
    expect(MissionStatus.COMPLETED).toBe('completed');
  });
});

// ---------------------------------------------------------------------------
// initializeMissions()
// ---------------------------------------------------------------------------

describe('initializeMissions()', () => {
  let state;
  let cleanup;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('adds missions with empty unlocksAfter to available', () => {
    cleanup = withMissions(makeMissionDef({ id: 'm1', unlocksAfter: [] }));
    initializeMissions(state);
    expect(state.missions.available).toHaveLength(1);
    expect(state.missions.available[0].id).toBe('m1');
  });

  it('does not add locked missions (with prerequisites)', () => {
    cleanup = withMissions(
      makeMissionDef({ id: 'm1', unlocksAfter: [] }),
      makeMissionDef({ id: 'm2', unlocksAfter: ['m1'], status: MissionStatus.LOCKED }),
    );
    initializeMissions(state);
    expect(state.missions.available).toHaveLength(1);
  });

  it('adds multiple available missions', () => {
    cleanup = withMissions(
      makeMissionDef({ id: 'a', unlocksAfter: [] }),
      makeMissionDef({ id: 'b', unlocksAfter: [] }),
    );
    initializeMissions(state);
    expect(state.missions.available).toHaveLength(2);
  });

  it('deep-copies objectives so template is not mutated', () => {
    const def = makeMissionDef({
      id: 'copy-test',
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: false, description: 'test' },
      ],
    });
    cleanup = withMissions(def);
    initializeMissions(state);

    // Mutate the live copy.
    state.missions.available[0].objectives[0].completed = true;

    // Template must remain unchanged.
    expect(def.objectives[0].completed).toBe(false);
  });

  it('sets status to "available" on copied instance', () => {
    cleanup = withMissions(makeMissionDef({ id: 'x', unlocksAfter: [] }));
    initializeMissions(state);
    expect(state.missions.available[0].status).toBe(MissionStatus.AVAILABLE);
  });
});

// ---------------------------------------------------------------------------
// getAvailableMissions()
// ---------------------------------------------------------------------------

describe('getAvailableMissions()', () => {
  it('returns empty array when nothing is available', () => {
    const state = freshState();
    expect(getAvailableMissions(state)).toEqual([]);
  });

  it('returns the available bucket', () => {
    const state = freshState();
    const m = makeMissionDef({ id: 'm1' });
    state.missions.available.push({ ...m });
    const result = getAvailableMissions(state);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('m1');
  });

  it('returns the same array reference (not a copy)', () => {
    const state = freshState();
    expect(getAvailableMissions(state)).toBe(state.missions.available);
  });
});

// ---------------------------------------------------------------------------
// acceptMission()
// ---------------------------------------------------------------------------

describe('acceptMission()', () => {
  let state;
  let cleanup;

  beforeEach(() => {
    state = freshState();
    cleanup = withMissions(makeMissionDef({ id: 'mission-a', unlocksAfter: [] }));
    initializeMissions(state);
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('returns { success: true, mission } on success', () => {
    const result = acceptMission(state, 'mission-a');
    expect(result.success).toBe(true);
    expect(result.mission).toBeDefined();
    expect(result.mission.id).toBe('mission-a');
  });

  it('moves mission from available to accepted', () => {
    acceptMission(state, 'mission-a');
    expect(state.missions.available).toHaveLength(0);
    expect(state.missions.accepted).toHaveLength(1);
    expect(state.missions.accepted[0].id).toBe('mission-a');
  });

  it('sets mission status to "accepted"', () => {
    acceptMission(state, 'mission-a');
    expect(state.missions.accepted[0].status).toBe(MissionStatus.ACCEPTED);
  });

  it('returns { success: false, error } for unknown id', () => {
    const result = acceptMission(state, 'nonexistent');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('does not modify state when id not found', () => {
    acceptMission(state, 'nonexistent');
    expect(state.missions.available).toHaveLength(1);
    expect(state.missions.accepted).toHaveLength(0);
  });

  it('returns { success: false } if mission is already accepted (not in available)', () => {
    acceptMission(state, 'mission-a');       // first call succeeds
    const result = acceptMission(state, 'mission-a');  // second call fails
    expect(result.success).toBe(false);
  });

  it('unlocks requiredParts when accepting a mission', () => {
    if (cleanup) cleanup();
    cleanup = withMissions(makeMissionDef({
      id: 'mission-req',
      unlocksAfter: [],
      requiredParts: ['science-module-mk1'],
    }));
    state = freshState();
    initializeMissions(state);

    expect(state.parts).not.toContain('science-module-mk1');
    const result = acceptMission(state, 'mission-req');
    expect(result.success).toBe(true);
    expect(result.unlockedParts).toContain('science-module-mk1');
    expect(state.parts).toContain('science-module-mk1');
  });

  it('does not duplicate requiredParts already owned', () => {
    if (cleanup) cleanup();
    cleanup = withMissions(makeMissionDef({
      id: 'mission-req',
      unlocksAfter: [],
      requiredParts: ['engine-spark'],
    }));
    state = freshState();
    state.parts = ['engine-spark'];
    initializeMissions(state);

    const result = acceptMission(state, 'mission-req');
    expect(result.unlockedParts).toHaveLength(0);
    expect(state.parts.filter(p => p === 'engine-spark')).toHaveLength(1);
  });

  it('unlocks requiredParts from catalog for old saves missing the field', () => {
    if (cleanup) cleanup();
    cleanup = withMissions(makeMissionDef({
      id: 'mission-req',
      unlocksAfter: [],
      requiredParts: ['satellite-mk1'],
    }));
    state = freshState();
    initializeMissions(state);

    // Simulate an old save by deleting requiredParts from the instance.
    const instance = state.missions.available.find(m => m.id === 'mission-req');
    delete instance.requiredParts;

    const result = acceptMission(state, 'mission-req');
    expect(result.success).toBe(true);
    expect(result.unlockedParts).toContain('satellite-mk1');
    expect(state.parts).toContain('satellite-mk1');
  });
});

// ---------------------------------------------------------------------------
// completeMission()
// ---------------------------------------------------------------------------

describe('completeMission()', () => {
  let state;
  let cleanup;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('returns { success: true, mission, reward } on success', () => {
    const def = makeMissionDef({ id: 'm1', reward: 50_000 });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const result = completeMission(state, 'm1');
    expect(result.success).toBe(true);
    expect(result.reward).toBe(50_000);
    expect(result.mission.id).toBe('m1');
  });

  it('moves mission from accepted to completed', () => {
    const def = makeMissionDef({ id: 'm1' });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    completeMission(state, 'm1');
    expect(state.missions.accepted).toHaveLength(0);
    expect(state.missions.completed).toHaveLength(1);
    expect(state.missions.completed[0].id).toBe('m1');
  });

  it('sets mission status to "completed"', () => {
    const def = makeMissionDef({ id: 'm1' });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    completeMission(state, 'm1');
    expect(state.missions.completed[0].status).toBe(MissionStatus.COMPLETED);
  });

  it('awards the reward via earn()', () => {
    const def = makeMissionDef({ id: 'm1', reward: 25_000 });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);
    const moneyBefore = state.money;

    completeMission(state, 'm1');
    expect(state.money).toBe(moneyBefore + 25_000);
  });

  it('adds unlockedParts to state.parts', () => {
    const def = makeMissionDef({ id: 'm1', unlockedParts: ['part-engine-1', 'part-tank-2'] });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    completeMission(state, 'm1');
    expect(state.parts).toContain('part-engine-1');
    expect(state.parts).toContain('part-tank-2');
  });

  it('does not duplicate parts already in state.parts', () => {
    state.parts = ['part-engine-1'];
    const def = makeMissionDef({ id: 'm1', unlockedParts: ['part-engine-1'] });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    completeMission(state, 'm1');
    expect(state.parts.filter((p) => p === 'part-engine-1')).toHaveLength(1);
  });

  it('returns unlockedParts list', () => {
    const def = makeMissionDef({ id: 'm1', unlockedParts: ['part-x'] });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const result = completeMission(state, 'm1');
    expect(result.unlockedParts).toEqual(['part-x']);
  });

  it('returns { success: false, error } when mission not in accepted', () => {
    const result = completeMission(state, 'no-such-mission');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });

  it('does not modify state when mission not found', () => {
    const moneyBefore = state.money;
    completeMission(state, 'ghost');
    expect(state.money).toBe(moneyBefore);
    expect(state.missions.completed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getUnlockedMissions()
// ---------------------------------------------------------------------------

describe('getUnlockedMissions()', () => {
  let state;
  let cleanup;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('returns empty array when no new missions unlocked', () => {
    cleanup = withMissions(makeMissionDef({ id: 'm1', unlocksAfter: [] }));
    initializeMissions(state);
    expect(getUnlockedMissions(state)).toEqual([]);
  });

  it('unlocks a mission when its single prerequisite is completed', () => {
    cleanup = withMissions(
      makeMissionDef({ id: 'm1', unlocksAfter: [] }),
      makeMissionDef({ id: 'm2', unlocksAfter: ['m1'], status: MissionStatus.LOCKED }),
    );
    initializeMissions(state);

    // Manually mark m1 as completed.
    const m1 = state.missions.available.splice(0, 1)[0];
    m1.status = MissionStatus.COMPLETED;
    state.missions.completed.push(m1);

    const unlocked = getUnlockedMissions(state);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0].id).toBe('m2');
    expect(state.missions.available).toHaveLength(1);
    expect(state.missions.available[0].id).toBe('m2');
  });

  it('does not unlock a mission when only some prerequisites are met', () => {
    cleanup = withMissions(
      makeMissionDef({ id: 'pre1', unlocksAfter: [] }),
      makeMissionDef({ id: 'pre2', unlocksAfter: [] }),
      makeMissionDef({ id: 'gated', unlocksAfter: ['pre1', 'pre2'], status: MissionStatus.LOCKED }),
    );
    initializeMissions(state);

    // Complete only pre1.
    const pre1 = state.missions.available.find((m) => m.id === 'pre1');
    state.missions.available.splice(state.missions.available.indexOf(pre1), 1);
    pre1.status = MissionStatus.COMPLETED;
    state.missions.completed.push(pre1);

    const unlocked = getUnlockedMissions(state);
    expect(unlocked).toHaveLength(0);
    expect(state.missions.available.find((m) => m.id === 'gated')).toBeUndefined();
  });

  it('unlocks when all multiple prerequisites are met', () => {
    cleanup = withMissions(
      makeMissionDef({ id: 'pre1', unlocksAfter: [] }),
      makeMissionDef({ id: 'pre2', unlocksAfter: [] }),
      makeMissionDef({ id: 'gated', unlocksAfter: ['pre1', 'pre2'], status: MissionStatus.LOCKED }),
    );
    initializeMissions(state);

    // Complete both prerequisites.
    for (const id of ['pre1', 'pre2']) {
      const m = state.missions.available.find((x) => x.id === id);
      state.missions.available.splice(state.missions.available.indexOf(m), 1);
      m.status = MissionStatus.COMPLETED;
      state.missions.completed.push(m);
    }

    const unlocked = getUnlockedMissions(state);
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0].id).toBe('gated');
  });

  it('does not add a mission that is already in the available bucket', () => {
    cleanup = withMissions(makeMissionDef({ id: 'm1', unlocksAfter: [] }));
    initializeMissions(state);
    const before = state.missions.available.length;

    getUnlockedMissions(state);
    expect(state.missions.available.length).toBe(before);
  });

  it('does not re-add a mission that is already accepted', () => {
    cleanup = withMissions(
      makeMissionDef({ id: 'm1', unlocksAfter: [] }),
      makeMissionDef({ id: 'm2', unlocksAfter: ['m1'], status: MissionStatus.LOCKED }),
    );
    initializeMissions(state);

    // Manually set up: m1 completed, m2 already accepted.
    const m1 = state.missions.available.splice(0, 1)[0];
    m1.status = MissionStatus.COMPLETED;
    state.missions.completed.push(m1);

    const m2Instance = { ...makeMissionDef({ id: 'm2' }), status: MissionStatus.ACCEPTED };
    state.missions.accepted.push(m2Instance);

    const unlocked = getUnlockedMissions(state);
    expect(unlocked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getUnlockedParts()
// ---------------------------------------------------------------------------

describe('getUnlockedParts()', () => {
  let state;
  let cleanup;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('returns starting parts when no missions are completed', () => {
    state.parts = ['starter-part-1'];
    expect(getUnlockedParts(state)).toContain('starter-part-1');
  });

  it('includes parts unlocked by completed missions', () => {
    const def = makeMissionDef({ id: 'm1', unlockedParts: ['engine-mk2'] });
    cleanup = withMissions(def);
    state.missions.completed.push({ ...def, status: MissionStatus.COMPLETED });

    const parts = getUnlockedParts(state);
    expect(parts).toContain('engine-mk2');
  });

  it('deduplicates parts across missions and state.parts', () => {
    state.parts = ['shared-part'];
    const def = makeMissionDef({ id: 'm1', unlockedParts: ['shared-part', 'unique-part'] });
    cleanup = withMissions(def);
    state.missions.completed.push({ ...def, status: MissionStatus.COMPLETED });

    const parts = getUnlockedParts(state);
    expect(parts.filter((p) => p === 'shared-part')).toHaveLength(1);
    expect(parts).toContain('unique-part');
  });

  it('returns empty array when nothing is unlocked', () => {
    expect(getUnlockedParts(state)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — guards
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() guards', () => {
  it('does nothing when flightState is null', () => {
    const state = freshState();
    expect(() => checkObjectiveCompletion(state, null)).not.toThrow();
  });

  it('does nothing when no accepted missions exist', () => {
    const state = freshState();
    expect(() => checkObjectiveCompletion(state, { events: [], altitude: 0, velocity: 0, timeElapsed: 0 })).not.toThrow();
  });

  it('skips objectives already marked completed', () => {
    const state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 0 }, completed: true, description: 'already done' },
      ],
    });
    seedAcceptedMission(state, def);
    const fs = makeFlightState('m1', { altitude: 999 });
    checkObjectiveCompletion(state, fs);
    // Objective was already true — should stay true and not error.
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('checks objectives across multiple accepted missions', () => {
    const state = freshState();
    const def1 = makeMissionDef({
      id: 'mA',
      objectives: [
        { id: 'oA', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 500 }, completed: false, description: 'reach 500m' },
      ],
    });
    const def2 = makeMissionDef({
      id: 'mB',
      objectives: [
        { id: 'oB', type: ObjectiveType.REACH_SPEED, target: { speed: 100 }, completed: false, description: 'reach 100 m/s' },
      ],
    });
    seedAcceptedMission(state, def1);
    seedAcceptedMission(state, def2);

    const fs = makeFlightState('mA', { altitude: 600, velocity: 150 });
    checkObjectiveCompletion(state, fs);

    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
    expect(state.missions.accepted[1].objectives[0].completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — REACH_ALTITUDE
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — REACH_ALTITUDE', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 500 }, completed: false, description: 'reach 500m' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks objective completed when altitude threshold is met', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 500 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('marks completed when altitude exceeds threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when below threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 499 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — REACH_SPEED
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — REACH_SPEED', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_SPEED, target: { speed: 150 }, completed: false, description: 'reach 150 m/s' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed at exact threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { velocity: 150 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete below threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { velocity: 149 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — SAFE_LANDING
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — SAFE_LANDING', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.SAFE_LANDING, target: { maxLandingSpeed: 10 }, completed: false, description: 'land softly' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when LANDING event speed is within limit', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 30, speed: 8, description: 'soft landing' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('marks completed at exact speed limit', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 30, speed: 10, description: 'landing' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when LANDING speed exceeds limit', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 30, speed: 11, description: 'hard landing' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('does not complete with no events', () => {
    checkObjectiveCompletion(state, makeFlightState('m1'));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — ACTIVATE_PART
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — ACTIVATE_PART', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.ACTIVATE_PART, target: { partType: 'PARACHUTE' }, completed: false, description: 'deploy parachute' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when correct PART_ACTIVATED event present', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'PART_ACTIVATED', time: 20, partType: 'PARACHUTE', description: 'parachute deployed' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when partType does not match', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'PART_ACTIVATED', time: 20, partType: 'ENGINE', description: 'engine ignited' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('does not complete with no events', () => {
    checkObjectiveCompletion(state, makeFlightState('m1'));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — HOLD_ALTITUDE
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — HOLD_ALTITUDE', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        {
          id: 'o1',
          type: ObjectiveType.HOLD_ALTITUDE,
          target: { minAltitude: 800, maxAltitude: 1200, duration: 30 },
          completed: false,
          description: 'hold 800–1200m for 30s',
        },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('starts timing when rocket enters the altitude band', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 10 }));
    expect(state.missions.accepted[0].objectives[0]._holdEnteredAt).toBe(10);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('marks completed after holding for the full duration', () => {
    const obj = state.missions.accepted[0].objectives[0];
    // Simulate entering at t=10.
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 10 }));
    // Simulate still in range at t=40 (30s elapsed).
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 40 }));
    expect(obj.completed).toBe(true);
  });

  it('does not complete when holding for less than duration', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 10 }));
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 39 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('resets timer when rocket leaves the band', () => {
    const obj = state.missions.accepted[0].objectives[0];
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 10 }));
    // Rocket leaves the band.
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 500, timeElapsed: 20 }));
    expect(obj._holdEnteredAt).toBeNull();
  });

  it('does not complete after timer reset and insufficient re-entry time', () => {
    const obj = state.missions.accepted[0].objectives[0];
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 10 }));
    // Leave band.
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 500, timeElapsed: 20 }));
    // Re-enter band at t=25 — only 5s before t=30.
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 25 }));
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 30 }));
    expect(obj.completed).toBe(false);
  });

  it('does not complete when below the altitude band', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 799, timeElapsed: 0 }));
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 799, timeElapsed: 60 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('does not complete when above the altitude band', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1201, timeElapsed: 0 }));
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1201, timeElapsed: 60 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — RETURN_SCIENCE_DATA
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — RETURN_SCIENCE_DATA', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.RETURN_SCIENCE_DATA, target: {}, completed: false, description: 'collect and return science' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when science collected AND safe landing', () => {
    const fs = makeFlightState('m1', {
      events: [
        { type: 'SCIENCE_COLLECTED', time: 60, description: 'data gathered' },
        { type: 'LANDING', time: 120, speed: 5, description: 'soft landing' },
      ],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete without safe landing', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SCIENCE_COLLECTED', time: 60, description: 'data gathered' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('does not complete without science collection', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 120, speed: 5, description: 'landing' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('does not complete when landing is too hard (> 10 m/s)', () => {
    const fs = makeFlightState('m1', {
      events: [
        { type: 'SCIENCE_COLLECTED', time: 60, description: 'data' },
        { type: 'LANDING', time: 120, speed: 15, description: 'hard landing' },
      ],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — CONTROLLED_CRASH
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — CONTROLLED_CRASH', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.CONTROLLED_CRASH, target: { minCrashSpeed: 50 }, completed: false, description: 'crash at 50+ m/s' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when LANDING speed meets threshold', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 30, speed: 60, description: 'crash' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('marks completed when CRASH event speed meets threshold', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'CRASH', time: 30, speed: 50, description: 'crash' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when impact speed is below threshold', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 30, speed: 49, description: 'soft crash' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — EJECT_CREW
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — EJECT_CREW', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.EJECT_CREW, target: { minAltitude: 200 }, completed: false, description: 'eject at 200m+' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when CREW_EJECTED at or above minAltitude', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'CREW_EJECTED', time: 15, altitude: 250, description: 'ejected' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when ejection altitude is below minimum', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'CREW_EJECTED', time: 15, altitude: 199, description: 'ejected low' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — RELEASE_SATELLITE
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — RELEASE_SATELLITE', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.RELEASE_SATELLITE, target: { minAltitude: 30_000 }, completed: false, description: 'release satellite above 30km' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when SATELLITE_RELEASED at or above minAltitude', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 200, altitude: 35_000, description: 'satellite deployed' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when altitude is below minimum', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 200, altitude: 29_999, description: 'too low' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('completes when SATELLITE_RELEASED event has velocity field (backwards compatible)', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 200, altitude: 35_000, velocity: 1_500, description: 'deployed with velocity' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — RELEASE_SATELLITE with minVelocity
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — RELEASE_SATELLITE with minVelocity', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        {
          id: 'o1',
          type: ObjectiveType.RELEASE_SATELLITE,
          target: { minAltitude: 80_000, minVelocity: 7_000 },
          completed: false,
          description: 'release satellite in orbit',
        },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('completes when both altitude and velocity thresholds are met', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 300, altitude: 85_000, velocity: 7_500, description: 'orbital deployment' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when altitude met but velocity below minimum', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 300, altitude: 85_000, velocity: 6_999, description: 'too slow' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('does not complete when altitude too low even if velocity is met', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 300, altitude: 79_999, velocity: 8_000, description: 'altitude too low' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('does not complete when velocity field is missing from event', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 300, altitude: 85_000, description: 'no velocity field' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — REACH_ORBIT
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — REACH_ORBIT', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        {
          id: 'o1',
          type: ObjectiveType.REACH_ORBIT,
          target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
          completed: false,
          description: 'reach LEO',
        },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when both altitude and velocity thresholds are met', () => {
    const fs = makeFlightState('m1', { altitude: 80_000, velocity: 7_800 });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('does not complete when only altitude is met', () => {
    const fs = makeFlightState('m1', { altitude: 80_000, velocity: 7_000 });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('does not complete when only velocity is met', () => {
    const fs = makeFlightState('m1', { altitude: 50_000, velocity: 7_800 });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });

  it('marks completed when both thresholds are exceeded', () => {
    const fs = makeFlightState('m1', { altitude: 100_000, velocity: 8_000 });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Catalog Integration Tests — using the real MISSIONS catalog data
//
// These tests verify the ten specific behaviours called out in TASK-040:
//   (1)  At game start, only Mission 1 (First Flight) is available.
//   (2)  Completing Mission 1 makes Mission 2 available.
//   (3)  Completing Mission 4 makes Missions 5, 6, and 7 simultaneously available.
//   (4)  A mission with two prerequisites only unlocks after BOTH are completed.
//   (5)  acceptMission sets mission status to 'accepted'.
//   (6)  During early tutorial, accepting one mission prevents accepting a second.
//   (7)  After early tutorial, multiple missions can be accepted simultaneously.
//   (8)  checkObjectiveCompletion at 100m marks the REACH_ALTITUDE 100m objective done.
//   (9)  Completing all objectives then calling completeMission marks the mission done.
//   (10) getUnlockedParts returns correct part IDs after specific missions complete.
// ---------------------------------------------------------------------------

describe('Catalog (1): only Mission 1 is available at game start', () => {
  it('initializeMissions seeds exactly one mission from the real catalog', () => {
    const state = freshState();
    initializeMissions(state);
    expect(state.missions.available).toHaveLength(1);
    expect(state.missions.available[0].id).toBe('mission-001');
    expect(state.missions.available[0].title).toBe('First Flight');
  });

  it('missions 2–17 are all locked at game start', () => {
    const state = freshState();
    initializeMissions(state);
    const ids = state.missions.available.map((m) => m.id);
    for (let i = 2; i <= 17; i++) {
      expect(ids).not.toContain(`mission-${String(i).padStart(3, '0')}`);
    }
  });
});

describe('Catalog (2): completing Mission 1 makes Mission 2 available', () => {
  it('mission-002 appears in available after completing mission-001', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    completeMission(state, 'mission-001');
    const ids = state.missions.available.map((m) => m.id);
    expect(ids).toContain('mission-002');
    expect(ids).not.toContain('mission-001');
  });

  it('mission-002 is the only newly available mission after completing mission-001', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    completeMission(state, 'mission-001');
    expect(state.missions.available).toHaveLength(1);
    expect(state.missions.available[0].id).toBe('mission-002');
  });
});

describe('Catalog (3): completing Mission 4 unlocks Missions 5, 6, and 7 simultaneously', () => {
  /** Helper: advance through the linear tutorial chain up to and including `targetId`. */
  function completeTutorialChainTo(state, targetId) {
    const chain = ['mission-001', 'mission-002', 'mission-003', 'mission-004'];
    for (const id of chain) {
      acceptMission(state, id);
      completeMission(state, id);
      if (id === targetId) break;
    }
  }

  it('missions 5, 6, 7, and 18 become available after mission-004 is completed', () => {
    const state = freshState();
    initializeMissions(state);
    completeTutorialChainTo(state, 'mission-004');
    const ids = state.missions.available.map((m) => m.id);
    expect(ids).toContain('mission-005');
    expect(ids).toContain('mission-006');
    expect(ids).toContain('mission-007');
    expect(ids).toContain('mission-018');
    expect(ids).toHaveLength(4);
  });

  it('missions 5, 6, and 7 are not available after only mission-003 is completed', () => {
    const state = freshState();
    initializeMissions(state);
    completeTutorialChainTo(state, 'mission-003');
    const ids = state.missions.available.map((m) => m.id);
    expect(ids).not.toContain('mission-005');
    expect(ids).not.toContain('mission-006');
    expect(ids).not.toContain('mission-007');
  });
});

describe('Catalog (4): two-prerequisite mission only unlocks when both prereqs are complete', () => {
  // mission-011 ("Emergency Systems Verified") requires mission-008 AND mission-009.

  it('mission-011 does not unlock when only mission-008 is completed', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-008', status: MissionStatus.COMPLETED });
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).not.toContain('mission-011');
  });

  it('mission-011 does not unlock when only mission-009 is completed', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-009', status: MissionStatus.COMPLETED });
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).not.toContain('mission-011');
  });

  it('mission-011 unlocks once both mission-008 and mission-009 are completed', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-008', status: MissionStatus.COMPLETED });
    state.missions.completed.push({ id: 'mission-009', status: MissionStatus.COMPLETED });
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).toContain('mission-011');
  });
});

describe('Catalog (5): acceptMission sets mission status to accepted', () => {
  it('mission-001 status becomes "accepted" after acceptMission is called', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    expect(state.missions.accepted[0].status).toBe(MissionStatus.ACCEPTED);
    expect(state.missions.accepted[0].id).toBe('mission-001');
  });
});

describe('Catalog (6): early tutorial allows only one accepted mission at a time', () => {
  it('attempting to accept a second mission during early tutorial returns { success: false }', () => {
    const state = freshState();
    initializeMissions(state);
    // Accept the only available mission (mission-001).
    acceptMission(state, 'mission-001');
    // mission-002 is still locked — not yet in the available bucket.
    const result = acceptMission(state, 'mission-002');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    // Only the first accept succeeded.
    expect(state.missions.accepted).toHaveLength(1);
  });

  it('available bucket is empty after accepting the sole early-tutorial mission', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    expect(state.missions.available).toHaveLength(0);
  });
});

describe('Catalog (7): after early tutorial, multiple missions can be accepted simultaneously', () => {
  /** Complete the linear chain so that missions 5, 6, 7 are all available. */
  function completeTutorialChain(state) {
    for (const id of ['mission-001', 'mission-002', 'mission-003', 'mission-004']) {
      acceptMission(state, id);
      completeMission(state, id);
    }
  }

  it('missions 5, 6, and 7 can all be accepted at the same time', () => {
    const state = freshState();
    initializeMissions(state);
    completeTutorialChain(state);

    const r5 = acceptMission(state, 'mission-005');
    const r6 = acceptMission(state, 'mission-006');
    const r7 = acceptMission(state, 'mission-007');

    expect(r5.success).toBe(true);
    expect(r6.success).toBe(true);
    expect(r7.success).toBe(true);
    expect(state.missions.accepted).toHaveLength(3);
    const acceptedIds = state.missions.accepted.map((m) => m.id);
    expect(acceptedIds).toContain('mission-005');
    expect(acceptedIds).toContain('mission-006');
    expect(acceptedIds).toContain('mission-007');
  });
});

describe('Catalog (8): checkObjectiveCompletion at 100 m marks mission-001 objective complete', () => {
  let state;

  beforeEach(() => {
    state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
  });

  it('REACH_ALTITUDE objective is completed when altitude equals 100 m', () => {
    checkObjectiveCompletion(state, makeFlightState('mission-001', { altitude: 100 }));
    const obj = state.missions.accepted[0].objectives[0];
    expect(obj.type).toBe(ObjectiveType.REACH_ALTITUDE);
    expect(obj.target.altitude).toBe(100);
    expect(obj.completed).toBe(true);
  });

  it('REACH_ALTITUDE objective is completed when altitude exceeds 100 m', () => {
    checkObjectiveCompletion(state, makeFlightState('mission-001', { altitude: 500 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(true);
  });

  it('REACH_ALTITUDE objective is NOT completed when altitude is 99 m', () => {
    checkObjectiveCompletion(state, makeFlightState('mission-001', { altitude: 99 }));
    expect(state.missions.accepted[0].objectives[0].completed).toBe(false);
  });
});

describe('Catalog (9): completing all objectives then calling completeMission marks mission done', () => {
  it('mission-001 moves to completed after its altitude objective is met and completeMission is called', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');

    // Drive the sole objective to completion via checkObjectiveCompletion.
    checkObjectiveCompletion(state, makeFlightState('mission-001', { altitude: 100 }));
    const obj = state.missions.accepted[0].objectives[0];
    expect(obj.completed).toBe(true); // sanity-check: objective really is done

    // Now formally complete the mission.
    const result = completeMission(state, 'mission-001');
    expect(result.success).toBe(true);
    expect(state.missions.accepted).toHaveLength(0);
    expect(state.missions.completed).toHaveLength(1);
    expect(state.missions.completed[0].id).toBe('mission-001');
    expect(state.missions.completed[0].status).toBe(MissionStatus.COMPLETED);
  });

  it('all objective flags remain true on the completed mission instance', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    checkObjectiveCompletion(state, makeFlightState('mission-001', { altitude: 100 }));
    completeMission(state, 'mission-001');
    const completedObjs = state.missions.completed[0].objectives;
    expect(completedObjs.every((o) => o.completed)).toBe(true);
  });
});

describe('Catalog (10): getUnlockedParts returns correct part IDs after catalog missions complete', () => {
  it('returns parachute-mk2 after mission-005 is completed', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-005', status: MissionStatus.COMPLETED });
    expect(getUnlockedParts(state)).toContain('parachute-mk2');
  });

  it('returns landing-legs-small after mission-006 is completed', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-006', status: MissionStatus.COMPLETED });
    expect(getUnlockedParts(state)).toContain('landing-legs-small');
  });

  it('returns landing-legs-large after mission-007 is completed', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-007', status: MissionStatus.COMPLETED });
    expect(getUnlockedParts(state)).toContain('landing-legs-large');
  });

  it('returns engine-poodle after mission-010 is completed', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-010', status: MissionStatus.COMPLETED });
    expect(getUnlockedParts(state)).toContain('engine-poodle');
  });

  it('returns engine-reliant and srb-small after mission-012 is completed', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-012', status: MissionStatus.COMPLETED });
    const parts = getUnlockedParts(state);
    expect(parts).toContain('engine-reliant');
    expect(parts).toContain('srb-small');
  });

  it('accumulates parts from multiple completed missions without duplicates', () => {
    const state = freshState();
    state.missions.completed.push({ id: 'mission-005', status: MissionStatus.COMPLETED });
    state.missions.completed.push({ id: 'mission-006', status: MissionStatus.COMPLETED });
    state.missions.completed.push({ id: 'mission-007', status: MissionStatus.COMPLETED });
    const parts = getUnlockedParts(state);
    expect(parts).toContain('parachute-mk2');
    expect(parts).toContain('landing-legs-small');
    expect(parts).toContain('landing-legs-large');
    // Each part ID appears exactly once.
    expect(parts.filter((p) => p === 'parachute-mk2')).toHaveLength(1);
    expect(parts.filter((p) => p === 'landing-legs-small')).toHaveLength(1);
    expect(parts.filter((p) => p === 'landing-legs-large')).toHaveLength(1);
  });

  it('includes starting state.parts alongside mission-unlocked parts', () => {
    const state = freshState();
    state.parts = ['starter-engine'];
    state.missions.completed.push({ id: 'mission-005', status: MissionStatus.COMPLETED });
    const parts = getUnlockedParts(state);
    expect(parts).toContain('starter-engine');
    expect(parts).toContain('parachute-mk2');
  });
});

// ---------------------------------------------------------------------------
// Integration: full mission lifecycle
// ---------------------------------------------------------------------------

describe('Mission lifecycle integration', () => {
  let state;
  let cleanup;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('completes the full available → accepted → completed flow', () => {
    cleanup = withMissions(makeMissionDef({ id: 'flow-test', reward: 20_000, unlocksAfter: [] }));
    initializeMissions(state);

    expect(state.missions.available).toHaveLength(1);

    acceptMission(state, 'flow-test');
    expect(state.missions.available).toHaveLength(0);
    expect(state.missions.accepted).toHaveLength(1);

    completeMission(state, 'flow-test');
    expect(state.missions.accepted).toHaveLength(0);
    expect(state.missions.completed).toHaveLength(1);
  });

  it('completing a mission unlocks the next one automatically', () => {
    cleanup = withMissions(
      makeMissionDef({ id: 'step-1', reward: 10_000, unlocksAfter: [] }),
      makeMissionDef({ id: 'step-2', reward: 15_000, unlocksAfter: ['step-1'], status: MissionStatus.LOCKED }),
    );
    initializeMissions(state);
    expect(state.missions.available).toHaveLength(1);

    acceptMission(state, 'step-1');
    completeMission(state, 'step-1');

    // step-2 should now be in the available bucket.
    expect(state.missions.available).toHaveLength(1);
    expect(state.missions.available[0].id).toBe('step-2');
  });

  it('completing a mission awards the correct reward', () => {
    const def = makeMissionDef({ id: 'm-reward', reward: 99_000, unlocksAfter: [] });
    cleanup = withMissions(def);
    initializeMissions(state);
    const moneyBefore = state.money;

    acceptMission(state, 'm-reward');
    completeMission(state, 'm-reward');

    expect(state.money).toBe(moneyBefore + 99_000);
  });

  it('completing a mission adds unlockedParts to state.parts', () => {
    const def = makeMissionDef({ id: 'm-parts', unlocksAfter: [], unlockedParts: ['super-engine'] });
    cleanup = withMissions(def);
    initializeMissions(state);

    acceptMission(state, 'm-parts');
    completeMission(state, 'm-parts');

    expect(state.parts).toContain('super-engine');
  });
});

// ---------------------------------------------------------------------------
// processFlightReturn() — multi-mission completion
// ---------------------------------------------------------------------------

describe('processFlightReturn() — multi-mission completion', () => {
  it('completes two missions when all objectives are met and credits both rewards', () => {
    const state = freshState();
    // Zero out any starting loan so interest doesn't affect the assertion.
    state.loan = { balance: 0, interestRate: 0 };

    // Seed two accepted missions with completed objectives.
    const def1 = makeMissionDef({
      id: 'pr-m1',
      title: 'Mission Alpha',
      reward: 5000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'reach 100m' },
      ],
    });
    const def2 = makeMissionDef({
      id: 'pr-m2',
      title: 'Mission Beta',
      reward: 8000,
      objectives: [
        { id: 'o2', type: ObjectiveType.REACH_SPEED, target: { speed: 50 }, completed: true, description: 'reach 50 m/s' },
      ],
    });
    seedAcceptedMission(state, def1);
    seedAcceptedMission(state, def2);

    const moneyBefore = state.money;
    const fs = makeFlightState('pr-m1');

    const result = processFlightReturn(state, fs, null, null);

    expect(result.completedMissions).toHaveLength(2);
    expect(state.missions.completed.map((m) => m.id)).toContain('pr-m1');
    expect(state.missions.completed.map((m) => m.id)).toContain('pr-m2');
    // Operating costs (facility upkeep) are deducted each period.
    expect(state.money).toBe(moneyBefore + 5000 + 8000 - result.operatingCosts);
  });

  it('completes only missions whose objectives are all met', () => {
    const state = freshState();
    state.loan = { balance: 0, interestRate: 0 };

    const def1 = makeMissionDef({
      id: 'pr-done',
      reward: 3000,
      objectives: [
        { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
      ],
    });
    const def2 = makeMissionDef({
      id: 'pr-pending',
      reward: 7000,
      objectives: [
        { id: 'o2', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 9999 }, completed: false, description: 'not done' },
      ],
    });
    seedAcceptedMission(state, def1);
    seedAcceptedMission(state, def2);

    const moneyBefore = state.money;
    const fs = makeFlightState('pr-done');

    const result = processFlightReturn(state, fs, null, null);

    expect(result.completedMissions).toHaveLength(1);
    expect(result.completedMissions[0].mission.id).toBe('pr-done');
    expect(state.missions.accepted).toHaveLength(1);
    expect(state.missions.accepted[0].id).toBe('pr-pending');
    // Operating costs (facility upkeep) are deducted each period.
    expect(state.money).toBe(moneyBefore + 3000 - result.operatingCosts);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion — only accepted missions (Item 39)
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — only accepted missions', () => {
  it('completed missions are not re-evaluated', () => {
    const state = freshState();
    const def = makeMissionDef({
      id: 'already-done',
      objectives: [
        {
          id: 'o-alt',
          type: ObjectiveType.REACH_ALTITUDE,
          target: { altitude: 100 },
          completed: false,
          description: 'Reach 100 m',
        },
      ],
    });

    // Place the mission directly in the completed bucket.
    state.missions.completed.push({
      ...def,
      objectives: def.objectives.map((o) => ({ ...o })),
      status: MissionStatus.COMPLETED,
    });

    // FlightState that would normally satisfy the objective.
    const fs = makeFlightState('already-done', { altitude: 500 });

    checkObjectiveCompletion(state, fs);

    // The completed mission's objective should remain untouched.
    expect(state.missions.completed[0].objectives[0].completed).toBe(false);
  });
});

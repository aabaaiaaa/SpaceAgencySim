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

/** Splice `defs` into MISSIONS and return a cleanup function. */
function withMissions(...defs) {
  const origLen = MISSIONS.length;
  MISSIONS.push(...defs);
  return () => {
    MISSIONS.splice(origLen, MISSIONS.length - origLen);
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

  it('does nothing when flightState has no missionId', () => {
    const state = freshState();
    expect(() => checkObjectiveCompletion(state, { missionId: null, events: [], altitude: 0, velocity: 0, timeElapsed: 0 })).not.toThrow();
  });

  it('does nothing when missionId does not match any accepted mission', () => {
    const state = freshState();
    const fs = makeFlightState('ghost-mission');
    expect(() => checkObjectiveCompletion(state, fs)).not.toThrow();
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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState, FlightState, MissionInstance } from '../core/gameState.ts';
import {
  initializeMissions,
  getAvailableMissions,
  acceptMission,
  completeMission,
  getUnlockedMissions,
  getUnlockedParts,
  checkObjectiveCompletion,
  canTurnInMission,
  getMissionsReadyToTurnIn,
} from '../core/missions.ts';
import { processFlightReturn } from '../core/flightReturn.ts';
import { MISSIONS, ObjectiveType, MissionStatus, rebuildMissionsIndex } from '../data/missions.ts';
import type { MissionDef } from '../data/missions.ts';
import { MissionState, FlightPhase, CelestialBody } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function freshState(): GameState {
  return createGameState();
}

function makeMissionDef(overrides: Partial<MissionDef> = {}): MissionDef {
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

function seedAcceptedMission(state: GameState, def: MissionDef): MissionInstance {
  const instance: MissionInstance = {
    id: def.id,
    title: def.title,
    description: def.description,
    reward: def.reward,
    deadline: '',
    state: MissionState.ACCEPTED,
    requirements: { requiredParts: [] },
    acceptedDate: null,
    completedDate: null,
    objectives: def.objectives.map((o) => ({ ...o })),
    unlockedParts: [...def.unlockedParts],
    location: def.location,
    unlocksAfter: [...def.unlocksAfter],
    templateStatus: def.status,
  };
  state.missions.accepted.push(instance);
  return instance;
}

function makeFlightState(missionId: string, overrides: Partial<FlightState> = {}): FlightState {
  return {
    missionId,
    rocketId: 'rocket-1',
    crewIds: [],
    crewCount: 0,
    timeElapsed: 0,
    altitude: 0,
    velocity: 0,
    horizontalVelocity: 0,
    fuelRemaining: 1000,
    deltaVRemaining: 5000,
    events: [],
    aborted: false,
    phase: FlightPhase.FLIGHT,
    phaseLog: [],
    inOrbit: false,
    orbitalElements: null,
    bodyId: CelestialBody.EARTH,
    orbitBandId: null,
    currentBiome: null,
    biomesVisited: [],
    maxAltitude: 0,
    maxVelocity: 0,
    dockingState: null,
    transferState: null,
    powerState: null,
    commsState: null,
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

function withMissions(...defs: MissionDef[]): () => void {
  const saved = MISSIONS.splice(0, MISSIONS.length); // save & clear
  MISSIONS.push(...defs);
  rebuildMissionsIndex();
  return () => {
    MISSIONS.splice(0, MISSIONS.length); // clear injected
    MISSIONS.push(...saved);             // restore original
    rebuildMissionsIndex();
  };
}

function makeCompletedStub(id: string): MissionInstance {
  return {
    id,
    title: '',
    description: '',
    reward: 0,
    deadline: '',
    state: MissionState.COMPLETED,
    requirements: { requiredParts: [] },
    acceptedDate: null,
    completedDate: null,
    objectives: [],
    unlockedParts: [],
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
    const expected: (keyof typeof ObjectiveType)[] = [
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
  let state: GameState;
  let cleanup: (() => void) | null;

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
    state.missions.available[0].objectives![0].completed = true;

    // Template must remain unchanged.
    expect(def.objectives[0].completed).toBe(false);
  });

  it('sets state to AVAILABLE on copied instance', () => {
    cleanup = withMissions(makeMissionDef({ id: 'x', unlocksAfter: [] }));
    initializeMissions(state);
    expect(state.missions.available[0].state).toBe(MissionState.AVAILABLE);
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
    state.missions.available.push(makeCompletedStub(m.id));
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
  let state: GameState;
  let cleanup: (() => void) | null;

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
    expect(result.mission!.id).toBe('mission-a');
  });

  it('moves mission from available to accepted', () => {
    acceptMission(state, 'mission-a');
    expect(state.missions.available).toHaveLength(0);
    expect(state.missions.accepted).toHaveLength(1);
    expect(state.missions.accepted[0].id).toBe('mission-a');
  });

  it('sets mission state to ACCEPTED', () => {
    acceptMission(state, 'mission-a');
    expect(state.missions.accepted[0].state).toBe(MissionState.ACCEPTED);
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
    const instance = state.missions.available.find(m => m.id === 'mission-req')!;
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
  let state: GameState;
  let cleanup: (() => void) | null;

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
    expect(result.mission!.id).toBe('m1');
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

  it('sets mission state to COMPLETED', () => {
    const def = makeMissionDef({ id: 'm1' });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    completeMission(state, 'm1');
    expect(state.missions.completed[0].state).toBe(MissionState.COMPLETED);
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
  let state: GameState;
  let cleanup: (() => void) | null;

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
    m1.state = MissionState.COMPLETED;
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
    const pre1 = state.missions.available.find((m) => m.id === 'pre1')!;
    state.missions.available.splice(state.missions.available.indexOf(pre1), 1);
    pre1.state = MissionState.COMPLETED;
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
      const m = state.missions.available.find((x) => x.id === id)!;
      state.missions.available.splice(state.missions.available.indexOf(m), 1);
      m.state = MissionState.COMPLETED;
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
    m1.state = MissionState.COMPLETED;
    state.missions.completed.push(m1);

    const m2Instance: MissionInstance = {
      ...makeCompletedStub('m2'),
      state: MissionState.ACCEPTED,
    };
    state.missions.accepted.push(m2Instance);

    const unlocked = getUnlockedMissions(state);
    expect(unlocked).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getUnlockedParts()
// ---------------------------------------------------------------------------

describe('getUnlockedParts()', () => {
  let state: GameState;
  let cleanup: (() => void) | null;

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
    state.missions.completed.push(makeCompletedStub('m1'));

    const parts = getUnlockedParts(state);
    expect(parts).toContain('engine-mk2');
  });

  it('deduplicates parts across missions and state.parts', () => {
    state.parts = ['shared-part'];
    const def = makeMissionDef({ id: 'm1', unlockedParts: ['shared-part', 'unique-part'] });
    cleanup = withMissions(def);
    state.missions.completed.push(makeCompletedStub('m1'));

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
    expect(() => checkObjectiveCompletion(state, makeFlightState('', { events: [], altitude: 0, velocity: 0, timeElapsed: 0 }))).not.toThrow();
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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
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

    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
    expect(state.missions.accepted[1].objectives![0].completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — REACH_ALTITUDE
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — REACH_ALTITUDE', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('marks completed when altitude exceeds threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when below threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 499 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — REACH_SPEED
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — REACH_SPEED', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete below threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { velocity: 149 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — SAFE_LANDING
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — SAFE_LANDING', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('marks completed at exact speed limit', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 30, speed: 10, description: 'landing' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when LANDING speed exceeds limit', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 30, speed: 11, description: 'hard landing' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not complete with no events', () => {
    checkObjectiveCompletion(state, makeFlightState('m1'));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — ACTIVATE_PART
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — ACTIVATE_PART', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when partType does not match', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'PART_ACTIVATED', time: 20, partType: 'ENGINE', description: 'engine ignited' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not complete with no events', () => {
    checkObjectiveCompletion(state, makeFlightState('m1'));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — HOLD_ALTITUDE
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — HOLD_ALTITUDE', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0]._holdEnteredAt).toBe(10);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('marks completed after holding for the full duration', () => {
    const obj = state.missions.accepted[0].objectives![0];
    // Simulate entering at t=10.
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 10 }));
    // Simulate still in range at t=40 (30s elapsed).
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 40 }));
    expect(obj.completed).toBe(true);
  });

  it('does not complete when holding for less than duration', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 10 }));
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 39 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('resets timer when rocket leaves the band', () => {
    const obj = state.missions.accepted[0].objectives![0];
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1000, timeElapsed: 10 }));
    // Rocket leaves the band.
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 500, timeElapsed: 20 }));
    expect(obj._holdEnteredAt).toBeNull();
  });

  it('does not complete after timer reset and insufficient re-entry time', () => {
    const obj = state.missions.accepted[0].objectives![0];
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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not complete when above the altitude band', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1201, timeElapsed: 0 }));
    checkObjectiveCompletion(state, makeFlightState('m1', { altitude: 1201, timeElapsed: 60 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — RETURN_SCIENCE_DATA
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — RETURN_SCIENCE_DATA', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete without safe landing', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SCIENCE_COLLECTED', time: 60, description: 'data gathered' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not complete without science collection', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 120, speed: 5, description: 'landing' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not complete when landing is too hard (> 10 m/s)', () => {
    const fs = makeFlightState('m1', {
      events: [
        { type: 'SCIENCE_COLLECTED', time: 60, description: 'data' },
        { type: 'LANDING', time: 120, speed: 15, description: 'hard landing' },
      ],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — CONTROLLED_CRASH
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — CONTROLLED_CRASH', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('marks completed when CRASH event speed meets threshold', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'CRASH', time: 30, speed: 50, description: 'crash' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when impact speed is below threshold', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'LANDING', time: 30, speed: 49, description: 'soft crash' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — EJECT_CREW
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — EJECT_CREW', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when ejection altitude is below minimum', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'CREW_EJECTED', time: 15, altitude: 199, description: 'ejected low' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — RELEASE_SATELLITE
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — RELEASE_SATELLITE', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when altitude is below minimum', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 200, altitude: 29_999, description: 'too low' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('completes when SATELLITE_RELEASED event has velocity field (backwards compatible)', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 200, altitude: 35_000, velocity: 1_500, description: 'deployed with velocity' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — RELEASE_SATELLITE with minVelocity
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — RELEASE_SATELLITE with minVelocity', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when altitude met but velocity below minimum', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 300, altitude: 85_000, velocity: 6_999, description: 'too slow' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not complete when altitude too low even if velocity is met', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 300, altitude: 79_999, velocity: 8_000, description: 'altitude too low' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not complete when velocity field is missing from event', () => {
    const fs = makeFlightState('m1', {
      events: [{ type: 'SATELLITE_RELEASED', time: 300, altitude: 85_000, description: 'no velocity field' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkObjectiveCompletion() — REACH_ORBIT
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — REACH_ORBIT', () => {
  let state: GameState;

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
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when only altitude is met', () => {
    const fs = makeFlightState('m1', { altitude: 80_000, velocity: 7_000 });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not complete when only velocity is met', () => {
    const fs = makeFlightState('m1', { altitude: 50_000, velocity: 7_800 });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('marks completed when both thresholds are exceeded', () => {
    const fs = makeFlightState('m1', { altitude: 100_000, velocity: 8_000 });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
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

describe('Catalog (2): completing Mission 1 makes Mission 4 available', () => {
  it('mission-004 appears in available after completing mission-001', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    completeMission(state, 'mission-001');
    const ids = state.missions.available.map((m) => m.id);
    expect(ids).toContain('mission-004');
    expect(ids).not.toContain('mission-001');
  });

  it('mission-004 is the only newly available mission after completing mission-001', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    completeMission(state, 'mission-001');
    expect(state.missions.available).toHaveLength(1);
    expect(state.missions.available[0].id).toBe('mission-004');
  });
});

describe('Catalog (3): completing Mission 4 unlocks Missions 5 and 6', () => {
  function completeTutorialChainTo(state: GameState, targetId: string): void {
    const chain = ['mission-001', 'mission-004'];
    for (const id of chain) {
      acceptMission(state, id);
      completeMission(state, id);
      if (id === targetId) break;
    }
  }

  it('missions 5 and 6 become available after mission-004 is completed', () => {
    const state = freshState();
    initializeMissions(state);
    completeTutorialChainTo(state, 'mission-004');
    const ids = state.missions.available.map((m) => m.id);
    expect(ids).toContain('mission-005');
    expect(ids).toContain('mission-006');
    // Mission 7 now requires mission 6, mission 18 requires mission 9
    expect(ids).not.toContain('mission-007');
    expect(ids).not.toContain('mission-018');
    expect(ids).toHaveLength(2);
  });

  it('missions 5 and 6 are not available after only mission-001 is completed', () => {
    const state = freshState();
    initializeMissions(state);
    completeTutorialChainTo(state, 'mission-001');
    const ids = state.missions.available.map((m) => m.id);
    expect(ids).not.toContain('mission-005');
    expect(ids).not.toContain('mission-006');
  });
});

describe('Catalog (4): two-prerequisite mission only unlocks when both prereqs are complete', () => {
  // mission-011 ("Emergency Systems Verified") requires mission-008 AND mission-009.

  it('mission-011 does not unlock when only mission-008 is completed', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-008'));
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).not.toContain('mission-011');
  });

  it('mission-011 does not unlock when only mission-009 is completed', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-009'));
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).not.toContain('mission-011');
  });

  it('mission-011 unlocks once both mission-008 and mission-009 are completed', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-008'));
    state.missions.completed.push(makeCompletedStub('mission-009'));
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).toContain('mission-011');
  });
});

describe('Catalog (5): acceptMission sets mission state to ACCEPTED', () => {
  it('mission-001 state becomes ACCEPTED after acceptMission is called', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    expect(state.missions.accepted[0].state).toBe(MissionState.ACCEPTED);
    expect(state.missions.accepted[0].id).toBe('mission-001');
  });
});

describe('Catalog (6): early tutorial allows only one accepted mission at a time', () => {
  it('attempting to accept a second mission during early tutorial returns { success: false }', () => {
    const state = freshState();
    initializeMissions(state);
    // Accept the only available mission (mission-001).
    acceptMission(state, 'mission-001');
    // mission-004 is still locked — not yet in the available bucket.
    const result = acceptMission(state, 'mission-004');
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
  function completeTutorialChain(state: GameState): void {
    for (const id of ['mission-001', 'mission-004']) {
      acceptMission(state, id);
      completeMission(state, id);
    }
  }

  it('missions 5 and 6 can both be accepted at the same time', () => {
    const state = freshState();
    initializeMissions(state);
    completeTutorialChain(state);

    const r5 = acceptMission(state, 'mission-005');
    const r6 = acceptMission(state, 'mission-006');

    expect(r5.success).toBe(true);
    expect(r6.success).toBe(true);
    expect(state.missions.accepted).toHaveLength(2);
    const acceptedIds = state.missions.accepted.map((m) => m.id);
    expect(acceptedIds).toContain('mission-005');
    expect(acceptedIds).toContain('mission-006');
  });
});

describe('Catalog (8): checkObjectiveCompletion marks mission-001 objectives complete', () => {
  let state: GameState;

  beforeEach(() => {
    state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
  });

  it('REACH_SPEED objective is completed when velocity reaches 150 m/s', () => {
    checkObjectiveCompletion(state, makeFlightState('mission-001', { velocity: 150 }));
    const obj = state.missions.accepted[0].objectives![0];
    expect(obj.type).toBe(ObjectiveType.REACH_SPEED);
    expect(obj.completed).toBe(true);
  });

  it('REACH_ALTITUDE objective is completed when altitude reaches 500 m', () => {
    checkObjectiveCompletion(state, makeFlightState('mission-001', { altitude: 500 }));
    const obj = state.missions.accepted[0].objectives![1];
    expect(obj.type).toBe(ObjectiveType.REACH_ALTITUDE);
    expect(obj.completed).toBe(true);
  });

  it('required objectives NOT completed below threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('mission-001', { velocity: 100, altitude: 400 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
    expect(state.missions.accepted[0].objectives![1].completed).toBe(false);
  });
});

describe('Catalog (9): completing all objectives then calling completeMission marks mission done', () => {
  it('mission-001 moves to completed after required objectives are met and completeMission is called', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');

    // Drive required objectives to completion.
    checkObjectiveCompletion(state, makeFlightState('mission-001', { velocity: 150, altitude: 500 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
    expect(state.missions.accepted[0].objectives![1].completed).toBe(true);

    // Now formally complete the mission.
    const result = completeMission(state, 'mission-001');
    expect(result.success).toBe(true);
    expect(state.missions.accepted).toHaveLength(0);
    expect(state.missions.completed).toHaveLength(1);
    expect(state.missions.completed[0].id).toBe('mission-001');
    expect(state.missions.completed[0].state).toBe(MissionState.COMPLETED);
  });

  it('required objective flags remain true on the completed mission instance', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    checkObjectiveCompletion(state, makeFlightState('mission-001', { velocity: 150, altitude: 500 }));
    completeMission(state, 'mission-001');
    const completedObjs = state.missions.completed[0].objectives!;
    // Required objectives (first two) should be completed.
    expect(completedObjs[0].completed).toBe(true);
    expect(completedObjs[1].completed).toBe(true);
  });
});

describe('Catalog (10): getUnlockedParts returns correct part IDs after catalog missions complete', () => {
  it('returns parachute-mk2 after mission-005 is completed', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-005'));
    expect(getUnlockedParts(state)).toContain('parachute-mk2');
  });

  it('returns landing-legs-small after mission-006 is completed', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-006'));
    expect(getUnlockedParts(state)).toContain('landing-legs-small');
  });

  it('returns landing-legs-large after mission-007 is completed', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-007'));
    expect(getUnlockedParts(state)).toContain('landing-legs-large');
  });

  it('returns engine-poodle after mission-010 is completed', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-010'));
    expect(getUnlockedParts(state)).toContain('engine-poodle');
  });

  it('returns engine-reliant and srb-small after mission-012 is completed', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-012'));
    const parts = getUnlockedParts(state);
    expect(parts).toContain('engine-reliant');
    expect(parts).toContain('srb-small');
  });

  it('accumulates parts from multiple completed missions without duplicates', () => {
    const state = freshState();
    state.missions.completed.push(makeCompletedStub('mission-005'));
    state.missions.completed.push(makeCompletedStub('mission-006'));
    state.missions.completed.push(makeCompletedStub('mission-007'));
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
    state.missions.completed.push(makeCompletedStub('mission-005'));
    const parts = getUnlockedParts(state);
    expect(parts).toContain('starter-engine');
    expect(parts).toContain('parachute-mk2');
  });
});

// ---------------------------------------------------------------------------
// Integration: full mission lifecycle
// ---------------------------------------------------------------------------

describe('Mission lifecycle integration', () => {
  let state: GameState;
  let cleanup: (() => void) | null;

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
  it('@smoke completes two missions when all objectives are met and credits both rewards', () => {
    const state = freshState();
    // Zero out any starting loan so interest doesn't affect the assertion.
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };

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
    state.loan = { balance: 0, interestRate: 0, totalInterestAccrued: 0 };

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
    const completedInstance: MissionInstance = {
      ...makeCompletedStub(def.id),
      objectives: def.objectives.map((o) => ({ ...o })),
    };
    state.missions.completed.push(completedInstance);

    // FlightState that would normally satisfy the objective.
    const fs = makeFlightState('already-done', { altitude: 500 });

    checkObjectiveCompletion(state, fs);

    // The completed mission's objective should remain untouched.
    expect(state.missions.completed[0].objectives![0].completed).toBe(false);
  });
});

// ===========================================================================
// New tests for iteration 6 features
// ===========================================================================

describe('Bonus objectives: mission completes with only required objectives', () => {
  it('mission-001 completes when required objectives are met, even if bonus objectives are not', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');

    // Complete required objectives (speed 150 + altitude 500) but not bonus.
    checkObjectiveCompletion(state, makeFlightState('mission-001', { velocity: 150, altitude: 500 }));
    const objs = state.missions.accepted[0].objectives!;
    expect(objs[0].completed).toBe(true); // speed
    expect(objs[1].completed).toBe(true); // altitude 500
    expect(objs[2].completed).toBe(false); // bonus altitude 1000
    expect(objs[3].completed).toBe(false); // bonus landing

    const result = completeMission(state, 'mission-001');
    expect(result.success).toBe(true);
    expect(result.reward).toBe(25_000); // base only
  });

  it('bonus objectives add their bonusReward to the total', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');

    // Complete required + 1km bonus.
    checkObjectiveCompletion(state, makeFlightState('mission-001', { velocity: 150, altitude: 1000 }));
    const objs = state.missions.accepted[0].objectives!;
    expect(objs[2].completed).toBe(true); // bonus 1km
    expect(objs[3].completed).toBe(false); // bonus landing — not triggered

    const result = completeMission(state, 'mission-001');
    expect(result.success).toBe(true);
    expect(result.reward).toBe(35_000); // 25k + 10k bonus
  });
});

describe('REACH_HORIZONTAL_SPEED objective type', () => {
  it('completes when horizontalVelocity meets threshold', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    completeMission(state, 'mission-001');
    acceptMission(state, 'mission-004');

    checkObjectiveCompletion(state, makeFlightState('mission-004', { horizontalVelocity: 300 }));
    const obj = state.missions.accepted[0].objectives![0];
    expect(obj.type).toBe(ObjectiveType.REACH_HORIZONTAL_SPEED);
    expect(obj.completed).toBe(true);
  });

  it('does not complete when horizontalVelocity is below threshold', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    completeMission(state, 'mission-001');
    acceptMission(state, 'mission-004');

    checkObjectiveCompletion(state, makeFlightState('mission-004', { horizontalVelocity: 299 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

describe('SAFE_LANDING with allowCrash', () => {
  it('completes on CRASH event when allowCrash is true and speed is below threshold', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    completeMission(state, 'mission-001');
    acceptMission(state, 'mission-004');

    const fs = makeFlightState('mission-004', {
      horizontalVelocity: 300,
      events: [{ type: 'CRASH', time: 10, speed: 25, description: 'Crashed' }],
    });
    checkObjectiveCompletion(state, fs);
    const landingObj = state.missions.accepted[0].objectives![1];
    expect(landingObj.completed).toBe(true);
  });

  it('does not complete on CRASH when speed exceeds threshold', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');
    completeMission(state, 'mission-001');
    acceptMission(state, 'mission-004');

    const fs = makeFlightState('mission-004', {
      events: [{ type: 'CRASH', time: 10, speed: 35, description: 'Crashed hard' }],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![1].completed).toBe(false);
  });

  it('SAFE_LANDING without allowCrash ignores CRASH events', () => {
    const state = freshState();
    initializeMissions(state);
    acceptMission(state, 'mission-001');

    // Mission-001 bonus landing has no allowCrash.
    const fs = makeFlightState('mission-001', {
      velocity: 150, altitude: 500,
      events: [{ type: 'CRASH', time: 10, speed: 5, description: 'Soft crash' }],
    });
    checkObjectiveCompletion(state, fs);
    const landingObj = state.missions.accepted[0].objectives![3]; // bonus safe landing
    expect(landingObj.completed).toBe(false);
  });
});

describe('Mission chain: dependency fixes', () => {
  it('mission-007 requires mission-006 (not mission-004)', () => {
    const state = freshState();
    // Complete missions 001, 004 — mission 007 should NOT be available.
    state.missions.completed = [
      makeCompletedStub('mission-001'),
      makeCompletedStub('mission-004'),
    ];
    const unlocked = getUnlockedMissions(state);
    const ids = unlocked.map((m) => m.id);
    expect(ids).not.toContain('mission-007');
    expect(ids).toContain('mission-006'); // 006 should be available
  });

  it('mission-007 unlocks after mission-006 is completed', () => {
    const state = freshState();
    state.missions.completed = [
      makeCompletedStub('mission-001'),
      makeCompletedStub('mission-004'),
      makeCompletedStub('mission-006'),
    ];
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).toContain('mission-007');
  });

  it('mission-018 requires mission-009 (not mission-004)', () => {
    const state = freshState();
    state.missions.completed = [
      makeCompletedStub('mission-001'),
      makeCompletedStub('mission-004'),
    ];
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).not.toContain('mission-018');
  });

  it('mission-018 unlocks after mission-009 is completed', () => {
    const state = freshState();
    state.missions.completed = [
      makeCompletedStub('mission-001'),
      makeCompletedStub('mission-004'),
      makeCompletedStub('mission-006'),
      makeCompletedStub('mission-007'),
      makeCompletedStub('mission-009'),
    ];
    const unlocked = getUnlockedMissions(state);
    expect(unlocked.map((m) => m.id)).toContain('mission-018');
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: acceptMission with awardsFacilityOnAccept
// ---------------------------------------------------------------------------

describe('acceptMission() — awardsFacilityOnAccept branch', () => {
  let state: GameState;
  let cleanup: (() => void) | null;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('awards the facility on acceptance when awardsFacilityOnAccept is set', () => {
    cleanup = withMissions(makeMissionDef({
      id: 'facility-accept-test',
      unlocksAfter: [],
      awardsFacilityOnAccept: 'crew-admin',
    }));
    initializeMissions(state);

    // Ensure the facility is not built yet.
    const hub = state.hubs[0];
    delete hub.facilities['crew-admin'];

    const result = acceptMission(state, 'facility-accept-test');
    expect(result.success).toBe(true);
    expect(result.awardedFacility).toBe('crew-admin');
    expect(hub.facilities['crew-admin']).toEqual({ built: true, tier: 1 });
  });

  it('does not award facility when awardsFacilityOnAccept is not set', () => {
    cleanup = withMissions(makeMissionDef({
      id: 'no-facility-test',
      unlocksAfter: [],
    }));
    initializeMissions(state);

    const result = acceptMission(state, 'no-facility-test');
    expect(result.success).toBe(true);
    expect(result.awardedFacility).toBeNull();
  });

  it('returns null awardedFacility when facility is already built', () => {
    cleanup = withMissions(makeMissionDef({
      id: 'dup-facility-test',
      unlocksAfter: [],
      awardsFacilityOnAccept: 'crew-admin',
    }));
    initializeMissions(state);

    // Pre-build the facility.
    const hub = state.hubs[0];
    hub.facilities['crew-admin'] = { built: true, tier: 1 };

    const result = acceptMission(state, 'dup-facility-test');
    expect(result.success).toBe(true);
    // awardFacility returns { success: false } when already built, so awardedFacility stays null.
    expect(result.awardedFacility).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: completeMission with unlocksFacility
// ---------------------------------------------------------------------------

describe('completeMission() — unlocksFacility branch', () => {
  let state: GameState;
  let cleanup: (() => void) | null;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('awards the facility on completion when unlocksFacility is set', () => {
    const def = makeMissionDef({
      id: 'facility-complete-test',
      unlocksFacility: 'rd-lab',
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    // Ensure the facility is not built yet.
    const hub = state.hubs[0];
    delete hub.facilities['rd-lab'];

    const result = completeMission(state, 'facility-complete-test');
    expect(result.success).toBe(true);
    expect(result.awardedFacility).toBe('rd-lab');
    expect(hub.facilities['rd-lab']).toEqual({ built: true, tier: 1 });
  });

  it('returns null awardedFacility when unlocksFacility is not set', () => {
    const def = makeMissionDef({ id: 'no-unlock-facility' });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const result = completeMission(state, 'no-unlock-facility');
    expect(result.success).toBe(true);
    expect(result.awardedFacility).toBeNull();
  });

  it('returns null awardedFacility when facility is already built on completion', () => {
    const def = makeMissionDef({
      id: 'already-built-facility',
      unlocksFacility: 'tracking-station',
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    // Pre-build the facility.
    const hub = state.hubs[0];
    hub.facilities['tracking-station'] = { built: true, tier: 1 };

    const result = completeMission(state, 'already-built-facility');
    expect(result.success).toBe(true);
    expect(result.awardedFacility).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: completeMission with bonus objective rewards
// ---------------------------------------------------------------------------

describe('completeMission() — bonus reward calculation', () => {
  let state: GameState;
  let cleanup: (() => void) | null;

  beforeEach(() => {
    state = freshState();
  });

  afterEach(() => {
    if (cleanup) { cleanup(); cleanup = null; }
  });

  it('adds bonusReward from completed optional objectives to total reward', () => {
    const def = makeMissionDef({
      id: 'bonus-test',
      reward: 10_000,
      objectives: [
        { id: 'req', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'required' },
        { id: 'bonus1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 500 }, completed: true, description: 'bonus 1', optional: true, bonusReward: 5_000 },
        { id: 'bonus2', type: ObjectiveType.REACH_SPEED, target: { speed: 200 }, completed: true, description: 'bonus 2', optional: true, bonusReward: 3_000 },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const moneyBefore = state.money;
    const result = completeMission(state, 'bonus-test');
    expect(result.success).toBe(true);
    expect(result.reward).toBe(10_000 + 5_000 + 3_000);
    expect(state.money).toBe(moneyBefore + 18_000);
  });

  it('does not add bonusReward from incomplete optional objectives', () => {
    const def = makeMissionDef({
      id: 'partial-bonus-test',
      reward: 10_000,
      objectives: [
        { id: 'req', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'required' },
        { id: 'bonus-done', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 500 }, completed: true, description: 'done bonus', optional: true, bonusReward: 5_000 },
        { id: 'bonus-missed', type: ObjectiveType.REACH_SPEED, target: { speed: 999 }, completed: false, description: 'missed bonus', optional: true, bonusReward: 7_000 },
      ],
    });
    cleanup = withMissions(def);
    seedAcceptedMission(state, def);

    const result = completeMission(state, 'partial-bonus-test');
    expect(result.reward).toBe(10_000 + 5_000); // only the completed bonus counted
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: checkObjectiveCompletion — MINIMUM_CREW
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — MINIMUM_CREW', () => {
  let state: GameState;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.MINIMUM_CREW, target: { minCrew: 2 }, completed: false, description: 'fly with 2+ crew' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when crewCount meets threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { crewCount: 2 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('marks completed when crewCount exceeds threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { crewCount: 3 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when crewCount is below threshold', () => {
    checkObjectiveCompletion(state, makeFlightState('m1', { crewCount: 1 }));
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Branch coverage: checkObjectiveCompletion — MULTI_SATELLITE
// ---------------------------------------------------------------------------

describe('checkObjectiveCompletion() — MULTI_SATELLITE', () => {
  let state: GameState;

  beforeEach(() => {
    state = freshState();
    const def = makeMissionDef({
      id: 'm1',
      objectives: [
        { id: 'o1', type: ObjectiveType.MULTI_SATELLITE, target: { count: 2, minAltitude: 80_000 }, completed: false, description: 'deploy 2 satellites above 80km' },
      ],
    });
    seedAcceptedMission(state, def);
  });

  it('marks completed when enough SATELLITE_RELEASED events above minAltitude', () => {
    const fs = makeFlightState('m1', {
      events: [
        { type: 'SATELLITE_RELEASED', time: 100, altitude: 85_000, description: 'sat 1' },
        { type: 'SATELLITE_RELEASED', time: 200, altitude: 90_000, description: 'sat 2' },
      ],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });

  it('does not complete when fewer valid releases than required count', () => {
    const fs = makeFlightState('m1', {
      events: [
        { type: 'SATELLITE_RELEASED', time: 100, altitude: 85_000, description: 'sat 1' },
      ],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('does not count releases below minAltitude', () => {
    const fs = makeFlightState('m1', {
      events: [
        { type: 'SATELLITE_RELEASED', time: 100, altitude: 85_000, description: 'high' },
        { type: 'SATELLITE_RELEASED', time: 200, altitude: 70_000, description: 'too low' },
      ],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(false);
  });

  it('completes when count is exactly met', () => {
    const fs = makeFlightState('m1', {
      events: [
        { type: 'SATELLITE_RELEASED', time: 100, altitude: 80_000, description: 'at boundary' },
        { type: 'SATELLITE_RELEASED', time: 200, altitude: 80_000, description: 'at boundary' },
      ],
    });
    checkObjectiveCompletion(state, fs);
    expect(state.missions.accepted[0].objectives![0].completed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// canTurnInMission() / getMissionsReadyToTurnIn()
// ---------------------------------------------------------------------------

describe('canTurnInMission()', () => {
  it('returns false when objectives is undefined @smoke', () => {
    const stub = makeCompletedStub('m-none');
    stub.objectives = undefined;
    expect(canTurnInMission(stub)).toBe(false);
  });

  it('returns false when objectives array is empty', () => {
    const stub = makeCompletedStub('m-empty');
    stub.objectives = [];
    expect(canTurnInMission(stub)).toBe(false);
  });

  it('returns false when a single required objective is incomplete', () => {
    const stub = makeCompletedStub('m-single-incomplete');
    stub.objectives = [
      { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: false, description: 'climb' },
    ];
    expect(canTurnInMission(stub)).toBe(false);
  });

  it('returns true when a single required objective is complete @smoke', () => {
    const stub = makeCompletedStub('m-single-complete');
    stub.objectives = [
      { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'climb' },
    ];
    expect(canTurnInMission(stub)).toBe(true);
  });

  it('returns true when required complete but an optional objective is incomplete', () => {
    const stub = makeCompletedStub('m-mixed');
    stub.objectives = [
      { id: 'r1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'climb' },
      { id: 'b1', type: ObjectiveType.REACH_SPEED, target: { speed: 500 }, completed: false, description: 'bonus', optional: true },
    ];
    expect(canTurnInMission(stub)).toBe(true);
  });

  it('returns false when any required objective is incomplete even if optional is complete', () => {
    const stub = makeCompletedStub('m-req-missing');
    stub.objectives = [
      { id: 'r1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: false, description: 'climb' },
      { id: 'b1', type: ObjectiveType.REACH_SPEED, target: { speed: 500 }, completed: true, description: 'bonus', optional: true },
    ];
    expect(canTurnInMission(stub)).toBe(false);
  });

  it('returns true when all objectives (required and optional) are complete', () => {
    const stub = makeCompletedStub('m-all');
    stub.objectives = [
      { id: 'r1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'climb' },
      { id: 'b1', type: ObjectiveType.REACH_SPEED, target: { speed: 500 }, completed: true, description: 'bonus', optional: true },
    ];
    expect(canTurnInMission(stub)).toBe(true);
  });
});

describe('getMissionsReadyToTurnIn()', () => {
  let state: GameState;

  beforeEach(() => {
    state = freshState();
  });

  it('returns empty when no missions are accepted', () => {
    expect(getMissionsReadyToTurnIn(state)).toEqual([]);
  });

  it('returns only missions whose required objectives are all complete @smoke', () => {
    const ready = makeCompletedStub('m-ready');
    ready.state = MissionState.ACCEPTED;
    ready.objectives = [
      { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: true, description: 'done' },
    ];

    const notReady = makeCompletedStub('m-not-ready');
    notReady.state = MissionState.ACCEPTED;
    notReady.objectives = [
      { id: 'o1', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 100 }, completed: false, description: 'pending' },
    ];

    state.missions.accepted = [notReady, ready];
    const result = getMissionsReadyToTurnIn(state);
    expect(result.map((m) => m.id)).toEqual(['m-ready']);
  });

  it('preserves accepted-array order when multiple are ready', () => {
    const a = makeCompletedStub('m-a');
    a.objectives = [{ id: 'o', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 1 }, completed: true, description: '' }];
    const b = makeCompletedStub('m-b');
    b.objectives = [{ id: 'o', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 1 }, completed: true, description: '' }];
    const c = makeCompletedStub('m-c');
    c.objectives = [{ id: 'o', type: ObjectiveType.REACH_ALTITUDE, target: { altitude: 1 }, completed: true, description: '' }];

    state.missions.accepted = [a, b, c];
    expect(getMissionsReadyToTurnIn(state).map((m) => m.id)).toEqual(['m-a', 'm-b', 'm-c']);
  });

  it('ignores missions without objectives', () => {
    const noObjectives = makeCompletedStub('m-no-objs');
    noObjectives.objectives = [];
    state.missions.accepted = [noObjectives];
    expect(getMissionsReadyToTurnIn(state)).toEqual([]);
  });
});

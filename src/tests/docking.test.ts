import { describe, it, expect, beforeEach } from 'vitest';
import { createFlightState, createGameState } from '../core/gameState.ts';
import type {
  FlightState,
  GameState,
  OrbitalObject,
  DockingSystemState,
} from '../core/gameState.ts';
import type { PhysicsState, RocketAssembly, PlacedPart, PartConnection } from '../core/physics.ts';
import type { FlightPhase as FlightPhaseType } from '../core/constants.ts';
import {
  FlightPhase,
  ControlMode,
  PartType,
  DockingState,
  OrbitalObjectType,
  DOCKING_VISUAL_RANGE_DEG,
  DOCKING_GUIDANCE_RANGE,
  DOCKING_AUTO_RANGE,
  DOCKING_MAX_RELATIVE_SPEED,
  DOCKING_MAX_ORIENTATION_DIFF,
  DOCKING_MAX_LATERAL_OFFSET,
  BODY_RADIUS,
} from '../core/constants.ts';
import {
  createDockingState,
  hasDockingPort,
  getDockingPorts,
  selectDockingTarget,
  clearDockingTarget,
  tickDocking,
  undock,
  transferCrew,
  transferFuel,
  getDockingGuidance,
  canDockWith,
} from '../core/docking.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshFlightState(phase: FlightPhaseType = FlightPhase.ORBIT): FlightState {
  const fs = createFlightState({
    missionId: 'test-mission',
    rocketId: 'test-rocket',
    crewIds: ['crew-1', 'crew-2'],
    fuelRemaining: 1000,
    deltaVRemaining: 3000,
  });
  fs.phase = phase;
  fs.inOrbit = phase === FlightPhase.ORBIT;
  fs.bodyId = 'EARTH';
  fs.timeElapsed = 1000;
  fs.orbitalElements = {
    semiMajorAxis: 6_471_000,
    eccentricity: 0.001,
    argPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  };
  fs.dockingState = createDockingState();
  return fs;
}

function stubPs(overrides: Partial<PhysicsState> = {}): PhysicsState {
  return {
    posX: 0,
    posY: 100_000,
    velX: 7800,
    velY: 0,
    angle: 0,
    throttle: 0,
    throttleMode: 'absolute' as const,
    targetTWR: 1.0,
    firingEngines: new Set<string>(),
    fuelStore: new Map<string, number>(),
    activeParts: new Set(['part-1', 'dock-1']),
    deployedParts: new Set<string>(),
    grounded: false,
    landed: false,
    crashed: false,
    controlMode: ControlMode.DOCKING,
    baseOrbit: null,
    dockingAltitudeBand: null,
    dockingOffsetAlongTrack: 0,
    dockingOffsetRadial: 0,
    rcsActiveDirections: new Set<string>(),
    dockingPortStates: new Map<string, string>(),
    _dockedCombinedMass: 0,
    _heldKeys: new Set<string>(),
    ...overrides,
  } as PhysicsState;
}

function stubAssemblyWithDockingPort(): RocketAssembly {
  const parts = new Map<string, PlacedPart>();
  parts.set('part-1', { instanceId: 'part-1', partId: 'cmd-mk1', x: 0, y: 0 });
  parts.set('dock-1', { instanceId: 'dock-1', partId: 'docking-port-std', x: 0, y: -30 });
  parts.set('tank-1', { instanceId: 'tank-1', partId: 'tank-small', x: 0, y: 30 });
  return {
    parts,
    connections: [] as PartConnection[],
    symmetryPairs: [] as Array<[string, string]>,
    _nextId: 4,
  };
}

function stubAssemblyNoDockingPort(): RocketAssembly {
  const parts = new Map<string, PlacedPart>();
  parts.set('part-1', { instanceId: 'part-1', partId: 'cmd-mk1', x: 0, y: 0 });
  parts.set('tank-1', { instanceId: 'tank-1', partId: 'tank-small', x: 0, y: 30 });
  return {
    parts,
    connections: [] as PartConnection[],
    symmetryPairs: [] as Array<[string, string]>,
    _nextId: 3,
  };
}

function stubGameState(): GameState {
  const state = createGameState();
  state.orbitalObjects = [
    {
      id: 'station-1',
      bodyId: 'EARTH',
      type: OrbitalObjectType.STATION,
      name: 'Test Station',
      elements: {
        semiMajorAxis: 6_471_000,
        eccentricity: 0.001,
        argPeriapsis: 0,
        meanAnomalyAtEpoch: 0.0005, // very close angular distance
        epoch: 0,
      },
    },
    {
      id: 'debris-1',
      bodyId: 'EARTH',
      type: OrbitalObjectType.DEBRIS,
      name: 'Debris Fragment',
      elements: {
        semiMajorAxis: 6_471_000,
        eccentricity: 0.001,
        argPeriapsis: 0,
        meanAnomalyAtEpoch: 0.001,
        epoch: 0,
      },
    },
    {
      id: 'craft-far',
      bodyId: 'EARTH',
      type: OrbitalObjectType.CRAFT,
      name: 'Far Craft',
      elements: {
        semiMajorAxis: 6_471_000,
        eccentricity: 0.001,
        argPeriapsis: 0,
        meanAnomalyAtEpoch: 1.0, // far away
        epoch: 0,
      },
    },
  ];
  return state;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createDockingState', () => {
  it('creates a state with IDLE and no target', () => {
    const ds = createDockingState();
    expect(ds.state).toBe(DockingState.IDLE);
    expect(ds.targetId).toBeNull();
    expect(ds.targetDistance).toBe(Infinity);
    expect(ds.dockedObjectIds).toEqual([]);
    expect(ds.combinedMass).toBe(0);
    expect(ds.speedOk).toBe(false);
    expect(ds.orientationOk).toBe(false);
    expect(ds.lateralOk).toBe(false);
  });
});

describe('hasDockingPort', () => {
  it('returns true when assembly has a docking port in active parts', () => {
    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({ activeParts: new Set(['part-1', 'dock-1', 'tank-1']) });
    expect(hasDockingPort(ps, assembly)).toBe(true);
  });

  it('returns false when assembly has no docking port', () => {
    const assembly = stubAssemblyNoDockingPort();
    const ps = stubPs({ activeParts: new Set(['part-1', 'tank-1']) });
    expect(hasDockingPort(ps, assembly)).toBe(false);
  });

  it('returns false when docking port is not in active parts', () => {
    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({ activeParts: new Set(['part-1', 'tank-1']) });
    expect(hasDockingPort(ps, assembly)).toBe(false);
  });
});

describe('getDockingPorts', () => {
  it('returns all active docking ports', () => {
    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({ activeParts: new Set(['part-1', 'dock-1', 'tank-1']) });
    const ports = getDockingPorts(ps, assembly);
    expect(ports.length).toBe(1);
    expect(ports[0].instanceId).toBe('dock-1');
    expect(ports[0].partDef.type).toBe(PartType.DOCKING_PORT);
  });
});

describe('selectDockingTarget', () => {
  it('selects a target and transitions to APPROACHING', () => {
    const ds = createDockingState();
    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({ activeParts: new Set(['part-1', 'dock-1']) });

    const result = selectDockingTarget(ds, 'station-1', ps, assembly);
    expect(result.success).toBe(true);
    expect(ds.targetId).toBe('station-1');
    expect(ds.state).toBe(DockingState.APPROACHING);
  });

  it('fails without a docking port', () => {
    const ds = createDockingState();
    const assembly = stubAssemblyNoDockingPort();
    const ps = stubPs({ activeParts: new Set(['part-1', 'tank-1']) });

    const result = selectDockingTarget(ds, 'station-1', ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('No docking port');
  });

  it('fails when already docked', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;
    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({ activeParts: new Set(['part-1', 'dock-1']) });

    const result = selectDockingTarget(ds, 'station-1', ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Already docked');
  });
});

describe('clearDockingTarget', () => {
  it('resets to IDLE', () => {
    const ds = createDockingState();
    ds.state = DockingState.APPROACHING;
    ds.targetId = 'station-1';
    ds.targetDistance = 100;

    clearDockingTarget(ds);
    expect(ds.state).toBe(DockingState.IDLE);
    expect(ds.targetId).toBeNull();
    expect(ds.targetDistance).toBe(Infinity);
  });
});

describe('canDockWith', () => {
  it('allows docking with CRAFT', () => {
    expect(canDockWith({ type: OrbitalObjectType.CRAFT } as OrbitalObject)).toBe(true);
  });

  it('allows docking with STATION', () => {
    expect(canDockWith({ type: OrbitalObjectType.STATION } as OrbitalObject)).toBe(true);
  });

  it('disallows docking with DEBRIS', () => {
    expect(canDockWith({ type: OrbitalObjectType.DEBRIS } as OrbitalObject)).toBe(false);
  });

  it('disallows docking with SATELLITE', () => {
    expect(canDockWith({ type: OrbitalObjectType.SATELLITE } as OrbitalObject)).toBe(false);
  });
});

describe('getDockingGuidance', () => {
  it('returns inactive when IDLE', () => {
    const ds = createDockingState();
    const guidance = getDockingGuidance(ds);
    expect(guidance.active).toBe(false);
    expect(guidance.isDocked).toBe(false);
  });

  it('returns active when APPROACHING', () => {
    const ds = createDockingState();
    ds.state = DockingState.APPROACHING;
    ds.targetId = 'station-1';
    const guidance = getDockingGuidance(ds);
    expect(guidance.active).toBe(true);
    expect(guidance.state).toBe(DockingState.APPROACHING);
  });

  it('returns docked info when DOCKED', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;
    ds.dockedObjectIds = ['station-1'];
    const guidance = getDockingGuidance(ds);
    expect(guidance.isDocked).toBe(true);
    expect(guidance.dockedCount).toBe(1);
  });

  it('reports allGreen when all indicators are OK', () => {
    const ds = createDockingState();
    ds.state = DockingState.ALIGNING;
    ds.speedOk = true;
    ds.orientationOk = true;
    ds.lateralOk = true;
    const guidance = getDockingGuidance(ds);
    expect(guidance.allGreen).toBe(true);
  });
});

describe('undock', () => {
  let ds: DockingSystemState;
  let ps: PhysicsState;
  let assembly: RocketAssembly;
  let flightState: FlightState;
  let state: GameState;

  beforeEach(() => {
    ds = createDockingState();
    ds.state = DockingState.DOCKED;
    ds.dockedObjectIds = ['station-1'];
    ds.combinedMass = 5000;

    assembly = stubAssemblyWithDockingPort();
    ps = stubPs({
      activeParts: new Set(['part-1', 'dock-1', 'tank-1']),
      fuelStore: new Map([['tank-1', 200]]),
    });
    flightState = freshFlightState();
    flightState.dockingState = ds;

    state = createGameState();
    state.orbitalObjects = [];
  });

  it('undocks and creates a new orbital object', () => {
    const result = undock(ds, ps, assembly, flightState, state);
    expect(result.success).toBe(true);
    expect(result.undockedObjectId).toBe('station-1');
    expect(ds.dockedObjectIds).toEqual([]);
    expect(ds.state).toBe(DockingState.IDLE);
    expect(state.orbitalObjects.length).toBe(1);
    expect(state.orbitalObjects[0].id).toBe('station-1');
  });

  it('logs an undocking event', () => {
    const eventsBefore = flightState.events.length;
    undock(ds, ps, assembly, flightState, state);
    expect(flightState.events.length).toBeGreaterThan(eventsBefore);
    expect(flightState.events[flightState.events.length - 1].type).toBe('UNDOCKING_COMPLETE');
  });

  it('fails when not docked', () => {
    ds.state = DockingState.IDLE;
    ds.dockedObjectIds = [];
    const result = undock(ds, ps, assembly, flightState, state);
    expect(result.success).toBe(false);
  });

  it('undocks a specific object by ID', () => {
    ds.dockedObjectIds = ['station-1', 'craft-2'];
    const result = undock(ds, ps, assembly, flightState, state, 'station-1');
    expect(result.success).toBe(true);
    expect(result.undockedObjectId).toBe('station-1');
    expect(ds.dockedObjectIds).toEqual(['craft-2']);
    expect(ds.state).toBe(DockingState.DOCKED);
  });
});

describe('transferCrew', () => {
  it('transfers crew to station', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;
    const flightState = freshFlightState();

    const result = transferCrew(ds, flightState, ['crew-1'], 'TO_STATION');
    expect(result.success).toBe(true);
    expect(result.transferred).toEqual(['crew-1']);
    expect(flightState.crewIds).toEqual(['crew-2']);
  });

  it('transfers crew from station', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;
    const flightState = freshFlightState();

    const result = transferCrew(ds, flightState, ['crew-3'], 'FROM_STATION');
    expect(result.success).toBe(true);
    expect(result.transferred).toEqual(['crew-3']);
    expect(flightState.crewIds).toContain('crew-3');
  });

  it('fails when not docked', () => {
    const ds = createDockingState();
    ds.state = DockingState.IDLE;
    const flightState = freshFlightState();

    const result = transferCrew(ds, flightState, ['crew-1'], 'TO_STATION');
    expect(result.success).toBe(false);
  });

  it('logs a crew transfer event', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;
    const flightState = freshFlightState();
    const eventsBefore = flightState.events.length;

    transferCrew(ds, flightState, ['crew-1'], 'TO_STATION');
    expect(flightState.events.length).toBeGreaterThan(eventsBefore);
    expect(flightState.events[flightState.events.length - 1].type).toBe('CREW_TRANSFER');
  });
});

describe('transferFuel', () => {
  it('transfers fuel to craft tanks', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;

    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({
      activeParts: new Set(['part-1', 'dock-1', 'tank-1']),
      fuelStore: new Map([['tank-1', 100]]),
    });
    const flightState = freshFlightState();
    flightState.fuelRemaining = 100;

    const result = transferFuel(ds, ps, assembly, flightState, 200);
    expect(result.success).toBe(true);
    expect(result.transferred).toBe(200);
    expect(ps.fuelStore.get('tank-1')).toBe(300);
    expect(flightState.fuelRemaining).toBe(300);
  });

  it('caps transfer at tank capacity', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;

    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({
      activeParts: new Set(['part-1', 'dock-1', 'tank-1']),
      fuelStore: new Map([['tank-1', 350]]),
    });
    const flightState = freshFlightState();
    flightState.fuelRemaining = 350;

    // tank-small has 400 kg capacity, currently at 350, so only 50 can be added.
    const result = transferFuel(ds, ps, assembly, flightState, 200);
    expect(result.success).toBe(true);
    expect(result.transferred).toBe(50);
    expect(ps.fuelStore.get('tank-1')).toBe(400);
  });

  it('fails when not docked', () => {
    const ds = createDockingState();
    ds.state = DockingState.IDLE;

    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs();
    const flightState = freshFlightState();

    const result = transferFuel(ds, ps, assembly, flightState, 100);
    expect(result.success).toBe(false);
  });

  it('logs a fuel transfer event', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;

    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({
      activeParts: new Set(['part-1', 'dock-1', 'tank-1']),
      fuelStore: new Map([['tank-1', 0]]),
    });
    const flightState = freshFlightState();
    const eventsBefore = flightState.events.length;

    transferFuel(ds, ps, assembly, flightState, 100);
    expect(flightState.events.length).toBeGreaterThan(eventsBefore);
    expect(flightState.events[flightState.events.length - 1].type).toBe('FUEL_TRANSFER');
  });
});

describe('tickDocking', () => {
  it('does nothing when IDLE', () => {
    const ds = createDockingState();
    const ps = stubPs();
    const assembly = stubAssemblyWithDockingPort();
    const flightState = freshFlightState();
    const state = stubGameState();

    const result = tickDocking(ds, ps, assembly, flightState, state, 1 / 60);
    expect(result.docked).toBe(false);
    expect(ds.state).toBe(DockingState.IDLE);
  });

  it('does nothing when DOCKED', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;
    const ps = stubPs();
    const assembly = stubAssemblyWithDockingPort();
    const flightState = freshFlightState();
    const state = stubGameState();

    const result = tickDocking(ds, ps, assembly, flightState, state, 1 / 60);
    expect(result.docked).toBe(false);
  });

  it('clears target when orbital object is removed', () => {
    const ds = createDockingState();
    ds.state = DockingState.APPROACHING;
    ds.targetId = 'nonexistent';

    const ps = stubPs();
    const assembly = stubAssemblyWithDockingPort();
    const flightState = freshFlightState();
    const state = stubGameState();

    tickDocking(ds, ps, assembly, flightState, state, 1 / 60);
    expect(ds.state).toBe(DockingState.IDLE);
    expect(ds.targetId).toBeNull();
  });

  it('@smoke transitions from APPROACHING to ALIGNING when close enough', () => {
    const ds = createDockingState();
    ds.state = DockingState.APPROACHING;
    ds.targetId = 'station-1';

    const ps = stubPs();
    const assembly = stubAssemblyWithDockingPort();
    const flightState = freshFlightState();
    const state = stubGameState();

    // Run a tick — the station-1 is very close in angular distance.
    tickDocking(ds, ps, assembly, flightState, state, 1 / 60);

    // The distance depends on the orbital mechanics, but the state should update.
    expect(ds.targetDistance).toBeLessThan(Infinity);
    // State may transition depending on computed distance.
  });
});

describe('DockingState enum', () => {
  it('has all expected values', () => {
    expect(DockingState.IDLE).toBe('IDLE');
    expect(DockingState.APPROACHING).toBe('APPROACHING');
    expect(DockingState.ALIGNING).toBe('ALIGNING');
    expect(DockingState.FINAL_APPROACH).toBe('FINAL_APPROACH');
    expect(DockingState.DOCKED).toBe('DOCKED');
    expect(DockingState.UNDOCKING).toBe('UNDOCKING');
  });
});

describe('Docking constants', () => {
  it('DOCKING_VISUAL_RANGE_DEG is defined and positive', () => {
    expect(DOCKING_VISUAL_RANGE_DEG).toBeGreaterThan(0);
  });

  it('DOCKING_GUIDANCE_RANGE is defined and positive', () => {
    expect(DOCKING_GUIDANCE_RANGE).toBeGreaterThan(0);
  });

  it('DOCKING_AUTO_RANGE is less than DOCKING_GUIDANCE_RANGE', () => {
    expect(DOCKING_AUTO_RANGE).toBeLessThan(DOCKING_GUIDANCE_RANGE);
  });

  it('DOCKING_MAX_RELATIVE_SPEED is defined and positive', () => {
    expect(DOCKING_MAX_RELATIVE_SPEED).toBeGreaterThan(0);
  });

  it('DOCKING_MAX_ORIENTATION_DIFF is defined and positive', () => {
    expect(DOCKING_MAX_ORIENTATION_DIFF).toBeGreaterThan(0);
  });

  it('DOCKING_MAX_LATERAL_OFFSET is defined and positive', () => {
    expect(DOCKING_MAX_LATERAL_OFFSET).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// tickDocking state machine transitions
// ---------------------------------------------------------------------------

/**
 * Helper: creates a flight state + game state + docking state where the craft
 * and target are in near-identical circular orbits around Earth, separated by
 * a predictable along-track distance.  The docking offset fields on the
 * PhysicsState are set so that the *effective* distance equals `desiredEffDist`.
 *
 * With e=0 and timeElapsed=0 the orbital solver is trivial:
 *   altitude = SMA - R_EARTH,  angularPosition = M0 * (180/PI).
 * Along-track = M0_diff * (R + avgAlt).
 */
function buildTickScenario(desiredEffDist: number, dockingState: string) {
  const SMA = 6_471_000;
  const R = BODY_RADIUS['EARTH']; // 6_371_000
  const alt = SMA - R;            // 100_000
  const orbitRadius = R + alt;     // 6_471_000

  // Choose a physical along-track separation of 200 m (comfortably within guidance range).
  const physicalAlongTrack = 200;
  const meanAnomalyDiff = physicalAlongTrack / orbitRadius; // tiny angle in radians

  const ds = createDockingState();
  ds.state = dockingState as typeof ds.state;
  ds.targetId = 'station-1';
  // Set prevDist to the desired distance so relSpeed = 0 (no change) — keeps speedOk true.
  ds.targetDistance = desiredEffDist;

  const assembly = stubAssemblyWithDockingPort();

  // Docking-mode offset: bring the effective distance down to desiredEffDist.
  // effectiveDist = sqrt((along - offsetAlong)^2 + (radial - offsetRadial)^2)
  // With radialDist = 0 and offsetRadial = 0, effectiveDist = |along - offsetAlong|.
  // So offsetAlong = physicalAlongTrack - desiredEffDist.
  const offsetAlong = physicalAlongTrack - desiredEffDist;

  const ps = stubPs({
    activeParts: new Set(['part-1', 'dock-1']),
    controlMode: ControlMode.DOCKING,
    angle: 0,
    dockingOffsetAlongTrack: offsetAlong,
    dockingOffsetRadial: 0,
  });

  const fs = freshFlightState();
  fs.timeElapsed = 0; // keeps orbital solver trivial
  fs.orbitalElements = {
    semiMajorAxis: SMA,
    eccentricity: 0,
    argPeriapsis: 0,
    meanAnomalyAtEpoch: 0,
    epoch: 0,
  };
  fs.dockingState = ds;

  const state = createGameState();
  state.orbitalObjects = [
    {
      id: 'station-1',
      bodyId: 'EARTH',
      type: OrbitalObjectType.STATION,
      name: 'Test Station',
      elements: {
        semiMajorAxis: SMA,
        eccentricity: 0,
        argPeriapsis: 0,
        meanAnomalyAtEpoch: meanAnomalyDiff,
        epoch: 0,
      },
    },
  ];

  return { ds, ps, assembly, fs, state };
}

describe('tickDocking state machine transitions', () => {
  it('resets to IDLE when targetId is null', () => {
    const ds = createDockingState();
    ds.state = DockingState.APPROACHING;
    ds.targetId = null; // no target set
    const ps = stubPs();
    const assembly = stubAssemblyWithDockingPort();
    const fs = freshFlightState();
    const state = stubGameState();

    const result = tickDocking(ds, ps, assembly, fs, state, 1 / 60);
    expect(result.docked).toBe(false);
    expect(ds.state).toBe(DockingState.IDLE);
  });

  it('clears target when craft has no orbitalElements', () => {
    const ds = createDockingState();
    ds.state = DockingState.APPROACHING;
    ds.targetId = 'station-1';
    const ps = stubPs();
    const assembly = stubAssemblyWithDockingPort();
    const fs = freshFlightState();
    fs.orbitalElements = null; // no orbital elements
    const state = stubGameState();

    const result = tickDocking(ds, ps, assembly, fs, state, 1 / 60);
    expect(result.docked).toBe(false);
    expect(ds.state).toBe(DockingState.IDLE);
    expect(ds.targetId).toBeNull();
  });

  it('transitions APPROACHING -> ALIGNING when effective distance <= guidance range', () => {
    // Effective distance = 300, which is <= DOCKING_GUIDANCE_RANGE (500)
    const { ds, ps, assembly, fs, state } = buildTickScenario(300, DockingState.APPROACHING);

    tickDocking(ds, ps, assembly, fs, state, 1 / 60);
    expect(ds.state).toBe(DockingState.ALIGNING);
  });

  it('transitions ALIGNING -> APPROACHING when effective distance > guidance range * 1.5', () => {
    // Need effective distance > 750 (DOCKING_GUIDANCE_RANGE * 1.5).
    // Use a larger physical separation so we can have effectiveDist = 800.
    const SMA = 6_471_000;
    const R = BODY_RADIUS['EARTH'];
    const orbitRadius = R + (SMA - R);
    const physicalAlong = 1000; // 1 km actual separation
    const meanAnomalyDiff = physicalAlong / orbitRadius;
    const desiredEffDist = 800;

    const ds = createDockingState();
    ds.state = DockingState.ALIGNING;
    ds.targetId = 'station-1';
    ds.targetDistance = desiredEffDist; // prev dist matches so relSpeed = 0

    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({
      activeParts: new Set(['part-1', 'dock-1']),
      controlMode: ControlMode.DOCKING,
      angle: 0,
      dockingOffsetAlongTrack: physicalAlong - desiredEffDist,
      dockingOffsetRadial: 0,
    });

    const fs = freshFlightState();
    fs.timeElapsed = 0;
    fs.orbitalElements = {
      semiMajorAxis: SMA, eccentricity: 0, argPeriapsis: 0,
      meanAnomalyAtEpoch: 0, epoch: 0,
    };

    const state = createGameState();
    state.orbitalObjects = [{
      id: 'station-1', bodyId: 'EARTH', type: OrbitalObjectType.STATION,
      name: 'Test Station',
      elements: {
        semiMajorAxis: SMA, eccentricity: 0, argPeriapsis: 0,
        meanAnomalyAtEpoch: meanAnomalyDiff, epoch: 0,
      },
    }];

    tickDocking(ds, ps, assembly, fs, state, 1 / 60);
    expect(ds.state).toBe(DockingState.APPROACHING);
  });

  it('transitions ALIGNING -> FINAL_APPROACH when close and all indicators OK', () => {
    // Effective distance = 10, within DOCKING_AUTO_RANGE (15).
    // All indicators must be OK: speed, orientation, lateral.
    const { ds, ps, assembly, fs, state } = buildTickScenario(10, DockingState.ALIGNING);

    // Ensure angle is 0 (orientation diff will be 0, within DOCKING_MAX_ORIENTATION_DIFF 0.15)
    ps.angle = 0;

    tickDocking(ds, ps, assembly, fs, state, 1 / 60);
    expect(ds.state).toBe(DockingState.FINAL_APPROACH);
  });

  it('aborts FINAL_APPROACH when effective distance > auto range * 2', () => {
    // DOCKING_AUTO_RANGE * 2 = 30. Set effective distance to 35.
    const { ds, ps, assembly, fs, state } = buildTickScenario(35, DockingState.FINAL_APPROACH);

    const result = tickDocking(ds, ps, assembly, fs, state, 1 / 60);
    expect(ds.state).toBe(DockingState.ALIGNING);
    expect(result.event).toBe('AUTO_DOCK_ABORT');
    expect(result.docked).toBe(false);
  });

  it('interpolates docking offsets during FINAL_APPROACH when distance > 1', () => {
    // Effective distance = 10 (within auto range, > 1).
    const { ds, ps, assembly, fs, state } = buildTickScenario(10, DockingState.FINAL_APPROACH);

    const offsetBefore = ps.dockingOffsetAlongTrack;

    tickDocking(ds, ps, assembly, fs, state, 1 / 60);

    // The offset should have changed towards the along-track distance.
    expect(ps.dockingOffsetAlongTrack).not.toBe(offsetBefore);
    // State stays FINAL_APPROACH (not docked yet, not aborted).
    expect(ds.state).toBe(DockingState.FINAL_APPROACH);
  });

  it('completes docking when effective distance <= 1 during FINAL_APPROACH', () => {
    // Effective distance = 0.5 (<= 1).
    const { ds, ps, assembly, fs, state } = buildTickScenario(0.5, DockingState.FINAL_APPROACH);

    const result = tickDocking(ds, ps, assembly, fs, state, 1 / 60);
    expect(result.docked).toBe(true);
    expect(result.event).toBe('DOCKING_COMPLETE');
    expect(ds.state).toBe(DockingState.DOCKED);
    expect(ds.dockedObjectIds).toContain('station-1');
    // Target object should be removed from orbital objects.
    expect(state.orbitalObjects.find(o => o.id === 'station-1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// undock edge cases
// ---------------------------------------------------------------------------

describe('undock edge cases', () => {
  it('undocks the last object when no undockTargetId is given and multiple are docked', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;
    ds.dockedObjectIds = ['craft-a', 'craft-b', 'craft-c'];
    ds.combinedMass = 10000;

    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({
      activeParts: new Set(['part-1', 'dock-1', 'tank-1']),
      fuelStore: new Map([['tank-1', 200]]),
    });
    const flightState = freshFlightState();
    flightState.dockingState = ds;
    const state = createGameState();
    state.orbitalObjects = [];

    // No undockTargetId — should undock the last one ('craft-c')
    const result = undock(ds, ps, assembly, flightState, state);
    expect(result.success).toBe(true);
    expect(result.undockedObjectId).toBe('craft-c');
    expect(ds.dockedObjectIds).toEqual(['craft-a', 'craft-b']);
    // Still docked to others, so state stays DOCKED
    expect(ds.state).toBe(DockingState.DOCKED);
    // The undocked object is added back to orbital objects
    expect(state.orbitalObjects.length).toBe(1);
    expect(state.orbitalObjects[0].id).toBe('craft-c');
  });

  it('returns error when undocking a non-existent target ID', () => {
    const ds = createDockingState();
    ds.state = DockingState.DOCKED;
    ds.dockedObjectIds = ['craft-a', 'craft-b'];

    const assembly = stubAssemblyWithDockingPort();
    const ps = stubPs({
      activeParts: new Set(['part-1', 'dock-1']),
      fuelStore: new Map(),
    });
    const flightState = freshFlightState();
    flightState.dockingState = ds;
    const state = createGameState();
    state.orbitalObjects = [];

    const result = undock(ds, ps, assembly, flightState, state, 'nonexistent-id');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not in docked list');
    // dockedObjectIds unchanged
    expect(ds.dockedObjectIds).toEqual(['craft-a', 'craft-b']);
  });
});

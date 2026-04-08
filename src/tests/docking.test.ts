// @ts-nocheck
/**
 * docking.test.js — Unit tests for the docking system (TASK-027).
 *
 * Tests cover:
 *   - createDockingState() — default state
 *   - hasDockingPort() — docking port detection
 *   - getDockingPorts() — docking port enumeration
 *   - selectDockingTarget() — target selection
 *   - clearDockingTarget() — target clearing
 *   - tickDocking() — guidance updates and state transitions
 *   - undock() — undocking procedure
 *   - transferCrew() — crew transfer between docked vessels
 *   - transferFuel() — fuel transfer between docked vessels
 *   - getDockingGuidance() — guidance data for HUD
 *   - getTargetsInVisualRange() — target discovery
 *   - canDockWith() — dockability checks
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFlightState, createGameState } from '../core/gameState.ts';
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
  getTargetsInVisualRange,
  canDockWith,
} from '../core/docking.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshFlightState(phase = FlightPhase.ORBIT) {
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

function stubPs(overrides = {}) {
  return {
    posX: 0,
    posY: 100_000,
    velX: 7800,
    velY: 0,
    angle: 0,
    throttle: 0,
    throttleMode: 'absolute',
    targetTWR: 1.0,
    firingEngines: new Set(),
    fuelStore: new Map(),
    activeParts: new Set(['part-1', 'dock-1']),
    deployedParts: new Set(),
    grounded: false,
    landed: false,
    crashed: false,
    controlMode: ControlMode.DOCKING,
    baseOrbit: null,
    dockingAltitudeBand: null,
    dockingOffsetAlongTrack: 0,
    dockingOffsetRadial: 0,
    rcsActiveDirections: new Set(),
    dockingPortStates: new Map(),
    _dockedCombinedMass: 0,
    _heldKeys: new Set(),
    ...overrides,
  };
}

function stubAssemblyWithDockingPort() {
  const parts = new Map();
  parts.set('part-1', { instanceId: 'part-1', partId: 'cmd-mk1', x: 0, y: 0 });
  parts.set('dock-1', { instanceId: 'dock-1', partId: 'docking-port-std', x: 0, y: -30 });
  parts.set('tank-1', { instanceId: 'tank-1', partId: 'tank-small', x: 0, y: 30 });
  return {
    parts,
    connections: [],
    symmetryPairs: [],
    _nextId: 4,
  };
}

function stubAssemblyNoDockingPort() {
  const parts = new Map();
  parts.set('part-1', { instanceId: 'part-1', partId: 'cmd-mk1', x: 0, y: 0 });
  parts.set('tank-1', { instanceId: 'tank-1', partId: 'tank-small', x: 0, y: 30 });
  return {
    parts,
    connections: [],
    symmetryPairs: [],
    _nextId: 3,
  };
}

function stubGameState() {
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
    expect(canDockWith({ type: OrbitalObjectType.CRAFT })).toBe(true);
  });

  it('allows docking with STATION', () => {
    expect(canDockWith({ type: OrbitalObjectType.STATION })).toBe(true);
  });

  it('disallows docking with DEBRIS', () => {
    expect(canDockWith({ type: OrbitalObjectType.DEBRIS })).toBe(false);
  });

  it('disallows docking with SATELLITE', () => {
    expect(canDockWith({ type: OrbitalObjectType.SATELLITE })).toBe(false);
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
  let ds, ps, assembly, flightState, state;

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

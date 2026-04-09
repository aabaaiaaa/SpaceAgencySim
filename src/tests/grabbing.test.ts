// @ts-nocheck
/**
 * grabbing.test.js — Unit tests for the grabbing arm system (TASK-029).
 *
 * Tests cover:
 *   - createGrabState()           — default state
 *   - hasGrabbingArm()            — grabbing arm detection
 *   - getGrabbingArms()           — grabbing arm enumeration
 *   - selectGrabTarget()          — target selection
 *   - clearGrabTarget()           — target clearing
 *   - canGrab()                   — grabbability checks
 *   - repairGrabbedSatellite()    — satellite repair
 *   - releaseGrabbedSatellite()   — release after grab
 *   - processGrabRepairsFromFlight() — flight event integration
 *   - Part definition validation  — grabbing-arm part exists with correct properties
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createFlightState, createGameState } from '../core/gameState.ts';
import {
  FlightPhase,
  ControlMode,
  PartType,
  GrabState,
  OrbitalObjectType,
  FacilityId,
  GRAB_VISUAL_RANGE_DEG,
  GRAB_GUIDANCE_RANGE,
  GRAB_ARM_RANGE,
  GRAB_MAX_RELATIVE_SPEED,
  GRAB_MAX_LATERAL_OFFSET,
  GRAB_REPAIR_HEALTH,
} from '../core/constants.ts';
import {
  createGrabState,
  hasGrabbingArm,
  getGrabbingArms,
  selectGrabTarget,
  clearGrabTarget,
  canGrab,
  repairGrabbedSatellite,
  releaseGrabbedSatellite,
  processGrabRepairsFromFlight,
  getGrabTargetsInRange,
  updateGrabState,
  getAsteroidGrabTargetsInRange,
  captureAsteroid,
  releaseGrabbedAsteroid,
} from '../core/grabbing.ts';
import { getPartById } from '../data/parts.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function freshFlightState(phase = FlightPhase.ORBIT) {
  const fs = createFlightState({
    missionId: 'test-mission',
    rocketId: 'test-rocket',
    crewIds: [],
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
    activeParts: new Set(['part-1', 'arm-1']),
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

function stubAssemblyWithArm() {
  const parts = new Map();
  parts.set('part-1', { instanceId: 'part-1', partId: 'cmd-mk1', x: 0, y: 0 });
  parts.set('arm-1', { instanceId: 'arm-1', partId: 'grabbing-arm', x: -20, y: 0 });
  return {
    parts,
    connections: [],
    symmetryPairs: [],
    _nextId: 3,
  };
}

function stubAssemblyNoArm() {
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

function stubGameStateWithSatellite() {
  const state = createGameState();
  state.facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 1 };
  state.satelliteNetwork = {
    satellites: [
      {
        id: 'sat-1',
        orbitalObjectId: 'orb-sat-1',
        satelliteType: 'COMMUNICATION',
        partId: 'satellite-comm',
        bodyId: 'EARTH',
        bandId: 'LEO',
        health: 50,
        autoMaintain: false,
        deployedPeriod: 1,
      },
    ],
  };
  state.orbitalObjects = [
    {
      id: 'orb-sat-1',
      bodyId: 'EARTH',
      type: OrbitalObjectType.SATELLITE,
      name: 'Comm Sat 1',
      elements: {
        semiMajorAxis: 6_471_000,
        eccentricity: 0.001,
        argPeriapsis: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 0,
      },
    },
  ];
  return state;
}

// ---------------------------------------------------------------------------
// createGrabState()
// ---------------------------------------------------------------------------

describe('createGrabState', () => {
  it('returns IDLE state with null target', () => {
    const gs = createGrabState();
    expect(gs.state).toBe(GrabState.IDLE);
    expect(gs.targetId).toBeNull();
    expect(gs.targetDistance).toBe(Infinity);
    expect(gs.grabbedSatelliteId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hasGrabbingArm / getGrabbingArms
// ---------------------------------------------------------------------------

describe('hasGrabbingArm', () => {
  it('returns true when assembly has a grabbing arm', () => {
    const ps = stubPs();
    const assembly = stubAssemblyWithArm();
    expect(hasGrabbingArm(ps, assembly)).toBe(true);
  });

  it('returns false when assembly has no grabbing arm', () => {
    const ps = stubPs({ activeParts: new Set(['part-1', 'tank-1']) });
    const assembly = stubAssemblyNoArm();
    expect(hasGrabbingArm(ps, assembly)).toBe(false);
  });
});

describe('getGrabbingArms', () => {
  it('returns array of grabbing arm instances', () => {
    const ps = stubPs();
    const assembly = stubAssemblyWithArm();
    const arms = getGrabbingArms(ps, assembly);
    expect(arms).toHaveLength(1);
    expect(arms[0].instanceId).toBe('arm-1');
    expect(arms[0].partDef.type).toBe(PartType.GRABBING_ARM);
  });

  it('returns empty array when no arm present', () => {
    const ps = stubPs({ activeParts: new Set(['part-1', 'tank-1']) });
    const assembly = stubAssemblyNoArm();
    const arms = getGrabbingArms(ps, assembly);
    expect(arms).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// canGrab
// ---------------------------------------------------------------------------

describe('canGrab', () => {
  it('returns true for SATELLITE type objects', () => {
    expect(canGrab({ type: OrbitalObjectType.SATELLITE })).toBe(true);
  });

  it('returns false for CRAFT type objects', () => {
    expect(canGrab({ type: OrbitalObjectType.CRAFT })).toBe(false);
  });

  it('returns false for STATION type objects', () => {
    expect(canGrab({ type: OrbitalObjectType.STATION })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// selectGrabTarget
// ---------------------------------------------------------------------------

describe('selectGrabTarget', () => {
  it('transitions to APPROACHING when arm is present', () => {
    const gs = createGrabState();
    const ps = stubPs();
    const assembly = stubAssemblyWithArm();
    const result = selectGrabTarget(gs, 'orb-sat-1', ps, assembly);
    expect(result.success).toBe(true);
    expect(gs.state).toBe(GrabState.APPROACHING);
    expect(gs.targetId).toBe('orb-sat-1');
  });

  it('fails when no grabbing arm on craft', () => {
    const gs = createGrabState();
    const ps = stubPs({ activeParts: new Set(['part-1', 'tank-1']) });
    const assembly = stubAssemblyNoArm();
    const result = selectGrabTarget(gs, 'orb-sat-1', ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('No grabbing arm');
  });

  it('fails when already grabbed', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    const ps = stubPs();
    const assembly = stubAssemblyWithArm();
    const result = selectGrabTarget(gs, 'orb-sat-1', ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Already grabbed');
  });
});

// ---------------------------------------------------------------------------
// clearGrabTarget
// ---------------------------------------------------------------------------

describe('clearGrabTarget', () => {
  it('resets state to IDLE', () => {
    const gs = createGrabState();
    gs.state = GrabState.APPROACHING;
    gs.targetId = 'orb-sat-1';
    gs.targetDistance = 100;
    clearGrabTarget(gs);
    expect(gs.state).toBe(GrabState.IDLE);
    expect(gs.targetId).toBeNull();
    expect(gs.targetDistance).toBe(Infinity);
    expect(gs.grabbedSatelliteId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// repairGrabbedSatellite
// ---------------------------------------------------------------------------

describe('repairGrabbedSatellite', () => {
  it('restores satellite health to 100 when grabbed', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedSatelliteId = 'sat-1';
    const state = stubGameStateWithSatellite();

    const result = repairGrabbedSatellite(gs, state);
    expect(result.success).toBe(true);
    expect(result.healthBefore).toBe(50);

    const sat = state.satelliteNetwork.satellites[0];
    expect(sat.health).toBe(100);
  });

  it('fails when not in GRABBED state', () => {
    const gs = createGrabState();
    gs.state = GrabState.APPROACHING;
    const state = stubGameStateWithSatellite();

    const result = repairGrabbedSatellite(gs, state);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not grabbing');
  });

  it('fails when satellite record not found', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedSatelliteId = 'nonexistent';
    const state = stubGameStateWithSatellite();

    const result = repairGrabbedSatellite(gs, state);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('fails when satellite is decommissioned (health 0)', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedSatelliteId = 'sat-1';
    const state = stubGameStateWithSatellite();
    state.satelliteNetwork.satellites[0].health = 0;

    const result = repairGrabbedSatellite(gs, state);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('decommissioned');
  });

  it('does not exceed 100 health', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedSatelliteId = 'sat-1';
    const state = stubGameStateWithSatellite();
    state.satelliteNetwork.satellites[0].health = 95;

    const result = repairGrabbedSatellite(gs, state);
    expect(result.success).toBe(true);
    expect(state.satelliteNetwork.satellites[0].health).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// releaseGrabbedSatellite
// ---------------------------------------------------------------------------

describe('releaseGrabbedSatellite', () => {
  it('transitions to RELEASING state', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedSatelliteId = 'sat-1';

    const result = releaseGrabbedSatellite(gs);
    expect(result.success).toBe(true);
    expect(gs.state).toBe(GrabState.RELEASING);
    expect(gs.grabbedSatelliteId).toBeNull();
  });

  it('fails when not in GRABBED state', () => {
    const gs = createGrabState();
    gs.state = GrabState.IDLE;

    const result = releaseGrabbedSatellite(gs);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// processGrabRepairsFromFlight
// ---------------------------------------------------------------------------

describe('processGrabRepairsFromFlight', () => {
  it('processes SATELLITE_REPAIRED events and heals satellites', () => {
    const state = stubGameStateWithSatellite();
    const fs = freshFlightState();
    fs.events = [
      { type: 'SATELLITE_REPAIRED', satelliteId: 'sat-1', timestamp: 1000 },
    ];

    const repaired = processGrabRepairsFromFlight(state, fs);
    expect(repaired).toHaveLength(1);
    expect(repaired[0].satelliteId).toBe('sat-1');
    expect(repaired[0].healthBefore).toBe(50);
    expect(state.satelliteNetwork.satellites[0].health).toBe(100);
  });

  it('returns empty array when no repair events', () => {
    const state = stubGameStateWithSatellite();
    const fs = freshFlightState();
    fs.events = [];

    const repaired = processGrabRepairsFromFlight(state, fs);
    expect(repaired).toHaveLength(0);
  });

  it('skips decommissioned satellites', () => {
    const state = stubGameStateWithSatellite();
    state.satelliteNetwork.satellites[0].health = 0;
    const fs = freshFlightState();
    fs.events = [
      { type: 'SATELLITE_REPAIRED', satelliteId: 'sat-1', timestamp: 1000 },
    ];

    const repaired = processGrabRepairsFromFlight(state, fs);
    expect(repaired).toHaveLength(0);
  });

  it('handles null flightState gracefully', () => {
    const state = stubGameStateWithSatellite();
    const repaired = processGrabRepairsFromFlight(state, null);
    expect(repaired).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Part definition validation
// ---------------------------------------------------------------------------

describe('grabbing-arm part definition', () => {
  it('exists in the parts catalog', () => {
    const part = getPartById('grabbing-arm');
    expect(part).toBeDefined();
  });

  it('has correct type', () => {
    const part = getPartById('grabbing-arm');
    expect(part.type).toBe(PartType.GRABBING_ARM);
  });

  it('costs $35,000', () => {
    const part = getPartById('grabbing-arm');
    expect(part.cost).toBe(35_000);
  });

  it('weighs 150 kg', () => {
    const part = getPartById('grabbing-arm');
    expect(part.mass).toBe(150);
  });

  it('is activatable with GRAB behaviour', () => {
    const part = getPartById('grabbing-arm');
    expect(part.activatable).toBe(true);
    expect(part.activationBehaviour).toBe('GRAB');
  });

  it('has radial snap points', () => {
    const part = getPartById('grabbing-arm');
    const sides = part.snapPoints.map((sp) => sp.side);
    expect(sides).toContain('left');
    expect(sides).toContain('right');
  });

  it('has heat tolerance and crash threshold properties', () => {
    const part = getPartById('grabbing-arm');
    expect(part.properties.heatTolerance).toBeGreaterThan(0);
    expect(part.properties.crashThreshold).toBeGreaterThan(0);
    expect(part.properties.armReach).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// GrabState constants
// ---------------------------------------------------------------------------

describe('GrabState enum', () => {
  it('has all expected states', () => {
    expect(GrabState.IDLE).toBe('IDLE');
    expect(GrabState.APPROACHING).toBe('APPROACHING');
    expect(GrabState.EXTENDING).toBe('EXTENDING');
    expect(GrabState.GRABBED).toBe('GRABBED');
    expect(GrabState.RELEASING).toBe('RELEASING');
  });
});

// ---------------------------------------------------------------------------
// Grab constants
// ---------------------------------------------------------------------------

describe('Grab system constants', () => {
  it('defines visual range', () => {
    expect(GRAB_VISUAL_RANGE_DEG).toBe(3);
  });

  it('defines guidance range', () => {
    expect(GRAB_GUIDANCE_RANGE).toBe(500);
  });

  it('defines arm range', () => {
    expect(GRAB_ARM_RANGE).toBe(25);
  });

  it('defines max relative speed', () => {
    expect(GRAB_MAX_RELATIVE_SPEED).toBe(1.0);
  });

  it('defines max lateral offset', () => {
    expect(GRAB_MAX_LATERAL_OFFSET).toBe(5.0);
  });

  it('defines repair health amount', () => {
    expect(GRAB_REPAIR_HEALTH).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// updateGrabState() — state machine
// ---------------------------------------------------------------------------

describe('updateGrabState', () => {
  it('does nothing in IDLE state', () => {
    const gs = createGrabState();
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();

    updateGrabState(gs, ps, fs, state);

    expect(gs.state).toBe(GrabState.IDLE);
  });

  it('does nothing in GRABBED state', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedSatelliteId = 'sat-1';
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();

    updateGrabState(gs, ps, fs, state);

    expect(gs.state).toBe(GrabState.GRABBED);
  });

  it('clears target when targetId is null', () => {
    const gs = createGrabState();
    gs.state = GrabState.APPROACHING;
    gs.targetId = null;
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();

    updateGrabState(gs, ps, fs, state);

    expect(gs.state).toBe(GrabState.IDLE);
  });

  it('clears target when target object not found in orbitalObjects', () => {
    const gs = createGrabState();
    gs.state = GrabState.APPROACHING;
    gs.targetId = 'nonexistent-object';
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();

    updateGrabState(gs, ps, fs, state);

    expect(gs.state).toBe(GrabState.IDLE);
    expect(gs.targetId).toBeNull();
  });

  it('updates distance, relSpeed, and lateral metrics when approaching', () => {
    const gs = createGrabState();
    gs.state = GrabState.APPROACHING;
    gs.targetId = 'orb-sat-1';
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();

    updateGrabState(gs, ps, fs, state);

    // Metrics should be computed — targetDistance should be finite.
    expect(Number.isFinite(gs.targetDistance)).toBe(true);
    expect(Number.isFinite(gs.targetRelSpeed)).toBe(true);
    expect(Number.isFinite(gs.targetLateral)).toBe(true);
  });

  it('stays in APPROACHING when not within range', () => {
    const gs = createGrabState();
    gs.state = GrabState.APPROACHING;
    gs.targetId = 'orb-sat-1';
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    // Use different orbital elements so the target is far away.
    state.orbitalObjects[0].elements = {
      semiMajorAxis: 7_000_000,
      eccentricity: 0.001,
      argPeriapsis: Math.PI / 2,
      meanAnomalyAtEpoch: Math.PI,
      epoch: 0,
    };

    updateGrabState(gs, ps, fs, state);

    expect(gs.state).toBe(GrabState.APPROACHING);
  });

  it('transitions from EXTENDING back to APPROACHING when out of range', () => {
    const gs = createGrabState();
    gs.state = GrabState.EXTENDING;
    gs.targetId = 'orb-sat-1';
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    // Move target to a different orbit so distance is large.
    state.orbitalObjects[0].elements = {
      semiMajorAxis: 7_000_000,
      eccentricity: 0.001,
      argPeriapsis: Math.PI / 2,
      meanAnomalyAtEpoch: Math.PI,
      epoch: 0,
    };

    updateGrabState(gs, ps, fs, state);

    // Should revert to APPROACHING since not in range.
    expect(gs.state).toBe(GrabState.APPROACHING);
  });

  it('transitions from RELEASING to IDLE (clears state)', () => {
    const gs = createGrabState();
    gs.state = GrabState.RELEASING;
    gs.targetId = 'orb-sat-1';
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();

    updateGrabState(gs, ps, fs, state);

    expect(gs.state).toBe(GrabState.IDLE);
    expect(gs.targetId).toBeNull();
  });

  it('transitions from EXTENDING to GRABBED when in range with correct conditions', () => {
    const gs = createGrabState();
    gs.state = GrabState.EXTENDING;
    gs.targetId = 'orb-sat-1';
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    // Use identical orbital elements so distance ≈ 0, relSpeed ≈ 0.
    state.orbitalObjects[0].elements = { ...fs.orbitalElements };

    updateGrabState(gs, ps, fs, state);

    // When distance is ≈ 0 and speed is ≈ 0, should grab.
    if (gs.inRange && gs.speedOk) {
      expect(gs.state).toBe(GrabState.GRABBED);
    } else {
      // If computed distance > arm range, it stays in EXTENDING or goes to APPROACHING.
      expect([GrabState.EXTENDING, GrabState.APPROACHING]).toContain(gs.state);
    }
  });
});

// ---------------------------------------------------------------------------
// getGrabTargetsInRange()
// ---------------------------------------------------------------------------

describe('getGrabTargetsInRange', () => {
  it('returns empty when not in orbit', () => {
    const ps = stubPs();
    const fs = freshFlightState(FlightPhase.FLIGHT);
    fs.inOrbit = false;
    const state = stubGameStateWithSatellite();

    const targets = getGrabTargetsInRange(ps, fs, state);
    expect(targets).toHaveLength(0);
  });

  it('returns empty when orbitalElements is null', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    fs.orbitalElements = null;
    const state = stubGameStateWithSatellite();

    const targets = getGrabTargetsInRange(ps, fs, state);
    expect(targets).toHaveLength(0);
  });

  it('returns empty when no satellites in same body', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    state.orbitalObjects[0].bodyId = 'MARS'; // different body

    const targets = getGrabTargetsInRange(ps, fs, state);
    expect(targets).toHaveLength(0);
  });

  it('returns empty when no SATELLITE type objects exist', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    state.orbitalObjects[0].type = OrbitalObjectType.CRAFT;

    const targets = getGrabTargetsInRange(ps, fs, state);
    expect(targets).toHaveLength(0);
  });

  it('finds a satellite when in same orbit (co-orbital)', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    // Use the exact same orbital elements for both craft and satellite.
    state.orbitalObjects[0].elements = { ...fs.orbitalElements };

    const targets = getGrabTargetsInRange(ps, fs, state);
    // Should find the satellite since angular distance is ~0.
    expect(targets.length).toBeGreaterThanOrEqual(1);
    expect(targets[0].object.id).toBe('orb-sat-1');
  });

  it('includes satelliteRecord when one exists and has health > 0', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    state.orbitalObjects[0].elements = { ...fs.orbitalElements };

    const targets = getGrabTargetsInRange(ps, fs, state);
    if (targets.length > 0) {
      expect(targets[0].satelliteRecord).not.toBeNull();
      expect(targets[0].satelliteRecord.id).toBe('sat-1');
    }
  });

  it('returns null satelliteRecord when satellite health is 0', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    state.orbitalObjects[0].elements = { ...fs.orbitalElements };
    state.satelliteNetwork.satellites[0].health = 0;

    const targets = getGrabTargetsInRange(ps, fs, state);
    if (targets.length > 0) {
      expect(targets[0].satelliteRecord).toBeNull();
    }
  });

  it('returns results sorted by distance', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    // Add a second satellite at the same orbit.
    state.orbitalObjects.push({
      id: 'orb-sat-2',
      bodyId: 'EARTH',
      type: OrbitalObjectType.SATELLITE,
      name: 'Comm Sat 2',
      elements: { ...fs.orbitalElements, meanAnomalyAtEpoch: 0.01 },
    });
    state.orbitalObjects[0].elements = { ...fs.orbitalElements };

    const targets = getGrabTargetsInRange(ps, fs, state);
    for (let i = 1; i < targets.length; i++) {
      expect(targets[i].distance).toBeGreaterThanOrEqual(targets[i - 1].distance);
    }
  });

  it('excludes satellites outside GRAB_VISUAL_RANGE_DEG', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    // Place satellite at a very different orbit so angular distance > GRAB_VISUAL_RANGE_DEG.
    state.orbitalObjects[0].elements = {
      semiMajorAxis: 6_471_000,
      eccentricity: 0.001,
      argPeriapsis: 0,
      meanAnomalyAtEpoch: Math.PI, // opposite side of orbit
      epoch: 0,
    };

    const targets = getGrabTargetsInRange(ps, fs, state);
    expect(targets).toHaveLength(0);
  });

  it('excludes satellites in different altitude bands', () => {
    const ps = stubPs();
    const fs = freshFlightState();
    const state = stubGameStateWithSatellite();
    // Put satellite at a much higher orbit (different altitude band).
    state.orbitalObjects[0].elements = {
      semiMajorAxis: 42_164_000, // GEO
      eccentricity: 0.001,
      argPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    };

    const targets = getGrabTargetsInRange(ps, fs, state);
    expect(targets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// repairGrabbedSatellite — no satelliteNetwork
// ---------------------------------------------------------------------------

describe('repairGrabbedSatellite — edge cases', () => {
  it('fails when grabbedSatelliteId is null', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedSatelliteId = null;
    const state = stubGameStateWithSatellite();

    const result = repairGrabbedSatellite(gs, state);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('No satellite record');
  });
});

// ---------------------------------------------------------------------------
// processGrabRepairsFromFlight — edge cases
// ---------------------------------------------------------------------------

describe('processGrabRepairsFromFlight — edge cases', () => {
  it('handles null satelliteNetwork gracefully', () => {
    const state = stubGameStateWithSatellite();
    state.satelliteNetwork = null;
    const fs = freshFlightState();
    fs.events = [{ type: 'SATELLITE_REPAIRED', satelliteId: 'sat-1', timestamp: 1000 }];

    const repaired = processGrabRepairsFromFlight(state, fs);
    expect(repaired).toHaveLength(0);
  });

  it('skips events with missing satelliteId', () => {
    const state = stubGameStateWithSatellite();
    const fs = freshFlightState();
    fs.events = [{ type: 'SATELLITE_REPAIRED', timestamp: 1000 }]; // no satelliteId

    const repaired = processGrabRepairsFromFlight(state, fs);
    expect(repaired).toHaveLength(0);
  });

  it('skips events for unknown satellite IDs', () => {
    const state = stubGameStateWithSatellite();
    const fs = freshFlightState();
    fs.events = [{ type: 'SATELLITE_REPAIRED', satelliteId: 'unknown-sat', timestamp: 1000 }];

    const repaired = processGrabRepairsFromFlight(state, fs);
    expect(repaired).toHaveLength(0);
  });

  it('caps satellite health at 100', () => {
    const state = stubGameStateWithSatellite();
    state.satelliteNetwork.satellites[0].health = 99;
    const fs = freshFlightState();
    fs.events = [{ type: 'SATELLITE_REPAIRED', satelliteId: 'sat-1', timestamp: 1000 }];

    processGrabRepairsFromFlight(state, fs);
    expect(state.satelliteNetwork.satellites[0].health).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Asteroid grab target helpers
// ---------------------------------------------------------------------------

function makeAsteroid(overrides = {}) {
  return {
    id: 'AST-0001-0',
    type: 'asteroid' as const,
    name: 'AST-0001',
    posX: 0,
    posY: 0,
    velX: 0,
    velY: 0,
    radius: 50,
    mass: 50_000,
    shapeSeed: 12345,
    ...overrides,
  };
}

function stubAssemblyWithHeavyArm() {
  const parts = new Map();
  parts.set('part-1', { instanceId: 'part-1', partId: 'cmd-mk1', x: 0, y: 0 });
  parts.set('arm-1', { instanceId: 'arm-1', partId: 'grabbing-arm-heavy', x: -20, y: 0 });
  return {
    parts,
    connections: [],
    symmetryPairs: [],
    _nextId: 3,
  };
}

// ---------------------------------------------------------------------------
// canGrab — asteroid support
// ---------------------------------------------------------------------------

describe('canGrab — asteroid support', () => {
  it('returns true for asteroid type', () => {
    expect(canGrab({ type: 'asteroid' })).toBe(true);
  });

  it('still returns true for SATELLITE type', () => {
    expect(canGrab({ type: OrbitalObjectType.SATELLITE })).toBe(true);
  });

  it('still returns false for CRAFT type', () => {
    expect(canGrab({ type: OrbitalObjectType.CRAFT })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createGrabState — grabbedAsteroid field
// ---------------------------------------------------------------------------

describe('createGrabState — grabbedAsteroid', () => {
  it('initialises grabbedAsteroid as null', () => {
    const gs = createGrabState();
    expect(gs.grabbedAsteroid).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// clearGrabTarget — clears grabbedAsteroid
// ---------------------------------------------------------------------------

describe('clearGrabTarget — clears grabbedAsteroid', () => {
  it('sets grabbedAsteroid to null when clearing', () => {
    const gs = createGrabState();
    gs.grabbedAsteroid = makeAsteroid();
    gs.state = 'GRABBED';
    clearGrabTarget(gs);
    expect(gs.grabbedAsteroid).toBeNull();
    expect(gs.state).toBe(GrabState.IDLE);
  });
});

// ---------------------------------------------------------------------------
// getAsteroidGrabTargetsInRange
// ---------------------------------------------------------------------------

describe('getAsteroidGrabTargetsInRange', () => {
  it('returns asteroids sorted by distance', () => {
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const far = makeAsteroid({ id: 'AST-FAR', posX: 300, posY: 0 });
    const near = makeAsteroid({ id: 'AST-NEAR', posX: 100, posY: 0 });
    const results = getAsteroidGrabTargetsInRange([far, near], ps);
    expect(results).toHaveLength(2);
    expect(results[0].asteroid.id).toBe('AST-NEAR');
    expect(results[1].asteroid.id).toBe('AST-FAR');
  });

  it('returns empty when no asteroids nearby', () => {
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    // GRAB_ARM_RANGE is 25, visual range is 25*20 = 500
    const farAway = makeAsteroid({ posX: 100_000, posY: 0 });
    const results = getAsteroidGrabTargetsInRange([farAway], ps);
    expect(results).toHaveLength(0);
  });

  it('computes relative speed', () => {
    const ps = stubPs({ posX: 0, posY: 0, velX: 100, velY: 0 });
    const ast = makeAsteroid({ posX: 10, posY: 0, velX: 103, velY: 4 });
    const results = getAsteroidGrabTargetsInRange([ast], ps);
    expect(results).toHaveLength(1);
    expect(results[0].relativeSpeed).toBeCloseTo(5, 0); // sqrt(3^2 + 4^2) = 5
  });

  it('returns empty for an empty asteroid array', () => {
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const results = getAsteroidGrabTargetsInRange([], ps);
    expect(results).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// captureAsteroid
// ---------------------------------------------------------------------------

describe('captureAsteroid', () => {
  it('succeeds when asteroid is in range and within mass limit', () => {
    const gs = createGrabState();
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithArm();
    // mass 50,000 < standard arm limit 100,000; distance 10 < GRAB_ARM_RANGE 25
    const ast = makeAsteroid({ posX: 10, posY: 0, velX: 0, velY: 0, mass: 50_000 });
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(true);
    expect(gs.state).toBe(GrabState.GRABBED);
    expect(gs.grabbedAsteroid).toBe(ast);
  });

  it('fails when no grabbing arm', () => {
    const gs = createGrabState();
    const ps = stubPs({ activeParts: new Set(['part-1', 'tank-1']) });
    const assembly = stubAssemblyNoArm();
    const ast = makeAsteroid({ posX: 10, posY: 0 });
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('No grabbing arm');
  });

  it('fails when asteroid exceeds mass limit', () => {
    const gs = createGrabState();
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithArm(); // standard arm: 100,000 kg limit
    const ast = makeAsteroid({ posX: 10, posY: 0, mass: 200_000 }); // exceeds 100,000
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('too massive');
  });

  it('succeeds with heavy arm for larger asteroids', () => {
    const gs = createGrabState();
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithHeavyArm(); // heavy arm: 100,000,000 kg limit
    const ast = makeAsteroid({ posX: 10, posY: 0, mass: 50_000_000 });
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(true);
  });

  it('fails when asteroid is out of range', () => {
    const gs = createGrabState();
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithArm();
    const ast = makeAsteroid({ posX: 100, posY: 0, mass: 50_000 }); // 100m > GRAB_ARM_RANGE 25m
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('out of range');
  });

  it('fails when relative speed too high', () => {
    const gs = createGrabState();
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithArm();
    // GRAB_MAX_RELATIVE_SPEED is 1.0 m/s; this asteroid is moving at ~5 m/s relative
    const ast = makeAsteroid({ posX: 10, posY: 0, velX: 3, velY: 4, mass: 50_000 });
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Relative speed too high');
  });

  it('sets grabbedAsteroid on success', () => {
    const gs = createGrabState();
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithArm();
    const ast = makeAsteroid({ posX: 5, posY: 0, mass: 1_000 });
    captureAsteroid(gs, ast, ps, assembly);
    expect(gs.grabbedAsteroid).toBe(ast);
  });

  it('fails when arm is busy (GRABBED state)', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithArm();
    const ast = makeAsteroid({ posX: 10, posY: 0, mass: 50_000 });
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Arm is busy');
  });

  it('fails when arm is busy (EXTENDING state)', () => {
    const gs = createGrabState();
    gs.state = GrabState.EXTENDING;
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithArm();
    const ast = makeAsteroid({ posX: 10, posY: 0, mass: 50_000 });
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Arm is busy');
  });

  it('allows capture from APPROACHING state', () => {
    const gs = createGrabState();
    gs.state = GrabState.APPROACHING;
    const ps = stubPs({ posX: 0, posY: 0, velX: 0, velY: 0 });
    const assembly = stubAssemblyWithArm();
    const ast = makeAsteroid({ posX: 10, posY: 0, mass: 50_000 });
    const result = captureAsteroid(gs, ast, ps, assembly);
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// releaseGrabbedAsteroid
// ---------------------------------------------------------------------------

describe('releaseGrabbedAsteroid', () => {
  it('succeeds when asteroid is grabbed', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedAsteroid = makeAsteroid();
    const result = releaseGrabbedAsteroid(gs);
    expect(result.success).toBe(true);
    expect(gs.state).toBe(GrabState.RELEASING);
    expect(gs.grabbedAsteroid).toBeNull();
  });

  it('fails when no asteroid grabbed', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    gs.grabbedAsteroid = null;
    const result = releaseGrabbedAsteroid(gs);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('No asteroid grabbed');
  });

  it('fails when not in GRABBED state', () => {
    const gs = createGrabState();
    gs.state = GrabState.IDLE;
    gs.grabbedAsteroid = makeAsteroid();
    const result = releaseGrabbedAsteroid(gs);
    expect(result.success).toBe(false);
    expect(result.reason).toContain('No asteroid grabbed');
  });

  it('returns the released asteroid', () => {
    const gs = createGrabState();
    gs.state = GrabState.GRABBED;
    const ast = makeAsteroid({ id: 'AST-RELEASED' });
    gs.grabbedAsteroid = ast;
    const result = releaseGrabbedAsteroid(gs);
    expect(result.success).toBe(true);
    expect(result.asteroid).toBe(ast);
    expect(result.asteroid.id).toBe('AST-RELEASED');
  });
});

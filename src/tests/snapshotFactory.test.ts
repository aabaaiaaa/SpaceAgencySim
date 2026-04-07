// @ts-nocheck
/**
 * snapshotFactory.test.ts — Unit tests for createSnapshotFromState().
 *
 * Tests correct field mapping from mutable PhysicsState + FlightState to
 * MainThreadSnapshot, verifies control inputs are excluded, Sets/Maps are
 * serialised, and the fallback snapshot format matches the worker snapshot
 * format.
 */

import { describe, it, expect } from 'vitest';
import { createSnapshotFromState } from '../core/snapshotFactory.ts';

// ---------------------------------------------------------------------------
// Minimal mutable state factories with Sets and Maps
// ---------------------------------------------------------------------------

function makePhysicsState(overrides = {}) {
  return {
    posX: 100,
    posY: 5000,
    velX: 10,
    velY: 200,
    angle: 0.1,
    throttle: 0.75,
    throttleMode: 'absolute',
    targetTWR: 1.5,
    firingEngines: new Set(['engine-1', 'engine-2']),
    fuelStore: new Map([['tank-1', 500], ['tank-2', 300]]),
    activeParts: new Set(['engine-1', 'engine-2', 'tank-1', 'tank-2', 'cmd-1']),
    deployedParts: new Set(['chute-1']),
    parachuteStates: new Map([
      ['chute-1', { state: 'deploying', deployTimer: 2.5, canopyAngle: 0, canopyAngularVel: 0 }],
    ]),
    legStates: new Map([['leg-1', { state: 'deployed', deployTimer: 0 }]]),
    ejectorStates: new Map([['cmd-1', 'armed']]),
    ejectedCrewIds: new Set(['crew-x']),
    ejectedCrew: [
      { x: 10, y: 20, velX: 1, velY: 2, chuteOpen: false, chuteTimer: 0 },
    ],
    instrumentStates: new Map(),
    scienceModuleStates: new Map(),
    heatMap: new Map([['cmd-1', 12.5]]),
    debris: [
      {
        id: 'debris-1',
        activeParts: new Set(['booster-1']),
        firingEngines: new Set<string>(),
        fuelStore: new Map([['booster-1', 50]]),
        deployedParts: new Set<string>(),
        parachuteStates: new Map(),
        legStates: new Map(),
        heatMap: new Map([['booster-1', 5.0]]),
        posX: 50, posY: 3000, velX: -5, velY: -20,
        angle: 0.5, throttle: 0,
        angularVelocity: 0.1,
        isTipping: false, tippingContactX: 0, tippingContactY: 0,
        landed: false, crashed: false,
      },
    ],
    landed: false,
    crashed: false,
    grounded: false,
    angularVelocity: 0.02,
    isTipping: false,
    tippingContactX: 0,
    tippingContactY: 0,
    controlMode: 'NORMAL',
    baseOrbit: null,
    dockingAltitudeBand: null,
    dockingOffsetAlongTrack: 0,
    dockingOffsetRadial: 0,
    rcsActiveDirections: new Set(['up']),
    dockingPortStates: new Map([['port-1', 'retracted']]),
    weatherIspModifier: 1.0,
    hasLaunchClamps: false,
    powerState: null,
    malfunctions: new Map([['engine-1', { type: 'THRUST_LOSS', recovered: false }]]),
    ...overrides,
  };
}

function makeFlightState(overrides = {}) {
  return {
    missionId: 'mission-1',
    rocketId: 'rocket-1',
    crewIds: ['crew-a', 'crew-b'],
    crewCount: 2,
    timeElapsed: 120,
    altitude: 85000,
    velocity: 2200,
    fuelRemaining: 800,
    deltaVRemaining: 3500,
    events: [
      { time: 0, type: 'STAGE_SEP', description: 'Stage 1 separation' },
    ],
    aborted: false,
    phase: 'FLIGHT',
    phaseLog: [
      { from: 'PRELAUNCH', to: 'LAUNCH', time: 0, reason: 'Engine ignition' },
    ],
    inOrbit: false,
    orbitalElements: null,
    bodyId: 'EARTH',
    orbitBandId: null,
    currentBiome: 'UPPER_ATMOSPHERE',
    biomesVisited: ['LAUNCH_PAD', 'LOWER_ATMOSPHERE'],
    maxAltitude: 85000,
    maxVelocity: 2200,
    dockingState: null,
    transferState: null,
    powerState: null,
    commsState: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createSnapshotFromState', () => {
  describe('basic structure', () => {
    it('returns an object with physics, flight, and frame fields', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 42);
      expect(snap).toHaveProperty('physics');
      expect(snap).toHaveProperty('flight');
      expect(snap).toHaveProperty('frame');
      expect(snap.frame).toBe(42);
    });

    it('passes through the frame counter', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 999);
      expect(snap.frame).toBe(999);
    });
  });

  describe('control inputs excluded', () => {
    it('does not include throttle in physics snapshot', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics).not.toHaveProperty('throttle');
    });

    it('does not include throttleMode in physics snapshot', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics).not.toHaveProperty('throttleMode');
    });

    it('does not include targetTWR in physics snapshot', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics).not.toHaveProperty('targetTWR');
    });

    it('does not include angle in physics snapshot', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics).not.toHaveProperty('angle');
    });
  });

  describe('Set serialisation', () => {
    it('converts firingEngines Set to array', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(Array.isArray(snap.physics.firingEngines)).toBe(true);
      expect(snap.physics.firingEngines).toContain('engine-1');
      expect(snap.physics.firingEngines).toContain('engine-2');
    });

    it('converts activeParts Set to array', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(Array.isArray(snap.physics.activeParts)).toBe(true);
      expect(snap.physics.activeParts).toContain('cmd-1');
    });

    it('converts deployedParts Set to array', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(Array.isArray(snap.physics.deployedParts)).toBe(true);
      expect(snap.physics.deployedParts).toContain('chute-1');
    });

    it('converts ejectedCrewIds Set to array', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(Array.isArray(snap.physics.ejectedCrewIds)).toBe(true);
      expect(snap.physics.ejectedCrewIds).toContain('crew-x');
    });

    it('converts rcsActiveDirections Set to array', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(Array.isArray(snap.physics.rcsActiveDirections)).toBe(true);
      expect(snap.physics.rcsActiveDirections).toContain('up');
    });
  });

  describe('Map serialisation', () => {
    it('converts fuelStore Map to record', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.fuelStore).toEqual({ 'tank-1': 500, 'tank-2': 300 });
    });

    it('converts heatMap Map to record', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.heatMap).toEqual({ 'cmd-1': 12.5 });
    });

    it('converts legStates Map to record', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.legStates).toEqual({
        'leg-1': { state: 'deployed', deployTimer: 0 },
      });
    });

    it('converts dockingPortStates Map to record', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.dockingPortStates).toEqual({ 'port-1': 'retracted' });
    });

    it('converts malfunctions Map to record', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.malfunctions).toEqual({
        'engine-1': { type: 'THRUST_LOSS', recovered: false },
      });
    });

    it('handles null malfunctions', () => {
      const ps = makePhysicsState({ malfunctions: null });
      const snap = createSnapshotFromState(ps, makeFlightState(), 1);
      expect(snap.physics.malfunctions).toBeNull();
    });
  });

  describe('scalar field mapping', () => {
    it('maps position values correctly', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.posX).toBe(100);
      expect(snap.physics.posY).toBe(5000);
    });

    it('maps velocity values correctly', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.velX).toBe(10);
      expect(snap.physics.velY).toBe(200);
    });

    it('maps boolean flags correctly', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.landed).toBe(false);
      expect(snap.physics.crashed).toBe(false);
      expect(snap.physics.grounded).toBe(false);
    });

    it('maps angular velocity', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.angularVelocity).toBe(0.02);
    });
  });

  describe('flight state mapping', () => {
    it('maps mission and rocket IDs', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.flight.missionId).toBe('mission-1');
      expect(snap.flight.rocketId).toBe('rocket-1');
    });

    it('copies crewIds as a new array', () => {
      const fs = makeFlightState();
      const snap = createSnapshotFromState(makePhysicsState(), fs, 1);
      expect(snap.flight.crewIds).toEqual(['crew-a', 'crew-b']);
      // Must be a different array reference (defensive copy)
      expect(snap.flight.crewIds).not.toBe(fs.crewIds);
    });

    it('copies events as new array entries', () => {
      const fs = makeFlightState();
      const snap = createSnapshotFromState(makePhysicsState(), fs, 1);
      expect(snap.flight.events).toHaveLength(1);
      expect(snap.flight.events[0]).toEqual(fs.events[0]);
      expect(snap.flight.events[0]).not.toBe(fs.events[0]); // shallow copy
    });

    it('copies biomesVisited as a new array', () => {
      const fs = makeFlightState();
      const snap = createSnapshotFromState(makePhysicsState(), fs, 1);
      expect(snap.flight.biomesVisited).toEqual(['LAUNCH_PAD', 'LOWER_ATMOSPHERE']);
      expect(snap.flight.biomesVisited).not.toBe(fs.biomesVisited);
    });

    it('maps flight phase and numeric values', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.flight.phase).toBe('FLIGHT');
      expect(snap.flight.altitude).toBe(85000);
      expect(snap.flight.velocity).toBe(2200);
      expect(snap.flight.timeElapsed).toBe(120);
    });

    it('handles null optional flight fields', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.flight.orbitalElements).toBeNull();
      expect(snap.flight.dockingState).toBeNull();
      expect(snap.flight.transferState).toBeNull();
    });

    it('copies non-null orbitalElements', () => {
      const orbElems = { a: 7000000, e: 0.01, i: 0, om: 0, w: 0, v: 0 };
      const fs = makeFlightState({ orbitalElements: orbElems });
      const snap = createSnapshotFromState(makePhysicsState(), fs, 1);
      expect(snap.flight.orbitalElements).toEqual(orbElems);
      expect(snap.flight.orbitalElements).not.toBe(orbElems); // defensive copy
    });
  });

  describe('debris serialisation', () => {
    it('serialises debris Sets and Maps', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.debris).toHaveLength(1);
      const d = snap.physics.debris[0];
      expect(d.id).toBe('debris-1');
      expect(Array.isArray(d.activeParts)).toBe(true);
      expect(d.activeParts).toContain('booster-1');
      expect(d.fuelStore).toEqual({ 'booster-1': 50 });
      expect(d.heatMap).toEqual({ 'booster-1': 5.0 });
    });

    it('handles empty debris array', () => {
      const ps = makePhysicsState({ debris: [] });
      const snap = createSnapshotFromState(ps, makeFlightState(), 1);
      expect(snap.physics.debris).toEqual([]);
    });
  });

  describe('ejectedCrew serialisation', () => {
    it('serialises ejected crew entries', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      expect(snap.physics.ejectedCrew).toHaveLength(1);
      expect(snap.physics.ejectedCrew[0]).toEqual({
        x: 10, y: 20, velX: 1, velY: 2, chuteOpen: false, chuteTimer: 0,
      });
    });
  });

  describe('main-thread fallback format matches worker snapshot format', () => {
    it('snapshot has the same top-level shape as worker MainThreadSnapshot', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);

      // MainThreadSnapshot must have: physics, flight, frame
      expect(typeof snap.physics).toBe('object');
      expect(typeof snap.flight).toBe('object');
      expect(typeof snap.frame).toBe('number');
    });

    it('physics snapshot contains all required ReadonlyPhysicsSnapshot fields', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      const p = snap.physics;

      // All fields that ReadonlyPhysicsSnapshot must have (PhysicsSnapshot minus control inputs)
      const requiredFields = [
        'posX', 'posY', 'velX', 'velY',
        'firingEngines', 'fuelStore', 'activeParts', 'deployedParts',
        'parachuteStates', 'legStates', 'ejectorStates',
        'ejectedCrewIds', 'ejectedCrew',
        'instrumentStates', 'scienceModuleStates', 'heatMap',
        'debris', 'landed', 'crashed', 'grounded',
        'angularVelocity', 'isTipping', 'tippingContactX', 'tippingContactY',
        'controlMode', 'baseOrbit',
        'dockingAltitudeBand', 'dockingOffsetAlongTrack', 'dockingOffsetRadial',
        'rcsActiveDirections', 'dockingPortStates',
        'weatherIspModifier', 'hasLaunchClamps', 'powerState', 'malfunctions',
      ];

      for (const field of requiredFields) {
        expect(p).toHaveProperty(field);
      }
    });

    it('flight snapshot contains all required ReadonlyFlightSnapshot fields', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      const f = snap.flight;

      const requiredFields = [
        'missionId', 'rocketId', 'crewIds', 'crewCount',
        'timeElapsed', 'altitude', 'velocity',
        'fuelRemaining', 'deltaVRemaining',
        'events', 'aborted', 'phase', 'phaseLog',
        'inOrbit', 'orbitalElements', 'bodyId', 'orbitBandId',
        'currentBiome', 'biomesVisited',
        'maxAltitude', 'maxVelocity',
        'dockingState', 'transferState', 'powerState', 'commsState',
      ];

      for (const field of requiredFields) {
        expect(f).toHaveProperty(field);
      }
    });

    it('serialised types match worker snapshot types (arrays not Sets, records not Maps)', () => {
      const snap = createSnapshotFromState(makePhysicsState(), makeFlightState(), 1);
      const p = snap.physics;

      // Sets should be arrays
      expect(Array.isArray(p.firingEngines)).toBe(true);
      expect(Array.isArray(p.activeParts)).toBe(true);
      expect(Array.isArray(p.deployedParts)).toBe(true);
      expect(Array.isArray(p.ejectedCrewIds)).toBe(true);
      expect(Array.isArray(p.rcsActiveDirections)).toBe(true);

      // Maps should be plain objects (not Map instances)
      expect(p.fuelStore instanceof Map).toBe(false);
      expect(typeof p.fuelStore).toBe('object');
      expect(p.heatMap instanceof Map).toBe(false);
      expect(typeof p.heatMap).toBe('object');
      expect(p.legStates instanceof Map).toBe(false);
      expect(p.dockingPortStates instanceof Map).toBe(false);
    });

    it('round-trip: snapshot values match input mutable state', () => {
      const ps = makePhysicsState();
      const fs = makeFlightState();
      const snap = createSnapshotFromState(ps, fs, 7);

      // Position/velocity round-trip
      expect(snap.physics.posX).toBe(ps.posX);
      expect(snap.physics.posY).toBe(ps.posY);
      expect(snap.physics.velX).toBe(ps.velX);
      expect(snap.physics.velY).toBe(ps.velY);

      // Flight state round-trip
      expect(snap.flight.missionId).toBe(fs.missionId);
      expect(snap.flight.altitude).toBe(fs.altitude);
      expect(snap.flight.crewCount).toBe(fs.crewCount);
      expect(snap.flight.phase).toBe(fs.phase);
      expect(snap.frame).toBe(7);
    });
  });
});

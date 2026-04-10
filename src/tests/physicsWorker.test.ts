/**
 * physicsWorker.test.ts — Unit tests for the physics Web Worker message protocol.
 *
 * Tests cover:
 *   - Serialisation helpers: Set↔Array, Map↔Record round trips
 *   - PhysicsSnapshot round trip: serialise→deserialise preserves all fields
 *   - FlightSnapshot round trip: serialise→deserialise preserves all fields
 *   - Assembly round trip: serialise→deserialise preserves parts Map + connections
 *   - Debris round trip: serialise→deserialise preserves Sets/Maps
 *   - Protocol message type discriminators are correct
 *   - All command types are structurally valid
 */

import { describe, it, expect } from 'vitest';
import {
  mapToRecord,
  recordToMap,
  setToArray,
  arrayToSet,
} from '../core/physicsWorkerProtocol.ts';
import type {
  PhysicsSnapshot,
  FlightSnapshot,
  SerialisedAssembly,
  SerialisedStagingConfig,
  SerialisedDebrisState,
  WorkerCommand,
  WorkerMessage,
  InitCommand,
  TickCommand,
  SetThrottleCommand,
  KeyDownCommand,
  KeyUpCommand,
  SnapshotMessage,
  ErrorMessage,
} from '../core/physicsWorkerProtocol.ts';
import {
  serialisePhysicsState,
  deserialisePhysicsState,
  serialiseFlightState,
  deserialiseFlightState,
  deserialiseAssembly,
  serialiseDebris,
  deserialiseDebris,
} from '../core/physicsWorker.ts';

// ---------------------------------------------------------------------------
// Helpers: build minimal valid state objects for testing
// ---------------------------------------------------------------------------

function makePhysicsSnapshot(overrides: Partial<PhysicsSnapshot> = {}): PhysicsSnapshot {
  return {
    posX: 100,
    posY: 5000,
    velX: 10,
    velY: 200,
    angle: 0.1,
    throttle: 0.75,
    throttleMode: 'absolute',
    targetTWR: 1.5,
    firingEngines: ['engine-1', 'engine-2'],
    fuelStore: { 'tank-1': 500, 'tank-2': 300 },
    activeParts: ['engine-1', 'engine-2', 'tank-1', 'tank-2', 'cmd-1'],
    deployedParts: ['chute-1'],
    parachuteStates: {
      'chute-1': { state: 'deploying', deployTimer: 2.5, canopyAngle: 0, canopyAngularVel: 0 },
    },
    legStates: {
      'leg-1': { state: 'deployed', deployTimer: 0 },
    },
    ejectorStates: { 'cmd-1': 'armed' },
    ejectedCrewIds: [],
    ejectedCrew: [],
    instrumentStates: {},
    scienceModuleStates: {},
    heatMap: { 'cmd-1': 12.5 },
    debris: [],
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
    rcsActiveDirections: ['up'],
    dockingPortStates: {},
    weatherIspModifier: 1.0,
    weatherWindSpeed: 0,
    weatherWindAngle: 0,
    hasLaunchClamps: false,
    powerState: null,
    malfunctions: null,
    capturedBody: null,
    thrustAligned: false,
    ...overrides,
  };
}

function makeFlightSnapshot(overrides: Partial<FlightSnapshot> = {}): FlightSnapshot {
  return {
    missionId: 'mission-1',
    rocketId: 'rocket-1',
    crewIds: ['crew-a', 'crew-b'],
    crewCount: 2,
    timeElapsed: 120,
    altitude: 85000,
    velocity: 2200,
    horizontalVelocity: 0,
    fuelRemaining: 800,
    deltaVRemaining: 3500,
    events: [
      { time: 0, type: 'STAGE_SEP', description: 'Stage 1 separation' },
      { time: 60, type: 'MILESTONE', description: 'Max Q' },
    ],
    aborted: false,
    phase: 'FLIGHT',
    phaseLog: [
      { from: 'PRELAUNCH', to: 'LAUNCH', time: 0, reason: 'Engine ignition' },
      { from: 'LAUNCH', to: 'FLIGHT', time: 5, reason: 'Liftoff' },
    ],
    inOrbit: false,
    orbitalElements: null,
    bodyId: 'EARTH',
    orbitBandId: null,
    currentBiome: 'UPPER_ATMOSPHERE',
    biomesVisited: ['LAUNCH_PAD', 'LOWER_ATMOSPHERE', 'UPPER_ATMOSPHERE'],
    maxAltitude: 85000,
    maxVelocity: 2200,
    dockingState: null,
    transferState: null,
    powerState: null,
    commsState: null,
    ...overrides,
  };
}

function makeDebrisSnapshot(): SerialisedDebrisState {
  return {
    id: 'debris-1',
    activeParts: ['booster-1', 'tank-1'],
    firingEngines: ['booster-1'],
    fuelStore: { 'booster-1': 50 },
    deployedParts: [],
    parachuteStates: {},
    legStates: {},
    heatMap: { 'booster-1': 5.0 },
    posX: 50,
    posY: 3000,
    velX: -5,
    velY: -20,
    angle: 0.5,
    throttle: 1.0,
    angularVelocity: 0.1,
    isTipping: false,
    tippingContactX: 0,
    tippingContactY: 0,
    landed: false,
    crashed: false,
  };
}

function makeSerialisedAssembly(): SerialisedAssembly {
  return {
    parts: {
      'cmd-1': { instanceId: 'cmd-1', partId: 'command-pod-mk1', x: 0, y: 100 },
      'tank-1': { instanceId: 'tank-1', partId: 'fuel-tank-small', x: 0, y: 50 },
      'engine-1': { instanceId: 'engine-1', partId: 'engine-spark', x: 0, y: 0 },
    },
    connections: [
      { fromInstanceId: 'cmd-1', fromSnapIndex: 0, toInstanceId: 'tank-1', toSnapIndex: 1 },
      { fromInstanceId: 'tank-1', fromSnapIndex: 0, toInstanceId: 'engine-1', toSnapIndex: 1 },
    ],
    _nextId: 4,
    symmetryPairs: [],
  };
}

function makeStagingConfig(): SerialisedStagingConfig {
  return {
    stages: [
      { instanceIds: ['engine-1'] },
    ],
    unstaged: [],
    currentStageIdx: 0,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('physicsWorkerProtocol — serialisation helpers', () => {
  it('mapToRecord and recordToMap round trip', () => {
    const original = new Map([['a', 1], ['b', 2], ['c', 3]]);
    const record = mapToRecord(original);
    expect(record).toEqual({ a: 1, b: 2, c: 3 });

    const restored = recordToMap(record);
    expect(restored).toEqual(original);
    expect(restored.get('a')).toBe(1);
    expect(restored.get('c')).toBe(3);
  });

  it('setToArray and arrayToSet round trip', () => {
    const original = new Set(['x', 'y', 'z']);
    const arr = setToArray(original);
    expect(arr).toHaveLength(3);
    expect(arr).toContain('x');
    expect(arr).toContain('y');
    expect(arr).toContain('z');

    const restored = arrayToSet(arr);
    expect(restored).toEqual(original);
    expect(restored.has('x')).toBe(true);
  });

  it('handles empty Map', () => {
    const record = mapToRecord(new Map());
    expect(Object.keys(record)).toHaveLength(0);
    const restored = recordToMap(record);
    expect(restored.size).toBe(0);
  });

  it('handles empty Set', () => {
    const arr = setToArray(new Set());
    expect(arr).toHaveLength(0);
    const restored = arrayToSet(arr);
    expect(restored.size).toBe(0);
  });
});

describe('physicsWorkerProtocol — PhysicsSnapshot round trip', () => {
  it('serialise → deserialise preserves all fields', () => {
    const snapshot = makePhysicsSnapshot({
      firingEngines: ['engine-1'],
      debris: [makeDebrisSnapshot()],
      ejectedCrewIds: ['crew-a'],
      ejectedCrew: [{ x: 10, y: 20, velX: 1, velY: -5, chuteOpen: true, chuteTimer: 3 }],
      malfunctions: { 'engine-1': { type: 'ENGINE_REDUCED_THRUST', recovered: false } },
    });

    // Deserialise to mutable state, then serialise back.
    const mutable = deserialisePhysicsState(snapshot);
    const roundTripped = serialisePhysicsState(mutable);

    // Core numeric fields
    expect(roundTripped.posX).toBe(snapshot.posX);
    expect(roundTripped.posY).toBe(snapshot.posY);
    expect(roundTripped.velX).toBe(snapshot.velX);
    expect(roundTripped.velY).toBe(snapshot.velY);
    expect(roundTripped.angle).toBe(snapshot.angle);
    expect(roundTripped.throttle).toBe(snapshot.throttle);
    expect(roundTripped.throttleMode).toBe(snapshot.throttleMode);
    expect(roundTripped.targetTWR).toBe(snapshot.targetTWR);
    expect(roundTripped.angularVelocity).toBe(snapshot.angularVelocity);

    // Sets → arrays (order may vary, so compare as sets)
    expect(new Set(roundTripped.firingEngines)).toEqual(new Set(snapshot.firingEngines));
    expect(new Set(roundTripped.activeParts)).toEqual(new Set(snapshot.activeParts));
    expect(new Set(roundTripped.deployedParts)).toEqual(new Set(snapshot.deployedParts));
    expect(new Set(roundTripped.ejectedCrewIds)).toEqual(new Set(snapshot.ejectedCrewIds));
    expect(new Set(roundTripped.rcsActiveDirections)).toEqual(new Set(snapshot.rcsActiveDirections));

    // Maps → records
    expect(roundTripped.fuelStore).toEqual(snapshot.fuelStore);
    expect(roundTripped.heatMap).toEqual(snapshot.heatMap);
    expect(roundTripped.parachuteStates).toEqual(snapshot.parachuteStates);
    expect(roundTripped.legStates).toEqual(snapshot.legStates);
    expect(roundTripped.ejectorStates).toEqual(snapshot.ejectorStates);

    // Boolean flags
    expect(roundTripped.landed).toBe(snapshot.landed);
    expect(roundTripped.crashed).toBe(snapshot.crashed);
    expect(roundTripped.grounded).toBe(snapshot.grounded);
    expect(roundTripped.isTipping).toBe(snapshot.isTipping);
    expect(roundTripped.hasLaunchClamps).toBe(snapshot.hasLaunchClamps);

    // Ejected crew
    expect(roundTripped.ejectedCrew).toEqual(snapshot.ejectedCrew);

    // Debris (nested Sets/Maps)
    expect(roundTripped.debris).toHaveLength(1);
    expect(roundTripped.debris[0].id).toBe('debris-1');
    expect(new Set(roundTripped.debris[0].activeParts)).toEqual(new Set(snapshot.debris[0].activeParts));
    expect(roundTripped.debris[0].fuelStore).toEqual(snapshot.debris[0].fuelStore);

    // Malfunctions
    expect(roundTripped.malfunctions).toEqual(snapshot.malfunctions);
  });

  it('handles null malfunctions', () => {
    const snapshot = makePhysicsSnapshot({ malfunctions: null });
    const mutable = deserialisePhysicsState(snapshot);
    const roundTripped = serialisePhysicsState(mutable);
    expect(roundTripped.malfunctions).toBeNull();
  });

  it('handles orbital state', () => {
    const snapshot = makePhysicsSnapshot({
      baseOrbit: { semiMajorAxis: 6471000, eccentricity: 0.01, argPeriapsis: 0.5, meanAnomalyAtEpoch: 1.0, epoch: 100 },
      dockingAltitudeBand: { id: 'LEO', name: 'Low Earth Orbit', min: 200000, max: 2000000 },
    });
    const mutable = deserialisePhysicsState(snapshot);
    const roundTripped = serialisePhysicsState(mutable);
    expect(roundTripped.baseOrbit).toEqual(snapshot.baseOrbit);
    expect(roundTripped.dockingAltitudeBand).toEqual(snapshot.dockingAltitudeBand);
  });
});

describe('physicsWorkerProtocol — FlightSnapshot round trip', () => {
  it('serialise → deserialise preserves all fields', () => {
    const snapshot = makeFlightSnapshot({
      orbitalElements: {
        semiMajorAxis: 6471000,
        eccentricity: 0.005,
        argPeriapsis: 0,
        meanAnomalyAtEpoch: 0,
        epoch: 120,
      },
      inOrbit: true,
      phase: 'ORBIT',
      dockingState: {
        state: 'approaching',
        targetId: 'sat-1',
        targetDistance: 500,
        targetRelSpeed: 2.5,
        targetOriDiff: 0.1,
        targetLateral: 10,
        speedOk: true,
        orientationOk: false,
        lateralOk: true,
        dockedObjectIds: [],
        combinedMass: 0,
      },
      transferState: {
        originBodyId: 'EARTH',
        destinationBodyId: 'MOON',
        departureTime: 100,
        estimatedArrival: 300000,
        departureDV: 3100,
        captureDV: 800,
        totalDV: 3900,
        trajectoryPath: [{ x: 0, y: 0 }, { x: 100, y: 200 }],
      },
      powerState: {
        batteryCapacity: 100,
        batteryCharge: 75,
        solarGeneration: 10,
        powerDraw: 5,
        sunlit: true,
        hasPower: true,
        solarPanelArea: 4,
      },
      commsState: {
        status: 'CONNECTED',
        linkType: 'RELAY',
        canTransmit: true,
        controlLocked: false,
      },
    });

    const mutable = deserialiseFlightState(snapshot);
    const roundTripped = serialiseFlightState(mutable);

    // Core fields
    expect(roundTripped.missionId).toBe(snapshot.missionId);
    expect(roundTripped.rocketId).toBe(snapshot.rocketId);
    expect(roundTripped.crewIds).toEqual(snapshot.crewIds);
    expect(roundTripped.crewCount).toBe(snapshot.crewCount);
    expect(roundTripped.timeElapsed).toBe(snapshot.timeElapsed);
    expect(roundTripped.altitude).toBe(snapshot.altitude);
    expect(roundTripped.velocity).toBe(snapshot.velocity);
    expect(roundTripped.fuelRemaining).toBe(snapshot.fuelRemaining);
    expect(roundTripped.deltaVRemaining).toBe(snapshot.deltaVRemaining);
    expect(roundTripped.aborted).toBe(snapshot.aborted);
    expect(roundTripped.phase).toBe(snapshot.phase);
    expect(roundTripped.inOrbit).toBe(snapshot.inOrbit);
    expect(roundTripped.bodyId).toBe(snapshot.bodyId);
    expect(roundTripped.orbitBandId).toBe(snapshot.orbitBandId);
    expect(roundTripped.currentBiome).toBe(snapshot.currentBiome);
    expect(roundTripped.maxAltitude).toBe(snapshot.maxAltitude);
    expect(roundTripped.maxVelocity).toBe(snapshot.maxVelocity);

    // Arrays
    expect(roundTripped.events).toEqual(snapshot.events);
    expect(roundTripped.phaseLog).toEqual(snapshot.phaseLog);
    expect(roundTripped.biomesVisited).toEqual(snapshot.biomesVisited);

    // Nullable objects
    expect(roundTripped.orbitalElements).toEqual(snapshot.orbitalElements);
    expect(roundTripped.dockingState).toEqual(snapshot.dockingState);
    expect(roundTripped.transferState).toEqual(snapshot.transferState);
    expect(roundTripped.powerState).toEqual(snapshot.powerState);
    expect(roundTripped.commsState).toEqual(snapshot.commsState);
  });

  it('handles null nullable fields', () => {
    const snapshot = makeFlightSnapshot({
      orbitalElements: null,
      dockingState: null,
      transferState: null,
      powerState: null,
      commsState: null,
    });
    const mutable = deserialiseFlightState(snapshot);
    const roundTripped = serialiseFlightState(mutable);
    expect(roundTripped.orbitalElements).toBeNull();
    expect(roundTripped.dockingState).toBeNull();
    expect(roundTripped.transferState).toBeNull();
    expect(roundTripped.powerState).toBeNull();
    expect(roundTripped.commsState).toBeNull();
  });
});

describe('physicsWorkerProtocol — Assembly round trip', () => {
  it('deserialiseAssembly restores parts Map and connections', () => {
    const serialised = makeSerialisedAssembly();
    const assembly = deserialiseAssembly(serialised);

    expect(assembly.parts).toBeInstanceOf(Map);
    expect(assembly.parts.size).toBe(3);
    expect(assembly.parts.get('cmd-1')?.partId).toBe('command-pod-mk1');
    expect(assembly.parts.get('tank-1')?.partId).toBe('fuel-tank-small');
    expect(assembly.parts.get('engine-1')?.partId).toBe('engine-spark');

    expect(assembly.connections).toHaveLength(2);
    expect(assembly.connections[0].fromInstanceId).toBe('cmd-1');
    expect(assembly.connections[1].toInstanceId).toBe('engine-1');

    expect(assembly._nextId).toBe(4);
    expect(assembly.symmetryPairs).toEqual([]);
  });

  it('preserves symmetry pairs', () => {
    const serialised = makeSerialisedAssembly();
    serialised.symmetryPairs = [['booster-l', 'booster-r']];
    const assembly = deserialiseAssembly(serialised);
    expect(assembly.symmetryPairs).toEqual([['booster-l', 'booster-r']]);
  });
});

describe('physicsWorkerProtocol — Debris round trip', () => {
  it('serialise → deserialise preserves Sets and Maps', () => {
    const serialised = makeDebrisSnapshot();
    const mutable = deserialiseDebris(serialised);

    // Verify mutable state uses Sets and Maps
    expect(mutable.activeParts).toBeInstanceOf(Set);
    expect(mutable.activeParts.has('booster-1')).toBe(true);
    expect(mutable.firingEngines).toBeInstanceOf(Set);
    expect(mutable.firingEngines.has('booster-1')).toBe(true);
    expect(mutable.fuelStore).toBeInstanceOf(Map);
    expect(mutable.fuelStore.get('booster-1')).toBe(50);
    expect(mutable.heatMap).toBeInstanceOf(Map);
    expect(mutable.heatMap.get('booster-1')).toBe(5.0);

    // Re-serialise and check round-trip
    const reSerialized = serialiseDebris(mutable);
    expect(new Set(reSerialized.activeParts)).toEqual(new Set(serialised.activeParts));
    expect(reSerialized.fuelStore).toEqual(serialised.fuelStore);
    expect(reSerialized.heatMap).toEqual(serialised.heatMap);
    expect(reSerialized.posX).toBe(serialised.posX);
    expect(reSerialized.posY).toBe(serialised.posY);
    expect(reSerialized.angle).toBe(serialised.angle);
    expect(reSerialized.landed).toBe(serialised.landed);
    expect(reSerialized.crashed).toBe(serialised.crashed);
  });
});

describe('physicsWorkerProtocol — message type discriminators', () => {
  it('all Main→Worker command types have unique type field', () => {
    const commands: WorkerCommand[] = [
      {
        type: 'init',
        partsCatalog: [],
        bodiesCatalog: {},
        physicsState: makePhysicsSnapshot(),
        flightState: makeFlightSnapshot(),
        assembly: makeSerialisedAssembly(),
        stagingConfig: makeStagingConfig(),
      },
      { type: 'tick', realDeltaTime: 0.016, timeWarp: 1 },
      { type: 'setThrottle', throttle: 0.5 },
      { type: 'stage' },
      { type: 'abort' },
      { type: 'setTimeWarp', timeWarp: 10 },
      { type: 'keyDown', key: 'w' },
      { type: 'keyUp', key: 'w' },
      { type: 'stop' },
    ];

    const types = commands.map(c => c.type);
    // All types should be unique
    expect(new Set(types).size).toBe(types.length);
  });

  it('all Worker→Main message types have unique type field', () => {
    const messages: WorkerMessage[] = [
      {
        type: 'snapshot',
        physics: makePhysicsSnapshot(),
        flight: makeFlightSnapshot(),
        frame: 1,
        currentStageIdx: 0,
      },
      { type: 'ready' },
      { type: 'error', message: 'test error', stack: 'stack trace' },
      { type: 'stopped' },
    ];

    const types = messages.map(m => m.type);
    expect(new Set(types).size).toBe(types.length);
  });

  it('snapshot message includes frame counter', () => {
    const msg: SnapshotMessage = {
      type: 'snapshot',
      physics: makePhysicsSnapshot(),
      flight: makeFlightSnapshot(),
      frame: 42,
      currentStageIdx: 0,
    };
    expect(msg.frame).toBe(42);
    expect(msg.type).toBe('snapshot');
  });

  it('error message includes optional stack', () => {
    const withStack: ErrorMessage = { type: 'error', message: 'fail', stack: 'at line 1' };
    expect(withStack.stack).toBe('at line 1');

    const withoutStack: ErrorMessage = { type: 'error', message: 'fail' };
    expect(withoutStack.stack).toBeUndefined();
  });
});

describe('physicsWorkerProtocol — command structure validation', () => {
  it('tick command carries realDeltaTime and timeWarp', () => {
    const cmd: TickCommand = { type: 'tick', realDeltaTime: 0.016, timeWarp: 4 };
    expect(cmd.realDeltaTime).toBe(0.016);
    expect(cmd.timeWarp).toBe(4);
  });

  it('setThrottle command clamps conceptually to 0–1', () => {
    const cmd: SetThrottleCommand = { type: 'setThrottle', throttle: 0.5 };
    expect(cmd.throttle).toBe(0.5);
  });

  it('keyDown and keyUp commands carry key strings', () => {
    const down: KeyDownCommand = { type: 'keyDown', key: 'ArrowUp' };
    const up: KeyUpCommand = { type: 'keyUp', key: 'ArrowUp' };
    expect(down.key).toBe('ArrowUp');
    expect(up.key).toBe('ArrowUp');
  });

  it('init command carries all required catalogs and state', () => {
    const cmd: InitCommand = {
      type: 'init',
      partsCatalog: [{ id: 'test-part' }],
      bodiesCatalog: { EARTH: { id: 'EARTH', name: 'Earth' } },
      physicsState: makePhysicsSnapshot(),
      flightState: makeFlightSnapshot(),
      assembly: makeSerialisedAssembly(),
      stagingConfig: makeStagingConfig(),
    };
    expect(cmd.partsCatalog).toHaveLength(1);
    expect(cmd.bodiesCatalog).toHaveProperty('EARTH');
    expect(cmd.assembly.parts).toHaveProperty('cmd-1');
    expect(cmd.stagingConfig.stages).toHaveLength(1);
  });
});

describe('physicsWorkerProtocol — full snapshot round trip', () => {
  it('PhysicsSnapshot → mutable PhysicsState → PhysicsSnapshot is idempotent', () => {
    const original = makePhysicsSnapshot({
      debris: [makeDebrisSnapshot()],
      ejectedCrewIds: ['crew-x'],
      ejectedCrew: [{ x: 5, y: 10, velX: 0, velY: -3, chuteOpen: false, chuteTimer: 0 }],
      malfunctions: { 'part-a': { type: 'FUEL_TANK_LEAK', recovered: true } },
      powerState: { batteryCapacity: 200, batteryCharge: 150, solarGeneration: 20, powerDraw: 10, sunlit: true, hasPower: true, solarPanelArea: 8 },
    });

    // First round trip
    const mutable1 = deserialisePhysicsState(original);
    const snap1 = serialisePhysicsState(mutable1);

    // Second round trip (idempotency check)
    const mutable2 = deserialisePhysicsState(snap1);
    const snap2 = serialisePhysicsState(mutable2);

    // Snapshots should be deeply equal
    expect(snap2.posX).toBe(snap1.posX);
    expect(snap2.posY).toBe(snap1.posY);
    expect(snap2.fuelStore).toEqual(snap1.fuelStore);
    expect(new Set(snap2.activeParts)).toEqual(new Set(snap1.activeParts));
    expect(snap2.debris).toEqual(snap1.debris);
    expect(snap2.malfunctions).toEqual(snap1.malfunctions);
    expect(snap2.powerState).toEqual(snap1.powerState);
    expect(snap2.ejectedCrew).toEqual(snap1.ejectedCrew);
  });

  it('FlightSnapshot → mutable FlightState → FlightSnapshot is idempotent', () => {
    const original = makeFlightSnapshot({
      orbitalElements: { semiMajorAxis: 7000000, eccentricity: 0.1, argPeriapsis: 0.3, meanAnomalyAtEpoch: 1.5, epoch: 200 },
      events: [{ time: 10, type: 'TEST', description: 'test event' }],
      phaseLog: [{ from: 'PRELAUNCH', to: 'LAUNCH', time: 0, reason: 'go' }],
    });

    const mutable1 = deserialiseFlightState(original);
    const snap1 = serialiseFlightState(mutable1);

    const mutable2 = deserialiseFlightState(snap1);
    const snap2 = serialiseFlightState(mutable2);

    expect(snap2).toEqual(snap1);
  });
});

/**
 * snapshotFactory.ts — Converts mutable physics/flight state into a
 * MainThreadSnapshot for the main-thread fallback path.
 *
 * When the Web Worker is disabled or unavailable, physics runs on the main
 * thread via tick().  This factory produces the same readonly snapshot type
 * that the worker path provides, so render/UI code has a single code path
 * regardless of worker vs. main-thread physics.
 *
 * @module core/snapshotFactory
 */

import { mapToRecord, setToArray } from './physicsWorkerProtocol.ts';

import type { PhysicsState } from './physics.ts';
import type { FlightState } from './gameState.ts';
import type {
  MainThreadSnapshot,
  ReadonlyPhysicsSnapshot,
  ReadonlyFlightSnapshot,
  SerialisedParachuteEntry,
  SerialisedDebrisState,
} from './physicsWorkerProtocol.ts';

/**
 * Convert mutable PhysicsState + FlightState into a MainThreadSnapshot.
 *
 * Sets and Maps are converted to arrays and records (structured-clone-safe
 * forms).  Control inputs (throttle, throttleMode, targetTWR, angle) are
 * omitted — they remain main-thread authority.
 *
 * @param ps    Mutable physics state (from tick())
 * @param fs    Mutable flight state
 * @param frame Monotonic frame counter
 */
export function createSnapshotFromState(
  ps: PhysicsState,
  fs: FlightState,
  frame: number,
): MainThreadSnapshot {
  return {
    physics: _serialisePhysics(ps),
    flight: _serialiseFlight(fs),
    frame,
  };
}

// ---------------------------------------------------------------------------
// Internal serialisation helpers
// ---------------------------------------------------------------------------

function _serialisePhysics(ps: PhysicsState): ReadonlyPhysicsSnapshot {
  return {
    posX: ps.posX,
    posY: ps.posY,
    velX: ps.velX,
    velY: ps.velY,
    // Control inputs omitted: throttle, throttleMode, targetTWR, angle
    firingEngines: setToArray(ps.firingEngines),
    fuelStore: mapToRecord(ps.fuelStore),
    activeParts: setToArray(ps.activeParts),
    deployedParts: setToArray(ps.deployedParts),
    parachuteStates: mapToRecord(ps.parachuteStates) as Record<string, SerialisedParachuteEntry>,
    legStates: mapToRecord(ps.legStates),
    ejectorStates: mapToRecord(ps.ejectorStates),
    ejectedCrewIds: setToArray(ps.ejectedCrewIds),
    ejectedCrew: ps.ejectedCrew.map(e => ({
      x: e.x, y: e.y, velX: e.velX, velY: e.velY,
      chuteOpen: e.chuteOpen, chuteTimer: e.chuteTimer,
    })),
    instrumentStates: mapToRecord(ps.instrumentStates) as Record<string, unknown>,
    scienceModuleStates: mapToRecord(ps.scienceModuleStates) as Record<string, unknown>,
    heatMap: mapToRecord(ps.heatMap),
    debris: ps.debris.map(_serialiseDebris),
    landed: ps.landed,
    crashed: ps.crashed,
    grounded: ps.grounded,
    angularVelocity: ps.angularVelocity,
    isTipping: ps.isTipping,
    tippingContactX: ps.tippingContactX,
    tippingContactY: ps.tippingContactY,
    controlMode: ps.controlMode,
    baseOrbit: ps.baseOrbit,
    dockingAltitudeBand: ps.dockingAltitudeBand,
    dockingOffsetAlongTrack: ps.dockingOffsetAlongTrack,
    dockingOffsetRadial: ps.dockingOffsetRadial,
    rcsActiveDirections: setToArray(ps.rcsActiveDirections),
    dockingPortStates: mapToRecord(ps.dockingPortStates),
    weatherIspModifier: ps.weatherIspModifier,
    hasLaunchClamps: ps.hasLaunchClamps,
    powerState: ps.powerState,
    malfunctions: ps.malfunctions
      ? mapToRecord(ps.malfunctions) as ReadonlyPhysicsSnapshot['malfunctions']
      : null,
  };
}

/** Serialise a single debris fragment (Sets → arrays, Maps → records). */
function _serialiseDebris(d: PhysicsState['debris'][number]): SerialisedDebrisState {
  return {
    id: d.id,
    activeParts: setToArray(d.activeParts),
    firingEngines: setToArray(d.firingEngines),
    fuelStore: mapToRecord(d.fuelStore),
    deployedParts: setToArray(d.deployedParts),
    parachuteStates: mapToRecord(d.parachuteStates) as Record<string, SerialisedParachuteEntry>,
    legStates: mapToRecord(d.legStates),
    heatMap: mapToRecord(d.heatMap),
    posX: d.posX,
    posY: d.posY,
    velX: d.velX,
    velY: d.velY,
    angle: d.angle,
    throttle: d.throttle,
    angularVelocity: d.angularVelocity,
    isTipping: d.isTipping,
    tippingContactX: d.tippingContactX,
    tippingContactY: d.tippingContactY,
    landed: d.landed,
    crashed: d.crashed,
  };
}

function _serialiseFlight(fs: FlightState): ReadonlyFlightSnapshot {
  return {
    missionId: fs.missionId,
    rocketId: fs.rocketId,
    crewIds: [...fs.crewIds],
    crewCount: fs.crewCount,
    timeElapsed: fs.timeElapsed,
    altitude: fs.altitude,
    velocity: fs.velocity,
    fuelRemaining: fs.fuelRemaining,
    deltaVRemaining: fs.deltaVRemaining,
    events: fs.events.map(e => ({ ...e })),
    aborted: fs.aborted,
    phase: fs.phase,
    phaseLog: fs.phaseLog.map(p => ({ ...p })),
    inOrbit: fs.inOrbit,
    orbitalElements: fs.orbitalElements ? { ...fs.orbitalElements } : null,
    bodyId: fs.bodyId,
    orbitBandId: fs.orbitBandId,
    currentBiome: fs.currentBiome,
    biomesVisited: [...fs.biomesVisited],
    maxAltitude: fs.maxAltitude,
    maxVelocity: fs.maxVelocity,
    dockingState: fs.dockingState ? { ...fs.dockingState } : null,
    transferState: fs.transferState ? { ...fs.transferState } : null,
    powerState: fs.powerState ? { ...fs.powerState } : null,
    commsState: fs.commsState ? { ...fs.commsState } : null,
  };
}

/**
 * grabbing.js — Grabbing arm system for satellite repair and servicing.
 *
 * Handles the full grab lifecycle:
 *   1. Target selection — player selects a satellite within visual range.
 *   2. Approach — guidance shows distance, speed, lateral offset.
 *   3. Extending — arm reaches out when within GRAB_ARM_RANGE.
 *   4. Grabbed — craft attached to satellite; repair/service actions available.
 *   5. Release — arm retracts and satellite is freed.
 *
 * The grabbing arm is distinct from docking: it targets SATELLITE-type orbital
 * objects (which cannot dock) and has looser alignment requirements.  The
 * primary use case is restoring satellite health to 100.
 *
 * ARCHITECTURE RULE: pure game logic — no DOM, no canvas.
 * Reads/mutates FlightState and GameState only.
 *
 * @module core/grabbing
 */

import {
  GrabState,
  PartType,
  OrbitalObjectType,
  GRAB_VISUAL_RANGE_DEG,
  GRAB_GUIDANCE_RANGE,
  GRAB_ARM_RANGE,
  GRAB_MAX_RELATIVE_SPEED,
  GRAB_MAX_LATERAL_OFFSET,
  GRAB_REPAIR_HEALTH,
  GRAB_RELEASE_SPEED,
  BODY_RADIUS,
} from './constants.js';

import {
  getOrbitalStateAtTime,
  angularDistance,
  getAltitudeBand,
} from './orbit.js';

import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Grab state type (JSDoc)
// ---------------------------------------------------------------------------

/**
 * Persistent grabbing arm state carried on the FlightState.
 * @typedef {Object} GrabSystemState
 * @property {string}      state           GrabState enum value.
 * @property {string|null}  targetId        ID of the targeted OrbitalObject (satellite), or null.
 * @property {number}       targetDistance   Distance to target (m).
 * @property {number}       targetRelSpeed   Relative speed to target (m/s).
 * @property {number}       targetLateral    Lateral offset (m).
 * @property {boolean}      speedOk          True when relative speed is acceptable.
 * @property {boolean}      lateralOk        True when lateral offset is acceptable.
 * @property {boolean}      inRange          True when within arm reach.
 * @property {string|null}  grabbedSatelliteId  The satellite record ID when grabbed, or null.
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fresh grab system state.
 * @returns {GrabSystemState}
 */
export function createGrabState() {
  return {
    state: GrabState.IDLE,
    targetId: null,
    targetDistance: Infinity,
    targetRelSpeed: 0,
    targetLateral: 0,
    speedOk: false,
    lateralOk: false,
    inRange: false,
    grabbedSatelliteId: null,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Check whether the craft has at least one grabbing arm among its active parts.
 *
 * @param {import('./physics.js').PhysicsState}        ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {boolean}
 */
export function hasGrabbingArm(ps, assembly) {
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.GRABBING_ARM) return true;
  }
  return false;
}

/**
 * Get all grabbing arm instances on the craft.
 *
 * @param {import('./physics.js').PhysicsState}        ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {Array<{instanceId: string, partDef: Object}>}
 */
export function getGrabbingArms(ps, assembly) {
  const arms = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.GRABBING_ARM) {
      arms.push({ instanceId, partDef: def });
    }
  }
  return arms;
}

/**
 * Find satellites within visual range of the craft that can be grabbed.
 *
 * Only targets SATELLITE-type orbital objects (not CRAFT or STATION).
 *
 * @param {import('./physics.js').PhysicsState}   ps
 * @param {import('./gameState.js').FlightState}  flightState
 * @param {import('./gameState.js').GameState}    state
 * @returns {Array<{object: Object, distance: number, angularDist: number, satelliteRecord: Object|null}>}
 */
export function getGrabTargetsInRange(ps, flightState, state) {
  if (!flightState.inOrbit || !flightState.orbitalElements) return [];

  const bodyId = flightState.bodyId;
  const t = flightState.timeElapsed;
  const craftState = getOrbitalStateAtTime(flightState.orbitalElements, t, bodyId);

  const results = [];
  for (const obj of state.orbitalObjects) {
    if (obj.bodyId !== bodyId) continue;
    if (obj.type !== OrbitalObjectType.SATELLITE) continue;

    const objState = getOrbitalStateAtTime(obj.elements, t, bodyId);
    const angleDist = angularDistance(craftState.angularPositionDeg, objState.angularPositionDeg);

    if (angleDist < GRAB_VISUAL_RANGE_DEG) {
      const craftBand = getAltitudeBand(craftState.altitude, bodyId);
      const objBand = getAltitudeBand(objState.altitude, bodyId);

      if (craftBand && objBand && craftBand.id === objBand.id) {
        const R = BODY_RADIUS[bodyId];
        const avgAlt = (craftState.altitude + objState.altitude) / 2;
        const arcDist = (angleDist * Math.PI / 180) * (R + avgAlt);
        const altDist = Math.abs(craftState.altitude - objState.altitude);
        const dist = Math.sqrt(arcDist * arcDist + altDist * altDist);

        // Find the matching satellite record.
        const satRecord = (state.satelliteNetwork?.satellites ?? []).find(
          (s) => s.orbitalObjectId === obj.id && s.health > 0,
        ) ?? null;

        results.push({ object: obj, distance: dist, angularDist: angleDist, satelliteRecord: satRecord });
      }
    }
  }

  results.sort((a, b) => a.distance - b.distance);
  return results;
}

/**
 * Check whether a target orbital object can be grabbed.
 * Only SATELLITE-type objects can be grabbed.
 *
 * @param {Object} targetObj  OrbitalObject.
 * @returns {boolean}
 */
export function canGrab(targetObj) {
  return targetObj.type === OrbitalObjectType.SATELLITE;
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

/**
 * Select a satellite target for the grabbing arm.
 *
 * @param {GrabSystemState}                            grabState
 * @param {string}                                     targetId  OrbitalObject ID.
 * @param {import('./physics.js').PhysicsState}        ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {{ success: boolean, reason?: string }}
 */
export function selectGrabTarget(grabState, targetId, ps, assembly) {
  if (!hasGrabbingArm(ps, assembly)) {
    return { success: false, reason: 'No grabbing arm on craft' };
  }
  if (grabState.state === GrabState.GRABBED) {
    return { success: false, reason: 'Already grabbed a satellite' };
  }

  grabState.targetId = targetId;
  grabState.state = GrabState.APPROACHING;
  return { success: true };
}

/**
 * Clear the grab target and reset to IDLE.
 *
 * @param {GrabSystemState} grabState
 */
export function clearGrabTarget(grabState) {
  grabState.targetId = null;
  grabState.state = GrabState.IDLE;
  grabState.targetDistance = Infinity;
  grabState.targetRelSpeed = 0;
  grabState.targetLateral = 0;
  grabState.speedOk = false;
  grabState.lateralOk = false;
  grabState.inRange = false;
  grabState.grabbedSatelliteId = null;
}

// ---------------------------------------------------------------------------
// State machine update (called per frame during orbit)
// ---------------------------------------------------------------------------

/**
 * Update the grabbing arm state machine.
 *
 * Should be called once per physics tick when the craft is in orbit
 * and a grab target is selected or the arm is in an active state.
 *
 * @param {GrabSystemState}                           grabState
 * @param {import('./physics.js').PhysicsState}       ps
 * @param {import('./gameState.js').FlightState}      flightState
 * @param {import('./gameState.js').GameState}        state
 */
export function updateGrabState(grabState, ps, flightState, state) {
  if (grabState.state === GrabState.IDLE) return;
  if (grabState.state === GrabState.GRABBED) return; // Stable — no updates needed.

  if (!grabState.targetId) {
    clearGrabTarget(grabState);
    return;
  }

  // Find the target orbital object.
  const target = state.orbitalObjects.find((o) => o.id === grabState.targetId);
  if (!target) {
    clearGrabTarget(grabState);
    return;
  }

  const bodyId = flightState.bodyId;
  const t = flightState.timeElapsed;
  const craftOrbState = getOrbitalStateAtTime(flightState.orbitalElements, t, bodyId);
  const targetOrbState = getOrbitalStateAtTime(target.elements, t, bodyId);

  // Compute distance.
  const R = BODY_RADIUS[bodyId];
  const angleDist = angularDistance(craftOrbState.angularPositionDeg, targetOrbState.angularPositionDeg);
  const avgAlt = (craftOrbState.altitude + targetOrbState.altitude) / 2;
  const arcDist = (angleDist * Math.PI / 180) * (R + avgAlt);
  const altDist = Math.abs(craftOrbState.altitude - targetOrbState.altitude);
  const dist = Math.sqrt(arcDist * arcDist + altDist * altDist);

  // Approximate relative speed from orbital velocity differences.
  const relSpeed = Math.abs((craftOrbState.velocity ?? 0) - (targetOrbState.velocity ?? 0));

  // Lateral offset approximation.
  const lateral = altDist;

  grabState.targetDistance = dist;
  grabState.targetRelSpeed = relSpeed;
  grabState.targetLateral = lateral;
  grabState.speedOk = relSpeed <= GRAB_MAX_RELATIVE_SPEED;
  grabState.lateralOk = lateral <= GRAB_MAX_LATERAL_OFFSET;
  grabState.inRange = dist <= GRAB_ARM_RANGE;

  // State transitions.
  switch (grabState.state) {
    case GrabState.APPROACHING:
      if (dist <= GRAB_GUIDANCE_RANGE) {
        // Stay in approaching until within arm range with good alignment.
        if (grabState.inRange && grabState.speedOk && grabState.lateralOk) {
          grabState.state = GrabState.EXTENDING;
        }
      }
      break;

    case GrabState.EXTENDING:
      // If conditions degrade, fall back to approaching.
      if (!grabState.inRange || !grabState.speedOk) {
        grabState.state = GrabState.APPROACHING;
        break;
      }
      // Arm grabs — transition to GRABBED.
      _completeGrab(grabState, target, state);
      break;

    case GrabState.RELEASING:
      clearGrabTarget(grabState);
      break;
  }
}

/**
 * Complete the grab — attach craft to satellite.
 *
 * @param {GrabSystemState} grabState
 * @param {Object}          target    OrbitalObject of the satellite.
 * @param {import('./gameState.js').GameState} state
 */
function _completeGrab(grabState, target, state) {
  // Find the satellite record linked to this orbital object.
  const satRecord = (state.satelliteNetwork?.satellites ?? []).find(
    (s) => s.orbitalObjectId === target.id && s.health > 0,
  );

  grabState.state = GrabState.GRABBED;
  grabState.grabbedSatelliteId = satRecord ? satRecord.id : null;
}

// ---------------------------------------------------------------------------
// Actions while grabbed
// ---------------------------------------------------------------------------

/**
 * Repair the currently grabbed satellite, restoring it to full health.
 *
 * Can only be called when the arm is in GRABBED state.
 *
 * @param {GrabSystemState}                       grabState
 * @param {import('./gameState.js').GameState}    state
 * @returns {{ success: boolean, reason?: string, healthBefore?: number }}
 */
export function repairGrabbedSatellite(grabState, state) {
  if (grabState.state !== GrabState.GRABBED) {
    return { success: false, reason: 'Arm is not grabbing a satellite.' };
  }
  if (!grabState.grabbedSatelliteId) {
    return { success: false, reason: 'No satellite record attached.' };
  }

  const sat = (state.satelliteNetwork?.satellites ?? []).find(
    (s) => s.id === grabState.grabbedSatelliteId,
  );
  if (!sat) {
    return { success: false, reason: 'Satellite record not found.' };
  }
  if (sat.health <= 0) {
    return { success: false, reason: 'Satellite is decommissioned and cannot be repaired.' };
  }

  const healthBefore = sat.health;
  sat.health = Math.min(100, sat.health + GRAB_REPAIR_HEALTH);

  return { success: true, healthBefore };
}

/**
 * Release the currently grabbed satellite.
 *
 * @param {GrabSystemState} grabState
 * @returns {{ success: boolean, reason?: string }}
 */
export function releaseGrabbedSatellite(grabState) {
  if (grabState.state !== GrabState.GRABBED) {
    return { success: false, reason: 'Arm is not grabbing a satellite.' };
  }

  grabState.state = GrabState.RELEASING;
  grabState.grabbedSatelliteId = null;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Flight event integration
// ---------------------------------------------------------------------------

/**
 * Process grabbing arm events from a completed flight.
 *
 * Scans for SATELLITE_REPAIRED events in the flight log and applies
 * health restoration to the corresponding satellite records.
 *
 * Called from processFlightReturn() or similar end-of-flight hook.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState|null} flightState
 * @returns {Array<{satelliteId: string, healthBefore: number}>}
 */
export function processGrabRepairsFromFlight(state, flightState) {
  if (!flightState) return [];
  if (!state.satelliteNetwork) return [];

  const repaired = [];
  const repairEvents = (flightState.events ?? []).filter(
    (e) => e.type === 'SATELLITE_REPAIRED',
  );

  for (const event of repairEvents) {
    const satId = event.satelliteId;
    if (!satId) continue;

    const sat = state.satelliteNetwork.satellites.find((s) => s.id === satId);
    if (!sat || sat.health <= 0) continue;

    const healthBefore = sat.health;
    sat.health = Math.min(100, sat.health + GRAB_REPAIR_HEALTH);
    repaired.push({ satelliteId: satId, healthBefore });
  }

  return repaired;
}

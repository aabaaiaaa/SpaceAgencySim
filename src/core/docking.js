/**
 * docking.js — Docking system for connecting vessels in orbit.
 *
 * Handles the full docking lifecycle:
 *   1. Target selection — player selects an orbital object within visual range.
 *   2. Approach — docking guidance screen shows distance, speed, orientation.
 *   3. Alignment — indicators turn green when each parameter is acceptable.
 *   4. Final approach — automatic docking in the last metres.
 *   5. Docked — vessels share combined centre of mass; camera transitions smoothly.
 *   6. Undocking — ports disengage, command module/probe determines control.
 *
 * Enables: orbital assembly, crew transfer, fuel transfer, refuelling from depots.
 * No limit on the number of docked craft.
 *
 * ARCHITECTURE RULE: pure game logic — no DOM, no canvas.
 * Reads/mutates PhysicsState, FlightState, and GameState only.
 *
 * @module core/docking
 */

import {
  DockingState,
  PartType,
  ControlMode,
  OrbitalObjectType,
  DOCKING_VISUAL_RANGE_DEG,
  DOCKING_GUIDANCE_RANGE,
  DOCKING_AUTO_RANGE,
  DOCKING_MAX_RELATIVE_SPEED,
  DOCKING_MAX_ORIENTATION_DIFF,
  DOCKING_MAX_LATERAL_OFFSET,
  DOCKING_AUTO_APPROACH_SPEED,
  UNDOCKING_SEPARATION_SPEED,
  BODY_RADIUS,
} from './constants.js';

import {
  getOrbitalStateAtTime,
  checkProximity,
  angularDistance,
  computeOrbitalElements,
  getAltitudeBand,
} from './orbit.js';

import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Docking state type (JSDoc)
// ---------------------------------------------------------------------------

/**
 * Persistent docking state carried on the FlightState.
 * @typedef {Object} DockingSystemState
 * @property {string}       state            DockingState enum value.
 * @property {string|null}  targetId         ID of the targeted OrbitalObject, or null.
 * @property {number}       targetDistance    Distance to target (m).
 * @property {number}       targetRelSpeed   Relative speed to target (m/s).
 * @property {number}       targetOriDiff    Orientation difference (radians).
 * @property {number}       targetLateral    Lateral offset (m).
 * @property {boolean}      speedOk          True when relative speed is acceptable.
 * @property {boolean}      orientationOk    True when orientation is aligned.
 * @property {boolean}      lateralOk        True when lateral offset is acceptable.
 * @property {string[]}     dockedObjectIds  IDs of all currently docked OrbitalObjects.
 * @property {number}       combinedMass     Total mass of docked assembly (kg).
 */

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a fresh docking system state.
 * @returns {DockingSystemState}
 */
export function createDockingState() {
  return {
    state: DockingState.IDLE,
    targetId: null,
    targetDistance: Infinity,
    targetRelSpeed: 0,
    targetOriDiff: 0,
    targetLateral: 0,
    speedOk: false,
    orientationOk: false,
    lateralOk: false,
    dockedObjectIds: [],
    combinedMass: 0,
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Check whether the craft has at least one docking port among its active parts.
 *
 * @param {import('./physics.js').PhysicsState}        ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {boolean}
 */
export function hasDockingPort(ps, assembly) {
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.DOCKING_PORT) return true;
  }
  return false;
}

/**
 * Get all docking port instances on the craft.
 *
 * @param {import('./physics.js').PhysicsState}        ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {Array<{instanceId: string, partDef: Object}>}
 */
export function getDockingPorts(ps, assembly) {
  const ports = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.DOCKING_PORT) {
      ports.push({ instanceId, partDef: def });
    }
  }
  return ports;
}

/**
 * Find orbital objects within visual range of the craft.
 * Visual range = angular distance < DOCKING_VISUAL_RANGE_DEG and same altitude band.
 *
 * @param {import('./physics.js').PhysicsState}   ps
 * @param {import('./gameState.js').FlightState}  flightState
 * @param {import('./gameState.js').GameState}    state
 * @returns {Array<{object: Object, distance: number, angularDist: number}>}
 */
export function getTargetsInVisualRange(ps, flightState, state) {
  if (!flightState.inOrbit || !flightState.orbitalElements) return [];

  const bodyId = flightState.bodyId;
  const t = flightState.timeElapsed;
  const craftState = getOrbitalStateAtTime(flightState.orbitalElements, t, bodyId);

  const results = [];
  for (const obj of state.orbitalObjects) {
    if (obj.bodyId !== bodyId) continue;

    const objState = getOrbitalStateAtTime(obj.elements, t, bodyId);
    const angleDist = angularDistance(craftState.angularPositionDeg, objState.angularPositionDeg);

    if (angleDist < DOCKING_VISUAL_RANGE_DEG) {
      const craftBand = getAltitudeBand(craftState.altitude, bodyId);
      const objBand = getAltitudeBand(objState.altitude, bodyId);

      if (craftBand && objBand && craftBand.id === objBand.id) {
        // Approximate distance in metres from angular and altitude differences.
        const R = BODY_RADIUS[bodyId];
        const avgAlt = (craftState.altitude + objState.altitude) / 2;
        const arcDist = (angleDist * Math.PI / 180) * (R + avgAlt);
        const altDist = Math.abs(craftState.altitude - objState.altitude);
        const dist = Math.sqrt(arcDist * arcDist + altDist * altDist);

        results.push({ object: obj, distance: dist, angularDist: angleDist });
      }
    }
  }

  // Sort by distance (closest first).
  results.sort((a, b) => a.distance - b.distance);
  return results;
}

/**
 * Check whether a target object has a compatible docking port.
 * For orbital objects that are CRAFT or STATION type, we assume they have
 * compatible docking ports. For SATELLITE/DEBRIS, docking is not possible
 * unless they are a STATION.
 *
 * @param {Object} targetObj  OrbitalObject.
 * @returns {boolean}
 */
export function canDockWith(targetObj) {
  return targetObj.type === OrbitalObjectType.CRAFT ||
         targetObj.type === OrbitalObjectType.STATION;
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

/**
 * Select a docking target.
 *
 * @param {DockingSystemState}                         dockingState
 * @param {string}                                     targetId
 * @param {import('./physics.js').PhysicsState}        ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @returns {{ success: boolean, reason?: string }}
 */
export function selectDockingTarget(dockingState, targetId, ps, assembly) {
  if (!hasDockingPort(ps, assembly)) {
    return { success: false, reason: 'No docking port on craft' };
  }
  if (dockingState.state === DockingState.DOCKED) {
    return { success: false, reason: 'Already docked' };
  }

  dockingState.targetId = targetId;
  dockingState.state = DockingState.APPROACHING;
  return { success: true };
}

/**
 * Clear the docking target and reset to IDLE.
 *
 * @param {DockingSystemState} dockingState
 */
export function clearDockingTarget(dockingState) {
  dockingState.targetId = null;
  dockingState.state = DockingState.IDLE;
  dockingState.targetDistance = Infinity;
  dockingState.targetRelSpeed = 0;
  dockingState.targetOriDiff = 0;
  dockingState.targetLateral = 0;
  dockingState.speedOk = false;
  dockingState.orientationOk = false;
  dockingState.lateralOk = false;
}

// ---------------------------------------------------------------------------
// Docking guidance tick
// ---------------------------------------------------------------------------

/**
 * Update docking guidance parameters each frame.
 * Computes distance, relative speed, orientation difference, and lateral offset
 * between the craft and the target. Transitions through APPROACHING → ALIGNING
 * → FINAL_APPROACH → DOCKED states.
 *
 * @param {DockingSystemState}                          dockingState
 * @param {import('./physics.js').PhysicsState}         ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {import('./gameState.js').FlightState}        flightState
 * @param {import('./gameState.js').GameState}          state
 * @param {number}                                      dt  Time step (seconds).
 * @returns {{ docked: boolean, event?: string }}
 */
export function tickDocking(dockingState, ps, assembly, flightState, state, dt) {
  if (dockingState.state === DockingState.IDLE ||
      dockingState.state === DockingState.DOCKED) {
    return { docked: false };
  }

  const targetId = dockingState.targetId;
  if (!targetId) {
    dockingState.state = DockingState.IDLE;
    return { docked: false };
  }

  const targetObj = state.orbitalObjects.find(o => o.id === targetId);
  if (!targetObj) {
    clearDockingTarget(dockingState);
    return { docked: false };
  }

  const bodyId = flightState.bodyId;
  const t = flightState.timeElapsed;

  // Get craft and target orbital states.
  const craftElements = flightState.orbitalElements;
  if (!craftElements) {
    clearDockingTarget(dockingState);
    return { docked: false };
  }

  const craftOrbState = getOrbitalStateAtTime(craftElements, t, bodyId);
  const targetOrbState = getOrbitalStateAtTime(targetObj.elements, t, bodyId);

  // Calculate relative parameters.
  const R = BODY_RADIUS[bodyId];
  const angleDist = angularDistance(craftOrbState.angularPositionDeg, targetOrbState.angularPositionDeg);
  const avgAlt = (craftOrbState.altitude + targetOrbState.altitude) / 2;

  // Along-track distance (arc along orbit).
  const alongTrackDist = (angleDist * Math.PI / 180) * (R + avgAlt);

  // Radial distance (altitude difference).
  const radialDist = targetOrbState.altitude - craftOrbState.altitude;

  // Total distance.
  const distance = Math.sqrt(alongTrackDist * alongTrackDist + radialDist * radialDist);

  // In docking mode, use docking offsets for more precise distance.
  let effectiveDistance = distance;
  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    // Use docking offsets to refine the relative position.
    const dAlongTrack = alongTrackDist - ps.dockingOffsetAlongTrack;
    const dRadial = radialDist - ps.dockingOffsetRadial;
    effectiveDistance = Math.sqrt(dAlongTrack * dAlongTrack + dRadial * dRadial);
  }

  // Estimate relative speed from frame-to-frame distance change.
  const prevDist = dockingState.targetDistance;
  const relSpeed = prevDist < Infinity ? Math.abs(effectiveDistance - prevDist) / Math.max(dt, 1 / 60) : 0;

  // Orientation difference (simplified: angle between craft heading and dock axis).
  // In a 2D game, this is the absolute angle of the craft (0 = up = pointing radially out).
  // Target is assumed to have its docking port facing the craft.
  const oriDiff = Math.abs(ps.angle % (2 * Math.PI));
  const normalizedOriDiff = oriDiff > Math.PI ? 2 * Math.PI - oriDiff : oriDiff;

  // Lateral offset = component of relative position perpendicular to approach axis.
  const lateralOffset = Math.abs(radialDist) < Math.abs(alongTrackDist)
    ? Math.abs(radialDist)
    : Math.abs(alongTrackDist);

  // Update docking state.
  dockingState.targetDistance = effectiveDistance;
  dockingState.targetRelSpeed = relSpeed;
  dockingState.targetOriDiff = normalizedOriDiff;
  dockingState.targetLateral = lateralOffset;
  dockingState.speedOk = relSpeed <= DOCKING_MAX_RELATIVE_SPEED;
  dockingState.orientationOk = normalizedOriDiff <= DOCKING_MAX_ORIENTATION_DIFF;
  dockingState.lateralOk = lateralOffset <= DOCKING_MAX_LATERAL_OFFSET;

  // State transitions.
  if (dockingState.state === DockingState.APPROACHING) {
    if (effectiveDistance <= DOCKING_GUIDANCE_RANGE) {
      dockingState.state = DockingState.ALIGNING;
    }
  }

  if (dockingState.state === DockingState.ALIGNING) {
    if (effectiveDistance > DOCKING_GUIDANCE_RANGE * 1.5) {
      // Drifted too far — back to approaching.
      dockingState.state = DockingState.APPROACHING;
    } else if (effectiveDistance <= DOCKING_AUTO_RANGE &&
               dockingState.speedOk &&
               dockingState.orientationOk &&
               dockingState.lateralOk) {
      dockingState.state = DockingState.FINAL_APPROACH;
    }
  }

  if (dockingState.state === DockingState.FINAL_APPROACH) {
    if (effectiveDistance > DOCKING_AUTO_RANGE * 2) {
      // Auto-dock abort — moved away.
      dockingState.state = DockingState.ALIGNING;
      return { docked: false, event: 'AUTO_DOCK_ABORT' };
    }

    // Automatic approach — gently reduce distance.
    if (effectiveDistance > 1) {
      // Apply auto-approach movement toward target.
      const approachStep = DOCKING_AUTO_APPROACH_SPEED * dt;
      if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
        // Move docking offsets toward target.
        const ratio = Math.min(1, approachStep / effectiveDistance);
        ps.dockingOffsetAlongTrack += (alongTrackDist - ps.dockingOffsetAlongTrack) * ratio;
        ps.dockingOffsetRadial += (radialDist - ps.dockingOffsetRadial) * ratio;
      }
    } else {
      // Docking complete!
      return _completeDocking(dockingState, ps, assembly, flightState, state, targetObj);
    }
  }

  return { docked: false };
}

// ---------------------------------------------------------------------------
// Docking completion
// ---------------------------------------------------------------------------

/**
 * Complete the docking procedure — merge the vessels.
 *
 * @param {DockingSystemState}  dockingState
 * @param {Object}              ps
 * @param {Object}              assembly
 * @param {Object}              flightState
 * @param {Object}              state
 * @param {Object}              targetObj
 * @returns {{ docked: boolean, event: string }}
 */
function _completeDocking(dockingState, ps, assembly, flightState, state, targetObj) {
  dockingState.state = DockingState.DOCKED;
  dockingState.targetDistance = 0;
  dockingState.targetRelSpeed = 0;
  dockingState.speedOk = true;
  dockingState.orientationOk = true;
  dockingState.lateralOk = true;

  // Add target to docked list.
  if (!dockingState.dockedObjectIds.includes(targetObj.id)) {
    dockingState.dockedObjectIds.push(targetObj.id);
  }

  // Calculate combined mass.
  dockingState.combinedMass = _calculateCombinedMass(ps, assembly, dockingState, state);

  // Remove the target from free orbital objects (it's now part of this vessel).
  const idx = state.orbitalObjects.findIndex(o => o.id === targetObj.id);
  if (idx >= 0) {
    state.orbitalObjects.splice(idx, 1);
  }

  // Log the docking event.
  flightState.events.push({
    time: flightState.timeElapsed,
    type: 'DOCKING_COMPLETE',
    description: `Docked with ${targetObj.name}`,
  });

  return { docked: true, event: 'DOCKING_COMPLETE' };
}

/**
 * Calculate the combined mass of the craft and all docked objects.
 *
 * @param {Object} ps
 * @param {Object} assembly
 * @param {DockingSystemState} dockingState
 * @param {Object} state
 * @returns {number}  Total mass in kg.
 */
function _calculateCombinedMass(ps, assembly, dockingState, state) {
  // Craft mass = sum of active parts' dry mass + remaining fuel.
  let craftMass = 0;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def) craftMass += def.mass;
  }
  for (const [, fuel] of ps.fuelStore) {
    craftMass += fuel;
  }

  // Add estimated mass for each docked object.
  // Docked objects are simplified — assume a base mass per type.
  let dockedMass = 0;
  for (const dockedId of dockingState.dockedObjectIds) {
    // Check satellites for known mass.
    const satRecord = state.satelliteNetwork?.satellites?.find(
      s => s.orbitalObjectId === dockedId
    );
    if (satRecord) {
      const satDef = getPartById(satRecord.partId);
      dockedMass += satDef ? satDef.mass : 500;
    } else {
      // Default mass for generic craft/station.
      dockedMass += 2000;
    }
  }

  return craftMass + dockedMass;
}

// ---------------------------------------------------------------------------
// Undocking
// ---------------------------------------------------------------------------

/**
 * Undock from a specific docked object (or the last docked if no ID given).
 * The undocked object is placed back into a nearby orbit as a free orbital object.
 * Control goes to the vessel with the command module / probe core.
 *
 * @param {DockingSystemState}  dockingState
 * @param {import('./physics.js').PhysicsState}         ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {import('./gameState.js').FlightState}        flightState
 * @param {import('./gameState.js').GameState}          state
 * @param {string}              [undockTargetId]  ID of the object to undock, or null for last.
 * @returns {{ success: boolean, reason?: string, undockedObjectId?: string }}
 */
export function undock(dockingState, ps, assembly, flightState, state, undockTargetId) {
  if (dockingState.state !== DockingState.DOCKED || dockingState.dockedObjectIds.length === 0) {
    return { success: false, reason: 'Not docked to anything' };
  }

  // Determine which object to undock.
  const targetIdx = undockTargetId
    ? dockingState.dockedObjectIds.indexOf(undockTargetId)
    : dockingState.dockedObjectIds.length - 1;

  if (targetIdx < 0) {
    return { success: false, reason: 'Object not in docked list' };
  }

  const objectId = dockingState.dockedObjectIds[targetIdx];

  // Remove from docked list.
  dockingState.dockedObjectIds.splice(targetIdx, 1);

  // Create the undocked object back in orbit with a slight separation.
  const bodyId = flightState.bodyId;
  const elements = flightState.orbitalElements
    ? { ...flightState.orbitalElements }
    : computeOrbitalElements(ps.posX, ps.posY, ps.velX, ps.velY, bodyId);

  if (elements) {
    // Apply a small separation impulse by tweaking the mean anomaly slightly.
    elements.meanAnomalyAtEpoch += 0.001; // ~0.06° offset

    state.orbitalObjects.push({
      id: objectId,
      bodyId,
      type: OrbitalObjectType.CRAFT,
      name: `Undocked-${objectId.slice(0, 6)}`,
      elements,
    });
  }

  // Log the undocking event.
  flightState.events.push({
    time: flightState.timeElapsed,
    type: 'UNDOCKING_COMPLETE',
    description: `Undocked from ${objectId}`,
  });

  // Recalculate combined mass.
  dockingState.combinedMass = _calculateCombinedMass(ps, assembly, dockingState, state);

  // If no more docked objects, return to IDLE.
  if (dockingState.dockedObjectIds.length === 0) {
    dockingState.state = DockingState.IDLE;
    dockingState.targetId = null;
  }

  return { success: true, undockedObjectId: objectId };
}

// ---------------------------------------------------------------------------
// Crew transfer
// ---------------------------------------------------------------------------

/**
 * Transfer crew between the player's craft and a docked station/craft.
 * Only possible when DOCKED.
 *
 * @param {DockingSystemState}                     dockingState
 * @param {import('./gameState.js').FlightState}   flightState
 * @param {string[]}                               crewIds  IDs of crew to transfer.
 * @param {'TO_STATION'|'FROM_STATION'}            direction
 * @returns {{ success: boolean, reason?: string, transferred: string[] }}
 */
export function transferCrew(dockingState, flightState, crewIds, direction) {
  if (dockingState.state !== DockingState.DOCKED) {
    return { success: false, reason: 'Must be docked', transferred: [] };
  }
  if (!crewIds || crewIds.length === 0) {
    return { success: false, reason: 'No crew specified', transferred: [] };
  }

  const transferred = [];

  if (direction === 'TO_STATION') {
    // Remove crew from flight (they stay at the station).
    for (const id of crewIds) {
      const idx = flightState.crewIds.indexOf(id);
      if (idx >= 0) {
        flightState.crewIds.splice(idx, 1);
        transferred.push(id);
      }
    }
  } else {
    // Add crew to flight (picking them up from station).
    for (const id of crewIds) {
      if (!flightState.crewIds.includes(id)) {
        flightState.crewIds.push(id);
        transferred.push(id);
      }
    }
  }

  if (transferred.length > 0) {
    flightState.events.push({
      time: flightState.timeElapsed,
      type: 'CREW_TRANSFER',
      description: `${transferred.length} crew ${direction === 'TO_STATION' ? 'transferred to station' : 'boarded from station'}`,
    });
  }

  return { success: true, transferred };
}

// ---------------------------------------------------------------------------
// Fuel transfer
// ---------------------------------------------------------------------------

/**
 * Transfer fuel between the player's craft and a docked object.
 * Only possible when DOCKED. Transfers from docked depot to craft tanks.
 *
 * @param {DockingSystemState}                          dockingState
 * @param {import('./physics.js').PhysicsState}         ps
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {import('./gameState.js').FlightState}        flightState
 * @param {number}                                      amount  Fuel kg to transfer (positive = to craft).
 * @returns {{ success: boolean, reason?: string, transferred: number }}
 */
export function transferFuel(dockingState, ps, assembly, flightState, amount) {
  if (dockingState.state !== DockingState.DOCKED) {
    return { success: false, reason: 'Must be docked', transferred: 0 };
  }
  if (amount <= 0) {
    return { success: false, reason: 'Amount must be positive', transferred: 0 };
  }

  // Find craft tanks with remaining capacity.
  let totalTransferred = 0;
  let remaining = amount;

  for (const instanceId of ps.activeParts) {
    if (remaining <= 0) break;

    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.FUEL_TANK) continue;

    const maxFuel = def.properties?.fuelMass ?? 0;
    const currentFuel = ps.fuelStore.get(instanceId) ?? 0;
    const capacity = maxFuel - currentFuel;

    if (capacity > 0) {
      const toTransfer = Math.min(remaining, capacity);
      ps.fuelStore.set(instanceId, currentFuel + toTransfer);
      totalTransferred += toTransfer;
      remaining -= toTransfer;
    }
  }

  if (totalTransferred > 0) {
    // Update flight state fuel tracking.
    flightState.fuelRemaining += totalTransferred;

    flightState.events.push({
      time: flightState.timeElapsed,
      type: 'FUEL_TRANSFER',
      description: `Transferred ${Math.round(totalTransferred)} kg fuel from docked depot`,
    });
  }

  return { success: true, transferred: totalTransferred };
}

// ---------------------------------------------------------------------------
// Docking guidance display data
// ---------------------------------------------------------------------------

/**
 * Get the current docking guidance data for HUD display.
 *
 * @param {DockingSystemState} dockingState
 * @returns {{
 *   active: boolean,
 *   state: string,
 *   distance: number,
 *   relativeSpeed: number,
 *   orientationDiff: number,
 *   lateralOffset: number,
 *   speedOk: boolean,
 *   orientationOk: boolean,
 *   lateralOk: boolean,
 *   allGreen: boolean,
 *   isDocked: boolean,
 *   dockedCount: number,
 * }}
 */
export function getDockingGuidance(dockingState) {
  const active = dockingState.state !== DockingState.IDLE;
  const isDocked = dockingState.state === DockingState.DOCKED;
  const allGreen = dockingState.speedOk && dockingState.orientationOk && dockingState.lateralOk;

  return {
    active,
    state: dockingState.state,
    distance: dockingState.targetDistance,
    relativeSpeed: dockingState.targetRelSpeed,
    orientationDiff: dockingState.targetOriDiff,
    lateralOffset: dockingState.targetLateral,
    speedOk: dockingState.speedOk,
    orientationOk: dockingState.orientationOk,
    lateralOk: dockingState.lateralOk,
    allGreen,
    isDocked,
    dockedCount: dockingState.dockedObjectIds.length,
  };
}

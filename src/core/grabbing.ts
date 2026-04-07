/**
 * grabbing.ts — Grabbing arm system for satellite repair and servicing.
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
  GrabState, PartType, OrbitalObjectType,
  GRAB_VISUAL_RANGE_DEG, GRAB_GUIDANCE_RANGE, GRAB_ARM_RANGE,
  GRAB_MAX_RELATIVE_SPEED, GRAB_MAX_LATERAL_OFFSET, GRAB_REPAIR_HEALTH,
  GRAB_RELEASE_SPEED, BODY_RADIUS,
} from './constants.js';
import { getOrbitalStateAtTime, angularDistance, getAltitudeBand, circularOrbitVelocity } from './orbit.js';
import { getPartById } from '../data/parts.js';
import type { PartDef } from '../data/parts.js';
import type { PhysicsState, RocketAssembly } from './physics.js';
import type { FlightState, FlightEvent, GameState, OrbitalObject, SatelliteRecord } from './gameState.js';

// ---------------------------------------------------------------------------
// Grab system state interface
// ---------------------------------------------------------------------------

export interface GrabSystemState {
  state: string;
  targetId: string | null;
  targetDistance: number;
  targetRelSpeed: number;
  targetLateral: number;
  speedOk: boolean;
  lateralOk: boolean;
  inRange: boolean;
  grabbedSatelliteId: string | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGrabState(): GrabSystemState {
  return { state: GrabState.IDLE, targetId: null, targetDistance: Infinity, targetRelSpeed: 0, targetLateral: 0, speedOk: false, lateralOk: false, inRange: false, grabbedSatelliteId: null };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function hasGrabbingArm(ps: PhysicsState, assembly: RocketAssembly): boolean {
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId); if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.GRABBING_ARM) return true;
  }
  return false;
}

export function getGrabbingArms(ps: PhysicsState, assembly: RocketAssembly): Array<{ instanceId: string; partDef: PartDef }> {
  const arms: Array<{ instanceId: string; partDef: PartDef }> = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId); if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.GRABBING_ARM) arms.push({ instanceId, partDef: def });
  }
  return arms;
}

export function getGrabTargetsInRange(ps: PhysicsState, flightState: FlightState, state: GameState): Array<{ object: OrbitalObject; distance: number; angularDist: number; satelliteRecord: SatelliteRecord | null }> {
  if (!flightState.inOrbit || !flightState.orbitalElements) return [];
  const bodyId = flightState.bodyId; const t = flightState.timeElapsed;
  const craftState = getOrbitalStateAtTime(flightState.orbitalElements, t, bodyId);
  const results: Array<{ object: OrbitalObject; distance: number; angularDist: number; satelliteRecord: SatelliteRecord | null }> = [];
  for (const obj of state.orbitalObjects) {
    if (obj.bodyId !== bodyId) continue;
    if (obj.type !== OrbitalObjectType.SATELLITE) continue;
    const objState = getOrbitalStateAtTime(obj.elements, t, bodyId);
    const angleDist = angularDistance(craftState.angularPositionDeg, objState.angularPositionDeg);
    if (angleDist < GRAB_VISUAL_RANGE_DEG) {
      const craftBand = getAltitudeBand(craftState.altitude, bodyId);
      const objBand = getAltitudeBand(objState.altitude, bodyId);
      if (craftBand && objBand && craftBand.id === objBand.id) {
        const R = BODY_RADIUS[bodyId]; const avgAlt = (craftState.altitude + objState.altitude) / 2;
        const arcDist = (angleDist * Math.PI / 180) * (R + avgAlt);
        const altDist = Math.abs(craftState.altitude - objState.altitude);
        const dist = Math.sqrt(arcDist * arcDist + altDist * altDist);
        const satRecord = (state.satelliteNetwork?.satellites ?? []).find((s) => s.orbitalObjectId === obj.id && s.health > 0) ?? null;
        results.push({ object: obj, distance: dist, angularDist: angleDist, satelliteRecord: satRecord });
      }
    }
  }
  results.sort((a, b) => a.distance - b.distance);
  return results;
}

export function canGrab(targetObj: OrbitalObject): boolean {
  return targetObj.type === OrbitalObjectType.SATELLITE;
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

export function selectGrabTarget(grabState: GrabSystemState, targetId: string, ps: PhysicsState, assembly: RocketAssembly): { success: boolean; reason?: string } {
  if (!hasGrabbingArm(ps, assembly)) return { success: false, reason: 'No grabbing arm on craft' };
  if (grabState.state === GrabState.GRABBED) return { success: false, reason: 'Already grabbed a satellite' };
  grabState.targetId = targetId; grabState.state = GrabState.APPROACHING;
  return { success: true };
}

export function clearGrabTarget(grabState: GrabSystemState): void {
  grabState.targetId = null; grabState.state = GrabState.IDLE; grabState.targetDistance = Infinity;
  grabState.targetRelSpeed = 0; grabState.targetLateral = 0; grabState.speedOk = false;
  grabState.lateralOk = false; grabState.inRange = false; grabState.grabbedSatelliteId = null;
}

// ---------------------------------------------------------------------------
// State machine update
// ---------------------------------------------------------------------------

export function updateGrabState(grabState: GrabSystemState, ps: PhysicsState, flightState: FlightState, state: GameState): void {
  if (grabState.state === GrabState.IDLE) return;
  if (grabState.state === GrabState.GRABBED) return;
  if (!grabState.targetId) { clearGrabTarget(grabState); return; }
  const target = state.orbitalObjects.find((o) => o.id === grabState.targetId);
  if (!target) { clearGrabTarget(grabState); return; }
  const bodyId = flightState.bodyId; const t = flightState.timeElapsed;
  const craftOrbState = getOrbitalStateAtTime(flightState.orbitalElements!, t, bodyId);
  const targetOrbState = getOrbitalStateAtTime(target.elements, t, bodyId);
  const R = BODY_RADIUS[bodyId];
  const angleDist = angularDistance(craftOrbState.angularPositionDeg, targetOrbState.angularPositionDeg);
  const avgAlt = (craftOrbState.altitude + targetOrbState.altitude) / 2;
  const arcDist = (angleDist * Math.PI / 180) * (R + avgAlt);
  const altDist = Math.abs(craftOrbState.altitude - targetOrbState.altitude);
  const dist = Math.sqrt(arcDist * arcDist + altDist * altDist);
  const craftVel = circularOrbitVelocity(craftOrbState.altitude, bodyId);
  const targetVel = circularOrbitVelocity(targetOrbState.altitude, bodyId);
  const relSpeed = Math.abs(craftVel - targetVel);
  const lateral = altDist;
  grabState.targetDistance = dist; grabState.targetRelSpeed = relSpeed; grabState.targetLateral = lateral;
  grabState.speedOk = relSpeed <= GRAB_MAX_RELATIVE_SPEED; grabState.lateralOk = lateral <= GRAB_MAX_LATERAL_OFFSET;
  grabState.inRange = dist <= GRAB_ARM_RANGE;
  switch (grabState.state) {
    case GrabState.APPROACHING:
      if (dist <= GRAB_GUIDANCE_RANGE && grabState.inRange && grabState.speedOk && grabState.lateralOk) grabState.state = GrabState.EXTENDING;
      break;
    case GrabState.EXTENDING:
      if (!grabState.inRange || !grabState.speedOk) { grabState.state = GrabState.APPROACHING; break; }
      _completeGrab(grabState, target, state); break;
    case GrabState.RELEASING:
      clearGrabTarget(grabState); break;
  }
}

function _completeGrab(grabState: GrabSystemState, target: OrbitalObject, state: GameState): void {
  const satRecord = (state.satelliteNetwork?.satellites ?? []).find((s) => s.orbitalObjectId === target.id && s.health > 0);
  grabState.state = GrabState.GRABBED; grabState.grabbedSatelliteId = satRecord ? satRecord.id : null;
}

// ---------------------------------------------------------------------------
// Actions while grabbed
// ---------------------------------------------------------------------------

export function repairGrabbedSatellite(grabState: GrabSystemState, state: GameState): { success: boolean; reason?: string; healthBefore?: number } {
  if (grabState.state !== GrabState.GRABBED) return { success: false, reason: 'Arm is not grabbing a satellite.' };
  if (!grabState.grabbedSatelliteId) return { success: false, reason: 'No satellite record attached.' };
  const sat = (state.satelliteNetwork?.satellites ?? []).find((s) => s.id === grabState.grabbedSatelliteId);
  if (!sat) return { success: false, reason: 'Satellite record not found.' };
  if (sat.health <= 0) return { success: false, reason: 'Satellite is decommissioned and cannot be repaired.' };
  const healthBefore = sat.health; sat.health = Math.min(100, sat.health + GRAB_REPAIR_HEALTH);
  return { success: true, healthBefore };
}

export function releaseGrabbedSatellite(grabState: GrabSystemState): { success: boolean; reason?: string } {
  if (grabState.state !== GrabState.GRABBED) return { success: false, reason: 'Arm is not grabbing a satellite.' };
  grabState.state = GrabState.RELEASING; grabState.grabbedSatelliteId = null;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Flight event integration
// ---------------------------------------------------------------------------

export function processGrabRepairsFromFlight(state: GameState, flightState: FlightState | null): Array<{ satelliteId: string; healthBefore: number }> {
  if (!flightState) return [];
  if (!state.satelliteNetwork) return [];
  const repaired: Array<{ satelliteId: string; healthBefore: number }> = [];
  const repairEvents = (flightState.events ?? []).filter((e: FlightEvent) => e.type === 'SATELLITE_REPAIRED');
  for (const event of repairEvents) {
    const satId = event.satelliteId as string | undefined; if (!satId) continue;
    const sat = state.satelliteNetwork.satellites.find((s) => s.id === satId);
    if (!sat || sat.health <= 0) continue;
    const healthBefore = sat.health; sat.health = Math.min(100, sat.health + GRAB_REPAIR_HEALTH);
    repaired.push({ satelliteId: satId, healthBefore });
  }
  return repaired;
}

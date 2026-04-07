/**
 * docking.ts — Docking system for connecting vessels in orbit.
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
  DockingState, PartType, ControlMode, OrbitalObjectType,
  DOCKING_VISUAL_RANGE_DEG, DOCKING_GUIDANCE_RANGE, DOCKING_AUTO_RANGE,
  DOCKING_MAX_RELATIVE_SPEED, DOCKING_MAX_ORIENTATION_DIFF, DOCKING_MAX_LATERAL_OFFSET,
  DOCKING_AUTO_APPROACH_SPEED, UNDOCKING_SEPARATION_SPEED, BODY_RADIUS,
} from './constants.js';
import { getOrbitalStateAtTime, checkProximity, angularDistance, computeOrbitalElements, getAltitudeBand } from './orbit.js';
import { getPartById } from '../data/parts.js';
import type { PartDef } from '../data/parts.js';
import type { PhysicsState, RocketAssembly } from './physics.js';
import type { FlightState, GameState, OrbitalObject, DockingSystemState, OrbitalElements } from './gameState.js';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDockingState(): DockingSystemState {
  return {
    state: DockingState.IDLE, targetId: null, targetDistance: Infinity, targetRelSpeed: 0,
    targetOriDiff: 0, targetLateral: 0, speedOk: false, orientationOk: false, lateralOk: false,
    dockedObjectIds: [], combinedMass: 0,
  } as DockingSystemState;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function hasDockingPort(ps: PhysicsState, assembly: RocketAssembly): boolean {
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.DOCKING_PORT) return true;
  }
  return false;
}

export function getDockingPorts(ps: PhysicsState, assembly: RocketAssembly): Array<{ instanceId: string; partDef: PartDef }> {
  const ports: Array<{ instanceId: string; partDef: PartDef }> = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.DOCKING_PORT) ports.push({ instanceId, partDef: def });
  }
  return ports;
}

export function getTargetsInVisualRange(ps: PhysicsState, flightState: FlightState, state: GameState): Array<{ object: OrbitalObject; distance: number; angularDist: number }> {
  if (!flightState.inOrbit || !flightState.orbitalElements) return [];
  const bodyId = flightState.bodyId;
  const t = flightState.timeElapsed;
  const craftState = getOrbitalStateAtTime(flightState.orbitalElements, t, bodyId);
  const results: Array<{ object: OrbitalObject; distance: number; angularDist: number }> = [];
  for (const obj of state.orbitalObjects) {
    if (obj.bodyId !== bodyId) continue;
    const objState = getOrbitalStateAtTime(obj.elements, t, bodyId);
    const angleDist = angularDistance(craftState.angularPositionDeg, objState.angularPositionDeg);
    if (angleDist < DOCKING_VISUAL_RANGE_DEG) {
      const craftBand = getAltitudeBand(craftState.altitude, bodyId);
      const objBand = getAltitudeBand(objState.altitude, bodyId);
      if (craftBand && objBand && craftBand.id === objBand.id) {
        const R = BODY_RADIUS[bodyId];
        const avgAlt = (craftState.altitude + objState.altitude) / 2;
        const arcDist = (angleDist * Math.PI / 180) * (R + avgAlt);
        const altDist = Math.abs(craftState.altitude - objState.altitude);
        results.push({ object: obj, distance: Math.sqrt(arcDist * arcDist + altDist * altDist), angularDist: angleDist });
      }
    }
  }
  results.sort((a, b) => a.distance - b.distance);
  return results;
}

export function canDockWith(targetObj: OrbitalObject): boolean {
  return targetObj.type === OrbitalObjectType.CRAFT || targetObj.type === OrbitalObjectType.STATION;
}

// ---------------------------------------------------------------------------
// Target selection
// ---------------------------------------------------------------------------

export function selectDockingTarget(dockingState: DockingSystemState, targetId: string, ps: PhysicsState, assembly: RocketAssembly): { success: boolean; reason?: string } {
  if (!hasDockingPort(ps, assembly)) return { success: false, reason: 'No docking port on craft' };
  if (dockingState.state === DockingState.DOCKED) return { success: false, reason: 'Already docked' };
  dockingState.targetId = targetId;
  dockingState.state = DockingState.APPROACHING;
  return { success: true };
}

export function clearDockingTarget(dockingState: DockingSystemState): void {
  dockingState.targetId = null; dockingState.state = DockingState.IDLE;
  dockingState.targetDistance = Infinity; dockingState.targetRelSpeed = 0;
  dockingState.targetOriDiff = 0; dockingState.targetLateral = 0;
  dockingState.speedOk = false; dockingState.orientationOk = false; dockingState.lateralOk = false;
}

// ---------------------------------------------------------------------------
// Docking guidance tick
// ---------------------------------------------------------------------------

export function tickDocking(dockingState: DockingSystemState, ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState, state: GameState, dt: number): { docked: boolean; event?: string } {
  if (dockingState.state === DockingState.IDLE || dockingState.state === DockingState.DOCKED) return { docked: false };
  const targetId = dockingState.targetId;
  if (!targetId) { dockingState.state = DockingState.IDLE; return { docked: false }; }
  const targetObj = state.orbitalObjects.find(o => o.id === targetId);
  if (!targetObj) { clearDockingTarget(dockingState); return { docked: false }; }
  const bodyId = flightState.bodyId;
  const t = flightState.timeElapsed;
  const craftElements = flightState.orbitalElements;
  if (!craftElements) { clearDockingTarget(dockingState); return { docked: false }; }
  const craftOrbState = getOrbitalStateAtTime(craftElements, t, bodyId);
  const targetOrbState = getOrbitalStateAtTime(targetObj.elements, t, bodyId);
  const R = BODY_RADIUS[bodyId];
  const angleDist = angularDistance(craftOrbState.angularPositionDeg, targetOrbState.angularPositionDeg);
  const avgAlt = (craftOrbState.altitude + targetOrbState.altitude) / 2;
  const alongTrackDist = (angleDist * Math.PI / 180) * (R + avgAlt);
  const radialDist = targetOrbState.altitude - craftOrbState.altitude;
  const distance = Math.sqrt(alongTrackDist * alongTrackDist + radialDist * radialDist);
  let effectiveDistance = distance;
  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    const dA = alongTrackDist - ps.dockingOffsetAlongTrack;
    const dR = radialDist - ps.dockingOffsetRadial;
    effectiveDistance = Math.sqrt(dA * dA + dR * dR);
  }
  const prevDist = dockingState.targetDistance;
  const relSpeed = prevDist < Infinity ? Math.abs(effectiveDistance - prevDist) / Math.max(dt, 1 / 60) : 0;
  const oriDiff = Math.abs(ps.angle % (2 * Math.PI));
  const normalizedOriDiff = oriDiff > Math.PI ? 2 * Math.PI - oriDiff : oriDiff;
  const lateralOffset = Math.abs(radialDist) < Math.abs(alongTrackDist) ? Math.abs(radialDist) : Math.abs(alongTrackDist);
  dockingState.targetDistance = effectiveDistance; dockingState.targetRelSpeed = relSpeed;
  dockingState.targetOriDiff = normalizedOriDiff; dockingState.targetLateral = lateralOffset;
  dockingState.speedOk = relSpeed <= DOCKING_MAX_RELATIVE_SPEED;
  dockingState.orientationOk = normalizedOriDiff <= DOCKING_MAX_ORIENTATION_DIFF;
  dockingState.lateralOk = lateralOffset <= DOCKING_MAX_LATERAL_OFFSET;
  if (dockingState.state === DockingState.APPROACHING && effectiveDistance <= DOCKING_GUIDANCE_RANGE) dockingState.state = DockingState.ALIGNING;
  if (dockingState.state === DockingState.ALIGNING) {
    if (effectiveDistance > DOCKING_GUIDANCE_RANGE * 1.5) dockingState.state = DockingState.APPROACHING;
    else if (effectiveDistance <= DOCKING_AUTO_RANGE && dockingState.speedOk && dockingState.orientationOk && dockingState.lateralOk) dockingState.state = DockingState.FINAL_APPROACH;
  }
  if (dockingState.state === DockingState.FINAL_APPROACH) {
    if (effectiveDistance > DOCKING_AUTO_RANGE * 2) { dockingState.state = DockingState.ALIGNING; return { docked: false, event: 'AUTO_DOCK_ABORT' }; }
    if (effectiveDistance > 1) {
      const approachStep = DOCKING_AUTO_APPROACH_SPEED * dt;
      if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
        const ratio = Math.min(1, approachStep / effectiveDistance);
        ps.dockingOffsetAlongTrack += (alongTrackDist - ps.dockingOffsetAlongTrack) * ratio;
        ps.dockingOffsetRadial += (radialDist - ps.dockingOffsetRadial) * ratio;
      }
    } else { return _completeDocking(dockingState, ps, assembly, flightState, state, targetObj); }
  }
  return { docked: false };
}

// ---------------------------------------------------------------------------
// Docking completion
// ---------------------------------------------------------------------------

function _completeDocking(dockingState: DockingSystemState, ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState, state: GameState, targetObj: OrbitalObject): { docked: boolean; event: string } {
  dockingState.state = DockingState.DOCKED; dockingState.targetDistance = 0; dockingState.targetRelSpeed = 0;
  dockingState.speedOk = true; dockingState.orientationOk = true; dockingState.lateralOk = true;
  if (!dockingState.dockedObjectIds.includes(targetObj.id)) dockingState.dockedObjectIds.push(targetObj.id);
  dockingState.combinedMass = _calculateCombinedMass(ps, assembly, dockingState, state);
  const idx = state.orbitalObjects.findIndex(o => o.id === targetObj.id);
  if (idx >= 0) state.orbitalObjects.splice(idx, 1);
  flightState.events.push({ time: flightState.timeElapsed, type: 'DOCKING_COMPLETE', description: `Docked with ${targetObj.name}` });
  return { docked: true, event: 'DOCKING_COMPLETE' };
}

function _calculateCombinedMass(ps: PhysicsState, assembly: RocketAssembly, dockingState: DockingSystemState, state: GameState): number {
  let craftMass = 0;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId); if (!placed) continue;
    const def = getPartById(placed.partId); if (def) craftMass += def.mass;
  }
  for (const [, fuel] of ps.fuelStore) craftMass += fuel;
  let dockedMass = 0;
  for (const dockedId of dockingState.dockedObjectIds) {
    const satRecord = state.satelliteNetwork?.satellites?.find((s) => s.orbitalObjectId === dockedId);
    if (satRecord) { const satDef = getPartById(satRecord.partId); dockedMass += satDef ? satDef.mass : 500; }
    else dockedMass += 2000;
  }
  return craftMass + dockedMass;
}

// ---------------------------------------------------------------------------
// Undocking
// ---------------------------------------------------------------------------

export function undock(dockingState: DockingSystemState, ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState, state: GameState, undockTargetId?: string): { success: boolean; reason?: string; undockedObjectId?: string } {
  if (dockingState.state !== DockingState.DOCKED || dockingState.dockedObjectIds.length === 0) return { success: false, reason: 'Not docked to anything' };
  const targetIdx = undockTargetId ? dockingState.dockedObjectIds.indexOf(undockTargetId) : dockingState.dockedObjectIds.length - 1;
  if (targetIdx < 0) return { success: false, reason: 'Object not in docked list' };
  const objectId = dockingState.dockedObjectIds[targetIdx];
  dockingState.dockedObjectIds.splice(targetIdx, 1);
  const bodyId = flightState.bodyId;
  const elements: OrbitalElements | null = flightState.orbitalElements ? { ...flightState.orbitalElements } : computeOrbitalElements(ps.posX, ps.posY, ps.velX, ps.velY, bodyId);
  if (elements) {
    elements.meanAnomalyAtEpoch += 0.001;
    state.orbitalObjects.push({ id: objectId, bodyId, type: OrbitalObjectType.CRAFT, name: `Undocked-${objectId.slice(0, 6)}`, elements });
  }
  flightState.events.push({ time: flightState.timeElapsed, type: 'UNDOCKING_COMPLETE', description: `Undocked from ${objectId}` });
  dockingState.combinedMass = _calculateCombinedMass(ps, assembly, dockingState, state);
  if (dockingState.dockedObjectIds.length === 0) { dockingState.state = DockingState.IDLE; dockingState.targetId = null; }
  return { success: true, undockedObjectId: objectId };
}

// ---------------------------------------------------------------------------
// Crew transfer
// ---------------------------------------------------------------------------

export function transferCrew(dockingState: DockingSystemState, flightState: FlightState, crewIds: string[], direction: 'TO_STATION' | 'FROM_STATION'): { success: boolean; reason?: string; transferred: string[] } {
  if (dockingState.state !== DockingState.DOCKED) return { success: false, reason: 'Must be docked', transferred: [] };
  if (!crewIds || crewIds.length === 0) return { success: false, reason: 'No crew specified', transferred: [] };
  const transferred: string[] = [];
  if (direction === 'TO_STATION') {
    for (const id of crewIds) { const idx = flightState.crewIds.indexOf(id); if (idx >= 0) { flightState.crewIds.splice(idx, 1); transferred.push(id); } }
  } else {
    for (const id of crewIds) { if (!flightState.crewIds.includes(id)) { flightState.crewIds.push(id); transferred.push(id); } }
  }
  if (transferred.length > 0) flightState.events.push({ time: flightState.timeElapsed, type: 'CREW_TRANSFER', description: `${transferred.length} crew ${direction === 'TO_STATION' ? 'transferred to station' : 'boarded from station'}` });
  return { success: true, transferred };
}

// ---------------------------------------------------------------------------
// Fuel transfer
// ---------------------------------------------------------------------------

export function transferFuel(dockingState: DockingSystemState, ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState, amount: number): { success: boolean; reason?: string; transferred: number } {
  if (dockingState.state !== DockingState.DOCKED) return { success: false, reason: 'Must be docked', transferred: 0 };
  if (amount <= 0) return { success: false, reason: 'Amount must be positive', transferred: 0 };
  let totalTransferred = 0; let remaining = amount;
  for (const instanceId of ps.activeParts) {
    if (remaining <= 0) break;
    const placed = assembly.parts.get(instanceId); if (!placed) continue;
    const def = getPartById(placed.partId); if (!def || def.type !== PartType.FUEL_TANK) continue;
    const maxFuel = Number(def.properties?.fuelMass ?? 0);
    const currentFuel = ps.fuelStore.get(instanceId) ?? 0;
    const capacity = maxFuel - currentFuel;
    if (capacity > 0) { const toTransfer = Math.min(remaining, capacity); ps.fuelStore.set(instanceId, currentFuel + toTransfer); totalTransferred += toTransfer; remaining -= toTransfer; }
  }
  if (totalTransferred > 0) {
    flightState.fuelRemaining += totalTransferred;
    flightState.events.push({ time: flightState.timeElapsed, type: 'FUEL_TRANSFER', description: `Transferred ${Math.round(totalTransferred)} kg fuel from docked depot` });
  }
  return { success: true, transferred: totalTransferred };
}

// ---------------------------------------------------------------------------
// Docking guidance display data
// ---------------------------------------------------------------------------

export function getDockingGuidance(dockingState: DockingSystemState): { active: boolean; state: string; distance: number; relativeSpeed: number; orientationDiff: number; lateralOffset: number; speedOk: boolean; orientationOk: boolean; lateralOk: boolean; allGreen: boolean; isDocked: boolean; dockedCount: number } {
  const active = dockingState.state !== DockingState.IDLE;
  const isDocked = dockingState.state === DockingState.DOCKED;
  const allGreen = dockingState.speedOk && dockingState.orientationOk && dockingState.lateralOk;
  return { active, state: dockingState.state, distance: dockingState.targetDistance, relativeSpeed: dockingState.targetRelSpeed, orientationDiff: dockingState.targetOriDiff, lateralOffset: dockingState.targetLateral, speedOk: dockingState.speedOk, orientationOk: dockingState.orientationOk, lateralOk: dockingState.lateralOk, allGreen, isDocked, dockedCount: dockingState.dockedObjectIds.length };
}

/**
 * grabbing.ts — Grabbing arm system for satellite repair, servicing, and
 * asteroid capture.
 *
 * Handles the full grab lifecycle:
 *   1. Target selection — player selects a satellite or asteroid within range.
 *   2. Approach — guidance shows distance, speed, lateral offset.
 *   3. Extending — arm reaches out when within GRAB_ARM_RANGE.
 *   4. Grabbed — craft attached to target; repair (satellite) or capture
 *      (asteroid) actions available.
 *   5. Release — arm retracts and target is freed.
 *
 * The grabbing arm is distinct from docking: it targets SATELLITE-type orbital
 * objects (which cannot dock) and transient asteroids (from belt encounters),
 * with looser alignment requirements.  Satellites are repaired; asteroids are
 * captured subject to per-arm mass limits.
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
  BODY_RADIUS,
} from './constants.ts';
import { getOrbitalStateAtTime, angularDistance, getAltitudeBand, circularOrbitVelocity, computeOrbitalElements } from './orbit.ts';
import { getBeltZoneAtAltitude } from './asteroidBelt.ts';
import { getPartById } from '../data/parts.ts';
import type { PartDef } from '../data/parts.ts';
import { setThrustAligned, setCapturedBody, clearCapturedBody } from './physics.ts';
import type { PhysicsState, RocketAssembly, CapturedBody } from './physics.ts';
import type { FlightState, FlightEvent, GameState, OrbitalObject, SatelliteRecord } from './gameState.ts';
import type { Asteroid } from './asteroidBelt.ts';

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
  grabbedAsteroid: Asteroid | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGrabState(): GrabSystemState {
  return { state: GrabState.IDLE, targetId: null, targetDistance: Infinity, targetRelSpeed: 0, targetLateral: 0, speedOk: false, lateralOk: false, inRange: false, grabbedSatelliteId: null, grabbedAsteroid: null };
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

export function canGrab(targetObj: OrbitalObject | { type: string }): boolean {
  return targetObj.type === OrbitalObjectType.SATELLITE || targetObj.type === 'asteroid';
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
  grabState.grabbedAsteroid = null;
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
// Asteroid targeting
// ---------------------------------------------------------------------------

/**
 * Find asteroids within broad grab visual range of the craft.
 * Asteroids are transient (not in state.orbitalObjects), so they must be
 * passed in directly (e.g. from getActiveAsteroids()).
 */
export function getAsteroidGrabTargetsInRange(
  asteroids: readonly Asteroid[],
  ps: PhysicsState,
  assembly?: RocketAssembly,
): Array<{ asteroid: Asteroid; distance: number; relativeSpeed: number }> {
  // Determine the best arm's reach for the broad visual filter.
  let bestArmReach = 25; // fallback to standard arm reach
  if (assembly) {
    const arms = getGrabbingArms(ps, assembly);
    for (const arm of arms) {
      const reach = Number(arm.partDef.properties?.armReach ?? 25);
      if (reach > bestArmReach) bestArmReach = reach;
    }
  }
  const results: Array<{ asteroid: Asteroid; distance: number; relativeSpeed: number }> = [];
  for (const ast of asteroids) {
    const dx = ast.posX - ps.posX;
    const dy = ast.posY - ps.posY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > bestArmReach * 20) continue; // broad filter — within visual range
    const dvx = ast.velX - ps.velX;
    const dvy = ast.velY - ps.velY;
    const relSpeed = Math.sqrt(dvx * dvx + dvy * dvy);
    results.push({ asteroid: ast, distance: dist, relativeSpeed: relSpeed });
  }
  results.sort((a, b) => a.distance - b.distance);
  return results;
}

// ---------------------------------------------------------------------------
// Asteroid capture (instead of repair for satellites)
// ---------------------------------------------------------------------------

/**
 * Attempt to capture an asteroid with the grabbing arm.
 * Enforces mass limits per arm tier — uses the best (highest maxCaptureMass)
 * arm on the craft.
 *
 * @remarks
 * Physics state is managed internally — on success this calls
 * {@link setCapturedBody} so callers must NOT separately update
 * `ps.capturedBody`.  After a successful capture the caller may optionally
 * call {@link alignThrustWithAsteroid} to align the thrust vector, and
 * should eventually call {@link releaseGrabbedAsteroid} to detach.
 */
export function captureAsteroid(
  grabState: GrabSystemState,
  asteroid: Asteroid,
  ps: PhysicsState,
  assembly: RocketAssembly,
): { success: boolean; reason?: string } {
  if (grabState.state !== GrabState.IDLE && grabState.state !== GrabState.APPROACHING) {
    return { success: false, reason: 'Arm is busy.' };
  }
  if (!hasGrabbingArm(ps, assembly)) {
    return { success: false, reason: 'No grabbing arm on craft.' };
  }

  // Check mass limit — pick the arm with the highest maxCaptureMass.
  const arms = getGrabbingArms(ps, assembly);
  const bestArm = arms.reduce((best, arm) => {
    const maxMass = Number(arm.partDef.properties?.maxCaptureMass ?? 0);
    const bestMax = Number(best?.partDef.properties?.maxCaptureMass ?? 0);
    return maxMass > bestMax ? arm : best;
  }, arms[0]);

  const maxCaptureMass = Number(bestArm?.partDef.properties?.maxCaptureMass ?? 0);
  if (asteroid.mass > maxCaptureMass) {
    return { success: false, reason: 'Asteroid too massive for this grabbing arm.' };
  }

  // Check distance.
  const dx = asteroid.posX - ps.posX;
  const dy = asteroid.posY - ps.posY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const armReach = Number(bestArm?.partDef.properties?.armReach ?? 25);
  if (dist > armReach) {
    return { success: false, reason: 'Asteroid out of range.' };
  }

  // Check relative speed.
  const dvx = asteroid.velX - ps.velX;
  const dvy = asteroid.velY - ps.velY;
  const relSpeed = Math.sqrt(dvx * dvx + dvy * dvy);
  const maxGrabSpeed = Number(bestArm?.partDef.properties?.maxGrabSpeed ?? 1.0);
  if (relSpeed > maxGrabSpeed) {
    return { success: false, reason: 'Relative speed too high.' };
  }

  grabState.state = GrabState.GRABBED;
  grabState.grabbedAsteroid = asteroid;

  // Wire captured body into physics state.
  const body: CapturedBody = {
    mass: asteroid.mass,
    radius: asteroid.radius,
    offset: {
      x: (asteroid.posX - ps.posX),
      y: (asteroid.posY - ps.posY),
    },
    name: asteroid.name,
  };
  setCapturedBody(ps, body);

  return { success: true };
}

/**
 * Release a captured asteroid.
 * Returns the asteroid object so the caller can restore it to the
 * active asteroid list if needed.
 *
 * @remarks
 * Physics state is managed internally — this calls
 * {@link clearCapturedBody} and resets thrust alignment, so callers
 * must NOT separately update `ps.capturedBody` or `ps.thrustAligned`.
 *
 * After release, callers should pass the returned asteroid to
 * {@link persistReleasedAsteroid} to decide whether it becomes a
 * persistent orbital object (outside belt zones) or returns to the
 * procedural field (inside belt zones).
 */
export function releaseGrabbedAsteroid(
  grabState: GrabSystemState,
  ps: PhysicsState,
): { success: boolean; reason?: string; asteroid?: Asteroid } {
  if (grabState.state !== GrabState.GRABBED || !grabState.grabbedAsteroid) {
    return { success: false, reason: 'No asteroid grabbed.' };
  }
  const asteroid = grabState.grabbedAsteroid;
  grabState.grabbedAsteroid = null;
  grabState.state = GrabState.RELEASING;
  clearCapturedBody(ps);
  return { success: true, asteroid };
}

// ---------------------------------------------------------------------------
// Thrust alignment (TASK-027)
// ---------------------------------------------------------------------------

/**
 * Align thrust through the combined CoM after asteroid capture.
 * The grabbing arm articulates to position the asteroid so that the engine
 * thrust vector passes through the combined centre of mass, eliminating
 * rotational torque from off-axis thrust.
 *
 * @remarks
 * Physics state is managed internally — this calls
 * {@link setThrustAligned} so callers must NOT separately set
 * `ps.thrustAligned`.  Prefer this function over calling
 * `setThrustAligned` directly, as it validates that a capture is
 * active and not already aligned.
 *
 * @returns `{ success: true }` when alignment is set, or `{ success: false, reason }` on failure.
 */
export function alignThrustWithAsteroid(
  grabState: GrabSystemState,
  ps: PhysicsState,
): { success: boolean; reason?: string } {
  if (grabState.state !== GrabState.GRABBED) {
    return { success: false, reason: 'Arm is not grabbing anything.' };
  }
  if (!grabState.grabbedAsteroid) {
    return { success: false, reason: 'No asteroid captured.' };
  }
  if (!ps.capturedBody) {
    return { success: false, reason: 'No captured body.' };
  }
  if (ps.thrustAligned) {
    return { success: false, reason: 'Thrust is already aligned.' };
  }

  setThrustAligned(ps, true);
  return { success: true };
}

/**
 * Break thrust alignment after manual rotation.
 * Called when the player rotates the craft while an asteroid is captured.
 *
 * @remarks
 * Physics state is managed internally — this calls
 * {@link setThrustAligned}(false) when appropriate.  Safe to call
 * unconditionally; it no-ops if no asteroid is captured or thrust is
 * already unaligned.
 */
export function breakThrustAlignment(ps: PhysicsState): void {
  if (ps.capturedBody !== null && ps.thrustAligned) {
    setThrustAligned(ps, false);
  }
}

// ---------------------------------------------------------------------------
// Asteroid persistence on release
// ---------------------------------------------------------------------------

/**
 * After releasing a captured asteroid, decide whether to persist it as an
 * OrbitalObject (when outside all belt zones) or simply let it return to the
 * procedural field (when inside a belt zone).
 *
 * @remarks
 * This is the second step of a two-step release flow:
 * 1. Call {@link releaseGrabbedAsteroid} — detaches asteroid, clears physics
 *    state, and returns the asteroid object.
 * 2. Call this function with the returned asteroid — handles persistence.
 *
 * Physics state is already cleared by step 1; this function only reads
 * `ps` for position/velocity and mutates `state.orbitalObjects` when
 * persisting.
 *
 * @param asteroid  The asteroid returned by `releaseGrabbedAsteroid()`.
 * @param ps        Current physics state (provides craft position & velocity).
 * @param flightState  Current flight state (provides altitude and time).
 * @param state     Game state — `orbitalObjects` is mutated if the asteroid is
 *                  persisted.
 * @returns `persisted: true` with the new OrbitalObject when outside belt
 *          zones; `persisted: false` otherwise.
 */
export function persistReleasedAsteroid(
  asteroid: Asteroid,
  ps: PhysicsState,
  flightState: FlightState,
  state: GameState,
): { persisted: boolean; orbitalObject?: OrbitalObject } {
  // Use the flight-state altitude to decide belt zone membership.
  const altitude = flightState.altitude;
  const beltZone = getBeltZoneAtAltitude(altitude);

  if (beltZone !== null) {
    // Inside a belt zone — asteroid simply detaches back to the procedural
    // field; no persistent object is created.
    return { persisted: false };
  }

  // Outside all belt zones — compute Keplerian orbital elements from the
  // craft's current state and persist the asteroid as an OrbitalObject.
  const bodyId = 'SUN';
  const elements = computeOrbitalElements(
    ps.posX,
    ps.posY,
    ps.velX,
    ps.velY,
    bodyId,
    flightState.timeElapsed,
  );

  if (!elements) {
    // Unable to compute a bound orbit (e.g. hyperbolic trajectory) — treat
    // the same as a belt-zone release: no persistence.
    return { persisted: false };
  }

  const orbitalObject: OrbitalObject = {
    id: `AST-P-${state.nextAsteroidId++}`,
    bodyId,
    type: 'asteroid',
    name: asteroid.name,
    elements,
    radius: asteroid.radius,
    mass: asteroid.mass,
  };

  state.orbitalObjects.push(orbitalObject);
  return { persisted: true, orbitalObject };
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

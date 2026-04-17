// ---------------------------------------------------------------------------
// Docking / RCS mode movement helpers.
//
// DOCKING mode: A/D = along-track (prograde/retrograde), W/S = radial.
// RCS mode: WASD = craft-relative directional translation (handled via rcs.ts).
//
// The radial-out check is body-aware — it flips the radial vector if needed
// so "out" points away from the reference body's centre. The body centre sits
// at world-space `(0, -bodyRadius)` because the craft's `posY` is altitude
// above surface, not absolute Y.
// ---------------------------------------------------------------------------

import { BODY_RADIUS, ControlMode } from '../constants.ts';
import { logger } from '../logger.ts';

import type { PhysicsState, RocketAssembly } from '../physics.ts';
import { applyRcsTranslation } from './rcs.ts';

/**
 * Compute the radial-out unit vector in DOCKING mode.
 *
 * Radial out is perpendicular to the prograde direction and flipped, if
 * necessary, to point away from the reference body's centre.  The body centre
 * sits at world-space `(0, -bodyRadius)` because the craft's `posY` is altitude
 * above surface, not absolute Y.
 *
 * Exported for testing.
 */
export function computeDockingRadialOut(
  posX: number,
  posY: number,
  velX: number,
  velY: number,
  angle: number,
  bodyRadius: number,
): { radOutX: number; radOutY: number } {
  const speed: number = Math.hypot(velX, velY);
  let progX: number;
  let progY: number;
  if (speed > 1e-3) {
    progX = velX / speed;
    progY = velY / speed;
  } else {
    progX = Math.sin(angle);
    progY = Math.cos(angle);
  }
  let radOutX: number = progY;
  let radOutY: number = -progX;
  const radCheck: number = radOutX * posX + radOutY * (posY + bodyRadius);
  if (radCheck < 0) {
    radOutX = -radOutX;
    radOutY = -radOutY;
  }
  return { radOutX, radOutY };
}

/**
 * Apply docking/RCS mode translational movement.
 *
 * In DOCKING mode: A/D = along-track, W/S = radial.
 * In RCS mode: WASD = craft-relative directional translation.
 */
export function applyDockingMovement(
  ps: PhysicsState,
  assembly: RocketAssembly,
  totalMass: number,
  dt: number,
  bodyId?: string,
): void {
  const isDocking: boolean = ps.controlMode === ControlMode.DOCKING;
  const isRcs: boolean     = ps.controlMode === ControlMode.RCS;
  if (!isDocking && !isRcs) return;

  // Clear RCS active directions each step; re-set below if active.
  ps.rcsActiveDirections.clear();

  const w: boolean = ps._heldKeys.has('w') || ps._heldKeys.has('ArrowUp');
  const s: boolean = ps._heldKeys.has('s') || ps._heldKeys.has('ArrowDown');
  const a: boolean = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
  const d: boolean = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');

  if (!w && !s && !a && !d) return;

  // Determine thrust magnitude based on mode.
  // When docked, use combined mass for thrust calculations.
  const thrustN: number = isRcs ? 500 : 2000; // N
  const effectiveMass: number = ps._dockedCombinedMass > 0
    ? Math.max(totalMass, ps._dockedCombinedMass)
    : totalMass;
  const accel: number = thrustN / Math.max(1, effectiveMass);

  if (isRcs) {
    applyRcsTranslation(ps, accel, dt, { w, s, a, d });
  } else {
    // DOCKING mode: A/D = along-track, W/S = radial.
    const speed: number = Math.hypot(ps.velX, ps.velY);
    let progX: number, progY: number;

    if (speed > 1e-3) {
      progX = ps.velX / speed;
      progY = ps.velY / speed;
    } else {
      progX = Math.sin(ps.angle);
      progY = Math.cos(ps.angle);
    }

    // Look up body radius so the radial-out check uses the correct body centre.
    let bodyRadius: number;
    if (bodyId === undefined) {
      logger.warn('physics', 'Docking radial check: bodyId undefined, falling back to Earth radius');
      bodyRadius = BODY_RADIUS.EARTH;
    } else {
      bodyRadius = BODY_RADIUS[bodyId] ?? BODY_RADIUS.EARTH;
    }
    const { radOutX, radOutY } = computeDockingRadialOut(
      ps.posX, ps.posY, ps.velX, ps.velY, ps.angle, bodyRadius,
    );

    let dvX = 0;
    let dvY = 0;
    if (d) { dvX += accel * dt * progX; dvY += accel * dt * progY; }   // along-track forward
    if (a) { dvX -= accel * dt * progX; dvY -= accel * dt * progY; }   // along-track backward
    if (w) { dvX += accel * dt * radOutX; dvY += accel * dt * radOutY; } // radial out
    if (s) { dvX -= accel * dt * radOutX; dvY -= accel * dt * radOutY; } // radial in

    // Band limit clamping — prevent leaving the altitude band.
    if (ps.dockingAltitudeBand) {
      const band = ps.dockingAltitudeBand;
      const alt: number = Math.max(0, ps.posY);
      if (alt >= band.max - 2500 && dvY > 0) dvY = 0;
      if (alt <= band.min + 2500 && dvY < 0) dvY = 0;
    }

    ps.velX += dvX;
    ps.velY += dvY;

    // Track offsets for reference.
    ps.dockingOffsetAlongTrack += (d ? 1 : 0) - (a ? 1 : 0);
    ps.dockingOffsetRadial     += (w ? 1 : 0) - (s ? 1 : 0);
  }
}

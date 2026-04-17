// ---------------------------------------------------------------------------
// RCS helpers — reaction control system capability check, active angular
// damping used by steering, and craft-relative translation used by the
// docking-mode movement helper.
//
// RCS is live only when the craft has an RCS-capable command module AND the
// flight is in vacuum (altitude > atmosphere top) for angular effects, or
// when the control mode is ControlMode.RCS for translational effects. The
// coupling with control-mode state is intentional — callers pass the relevant
// context explicitly rather than relying on implicit globals.
// ---------------------------------------------------------------------------

import { getPartById, type PartDef } from '../../data/parts.ts';

import type { PhysicsState, RocketAssembly } from '../physics.ts';

/** Torque multiplier when in vacuum with RCS-capable command module. */
export const RCS_TORQUE_MULTIPLIER: number = 2.5;

/** Active RCS braking torque (N·m per rad/s) when keys released. */
export const RCS_ANGULAR_DAMPING: number = 3.0;

/**
 * Return true if the rocket has at least one active RCS-capable command module.
 */
export function hasRcs(ps: PhysicsState, assembly: RocketAssembly): boolean {
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    const def: PartDef | null | undefined = placed ? getPartById(placed.partId) : null;
    if (def && def.properties?.hasRcs === true) return true;
  }
  return false;
}

/**
 * Apply active RCS angular braking to `ps.angularVelocity`.
 *
 * Only called by steering when no rotational input is held, the craft is in
 * vacuum, and an RCS module is present. Doesn't overshoot zero.
 */
export function applyRcsAngularDamping(ps: PhysicsState, momentOfInertia: number, dt: number): void {
  const rcsBrake: number = RCS_ANGULAR_DAMPING * ps.angularVelocity / momentOfInertia;
  if (Math.abs(rcsBrake * dt) > Math.abs(ps.angularVelocity)) {
    ps.angularVelocity = 0;
  } else {
    ps.angularVelocity -= rcsBrake * dt;
  }
}

/**
 * Apply RCS-mode translational thrust (craft-relative WASD).
 *
 * W/S thrust along the craft's axis (forward/backward), A/D thrust perpendicular
 * to it (left/right). Mutates `ps.velX`, `ps.velY`, and `ps.rcsActiveDirections`
 * (for plume rendering).
 *
 * Caller is responsible for:
 *   - Verifying the control mode is ControlMode.RCS.
 *   - Clearing `ps.rcsActiveDirections` before calling.
 *   - Computing `accel` from the RCS thrust magnitude and effective mass.
 */
export function applyRcsTranslation(
  ps: PhysicsState,
  accel: number,
  dt: number,
  keys: { w: boolean; s: boolean; a: boolean; d: boolean },
): void {
  let dvAlongAxis = 0;
  let dvPerpAxis = 0;
  if (keys.w) { dvAlongAxis += accel * dt; ps.rcsActiveDirections.add('up'); }
  if (keys.s) { dvAlongAxis -= accel * dt; ps.rcsActiveDirections.add('down'); }
  if (keys.a) { dvPerpAxis -= accel * dt;  ps.rcsActiveDirections.add('left'); }
  if (keys.d) { dvPerpAxis += accel * dt;  ps.rcsActiveDirections.add('right'); }

  // Convert craft-relative to world coordinates.
  const sinA: number = Math.sin(ps.angle);
  const cosA: number = Math.cos(ps.angle);
  ps.velX += dvAlongAxis * sinA + dvPerpAxis * cosA;
  ps.velY += dvAlongAxis * cosA - dvPerpAxis * sinA;
}

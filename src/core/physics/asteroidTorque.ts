// ---------------------------------------------------------------------------
// Captured asteroid torque calculation. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import { ASTEROID_TORQUE_FACTOR } from './constants.ts';
import { _computeTotalMass } from './mass.ts';
import type { PhysicsState, RocketAssembly } from './types.ts';

/**
 * Compute the angular acceleration caused by an unaligned captured asteroid.
 *
 * When a heavy asteroid is attached to the craft and thrust doesn't pass
 * through the combined centre of mass, the craft experiences a rotational
 * torque.  The torque is proportional to the thrust magnitude and the mass
 * ratio of asteroid to total craft.
 *
 * Returns 0 when no asteroid is captured, thrust is aligned, or engines are
 * not firing.
 */
export function _computeAsteroidTorque(
  ps: PhysicsState,
  assembly: RocketAssembly,
  thrustMagnitude: number,
): number {
  if (!ps.capturedBody) return 0;
  if (ps.thrustAligned) return 0;
  if (thrustMagnitude <= 0) return 0;

  const totalMass = _computeTotalMass(ps, assembly);
  if (totalMass <= 0) return 0;

  const massRatio = ps.capturedBody.mass / totalMass;

  return thrustMagnitude * massRatio * ASTEROID_TORQUE_FACTOR;
}

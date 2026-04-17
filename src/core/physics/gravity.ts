// ---------------------------------------------------------------------------
// Multi-body gravity helper
// ---------------------------------------------------------------------------

import { BODY_RADIUS } from '../constants.ts';
import { getSurfaceGravity } from '../../data/bodies.ts';

/** Standard gravity (m/s²). */
export const G0: number = 9.81;

/**
 * Compute gravitational acceleration at a given altitude above a celestial body.
 *
 * Uses inverse-square law: g = g₀ × (R / (R + h))²
 * Falls back to Earth's 9.81 m/s² if bodyId is undefined.
 */
export function gravityForBody(bodyId: string | undefined, altitude: number): number {
  const g0: number = bodyId ? getSurfaceGravity(bodyId) : G0;
  const R: number = bodyId ? (BODY_RADIUS[bodyId] ?? 6_371_000) : 6_371_000;
  const h: number = Math.max(0, altitude);
  // Inverse-square: negligible effect at low altitudes, significant in orbit.
  return g0 * (R * R) / ((R + h) * (R + h));
}

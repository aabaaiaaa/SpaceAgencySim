/**
 * trajectoryReadout.ts — Pure helper producing the HUD trajectory block.
 *
 * Combines:
 *   - Ballistic apoapsis   (1D parabolic estimate, good during vertical ascent)
 *   - Orbital apo / peri   (Keplerian, meaningful once a bound trajectory exists)
 *   - Target horizontal v  (circular velocity at the current or min-orbit altitude)
 *
 * The player uses the ballistic estimate to know "will I fall back?" and the
 * orbital values plus target velocity to know "am I on my way to / in orbit?".
 * Keeps both visible simultaneously so the difference is legible without
 * opening the map view.
 */

import {
  computeOrbitalElements,
  getPeriapsisAltitude,
  getApoapsisAltitude,
  getMinOrbitAltitude,
  circularOrbitVelocity,
} from './orbit.ts';

/** Standard gravity (m/s^2) — used for the ballistic apoapsis estimate. */
const G0 = 9.81;

/** Speed threshold below which a craft with near-zero altitude is treated as landed (m/s). */
const LANDED_SPEED_THRESHOLD = 1;

/** Altitude threshold below which a near-stationary craft is treated as landed (m). */
const LANDED_ALTITUDE_THRESHOLD = 100;

export type TrajectoryState = 'landed' | 'suborbital' | 'orbit' | 'escape';

export interface TrajectoryReadout {
  /** Ballistic coast apoapsis: altitude + velY^2 / (2·g0), floored at altitude. */
  ballisticApo: number;
  /** Orbital apoapsis (m above surface), or null if landed/escape. */
  orbitalApo: number | null;
  /** Orbital periapsis (m above surface, may be negative), or null if landed/escape. */
  orbitalPeri: number | null;
  /** Classification of the craft's trajectory. */
  state: TrajectoryState;
  /** Circular orbital velocity at targetAltitude for the current body (m/s). */
  targetHorizVelocity: number;
  /** Altitude the target velocity is evaluated at (m). max(currentAlt, minOrbitAltitude). */
  targetAltitude: number;
}

/**
 * Compute the trajectory readout for the HUD.
 *
 * @param posX    Horizontal position in game coords (m).
 * @param posY    Altitude above surface (m).
 * @param velX    Horizontal velocity (m/s).
 * @param velY    Vertical velocity (m/s).
 * @param bodyId  Celestial body ID (e.g. 'EARTH').
 */
export function computeTrajectoryReadout(
  posX: number,
  posY: number,
  velX: number,
  velY: number,
  bodyId: string,
): TrajectoryReadout {
  const altitude = Math.max(0, posY);
  const speed = Math.hypot(velX, velY);

  const ballisticApo = velY > 0
    ? altitude + (velY * velY) / (2 * G0)
    : altitude;

  const minOrbitAlt = getMinOrbitAltitude(bodyId);
  const targetAltitude = Math.max(altitude, minOrbitAlt);
  const targetHorizVelocity = circularOrbitVelocity(targetAltitude, bodyId);

  // Landed: craft is effectively on the surface with no meaningful motion.
  if (altitude < LANDED_ALTITUDE_THRESHOLD && speed < LANDED_SPEED_THRESHOLD) {
    return {
      ballisticApo,
      orbitalApo: null,
      orbitalPeri: null,
      state: 'landed',
      targetHorizVelocity,
      targetAltitude,
    };
  }

  const elements = computeOrbitalElements(posX, posY, velX, velY, bodyId);
  if (elements === null) {
    return {
      ballisticApo,
      orbitalApo: null,
      orbitalPeri: null,
      state: 'escape',
      targetHorizVelocity,
      targetAltitude,
    };
  }

  const orbitalPeri = getPeriapsisAltitude(elements, bodyId);
  const orbitalApo = getApoapsisAltitude(elements, bodyId);
  const state: TrajectoryState = orbitalPeri >= minOrbitAlt ? 'orbit' : 'suborbital';

  return {
    ballisticApo,
    orbitalApo,
    orbitalPeri,
    state,
    targetHorizVelocity,
    targetAltitude,
  };
}

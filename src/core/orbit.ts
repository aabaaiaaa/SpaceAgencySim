/**
 * orbit.ts — Simplified Keplerian orbit slot system.
 *
 * Replaces full N-body simulation with a 2D Keplerian two-body model once a
 * craft achieves orbit.  Orbits are defined by classical orbital elements
 * (semi-major axis, eccentricity, argument of periapsis, mean anomaly) and
 * propagated analytically using Kepler's equation.
 *
 * ALTITUDE BANDS
 *   Each celestial body defines fixed altitude ranges (e.g. LEO 80–200 km).
 *   An object's current band is determined by its instantaneous altitude.
 *   Elliptical orbits sweep through multiple bands as the object moves
 *   between periapsis and apoapsis.
 *
 * ANGULAR SEGMENTS
 *   The 360° around a body is divided into 36 segments of 10° each.
 *   An object's segment is derived from its absolute angular position
 *   (argument of periapsis + true anomaly).
 *
 * PROXIMITY DETECTION
 *   Two objects are "proximate" when:
 *     1. Angular distance < 5°, AND
 *     2. Both are in the same altitude band.
 *
 * WARP TO TARGET
 *   Simulates both orbits forward in time to find the earliest moment the
 *   proximity conditions are satisfied, or declares impossibility.
 *
 * COORDINATE MAPPING (game ↔ orbital)
 *   Game coordinates: posX = horizontal, posY = altitude above surface.
 *   Orbital frame: origin at body centre; r = posY + R_body.
 *   Position vector from body centre: (posX, posY + R_body).
 *   Velocity is unchanged: (velX, velY).
 *
 * @module orbit
 */

import {
  BODY_GM,
  BODY_RADIUS,
  ALTITUDE_BANDS,
  MIN_ORBIT_ALTITUDE,
  ORBIT_SEGMENTS,
  PROXIMITY_ANGLE_DEG,
} from './constants.ts';

import type { AltitudeBand } from './constants.ts';
import type { OrbitalElements, OrbitalObject } from './gameState.ts';

// ---------------------------------------------------------------------------
// Interfaces for complex return types
// ---------------------------------------------------------------------------

/** Instantaneous orbital state at a given time. */
export interface OrbitalState {
  /** True anomaly at time t (radians). */
  trueAnomaly: number;
  /** Radial distance from body centre (m). */
  radius: number;
  /** Altitude above body surface (m). */
  altitude: number;
  /** Absolute angular position in degrees [0, 360). */
  angularPositionDeg: number;
}

/** Result of checking whether a craft is in a valid orbit. */
export interface OrbitStatus {
  /** True if the orbit is stable (bound ellipse with periapsis above min altitude). */
  valid: boolean;
  /** Computed orbital elements, or null if trajectory is not a bound orbit. */
  elements: OrbitalElements | null;
  /** Periapsis altitude above surface (m). */
  periapsisAlt: number;
  /** Apoapsis altitude above surface (m). */
  apoapsisAlt: number;
  /** Altitude band at periapsis, or null. */
  altitudeBand: AltitudeBand | null;
}

/** Result of a warp-to-target search. */
export interface WarpResult {
  /** Whether a proximity window was found. */
  possible: boolean;
  /** Absolute time of proximity, or null if not found. */
  time: number | null;
  /** Seconds elapsed from startTime to proximity, or null if not found. */
  elapsed: number | null;
}

/** Minimal orbital state used for proximity checks. */
export interface ProximityState {
  altitude: number;
  angularPositionDeg: number;
}

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;
const RAD_TO_DEG = 180 / Math.PI;

/** Maximum iterations for Newton-Raphson Kepler solver. */
const KEPLER_MAX_ITER = 50;

/** Convergence tolerance for Kepler solver (radians). */
const KEPLER_TOLERANCE = 1e-12;

/** Below this eccentricity, treat the orbit as perfectly circular. */
const CIRCULAR_THRESHOLD = 1e-8;

/**
 * Get the minimum stable orbit altitude for a given celestial body.
 *
 * @param bodyId  Celestial body ID.
 * @returns Minimum orbit altitude in metres.
 */
export function getMinOrbitAltitude(bodyId: string): number {
  return MIN_ORBIT_ALTITUDE[bodyId] ?? 70_000;
}

// ---------------------------------------------------------------------------
// Kepler's equation solver
// ---------------------------------------------------------------------------

/**
 * Solve Kepler's equation  M = E − e·sin(E)  for eccentric anomaly E.
 *
 * Uses Newton-Raphson iteration with M as the initial guess.
 *
 * @param M  Mean anomaly (radians).
 * @param e  Eccentricity (0 ≤ e < 1).
 * @returns Eccentric anomaly E (radians).
 */
export function solveKepler(M: number, e: number): number {
  if (e < CIRCULAR_THRESHOLD) return M;

  // Normalise M to [0, 2π)
  M = ((M % TWO_PI) + TWO_PI) % TWO_PI;

  let E = M; // initial guess
  for (let i = 0; i < KEPLER_MAX_ITER; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < KEPLER_TOLERANCE) break;
  }
  return E;
}

// ---------------------------------------------------------------------------
// Anomaly conversions
// ---------------------------------------------------------------------------

/**
 * Convert mean anomaly to true anomaly via eccentric anomaly.
 *
 * @param M  Mean anomaly (radians).
 * @param e  Eccentricity.
 * @returns True anomaly θ in [0, 2π).
 */
export function meanAnomalyToTrue(M: number, e: number): number {
  if (e < CIRCULAR_THRESHOLD) return ((M % TWO_PI) + TWO_PI) % TWO_PI;

  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const theta = Math.atan2(
    Math.sqrt(Math.max(0, 1 - e * e)) * sinE,
    cosE - e,
  );
  return ((theta % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Convert true anomaly to eccentric anomaly.
 *
 * @param theta  True anomaly (radians).
 * @param e      Eccentricity.
 * @returns Eccentric anomaly E in [0, 2π).
 */
export function trueToEccentricAnomaly(theta: number, e: number): number {
  if (e < CIRCULAR_THRESHOLD) return ((theta % TWO_PI) + TWO_PI) % TWO_PI;

  const E = Math.atan2(
    Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(theta),
    e + Math.cos(theta),
  );
  return ((E % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Convert true anomaly to mean anomaly.
 *
 * @param theta  True anomaly (radians).
 * @param e      Eccentricity.
 * @returns Mean anomaly M in [0, 2π).
 */
export function trueAnomalyToMean(theta: number, e: number): number {
  if (e < CIRCULAR_THRESHOLD) return ((theta % TWO_PI) + TWO_PI) % TWO_PI;

  const E = trueToEccentricAnomaly(theta, e);
  const M = E - e * Math.sin(E);
  return ((M % TWO_PI) + TWO_PI) % TWO_PI;
}

// ---------------------------------------------------------------------------
// Orbital element computation from state vectors
// ---------------------------------------------------------------------------

/**
 * Compute Keplerian orbital elements from game-coordinate state vectors.
 *
 * Returns null if the trajectory is not a bound elliptical orbit (i.e. the
 * specific orbital energy is non-negative → hyperbolic/escape).
 *
 * @param posX    Horizontal position in game coords (m).
 * @param posY    Altitude above surface (m).
 * @param velX    Horizontal velocity (m/s).
 * @param velY    Vertical velocity (m/s).
 * @param bodyId  Celestial body ID (e.g. 'EARTH').
 * @param epoch   Reference time for the epoch.
 * @returns Elements, or null if not a bound orbit.
 */
export function computeOrbitalElements(posX: number, posY: number, velX: number, velY: number, bodyId: string, epoch: number = 0): OrbitalElements | null {
  const mu = BODY_GM[bodyId];
  const R = BODY_RADIUS[bodyId];
  if (mu == null || R == null) return null;

  // Position and velocity in body-centred frame.
  const x = posX;
  const y = posY + R;
  const r = Math.sqrt(x * x + y * y);
  if (r <= 0) return null;
  const v2 = velX * velX + velY * velY;

  // Specific angular momentum (scalar, 2D cross product z-component).
  const h = x * velY - y * velX;

  // Specific orbital energy.
  const epsilon = v2 / 2 - mu / r;

  // Must be negative for a bound (elliptical) orbit.
  if (epsilon >= 0) return null;

  // Semi-major axis.
  const a = -mu / (2 * epsilon);

  // Semi-latus rectum.
  const p = (h * h) / mu;

  // Eccentricity.
  const eSquared = Math.max(0, 1 - p / a);
  const e = Math.sqrt(eSquared);

  // Eccentricity vector (points from focus toward periapsis).
  const rdotv = x * velX + y * velY; // r⃗ · v⃗
  const coeff = v2 - mu / r;
  const ex = (coeff * x - rdotv * velX) / mu;
  const ey = (coeff * y - rdotv * velY) / mu;

  // Argument of periapsis (angle of eccentricity vector from reference).
  let omega: number;
  if (e < CIRCULAR_THRESHOLD) {
    omega = 0;
  } else {
    omega = Math.atan2(ey, ex);
  }

  // True anomaly: angle from periapsis direction to current position.
  let theta: number;
  if (e < CIRCULAR_THRESHOLD) {
    theta = Math.atan2(y, x);
  } else {
    const posAngle = Math.atan2(y, x);
    theta = posAngle - omega;
  }
  theta = ((theta % TWO_PI) + TWO_PI) % TWO_PI;

  // Convert true anomaly → mean anomaly for epoch storage.
  const M0 = trueAnomalyToMean(theta, e);

  return {
    semiMajorAxis: a,
    eccentricity: e,
    argPeriapsis: ((omega % TWO_PI) + TWO_PI) % TWO_PI,
    meanAnomalyAtEpoch: M0,
    epoch,
  };
}

// ---------------------------------------------------------------------------
// Orbital period & mean motion
// ---------------------------------------------------------------------------

/**
 * Orbital period for an elliptical orbit.
 *
 * @param a       Semi-major axis (m).
 * @param bodyId  Celestial body ID.
 * @returns Period in seconds.
 */
export function getOrbitalPeriod(a: number, bodyId: string): number {
  const mu = BODY_GM[bodyId];
  return TWO_PI * Math.sqrt((a * a * a) / mu);
}

/**
 * Mean motion (radians per second).
 *
 * @param a       Semi-major axis (m).
 * @param bodyId  Celestial body ID.
 * @returns n (rad/s).
 */
export function getMeanMotion(a: number, bodyId: string): number {
  const mu = BODY_GM[bodyId];
  return Math.sqrt(mu / (a * a * a));
}

// ---------------------------------------------------------------------------
// Position queries
// ---------------------------------------------------------------------------

/**
 * Compute the orbital state of an object at a given time.
 *
 * @param elements  Orbital elements.
 * @param t         Absolute time (seconds, same frame as epoch).
 * @param bodyId    Celestial body ID.
 */
export function getOrbitalStateAtTime(elements: OrbitalElements, t: number, bodyId: string): OrbitalState {
  const { semiMajorAxis: a, eccentricity: e, argPeriapsis: omega, meanAnomalyAtEpoch: M0, epoch } = elements;
  const R = BODY_RADIUS[bodyId];
  const n = getMeanMotion(a, bodyId);

  // Mean anomaly at time t.
  const M = M0 + n * (t - epoch);

  // True anomaly.
  const theta = meanAnomalyToTrue(M, e);

  // Radial distance: r = a(1 − e²) / (1 + e·cos θ).
  const p = a * (1 - e * e);
  const radius = p / (1 + e * Math.cos(theta));

  // Altitude above surface.
  const altitude = radius - R;

  // Absolute angular position (degrees): ω + θ mapped to [0, 360).
  const angularPositionDeg = (((omega + theta) * RAD_TO_DEG) % 360 + 360) % 360;

  return { trueAnomaly: theta, radius, altitude, angularPositionDeg };
}

/**
 * Circular orbit velocity at a given altitude.
 *
 * @param altitude  Metres above the surface.
 * @param bodyId    Celestial body ID.
 * @returns Orbital velocity in m/s.
 */
export function circularOrbitVelocity(altitude: number, bodyId: string): number {
  const mu = BODY_GM[bodyId];
  const R = BODY_RADIUS[bodyId];
  return Math.sqrt(mu / (R + altitude));
}

/**
 * Cartesian state (posX, posY, velX, velY) from orbital elements at a given time.
 *
 * Converts the Keplerian orbital state to the flat coordinate system used by
 * the physics engine and renderer.  posY is altitude above the body surface;
 * posX is lateral displacement (zero at orbit start, evolves with anomaly).
 *
 * In the game's 2D coordinate frame:
 *   - posY = altitude above surface
 *   - posX = lateral displacement
 *   - The body centre is at (0, -R) in physics coordinates
 */
export function orbitalStateToCartesian(
  elements: OrbitalElements,
  t: number,
  bodyId: string,
): { posX: number; posY: number; velX: number; velY: number } {
  const mu = BODY_GM[bodyId];
  const R = BODY_RADIUS[bodyId];
  const { semiMajorAxis: a, eccentricity: e, meanAnomalyAtEpoch: M0, epoch } = elements;

  // Mean anomaly at time t.
  const n = getMeanMotion(a, bodyId);
  const M = M0 + n * (t - epoch);

  // True anomaly.
  const theta = meanAnomalyToTrue(M, e);

  // Radial distance from body centre.
  const p = a * (1 - e * e);
  const r = p / (1 + e * Math.cos(theta));

  // Game coordinate conversion:
  //   posY = altitude above surface (varies between periapsis/apoapsis for elliptical orbits)
  //   posX = 0 (the craft's orbital motion is shown on the map view, not in the flight view)
  // The flight view is a local frame where "down" is toward the body.
  const altitude = r - R;
  const posX = 0;
  const posY = altitude;

  // Velocity via vis-viva equation: v² = μ(2/r - 1/a)
  // Guard against stale orbital elements producing a negative argument (e.g. after
  // a de-orbit burn changes velocity without recalculating elements).
  const visViva = mu * (2 / r - 1 / a);
  const speed = visViva > 0 ? Math.sqrt(visViva) : 0;

  // Flight path angle: γ = atan2(e·sin θ, 1 + e·cos θ)
  const gamma = Math.atan2(e * Math.sin(theta), 1 + e * Math.cos(theta));

  // In the game's flat frame: most velocity is horizontal (along the orbit).
  // The radial component (velY) oscillates for elliptical orbits.
  // velX = speed × cos(γ)  (tangential / horizontal component)
  // velY = speed × sin(γ)  (radial / vertical component, positive = away from body)
  const velX = speed * Math.cos(gamma);
  const velY = speed * Math.sin(gamma);

  // Guard: if any value is NaN/Infinity (bad elements or numerical edge case),
  // return zeroes rather than propagating corruption into the physics loop.
  if (!Number.isFinite(posY) || !Number.isFinite(velX) || !Number.isFinite(velY)) {
    return { posX: 0, posY: 0, velX: 0, velY: 0 };
  }

  return { posX, posY, velX, velY };
}

/**
 * Periapsis altitude (above surface).
 *
 * @param elements  Orbital elements.
 * @param bodyId    Celestial body ID.
 * @returns Metres above surface.
 */
export function getPeriapsisAltitude(elements: OrbitalElements, bodyId: string): number {
  const rPeri = elements.semiMajorAxis * (1 - elements.eccentricity);
  return rPeri - BODY_RADIUS[bodyId];
}

/**
 * Apoapsis altitude (above surface).
 *
 * @param elements  Orbital elements.
 * @param bodyId    Celestial body ID.
 * @returns Metres above surface.
 */
export function getApoapsisAltitude(elements: OrbitalElements, bodyId: string): number {
  const rApo = elements.semiMajorAxis * (1 + elements.eccentricity);
  return rApo - BODY_RADIUS[bodyId];
}

// ---------------------------------------------------------------------------
// Altitude bands
// ---------------------------------------------------------------------------

/**
 * Determine which altitude band an object is in.
 *
 * @param altitude  Altitude above surface (m).
 * @param bodyId    Celestial body ID.
 * @returns The matching band, or null if outside all defined bands.
 */
export function getAltitudeBand(altitude: number, bodyId: string): AltitudeBand | null {
  const bands = ALTITUDE_BANDS[bodyId];
  if (!bands) return null;

  for (const band of bands) {
    if (altitude >= band.min && altitude < band.max) return band;
  }
  return null;
}

/**
 * Get the ID string of the altitude band, or null.
 *
 * @param altitude  Altitude above surface (m).
 * @param bodyId    Celestial body ID.
 */
export function getAltitudeBandId(altitude: number, bodyId: string): string | null {
  const band = getAltitudeBand(altitude, bodyId);
  return band ? band.id : null;
}

/**
 * Check whether an orbit's altitude range overlaps with a specific band.
 *
 * @param elements  Orbital elements.
 * @param bandId    e.g. 'LEO'
 * @param bodyId    Celestial body ID.
 */
export function orbitOverlapsBand(elements: OrbitalElements, bandId: string, bodyId: string): boolean {
  const bands = ALTITUDE_BANDS[bodyId];
  if (!bands) return false;
  const band = bands.find(b => b.id === bandId);
  if (!band) return false;

  const periAlt = getPeriapsisAltitude(elements, bodyId);
  const apoAlt = getApoapsisAltitude(elements, bodyId);

  // Orbit overlaps band if its altitude range intersects the band's range.
  return periAlt < band.max && apoAlt >= band.min;
}

// ---------------------------------------------------------------------------
// Angular segments
// ---------------------------------------------------------------------------

/**
 * Map an angular position (degrees) to one of the 36 segments.
 *
 * @param angleDeg  Angular position in degrees [0, 360).
 * @returns Segment index (0–35).
 */
export function getAngularSegment(angleDeg: number): number {
  const normalised = ((angleDeg % 360) + 360) % 360;
  return Math.floor(normalised / (360 / ORBIT_SEGMENTS));
}

/**
 * Shortest angular distance between two angles (always positive, ≤ 180°).
 *
 * @param a  First angle (degrees).
 * @param b  Second angle (degrees).
 * @returns Distance in degrees (0–180).
 */
export function angularDistance(a: number, b: number): number {
  let d = ((a - b) % 360 + 360) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

// ---------------------------------------------------------------------------
// Proximity detection
// ---------------------------------------------------------------------------

/**
 * Check whether two orbital states satisfy the proximity condition:
 *   angular distance < 5° AND same altitude band.
 *
 * @param state1  First orbital state.
 * @param state2  Second orbital state.
 * @param bodyId  Celestial body ID.
 */
export function checkProximity(state1: ProximityState, state2: ProximityState, bodyId: string): boolean {
  // Angular distance check.
  const angleDist = angularDistance(state1.angularPositionDeg, state2.angularPositionDeg);
  if (angleDist >= PROXIMITY_ANGLE_DEG) return false;

  // Altitude band check.
  const band1 = getAltitudeBandId(state1.altitude, bodyId);
  const band2 = getAltitudeBandId(state2.altitude, bodyId);
  if (band1 == null || band2 == null) return false;
  return band1 === band2;
}

// ---------------------------------------------------------------------------
// Orbit entry detection
// ---------------------------------------------------------------------------

/**
 * Determine whether the craft's current state constitutes a valid orbit.
 *
 * A valid orbit requires:
 *   1. The trajectory is a bound ellipse (specific energy < 0).
 *   2. Periapsis altitude ≥ minimum stable orbit altitude for that body.
 *
 * @param posX    Horizontal position (m).
 * @param posY    Altitude above surface (m).
 * @param velX    Horizontal velocity (m/s).
 * @param velY    Vertical velocity (m/s).
 * @param bodyId  Celestial body ID.
 */
export function checkOrbitStatus(posX: number, posY: number, velX: number, velY: number, bodyId: string): OrbitStatus {
  const elements = computeOrbitalElements(posX, posY, velX, velY, bodyId);

  if (!elements) {
    return { valid: false, elements: null, periapsisAlt: 0, apoapsisAlt: 0, altitudeBand: null };
  }

  const periapsisAlt = getPeriapsisAltitude(elements, bodyId);
  const apoapsisAlt = getApoapsisAltitude(elements, bodyId);
  const minAlt = getMinOrbitAltitude(bodyId);
  const valid = periapsisAlt >= minAlt;

  // Determine which altitude band the craft's periapsis falls in.
  const altitudeBand = valid ? getAltitudeBand(periapsisAlt, bodyId) : null;

  return { valid, elements, periapsisAlt, apoapsisAlt, altitudeBand };
}

/**
 * Get the human-readable altitude band label for an orbit entry notification.
 * Returns the band name (e.g. "Low Earth Orbit") if the periapsis is within
 * a named band, otherwise falls back to "Orbit".
 *
 * @param orbitStatus  Result from checkOrbitStatus.
 */
export function getOrbitEntryLabel(orbitStatus: { altitudeBand: { id: string; name: string } | null } | null): string {
  if (orbitStatus && orbitStatus.altitudeBand) {
    return orbitStatus.altitudeBand.name;
  }
  return 'Orbit';
}

// ---------------------------------------------------------------------------
// Orbital object management
// ---------------------------------------------------------------------------

/** Options for creating a new orbital object. */
interface CreateOrbitalObjectOpts {
  id: string;
  bodyId: string;
  type: string;
  name: string;
  elements: OrbitalElements;
  /** Linked RocketDesign id — enables the Tracking Station Take-Control flow. */
  rocketDesignId?: string;
}

/**
 * Create a new orbital object.
 *
 * @param opts  Object creation options.
 */
export function createOrbitalObject({ id, bodyId, type, name, elements, rocketDesignId }: CreateOrbitalObjectOpts): OrbitalObject {
  return {
    id,
    bodyId,
    type,
    name,
    elements: { ...elements },
    ...(rocketDesignId ? { rocketDesignId } : {}),
  };
}

/**
 * Update all orbital objects by advancing their epoch to the new time.
 *
 * Because Keplerian orbits are analytical, "ticking" just means updating the
 * epoch so that `getOrbitalStateAtTime(elements, newTime)` returns the
 * correct position.  The elements themselves don't change for an unperturbed
 * two-body orbit — only the epoch reference advances.
 *
 * This function re-bases the epoch and mean anomaly so that the epoch always
 * reflects the most recent update time.  This prevents floating-point drift
 * when (t − epoch) grows very large.
 *
 * @param objects  Array of orbital objects (mutated in place).
 * @param newTime  New absolute time (seconds).
 */
export function tickOrbitalObjects(objects: OrbitalObject[], newTime: number): void {
  for (const obj of objects) {
    rebaseEpoch(obj.elements, newTime, obj.bodyId);
  }
}

/**
 * Rebase an orbit's epoch to a new time without changing the orbit.
 *
 * Computes the mean anomaly at `newEpoch` and stores it as M₀, then sets
 * epoch = newEpoch.
 *
 * @param elements  Mutated in place.
 * @param newEpoch  New epoch time (seconds).
 * @param bodyId    Celestial body ID.
 */
export function rebaseEpoch(elements: OrbitalElements, newEpoch: number, bodyId: string): void {
  const n = getMeanMotion(elements.semiMajorAxis, bodyId);
  const dt = newEpoch - elements.epoch;
  const M = elements.meanAnomalyAtEpoch + n * dt;
  elements.meanAnomalyAtEpoch = ((M % TWO_PI) + TWO_PI) % TWO_PI;
  elements.epoch = newEpoch;
}

// ---------------------------------------------------------------------------
// Warp to target
// ---------------------------------------------------------------------------

/**
 * Find the earliest time at which a craft will be proximate to a target, or
 * determine that proximity is impossible.
 *
 * Searches forward in time from `startTime` up to `maxSearchTime` seconds.
 *
 * @param craftElements   Craft's orbital elements.
 * @param targetElements  Target's orbital elements.
 * @param bodyId          Celestial body ID.
 * @param startTime       Time to begin searching (seconds).
 * @param maxSearchTime   Maximum seconds to search forward.
 *   Defaults to 2× the synodic period (or 2× the longer orbital period if
 *   the periods are nearly equal).
 */
export function warpToTarget(craftElements: OrbitalElements, targetElements: OrbitalElements, bodyId: string, startTime: number, maxSearchTime?: number): WarpResult {
  const T_craft = getOrbitalPeriod(craftElements.semiMajorAxis, bodyId);
  const T_target = getOrbitalPeriod(targetElements.semiMajorAxis, bodyId);

  // Check altitude band overlap: if the two orbits never share a band,
  // proximity is impossible.
  if (!_orbitsShareBand(craftElements, targetElements, bodyId)) {
    return { possible: false, time: null, elapsed: null };
  }

  // Determine search duration.
  if (maxSearchTime == null) {
    const periodDiff = Math.abs(T_craft - T_target);
    if (periodDiff < 0.01) {
      // Nearly identical periods — they never converge/diverge.
      // Just check the current state.
      maxSearchTime = Math.max(T_craft, T_target);
    } else {
      // Synodic period: time between successive alignments.
      const T_syn = Math.abs(T_craft * T_target / (T_craft - T_target));
      const maxPeriod = Math.max(T_craft, T_target);
      // Cap synodic period to prevent extremely long searches when
      // T_craft ≈ T_target (periodDiff in 0.01–0.1 range).
      if (!Number.isFinite(T_syn) || T_syn > 10 * maxPeriod) {
        maxSearchTime = maxPeriod;
      } else {
        maxSearchTime = 2 * T_syn;
      }
    }
    // Hard cap to prevent absurdly long searches.
    maxSearchTime = Math.min(maxSearchTime, 365.25 * 24 * 3600); // 1 year
  }

  // Step size: ~0.5° of the faster orbit, ensuring we don't skip a 5° window.
  const T_min = Math.min(T_craft, T_target);
  const stepSize = Math.max(1, T_min / 720);

  let t = startTime;
  const endTime = startTime + maxSearchTime;

  while (t < endTime) {
    const craftState = getOrbitalStateAtTime(craftElements, t, bodyId);
    const targetState = getOrbitalStateAtTime(targetElements, t, bodyId);

    if (checkProximity(craftState, targetState, bodyId)) {
      return { possible: true, time: t, elapsed: t - startTime };
    }

    t += stepSize;
  }

  return { possible: false, time: null, elapsed: null };
}

/**
 * Check if two orbits share any altitude band (their altitude ranges overlap
 * within at least one common band).
 *
 * @param elem1   First orbit's elements.
 * @param elem2   Second orbit's elements.
 * @param bodyId  Celestial body ID.
 */
function _orbitsShareBand(elem1: OrbitalElements, elem2: OrbitalElements, bodyId: string): boolean {
  const bands = ALTITUDE_BANDS[bodyId];
  if (!bands) return false;

  const peri1 = getPeriapsisAltitude(elem1, bodyId);
  const apo1 = getApoapsisAltitude(elem1, bodyId);
  const peri2 = getPeriapsisAltitude(elem2, bodyId);
  const apo2 = getApoapsisAltitude(elem2, bodyId);

  for (const band of bands) {
    const orbit1InBand = peri1 < band.max && apo1 >= band.min;
    const orbit2InBand = peri2 < band.max && apo2 >= band.min;
    if (orbit1InBand && orbit2InBand) return true;
  }
  return false;
}

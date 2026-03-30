/**
 * orbit.js — Simplified Keplerian orbit slot system.
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
  ORBIT_SEGMENTS,
  PROXIMITY_ANGLE_DEG,
  CelestialBody,
} from './constants.js';

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Maximum iterations for Newton-Raphson Kepler solver. */
const KEPLER_MAX_ITER = 50;

/** Convergence tolerance for Kepler solver (radians). */
const KEPLER_TOLERANCE = 1e-12;

/** Below this eccentricity, treat the orbit as perfectly circular. */
const CIRCULAR_THRESHOLD = 1e-8;

/** Minimum altitude above atmosphere for a valid orbit (m). */
const MIN_ORBIT_ALTITUDE = 70_000;

// ---------------------------------------------------------------------------
// Kepler's equation solver
// ---------------------------------------------------------------------------

/**
 * Solve Kepler's equation  M = E − e·sin(E)  for eccentric anomaly E.
 *
 * Uses Newton-Raphson iteration with M as the initial guess.
 *
 * @param {number} M  Mean anomaly (radians).
 * @param {number} e  Eccentricity (0 ≤ e < 1).
 * @returns {number}  Eccentric anomaly E (radians).
 */
export function solveKepler(M, e) {
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
 * @param {number} M  Mean anomaly (radians).
 * @param {number} e  Eccentricity.
 * @returns {number}  True anomaly θ in [0, 2π).
 */
export function meanAnomalyToTrue(M, e) {
  if (e < CIRCULAR_THRESHOLD) return ((M % TWO_PI) + TWO_PI) % TWO_PI;

  const E = solveKepler(M, e);
  const cosE = Math.cos(E);
  const sinE = Math.sin(E);
  const theta = Math.atan2(
    Math.sqrt(1 - e * e) * sinE,
    cosE - e,
  );
  return ((theta % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Convert true anomaly to eccentric anomaly.
 *
 * @param {number} theta  True anomaly (radians).
 * @param {number} e      Eccentricity.
 * @returns {number}  Eccentric anomaly E in [0, 2π).
 */
export function trueToEccentricAnomaly(theta, e) {
  if (e < CIRCULAR_THRESHOLD) return ((theta % TWO_PI) + TWO_PI) % TWO_PI;

  const E = Math.atan2(
    Math.sqrt(1 - e * e) * Math.sin(theta),
    e + Math.cos(theta),
  );
  return ((E % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Convert true anomaly to mean anomaly.
 *
 * @param {number} theta  True anomaly (radians).
 * @param {number} e      Eccentricity.
 * @returns {number}  Mean anomaly M in [0, 2π).
 */
export function trueAnomalyToMean(theta, e) {
  if (e < CIRCULAR_THRESHOLD) return ((theta % TWO_PI) + TWO_PI) % TWO_PI;

  const E = trueToEccentricAnomaly(theta, e);
  const M = E - e * Math.sin(E);
  return ((M % TWO_PI) + TWO_PI) % TWO_PI;
}

// ---------------------------------------------------------------------------
// Orbital element computation from state vectors
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} OrbitalElements
 * @property {number} semiMajorAxis      Semi-major axis (m from body centre).
 * @property {number} eccentricity       Eccentricity (0 = circular, 0 < e < 1 = elliptical).
 * @property {number} argPeriapsis       Argument of periapsis ω (radians).
 * @property {number} meanAnomalyAtEpoch Mean anomaly M₀ at the epoch (radians).
 * @property {number} epoch              Reference time (seconds) for M₀.
 */

/**
 * Compute Keplerian orbital elements from game-coordinate state vectors.
 *
 * Returns null if the trajectory is not a bound elliptical orbit (i.e. the
 * specific orbital energy is non-negative → hyperbolic/escape).
 *
 * @param {number} posX    Horizontal position in game coords (m).
 * @param {number} posY    Altitude above surface (m).
 * @param {number} velX    Horizontal velocity (m/s).
 * @param {number} velY    Vertical velocity (m/s).
 * @param {string} bodyId  Celestial body ID (e.g. 'EARTH').
 * @param {number} [epoch=0]  Reference time for the epoch.
 * @returns {OrbitalElements|null}  Elements, or null if not a bound orbit.
 */
export function computeOrbitalElements(posX, posY, velX, velY, bodyId, epoch = 0) {
  const mu = BODY_GM[bodyId];
  const R = BODY_RADIUS[bodyId];
  if (mu == null || R == null) return null;

  // Position and velocity in body-centred frame.
  const x = posX;
  const y = posY + R;
  const r = Math.sqrt(x * x + y * y);
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
  let omega;
  if (e < CIRCULAR_THRESHOLD) {
    omega = 0;
  } else {
    omega = Math.atan2(ey, ex);
  }

  // True anomaly: angle from periapsis direction to current position.
  let theta;
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
 * @param {number} a       Semi-major axis (m).
 * @param {string} bodyId  Celestial body ID.
 * @returns {number}  Period in seconds.
 */
export function getOrbitalPeriod(a, bodyId) {
  const mu = BODY_GM[bodyId];
  return TWO_PI * Math.sqrt((a * a * a) / mu);
}

/**
 * Mean motion (radians per second).
 *
 * @param {number} a       Semi-major axis (m).
 * @param {string} bodyId  Celestial body ID.
 * @returns {number}  n (rad/s).
 */
export function getMeanMotion(a, bodyId) {
  const mu = BODY_GM[bodyId];
  return Math.sqrt(mu / (a * a * a));
}

// ---------------------------------------------------------------------------
// Position queries
// ---------------------------------------------------------------------------

/**
 * Compute the orbital state of an object at a given time.
 *
 * @param {OrbitalElements} elements  Orbital elements.
 * @param {number}          t         Absolute time (seconds, same frame as epoch).
 * @param {string}          bodyId    Celestial body ID.
 * @returns {{ trueAnomaly: number, radius: number, altitude: number, angularPositionDeg: number }}
 */
export function getOrbitalStateAtTime(elements, t, bodyId) {
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
 * @param {number} altitude  Metres above the surface.
 * @param {string} bodyId    Celestial body ID.
 * @returns {number}  Orbital velocity in m/s.
 */
export function circularOrbitVelocity(altitude, bodyId) {
  const mu = BODY_GM[bodyId];
  const R = BODY_RADIUS[bodyId];
  return Math.sqrt(mu / (R + altitude));
}

/**
 * Periapsis altitude (above surface).
 *
 * @param {OrbitalElements} elements
 * @param {string}          bodyId
 * @returns {number}  Metres above surface.
 */
export function getPeriapsisAltitude(elements, bodyId) {
  const rPeri = elements.semiMajorAxis * (1 - elements.eccentricity);
  return rPeri - BODY_RADIUS[bodyId];
}

/**
 * Apoapsis altitude (above surface).
 *
 * @param {OrbitalElements} elements
 * @param {string}          bodyId
 * @returns {number}  Metres above surface.
 */
export function getApoapsisAltitude(elements, bodyId) {
  const rApo = elements.semiMajorAxis * (1 + elements.eccentricity);
  return rApo - BODY_RADIUS[bodyId];
}

// ---------------------------------------------------------------------------
// Altitude bands
// ---------------------------------------------------------------------------

/**
 * Determine which altitude band an object is in.
 *
 * @param {number} altitude  Altitude above surface (m).
 * @param {string} bodyId    Celestial body ID.
 * @returns {{ id: string, name: string, min: number, max: number }|null}
 *   The matching band, or null if outside all defined bands.
 */
export function getAltitudeBand(altitude, bodyId) {
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
 * @param {number} altitude
 * @param {string} bodyId
 * @returns {string|null}
 */
export function getAltitudeBandId(altitude, bodyId) {
  const band = getAltitudeBand(altitude, bodyId);
  return band ? band.id : null;
}

/**
 * Check whether an orbit's altitude range overlaps with a specific band.
 *
 * @param {OrbitalElements} elements
 * @param {string}          bandId   e.g. 'LEO'
 * @param {string}          bodyId
 * @returns {boolean}
 */
export function orbitOverlapsBand(elements, bandId, bodyId) {
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
 * @param {number} angleDeg  Angular position in degrees [0, 360).
 * @returns {number}  Segment index (0–35).
 */
export function getAngularSegment(angleDeg) {
  const normalised = ((angleDeg % 360) + 360) % 360;
  return Math.floor(normalised / (360 / ORBIT_SEGMENTS));
}

/**
 * Shortest angular distance between two angles (always positive, ≤ 180°).
 *
 * @param {number} a  First angle (degrees).
 * @param {number} b  Second angle (degrees).
 * @returns {number}  Distance in degrees (0–180).
 */
export function angularDistance(a, b) {
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
 * @param {{ altitude: number, angularPositionDeg: number }} state1
 * @param {{ altitude: number, angularPositionDeg: number }} state2
 * @param {string} bodyId
 * @returns {boolean}
 */
export function checkProximity(state1, state2, bodyId) {
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
 *   2. Periapsis altitude > 70 km (above the atmosphere).
 *
 * @param {number} posX    Horizontal position (m).
 * @param {number} posY    Altitude above surface (m).
 * @param {number} velX    Horizontal velocity (m/s).
 * @param {number} velY    Vertical velocity (m/s).
 * @param {string} bodyId  Celestial body ID.
 * @returns {{ valid: boolean, elements: OrbitalElements|null, periapsisAlt: number, apoapsisAlt: number }}
 */
export function checkOrbitStatus(posX, posY, velX, velY, bodyId) {
  const elements = computeOrbitalElements(posX, posY, velX, velY, bodyId);

  if (!elements) {
    return { valid: false, elements: null, periapsisAlt: 0, apoapsisAlt: 0 };
  }

  const periapsisAlt = getPeriapsisAltitude(elements, bodyId);
  const apoapsisAlt = getApoapsisAltitude(elements, bodyId);
  const valid = periapsisAlt >= MIN_ORBIT_ALTITUDE;

  return { valid, elements, periapsisAlt, apoapsisAlt };
}

// ---------------------------------------------------------------------------
// Orbital object management
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} OrbitalObject
 * @property {string}          id        Unique identifier.
 * @property {string}          bodyId    Celestial body this object orbits.
 * @property {string}          type      OrbitalObjectType value.
 * @property {string}          name      Display name.
 * @property {OrbitalElements} elements  Current orbital elements.
 */

/**
 * Create a new orbital object.
 *
 * @param {{ id: string, bodyId: string, type: string, name: string, elements: OrbitalElements }} opts
 * @returns {OrbitalObject}
 */
export function createOrbitalObject({ id, bodyId, type, name, elements }) {
  return {
    id,
    bodyId,
    type,
    name,
    elements: { ...elements },
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
 * @param {OrbitalObject[]} objects  Array of orbital objects (mutated in place).
 * @param {number}          newTime  New absolute time (seconds).
 */
export function tickOrbitalObjects(objects, newTime) {
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
 * @param {OrbitalElements} elements  Mutated in place.
 * @param {number}          newEpoch  New epoch time (seconds).
 * @param {string}          bodyId    Celestial body ID.
 */
export function rebaseEpoch(elements, newEpoch, bodyId) {
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
 * @param {OrbitalElements} craftElements   Craft's orbital elements.
 * @param {OrbitalElements} targetElements  Target's orbital elements.
 * @param {string}          bodyId          Celestial body ID.
 * @param {number}          startTime       Time to begin searching (seconds).
 * @param {number}          [maxSearchTime] Maximum seconds to search forward.
 *   Defaults to 2× the synodic period (or 2× the longer orbital period if
 *   the periods are nearly equal).
 * @returns {{ possible: boolean, time: number|null, elapsed: number|null }}
 *   `possible` is false if no proximity window was found.  Otherwise `time`
 *   is the absolute time and `elapsed` is seconds from `startTime`.
 */
export function warpToTarget(craftElements, targetElements, bodyId, startTime, maxSearchTime) {
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
      maxSearchTime = 2 * T_syn;
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
 * @param {OrbitalElements} elem1
 * @param {OrbitalElements} elem2
 * @param {string}          bodyId
 * @returns {boolean}
 */
function _orbitsShareBand(elem1, elem2, bodyId) {
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

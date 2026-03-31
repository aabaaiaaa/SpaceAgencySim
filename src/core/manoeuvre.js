/**
 * manoeuvre.js — Orbital manoeuvre system.
 *
 * Provides orbit recalculation after burns, interplanetary transfer delta-v
 * calculations, SOI transition detection, gravitational assist computation,
 * and route planning for the map view.
 *
 * DESIGN: No manoeuvre menu — all orbital changes are done by hand.
 *   - Normal mode: engine burns directly modify the orbit.
 *     Prograde raises the opposite side, retrograde lowers it.
 *   - Docking mode: burns affect local position only (unchanged).
 *   - Transfers: player manually applies delta-v at the correct orbital point.
 *   - Map view shows target bodies with required delta-v for direct transfers.
 *   - Gravitational assists apply when passing near bodies.
 *
 * @module core/manoeuvre
 */

import {
  BODY_GM,
  BODY_RADIUS,
  CelestialBody,
  FlightPhase,
  ControlMode,
} from './constants.js';
import {
  computeOrbitalElements,
  checkOrbitStatus,
  getOrbitalPeriod,
  circularOrbitVelocity,
  getPeriapsisAltitude,
  getApoapsisAltitude,
} from './orbit.js';

// ---------------------------------------------------------------------------
// Celestial body hierarchy and SOI data
// ---------------------------------------------------------------------------

/**
 * Sphere of Influence radii (metres from body centre).
 * Beyond this distance the craft escapes the body's gravitational dominance.
 *
 * Earth SOI ≈ 924,000 km (Hill sphere approximation).
 * Moon SOI  ≈ 66,100 km.
 */
export const SOI_RADIUS = Object.freeze({
  EARTH: 924_000_000,
  MOON: 66_100_000,
});

/**
 * Mean orbital distance of each child body from its parent (metres).
 * Used for Hohmann transfer calculations.
 */
export const BODY_ORBIT_RADIUS = Object.freeze({
  /** Moon's mean distance from Earth centre. */
  MOON: 384_400_000,
});

/**
 * Parent body for each celestial body.
 * Earth is the root (no parent in our simplified system).
 */
export const BODY_PARENT = Object.freeze({
  EARTH: null,
  MOON: 'EARTH',
});

/**
 * Child bodies that orbit each parent.
 */
export const BODY_CHILDREN = Object.freeze({
  EARTH: Object.freeze(['MOON']),
  MOON: Object.freeze([]),
});

// ---------------------------------------------------------------------------
// Orbit recalculation
// ---------------------------------------------------------------------------

/**
 * Recalculate orbital elements from the current physics state vectors.
 * Called after thrust is applied in NORMAL orbit mode to update the orbit.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {string}                               bodyId
 * @param {number}                               epoch    Current flight time.
 * @returns {import('./orbit.js').OrbitalElements|null}
 *   New orbital elements, or null if the trajectory is no longer a bound orbit
 *   (i.e. the craft has reached escape velocity).
 */
export function recalculateOrbit(ps, bodyId, epoch) {
  return computeOrbitalElements(ps.posX, ps.posY, ps.velX, ps.velY, bodyId, epoch);
}

/**
 * Check if the craft is currently thrusting in a way that affects the orbit
 * (i.e. not in docking/RCS mode, and throttle > 0 with active engines).
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @returns {boolean}
 */
export function isOrbitalBurnActive(ps) {
  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    return false;
  }
  return ps.throttle > 0 && ps.firingEngines.size > 0;
}

// ---------------------------------------------------------------------------
// Transfer delta-v calculations
// ---------------------------------------------------------------------------

/**
 * Compute the delta-v required for a basic Hohmann-like direct transfer
 * from the craft's current orbit around `fromBodyId` to reach `toBodyId`.
 *
 * For Earth → Moon:
 *   1. Escape Earth's gravity from current orbit altitude.
 *   2. Hohmann transfer in the Sun-centred (or parent-centred) frame.
 *   3. Capture burn at destination (not included — that's the player's problem).
 *
 * Returns the departure delta-v only (the burn the player needs at their
 * current orbit to begin the transfer).
 *
 * @param {string} fromBodyId  Body the craft currently orbits.
 * @param {string} toBodyId    Target body to transfer to.
 * @param {number} altitude    Craft's current orbital altitude (m above surface).
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }|null}
 *   Delta-v values in m/s, transfer time in seconds. Null if transfer is not
 *   possible (e.g. same body, or unknown body pair).
 */
export function computeTransferDeltaV(fromBodyId, toBodyId, altitude) {
  if (fromBodyId === toBodyId) return null;

  // Currently only support Earth ↔ Moon transfers.
  if (fromBodyId === CelestialBody.EARTH && toBodyId === CelestialBody.MOON) {
    return _earthToMoonTransfer(altitude);
  }
  if (fromBodyId === CelestialBody.MOON && toBodyId === CelestialBody.EARTH) {
    return _moonToEarthTransfer(altitude);
  }

  return null;
}

/**
 * Earth → Moon Hohmann transfer.
 *
 * @param {number} altitude  Departure orbit altitude above Earth (m).
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }}
 */
function _earthToMoonTransfer(altitude) {
  const muEarth = BODY_GM[CelestialBody.EARTH];
  const rEarth = BODY_RADIUS[CelestialBody.EARTH];
  const rMoon = BODY_ORBIT_RADIUS[CelestialBody.MOON];

  // Departure orbit radius (from Earth centre).
  const r1 = rEarth + altitude;

  // Hohmann transfer ellipse semi-major axis.
  const a_transfer = (r1 + rMoon) / 2;

  // Circular orbit velocity at departure altitude.
  const v_circular = Math.sqrt(muEarth / r1);

  // Velocity at periapsis of transfer ellipse.
  const v_transfer_peri = Math.sqrt(muEarth * (2 / r1 - 1 / a_transfer));

  // Departure delta-v (prograde burn to enter transfer).
  const departureDV = Math.abs(v_transfer_peri - v_circular);

  // Velocity at apoapsis of transfer ellipse (arriving at Moon's orbit).
  const v_transfer_apo = Math.sqrt(muEarth * (2 / rMoon - 1 / a_transfer));

  // Circular orbit velocity at Moon's distance (in Earth-centred frame).
  const v_moon_orbit = Math.sqrt(muEarth / rMoon);

  // Capture delta-v (retrograde burn to match Moon's velocity / enter lunar orbit).
  // In practice the Moon's gravity helps, so this is approximate.
  const captureDV = Math.abs(v_moon_orbit - v_transfer_apo);

  // Transfer time (half the transfer orbit period).
  const transferTime = Math.PI * Math.sqrt(a_transfer ** 3 / muEarth);

  return {
    departureDV: Math.round(departureDV),
    captureDV: Math.round(captureDV),
    transferTime: Math.round(transferTime),
    totalDV: Math.round(departureDV + captureDV),
  };
}

/**
 * Moon → Earth transfer.
 *
 * @param {number} altitude  Departure orbit altitude above Moon (m).
 * @returns {{ departureDV: number, captureDV: number, transferTime: number, totalDV: number }}
 */
function _moonToEarthTransfer(altitude) {
  const muMoon = BODY_GM[CelestialBody.MOON];
  const muEarth = BODY_GM[CelestialBody.EARTH];
  const rMoonBody = BODY_RADIUS[CelestialBody.MOON];
  const rMoonOrbit = BODY_ORBIT_RADIUS[CelestialBody.MOON];

  // Escape velocity from Moon at the given altitude.
  const r_depart = rMoonBody + altitude;
  const v_circular_moon = Math.sqrt(muMoon / r_depart);
  const v_escape_moon = Math.sqrt(2 * muMoon / r_depart);

  // Delta-v to escape Moon's SOI.
  const escapeDV = v_escape_moon - v_circular_moon;

  // After escaping Moon, the craft is in an Earth-centred orbit at Moon's distance.
  // Need to lower periapsis to a reasonable Earth orbit (say 100 km).
  const rTarget = BODY_RADIUS[CelestialBody.EARTH] + 100_000;
  const a_return = (rMoonOrbit + rTarget) / 2;
  const v_at_moon_dist = Math.sqrt(muEarth * (2 / rMoonOrbit - 1 / a_return));
  const v_moon_circular = Math.sqrt(muEarth / rMoonOrbit);
  const returnBurnDV = Math.abs(v_moon_circular - v_at_moon_dist);

  // Capture at Earth (aerobraking is free, but budget for orbit insertion).
  const v_at_earth = Math.sqrt(muEarth * (2 / rTarget - 1 / a_return));
  const v_circular_earth = Math.sqrt(muEarth / rTarget);
  const captureDV = Math.abs(v_at_earth - v_circular_earth);

  const departureDV = escapeDV + returnBurnDV;
  const transferTime = Math.PI * Math.sqrt(a_return ** 3 / muEarth);

  return {
    departureDV: Math.round(departureDV),
    captureDV: Math.round(captureDV),
    transferTime: Math.round(transferTime),
    totalDV: Math.round(departureDV + captureDV),
  };
}

// ---------------------------------------------------------------------------
// Transfer target list
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TransferTarget
 * @property {string}  bodyId         Target celestial body ID.
 * @property {string}  name           Human-readable body name.
 * @property {number}  departureDV    Delta-v for departure burn (m/s).
 * @property {number}  captureDV      Delta-v for capture burn (m/s).
 * @property {number}  totalDV        Total delta-v budget (m/s).
 * @property {number}  transferTime   Transfer duration (seconds).
 */

/**
 * Get all reachable transfer targets from the current body, with delta-v costs.
 *
 * @param {string} bodyId     Current celestial body.
 * @param {number} altitude   Current orbital altitude (m above surface).
 * @returns {TransferTarget[]}
 */
export function getTransferTargets(bodyId, altitude) {
  const targets = [];

  // Add child bodies.
  const children = BODY_CHILDREN[bodyId] || [];
  for (const childId of children) {
    const transfer = computeTransferDeltaV(bodyId, childId, altitude);
    if (transfer) {
      targets.push({
        bodyId: childId,
        name: _bodyName(childId),
        departureDV: transfer.departureDV,
        captureDV: transfer.captureDV,
        totalDV: transfer.totalDV,
        transferTime: transfer.transferTime,
      });
    }
  }

  // Add parent body.
  const parent = BODY_PARENT[bodyId];
  if (parent) {
    const transfer = computeTransferDeltaV(bodyId, parent, altitude);
    if (transfer) {
      targets.push({
        bodyId: parent,
        name: _bodyName(parent),
        departureDV: transfer.departureDV,
        captureDV: transfer.captureDV,
        totalDV: transfer.totalDV,
        transferTime: transfer.transferTime,
      });
    }
  }

  return targets;
}

// ---------------------------------------------------------------------------
// SOI transition detection
// ---------------------------------------------------------------------------

/**
 * Check whether the craft has left the current body's sphere of influence
 * or entered a child body's SOI.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {import('./gameState.js').FlightState} flightState
 * @returns {{ transition: boolean, newBodyId: string|null, reason: string }}
 */
export function checkSOITransition(ps, flightState) {
  const bodyId = flightState.bodyId || CelestialBody.EARTH;
  const R = BODY_RADIUS[bodyId];

  // Distance from body centre.
  const distFromCentre = Math.sqrt(ps.posX * ps.posX + (ps.posY + R) * (ps.posY + R));

  // Check escape from current body's SOI.
  const soiRadius = SOI_RADIUS[bodyId];
  if (soiRadius && distFromCentre > soiRadius) {
    const parent = BODY_PARENT[bodyId];
    if (parent) {
      return {
        transition: true,
        newBodyId: parent,
        reason: `Escaped ${_bodyName(bodyId)} SOI`,
      };
    }
  }

  // Check entry into a child body's SOI.
  // For this simplified model, we check if the craft's altitude places it
  // within the transfer window where the child body's SOI can be entered.
  const children = BODY_CHILDREN[bodyId] || [];
  for (const childId of children) {
    const childOrbitR = BODY_ORBIT_RADIUS[childId];
    const childSOI = SOI_RADIUS[childId];
    if (!childOrbitR || !childSOI) continue;

    // Check if craft is near the child body's orbital distance.
    const craftAlt = Math.max(0, ps.posY);
    const craftR = craftAlt + R;

    // Within the child body's SOI sphere (simplified: distance from Earth centre
    // is within childOrbitR ± childSOI).
    if (Math.abs(craftR - childOrbitR) < childSOI) {
      // Check velocity — must be on an escape/transfer trajectory.
      const v2 = ps.velX * ps.velX + ps.velY * ps.velY;
      const mu = BODY_GM[bodyId];
      const specificEnergy = v2 / 2 - mu / craftR;

      // If specific energy is positive (hyperbolic) or orbit extends to Moon's distance,
      // the craft is on a transfer trajectory.
      if (specificEnergy >= 0 || craftR >= childOrbitR - childSOI) {
        return {
          transition: true,
          newBodyId: childId,
          reason: `Entering ${_bodyName(childId)} SOI`,
        };
      }
    }
  }

  return { transition: false, newBodyId: null, reason: '' };
}

/**
 * Check if the craft is on an escape trajectory from the current body.
 * The specific orbital energy must be non-negative (hyperbolic/parabolic).
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @param {string} bodyId
 * @returns {boolean}
 */
export function isEscapeTrajectory(ps, bodyId) {
  const R = BODY_RADIUS[bodyId];
  const mu = BODY_GM[bodyId];
  const r = Math.sqrt(ps.posX * ps.posX + (ps.posY + R) * (ps.posY + R));
  const v2 = ps.velX * ps.velX + ps.velY * ps.velY;
  const specificEnergy = v2 / 2 - mu / r;
  return specificEnergy >= 0;
}

// ---------------------------------------------------------------------------
// Gravitational assist calculations
// ---------------------------------------------------------------------------

/**
 * Compute the velocity change from a gravitational assist (gravity slingshot)
 * when passing through a body's gravitational field.
 *
 * Uses the hyperbolic flyby model:
 *   Turn angle δ = 2 × arcsin(1 / (1 + rₚ × v∞² / μ))
 *   where rₚ = periapsis distance, v∞ = excess velocity, μ = body GM.
 *
 * The assist changes the direction of the velocity vector by the turn angle,
 * which effectively adds or removes energy depending on the geometry.
 *
 * @param {string} bodyId       The body providing the assist.
 * @param {number} periapsisAlt Closest approach altitude above the body's surface (m).
 * @param {number} excessSpeed  Hyperbolic excess speed v∞ (m/s) — relative velocity
 *                              at "infinity" (SOI boundary).
 * @returns {{ turnAngle: number, deltaV: number, valid: boolean }}
 *   turnAngle: deflection in radians.
 *   deltaV: maximum possible delta-v gain (m/s) — actual gain depends on geometry.
 *   valid: false if periapsis is below the body surface.
 */
export function computeGravityAssist(bodyId, periapsisAlt, excessSpeed) {
  const mu = BODY_GM[bodyId];
  const R = BODY_RADIUS[bodyId];

  if (periapsisAlt < 0) {
    return { turnAngle: 0, deltaV: 0, valid: false };
  }

  const rPeriapsis = R + periapsisAlt;

  if (excessSpeed <= 0) {
    return { turnAngle: 0, deltaV: 0, valid: true };
  }

  // Hyperbolic parameter.
  const param = (rPeriapsis * excessSpeed * excessSpeed) / mu;

  // Eccentricity of the hyperbolic flyby.
  const eHyp = 1 + param;

  // Turn angle (deflection).
  const sinHalfDelta = 1 / eHyp;
  const halfDelta = Math.asin(Math.min(1, sinHalfDelta));
  const turnAngle = 2 * halfDelta;

  // Maximum delta-v: the change in velocity magnitude equals the chord of
  // the velocity vector rotated by turnAngle.
  // |Δv| = 2 × v∞ × sin(δ/2)
  const deltaV = 2 * excessSpeed * Math.sin(turnAngle / 2);

  return { turnAngle, deltaV, valid: true };
}

/**
 * Apply a gravitational assist to the physics state.
 * Rotates the velocity vector by the computed turn angle in the appropriate
 * direction based on the approach geometry.
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @param {string}  bodyId         Assisting body.
 * @param {number}  periapsisAlt   Closest approach altitude (m).
 * @param {number}  approachAngle  Angle of approach relative to body (radians).
 * @returns {{ applied: boolean, deltaV: number }}
 */
export function applyGravityAssist(ps, bodyId, periapsisAlt, approachAngle) {
  const speed = Math.hypot(ps.velX, ps.velY);
  const assist = computeGravityAssist(bodyId, periapsisAlt, speed);

  if (!assist.valid || assist.deltaV < 1) {
    return { applied: false, deltaV: 0 };
  }

  // Rotate velocity vector by the turn angle.
  // Direction depends on which side of the body the craft passes.
  const velAngle = Math.atan2(ps.velX, ps.velY);
  const turnDirection = _determineTurnDirection(ps, bodyId, approachAngle);
  const newAngle = velAngle + assist.turnAngle * turnDirection;

  ps.velX = speed * Math.sin(newAngle);
  ps.velY = speed * Math.cos(newAngle);

  return { applied: true, deltaV: assist.deltaV };
}

// ---------------------------------------------------------------------------
// Route planning for map view
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TransferRoute
 * @property {string}   fromBodyId     Departure body.
 * @property {string}   toBodyId       Destination body.
 * @property {number}   departureDV    Required departure delta-v (m/s).
 * @property {number}   captureDV      Required capture delta-v (m/s).
 * @property {number}   totalDV        Total mission delta-v (m/s).
 * @property {number}   transferTime   Transfer duration (seconds).
 * @property {string}   burnDirection  Recommended burn direction ('PROGRADE' or 'RETROGRADE').
 * @property {string}   burnPoint      Where to burn ('periapsis' or 'apoapsis').
 * @property {{ x: number, y: number }[]}  transferPath  Path points for map rendering.
 */

/**
 * Compute a route plan for transfer from the current body to a target.
 * Provides delta-v costs, transfer time, and a simple transfer arc for
 * map view rendering.
 *
 * @param {string} fromBodyId   Current body.
 * @param {string} toBodyId     Destination body.
 * @param {number} altitude     Current orbit altitude (m above surface).
 * @param {import('./orbit.js').OrbitalElements|null} craftElements  Current orbit.
 * @returns {TransferRoute|null}
 */
export function computeTransferRoute(fromBodyId, toBodyId, altitude, craftElements) {
  const transfer = computeTransferDeltaV(fromBodyId, toBodyId, altitude);
  if (!transfer) return null;

  // Determine burn direction and point based on transfer type.
  let burnDirection;
  let burnPoint;

  if (BODY_PARENT[toBodyId] === fromBodyId) {
    // Transferring to a child body (e.g. Earth → Moon).
    // Burn prograde at periapsis for maximum efficiency.
    burnDirection = 'PROGRADE';
    burnPoint = 'periapsis';
  } else {
    // Transferring to parent (e.g. Moon → Earth).
    // Burn retrograde to lower orbit and escape.
    burnDirection = 'RETROGRADE';
    burnPoint = 'retrograde';
  }

  // Generate a simple transfer arc for map view rendering.
  const transferPath = _generateTransferArc(fromBodyId, toBodyId, altitude);

  return {
    fromBodyId,
    toBodyId,
    departureDV: transfer.departureDV,
    captureDV: transfer.captureDV,
    totalDV: transfer.totalDV,
    transferTime: transfer.transferTime,
    burnDirection,
    burnPoint,
    transferPath,
  };
}

// ---------------------------------------------------------------------------
// Manoeuvre state tracking
// ---------------------------------------------------------------------------

/**
 * Determine if the craft should enter the MANOEUVRE phase.
 * Conditions: in ORBIT phase, in NORMAL control mode, and actively thrusting.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {import('./gameState.js').FlightState} flightState
 * @returns {boolean}
 */
export function shouldEnterManoeuvre(ps, flightState) {
  if (flightState.phase !== FlightPhase.ORBIT) return false;
  return isOrbitalBurnActive(ps);
}

/**
 * Determine if the craft should exit the MANOEUVRE phase back to ORBIT.
 * Conditions: in MANOEUVRE phase, no active orbital burn, and orbit is still valid.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {import('./gameState.js').FlightState} flightState
 * @param {string} bodyId
 * @returns {boolean}
 */
export function shouldExitManoeuvre(ps, flightState, bodyId) {
  if (flightState.phase !== FlightPhase.MANOEUVRE) return false;
  if (isOrbitalBurnActive(ps)) return false;

  // Check if we still have a valid orbit after the burn.
  const status = checkOrbitStatus(ps.posX, ps.posY, ps.velX, ps.velY, bodyId);
  return status.valid;
}

/**
 * Determine if the craft should enter the TRANSFER phase.
 * Conditions: in ORBIT or MANOEUVRE phase, on an escape trajectory.
 *
 * @param {import('./physics.js').PhysicsState}  ps
 * @param {import('./gameState.js').FlightState} flightState
 * @returns {boolean}
 */
export function shouldEnterTransfer(ps, flightState) {
  if (flightState.phase !== FlightPhase.ORBIT && flightState.phase !== FlightPhase.MANOEUVRE) {
    return false;
  }
  const bodyId = flightState.bodyId || CelestialBody.EARTH;
  return isEscapeTrajectory(ps, bodyId);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Determine the turn direction for a gravity assist based on approach geometry.
 * Returns +1 or -1.
 */
function _determineTurnDirection(ps, bodyId, approachAngle) {
  const R = BODY_RADIUS[bodyId];
  // Cross product of position vector and velocity vector determines
  // which side of the body the craft passes.
  const px = ps.posX;
  const py = ps.posY + R;
  const cross = px * ps.velY - py * ps.velX;
  return cross >= 0 ? 1 : -1;
}

/**
 * Generate a simple transfer arc path for map view rendering.
 * Returns Cartesian points (body-centred) tracing the transfer ellipse.
 */
function _generateTransferArc(fromBodyId, toBodyId, altitude) {
  const R = BODY_RADIUS[fromBodyId];
  const rDepart = R + altitude;
  const points = [];

  let rArrive;
  if (BODY_PARENT[toBodyId] === fromBodyId) {
    // Transferring outward to child body.
    rArrive = BODY_ORBIT_RADIUS[toBodyId];
  } else {
    // Transferring inward to parent.
    rArrive = R * 2; // Approximate: show arc going inward
  }

  if (!rArrive) return points;

  // Semi-major axis of transfer ellipse.
  const a = (rDepart + rArrive) / 2;
  const e = Math.abs(rArrive - rDepart) / (rArrive + rDepart);

  const numPoints = 60;
  // Transfer is half an orbit (0 to π for outward, π to 2π for inward).
  const startTheta = 0;
  const endTheta = Math.PI;

  for (let i = 0; i <= numPoints; i++) {
    const theta = startTheta + (endTheta - startTheta) * (i / numPoints);
    const p = a * (1 - e * e);
    const r = p / (1 + e * Math.cos(theta));
    points.push({
      x: r * Math.cos(theta),
      y: r * Math.sin(theta),
    });
  }

  return points;
}

/**
 * Human-readable name for a celestial body.
 */
function _bodyName(bodyId) {
  switch (bodyId) {
    case CelestialBody.EARTH: return 'Earth';
    case CelestialBody.MOON:  return 'Moon';
    default:                  return bodyId;
  }
}

/**
 * Format a time duration in seconds to a human-readable string.
 *
 * @param {number} seconds
 * @returns {string}
 */
export function formatTransferTime(seconds) {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} hr`;
  return `${(seconds / 86400).toFixed(1)} days`;
}

/**
 * Format delta-v in m/s to a compact display string.
 *
 * @param {number} dv  Delta-v in m/s.
 * @returns {string}
 */
export function formatDeltaV(dv) {
  if (dv >= 1000) return `${(dv / 1000).toFixed(1)} km/s`;
  return `${Math.round(dv)} m/s`;
}

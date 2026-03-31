/**
 * mapView.js — Core logic for the top-down orbital map view.
 *
 * Provides:
 *   - Zoom level presets and view-radius computation.
 *   - Orbit path generation (Cartesian points for rendering ellipses).
 *   - Orbital-relative thrust angle computation (prograde/retrograde/radial).
 *   - Orbit prediction generation (future positions along the orbit).
 *   - Availability check (requires Tracking Station facility).
 *
 * This module is pure game logic — no DOM, no canvas.
 *
 * @module core/mapView
 */

import { BODY_RADIUS, BODY_GM, ALTITUDE_BANDS, FlightPhase } from './constants.js';
import {
  getOrbitalStateAtTime,
  getOrbitalPeriod,
  getPeriapsisAltitude,
  getApoapsisAltitude,
  computeOrbitalElements,
} from './orbit.js';
import {
  getTransferTargets,
  computeTransferRoute,
  formatTransferTime,
  formatDeltaV,
  BODY_ORBIT_RADIUS,
  BODY_PARENT,
  BODY_CHILDREN,
  SOI_RADIUS,
  computeGravityAssist,
} from './manoeuvre.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;

/**
 * Zoom level presets for the map view.
 * @enum {string}
 */
export const MapZoom = Object.freeze({
  /** Tight view centred on the craft's current orbit. */
  ORBIT_DETAIL: 'ORBIT_DETAIL',
  /** Shows the full celestial body and all altitude bands. */
  LOCAL_BODY: 'LOCAL_BODY',
  /** Sized to fit both the craft's orbit and the selected target's orbit. */
  CRAFT_TO_TARGET: 'CRAFT_TO_TARGET',
  /** Maximum zoom-out showing the full system. */
  SOLAR_SYSTEM: 'SOLAR_SYSTEM',
});

/**
 * Orbital-relative thrust directions for map-view controls.
 * @enum {string}
 */
export const MapThrustDir = Object.freeze({
  /** Thrust in the direction of orbital motion. */
  PROGRADE: 'PROGRADE',
  /** Thrust opposite to orbital motion. */
  RETROGRADE: 'RETROGRADE',
  /** Thrust toward the central body. */
  RADIAL_IN: 'RADIAL_IN',
  /** Thrust away from the central body. */
  RADIAL_OUT: 'RADIAL_OUT',
});

// ---------------------------------------------------------------------------
// View radius computation
// ---------------------------------------------------------------------------

/**
 * Compute the view radius (metres from body centre to screen edge) for a
 * given zoom level.  The renderer converts this to a pixels-per-metre scale.
 *
 * @param {string}                     zoomLevel       MapZoom value.
 * @param {string}                     bodyId          Celestial body ID.
 * @param {import('./orbit.js').OrbitalElements|null} craftElements
 * @param {import('./orbit.js').OrbitalElements|null} targetElements
 * @returns {number}  View radius in metres.
 */
export function getViewRadius(zoomLevel, bodyId, craftElements, targetElements, transferState) {
  const R = BODY_RADIUS[bodyId];
  const bands = ALTITUDE_BANDS[bodyId];

  switch (zoomLevel) {
    case MapZoom.ORBIT_DETAIL: {
      if (!craftElements) return R * 1.5;
      const apoAlt = getApoapsisAltitude(craftElements, bodyId);
      return (R + apoAlt) * 1.3;
    }
    case MapZoom.LOCAL_BODY: {
      const maxBand = bands ? bands[bands.length - 1] : null;
      const maxAlt = maxBand ? maxBand.max : 2_000_000;
      return (R + maxAlt) * 1.1;
    }
    case MapZoom.CRAFT_TO_TARGET: {
      // During transfer: show the path to the destination body.
      if (transferState) {
        const destOrbitR = BODY_ORBIT_RADIUS[transferState.destinationBodyId] || 0;
        const soiR = SOI_RADIUS[bodyId] || R * 5;
        return Math.max(destOrbitR, soiR) * 1.3;
      }
      if (!craftElements || !targetElements) {
        return getViewRadius(MapZoom.LOCAL_BODY, bodyId, craftElements, null, null);
      }
      const craftApo = getApoapsisAltitude(craftElements, bodyId);
      const targetApo = getApoapsisAltitude(targetElements, bodyId);
      return (R + Math.max(craftApo, targetApo)) * 1.3;
    }
    case MapZoom.SOLAR_SYSTEM: {
      // During transfer between Sun-orbiting bodies, show solar system scale.
      if (transferState) {
        const destR = BODY_ORBIT_RADIUS[transferState.destinationBodyId] || 0;
        const originR = BODY_ORBIT_RADIUS[transferState.originBodyId] || 0;
        return Math.max(destR, originR, R * 5) * 1.3;
      }
      // Show the SOI of the current body or its children's orbits.
      const soiR = SOI_RADIUS[bodyId];
      if (soiR && soiR !== Infinity) return soiR * 1.3;
      // For Sun: show to Mars orbit.
      const marsR = BODY_ORBIT_RADIUS.MARS || R * 15;
      return marsR * 1.2;
    }
    default:
      return R * 2;
  }
}

// ---------------------------------------------------------------------------
// Orbit path generation
// ---------------------------------------------------------------------------

/**
 * Generate body-centred Cartesian points tracing an orbit ellipse.
 *
 * @param {import('./orbit.js').OrbitalElements} elements
 * @param {string}  bodyId
 * @param {number}  [numPoints=180]  Number of sample points around the orbit.
 * @returns {{ x: number, y: number }[]}
 */
export function generateOrbitPath(elements, bodyId, numPoints = 180) {
  const { semiMajorAxis: a, eccentricity: e, argPeriapsis: omega } = elements;
  const p = a * (1 - e * e);
  const points = [];

  for (let i = 0; i <= numPoints; i++) {
    const theta = (TWO_PI * i) / numPoints;
    const r = p / (1 + e * Math.cos(theta));
    const angle = omega + theta;
    points.push({
      x: r * Math.cos(angle),
      y: r * Math.sin(angle),
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

/**
 * Get the craft's position in body-centred Cartesian map coordinates (metres).
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @param {string} bodyId
 * @returns {{ x: number, y: number }}
 */
export function getCraftMapPosition(ps, bodyId) {
  const R = BODY_RADIUS[bodyId];
  return { x: ps.posX, y: ps.posY + R };
}

/**
 * Get an orbital object's body-centred Cartesian position at time t.
 *
 * @param {import('./orbit.js').OrbitalElements} elements
 * @param {number} t       Absolute time (seconds).
 * @param {string} bodyId
 * @returns {{ x: number, y: number }}
 */
export function getObjectMapPosition(elements, t, bodyId) {
  const state = getOrbitalStateAtTime(elements, t, bodyId);
  const angle = elements.argPeriapsis + state.trueAnomaly;
  return {
    x: state.radius * Math.cos(angle),
    y: state.radius * Math.sin(angle),
  };
}

// ---------------------------------------------------------------------------
// Orbital-relative thrust
// ---------------------------------------------------------------------------

/**
 * Compute the physics-convention rocket angle (radians; 0 = +Y = up) that
 * aligns thrust with the requested orbital-relative direction.
 *
 * Physics convention:  thrustX = thrust × sin(angle),
 *                      thrustY = thrust × cos(angle).
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @param {string} bodyId
 * @param {string} direction  MapThrustDir value.
 * @returns {number}  Angle in radians.
 */
export function computeOrbitalThrustAngle(ps, bodyId, direction) {
  const R = BODY_RADIUS[bodyId];
  const px = ps.posX;
  const py = ps.posY + R;

  switch (direction) {
    case MapThrustDir.PROGRADE:
      return Math.atan2(ps.velX, ps.velY);
    case MapThrustDir.RETROGRADE:
      return Math.atan2(-ps.velX, -ps.velY);
    case MapThrustDir.RADIAL_OUT: {
      const len = Math.sqrt(px * px + py * py) || 1;
      return Math.atan2(px / len, py / len);
    }
    case MapThrustDir.RADIAL_IN: {
      const len = Math.sqrt(px * px + py * py) || 1;
      return Math.atan2(-px / len, -py / len);
    }
    default:
      return ps.angle;
  }
}

// ---------------------------------------------------------------------------
// Orbit predictions
// ---------------------------------------------------------------------------

/**
 * Generate future-position tick marks along the craft's orbit.
 *
 * @param {import('./orbit.js').OrbitalElements} elements
 * @param {string}  bodyId
 * @param {number}  currentTime   Flight elapsed time (seconds).
 * @param {number}  [numOrbits=3] How many orbital periods to cover.
 * @param {number}  [numPoints=36] Number of tick marks.
 * @returns {{ x: number, y: number, t: number }[]}
 */
export function generateOrbitPredictions(elements, bodyId, currentTime, numOrbits = 3, numPoints = 36) {
  const period = getOrbitalPeriod(elements.semiMajorAxis, bodyId);
  const totalTime = period * numOrbits;
  const dt = totalTime / numPoints;
  const predictions = [];

  for (let i = 1; i <= numPoints; i++) {
    const t = currentTime + dt * i;
    const pos = getObjectMapPosition(elements, t, bodyId);
    predictions.push({ x: pos.x, y: pos.y, t });
  }
  return predictions;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Transfer target info for map view
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} MapTransferTarget
 * @property {string}  bodyId         Celestial body ID.
 * @property {string}  name           Display name.
 * @property {number}  departureDV    Departure delta-v (m/s).
 * @property {number}  totalDV        Total delta-v (m/s).
 * @property {number}  transferTime   Transfer time (seconds).
 * @property {string}  departureDVStr Formatted departure delta-v string.
 * @property {string}  totalDVStr     Formatted total delta-v string.
 * @property {string}  transferTimeStr Formatted transfer time string.
 * @property {{ x: number, y: number }}  position  Body-centred position for rendering.
 * @property {number}  orbitRadius    Distance from parent body centre (m).
 */

/**
 * Get transfer targets with formatted display data for the map view.
 * Only available during ORBIT and TRANSFER phases.
 *
 * @param {string} bodyId             Current body.
 * @param {number} altitude           Current orbital altitude (m).
 * @param {string} phase              Current flight phase.
 * @returns {MapTransferTarget[]}
 */
export function getMapTransferTargets(bodyId, altitude, phase) {
  if (phase !== FlightPhase.ORBIT &&
      phase !== FlightPhase.TRANSFER &&
      phase !== FlightPhase.MANOEUVRE) {
    return [];
  }

  const targets = getTransferTargets(bodyId, altitude);
  return targets.map(t => {
    const orbitR = BODY_ORBIT_RADIUS[t.bodyId] || 0;
    // Position the target body indicator at its orbital distance.
    // Use a fixed angle for now (right side of the map).
    const angle = _getBodyDisplayAngle(t.bodyId);
    return {
      bodyId: t.bodyId,
      name: t.name,
      departureDV: t.departureDV,
      totalDV: t.totalDV,
      transferTime: t.transferTime,
      departureDVStr: formatDeltaV(t.departureDV),
      totalDVStr: formatDeltaV(t.totalDV),
      transferTimeStr: formatTransferTime(t.transferTime),
      position: {
        x: orbitR * Math.cos(angle),
        y: orbitR * Math.sin(angle),
      },
      orbitRadius: orbitR,
    };
  });
}

/**
 * Get a route plan for display on the map.
 *
 * @param {string} fromBodyId
 * @param {string} toBodyId
 * @param {number} altitude
 * @param {import('./orbit.js').OrbitalElements|null} craftElements
 * @returns {import('./manoeuvre.js').TransferRoute|null}
 */
export function getMapTransferRoute(fromBodyId, toBodyId, altitude, craftElements) {
  return computeTransferRoute(fromBodyId, toBodyId, altitude, craftElements);
}

/**
 * Get a display angle for a body's position on the map.
 * Uses a fixed angle per body for visual consistency.
 */
function _getBodyDisplayAngle(bodyId) {
  const angles = {
    MERCURY: Math.PI * 1.5,
    VENUS:   Math.PI * 1.75,
    EARTH:   Math.PI * 1.25,
    MOON:    Math.PI * 0.25,
    MARS:    Math.PI * 0.5,
    PHOBOS:  Math.PI * 0.3,
    DEIMOS:  Math.PI * 0.7,
  };
  return angles[bodyId] || 0;
}

// ---------------------------------------------------------------------------
// Transfer trajectory prediction
// ---------------------------------------------------------------------------

/**
 * Generate a predicted trajectory for a craft in TRANSFER phase.
 * Returns body-centred Cartesian points showing the craft's projected path
 * from its current position outward toward the SOI boundary or destination.
 *
 * @param {import('./physics.js').PhysicsState} ps
 * @param {string} bodyId  Current reference body.
 * @param {number} numPoints  Number of trajectory points.
 * @returns {{ x: number, y: number }[]}
 */
export function generateTransferTrajectory(ps, bodyId, numPoints = 120) {
  const R = BODY_RADIUS[bodyId];
  const mu = BODY_GM[bodyId];
  const soiR = SOI_RADIUS[bodyId] || R * 100;

  const points = [];
  let px = ps.posX;
  let py = ps.posY + R; // Convert to body-centred
  let vx = ps.velX;
  let vy = ps.velY;

  // Simple forward integration using velocity Verlet.
  // Use a timestep that covers roughly the SOI crossing time.
  const r0 = Math.sqrt(px * px + py * py);
  const v0 = Math.sqrt(vx * vx + vy * vy);
  const estTime = Math.max((soiR - r0) / Math.max(v0, 100), 3600);
  const dt = estTime / numPoints;

  for (let i = 0; i <= numPoints; i++) {
    points.push({ x: px, y: py });

    const r = Math.sqrt(px * px + py * py);
    if (r > soiR * 1.1 || r < R * 0.9) break; // Past SOI or crashed.

    // Gravitational acceleration toward body centre.
    const r3 = r * r * r;
    const ax = -mu * px / r3;
    const ay = -mu * py / r3;

    // Velocity Verlet integration.
    px += vx * dt + 0.5 * ax * dt * dt;
    py += vy * dt + 0.5 * ay * dt * dt;

    const rNew = Math.sqrt(px * px + py * py);
    const r3New = rNew * rNew * rNew;
    const axNew = -mu * px / r3New;
    const ayNew = -mu * py / r3New;

    vx += 0.5 * (ax + axNew) * dt;
    vy += 0.5 * (ay + ayNew) * dt;
  }

  return points;
}

/**
 * Get info for displaying transfer progress on the map HUD.
 *
 * @param {import('../core/gameState.js').TransferState|null} transferState
 * @param {number} timeElapsed  Current flight elapsed time.
 * @returns {{ progress: number, etaStr: string, destName: string, originName: string }|null}
 */
export function getTransferProgressInfo(transferState, timeElapsed) {
  if (!transferState) return null;

  const totalTime = transferState.estimatedArrival - transferState.departureTime;
  const elapsed = timeElapsed - transferState.departureTime;
  const progress = totalTime > 0 ? Math.min(1, Math.max(0, elapsed / totalTime)) : 0;
  const remaining = Math.max(0, transferState.estimatedArrival - timeElapsed);

  return {
    progress,
    etaStr: formatTransferTime(remaining),
    destName: _bodyDisplayName(transferState.destinationBodyId),
    originName: _bodyDisplayName(transferState.originBodyId),
    captureDV: formatDeltaV(transferState.captureDV),
  };
}

/**
 * Get all celestial bodies relevant for the current map view context.
 * During transfer, returns destination body and any intermediate bodies.
 * During orbit, returns child bodies and the parent.
 *
 * @param {string} bodyId  Current reference body.
 * @param {import('../core/gameState.js').TransferState|null} transferState
 * @returns {Array<{ bodyId: string, name: string, orbitRadius: number, angle: number, parentId: string|null }>}
 */
export function getMapCelestialBodies(bodyId, transferState) {
  const bodies = [];

  // Add child bodies of current reference body.
  const children = BODY_CHILDREN[bodyId] || [];
  for (const childId of children) {
    const orbitR = BODY_ORBIT_RADIUS[childId] || 0;
    bodies.push({
      bodyId: childId,
      name: _bodyDisplayName(childId),
      orbitRadius: orbitR,
      angle: _getBodyDisplayAngle(childId),
      parentId: bodyId,
    });
  }

  // During transfer, add destination body info.
  if (transferState) {
    const destId = transferState.destinationBodyId;
    if (!bodies.find(b => b.bodyId === destId)) {
      const orbitR = BODY_ORBIT_RADIUS[destId] || 0;
      bodies.push({
        bodyId: destId,
        name: _bodyDisplayName(destId),
        orbitRadius: orbitR,
        angle: _getBodyDisplayAngle(destId),
        parentId: BODY_PARENT[destId],
      });
    }
  }

  return bodies;
}

/**
 * Human-readable display name for a celestial body.
 */
function _bodyDisplayName(bodyId) {
  const names = {
    SUN: 'Sun', MERCURY: 'Mercury', VENUS: 'Venus', EARTH: 'Earth',
    MOON: 'Moon', MARS: 'Mars', PHOBOS: 'Phobos', DEIMOS: 'Deimos',
  };
  return names[bodyId] || bodyId;
}


// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * Check whether the map view is available.
 * Requires Tracking Station facility; returns true if facilities are not
 * yet implemented (TASK-007).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {boolean}
 */
export function isMapViewAvailable(state) {
  // Facilities system not yet implemented (TASK-007).
  // When it is, check for 'tracking-station' in state.facilities.
  return true;
}

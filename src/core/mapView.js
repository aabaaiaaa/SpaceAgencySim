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

import { BODY_RADIUS, ALTITUDE_BANDS, FlightPhase } from './constants.js';
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
export function getViewRadius(zoomLevel, bodyId, craftElements, targetElements) {
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
      if (!craftElements || !targetElements) {
        return getViewRadius(MapZoom.LOCAL_BODY, bodyId, craftElements, null);
      }
      const craftApo = getApoapsisAltitude(craftElements, bodyId);
      const targetApo = getApoapsisAltitude(targetElements, bodyId);
      return (R + Math.max(craftApo, targetApo)) * 1.3;
    }
    case MapZoom.SOLAR_SYSTEM:
      return R * 15;
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
  switch (bodyId) {
    case 'MOON':  return Math.PI * 0.25; // Upper-right
    case 'EARTH': return Math.PI * 1.25; // Lower-left
    default:      return 0;
  }
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

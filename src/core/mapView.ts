/**
 * mapView.ts — Core logic for the top-down orbital map view.
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

import { BODY_RADIUS, BODY_GM, ALTITUDE_BANDS, FlightPhase, FacilityId } from './constants.ts';
import { hasFacility, getFacilityTier } from './construction.ts';
import { getSunAngle, getShadowHalfAngle } from './power.ts';
import {
  getOrbitalStateAtTime,
  getOrbitalPeriod,
  getPeriapsisAltitude,
  getApoapsisAltitude,
  computeOrbitalElements,
} from './orbit.ts';
import {
  getTransferTargets,
  computeTransferRoute,
  type TransferRoute,
  formatTransferTime,
  formatDeltaV,
  BODY_ORBIT_RADIUS,
  BODY_PARENT,
  BODY_CHILDREN,
  SOI_RADIUS,
  computeGravityAssist,
} from './manoeuvre.ts';

import type { OrbitalElements } from './gameState.ts';
import type { PhysicsState } from './physics.ts';
import type { GameState, TransferState } from './gameState.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;

/**
 * Zoom level presets for the map view.
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
} as const);

export type MapZoom = (typeof MapZoom)[keyof typeof MapZoom];

/**
 * Orbital-relative thrust directions for map-view controls.
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
} as const);

export type MapThrustDir = (typeof MapThrustDir)[keyof typeof MapThrustDir];

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

/** A point on the map with optional time label. */
interface MapPoint {
  x: number;
  y: number;
}

/** A prediction point on the map with time. */
interface MapPrediction {
  x: number;
  y: number;
  t: number;
}

/** A transfer target for display on the map. */
export interface MapTransferTarget {
  bodyId: string;
  name: string;
  departureDV: number;
  totalDV: number;
  transferTime: number;
  departureDVStr: string;
  totalDVStr: string;
  transferTimeStr: string;
  position: MapPoint;
  orbitRadius: number;
}

/** Transfer progress info for the map HUD. */
export interface TransferProgressInfo {
  progress: number;
  etaStr: string;
  destName: string;
  originName: string;
  captureDV: string;
}

/** A celestial body entry for map rendering. */
export interface MapCelestialBody {
  bodyId: string;
  name: string;
  orbitRadius: number;
  angle: number;
  parentId: string | null;
}

/** Shadow overlay geometry for map rendering. */
export interface ShadowOverlayGeometry {
  sunAngleDeg: number;
  shadowStartAngleDeg: number;
  shadowArcDeg: number;
  bodyRadius: number;
  maxRadius: number;
}

// ---------------------------------------------------------------------------
// View radius computation
// ---------------------------------------------------------------------------

/**
 * Compute the view radius (metres from body centre to screen edge) for a
 * given zoom level.  The renderer converts this to a pixels-per-metre scale.
 */
export function getViewRadius(
  zoomLevel: string,
  bodyId: string,
  craftElements: OrbitalElements | null,
  targetElements: OrbitalElements | null,
  transferState: TransferState | null,
): number {
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
        const destOrbitR = (BODY_ORBIT_RADIUS as Record<string, number>)[transferState.destinationBodyId] || 0;
        const soiR = (SOI_RADIUS as Record<string, number>)[bodyId] || R * 5;
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
        const destR = (BODY_ORBIT_RADIUS as Record<string, number>)[transferState.destinationBodyId] || 0;
        const originR = (BODY_ORBIT_RADIUS as Record<string, number>)[transferState.originBodyId] || 0;
        return Math.max(destR, originR, R * 5) * 1.3;
      }
      // Show the SOI of the current body or its children's orbits.
      const soiR = (SOI_RADIUS as Record<string, number>)[bodyId];
      if (soiR && soiR !== Infinity) return soiR * 1.3;
      // For Sun: show to Mars orbit.
      const marsR = (BODY_ORBIT_RADIUS as Record<string, number>).MARS || R * 15;
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
 */
export function generateOrbitPath(
  elements: OrbitalElements,
  bodyId: string,
  numPoints: number = 180,
): MapPoint[] {
  const { semiMajorAxis: a, eccentricity: e, argPeriapsis: omega } = elements;
  const p = a * (1 - e * e);
  const points: MapPoint[] = [];

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
 */
export function getCraftMapPosition(
  ps: Pick<PhysicsState, 'posX' | 'posY'>,
  bodyId: string,
): MapPoint {
  const R = BODY_RADIUS[bodyId];
  return { x: ps.posX, y: ps.posY + R };
}

/**
 * Get an orbital object's body-centred Cartesian position at time t.
 */
export function getObjectMapPosition(
  elements: OrbitalElements,
  t: number,
  bodyId: string,
): MapPoint {
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
 */
export function computeOrbitalThrustAngle(
  ps: Pick<PhysicsState, 'posX' | 'posY' | 'velX' | 'velY' | 'angle'>,
  bodyId: string,
  direction: string,
): number {
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
 */
export function generateOrbitPredictions(
  elements: OrbitalElements,
  bodyId: string,
  currentTime: number,
  numOrbits: number = 3,
  numPoints: number = 36,
): MapPrediction[] {
  const period = getOrbitalPeriod(elements.semiMajorAxis, bodyId);
  const totalTime = period * numOrbits;
  const dt = totalTime / numPoints;
  const predictions: MapPrediction[] = [];

  for (let i = 1; i <= numPoints; i++) {
    const t = currentTime + dt * i;
    const pos = getObjectMapPosition(elements, t, bodyId);
    predictions.push({ x: pos.x, y: pos.y, t });
  }
  return predictions;
}

// ---------------------------------------------------------------------------
// Transfer target info for map view
// ---------------------------------------------------------------------------

/**
 * Get transfer targets with formatted display data for the map view.
 * Only available during ORBIT and TRANSFER phases.
 */
export function getMapTransferTargets(
  bodyId: string,
  altitude: number,
  phase: string,
): MapTransferTarget[] {
  if (phase !== FlightPhase.ORBIT &&
      phase !== FlightPhase.TRANSFER &&
      phase !== FlightPhase.MANOEUVRE) {
    return [];
  }

  const targets = getTransferTargets(bodyId, altitude) as Array<{
    bodyId: string;
    name: string;
    departureDV: number;
    totalDV: number;
    transferTime: number;
  }>;

  return targets.map(t => {
    const orbitR = (BODY_ORBIT_RADIUS as Record<string, number>)[t.bodyId] || 0;
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
 */
export function getMapTransferRoute(
  fromBodyId: string,
  toBodyId: string,
  altitude: number,
  craftElements: OrbitalElements | null,
): TransferRoute | null {
  return computeTransferRoute(fromBodyId, toBodyId, altitude, craftElements);
}

/**
 * Get a display angle for a body's position on the map.
 * Uses a fixed angle per body for visual consistency.
 */
function _getBodyDisplayAngle(bodyId: string): number {
  const angles: Record<string, number> = {
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
 */
export function generateTransferTrajectory(
  ps: Pick<PhysicsState, 'posX' | 'posY' | 'velX' | 'velY'>,
  bodyId: string,
  numPoints: number = 120,
): MapPoint[] {
  const R = BODY_RADIUS[bodyId];
  const mu = BODY_GM[bodyId];
  const soiR = (SOI_RADIUS as Record<string, number>)[bodyId] || R * 100;

  const points: MapPoint[] = [];
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
 */
export function getTransferProgressInfo(
  transferState: TransferState | null,
  timeElapsed: number,
): TransferProgressInfo | null {
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
 */
export function getMapCelestialBodies(
  bodyId: string,
  transferState: TransferState | null,
): MapCelestialBody[] {
  const bodies: MapCelestialBody[] = [];

  // Add child bodies of current reference body.
  const children = BODY_CHILDREN[bodyId] || [];
  for (const childId of children) {
    const orbitR = (BODY_ORBIT_RADIUS as Record<string, number>)[childId] || 0;
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
      const orbitR = (BODY_ORBIT_RADIUS as Record<string, number>)[destId] || 0;
      bodies.push({
        bodyId: destId,
        name: _bodyDisplayName(destId),
        orbitRadius: orbitR,
        angle: _getBodyDisplayAngle(destId),
        parentId: (BODY_PARENT as Record<string, string | null>)[destId] ?? null,
      });
    }
  }

  return bodies;
}

/**
 * Human-readable display name for a celestial body.
 */
function _bodyDisplayName(bodyId: string): string {
  const names: Record<string, string> = {
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
 * Requires the Tracking Station facility to be built.
 */
export function isMapViewAvailable(state: GameState): boolean {
  return hasFacility(state, FacilityId.TRACKING_STATION);
}

/**
 * Get the current Tracking Station tier (0 if not built).
 */
export function getTrackingStationTier(state: GameState): number {
  return getFacilityTier(state, FacilityId.TRACKING_STATION);
}

/**
 * Check whether the solar system map zoom level is available.
 * Requires Tracking Station tier 2+.
 */
export function isSolarSystemMapAvailable(state: GameState): boolean {
  return getTrackingStationTier(state) >= 2;
}

/**
 * Check whether debris tracking is available on the map.
 * Requires Tracking Station tier 2+.
 */
export function isDebrisTrackingAvailable(state: GameState): boolean {
  return getTrackingStationTier(state) >= 2;
}

/**
 * Check whether weather window predictions are available.
 * Requires Tracking Station tier 2+.
 */
export function isWeatherPredictionAvailable(state: GameState): boolean {
  return getTrackingStationTier(state) >= 2;
}

/**
 * Check whether transfer route planning is available on the map.
 * Requires Tracking Station tier 3.
 */
export function isTransferPlanningAvailable(state: GameState): boolean {
  return getTrackingStationTier(state) >= 3;
}

/**
 * Check whether deep space communication is available.
 * Requires Tracking Station tier 3.
 */
export function isDeepSpaceCommsAvailable(state: GameState): boolean {
  return getTrackingStationTier(state) >= 3;
}

/**
 * Get the list of allowed map zoom levels based on Tracking Station tier.
 * Tier 1: ORBIT_DETAIL, LOCAL_BODY only.
 * Tier 2+: all zoom levels including SOLAR_SYSTEM and CRAFT_TO_TARGET.
 */
export function getAllowedMapZooms(state: GameState): string[] {
  const tier = getTrackingStationTier(state);
  if (tier >= 2) {
    return [MapZoom.ORBIT_DETAIL, MapZoom.LOCAL_BODY, MapZoom.CRAFT_TO_TARGET, MapZoom.SOLAR_SYSTEM];
  }
  return [MapZoom.ORBIT_DETAIL, MapZoom.LOCAL_BODY];
}

// ---------------------------------------------------------------------------
// Shadow Overlay
// ---------------------------------------------------------------------------

/**
 * Compute shadow overlay geometry for the map view renderer.
 *
 * Returns the arc parameters needed to draw the body's shadow cone on the map.
 * The renderer draws a semi-transparent dark wedge on the anti-sun side.
 */
export function getShadowOverlayGeometry(
  bodyId: string,
  gameTimeSeconds: number,
  maxRadius?: number,
): ShadowOverlayGeometry {
  const R = BODY_RADIUS[bodyId];
  const bands = ALTITUDE_BANDS[bodyId];
  const highestBand = bands ? bands[bands.length - 1] : null;
  const defaultMaxR = highestBand
    ? R + highestBand.max
    : R * 2;
  const effectiveMaxR = maxRadius ?? defaultMaxR;

  const sunAngleDeg = getSunAngle(gameTimeSeconds);
  // Use the body's radius as the shadow source — the shadow is a truncated
  // cone that narrows at higher altitudes.  For the map overlay, we use
  // the half-angle at the midpoint of the altitude range for a reasonable visual.
  const midAlt = (effectiveMaxR - R) / 2;
  const halfAngle = getShadowHalfAngle(midAlt, bodyId);

  // Shadow centre is on the anti-sun side.
  const antiSunDeg = (sunAngleDeg + 180) % 360;

  return {
    sunAngleDeg,
    shadowStartAngleDeg: (antiSunDeg - halfAngle + 360) % 360,
    shadowArcDeg: halfAngle * 2,
    bodyRadius: R,
    maxRadius: effectiveMaxR,
  };
}

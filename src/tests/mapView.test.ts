// @ts-nocheck
/**
 * mapView.test.js — Unit tests for the map view core logic (TASK-004).
 *
 * Tests cover:
 *   View radius computation   — zoom level presets produce sensible radii
 *   Orbit path generation     — correct number of points, closure
 *   Position helpers          — craft and object map positions
 *   Orbital thrust angles     — prograde/retrograde/radial directions
 *   Orbit predictions         — correct number and monotonic time values
 *   Availability check        — defaults to true when facilities not implemented
 */

import { describe, it, expect } from 'vitest';
import {
  MapZoom,
  MapThrustDir,
  getViewRadius,
  generateOrbitPath,
  getCraftMapPosition,
  getObjectMapPosition,
  computeOrbitalThrustAngle,
  generateOrbitPredictions,
  isMapViewAvailable,
} from '../core/mapView.js';
import { BODY_RADIUS, ALTITUDE_BANDS } from '../core/constants.js';
import { computeOrbitalElements, circularOrbitVelocity } from '../core/orbit.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create orbital elements for a circular orbit at a given altitude.
 */
function circularOrbit(altitude, bodyId = 'EARTH') {
  const R = BODY_RADIUS[bodyId];
  const vCirc = circularOrbitVelocity(altitude, bodyId);
  // Position at (0, altitude) with horizontal velocity → circular orbit.
  return computeOrbitalElements(0, altitude, vCirc, 0, bodyId, 0);
}

/**
 * Create a minimal physics state mock.
 */
function makeMockPs(posX, posY, velX, velY) {
  return { posX, posY, velX, velY, angle: 0 };
}

// ---------------------------------------------------------------------------
// View radius computation
// ---------------------------------------------------------------------------

describe('getViewRadius', () => {
  const bodyId = 'EARTH';
  const R = BODY_RADIUS[bodyId];

  it('ORBIT_DETAIL is larger than the body radius', () => {
    const elements = circularOrbit(150_000);
    const vr = getViewRadius(MapZoom.ORBIT_DETAIL, bodyId, elements, null);
    expect(vr).toBeGreaterThan(R);
  });

  it('ORBIT_DETAIL without elements falls back to 1.5× body radius', () => {
    const vr = getViewRadius(MapZoom.ORBIT_DETAIL, bodyId, null, null);
    expect(vr).toBeCloseTo(R * 1.5, -3);
  });

  it('LOCAL_BODY encompasses the highest altitude band', () => {
    const vr = getViewRadius(MapZoom.LOCAL_BODY, bodyId, null, null);
    const maxBand = ALTITUDE_BANDS[bodyId][ALTITUDE_BANDS[bodyId].length - 1];
    expect(vr).toBeGreaterThan(R + maxBand.max);
  });

  it('CRAFT_TO_TARGET is large enough to fit both orbits', () => {
    const craftEl  = circularOrbit(150_000);
    const targetEl = circularOrbit(500_000);
    const vr = getViewRadius(MapZoom.CRAFT_TO_TARGET, bodyId, craftEl, targetEl);
    expect(vr).toBeGreaterThan(R + 500_000);
  });

  it('CRAFT_TO_TARGET falls back to LOCAL_BODY when no target', () => {
    const craftEl = circularOrbit(150_000);
    const vr = getViewRadius(MapZoom.CRAFT_TO_TARGET, bodyId, craftEl, null);
    const localVr = getViewRadius(MapZoom.LOCAL_BODY, bodyId, craftEl, null);
    expect(vr).toBe(localVr);
  });

  it('SOLAR_SYSTEM is much larger than the body', () => {
    const vr = getViewRadius(MapZoom.SOLAR_SYSTEM, bodyId, null, null);
    expect(vr).toBeGreaterThan(R * 10);
  });
});

// ---------------------------------------------------------------------------
// Orbit path generation
// ---------------------------------------------------------------------------

describe('generateOrbitPath', () => {
  it('generates the requested number of points + 1 (closed loop)', () => {
    const elements = circularOrbit(200_000);
    const path = generateOrbitPath(elements, 'EARTH', 60);
    expect(path).toHaveLength(61); // 0..60 inclusive
  });

  it('first and last points are close together (closed orbit)', () => {
    const elements = circularOrbit(200_000);
    const path = generateOrbitPath(elements, 'EARTH', 120);
    const first = path[0];
    const last = path[path.length - 1];
    const dist = Math.hypot(first.x - last.x, first.y - last.y);
    // Should be very close (within ~1 m for circular orbit).
    expect(dist).toBeLessThan(100);
  });

  it('all points are at roughly the orbital radius for a circular orbit', () => {
    const altitude = 200_000;
    const elements = circularOrbit(altitude);
    const expectedR = BODY_RADIUS.EARTH + altitude;
    const path = generateOrbitPath(elements, 'EARTH', 36);
    for (const pt of path) {
      const r = Math.hypot(pt.x, pt.y);
      expect(r).toBeCloseTo(expectedR, -2); // within ~100 m
    }
  });
});

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

describe('getCraftMapPosition', () => {
  it('maps (0, altitude) to (0, altitude + R_body)', () => {
    const R = BODY_RADIUS.EARTH;
    const ps = makeMockPs(0, 150_000, 0, 0);
    const pos = getCraftMapPosition(ps, 'EARTH');
    expect(pos.x).toBe(0);
    expect(pos.y).toBe(150_000 + R);
  });

  it('preserves horizontal position', () => {
    const R = BODY_RADIUS.EARTH;
    const ps = makeMockPs(5000, 100_000, 0, 0);
    const pos = getCraftMapPosition(ps, 'EARTH');
    expect(pos.x).toBe(5000);
    expect(pos.y).toBe(100_000 + R);
  });
});

describe('getObjectMapPosition', () => {
  it('returns a position at roughly the orbital radius', () => {
    const altitude = 200_000;
    const elements = circularOrbit(altitude);
    const pos = getObjectMapPosition(elements, 0, 'EARTH');
    const r = Math.hypot(pos.x, pos.y);
    expect(r).toBeCloseTo(BODY_RADIUS.EARTH + altitude, -2);
  });
});

// ---------------------------------------------------------------------------
// Orbital thrust angles
// ---------------------------------------------------------------------------

describe('computeOrbitalThrustAngle', () => {
  const bodyId = 'EARTH';

  it('PROGRADE aligns with velocity vector', () => {
    // Moving purely horizontally (+X).
    const ps = makeMockPs(0, 200_000, 1000, 0);
    const angle = computeOrbitalThrustAngle(ps, bodyId, MapThrustDir.PROGRADE);
    // With velX=1000, velY=0: atan2(1000, 0) = π/2.
    expect(angle).toBeCloseTo(Math.PI / 2, 5);
  });

  it('RETROGRADE is opposite to PROGRADE', () => {
    const ps = makeMockPs(0, 200_000, 1000, 0);
    const pro  = computeOrbitalThrustAngle(ps, bodyId, MapThrustDir.PROGRADE);
    const retro = computeOrbitalThrustAngle(ps, bodyId, MapThrustDir.RETROGRADE);
    // Difference should be π (mod 2π).
    let diff = Math.abs(pro - retro);
    if (diff > Math.PI) diff = 2 * Math.PI - diff;
    expect(diff).toBeCloseTo(Math.PI, 5);
  });

  it('RADIAL_OUT points away from the body centre', () => {
    // Craft at (0, altitude) → radial out = straight up = angle 0.
    const ps = makeMockPs(0, 200_000, 0, 0);
    const angle = computeOrbitalThrustAngle(ps, bodyId, MapThrustDir.RADIAL_OUT);
    expect(angle).toBeCloseTo(0, 5);
  });

  it('RADIAL_IN points toward the body centre', () => {
    // Craft at (0, altitude) → radial in = straight down = |angle| = π.
    // atan2(-0, -y) may return ±π depending on sign of zero; both are correct.
    const ps = makeMockPs(0, 200_000, 0, 0);
    const angle = computeOrbitalThrustAngle(ps, bodyId, MapThrustDir.RADIAL_IN);
    expect(Math.abs(angle)).toBeCloseTo(Math.PI, 5);
  });
});

// ---------------------------------------------------------------------------
// Orbit predictions
// ---------------------------------------------------------------------------

describe('generateOrbitPredictions', () => {
  it('generates the requested number of points', () => {
    const elements = circularOrbit(200_000);
    const preds = generateOrbitPredictions(elements, 'EARTH', 0, 2, 24);
    expect(preds).toHaveLength(24);
  });

  it('prediction times are monotonically increasing', () => {
    const elements = circularOrbit(200_000);
    const preds = generateOrbitPredictions(elements, 'EARTH', 100, 3, 36);
    for (let i = 1; i < preds.length; i++) {
      expect(preds[i].t).toBeGreaterThan(preds[i - 1].t);
    }
  });

  it('all prediction times are in the future', () => {
    const elements = circularOrbit(200_000);
    const currentTime = 500;
    const preds = generateOrbitPredictions(elements, 'EARTH', currentTime, 2, 12);
    for (const p of preds) {
      expect(p.t).toBeGreaterThan(currentTime);
    }
  });
});

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

describe('isMapViewAvailable', () => {
  it('returns false when tracking station is not built', () => {
    const state = { orbitalObjects: [], facilities: {} };
    expect(isMapViewAvailable(state)).toBe(false);
  });

  it('returns true when tracking station is built', () => {
    const state = {
      orbitalObjects: [],
      facilities: { 'tracking-station': { built: true, tier: 1 } },
    };
    expect(isMapViewAvailable(state)).toBe(true);
  });
});

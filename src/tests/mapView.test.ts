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
  getMapTransferTargets,
  generateTransferTrajectory,
  getTransferProgressInfo,
  getMapCelestialBodies,
  getShadowOverlayGeometry,
  getTrackingStationTier,
  isSolarSystemMapAvailable,
  isDebrisTrackingAvailable,
  isWeatherPredictionAvailable,
  isTransferPlanningAvailable,
  isDeepSpaceCommsAvailable,
  getAllowedMapZooms,
  getInspectionBodyId,
  getInspectionAllowedZooms,
} from '../core/mapView.ts';
import { BODY_RADIUS, ALTITUDE_BANDS, FlightPhase, EARTH_HUB_ID } from '../core/constants.ts';
import { computeOrbitalElements, circularOrbitVelocity } from '../core/orbit.ts';
import { BODY_ORBIT_RADIUS, SOI_RADIUS } from '../core/manoeuvre.ts';
import type { OrbitalElements, TransferState, GameState } from '../core/gameState.ts';
import type { PhysicsState } from '../core/physics.ts';
import { makeEarthHub } from './_factories.ts';

type MockPs = Pick<PhysicsState, 'posX' | 'posY' | 'velX' | 'velY' | 'angle'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function circularOrbit(altitude: number, bodyId: string = 'EARTH'): OrbitalElements {
  const vCirc = circularOrbitVelocity(altitude, bodyId);
  return computeOrbitalElements(0, altitude, vCirc, 0, bodyId, 0)!;
}

function makeMockPs(posX: number, posY: number, velX: number, velY: number): MockPs {
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
    const vr = getViewRadius(MapZoom.ORBIT_DETAIL, bodyId, elements, null, null);
    expect(vr).toBeGreaterThan(R);
  });

  it('ORBIT_DETAIL without elements falls back to 1.5× body radius', () => {
    const vr = getViewRadius(MapZoom.ORBIT_DETAIL, bodyId, null, null, null);
    expect(vr).toBeCloseTo(R * 1.5, -3);
  });

  it('LOCAL_BODY encompasses the highest altitude band', () => {
    const vr = getViewRadius(MapZoom.LOCAL_BODY, bodyId, null, null, null);
    const maxBand = ALTITUDE_BANDS[bodyId][ALTITUDE_BANDS[bodyId].length - 1];
    expect(vr).toBeGreaterThan(R + maxBand.max);
  });

  it('CRAFT_TO_TARGET is large enough to fit both orbits', () => {
    const craftEl  = circularOrbit(150_000);
    const targetEl = circularOrbit(500_000);
    const vr = getViewRadius(MapZoom.CRAFT_TO_TARGET, bodyId, craftEl, targetEl, null);
    expect(vr).toBeGreaterThan(R + 500_000);
  });

  it('CRAFT_TO_TARGET falls back to LOCAL_BODY when no target', () => {
    const craftEl = circularOrbit(150_000);
    const vr = getViewRadius(MapZoom.CRAFT_TO_TARGET, bodyId, craftEl, null, null);
    const localVr = getViewRadius(MapZoom.LOCAL_BODY, bodyId, craftEl, null, null);
    expect(vr).toBe(localVr);
  });

  it('SOLAR_SYSTEM is much larger than the body', () => {
    const vr = getViewRadius(MapZoom.SOLAR_SYSTEM, bodyId, null, null, null);
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
    const hub = makeEarthHub({ facilities: {} });
    const state = { orbitalObjects: [], hubs: [hub], activeHubId: EARTH_HUB_ID } as Partial<GameState> as GameState;
    expect(isMapViewAvailable(state)).toBe(false);
  });

  it('returns true when tracking station is built', () => {
    const hub = makeEarthHub({ facilities: { 'tracking-station': { built: true, tier: 1 } } });
    const state = {
      orbitalObjects: [],
      hubs: [hub],
      activeHubId: EARTH_HUB_ID,
    } as Partial<GameState> as GameState;
    expect(isMapViewAvailable(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getViewRadius — transfer state branches
// ---------------------------------------------------------------------------

describe('getViewRadius — transfer state branches', () => {
  const bodyId = 'EARTH';

  function makeTransferState(origin: string, destination: string): TransferState {
    return {
      originBodyId: origin,
      destinationBodyId: destination,
      departureTime: 0,
      estimatedArrival: 86400,
      departureDV: 1000,
      captureDV: 500,
      totalDV: 1500,
      trajectoryPath: [],
    };
  }

  it('CRAFT_TO_TARGET with transferState uses destination orbit or SOI', () => {
    const ts = makeTransferState('EARTH', 'MOON');
    const vr = getViewRadius(MapZoom.CRAFT_TO_TARGET, bodyId, null, null, ts);
    const moonOrbit = BODY_ORBIT_RADIUS.MOON || 0;
    const soiR = SOI_RADIUS[bodyId] || BODY_RADIUS[bodyId] * 5;
    expect(vr).toBeCloseTo(Math.max(moonOrbit, soiR) * 1.3, -3);
  });

  it('CRAFT_TO_TARGET without craft or target falls back to LOCAL_BODY', () => {
    const vr = getViewRadius(MapZoom.CRAFT_TO_TARGET, bodyId, null, null, null);
    const localVr = getViewRadius(MapZoom.LOCAL_BODY, bodyId, null, null, null);
    expect(vr).toBe(localVr);
  });

  it('SOLAR_SYSTEM with transferState uses max of dest and origin orbit radii', () => {
    const ts = makeTransferState('EARTH', 'MARS');
    const vr = getViewRadius(MapZoom.SOLAR_SYSTEM, bodyId, null, null, ts);
    const destR = BODY_ORBIT_RADIUS.MARS || 0;
    const originR = BODY_ORBIT_RADIUS.EARTH || 0;
    const R = BODY_RADIUS[bodyId];
    expect(vr).toBeCloseTo(Math.max(destR, originR, R * 5) * 1.3, -3);
  });

  it('SOLAR_SYSTEM for SUN body uses Mars orbit radius', () => {
    const vr = getViewRadius(MapZoom.SOLAR_SYSTEM, 'SUN', null, null, null);
    const marsR = BODY_ORBIT_RADIUS.MARS;
    expect(vr).toBeCloseTo(marsR * 1.2, -3);
  });

  it('SOLAR_SYSTEM for body with finite SOI uses SOI * 1.3', () => {
    const vr = getViewRadius(MapZoom.SOLAR_SYSTEM, 'EARTH', null, null, null);
    const soiR = SOI_RADIUS.EARTH;
    expect(vr).toBeCloseTo(soiR * 1.3, -3);
  });

  it('default zoom level returns R * 2', () => {
    const R = BODY_RADIUS[bodyId];
    const vr = getViewRadius('UNKNOWN_ZOOM', bodyId, null, null, null);
    expect(vr).toBeCloseTo(R * 2, -3);
  });

  it('LOCAL_BODY without altitude bands uses 2 000 000 default', () => {
    // Use a body that might not have bands defined — fall back to default.
    const vr = getViewRadius(MapZoom.LOCAL_BODY, 'SUN', null, null, null);
    const R = BODY_RADIUS.SUN;
    // Without bands, maxAlt = 2_000_000, so vr = (R + 2_000_000) * 1.1
    expect(vr).toBeGreaterThan(R);
  });
});

// ---------------------------------------------------------------------------
// generateTransferTrajectory
// ---------------------------------------------------------------------------

describe('generateTransferTrajectory', () => {
  type TransferPs = Pick<PhysicsState, 'posX' | 'posY' | 'velX' | 'velY'>;

  it('returns at least the initial point', () => {
    const ps: TransferPs = { posX: 0, posY: 100_000, velX: 7800, velY: 500 };
    const pts = generateTransferTrajectory(ps, 'EARTH', 60);
    expect(pts.length).toBeGreaterThanOrEqual(1);
  });

  it('first point is at the craft body-centred position', () => {
    const R = BODY_RADIUS.EARTH;
    const ps: TransferPs = { posX: 1000, posY: 200_000, velX: 8000, velY: 100 };
    const pts = generateTransferTrajectory(ps, 'EARTH', 30);
    expect(pts[0].x).toBe(1000);
    expect(pts[0].y).toBe(200_000 + R);
  });

  it('stops early if trajectory leaves SOI', () => {
    const ps: TransferPs = { posX: 0, posY: 910_000_000, velX: 50_000, velY: 50_000 };
    const pts = generateTransferTrajectory(ps, 'EARTH', 200);
    expect(pts.length).toBeLessThan(201);
  });

  it('stops early if trajectory crashes into body', () => {
    const ps: TransferPs = { posX: 0, posY: 50_000, velX: 0, velY: -10_000 };
    const pts = generateTransferTrajectory(ps, 'EARTH', 200);
    expect(pts.length).toBeLessThan(201);
  });
});

// ---------------------------------------------------------------------------
// getTransferProgressInfo
// ---------------------------------------------------------------------------

describe('getTransferProgressInfo', () => {
  function makeTransferState(depTime: number, arrTime: number, origin: string, dest: string): TransferState {
    return {
      originBodyId: origin,
      destinationBodyId: dest,
      departureTime: depTime,
      estimatedArrival: arrTime,
      departureDV: 1000,
      captureDV: 500,
      totalDV: 1500,
      trajectoryPath: [],
    };
  }

  it('returns null when transferState is null', () => {
    expect(getTransferProgressInfo(null, 1000)).toBeNull();
  });

  it('returns progress 0 at departure time', () => {
    const ts = makeTransferState(100, 200, 'EARTH', 'MARS');
    const info = getTransferProgressInfo(ts, 100);
    expect(info).not.toBeNull();
    expect(info!.progress).toBe(0);
  });

  it('returns progress 1 at arrival time', () => {
    const ts = makeTransferState(100, 200, 'EARTH', 'MARS');
    const info = getTransferProgressInfo(ts, 200)!;
    expect(info.progress).toBe(1);
  });

  it('returns progress 0.5 at midpoint', () => {
    const ts = makeTransferState(100, 300, 'EARTH', 'MARS');
    const info = getTransferProgressInfo(ts, 200)!;
    expect(info.progress).toBeCloseTo(0.5, 5);
  });

  it('clamps progress to 1 past arrival', () => {
    const ts = makeTransferState(100, 200, 'EARTH', 'MARS');
    const info = getTransferProgressInfo(ts, 500)!;
    expect(info.progress).toBe(1);
  });

  it('clamps progress to 0 before departure', () => {
    const ts = makeTransferState(100, 200, 'EARTH', 'MARS');
    const info = getTransferProgressInfo(ts, 50)!;
    expect(info.progress).toBe(0);
  });

  it('includes formatted destination and origin names', () => {
    const ts = makeTransferState(100, 200, 'EARTH', 'MARS');
    const info = getTransferProgressInfo(ts, 150)!;
    expect(info.destName).toBe('Mars');
    expect(info.originName).toBe('Earth');
  });

  it('includes formatted captureDV and etaStr', () => {
    const ts = makeTransferState(100, 200, 'EARTH', 'MARS');
    const info = getTransferProgressInfo(ts, 150)!;
    expect(typeof info.captureDV).toBe('string');
    expect(typeof info.etaStr).toBe('string');
  });

  it('handles zero total time gracefully (progress = 0)', () => {
    const ts = makeTransferState(100, 100, 'EARTH', 'MARS');
    const info = getTransferProgressInfo(ts, 100)!;
    expect(info.progress).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getMapCelestialBodies
// ---------------------------------------------------------------------------

describe('getMapCelestialBodies', () => {
  it('returns child bodies for EARTH (should include MOON)', () => {
    const bodies = getMapCelestialBodies('EARTH', null);
    const ids = bodies.map(b => b.bodyId);
    expect(ids).toContain('MOON');
  });

  it('returns child bodies for MARS (should include PHOBOS, DEIMOS)', () => {
    const bodies = getMapCelestialBodies('MARS', null);
    const ids = bodies.map(b => b.bodyId);
    expect(ids).toContain('PHOBOS');
    expect(ids).toContain('DEIMOS');
  });

  it('returns empty for body with no children and no transfer', () => {
    const bodies = getMapCelestialBodies('MOON', null);
    expect(bodies).toHaveLength(0);
  });

  it('adds destination body during transfer if not already a child', () => {
    const ts: TransferState = {
      originBodyId: 'EARTH',
      destinationBodyId: 'MARS',
      departureTime: 0,
      estimatedArrival: 86400,
      departureDV: 1000,
      captureDV: 500,
      totalDV: 1500,
      trajectoryPath: [],
    };
    const bodies = getMapCelestialBodies('EARTH', ts);
    const ids = bodies.map(b => b.bodyId);
    expect(ids).toContain('MARS');
    expect(ids).toContain('MOON'); // child still present
  });

  it('does not duplicate destination if it is already a child', () => {
    const ts: TransferState = {
      originBodyId: 'EARTH',
      destinationBodyId: 'MOON',
      departureTime: 0,
      estimatedArrival: 86400,
      departureDV: 1000,
      captureDV: 500,
      totalDV: 1500,
      trajectoryPath: [],
    };
    const bodies = getMapCelestialBodies('EARTH', ts);
    const moonEntries = bodies.filter(b => b.bodyId === 'MOON');
    expect(moonEntries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// getShadowOverlayGeometry
// ---------------------------------------------------------------------------

describe('getShadowOverlayGeometry', () => {
  it('returns valid shadow geometry for Earth', () => {
    const geo = getShadowOverlayGeometry('EARTH', 0);
    expect(geo.bodyRadius).toBe(BODY_RADIUS.EARTH);
    expect(geo.maxRadius).toBeGreaterThan(geo.bodyRadius);
    expect(geo.shadowArcDeg).toBeGreaterThan(0);
    expect(geo.shadowArcDeg).toBeLessThan(360);
  });

  it('shadowStartAngleDeg is on the anti-sun side', () => {
    const geo = getShadowOverlayGeometry('EARTH', 0);
    // Shadow centre should be roughly 180° from sun.
    const antiSun = (geo.sunAngleDeg + 180) % 360;
    const shadowCentre = (geo.shadowStartAngleDeg + geo.shadowArcDeg / 2) % 360;
    // They should be close (within the arc extent).
    const diff = Math.abs(antiSun - shadowCentre);
    expect(Math.min(diff, 360 - diff)).toBeLessThan(geo.shadowArcDeg);
  });

  it('respects custom maxRadius parameter', () => {
    const customMax = 50_000_000;
    const geo = getShadowOverlayGeometry('EARTH', 0, customMax);
    expect(geo.maxRadius).toBe(customMax);
  });

  it('uses default maxRadius from altitude bands when not specified', () => {
    const geo = getShadowOverlayGeometry('EARTH', 0);
    const bands = ALTITUDE_BANDS.EARTH;
    const highestBand = bands[bands.length - 1];
    const expectedMax = BODY_RADIUS.EARTH + highestBand.max;
    expect(geo.maxRadius).toBe(expectedMax);
  });

  it('returns different sun angles at different game times', () => {
    const geo1 = getShadowOverlayGeometry('EARTH', 0);
    const geo2 = getShadowOverlayGeometry('EARTH', 2700); // half a sun rotation (180°)
    expect(geo1.sunAngleDeg).not.toBe(geo2.sunAngleDeg);
  });
});

// ---------------------------------------------------------------------------
// getMapTransferTargets
// ---------------------------------------------------------------------------

describe('getMapTransferTargets', () => {
  it('returns empty array for non-orbital phases', () => {
    expect(getMapTransferTargets('EARTH', 200_000, FlightPhase.LAUNCH)).toEqual([]);
    expect(getMapTransferTargets('EARTH', 200_000, FlightPhase.FLIGHT)).toEqual([]);
    expect(getMapTransferTargets('EARTH', 200_000, FlightPhase.PRELAUNCH)).toEqual([]);
    expect(getMapTransferTargets('EARTH', 200_000, FlightPhase.REENTRY)).toEqual([]);
  });

  it('returns results for ORBIT phase', () => {
    const targets = getMapTransferTargets('EARTH', 200_000, FlightPhase.ORBIT);
    // Should return some transfer targets (at least Moon from Earth).
    expect(Array.isArray(targets)).toBe(true);
  });

  it('returns results for TRANSFER phase', () => {
    const targets = getMapTransferTargets('EARTH', 200_000, FlightPhase.TRANSFER);
    expect(Array.isArray(targets)).toBe(true);
  });

  it('returns results for MANOEUVRE phase', () => {
    const targets = getMapTransferTargets('EARTH', 200_000, FlightPhase.MANOEUVRE);
    expect(Array.isArray(targets)).toBe(true);
  });

  it('@smoke each target has formatted string fields', () => {
    const targets = getMapTransferTargets('EARTH', 200_000, FlightPhase.ORBIT);
    for (const t of targets) {
      expect(typeof t.departureDVStr).toBe('string');
      expect(typeof t.totalDVStr).toBe('string');
      expect(typeof t.transferTimeStr).toBe('string');
      expect(t.position).toHaveProperty('x');
      expect(t.position).toHaveProperty('y');
    }
  });
});

// ---------------------------------------------------------------------------
// Tracking Station tier-based feature availability
// ---------------------------------------------------------------------------

describe('Tracking Station tier-based features', () => {
  function makeState(tier: number): GameState {
    const hub = tier === 0
      ? makeEarthHub({ facilities: {} })
      : makeEarthHub({ facilities: { 'tracking-station': { built: true, tier } } });
    return {
      orbitalObjects: [],
      hubs: [hub],
      activeHubId: EARTH_HUB_ID,
    } as Partial<GameState> as GameState;
  }

  it('getTrackingStationTier returns 0 when not built', () => {
    expect(getTrackingStationTier(makeState(0))).toBe(0);
  });

  it('getTrackingStationTier returns the tier when built', () => {
    expect(getTrackingStationTier(makeState(1))).toBe(1);
    expect(getTrackingStationTier(makeState(2))).toBe(2);
    expect(getTrackingStationTier(makeState(3))).toBe(3);
  });

  it('isSolarSystemMapAvailable requires tier >= 2', () => {
    expect(isSolarSystemMapAvailable(makeState(0))).toBe(false);
    expect(isSolarSystemMapAvailable(makeState(1))).toBe(false);
    expect(isSolarSystemMapAvailable(makeState(2))).toBe(true);
    expect(isSolarSystemMapAvailable(makeState(3))).toBe(true);
  });

  it('isDebrisTrackingAvailable requires tier >= 2', () => {
    expect(isDebrisTrackingAvailable(makeState(0))).toBe(false);
    expect(isDebrisTrackingAvailable(makeState(1))).toBe(false);
    expect(isDebrisTrackingAvailable(makeState(2))).toBe(true);
  });

  it('isWeatherPredictionAvailable requires tier >= 2', () => {
    expect(isWeatherPredictionAvailable(makeState(0))).toBe(false);
    expect(isWeatherPredictionAvailable(makeState(1))).toBe(false);
    expect(isWeatherPredictionAvailable(makeState(2))).toBe(true);
  });

  it('isTransferPlanningAvailable requires tier >= 3', () => {
    expect(isTransferPlanningAvailable(makeState(0))).toBe(false);
    expect(isTransferPlanningAvailable(makeState(1))).toBe(false);
    expect(isTransferPlanningAvailable(makeState(2))).toBe(false);
    expect(isTransferPlanningAvailable(makeState(3))).toBe(true);
  });

  it('isDeepSpaceCommsAvailable requires tier >= 3', () => {
    expect(isDeepSpaceCommsAvailable(makeState(0))).toBe(false);
    expect(isDeepSpaceCommsAvailable(makeState(2))).toBe(false);
    expect(isDeepSpaceCommsAvailable(makeState(3))).toBe(true);
  });

  it('getAllowedMapZooms returns 2 zooms at tier 1', () => {
    const zooms = getAllowedMapZooms(makeState(1));
    expect(zooms).toHaveLength(2);
    expect(zooms).toContain(MapZoom.ORBIT_DETAIL);
    expect(zooms).toContain(MapZoom.LOCAL_BODY);
  });

  it('getAllowedMapZooms returns all 4 zooms at tier 2+', () => {
    const zooms = getAllowedMapZooms(makeState(2));
    expect(zooms).toHaveLength(4);
    expect(zooms).toContain(MapZoom.SOLAR_SYSTEM);
    expect(zooms).toContain(MapZoom.CRAFT_TO_TARGET);
  });

  it('getAllowedMapZooms returns 2 zooms when not built', () => {
    const zooms = getAllowedMapZooms(makeState(0));
    expect(zooms).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Inspection-mode helpers (Tracking Station map view without an active flight)
// ---------------------------------------------------------------------------

describe('getInspectionBodyId', () => {
  it("returns the active hub's body id", () => {
    const state = {
      hubs: [makeEarthHub({ id: 'earth-hq', bodyId: 'EARTH' })],
      activeHubId: 'earth-hq',
    } as Partial<GameState> as GameState;
    expect(getInspectionBodyId(state)).toBe('EARTH');
  });

  it('returns the body of a non-Earth active hub', () => {
    const hub = makeEarthHub({ id: 'mars-base', bodyId: 'MARS' });
    const state = {
      hubs: [hub],
      activeHubId: 'mars-base',
    } as Partial<GameState> as GameState;
    expect(getInspectionBodyId(state)).toBe('MARS');
  });

  it("falls back to 'EARTH' when the active hub cannot be resolved", () => {
    const state = {
      hubs: [],
      activeHubId: 'missing-hub',
    } as Partial<GameState> as GameState;
    expect(getInspectionBodyId(state)).toBe('EARTH');
  });

  it("falls back to 'EARTH' when hubs field is missing", () => {
    const state = {} as GameState;
    expect(getInspectionBodyId(state)).toBe('EARTH');
  });
});

describe('getInspectionAllowedZooms', () => {
  function makeStateWithTier(tier: number): GameState {
    const hub = tier === 0
      ? makeEarthHub({ facilities: {} })
      : makeEarthHub({ facilities: { 'tracking-station': { built: true, tier } } });
    return {
      orbitalObjects: [],
      hubs: [hub],
      activeHubId: EARTH_HUB_ID,
    } as Partial<GameState> as GameState;
  }

  it('returns LOCAL_BODY only at tier 1', () => {
    const zooms = getInspectionAllowedZooms(makeStateWithTier(1));
    expect(zooms).toEqual([MapZoom.LOCAL_BODY]);
  });

  it('returns LOCAL_BODY + SOLAR_SYSTEM at tier 2', () => {
    const zooms = getInspectionAllowedZooms(makeStateWithTier(2));
    expect(zooms).toHaveLength(2);
    expect(zooms).toContain(MapZoom.LOCAL_BODY);
    expect(zooms).toContain(MapZoom.SOLAR_SYSTEM);
  });

  it('returns LOCAL_BODY + SOLAR_SYSTEM at tier 3', () => {
    const zooms = getInspectionAllowedZooms(makeStateWithTier(3));
    expect(zooms).toHaveLength(2);
    expect(zooms).toContain(MapZoom.LOCAL_BODY);
    expect(zooms).toContain(MapZoom.SOLAR_SYSTEM);
  });

  it('never includes ORBIT_DETAIL or CRAFT_TO_TARGET (flight-only zooms)', () => {
    for (const tier of [1, 2, 3]) {
      const zooms = getInspectionAllowedZooms(makeStateWithTier(tier));
      expect(zooms).not.toContain(MapZoom.ORBIT_DETAIL);
      expect(zooms).not.toContain(MapZoom.CRAFT_TO_TARGET);
    }
  });

  it('returns an empty list when Tracking Station is not built', () => {
    expect(getInspectionAllowedZooms(makeStateWithTier(0))).toEqual([]);
  });
});

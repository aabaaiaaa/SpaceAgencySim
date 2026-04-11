/**
 * orbit.test.ts — Unit tests for the orbit slot system (TASK-002).
 *
 * Tests cover:
 *   Kepler's equation solver   — convergence for circular and eccentric orbits
 *   Anomaly conversions        — mean ↔ true ↔ eccentric round-trips
 *   Orbital element computation — from state vectors (circular & elliptical)
 *   Period & mean motion        — match expected values for known orbits
 *   Position queries            — altitude, angular position at arbitrary times
 *   Altitude bands              — correct classification for Earth
 *   Angular segments            — 36-segment mapping
 *   Proximity detection         — angular distance + altitude band matching
 *   Orbit entry detection       — valid orbits vs sub-orbital trajectories
 *   Warp to target              — convergence & impossibility detection
 *   Orbital object management   — create, tick, rebase epoch
 */

import { describe, it, expect } from 'vitest';
import {
  solveKepler,
  meanAnomalyToTrue,
  trueAnomalyToMean,
  trueToEccentricAnomaly,
  computeOrbitalElements,
  getOrbitalPeriod,
  getMeanMotion,
  getOrbitalStateAtTime,
  circularOrbitVelocity,
  getPeriapsisAltitude,
  getApoapsisAltitude,
  getAltitudeBand,
  getAltitudeBandId,
  getAngularSegment,
  angularDistance,
  checkProximity,
  checkOrbitStatus,
  getMinOrbitAltitude,
  getOrbitEntryLabel,
  createOrbitalObject,
  tickOrbitalObjects,
  rebaseEpoch,
  warpToTarget,
  orbitOverlapsBand,
} from '../core/orbit.ts';
import type { ProximityState } from '../core/orbit.ts';
import type { OrbitalElements } from '../core/gameState.ts';
import {
  CelestialBody,
  BODY_GM,
  BODY_RADIUS,
} from '../core/constants.ts';

const EARTH = CelestialBody.EARTH;
const R_EARTH = BODY_RADIUS.EARTH;
const MU_EARTH = BODY_GM.EARTH;
const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


/**
 * Create a circular orbit state at a given altitude with exact circular velocity.
 * Craft is directly above the body centre (posX = 0) moving horizontally.
 */
function circularOrbitState(altitude: number): { posX: number; posY: number; velX: number; velY: number } {
  const r = R_EARTH + altitude;
  const v = Math.sqrt(MU_EARTH / r);
  return { posX: 0, posY: altitude, velX: v, velY: 0 };
}

// ---------------------------------------------------------------------------
// Kepler's equation solver
// ---------------------------------------------------------------------------

describe('solveKepler', () => {
  it('returns M for a circular orbit (e = 0)', () => {
    expect(solveKepler(1.5, 0)).toBeCloseTo(1.5, 10);
  });

  it('converges for low eccentricity (e = 0.1)', () => {
    const M = 1.0;
    const e = 0.1;
    const E = solveKepler(M, e);
    // Verify: M = E - e*sin(E)
    expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
  });

  it('converges for moderate eccentricity (e = 0.5)', () => {
    const M = 2.5;
    const e = 0.5;
    const E = solveKepler(M, e);
    expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
  });

  it('converges for high eccentricity (e = 0.9)', () => {
    const M = 0.5;
    const e = 0.9;
    const E = solveKepler(M, e);
    expect(E - e * Math.sin(E)).toBeCloseTo(M, 8);
  });

  it('handles M = 0 (periapsis)', () => {
    const E = solveKepler(0, 0.5);
    expect(E).toBeCloseTo(0, 10);
  });

  it('handles M = π', () => {
    const E = solveKepler(Math.PI, 0.3);
    expect(E - 0.3 * Math.sin(E)).toBeCloseTo(Math.PI, 10);
  });
});

// ---------------------------------------------------------------------------
// Anomaly conversions
// ---------------------------------------------------------------------------

describe('anomaly conversions', () => {
  it('mean → true → mean round-trip (circular)', () => {
    const M = 2.0;
    const theta = meanAnomalyToTrue(M, 0);
    expect(theta).toBeCloseTo(M, 10);
    const M2 = trueAnomalyToMean(theta, 0);
    expect(M2).toBeCloseTo(M, 10);
  });

  it('mean → true → mean round-trip (e = 0.3)', () => {
    const M = 1.5;
    const e = 0.3;
    const theta = meanAnomalyToTrue(M, e);
    const M2 = trueAnomalyToMean(theta, e);
    expect(M2).toBeCloseTo(M, 8);
  });

  it('mean → true → mean round-trip (e = 0.7)', () => {
    const M = 4.0;
    const e = 0.7;
    const theta = meanAnomalyToTrue(M, e);
    const M2 = trueAnomalyToMean(theta, e);
    expect(M2).toBeCloseTo(M % TWO_PI, 6);
  });

  it('true anomaly 0 at periapsis (M = 0)', () => {
    const theta = meanAnomalyToTrue(0, 0.5);
    expect(theta).toBeCloseTo(0, 10);
  });

  it('true anomaly π at apoapsis (M = π)', () => {
    const theta = meanAnomalyToTrue(Math.PI, 0.5);
    expect(theta).toBeCloseTo(Math.PI, 6);
  });

  it('true → eccentric → back (e = 0.4)', () => {
    const theta = 1.2;
    const e = 0.4;
    const E = trueToEccentricAnomaly(theta, e);
    // Verify relationship: tan(θ/2) = sqrt((1+e)/(1-e)) * tan(E/2)
    const lhs = Math.tan(theta / 2);
    const rhs = Math.sqrt((1 + e) / (1 - e)) * Math.tan(E / 2);
    expect(lhs).toBeCloseTo(rhs, 8);
  });

  it('meanAnomalyToTrue returns finite for near-parabolic e=0.9999', () => {
    const result = meanAnomalyToTrue(1.0, 0.9999);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('meanAnomalyToTrue returns finite for e=1.0 (parabolic)', () => {
    const result = meanAnomalyToTrue(1.0, 1.0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('meanAnomalyToTrue returns finite for e=1.001 (hyperbolic)', () => {
    const result = meanAnomalyToTrue(1.0, 1.001);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('trueToEccentricAnomaly returns finite for near-parabolic e=0.9999', () => {
    const result = trueToEccentricAnomaly(1.0, 0.9999);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('trueToEccentricAnomaly returns finite for e=1.0 (parabolic)', () => {
    const result = trueToEccentricAnomaly(1.0, 1.0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it('trueToEccentricAnomaly returns finite for e=1.001 (hyperbolic)', () => {
    const result = trueToEccentricAnomaly(1.0, 1.001);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Orbital element computation
// ---------------------------------------------------------------------------

describe('computeOrbitalElements', () => {
  it('computes a circular LEO orbit correctly', () => {
    const alt = 100_000; // 100 km
    const { posX, posY, velX, velY } = circularOrbitState(alt);
    const el = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0);

    expect(el).not.toBeNull();
    // Semi-major axis ≈ R_earth + altitude.
    expect(el!.semiMajorAxis).toBeCloseTo(R_EARTH + alt, -2); // within 100 m
    // Eccentricity ≈ 0.
    expect(el!.eccentricity).toBeLessThan(1e-6);
  });

  it('computes an elliptical orbit with correct periapsis/apoapsis', () => {
    // Start at 100 km altitude, moving faster than circular (→ elliptical).
    const alt = 100_000;
    const r = R_EARTH + alt;
    const vCirc = Math.sqrt(MU_EARTH / r);
    const vFast = vCirc * 1.2; // 20% faster → elliptical

    const el = computeOrbitalElements(0, alt, vFast, 0, EARTH, 0);
    expect(el).not.toBeNull();
    expect(el!.eccentricity).toBeGreaterThan(0.01);

    const periAlt = getPeriapsisAltitude(el!, EARTH);
    const apoAlt = getApoapsisAltitude(el!, EARTH);

    // Periapsis should be near the starting altitude (we're at periapsis
    // since moving purely horizontally = fastest point).
    expect(periAlt).toBeCloseTo(alt, -3); // within 1 km
    // Apoapsis should be higher.
    expect(apoAlt).toBeGreaterThan(alt * 2);
  });

  it('returns null for escape trajectories', () => {
    // Very high velocity → escape.
    const alt = 100_000;
    const r = R_EARTH + alt;
    const vEscape = Math.sqrt(2 * MU_EARTH / r) * 1.1;

    const el = computeOrbitalElements(0, alt, vEscape, 0, EARTH, 0);
    expect(el).toBeNull();
  });

  it('returns null for unknown body', () => {
    const el = computeOrbitalElements(0, 100_000, 7800, 0, 'MARS', 0);
    expect(el).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orbital period & mean motion
// ---------------------------------------------------------------------------

describe('orbital period and mean motion', () => {
  it('ISS-like orbit has ~90 minute period', () => {
    const r = R_EARTH + 408_000; // 408 km (ISS altitude)
    const period = getOrbitalPeriod(r, EARTH);
    // ISS orbital period ≈ 92.68 minutes = 5561 s
    expect(period).toBeCloseTo(5561, -2); // within 100 s
  });

  it('GEO orbit has ~24 hour period', () => {
    const r = R_EARTH + 35_786_000; // GEO altitude
    const period = getOrbitalPeriod(r, EARTH);
    // Should be ~86164 s (sidereal day)
    expect(period).toBeCloseTo(86164, -2);
  });

  it('mean motion = 2π / period', () => {
    const r = R_EARTH + 200_000;
    const n = getMeanMotion(r, EARTH);
    const T = getOrbitalPeriod(r, EARTH);
    expect(n * T).toBeCloseTo(TWO_PI, 8);
  });
});

// ---------------------------------------------------------------------------
// Position queries
// ---------------------------------------------------------------------------

describe('getOrbitalStateAtTime', () => {
  it('circular orbit returns constant altitude', () => {
    const alt = 150_000; // 150 km
    const { posX, posY, velX, velY } = circularOrbitState(alt);
    const el = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0)!;

    // Check at multiple times.
    const T = getOrbitalPeriod(el.semiMajorAxis, EARTH);
    for (const frac of [0, 0.25, 0.5, 0.75]) {
      const state = getOrbitalStateAtTime(el, frac * T, EARTH);
      expect(state.altitude).toBeCloseTo(alt, -3); // within 1 km
    }
  });

  it('elliptical orbit has correct periapsis/apoapsis altitudes', () => {
    const alt = 100_000;
    const r = R_EARTH + alt;
    const vCirc = Math.sqrt(MU_EARTH / r);
    const el = computeOrbitalElements(0, alt, vCirc * 1.15, 0, EARTH, 0)!;

    const periAlt = getPeriapsisAltitude(el, EARTH);
    const apoAlt = getApoapsisAltitude(el, EARTH);

    // At t = 0 (epoch) the craft should be at/near periapsis.
    const stateAtEpoch = getOrbitalStateAtTime(el, 0, EARTH);
    expect(stateAtEpoch.altitude).toBeCloseTo(periAlt, -3);

    // At t = T/2 should be near apoapsis.
    const T = getOrbitalPeriod(el.semiMajorAxis, EARTH);
    const stateAtHalf = getOrbitalStateAtTime(el, T / 2, EARTH);
    expect(stateAtHalf.altitude).toBeCloseTo(apoAlt, -3);
  });

  it('angular position advances 360° in one period', () => {
    const alt = 150_000;
    const { posX, posY, velX, velY } = circularOrbitState(alt);
    const el = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0)!;
    const T = getOrbitalPeriod(el.semiMajorAxis, EARTH);

    const state0 = getOrbitalStateAtTime(el, 0, EARTH);
    const state1 = getOrbitalStateAtTime(el, T, EARTH);

    // After one full period, angular position should return to the same value.
    const diff = angularDistance(state0.angularPositionDeg, state1.angularPositionDeg);
    expect(diff).toBeLessThan(0.1); // within 0.1°
  });
});

describe('circularOrbitVelocity', () => {
  it('returns ~7.8 km/s at LEO altitude', () => {
    const v = circularOrbitVelocity(100_000, EARTH);
    expect(v).toBeCloseTo(7848, -2); // ~7848 m/s
  });

  it('returns ~3.07 km/s at GEO altitude', () => {
    const v = circularOrbitVelocity(35_786_000, EARTH);
    expect(v).toBeCloseTo(3075, -2);
  });
});

// ---------------------------------------------------------------------------
// Altitude bands
// ---------------------------------------------------------------------------

describe('altitude bands', () => {
  it('classifies 100 km as LEO', () => {
    const band = getAltitudeBand(100_000, EARTH);
    expect(band).not.toBeNull();
    expect(band!.id).toBe('LEO');
  });

  it('classifies 80 km as LEO (lower bound, inclusive)', () => {
    expect(getAltitudeBandId(80_000, EARTH)).toBe('LEO');
  });

  it('classifies 199,999 m as LEO', () => {
    expect(getAltitudeBandId(199_999, EARTH)).toBe('LEO');
  });

  it('classifies 200,000 m as MEO (boundary)', () => {
    expect(getAltitudeBandId(200_000, EARTH)).toBe('MEO');
  });

  it('classifies 500 km as MEO', () => {
    expect(getAltitudeBandId(500_000, EARTH)).toBe('MEO');
  });

  it('classifies 5,000 km as HEO', () => {
    expect(getAltitudeBandId(5_000_000, EARTH)).toBe('HEO');
  });

  it('returns null for 50 km (below all bands)', () => {
    expect(getAltitudeBandId(50_000, EARTH)).toBeNull();
  });

  it('returns null for 40,000 km (above all bands)', () => {
    expect(getAltitudeBandId(40_000_000, EARTH)).toBeNull();
  });

  it('returns null for unknown body', () => {
    expect(getAltitudeBandId(100_000, 'PLUTO')).toBeNull();
  });
});

describe('orbitOverlapsBand', () => {
  it('circular LEO orbit overlaps LEO', () => {
    const { posX, posY, velX, velY } = circularOrbitState(100_000);
    const el = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0)!;
    expect(orbitOverlapsBand(el, 'LEO', EARTH)).toBe(true);
  });

  it('circular LEO orbit does NOT overlap MEO', () => {
    const { posX, posY, velX, velY } = circularOrbitState(100_000);
    const el = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0)!;
    expect(orbitOverlapsBand(el, 'MEO', EARTH)).toBe(false);
  });

  it('elliptical orbit spanning LEO and MEO overlaps both', () => {
    // Start at 100 km, boost to reach ~500 km apoapsis.
    const alt = 100_000;
    const r = R_EARTH + alt;
    const vCirc = Math.sqrt(MU_EARTH / r);
    const el = computeOrbitalElements(0, alt, vCirc * 1.15, 0, EARTH, 0)!;
    // Verify this orbit actually spans LEO→MEO.
    const apoAlt = getApoapsisAltitude(el, EARTH);
    expect(apoAlt).toBeGreaterThan(200_000);

    expect(orbitOverlapsBand(el, 'LEO', EARTH)).toBe(true);
    expect(orbitOverlapsBand(el, 'MEO', EARTH)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Angular segments
// ---------------------------------------------------------------------------

describe('angular segments', () => {
  it('segment 0 covers 0°–9.999°', () => {
    expect(getAngularSegment(0)).toBe(0);
    expect(getAngularSegment(5)).toBe(0);
    expect(getAngularSegment(9.99)).toBe(0);
  });

  it('segment 1 starts at 10°', () => {
    expect(getAngularSegment(10)).toBe(1);
  });

  it('segment 35 covers 350°–359.999°', () => {
    expect(getAngularSegment(350)).toBe(35);
    expect(getAngularSegment(359.9)).toBe(35);
  });

  it('wraps 360° to segment 0', () => {
    expect(getAngularSegment(360)).toBe(0);
  });

  it('handles negative angles', () => {
    expect(getAngularSegment(-10)).toBe(35);
    expect(getAngularSegment(-1)).toBe(35);
  });
});

describe('angularDistance', () => {
  it('same angle = 0', () => {
    expect(angularDistance(45, 45)).toBe(0);
  });

  it('90° apart', () => {
    expect(angularDistance(0, 90)).toBe(90);
  });

  it('wraps around correctly (350° to 10°)', () => {
    expect(angularDistance(350, 10)).toBe(20);
  });

  it('maximum distance is 180°', () => {
    expect(angularDistance(0, 180)).toBe(180);
  });

  it('181° wraps to 179°', () => {
    expect(angularDistance(0, 181)).toBeCloseTo(179, 10);
  });

  it('is symmetric', () => {
    expect(angularDistance(30, 120)).toBe(angularDistance(120, 30));
  });
});

// ---------------------------------------------------------------------------
// Proximity detection
// ---------------------------------------------------------------------------

describe('checkProximity', () => {
  it('returns true when same band and angle < 5°', () => {
    const s1: ProximityState = { altitude: 100_000, angularPositionDeg: 42 };
    const s2: ProximityState = { altitude: 120_000, angularPositionDeg: 44 };
    expect(checkProximity(s1, s2, EARTH)).toBe(true);
  });

  it('returns false when angle >= 5°', () => {
    const s1: ProximityState = { altitude: 100_000, angularPositionDeg: 42 };
    const s2: ProximityState = { altitude: 120_000, angularPositionDeg: 48 };
    expect(checkProximity(s1, s2, EARTH)).toBe(false);
  });

  it('returns false when different altitude bands', () => {
    const s1: ProximityState = { altitude: 100_000, angularPositionDeg: 42 }; // LEO
    const s2: ProximityState = { altitude: 500_000, angularPositionDeg: 43 }; // MEO
    expect(checkProximity(s1, s2, EARTH)).toBe(false);
  });

  it('returns false when either is outside all bands', () => {
    const s1: ProximityState = { altitude: 50_000, angularPositionDeg: 10 };  // below LEO
    const s2: ProximityState = { altitude: 100_000, angularPositionDeg: 10 }; // LEO
    expect(checkProximity(s1, s2, EARTH)).toBe(false);
  });

  it('handles wrap-around angles (359° and 1°)', () => {
    const s1: ProximityState = { altitude: 100_000, angularPositionDeg: 359 };
    const s2: ProximityState = { altitude: 100_000, angularPositionDeg: 1 };
    // Angular distance = 2°, same band → proximate.
    expect(checkProximity(s1, s2, EARTH)).toBe(true);
  });

  it('returns false at exactly 5° distance', () => {
    const s1: ProximityState = { altitude: 100_000, angularPositionDeg: 0 };
    const s2: ProximityState = { altitude: 100_000, angularPositionDeg: 5 };
    // Requirement: "angular distance < 5 degrees" (strict).
    expect(checkProximity(s1, s2, EARTH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orbit entry detection
// ---------------------------------------------------------------------------

describe('checkOrbitStatus', () => {
  it('circular LEO orbit is valid', () => {
    const { posX, posY, velX, velY } = circularOrbitState(100_000);
    const result = checkOrbitStatus(posX, posY, velX, velY, EARTH);
    expect(result.valid).toBe(true);
    expect(result.elements).not.toBeNull();
    expect(result.periapsisAlt).toBeCloseTo(100_000, -3);
    expect(result.apoapsisAlt).toBeCloseTo(100_000, -3);
  });

  it('sub-orbital trajectory is invalid (periapsis below atmosphere)', () => {
    // Moving mostly vertically at 80 km — will come back down.
    const result = checkOrbitStatus(0, 80_000, 2000, 500, EARTH);
    // This should either be unbound or have periapsis below 70 km.
    expect(result.valid).toBe(false);
  });

  it('escape trajectory is invalid', () => {
    const r = R_EARTH + 100_000;
    const vEscape = Math.sqrt(2 * MU_EARTH / r) * 1.1;
    const result = checkOrbitStatus(0, 100_000, vEscape, 0, EARTH);
    expect(result.valid).toBe(false);
    expect(result.elements).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orbital object management
// ---------------------------------------------------------------------------

describe('orbital object management', () => {
  it('createOrbitalObject creates a complete object', () => {
    const elements: OrbitalElements = {
      semiMajorAxis: R_EARTH + 150_000,
      eccentricity: 0.001,
      argPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    };
    const obj = createOrbitalObject({
      id: 'sat-1',
      bodyId: EARTH,
      type: 'SATELLITE',
      name: 'Test Satellite',
      elements,
    });

    expect(obj.id).toBe('sat-1');
    expect(obj.bodyId).toBe(EARTH);
    expect(obj.type).toBe('SATELLITE');
    expect(obj.name).toBe('Test Satellite');
    expect(obj.elements.semiMajorAxis).toBe(elements.semiMajorAxis);
    // Elements are cloned, not shared.
    expect(obj.elements).not.toBe(elements);
  });

  it('tickOrbitalObjects rebases epochs', () => {
    const elements: OrbitalElements = {
      semiMajorAxis: R_EARTH + 150_000,
      eccentricity: 0.01,
      argPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    };
    const obj = createOrbitalObject({
      id: 'sat-1', bodyId: EARTH, type: 'SATELLITE', name: 'Sat', elements,
    });

    tickOrbitalObjects([obj], 1000);
    expect(obj.elements.epoch).toBe(1000);
    // Mean anomaly should have advanced.
    expect(obj.elements.meanAnomalyAtEpoch).toBeGreaterThan(0);
  });

  it('rebaseEpoch preserves orbital position', () => {
    const alt = 150_000;
    const { posX, posY, velX, velY } = circularOrbitState(alt);
    const el = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0)!;

    const t = 500; // Check at 500 seconds.
    const stateBefore = getOrbitalStateAtTime(el, t, EARTH);

    // Rebase epoch to 500.
    rebaseEpoch(el, t, EARTH);
    const stateAfter = getOrbitalStateAtTime(el, t, EARTH);

    expect(stateAfter.altitude).toBeCloseTo(stateBefore.altitude, -2);
    expect(stateAfter.angularPositionDeg).toBeCloseTo(stateBefore.angularPositionDeg, 3);
  });
});

// ---------------------------------------------------------------------------
// Elliptical orbits crossing altitude bands
// ---------------------------------------------------------------------------

describe('elliptical orbit altitude band crossing', () => {
  it('@smoke elliptical orbit passes through multiple bands', () => {
    // 100 km periapsis, high apoapsis into MEO.
    const alt = 100_000;
    const r = R_EARTH + alt;
    const vCirc = Math.sqrt(MU_EARTH / r);
    const el = computeOrbitalElements(0, alt, vCirc * 1.2, 0, EARTH, 0)!;

    const periAlt = getPeriapsisAltitude(el, EARTH);
    const apoAlt = getApoapsisAltitude(el, EARTH);
    const T = getOrbitalPeriod(el.semiMajorAxis, EARTH);

    expect(getAltitudeBandId(periAlt, EARTH)).toBe('LEO');
    expect(apoAlt).toBeGreaterThan(200_000); // Reaches MEO

    // Sample the orbit — should find positions in both LEO and MEO.
    const bandsVisited = new Set();
    const steps = 100;
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * T;
      const state = getOrbitalStateAtTime(el, t, EARTH);
      const bandId = getAltitudeBandId(state.altitude, EARTH);
      if (bandId) bandsVisited.add(bandId);
    }

    expect(bandsVisited.has('LEO')).toBe(true);
    expect(bandsVisited.has('MEO')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Warp to target
// ---------------------------------------------------------------------------

describe('warpToTarget', () => {
  it('finds proximity for craft catching up to target in same orbit', () => {
    // Two objects in circular MEO, craft lower (faster) than target.
    // Uses 300km/900km (both MEO) so the synodic period stays within the
    // auto-calculated cap and drift is fast enough to converge quickly.
    const alt1 = 300_000;
    const alt2 = 900_000;
    const { posX: px1, posY: py1, velX: vx1, velY: vy1 } = circularOrbitState(alt1);
    const { posX: px2, posY: py2, velX: vx2, velY: vy2 } = circularOrbitState(alt2);

    const craftEl = computeOrbitalElements(px1, py1, vx1, vy1, EARTH, 0)!;
    // Offset target by 20° in mean anomaly.
    const targetEl = computeOrbitalElements(px2, py2, vx2, vy2, EARTH, 0)!;
    targetEl.meanAnomalyAtEpoch = 20 * (Math.PI / 180); // 20° ahead

    const result = warpToTarget(craftEl, targetEl, EARTH, 0);
    expect(result.possible).toBe(true);
    expect(result.time).toBeGreaterThan(0);
    expect(result.elapsed).toBeGreaterThan(0);

    // Verify proximity at the found time.
    const craftState = getOrbitalStateAtTime(craftEl, result.time!, EARTH);
    const targetState = getOrbitalStateAtTime(targetEl, result.time!, EARTH);
    const dist = angularDistance(craftState.angularPositionDeg, targetState.angularPositionDeg);
    expect(dist).toBeLessThan(5);
  });

  it('returns impossible for orbits in completely different bands', () => {
    // One in LEO, one in HEO — never share a band.
    const { posX: px1, posY: py1, velX: vx1, velY: vy1 } = circularOrbitState(100_000);
    const { posX: px2, posY: py2, velX: vx2, velY: vy2 } = circularOrbitState(5_000_000);

    const craftEl = computeOrbitalElements(px1, py1, vx1, vy1, EARTH, 0)!;
    const targetEl = computeOrbitalElements(px2, py2, vx2, vy2, EARTH, 0)!;

    const result = warpToTarget(craftEl, targetEl, EARTH, 0);
    expect(result.possible).toBe(false);
  });

  it('finds proximity for already-proximate objects immediately', () => {
    // Two objects at the same position, same orbit.
    const alt = 100_000;
    const { posX, posY, velX, velY } = circularOrbitState(alt);
    const craftEl = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0)!;
    const targetEl = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0)!;

    const result = warpToTarget(craftEl, targetEl, EARTH, 0);
    expect(result.possible).toBe(true);
    expect(result.elapsed).toBeLessThan(60); // Found almost immediately.
  });

  it('caps synodic period search duration for nearly-equal orbital periods', () => {
    // Two orbits with very similar periods (periodDiff in the 0.01–0.1 range).
    // Without the cap, T_syn would be extremely large and freeze the search.
    const alt1 = 200_000;
    const alt2 = 200_100; // ~100 m difference → nearly equal periods
    const { posX: px1, posY: py1, velX: vx1, velY: vy1 } = circularOrbitState(alt1);
    const { posX: px2, posY: py2, velX: vx2, velY: vy2 } = circularOrbitState(alt2);

    const craftEl = computeOrbitalElements(px1, py1, vx1, vy1, EARTH, 0)!;
    const targetEl = computeOrbitalElements(px2, py2, vx2, vy2, EARTH, 0)!;
    // Offset target so they aren't immediately proximate.
    targetEl.meanAnomalyAtEpoch = Math.PI; // 180° ahead

    const T_craft = getOrbitalPeriod(craftEl.semiMajorAxis, EARTH);
    const T_target = getOrbitalPeriod(targetEl.semiMajorAxis, EARTH);
    const maxPeriod = Math.max(T_craft, T_target);

    // The uncapped synodic period would be enormous; verify the search
    // completes in a reasonable duration (capped at 10× the longer period).
    const start = performance.now();
    const result = warpToTarget(craftEl, targetEl, EARTH, 0);
    const elapsed = performance.now() - start;

    // Search should complete quickly (well under 5 seconds even on slow CI).
    expect(elapsed).toBeLessThan(5000);

    // The search duration used should not exceed 10× the longer period.
    // If proximity was found, elapsed time must be within the cap.
    if (result.possible) {
      expect(result.elapsed).toBeLessThanOrEqual(10 * maxPeriod);
    }
  });
});

// ---------------------------------------------------------------------------
// Periapsis / apoapsis
// ---------------------------------------------------------------------------

describe('periapsis and apoapsis', () => {
  it('circular orbit has equal periapsis and apoapsis', () => {
    const alt = 200_000;
    const { posX, posY, velX, velY } = circularOrbitState(alt);
    const el = computeOrbitalElements(posX, posY, velX, velY, EARTH, 0)!;

    const peri = getPeriapsisAltitude(el, EARTH);
    const apo = getApoapsisAltitude(el, EARTH);
    expect(Math.abs(peri - apo)).toBeLessThan(100); // Within 100 m.
  });

  it('elliptical orbit has periapsis < apoapsis', () => {
    const alt = 100_000;
    const r = R_EARTH + alt;
    const vCirc = Math.sqrt(MU_EARTH / r);
    const el = computeOrbitalElements(0, alt, vCirc * 1.1, 0, EARTH, 0)!;

    const peri = getPeriapsisAltitude(el, EARTH);
    const apo = getApoapsisAltitude(el, EARTH);
    expect(peri).toBeLessThan(apo);
  });
});

// ---------------------------------------------------------------------------
// Per-body minimum orbit altitude (TASK-023)
// ---------------------------------------------------------------------------

describe('getMinOrbitAltitude', () => {
  it('returns 70 km for Earth', () => {
    expect(getMinOrbitAltitude('EARTH')).toBe(70_000);
  });

  it('returns 15 km for Moon', () => {
    expect(getMinOrbitAltitude('MOON')).toBe(15_000);
  });

  it('returns default 70 km for unknown body', () => {
    expect(getMinOrbitAltitude('PLUTO')).toBe(70_000);
  });
});

// ---------------------------------------------------------------------------
// Orbit entry with altitude band detection (TASK-023)
// ---------------------------------------------------------------------------

describe('checkOrbitStatus altitude band', () => {
  it('LEO orbit reports LEO altitude band', () => {
    const { posX, posY, velX, velY } = circularOrbitState(100_000);
    const result = checkOrbitStatus(posX, posY, velX, velY, EARTH);
    expect(result.valid).toBe(true);
    expect(result.altitudeBand).not.toBeNull();
    expect(result.altitudeBand!.id).toBe('LEO');
    expect(result.altitudeBand!.name).toBe('Low Earth Orbit');
  });

  it('MEO orbit reports MEO altitude band', () => {
    const { posX, posY, velX, velY } = circularOrbitState(500_000);
    const result = checkOrbitStatus(posX, posY, velX, velY, EARTH);
    expect(result.valid).toBe(true);
    expect(result.altitudeBand).not.toBeNull();
    expect(result.altitudeBand!.id).toBe('MEO');
  });

  it('invalid orbit has null altitude band', () => {
    // Sub-orbital: periapsis below 70 km.
    const result = checkOrbitStatus(0, 80_000, 2000, 500, EARTH);
    expect(result.valid).toBe(false);
    expect(result.altitudeBand).toBeNull();
  });

  it('uses per-body min orbit altitude for Moon', () => {
    const MOON = CelestialBody.MOON;
    const R_MOON = BODY_RADIUS.MOON;
    const MU_MOON = BODY_GM.MOON;
    const alt = 20_000; // Above Moon's 15 km minimum
    const r = R_MOON + alt;
    const v = Math.sqrt(MU_MOON / r);
    const result = checkOrbitStatus(0, alt, v, 0, MOON);
    expect(result.valid).toBe(true);
    expect(result.altitudeBand).not.toBeNull();
    expect(result.altitudeBand!.id).toBe('LLO');
  });

  it('orbit below Moon min altitude is invalid', () => {
    const MOON = CelestialBody.MOON;
    const R_MOON = BODY_RADIUS.MOON;
    const MU_MOON = BODY_GM.MOON;
    // Create orbit with periapsis at 10 km (below Moon's 15 km min).
    // Use higher altitude for current position but with eccentricity
    // that brings periapsis below 15 km.
    const alt = 50_000;
    const r = R_MOON + alt;
    // Velocity slightly less than circular to lower periapsis
    const vCirc = Math.sqrt(MU_MOON / r);
    const vLow = vCirc * 0.85;
    const result = checkOrbitStatus(0, alt, vLow, 0, MOON);
    // Either bound with low periapsis or unbound
    if (result.elements) {
      expect(result.periapsisAlt).toBeLessThan(15_000);
    }
    expect(result.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Orbit entry label (TASK-023)
// ---------------------------------------------------------------------------

describe('getOrbitEntryLabel', () => {
  it('returns altitude band name when present', () => {
    const orbitStatus = {
      altitudeBand: { id: 'LEO', name: 'Low Earth Orbit' },
    };
    expect(getOrbitEntryLabel(orbitStatus)).toBe('Low Earth Orbit');
  });

  it('returns "Orbit" when no altitude band', () => {
    expect(getOrbitEntryLabel({ altitudeBand: null })).toBe('Orbit');
    expect(getOrbitEntryLabel(null)).toBe('Orbit');
  });

  it('returns Moon band name for lunar orbit', () => {
    const orbitStatus = {
      altitudeBand: { id: 'LLO', name: 'Low Lunar Orbit' },
    };
    expect(getOrbitEntryLabel(orbitStatus)).toBe('Low Lunar Orbit');
  });
});

/**
 * trajectoryReadout.test.ts — Unit tests for the HUD trajectory readout helper.
 *
 * The helper combines the ballistic apoapsis estimate (1D, used during ascent)
 * with the full orbital apoapsis/periapsis (Keplerian, meaningful once a bound
 * trajectory exists) and produces the altitude-adaptive target horizontal
 * velocity the player needs to aim for.
 */

import { describe, it, expect } from 'vitest';
import { computeTrajectoryReadout } from '../core/trajectoryReadout.ts';
import { BODY_GM, BODY_RADIUS, MIN_ORBIT_ALTITUDE } from '../core/constants.ts';

const EARTH = 'EARTH';
const MOON  = 'MOON';
const MARS  = 'MARS';

describe('computeTrajectoryReadout', () => {
  describe('landed state', () => {
    it('@smoke reports landed when altitude and velocity are ~zero', () => {
      const r = computeTrajectoryReadout(0, 0, 0, 0, EARTH);
      expect(r.state).toBe('landed');
      expect(r.orbitalApo).toBeNull();
      expect(r.orbitalPeri).toBeNull();
      expect(r.ballisticApo).toBe(0);
    });

    it('still reports landed for tiny jitter below the threshold', () => {
      const r = computeTrajectoryReadout(0, 5, 0.2, 0.1, EARTH);
      expect(r.state).toBe('landed');
    });
  });

  describe('suborbital state', () => {
    it('@smoke reports suborbital when periapsis is below minimum orbit altitude', () => {
      // Straight-up ballistic: 1000 m/s at 10 km altitude. Apo ~60 km (below 80 km LEO).
      const r = computeTrajectoryReadout(0, 10_000, 0, 1000, EARTH);
      expect(r.state).toBe('suborbital');
      // Ballistic apo = alt + v²/2g = 10000 + 1_000_000/19.62 ≈ 60963
      expect(r.ballisticApo).toBeCloseTo(10_000 + 1_000_000 / 19.62, 0);
      // Orbital peri is below the surface → negative
      expect(r.orbitalPeri).not.toBeNull();
      expect(r.orbitalPeri!).toBeLessThan(MIN_ORBIT_ALTITUDE.EARTH);
    });

    it('exposes negative periapsis (below surface) during ascent', () => {
      // Small horizontal component, still suborbital.
      const r = computeTrajectoryReadout(0, 50_000, 2000, 800, EARTH);
      expect(r.state).toBe('suborbital');
      expect(r.orbitalPeri).not.toBeNull();
      expect(r.orbitalPeri!).toBeLessThan(0);
    });
  });

  describe('orbit state', () => {
    it('@smoke reports orbit for a circular LEO', () => {
      // At 120 km altitude, circular velocity = sqrt(GM / (R + 120km))
      const alt = 120_000;
      const v = Math.sqrt(BODY_GM.EARTH / (BODY_RADIUS.EARTH + alt));
      const r = computeTrajectoryReadout(0, alt, v, 0, EARTH);
      expect(r.state).toBe('orbit');
      expect(r.orbitalApo).not.toBeNull();
      expect(r.orbitalPeri).not.toBeNull();
      // Circular → apo and peri within a few metres of each other
      expect(Math.abs(r.orbitalApo! - r.orbitalPeri!)).toBeLessThan(100);
      // And both close to current altitude
      expect(r.orbitalPeri!).toBeCloseTo(alt, -1);
    });

    it('reports orbit for an elliptical orbit with peri above minimum', () => {
      // 120 km circular velocity + 10% extra → elliptical with peri at 120 km.
      const alt = 120_000;
      const vCirc = Math.sqrt(BODY_GM.EARTH / (BODY_RADIUS.EARTH + alt));
      const r = computeTrajectoryReadout(0, alt, vCirc * 1.1, 0, EARTH);
      expect(r.state).toBe('orbit');
      expect(r.orbitalApo!).toBeGreaterThan(r.orbitalPeri!);
      expect(r.orbitalPeri!).toBeGreaterThanOrEqual(MIN_ORBIT_ALTITUDE.EARTH);
    });
  });

  describe('escape state', () => {
    it('@smoke reports escape for hyperbolic trajectories', () => {
      // Escape velocity at 200 km ≈ sqrt(2·GM/r) ≈ 11 km/s. Use 13 km/s.
      const r = computeTrajectoryReadout(0, 200_000, 13_000, 0, EARTH);
      expect(r.state).toBe('escape');
      expect(r.orbitalApo).toBeNull();
      expect(r.orbitalPeri).toBeNull();
    });
  });

  describe('ballistic apoapsis', () => {
    it('equals current altitude when velY <= 0', () => {
      const r = computeTrajectoryReadout(0, 50_000, 0, -100, EARTH);
      expect(r.ballisticApo).toBe(50_000);
    });

    it('uses standard formula alt + vy²/2g when velY > 0', () => {
      const r = computeTrajectoryReadout(0, 10_000, 0, 500, EARTH);
      // 10_000 + 250_000 / 19.62 ≈ 22741
      expect(r.ballisticApo).toBeCloseTo(10_000 + (500 * 500) / 19.62, 0);
    });
  });

  describe('target horizontal velocity', () => {
    it('@smoke matches circular velocity at minOrbitAltitude for low Earth altitudes', () => {
      const r = computeTrajectoryReadout(0, 1_000, 0, 0, EARTH);
      const expected = Math.sqrt(BODY_GM.EARTH / (BODY_RADIUS.EARTH + MIN_ORBIT_ALTITUDE.EARTH));
      expect(r.targetHorizVelocity).toBeCloseTo(expected, 1);
      expect(r.targetAltitude).toBe(MIN_ORBIT_ALTITUDE.EARTH);
    });

    it('uses current altitude when above minOrbitAltitude', () => {
      const alt = 400_000;
      const r = computeTrajectoryReadout(0, alt, 0, 0, EARTH);
      const expected = Math.sqrt(BODY_GM.EARTH / (BODY_RADIUS.EARTH + alt));
      expect(r.targetHorizVelocity).toBeCloseTo(expected, 1);
      expect(r.targetAltitude).toBe(alt);
    });

    it('produces body-specific targets on the Moon', () => {
      const r = computeTrajectoryReadout(0, 0, 0, 0, MOON);
      const expected = Math.sqrt(BODY_GM.MOON / (BODY_RADIUS.MOON + MIN_ORBIT_ALTITUDE.MOON));
      expect(r.targetHorizVelocity).toBeCloseTo(expected, 1);
      // Sanity: much slower than Earth LEO
      expect(r.targetHorizVelocity).toBeLessThan(2000);
    });

    it('produces body-specific targets on Mars', () => {
      const r = computeTrajectoryReadout(0, 0, 0, 0, MARS);
      const expected = Math.sqrt(BODY_GM.MARS / (BODY_RADIUS.MARS + MIN_ORBIT_ALTITUDE.MARS));
      expect(r.targetHorizVelocity).toBeCloseTo(expected, 1);
      // Between Moon and Earth in magnitude
      expect(r.targetHorizVelocity).toBeGreaterThan(2000);
      expect(r.targetHorizVelocity).toBeLessThan(6000);
    });
  });

  describe('Earth ascent narrative', () => {
    it('@smoke transitions suborbital → orbit as horizontal velocity rises', () => {
      const alt = 100_000;
      const vCirc = Math.sqrt(BODY_GM.EARTH / (BODY_RADIUS.EARTH + alt));

      // Not fast enough.
      const slow = computeTrajectoryReadout(0, alt, vCirc * 0.7, 0, EARTH);
      expect(slow.state).toBe('suborbital');
      expect(slow.orbitalPeri!).toBeLessThan(MIN_ORBIT_ALTITUDE.EARTH);

      // Just about right.
      const fast = computeTrajectoryReadout(0, alt, vCirc, 0, EARTH);
      expect(fast.state).toBe('orbit');
      expect(fast.orbitalPeri!).toBeGreaterThanOrEqual(MIN_ORBIT_ALTITUDE.EARTH);
    });
  });
});

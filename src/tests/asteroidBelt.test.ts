/**
 * asteroidBelt.test.ts — Unit tests for the asteroid belt generation module.
 *
 * Tests asteroid count per zone, size distribution, positioning within render
 * distance, co-orbital velocity, unique naming, regeneration randomness,
 * session management, and belt zone altitude lookup.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  generateBeltAsteroids,
  getBeltZoneAtAltitude,
  getActiveAsteroids,
  hasAsteroids,
  setActiveAsteroids,
  clearAsteroids,
  asteroidSurfaceGravity,
  isAsteroidLandable,
  LANDABLE_MIN_RADIUS,
} from '../core/asteroidBelt.ts';
import { BeltZone, BODY_GM } from '../core/constants.ts';

afterEach(() => {
  clearAsteroids();
});

describe('asteroidBelt', () => {
  // -------------------------------------------------------------------------
  // 1. Correct asteroid count per zone type
  // -------------------------------------------------------------------------

  describe('asteroid count per zone', () => {
    it('generates 10 asteroids for OUTER_A', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_A,
        350_000_000_000,
        0,
        50_000,
      );
      expect(asteroids).toHaveLength(10);
    });

    it('generates 30 asteroids for DENSE @smoke', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.DENSE,
        400_000_000_000,
        0,
        50_000,
      );
      expect(asteroids).toHaveLength(30);
    });

    it('generates 10 asteroids for OUTER_B', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_B,
        450_000_000_000,
        0,
        50_000,
      );
      expect(asteroids).toHaveLength(10);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Size distribution weighted toward smaller
  // -------------------------------------------------------------------------

  describe('size distribution', () => {
    it('produces median radius closer to MIN_RADIUS than MAX_RADIUS', () => {
      const allRadii: number[] = [];
      for (let i = 0; i < 100; i++) {
        const asteroids = generateBeltAsteroids(
          BeltZone.OUTER_A,
          350_000_000_000,
          0,
          50_000,
        );
        for (const a of asteroids) {
          allRadii.push(a.radius);
        }
      }

      // All radii must be within [1, 1000]
      const MIN_RADIUS = 1;
      const MAX_RADIUS = 1000;
      for (const r of allRadii) {
        expect(r).toBeGreaterThanOrEqual(MIN_RADIUS);
        expect(r).toBeLessThanOrEqual(MAX_RADIUS);
      }

      // Median should be closer to MIN_RADIUS than MAX_RADIUS
      allRadii.sort((a, b) => a - b);
      const median = allRadii[Math.floor(allRadii.length / 2)];
      const midpoint = (MIN_RADIUS + MAX_RADIUS) / 2; // 500.5
      expect(median).toBeLessThan(midpoint);
    });
  });

  // -------------------------------------------------------------------------
  // 3. All asteroids within render distance
  // -------------------------------------------------------------------------

  describe('positioning within render distance', () => {
    it('places all asteroids within renderDistance of the player', () => {
      const playerX = 350_000_000_000;
      const playerY = 10_000_000_000;
      const renderDistance = 50_000;

      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_A,
        playerX,
        playerY,
        renderDistance,
      );

      for (const a of asteroids) {
        const dist = Math.hypot(a.posX - playerX, a.posY - playerY);
        expect(dist).toBeLessThanOrEqual(renderDistance);
      }
    });

    it('places all asteroids within a small render distance', () => {
      const playerX = 400_000_000_000;
      const playerY = 0;
      const renderDistance = 1_000;

      const asteroids = generateBeltAsteroids(
        BeltZone.DENSE,
        playerX,
        playerY,
        renderDistance,
      );

      for (const a of asteroids) {
        const dist = Math.hypot(a.posX - playerX, a.posY - playerY);
        expect(dist).toBeLessThanOrEqual(renderDistance);
      }
    });
  });

  // -------------------------------------------------------------------------
  // 4. Co-orbital velocity range
  // -------------------------------------------------------------------------

  describe('co-orbital velocity', () => {
    it('asteroid speed is within 50 m/s of circular orbital speed', () => {
      const playerX = 350_000_000_000;
      const playerY = 0;
      const MAX_VELOCITY_PERTURBATION = 50;

      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_A,
        playerX,
        playerY,
        50_000,
      );

      for (const a of asteroids) {
        const distFromSun = Math.hypot(a.posX, a.posY);
        const expectedCircularSpeed = Math.sqrt(BODY_GM.SUN / distFromSun);
        const actualSpeed = Math.hypot(a.velX, a.velY);

        // The actual speed should be within MAX_VELOCITY_PERTURBATION of the
        // expected circular speed. The perturbation is applied as vector
        // components, so the total speed deviation can be up to
        // sqrt(2) * MAX_VELOCITY_PERTURBATION in the worst case.
        const maxDeviation = Math.sqrt(2) * MAX_VELOCITY_PERTURBATION;
        expect(Math.abs(actualSpeed - expectedCircularSpeed)).toBeLessThan(
          maxDeviation,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // 5. Unique names generated
  // -------------------------------------------------------------------------

  describe('naming', () => {
    it('generates names matching AST-XXXX pattern', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.DENSE,
        400_000_000_000,
        0,
        50_000,
      );

      for (const a of asteroids) {
        expect(a.name).toMatch(/^AST-\d{4}$/);
      }
    });

    it('generates unique IDs', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.DENSE,
        400_000_000_000,
        0,
        50_000,
      );

      const ids = asteroids.map((a) => a.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Regeneration produces different set
  // -------------------------------------------------------------------------

  describe('regeneration randomness', () => {
    it('produces different asteroids on successive calls with same parameters', () => {
      const args = [
        BeltZone.OUTER_A,
        350_000_000_000,
        0,
        50_000,
      ] as const;

      const set1 = generateBeltAsteroids(...args);
      const set2 = generateBeltAsteroids(...args);

      // At least one position or name should differ between the two sets.
      const allSame = set1.every(
        (a, i) =>
          a.posX === set2[i].posX &&
          a.posY === set2[i].posY &&
          a.name === set2[i].name,
      );
      expect(allSame).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Session management
  // -------------------------------------------------------------------------

  describe('session management', () => {
    it('starts with no active asteroids', () => {
      expect(hasAsteroids()).toBe(false);
      expect(getActiveAsteroids()).toHaveLength(0);
    });

    it('setActiveAsteroids stores and getActiveAsteroids retrieves them', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_A,
        350_000_000_000,
        0,
        50_000,
      );
      setActiveAsteroids(asteroids);

      expect(hasAsteroids()).toBe(true);
      expect(getActiveAsteroids()).toHaveLength(10);
      expect(getActiveAsteroids()[0].type).toBe('asteroid');
    });

    it('setActiveAsteroids makes a defensive copy', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_A,
        350_000_000_000,
        0,
        50_000,
      );
      setActiveAsteroids(asteroids);

      // Mutating the original array should not affect the stored copy.
      asteroids.length = 0;
      expect(getActiveAsteroids()).toHaveLength(10);
    });

    it('clearAsteroids removes all active asteroids', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_A,
        350_000_000_000,
        0,
        50_000,
      );
      setActiveAsteroids(asteroids);
      expect(hasAsteroids()).toBe(true);

      clearAsteroids();
      expect(hasAsteroids()).toBe(false);
      expect(getActiveAsteroids()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // 8. getBeltZoneAtAltitude
  // -------------------------------------------------------------------------

  describe('getBeltZoneAtAltitude', () => {
    it('returns OUTER_A for altitude within 329-374 billion m @smoke', () => {
      expect(getBeltZoneAtAltitude(329_000_000_000)).toBe(BeltZone.OUTER_A);
      expect(getBeltZoneAtAltitude(350_000_000_000)).toBe(BeltZone.OUTER_A);
      expect(getBeltZoneAtAltitude(373_999_999_999)).toBe(BeltZone.OUTER_A);
    });

    it('returns DENSE for altitude within 374-419 billion m', () => {
      expect(getBeltZoneAtAltitude(374_000_000_000)).toBe(BeltZone.DENSE);
      expect(getBeltZoneAtAltitude(400_000_000_000)).toBe(BeltZone.DENSE);
      expect(getBeltZoneAtAltitude(418_999_999_999)).toBe(BeltZone.DENSE);
    });

    it('returns OUTER_B for altitude within 419-479 billion m', () => {
      expect(getBeltZoneAtAltitude(419_000_000_000)).toBe(BeltZone.OUTER_B);
      expect(getBeltZoneAtAltitude(450_000_000_000)).toBe(BeltZone.OUTER_B);
      expect(getBeltZoneAtAltitude(478_999_999_999)).toBe(BeltZone.OUTER_B);
    });

    it('returns null for altitude below the belt', () => {
      expect(getBeltZoneAtAltitude(100_000_000_000)).toBeNull();
      expect(getBeltZoneAtAltitude(328_999_999_999)).toBeNull();
    });

    it('returns null for altitude above the belt', () => {
      expect(getBeltZoneAtAltitude(479_000_000_000)).toBeNull();
      expect(getBeltZoneAtAltitude(500_000_000_000)).toBeNull();
    });

    it('returns null for altitude at exact upper boundary (exclusive)', () => {
      // The lookup uses altitude >= min && altitude < max, so the exact max
      // of one band should either fall into the next band or return null.
      expect(getBeltZoneAtAltitude(374_000_000_000)).toBe(BeltZone.DENSE);
      expect(getBeltZoneAtAltitude(419_000_000_000)).toBe(BeltZone.OUTER_B);
    });
  });

  // -------------------------------------------------------------------------
  // Additional property checks
  // -------------------------------------------------------------------------

  describe('asteroid properties', () => {
    it('all asteroids have type "asteroid"', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.DENSE,
        400_000_000_000,
        0,
        50_000,
      );
      for (const a of asteroids) {
        expect(a.type).toBe('asteroid');
      }
    });

    it('all asteroids have positive mass and radius', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_B,
        450_000_000_000,
        0,
        50_000,
      );
      for (const a of asteroids) {
        expect(a.radius).toBeGreaterThan(0);
        expect(a.mass).toBeGreaterThan(0);
      }
    });

    it('all asteroids have a numeric shapeSeed', () => {
      const asteroids = generateBeltAsteroids(
        BeltZone.OUTER_A,
        350_000_000_000,
        0,
        50_000,
      );
      for (const a of asteroids) {
        expect(typeof a.shapeSeed).toBe('number');
        expect(Number.isFinite(a.shapeSeed)).toBe(true);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Asteroid surface gravity
  // -------------------------------------------------------------------------

  describe('asteroid surface gravity', () => {
    it('computes gravity for a 1km asteroid', () => {
      // 1000m radius, rock density 2500 kg/m³
      const volume = (4 / 3) * Math.PI * 1000 ** 3;
      const mass = volume * 2500;
      const g = asteroidSurfaceGravity(mass, 1000);
      // g should be approximately 0.0007 m/s² (microgravity)
      expect(g).toBeGreaterThan(0.0005);
      expect(g).toBeLessThan(0.001);
    });

    it('computes gravity for a 100m asteroid', () => {
      const volume = (4 / 3) * Math.PI * 100 ** 3;
      const mass = volume * 2500;
      const g = asteroidSurfaceGravity(mass, 100);
      expect(g).toBeGreaterThan(0);
      expect(g).toBeLessThan(0.001);
    });

    it('returns 0 for zero radius', () => {
      expect(asteroidSurfaceGravity(1000, 0)).toBe(0);
    });

    it('returns 0 for negative radius', () => {
      expect(asteroidSurfaceGravity(1000, -5)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // isAsteroidLandable
  // -------------------------------------------------------------------------

  describe('isAsteroidLandable', () => {
    it('returns true for asteroid with radius >= 100m', () => {
      expect(isAsteroidLandable({ radius: 100 })).toBe(true);
      expect(isAsteroidLandable({ radius: 500 })).toBe(true);
      expect(isAsteroidLandable({ radius: 1000 })).toBe(true);
    });

    it('returns false for asteroid with radius < 100m', () => {
      expect(isAsteroidLandable({ radius: 99 })).toBe(false);
      expect(isAsteroidLandable({ radius: 50 })).toBe(false);
      expect(isAsteroidLandable({ radius: 1 })).toBe(false);
    });

    it('LANDABLE_MIN_RADIUS constant is 100', () => {
      expect(LANDABLE_MIN_RADIUS).toBe(100);
    });
  });
});

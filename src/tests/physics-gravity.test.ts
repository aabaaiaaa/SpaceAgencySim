import { describe, it, expect } from 'vitest';
import { gravityForBody, G0 } from '../core/physics/gravity.ts';
import { BODY_RADIUS } from '../core/constants.ts';
import { getSurfaceGravity } from '../data/bodies.ts';

describe('physics/gravity', () => {
  describe('flat-mode (no body / fallback)', () => {
    it('returns G0 (9.81) at sea level when bodyId is undefined @smoke', () => {
      expect(gravityForBody(undefined, 0)).toBeCloseTo(G0, 5);
    });

    it('clamps negative altitude to 0 and still returns G0 when bodyId is undefined', () => {
      expect(gravityForBody(undefined, -10_000)).toBeCloseTo(G0, 5);
    });

    it('falls off with altitude using Earth radius fallback when bodyId is undefined', () => {
      const R: number = 6_371_000;
      const h: number = 100_000;
      const expected: number = G0 * (R * R) / ((R + h) * (R + h));
      expect(gravityForBody(undefined, h)).toBeCloseTo(expected, 6);
    });
  });

  describe('radial-mode on Earth', () => {
    it('returns Earth surface gravity at altitude 0 @smoke', () => {
      const earthG: number = getSurfaceGravity('EARTH');
      expect(gravityForBody('EARTH', 0)).toBeCloseTo(earthG, 5);
      expect(earthG).toBeCloseTo(9.81, 2);
    });

    it('follows inverse-square falloff at altitude', () => {
      const R: number = BODY_RADIUS.EARTH;
      const g0: number = getSurfaceGravity('EARTH');
      const h: number = 400_000; // ~ISS altitude
      const expected: number = g0 * (R * R) / ((R + h) * (R + h));
      expect(gravityForBody('EARTH', h)).toBeCloseTo(expected, 6);
    });

    it('gravity decreases monotonically with altitude', () => {
      const g_surface: number = gravityForBody('EARTH', 0);
      const g_low: number = gravityForBody('EARTH', 100_000);
      const g_high: number = gravityForBody('EARTH', 1_000_000);
      expect(g_surface).toBeGreaterThan(g_low);
      expect(g_low).toBeGreaterThan(g_high);
    });
  });

  describe('radial-mode on a non-Earth body (MOON / "Mun")', () => {
    it('returns Moon surface gravity at altitude 0 (body-aware, not Earth default) @smoke', () => {
      const moonG: number = getSurfaceGravity('MOON');
      const result: number = gravityForBody('MOON', 0);
      expect(result).toBeCloseTo(moonG, 5);
      expect(result).toBeCloseTo(1.62, 2);
      // Regression: must NOT silently fall back to Earth's 9.81.
      expect(result).not.toBeCloseTo(G0, 1);
    });

    it('uses Moon radius (not Earth radius) for inverse-square falloff', () => {
      const R: number = BODY_RADIUS.MOON;
      const g0: number = getSurfaceGravity('MOON');
      const h: number = 50_000;
      const expected: number = g0 * (R * R) / ((R + h) * (R + h));
      expect(gravityForBody('MOON', h)).toBeCloseTo(expected, 6);

      // Sanity: if Earth radius were (incorrectly) used, result would differ noticeably.
      const wrongWithEarthRadius: number =
        g0 * (BODY_RADIUS.EARTH * BODY_RADIUS.EARTH)
        / ((BODY_RADIUS.EARTH + h) * (BODY_RADIUS.EARTH + h));
      expect(gravityForBody('MOON', h)).not.toBeCloseTo(wrongWithEarthRadius, 4);
    });

    it('differs from Earth gravity at the same altitude', () => {
      const h: number = 10_000;
      expect(gravityForBody('MOON', h)).toBeLessThan(gravityForBody('EARTH', h));
    });
  });

  describe('unknown body fallback', () => {
    it('falls back to Earth radius (and surface gravity default) for unrecognised bodyId', () => {
      // getSurfaceGravity returns 9.81 for unknown bodies; BODY_RADIUS lookup falls back to 6_371_000.
      const h: number = 0;
      expect(gravityForBody('NOT_A_REAL_BODY', h)).toBeCloseTo(G0, 5);
    });
  });
});

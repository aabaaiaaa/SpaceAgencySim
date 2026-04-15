import { describe, it, expect } from 'vitest';
import {
  BEZIER_OFFSET_FACTOR,
  bezierControlPoint,
  evalQuadBezier,
  BODY_COLORS,
  DEFAULT_BODY_COLOR,
  getBodyColorHex,
  getBodyColorNum,
  ROUTE_STATUS_COLORS,
} from '../core/mapGeometry.ts';

describe('mapGeometry', () => {
  describe('BEZIER_OFFSET_FACTOR', () => {
    it('@smoke should be 0.18', () => {
      expect(BEZIER_OFFSET_FACTOR).toBe(0.18);
    });
  });

  describe('bezierControlPoint', () => {
    it('@smoke computes midpoint offset perpendicular to horizontal line', () => {
      // Horizontal line from (0,0) to (100,0), legIndex 0
      // dx=100, dy=0, dist=100, px=0, py=1, offset=18, sign=1
      // cx = 50 + 0*18*1 = 50, cy = 0 + 1*18*1 = 18
      const cp = bezierControlPoint(0, 0, 100, 0, 0);
      expect(cp.cx).toBeCloseTo(50, 5);
      expect(cp.cy).toBeCloseTo(18, 5);
    });

    it('alternates direction for odd legIndex', () => {
      const cp0 = bezierControlPoint(0, 0, 100, 0, 0);
      const cp1 = bezierControlPoint(0, 0, 100, 0, 1);
      // Control points should be mirrored across the line
      expect(cp0.cx).toBeCloseTo(cp1.cx, 5);
      expect(cp0.cy).toBeCloseTo(-cp1.cy, 5);
    });

    it('returns midpoint when endpoints are identical (zero distance)', () => {
      const cp = bezierControlPoint(50, 50, 50, 50, 0);
      expect(cp.cx).toBe(50);
      expect(cp.cy).toBe(50);
    });

    it('handles diagonal line', () => {
      const cp = bezierControlPoint(0, 0, 100, 100, 0);
      // Distance = sqrt(20000) ≈ 141.42
      // Midpoint = (50, 50)
      // px = -100/141.42 ≈ -0.707, py = 100/141.42 ≈ 0.707
      // offset = 0.18 * 141.42 ≈ 25.46, sign = 1
      expect(cp.cx).not.toBe(50); // offset applied
      expect(cp.cy).not.toBe(50);
    });
  });

  describe('evalQuadBezier', () => {
    it('@smoke returns start point at t=0', () => {
      const p = evalQuadBezier(10, 20, 50, 80, 90, 20, 0);
      expect(p.x).toBeCloseTo(10, 5);
      expect(p.y).toBeCloseTo(20, 5);
    });

    it('returns end point at t=1', () => {
      const p = evalQuadBezier(10, 20, 50, 80, 90, 20, 1);
      expect(p.x).toBeCloseTo(90, 5);
      expect(p.y).toBeCloseTo(20, 5);
    });

    it('returns weighted midpoint at t=0.5', () => {
      // For quadratic Bézier at t=0.5:
      // x = 0.25*x1 + 0.5*cx + 0.25*x2
      const p = evalQuadBezier(0, 0, 100, 100, 200, 0, 0.5);
      expect(p.x).toBeCloseTo(100, 5);
      expect(p.y).toBeCloseTo(50, 5);
    });
  });

  describe('body colors', () => {
    it('@smoke BODY_COLORS contains all known bodies', () => {
      const expected = ['sun', 'earth', 'moon', 'mars', 'ceres', 'jupiter', 'saturn', 'titan'];
      for (const body of expected) {
        expect(BODY_COLORS).toHaveProperty(body);
      }
    });

    it('DEFAULT_BODY_COLOR is a valid hex string', () => {
      expect(DEFAULT_BODY_COLOR).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it('getBodyColorHex returns the hex string for a known body', () => {
      expect(getBodyColorHex('earth')).toBe('#4488CC');
    });

    it('getBodyColorHex returns default for unknown body', () => {
      expect(getBodyColorHex('pluto')).toBe(DEFAULT_BODY_COLOR);
    });

    it('getBodyColorHex is case-insensitive', () => {
      expect(getBodyColorHex('EARTH')).toBe('#4488CC');
      expect(getBodyColorHex('Earth')).toBe('#4488CC');
    });

    it('@smoke getBodyColorNum returns numeric equivalent of hex', () => {
      expect(getBodyColorNum('earth')).toBe(0x4488CC);
    });

    it('getBodyColorNum returns default for unknown body', () => {
      expect(getBodyColorNum('pluto')).toBe(0x888888);
    });

    it('hex and num are consistent for all bodies', () => {
      for (const [body, hex] of Object.entries(BODY_COLORS)) {
        const num = getBodyColorNum(body);
        const expectedNum = parseInt(hex.slice(1), 16);
        expect(num).toBe(expectedNum);
      }
    });
  });

  describe('ROUTE_STATUS_COLORS', () => {
    it('@smoke has active, paused, and broken entries', () => {
      expect(ROUTE_STATUS_COLORS.active.hex).toBe('#64B4FF');
      expect(ROUTE_STATUS_COLORS.active.num).toBe(0x64B4FF);
      expect(ROUTE_STATUS_COLORS.paused.hex).toBe('#666666');
      expect(ROUTE_STATUS_COLORS.paused.num).toBe(0x666666);
      expect(ROUTE_STATUS_COLORS.broken.hex).toBe('#CC3333');
      expect(ROUTE_STATUS_COLORS.broken.num).toBe(0xCC3333);
    });

    it('hex and num are consistent for all statuses', () => {
      for (const [, colors] of Object.entries(ROUTE_STATUS_COLORS)) {
        const expectedNum = parseInt(colors.hex.slice(1), 16);
        expect(colors.num).toBe(expectedNum);
      }
    });
  });
});

/**
 * render-helpers.test.ts — Unit tests for pure render helper functions.
 *
 * These functions are pure (no PixiJS context needed) but live in modules
 * that import PixiJS-dependent siblings, so we mock those dependencies.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock PixiJS-dependent modules BEFORE importing functions under test.
// ---------------------------------------------------------------------------

// _state.ts imports pixi.js at module level.
vi.mock('../render/flight/_state.ts', () => ({
  getFlightRenderState: vi.fn(() => ({})),
  setFlightRenderState: vi.fn(),
  resetFlightRenderState: vi.fn(),
}));

// _pool.ts imports pixi.js and ../pool.ts at module level.
vi.mock('../render/flight/_pool.ts', () => ({
  acquireGraphics: vi.fn(),
  acquireText: vi.fn(),
  releaseGraphics: vi.fn(),
  releaseContainerChildren: vi.fn(),
  drainPools: vi.fn(),
}));

// _camera.ts imports _state.ts and other modules.
vi.mock('../render/flight/_camera.ts', () => ({
  ppm: vi.fn(() => 1),
  worldToScreen: vi.fn(),
  hasCommandModule: vi.fn(),
  computeCoM: vi.fn(),
  updateCamera: vi.fn(),
}));

// asteroidBelt.ts imports transferObjects and constants with runtime values.
vi.mock('../core/asteroidBelt.ts', () => ({
  getActiveAsteroids: vi.fn(() => []),
  hasAsteroids: vi.fn(() => false),
  setActiveAsteroids: vi.fn(),
  clearAsteroids: vi.fn(),
  generateBeltAsteroids: vi.fn(),
  getBeltZoneAtAltitude: vi.fn(),
  asteroidSurfaceGravity: vi.fn(),
  isAsteroidLandable: vi.fn(),
  LANDABLE_MIN_RADIUS: 100,
}));

// _sky.ts imports bodies data functions.
vi.mock('../data/bodies.ts', () => ({
  getSkyVisual: vi.fn(),
  getGroundVisual: vi.fn(),
  getAtmosphereTop: vi.fn(),
  CELESTIAL_BODIES: {},
}));

// ---------------------------------------------------------------------------
// Now import the pure functions under test.
// ---------------------------------------------------------------------------

import { lerpColor } from '../render/flight/_sky.ts';
import { seededRng, getSizeCategory, getLOD } from '../render/flight/_asteroids.ts';

// ===========================================================================
// lerpColor
// ===========================================================================

describe('lerpColor', () => {
  it('returns c1 when t = 0', () => {
    const c1 = 0xff0000; // red
    const c2 = 0x0000ff; // blue
    expect(lerpColor(c1, c2, 0)).toBe(c1);
  });

  it('returns c2 when t = 1', () => {
    const c1 = 0xff0000;
    const c2 = 0x0000ff;
    expect(lerpColor(c1, c2, 1)).toBe(c2);
  });

  it('returns midpoint when t = 0.5 @smoke', () => {
    // black (0x000000) to white (0xffffff)
    // Each channel: 0 + (255 - 0) * 0.5 = 127.5, rounded to 128 = 0x80
    const result = lerpColor(0x000000, 0xffffff, 0.5);
    expect(result).toBe(0x808080);
  });

  it('interpolates each RGB channel independently', () => {
    // c1 = (100, 0, 200), c2 = (200, 100, 0), t = 0.5
    const c1 = (100 << 16) | (0 << 8) | 200;   // 0x6400c8
    const c2 = (200 << 16) | (100 << 8) | 0;    // 0xc86400
    const result = lerpColor(c1, c2, 0.5);
    const r = (result >> 16) & 0xff;
    const g = (result >> 8) & 0xff;
    const b = result & 0xff;
    expect(r).toBe(150);  // (100 + 200) / 2
    expect(g).toBe(50);   // (0 + 100) / 2
    expect(b).toBe(100);  // (200 + 0) / 2
  });

  it('handles same colour for c1 and c2', () => {
    const c = 0x42abcd;
    expect(lerpColor(c, c, 0.0)).toBe(c);
    expect(lerpColor(c, c, 0.5)).toBe(c);
    expect(lerpColor(c, c, 1.0)).toBe(c);
  });

  it('interpolates black to white at t = 0.25', () => {
    const result = lerpColor(0x000000, 0xffffff, 0.25);
    // Each channel: round(0 + 255 * 0.25) = round(63.75) = 64 = 0x40
    expect(result).toBe(0x404040);
  });
});

// ===========================================================================
// seededRng
// ===========================================================================

describe('seededRng', () => {
  it('same seed produces same sequence @smoke', () => {
    const rng1 = seededRng(12345);
    const rng2 = seededRng(12345);
    const seq1 = [rng1(), rng1(), rng1(), rng1(), rng1()];
    const seq2 = [rng2(), rng2(), rng2(), rng2(), rng2()];
    expect(seq1).toEqual(seq2);
  });

  it('different seeds produce different sequences', () => {
    const rng1 = seededRng(1);
    const rng2 = seededRng(2);
    const seq1 = [rng1(), rng1(), rng1()];
    const seq2 = [rng2(), rng2(), rng2()];
    // Extremely unlikely to match with different seeds.
    expect(seq1).not.toEqual(seq2);
  });

  it('produces values in [0, 1)', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces varied values (not stuck at one number)', () => {
    const rng = seededRng(999);
    const values = new Set<number>();
    for (let i = 0; i < 20; i++) {
      values.add(rng());
    }
    // A good PRNG with 20 draws should produce many distinct values.
    expect(values.size).toBeGreaterThan(15);
  });
});

// ===========================================================================
// getSizeCategory
// ===========================================================================

describe('getSizeCategory', () => {
  it('returns "small" for radius < 10 @smoke', () => {
    expect(getSizeCategory(0)).toBe('small');
    expect(getSizeCategory(1)).toBe('small');
    expect(getSizeCategory(9)).toBe('small');
    expect(getSizeCategory(9.99)).toBe('small');
  });

  it('returns "medium" for radius >= 10 and < 100', () => {
    expect(getSizeCategory(10)).toBe('medium');
    expect(getSizeCategory(50)).toBe('medium');
    expect(getSizeCategory(99)).toBe('medium');
    expect(getSizeCategory(99.99)).toBe('medium');
  });

  it('returns "large" for radius >= 100', () => {
    expect(getSizeCategory(100)).toBe('large');
    expect(getSizeCategory(500)).toBe('large');
    expect(getSizeCategory(1000)).toBe('large');
  });

  it('boundary: 9 is small, 10 is medium', () => {
    expect(getSizeCategory(9)).toBe('small');
    expect(getSizeCategory(10)).toBe('medium');
  });

  it('boundary: 99 is medium, 100 is large', () => {
    expect(getSizeCategory(99)).toBe('medium');
    expect(getSizeCategory(100)).toBe('large');
  });
});

// ===========================================================================
// getLOD
// ===========================================================================

describe('getLOD', () => {
  it('returns "full" for relativeSpeed < 5 @smoke', () => {
    expect(getLOD(0)).toBe('full');
    expect(getLOD(4)).toBe('full');
    expect(getLOD(4.99)).toBe('full');
  });

  it('returns "basic" for relativeSpeed >= 5 and < 50', () => {
    expect(getLOD(5)).toBe('basic');
    expect(getLOD(25)).toBe('basic');
    expect(getLOD(49)).toBe('basic');
    expect(getLOD(49.99)).toBe('basic');
  });

  it('returns "streak" for relativeSpeed >= 50', () => {
    expect(getLOD(50)).toBe('streak');
    expect(getLOD(100)).toBe('streak');
    expect(getLOD(1000)).toBe('streak');
  });

  it('boundary: 4 is full, 5 is basic', () => {
    expect(getLOD(4)).toBe('full');
    expect(getLOD(5)).toBe('basic');
  });

  it('boundary: 49 is basic, 50 is streak', () => {
    expect(getLOD(49)).toBe('basic');
    expect(getLOD(50)).toBe('streak');
  });
});

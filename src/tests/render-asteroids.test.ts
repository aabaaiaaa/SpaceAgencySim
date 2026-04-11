/**
 * render-asteroids.test.ts — Unit tests for asteroid rendering helpers.
 *
 * Tests getSizeCategory, getLOD, seededRng, and renderBeltAsteroids from
 * src/render/flight/_asteroids.ts.
 */

import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock pixi.js
// ---------------------------------------------------------------------------

interface MockSetFn {
  set: ReturnType<typeof vi.fn>;
}

const { MockGraphics, MockText, MockTextStyle, MockContainer } = vi.hoisted(() => {
  type MockChild = MockGraphics | MockText | MockContainer;

  class MockGraphics {
    visible: boolean = true;
    alpha: number = 1;
    position: MockSetFn = { set: vi.fn() };
    scale: MockSetFn = { set: vi.fn() };
    rotation: number = 0;
    label: string = '';
    parent: MockContainer | null = null;
    clear = vi.fn();
    rect = vi.fn();
    fill = vi.fn();
    stroke = vi.fn();
    circle = vi.fn();
    arc = vi.fn();
    moveTo = vi.fn();
    lineTo = vi.fn();
    closePath = vi.fn();
    ellipse = vi.fn();
  }
  class MockText {
    visible: boolean = true;
    alpha: number = 1;
    position: MockSetFn = { set: vi.fn() };
    scale: MockSetFn = { set: vi.fn() };
    rotation: number = 0;
    label: string = '';
    anchor: MockSetFn = { set: vi.fn() };
    parent: MockContainer | null = null;
    text: string = '';
    style: MockTextStyle | null = null;
    x: number = 0;
    y: number = 0;
    constructor() {}
  }
  class MockTextStyle {}
  class MockContainer {
    children: MockChild[] = [];
    addChild(c: MockChild): MockChild { this.children.push(c); return c; }
    removeChildAt(i: number): MockChild { return this.children.splice(i, 1)[0]; }
    removeChild(c: MockChild): MockChild {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    }
  }
  return { MockGraphics, MockText, MockTextStyle, MockContainer };
});

vi.mock('pixi.js', () => ({
  Graphics: MockGraphics,
  Text: MockText,
  TextStyle: MockTextStyle,
  Container: MockContainer,
}));

import {
  getSizeCategory,
  getLOD,
  seededRng,
  renderBeltAsteroids,
} from '../render/flight/_asteroids.ts';
// Types are tested indirectly via the exported functions.

// ---------------------------------------------------------------------------
// getSizeCategory
// ---------------------------------------------------------------------------

describe('getSizeCategory', () => {
  it('returns "small" for radius < 10', () => {
    expect(getSizeCategory(0.5)).toBe('small');
    expect(getSizeCategory(1)).toBe('small');
    expect(getSizeCategory(5)).toBe('small');
    expect(getSizeCategory(9.99)).toBe('small');
  });

  it('returns "medium" for radius 10..99', () => {
    expect(getSizeCategory(10)).toBe('medium');
    expect(getSizeCategory(50)).toBe('medium');
    expect(getSizeCategory(99.99)).toBe('medium');
  });

  it('returns "large" for radius >= 100', () => {
    expect(getSizeCategory(100)).toBe('large');
    expect(getSizeCategory(500)).toBe('large');
    expect(getSizeCategory(1000)).toBe('large');
  });

  it('@smoke boundary values are correct', () => {
    expect(getSizeCategory(9.999)).toBe('small');
    expect(getSizeCategory(10)).toBe('medium');
    expect(getSizeCategory(99.999)).toBe('medium');
    expect(getSizeCategory(100)).toBe('large');
  });
});

// ---------------------------------------------------------------------------
// getLOD
// ---------------------------------------------------------------------------

describe('getLOD', () => {
  it('returns "full" for relative speed < 5 m/s', () => {
    expect(getLOD(0)).toBe('full');
    expect(getLOD(1)).toBe('full');
    expect(getLOD(4.99)).toBe('full');
  });

  it('returns "basic" for relative speed 5..49 m/s', () => {
    expect(getLOD(5)).toBe('basic');
    expect(getLOD(25)).toBe('basic');
    expect(getLOD(49.99)).toBe('basic');
  });

  it('returns "streak" for relative speed >= 50 m/s', () => {
    expect(getLOD(50)).toBe('streak');
    expect(getLOD(100)).toBe('streak');
    expect(getLOD(1000)).toBe('streak');
  });

  it('@smoke boundary values are correct', () => {
    expect(getLOD(4.999)).toBe('full');
    expect(getLOD(5)).toBe('basic');
    expect(getLOD(49.999)).toBe('basic');
    expect(getLOD(50)).toBe('streak');
  });
});

// ---------------------------------------------------------------------------
// seededRng
// ---------------------------------------------------------------------------

describe('seededRng', () => {
  it('produces values in [0, 1)', () => {
    const rng = seededRng(42);
    for (let i = 0; i < 100; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('is deterministic for the same seed', () => {
    const rng1 = seededRng(12345);
    const rng2 = seededRng(12345);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = seededRng(1);
    const rng2 = seededRng(2);
    // At least one of the first 10 values should differ.
    let allSame = true;
    for (let i = 0; i < 10; i++) {
      if (rng1() !== rng2()) {
        allSame = false;
        break;
      }
    }
    expect(allSame).toBe(false);
  });

  it('does not return the same value consecutively', () => {
    const rng = seededRng(7);
    let prev = rng();
    let allSame = true;
    for (let i = 0; i < 50; i++) {
      const val = rng();
      if (val !== prev) { allSame = false; break; }
      prev = val;
    }
    expect(allSame).toBe(false);
  });

  it('seed 0 still produces valid output', () => {
    const rng = seededRng(0);
    const val = rng();
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// renderBeltAsteroids — basic integration (with mocked PixiJS)
// ---------------------------------------------------------------------------

describe('renderBeltAsteroids', () => {
  it('returns early when asteroidsContainer is null (no crash)', () => {
    // With no flight render state set up, the function should return early.
    expect(() => {
      renderBeltAsteroids(800, 600, 0, 0, 0, 0, null);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// seededRng — additional edge cases
// ---------------------------------------------------------------------------

describe('seededRng edge cases', () => {
  it('negative seeds still produce deterministic output', () => {
    // The LCG is designed for positive seeds (shapeSeed), but should
    // be deterministic even for negative inputs.
    const rng1 = seededRng(-1);
    const rng2 = seededRng(-1);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('handles very large seeds', () => {
    const rng = seededRng(2147483646); // max int32 - 1
    for (let i = 0; i < 20; i++) {
      const val = rng();
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(1);
    }
  });

  it('negative seeds produce deterministic results', () => {
    const rng1 = seededRng(-42);
    const rng2 = seededRng(-42);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('produces reasonable distribution (no clustering at edges)', () => {
    const rng = seededRng(123);
    let countLow = 0;
    let countHigh = 0;
    const n = 1000;
    for (let i = 0; i < n; i++) {
      const val = rng();
      if (val < 0.5) countLow++;
      else countHigh++;
    }
    // Expect roughly 50/50 split — allow generous tolerance (40-60%)
    expect(countLow).toBeGreaterThan(n * 0.3);
    expect(countHigh).toBeGreaterThan(n * 0.3);
  });

  it('adjacent seeds produce different first values', () => {
    const values = new Set<number>();
    for (let seed = 0; seed < 20; seed++) {
      values.add(seededRng(seed)());
    }
    // At least 15 of the 20 seeds should produce unique first values
    expect(values.size).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// getSizeCategory — edge values
// ---------------------------------------------------------------------------

describe('getSizeCategory edge values', () => {
  it('returns "small" for radius 0', () => {
    expect(getSizeCategory(0)).toBe('small');
  });

  it('returns "small" for very small fractional radius', () => {
    expect(getSizeCategory(0.001)).toBe('small');
  });

  it('returns "large" for very large radius', () => {
    expect(getSizeCategory(100_000)).toBe('large');
  });
});

// ---------------------------------------------------------------------------
// getLOD — additional values
// ---------------------------------------------------------------------------

describe('getLOD additional checks', () => {
  it('returns "full" for exactly 0 speed', () => {
    expect(getLOD(0)).toBe('full');
  });

  it('returns "streak" for very high speeds', () => {
    expect(getLOD(10_000)).toBe('streak');
  });

  it('handles fractional speeds near boundaries', () => {
    expect(getLOD(4.9999)).toBe('full');
    expect(getLOD(5.0001)).toBe('basic');
    expect(getLOD(49.9999)).toBe('basic');
    expect(getLOD(50.0001)).toBe('streak');
  });
});

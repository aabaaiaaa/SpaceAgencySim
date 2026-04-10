/**
 * render-trails.test.ts — Unit tests for trail segment logic.
 *
 * Tests updateTrails (aging + expiration) and trailDt (timing)
 * from src/render/flight/_trails.ts.
 */

import { describe, it, expect, beforeEach, vi, afterEach, type Mock } from 'vitest';
import type { TrailSegment } from '../render/flight/_state.ts';

// ---------------------------------------------------------------------------
// Mock pixi.js
// ---------------------------------------------------------------------------

vi.mock('pixi.js', () => ({
  Graphics: class {
    visible = true; alpha = 1; position = { set: vi.fn() }; scale = { set: vi.fn() };
    rotation = 0; label = ''; parent: unknown = null; clear: Mock = vi.fn(); rect: Mock = vi.fn();
    fill: Mock = vi.fn(); stroke: Mock = vi.fn(); circle: Mock = vi.fn(); moveTo: Mock = vi.fn();
    lineTo: Mock = vi.fn(); closePath: Mock = vi.fn(); ellipse: Mock = vi.fn();
  },
  Text: class {
    visible = true; alpha = 1; position = { set: vi.fn() }; scale = { set: vi.fn() };
    rotation = 0; label = ''; anchor = { set: vi.fn() }; parent: unknown = null; text = '';
    style: Record<string, unknown> | null = null; x = 0; y = 0;
    constructor() { /* empty */ }
  },
  TextStyle: class {},
  Container: class {
    children: unknown[] = [];
    addChild(c: unknown): unknown { this.children.push(c); return c; }
    removeChildAt(i: number): unknown { return this.children.splice(i, 1)[0]; }
    removeChild(c: unknown): unknown { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  },
}));

// Mock parts and bodies data
vi.mock('../data/parts.ts', () => ({
  getPartById: vi.fn(),
}));

import {
  getFlightRenderState,
  resetFlightRenderState,
} from '../render/flight/_state.ts';
import { updateTrails, trailDt } from '../render/flight/_trails.ts';
import { TRAIL_MAX_AGE } from '../render/flight/_constants.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSegment(overrides: Partial<TrailSegment> = {}): TrailSegment {
  return {
    worldX: 0,
    worldY: 0,
    vx: 10,
    vy: -5,
    age: 0,
    baseW: 5,
    baseH: 10,
    isSRB: false,
    maxAge: TRAIL_MAX_AGE,
    isSmoke: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('updateTrails', () => {
  beforeEach(() => {
    resetFlightRenderState();
  });

  it('ages segments by dt', () => {
    const s = getFlightRenderState();
    s.trailSegments.push(makeSegment({ age: 0 }));

    updateTrails(0.05);

    expect(s.trailSegments[0].age).toBeCloseTo(0.05);
  });

  it('moves segments by velocity * dt', () => {
    const s = getFlightRenderState();
    s.trailSegments.push(makeSegment({ worldX: 100, worldY: 200, vx: 20, vy: -10 }));

    updateTrails(0.1);

    expect(s.trailSegments[0].worldX).toBeCloseTo(102); // 100 + 20*0.1
    expect(s.trailSegments[0].worldY).toBeCloseTo(199); // 200 + (-10)*0.1
  });

  it('removes segments that exceed maxAge', () => {
    const s = getFlightRenderState();
    s.trailSegments.push(makeSegment({ age: 0, maxAge: 0.1 }));
    s.trailSegments.push(makeSegment({ age: 0, maxAge: 1.0 }));

    updateTrails(0.2); // first segment exceeds 0.1 max age

    expect(s.trailSegments.length).toBe(1);
    expect(s.trailSegments[0].maxAge).toBe(1.0);
  });

  it('keeps segments that are still alive', () => {
    const s = getFlightRenderState();
    s.trailSegments.push(makeSegment({ age: 0, maxAge: 1.0 }));

    updateTrails(0.05);

    expect(s.trailSegments.length).toBe(1);
    expect(s.trailSegments[0].age).toBeCloseTo(0.05);
  });

  it('handles empty segment array', () => {
    const s = getFlightRenderState();
    expect(s.trailSegments.length).toBe(0);
    updateTrails(0.1);
    expect(s.trailSegments.length).toBe(0);
  });

  it('removes all expired segments', () => {
    const s = getFlightRenderState();
    s.trailSegments.push(makeSegment({ age: 0.09, maxAge: 0.1 }));
    s.trailSegments.push(makeSegment({ age: 0.09, maxAge: 0.1 }));
    s.trailSegments.push(makeSegment({ age: 0.09, maxAge: 0.1 }));

    updateTrails(0.02); // all exceed 0.1

    expect(s.trailSegments.length).toBe(0);
  });

  it('preserves segment order during compaction', () => {
    const s = getFlightRenderState();
    s.trailSegments.push(makeSegment({ worldX: 1, maxAge: 1.0 }));
    s.trailSegments.push(makeSegment({ worldX: 2, maxAge: 0.01 })); // will expire
    s.trailSegments.push(makeSegment({ worldX: 3, maxAge: 1.0 }));

    updateTrails(0.05);

    expect(s.trailSegments.length).toBe(2);
    expect(s.trailSegments[0].worldX).toBeCloseTo(1 + 10 * 0.05); // vx=10
    expect(s.trailSegments[1].worldX).toBeCloseTo(3 + 10 * 0.05);
  });

  it('uses per-segment maxAge, falling back to TRAIL_MAX_AGE', () => {
    const s = getFlightRenderState();
    s.trailSegments.push(makeSegment({ age: 0.15, maxAge: undefined }));

    updateTrails(0.05);

    // Default TRAIL_MAX_AGE is 0.18. age=0.15+0.05=0.20 > 0.18 → removed
    expect(s.trailSegments.length).toBe(0);
  });
});

describe('trailDt', () => {
  beforeEach(() => {
    resetFlightRenderState();
    vi.spyOn(performance, 'now');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 0 on first call (lastTrailTime is null)', () => {
    vi.mocked(performance.now).mockReturnValue(1000);
    const dt = trailDt();
    expect(dt).toBe(0);
  });

  it('returns elapsed time in seconds on subsequent calls', () => {
    vi.mocked(performance.now).mockReturnValue(1000);
    trailDt(); // first call sets lastTrailTime

    vi.mocked(performance.now).mockReturnValue(1020); // 20ms later
    const dt = trailDt();
    expect(dt).toBeCloseTo(0.02);
  });

  it('clamps dt to 0.05 max', () => {
    vi.mocked(performance.now).mockReturnValue(1000);
    trailDt();

    vi.mocked(performance.now).mockReturnValue(2000); // 1 second later — way too long
    const dt = trailDt();
    expect(dt).toBe(0.05);
  });

  it('tracks time across multiple calls', () => {
    vi.mocked(performance.now).mockReturnValue(0);
    trailDt();

    vi.mocked(performance.now).mockReturnValue(16);
    const dt1 = trailDt();
    expect(dt1).toBeCloseTo(0.016);

    vi.mocked(performance.now).mockReturnValue(33);
    const dt2 = trailDt();
    expect(dt2).toBeCloseTo(0.017);
  });
});

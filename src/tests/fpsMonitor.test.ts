/**
 * fpsMonitor.test.ts — Unit tests for computeFrameStats()
 * pure helper from src/ui/fpsMonitor.ts.
 */

import { describe, it, expect } from 'vitest';
import { computeFrameStats } from '../ui/fpsMonitor.ts';

// ---------------------------------------------------------------------------
// computeFrameStats
// ---------------------------------------------------------------------------

describe('computeFrameStats()', () => {
  it('count=0 returns all zeros', () => {
    const buf = new Float64Array(60);
    const result = computeFrameStats(buf, 0);

    expect(result.fps).toBe(0);
    expect(result.avgFrameTime).toBe(0);
    expect(result.minFrameTime).toBe(0);
    expect(result.maxFrameTime).toBe(0);
  });

  it('single frame: fps = 1000/frameTime', () => {
    const buf = new Float64Array(60);
    buf[0] = 16.67; // ~60fps
    const result = computeFrameStats(buf, 1);

    expect(result.avgFrameTime).toBeCloseTo(16.67, 2);
    expect(result.fps).toBeCloseTo(1000 / 16.67, 1);
    expect(result.minFrameTime).toBeCloseTo(16.67, 2);
    expect(result.maxFrameTime).toBeCloseTo(16.67, 2);
  });

  it('full buffer with varying times: correct min/max/avg', () => {
    const size = 5;
    const buf = new Float64Array(size);
    buf[0] = 10;
    buf[1] = 20;
    buf[2] = 30;
    buf[3] = 40;
    buf[4] = 50;
    const result = computeFrameStats(buf, size);

    const expectedAvg = (10 + 20 + 30 + 40 + 50) / 5; // 30
    expect(result.avgFrameTime).toBeCloseTo(expectedAvg, 5);
    expect(result.fps).toBeCloseTo(1000 / expectedAvg, 5);
    expect(result.minFrameTime).toBe(10);
    expect(result.maxFrameTime).toBe(50);
  });

  it('constant frame times: min === max === avg', () => {
    const size = 10;
    const buf = new Float64Array(size);
    buf.fill(16.67);
    const result = computeFrameStats(buf, size);

    expect(result.minFrameTime).toBe(result.maxFrameTime);
    expect(result.minFrameTime).toBeCloseTo(result.avgFrameTime, 10);
    expect(result.fps).toBeCloseTo(1000 / 16.67, 1);
  });
});

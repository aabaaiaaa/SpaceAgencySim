import { describe, it, expect } from 'vitest';
import {
  computePreviewLayout,
  type PartRect,
  type PreviewDimensions,
} from '../core/previewLayout.ts';

const dims: PreviewDimensions = { width: 200, height: 300, padding: 10 };

describe('computePreviewLayout', () => {
  it('returns null for an empty parts array', () => {
    expect(computePreviewLayout([], dims)).toBeNull();
  });

  it('computes scale that fits multiple parts within preview bounds', () => {
    const parts: PartRect[] = [
      { x: 0, y: 0, width: 20, height: 40 },
      { x: 50, y: 80, width: 20, height: 40 },
      { x: -30, y: 40, width: 10, height: 10 },
    ];

    const result = computePreviewLayout(parts, dims)!;
    expect(result).not.toBeNull();

    // Bounding box: minX = -35, maxX = 60 → rocketW = 95
    //               minY = -20, maxY = 100 → rocketH = 120
    // drawW = 200 - 20 = 180, drawH = 300 - 20 = 280
    // scale = min(180/95, 280/120) = min(~1.894, ~2.333) ≈ 1.894
    const expectedScale = Math.min(180 / 95, 280 / 120);
    expect(result.scale).toBeCloseTo(expectedScale, 5);

    // Offsets are the centre of the preview area
    expect(result.offsetX).toBe(100);
    expect(result.offsetY).toBe(150);

    // midX/midY are the centre of the bounding box
    expect(result.midX).toBeCloseTo((-35 + 60) / 2, 5);
    expect(result.midY).toBeCloseTo((-20 + 100) / 2, 5);
  });

  it('centres a single part correctly', () => {
    const parts: PartRect[] = [{ x: 10, y: 20, width: 6, height: 8 }];

    const result = computePreviewLayout(parts, dims)!;
    expect(result).not.toBeNull();

    // Bounding box: minX = 7, maxX = 13 → rocketW = 6
    //               minY = 16, maxY = 24 → rocketH = 8
    // drawW = 180, drawH = 280
    // scale = min(180/6, 280/8) = min(30, 35) = 30
    expect(result.scale).toBeCloseTo(30, 5);
    expect(result.offsetX).toBe(100);
    expect(result.offsetY).toBe(150);
    expect(result.midX).toBeCloseTo(10, 5);
    expect(result.midY).toBeCloseTo(20, 5);
  });

  it('handles parts in a vertical line (rocketW ≈ 0) without division by zero', () => {
    // All parts at the same x — the bounding-box width comes only from part widths
    const parts: PartRect[] = [
      { x: 5, y: 0, width: 0, height: 10 },
      { x: 5, y: 50, width: 0, height: 10 },
      { x: 5, y: 100, width: 0, height: 10 },
    ];

    const result = computePreviewLayout(parts, dims)!;
    expect(result).not.toBeNull();

    // rocketW = 0 → clamped to 1 inside Math.max(rocketW, 1)
    // rocketH = 110
    // scale = min(180/1, 280/110) = min(180, ~2.545) ≈ 2.545
    expect(Number.isFinite(result.scale)).toBe(true);
    expect(result.scale).toBeGreaterThan(0);

    expect(result.offsetX).toBe(100);
    expect(result.offsetY).toBe(150);
  });

  it('handles parts in a horizontal line (rocketH ≈ 0) without division by zero', () => {
    const parts: PartRect[] = [
      { x: 0, y: 5, width: 10, height: 0 },
      { x: 50, y: 5, width: 10, height: 0 },
      { x: 100, y: 5, width: 10, height: 0 },
    ];

    const result = computePreviewLayout(parts, dims)!;
    expect(result).not.toBeNull();

    // rocketW = 110, rocketH = 0 → clamped to 1
    // scale = min(180/110, 280/1) = min(~1.636, 280) ≈ 1.636
    expect(Number.isFinite(result.scale)).toBe(true);
    expect(result.scale).toBeGreaterThan(0);

    expect(result.offsetX).toBe(100);
    expect(result.offsetY).toBe(150);
  });
});

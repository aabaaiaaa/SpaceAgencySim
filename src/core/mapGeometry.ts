/**
 * mapGeometry.ts — Shared geometry and color utilities for map rendering.
 *
 * Used by both the SVG logistics map (src/ui/logistics/_routeMap.ts)
 * and the PixiJS orbital map (src/render/map.ts). Pure math — no DOM
 * or rendering dependencies.
 *
 * @module core/mapGeometry
 */

// ---------------------------------------------------------------------------
// Bézier Curve Utilities
// ---------------------------------------------------------------------------

/** Perpendicular offset factor for route arc curvature (18% of endpoint distance). */
export const BEZIER_OFFSET_FACTOR = 0.18;

/**
 * Compute the control point for a quadratic Bézier arc between two endpoints.
 * The control point is offset perpendicular to the line connecting the endpoints.
 * Direction alternates by legIndex so multi-leg routes fan out visually.
 */
export function bezierControlPoint(
  x1: number, y1: number,
  x2: number, y2: number,
  legIndex: number,
): { cx: number; cy: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) return { cx: mx, cy: my };

  const px = -dy / dist;
  const py = dx / dist;
  const offset = BEZIER_OFFSET_FACTOR * dist;
  const sign = legIndex % 2 === 0 ? 1 : -1;

  return {
    cx: mx + px * offset * sign,
    cy: my + py * offset * sign,
  };
}

/**
 * Evaluate a quadratic Bézier curve at parameter t ∈ [0, 1].
 */
export function evalQuadBezier(
  x1: number, y1: number,
  cx: number, cy: number,
  x2: number, y2: number,
  t: number,
): { x: number; y: number } {
  const u = 1 - t;
  return {
    x: u * u * x1 + 2 * u * t * cx + t * t * x2,
    y: u * u * y1 + 2 * u * t * cy + t * t * y2,
  };
}

// ---------------------------------------------------------------------------
// Body Colors
// ---------------------------------------------------------------------------

/** Canonical body color map (hex string format). */
export const BODY_COLORS: Record<string, string> = {
  sun:     '#FFD700',
  earth:   '#4488CC',
  moon:    '#999999',
  mars:    '#CC5533',
  ceres:   '#887766',
  jupiter: '#CC9955',
  saturn:  '#CCBB77',
  titan:   '#AA8844',
};

/** Default color for bodies not in the palette. */
export const DEFAULT_BODY_COLOR = '#888888';
const DEFAULT_BODY_COLOR_NUM = 0x888888;

/** Get body color as a CSS hex string (e.g. '#4488CC'). Case-insensitive. */
export function getBodyColorHex(bodyId: string): string {
  return BODY_COLORS[bodyId.toLowerCase()] ?? DEFAULT_BODY_COLOR;
}

/** Get body color as a numeric value (e.g. 0x4488CC). Case-insensitive. */
export function getBodyColorNum(bodyId: string): number {
  const hex = BODY_COLORS[bodyId.toLowerCase()];
  if (!hex) return DEFAULT_BODY_COLOR_NUM;
  return parseInt(hex.slice(1), 16);
}

// ---------------------------------------------------------------------------
// Route Status Colors (consolidated)
// ---------------------------------------------------------------------------

/** Unified route status colors used by both SVG and PixiJS maps. */
export const ROUTE_STATUS_COLORS = {
  active: { hex: '#64B4FF', num: 0x64B4FF },
  paused: { hex: '#666666', num: 0x666666 },
  broken: { hex: '#CC3333', num: 0xCC3333 },
} as const;

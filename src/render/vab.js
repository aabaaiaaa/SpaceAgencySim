/**
 * vab.js — PixiJS rendering for the Vehicle Assembly Building scene.
 *
 * Renders the scrollable build canvas beneath the HTML overlay:
 *   - Grid background (minor lines every 1 m, major lines every 5 m).
 *   - Origin lines: ground level (Y = 0) and rocket centreline (X = 0).
 *   - (Future tasks) Placed rocket parts.
 *
 * LAYOUT CONSTANTS
 * ================
 * These numbers define the HTML overlay chrome dimensions so the grid is
 * drawn only inside the transparent build area.  They must be kept in sync
 * with the corresponding CSS values in src/ui/vab.js.
 *
 * COORDINATE SYSTEM
 * =================
 * World space
 *   Y increases upward — the rocket nose is at positive Y.
 *   X = 0 is the rocket centreline.
 *   20 world units = 1 metre  (1 px = 0.05 m at default zoom).
 *
 * Screen space
 *   Y increases downward (standard canvas convention).
 *   Screen Y of world point Yw = buildArea.y + camera.y − Yw × camera.zoom.
 *   Screen X of world point Xw = buildArea.x + camera.x + Xw × camera.zoom.
 */

import * as PIXI from 'pixi.js';
import { getApp } from './index.js';

// ---------------------------------------------------------------------------
// Layout constants — must match CSS in src/ui/vab.js
// ---------------------------------------------------------------------------

/** Toolbar height in CSS pixels. */
export const VAB_TOOLBAR_HEIGHT = 52;

/** Parts panel width in CSS pixels. */
export const VAB_PARTS_PANEL_WIDTH = 280;

/** Scale bar strip width in CSS pixels. */
export const VAB_SCALE_BAR_WIDTH = 50;

/**
 * CSS pixels per metre at default zoom (zoom = 1).
 * 1 m = 20 px  ↔  1 px = 0.05 m.
 */
export const VAB_PIXELS_PER_METRE = 20;

// ---------------------------------------------------------------------------
// Grid colours
// ---------------------------------------------------------------------------

/** Dark space-blue background for the build canvas. */
const GRID_BG       = 0x070b14;
/** Minor grid lines (every 1 m = 20 px at default zoom). */
const GRID_MINOR    = 0x0c1a2e;
/** Major grid lines (every 5 m). */
const GRID_MAJOR    = 0x162e4c;
/** Rocket centreline (X = 0). */
const GRID_CENTRE   = 0x1a3d60;
/** Ground / launch-pad level (Y = 0). */
const GRID_GROUND   = 0x204a38;

/** How many minor cells between major lines. */
const MAJOR_EVERY = 5;

// ---------------------------------------------------------------------------
// Camera state
// ---------------------------------------------------------------------------

/**
 * camera.x — horizontal pan: screen X of world origin relative to build-area left.
 * camera.y — vertical pan:   screen Y of world origin relative to build-area top.
 * camera.zoom — scale multiplier (1 = default, >1 = zoomed in).
 * @type {{ x: number, y: number, zoom: number }}
 */
const _camera = { x: 0, y: 0, zoom: 1 };

// ---------------------------------------------------------------------------
// PixiJS objects
// ---------------------------------------------------------------------------

/** @type {PIXI.Graphics | null} */
let _grid = null;

// ---------------------------------------------------------------------------
// Build-area helper
// ---------------------------------------------------------------------------

/**
 * Returns the screen-space rectangle of the build canvas (the transparent
 * region not covered by toolbar, parts panel, or scale bar).
 * @returns {{ x: number, y: number, width: number, height: number }}
 */
function getBuildArea() {
  return {
    x: VAB_SCALE_BAR_WIDTH,
    y: VAB_TOOLBAR_HEIGHT,
    width:  Math.max(1, window.innerWidth  - VAB_SCALE_BAR_WIDTH - VAB_PARTS_PANEL_WIDTH),
    height: Math.max(1, window.innerHeight - VAB_TOOLBAR_HEIGHT),
  };
}

// ---------------------------------------------------------------------------
// Grid drawing
// ---------------------------------------------------------------------------

/**
 * Redraw the grid Graphics object to match the current camera and window
 * size.  Called after any pan, zoom, or resize event.
 */
export function vabRedrawGrid() {
  if (!_grid) return;

  const area   = getBuildArea();
  const cellPx = VAB_PIXELS_PER_METRE * _camera.zoom;

  _grid.clear();

  // ── Background ──────────────────────────────────────────────────────────
  _grid.rect(area.x, area.y, area.width, area.height);
  _grid.fill(GRID_BG);

  // Screen-space position of the world origin.
  const originX = area.x + _camera.x;
  const originY = area.y + _camera.y;

  // Visible column indices.
  const colMin = Math.floor((area.x - originX) / cellPx) - 1;
  const colMax = Math.ceil((area.x + area.width - originX) / cellPx) + 1;

  // Visible row indices.
  const rowMin = Math.floor((area.y - originY) / cellPx) - 1;
  const rowMax = Math.ceil((area.y + area.height - originY) / cellPx) + 1;

  // ── Minor vertical lines ─────────────────────────────────────────────────
  for (let c = colMin; c <= colMax; c++) {
    if (c % MAJOR_EVERY === 0) continue;
    const sx = originX + c * cellPx;
    if (sx < area.x || sx > area.x + area.width) continue;
    _grid.moveTo(sx, area.y);
    _grid.lineTo(sx, area.y + area.height);
  }
  _grid.stroke({ color: GRID_MINOR, width: 1 });

  // ── Major vertical lines ─────────────────────────────────────────────────
  for (let c = colMin; c <= colMax; c++) {
    if (c % MAJOR_EVERY !== 0 || c === 0) continue;
    const sx = originX + c * cellPx;
    if (sx < area.x || sx > area.x + area.width) continue;
    _grid.moveTo(sx, area.y);
    _grid.lineTo(sx, area.y + area.height);
  }
  _grid.stroke({ color: GRID_MAJOR, width: 1 });

  // ── Minor horizontal lines ────────────────────────────────────────────────
  for (let r = rowMin; r <= rowMax; r++) {
    if (r % MAJOR_EVERY === 0) continue;
    const sy = originY + r * cellPx;
    if (sy < area.y || sy > area.y + area.height) continue;
    _grid.moveTo(area.x, sy);
    _grid.lineTo(area.x + area.width, sy);
  }
  _grid.stroke({ color: GRID_MINOR, width: 1 });

  // ── Major horizontal lines ────────────────────────────────────────────────
  for (let r = rowMin; r <= rowMax; r++) {
    if (r % MAJOR_EVERY !== 0 || r === 0) continue;
    const sy = originY + r * cellPx;
    if (sy < area.y || sy > area.y + area.height) continue;
    _grid.moveTo(area.x, sy);
    _grid.lineTo(area.x + area.width, sy);
  }
  _grid.stroke({ color: GRID_MAJOR, width: 1 });

  // ── Rocket centreline (X = 0) ────────────────────────────────────────────
  if (originX >= area.x && originX <= area.x + area.width) {
    _grid.moveTo(originX, area.y);
    _grid.lineTo(originX, area.y + area.height);
    _grid.stroke({ color: GRID_CENTRE, width: 1 });
  }

  // ── Ground / launch-pad level (Y = 0) ────────────────────────────────────
  if (originY >= area.y && originY <= area.y + area.height) {
    _grid.moveTo(area.x, originY);
    _grid.lineTo(area.x + area.width, originY);
    _grid.stroke({ color: GRID_GROUND, width: 2 });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the VAB PixiJS scene.
 * Must be called after initRenderer() has resolved.
 */
export function initVabRenderer() {
  const app = getApp();

  _grid = new PIXI.Graphics();
  app.stage.addChild(_grid);

  // Default camera: rocket origin sits 85 % down the build area.
  const area = getBuildArea();
  _camera.x = area.width  / 2;
  _camera.y = area.height * 0.85;
  _camera.zoom = 1;

  vabRedrawGrid();

  window.addEventListener('resize', vabRedrawGrid);

  console.log('[VAB Renderer] Initialized');
}

/**
 * Pan the camera by a screen-pixel delta and redraw.
 * @param {number} dx
 * @param {number} dy
 */
export function vabPanCamera(dx, dy) {
  _camera.x += dx;
  _camera.y += dy;
  vabRedrawGrid();
}

/**
 * Set the zoom level (clamped to [0.25, 4]) and redraw.
 * @param {number} zoom
 */
export function vabSetZoom(zoom) {
  _camera.zoom = Math.max(0.25, Math.min(4, zoom));
  vabRedrawGrid();
}

/**
 * Read-only snapshot of the current camera state.
 * @returns {{ x: number, y: number, zoom: number }}
 */
export function vabGetCamera() {
  return { ..._camera };
}

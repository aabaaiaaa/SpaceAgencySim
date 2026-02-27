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
import { PartType } from '../core/constants.js';
import { getPartById } from '../data/parts.js';

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
// Part rendering objects
// ---------------------------------------------------------------------------

/** Container for all placed-part graphics + labels. */
let _partsContainer = null;

/** Container for the drag-ghost graphic. */
let _ghostContainer = null;

/** Container for snap-target highlight indicators. */
let _snapContainer = null;

// ---------------------------------------------------------------------------
// Part rendering state
// ---------------------------------------------------------------------------

/** @type {import('../core/rocketbuilder.js').RocketAssembly | null} */
let _assembly = null;

/** Part ID currently being dragged (for ghost rendering), or null. */
let _ghostPartId = null;

/** Screen X/Y of the drag ghost centre. */
let _ghostSX = 0;
let _ghostSY = 0;

/** @type {import('../core/rocketbuilder.js').SnapCandidate[]} */
let _snapCandidates = [];

// ---------------------------------------------------------------------------
// Part-type fill colours
// ---------------------------------------------------------------------------

const PART_FILL = {
  [PartType.COMMAND_MODULE]:       0x1a3860,
  [PartType.COMPUTER_MODULE]:      0x122848,
  [PartType.SERVICE_MODULE]:       0x1c2c58,
  [PartType.FUEL_TANK]:            0x0e2040,
  [PartType.ENGINE]:               0x3a1a08,
  [PartType.SOLID_ROCKET_BOOSTER]: 0x301408,
  [PartType.STACK_DECOUPLER]:      0x142030,
  [PartType.RADIAL_DECOUPLER]:     0x142030,
  [PartType.DECOUPLER]:            0x142030,
  [PartType.LANDING_LEG]:          0x102018,
  [PartType.LANDING_LEGS]:         0x102018,
  [PartType.PARACHUTE]:            0x2e1438,
  [PartType.SATELLITE]:            0x142240,
  [PartType.HEAT_SHIELD]:          0x2c1000,
  [PartType.RCS_THRUSTER]:         0x182c30,
  [PartType.SOLAR_PANEL]:          0x0a2810,
};

const PART_STROKE = {
  [PartType.COMMAND_MODULE]:       0x4080c0,
  [PartType.COMPUTER_MODULE]:      0x2870a0,
  [PartType.SERVICE_MODULE]:       0x3860b0,
  [PartType.FUEL_TANK]:            0x2060a0,
  [PartType.ENGINE]:               0xc06020,
  [PartType.SOLID_ROCKET_BOOSTER]: 0xa04818,
  [PartType.STACK_DECOUPLER]:      0x305080,
  [PartType.RADIAL_DECOUPLER]:     0x305080,
  [PartType.DECOUPLER]:            0x305080,
  [PartType.LANDING_LEG]:          0x207840,
  [PartType.LANDING_LEGS]:         0x207840,
  [PartType.PARACHUTE]:            0x8040a0,
  [PartType.SATELLITE]:            0x2868b0,
  [PartType.HEAT_SHIELD]:          0xa04010,
  [PartType.RCS_THRUSTER]:         0x2890a0,
  [PartType.SOLAR_PANEL]:          0x20a040,
};

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
// Coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Convert world coords (Y-up) to PixiJS/CSS screen coords (Y-down).
 * @param {number} wx  World X.
 * @param {number} wy  World Y (positive = up).
 * @returns {{ sx: number, sy: number }}
 */
function _worldToScreen(wx, wy) {
  const area = getBuildArea();
  return {
    sx: area.x + _camera.x + wx * _camera.zoom,
    sy: area.y + _camera.y - wy * _camera.zoom,
  };
}

/**
 * Convert CSS client/screen coords to world coords.
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{ worldX: number, worldY: number }}
 */
export function vabScreenToWorld(clientX, clientY) {
  const area = getBuildArea();
  return {
    worldX: (clientX - area.x - _camera.x) / _camera.zoom,
    worldY: (area.y + _camera.y - clientY) / _camera.zoom,
  };
}

/**
 * Convert world coords to CSS screen coords.
 * @param {number} worldX
 * @param {number} worldY
 * @returns {{ screenX: number, screenY: number }}
 */
export function vabWorldToScreen(worldX, worldY) {
  const { sx, sy } = _worldToScreen(worldX, worldY);
  return { screenX: sx, screenY: sy };
}

// ---------------------------------------------------------------------------
// Internal part / ghost / snap rendering helpers
// ---------------------------------------------------------------------------

/**
 * Draw a single placed part into an existing Graphics object.
 * @param {PIXI.Graphics} g
 * @param {import('../core/rocketbuilder.js').PlacedPart} placed
 * @param {import('../data/parts.js').PartDef} def
 * @param {boolean} [picked=false]  True when this part is currently picked up.
 */
function _drawPart(g, placed, def, picked = false) {
  const { sx, sy } = _worldToScreen(placed.x, placed.y);
  const sw = def.width  * _camera.zoom;
  const sh = def.height * _camera.zoom;

  const fill   = picked ? 0x082030 : (PART_FILL[def.type]   ?? 0x0e2040);
  const stroke = picked ? 0x204860 : (PART_STROKE[def.type] ?? 0x2060a0);

  g.rect(sx - sw / 2, sy - sh / 2, sw, sh);
  g.fill({ color: fill, alpha: picked ? 0.5 : 0.9 });
  g.stroke({ color: stroke, width: 1, alpha: picked ? 0.4 : 1 });
}

/**
 * Create a Text label for a placed part, positioned at its centre.
 * @param {import('../core/rocketbuilder.js').PlacedPart} placed
 * @param {import('../data/parts.js').PartDef} def
 * @returns {PIXI.Text}
 */
function _makePartLabel(placed, def) {
  const { sx, sy } = _worldToScreen(placed.x, placed.y);
  const fontSize = Math.max(7, Math.round(10 * _camera.zoom));

  const label = new PIXI.Text({
    text: def.name,
    style: new PIXI.TextStyle({
      fill: '#a8c8e8',
      fontSize,
      fontFamily: 'Courier New, Courier, monospace',
    }),
  });
  label.anchor.set(0.5, 0.5);
  label.x = sx;
  label.y = sy;
  return label;
}

/**
 * Redraw the _partsContainer to match the current assembly + camera state.
 */
function _renderPartsLayer() {
  if (!_partsContainer) return;

  // Remove all children.
  while (_partsContainer.children.length) {
    _partsContainer.removeChildAt(0);
  }

  if (!_assembly) return;

  const g = new PIXI.Graphics();
  _partsContainer.addChild(g);

  for (const placed of _assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    _drawPart(g, placed, def, false);
  }

  // Add text labels as separate objects (so they aren't flipped/scaled oddly).
  for (const placed of _assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    _partsContainer.addChild(_makePartLabel(placed, def));
  }
}

/**
 * Redraw the drag ghost at the current ghost screen position.
 */
function _renderGhostLayer() {
  if (!_ghostContainer) return;
  while (_ghostContainer.children.length) _ghostContainer.removeChildAt(0);
  if (!_ghostPartId) return;

  const def = getPartById(_ghostPartId);
  if (!def) return;

  const sw = def.width  * _camera.zoom;
  const sh = def.height * _camera.zoom;

  const g = new PIXI.Graphics();
  g.rect(_ghostSX - sw / 2, _ghostSY - sh / 2, sw, sh);
  g.fill({ color: PART_FILL[def.type] ?? 0x1a4080, alpha: 0.7 });
  g.stroke({ color: PART_STROKE[def.type] ?? 0x4090d0, width: 1 });
  _ghostContainer.addChild(g);

  const fontSize = Math.max(7, Math.round(10 * _camera.zoom));
  const label = new PIXI.Text({
    text: def.name,
    style: new PIXI.TextStyle({
      fill: '#c8e4ff',
      fontSize,
      fontFamily: 'Courier New, Courier, monospace',
    }),
  });
  label.anchor.set(0.5, 0.5);
  label.x = _ghostSX;
  label.y = _ghostSY;
  _ghostContainer.addChild(label);
}

/**
 * Redraw the snap-highlight indicators for the current candidates.
 */
function _renderSnapLayer() {
  if (!_snapContainer) return;
  while (_snapContainer.children.length) _snapContainer.removeChildAt(0);
  if (_snapCandidates.length === 0) return;

  const g = new PIXI.Graphics();
  _snapContainer.addChild(g);

  // Highlight the best (closest) candidate with a bright ring.
  const best = _snapCandidates[0];
  const { sx, sy } = _worldToScreen(best.targetSnapWorldX, best.targetSnapWorldY);
  const r = Math.max(6, 8 * _camera.zoom);

  g.circle(sx, sy, r);
  g.fill({ color: 0x40e080, alpha: 0.35 });
  g.stroke({ color: 0x60ff80, width: 2 });

  // Dimmer rings for all other candidates.
  for (let i = 1; i < _snapCandidates.length; i++) {
    const c = _snapCandidates[i];
    const { sx: cx, sy: cy } = _worldToScreen(c.targetSnapWorldX, c.targetSnapWorldY);
    g.circle(cx, cy, Math.max(4, 6 * _camera.zoom));
    g.fill({ color: 0x204840, alpha: 0.25 });
    g.stroke({ color: 0x308060, width: 1 });
  }
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

  // Layer order (bottom → top): grid, placed parts, snap highlights, drag ghost.
  _grid = new PIXI.Graphics();
  app.stage.addChild(_grid);

  _partsContainer = new PIXI.Container();
  app.stage.addChild(_partsContainer);

  _snapContainer = new PIXI.Container();
  app.stage.addChild(_snapContainer);

  _ghostContainer = new PIXI.Container();
  app.stage.addChild(_ghostContainer);

  // Default camera: rocket origin sits 85 % down the build area.
  const area = getBuildArea();
  _camera.x = area.width  / 2;
  _camera.y = area.height * 0.85;
  _camera.zoom = 1;

  vabRedrawGrid();

  window.addEventListener('resize', () => {
    vabRedrawGrid();
    _renderPartsLayer();
    _renderSnapLayer();
    _renderGhostLayer();
  });

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
  _renderPartsLayer();
  _renderSnapLayer();
  // Ghost stays at cursor (screen-space), no need to re-render on camera pan.
}

/**
 * Set the zoom level (clamped to [0.25, 4]) and redraw.
 * @param {number} zoom
 */
export function vabSetZoom(zoom) {
  _camera.zoom = Math.max(0.25, Math.min(4, zoom));
  vabRedrawGrid();
  _renderPartsLayer();
  _renderSnapLayer();
  _renderGhostLayer();
}

/**
 * Read-only snapshot of the current camera state.
 * @returns {{ x: number, y: number, zoom: number }}
 */
export function vabGetCamera() {
  return { ..._camera };
}

// ---------------------------------------------------------------------------
// Part assembly rendering API
// ---------------------------------------------------------------------------

/**
 * Provide the assembly reference used by the render layer.
 * Call once after creating the assembly in the UI layer; after that all
 * mutations to the assembly are picked up by the next vabRenderParts() call.
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 */
export function vabSetAssembly(assembly) {
  _assembly = assembly;
}

/**
 * Redraw all placed parts based on the current assembly state.
 * Call after any structural change to the assembly (add/remove/move part).
 */
export function vabRenderParts() {
  _renderPartsLayer();
}

// ---------------------------------------------------------------------------
// Drag ghost API
// ---------------------------------------------------------------------------

/**
 * Begin showing a drag ghost for the given part at the given screen position.
 * @param {string} partId      Part catalog ID.
 * @param {number} clientX     Current cursor X in CSS pixels.
 * @param {number} clientY     Current cursor Y in CSS pixels.
 */
export function vabSetDragGhost(partId, clientX, clientY) {
  _ghostPartId = partId;
  _ghostSX = clientX;
  _ghostSY = clientY;
  _renderGhostLayer();
}

/**
 * Move the drag ghost to a new cursor position.
 * @param {number} clientX
 * @param {number} clientY
 */
export function vabMoveDragGhost(clientX, clientY) {
  if (!_ghostPartId) return;
  _ghostSX = clientX;
  _ghostSY = clientY;
  _renderGhostLayer();
}

/**
 * Remove the drag ghost.
 */
export function vabClearDragGhost() {
  _ghostPartId = null;
  if (_ghostContainer) {
    while (_ghostContainer.children.length) _ghostContainer.removeChildAt(0);
  }
}

// ---------------------------------------------------------------------------
// Snap-highlight API
// ---------------------------------------------------------------------------

/**
 * Show snap-candidate highlight indicators.
 * @param {import('../core/rocketbuilder.js').SnapCandidate[]} candidates
 */
export function vabShowSnapHighlights(candidates) {
  _snapCandidates = candidates;
  _renderSnapLayer();
}

/**
 * Remove all snap-candidate highlight indicators.
 */
export function vabClearSnapHighlights() {
  _snapCandidates = [];
  if (_snapContainer) {
    while (_snapContainer.children.length) _snapContainer.removeChildAt(0);
  }
}

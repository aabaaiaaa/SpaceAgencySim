/**
 * vab.ts — PixiJS rendering for the Vehicle Assembly Building scene.
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
import type { RocketAssembly, PlacedPart, SnapCandidate } from '../core/rocketbuilder.js';
import type { PartDef } from '../data/parts.js';

declare global {
  interface Window {
    __vabPartsContainer?: PIXI.Container;
    __vabWorldToScreen?: typeof vabWorldToScreen;
  }
}

// ---------------------------------------------------------------------------
// Layout constants — must match CSS in src/ui/vab.js
// ---------------------------------------------------------------------------

/** Toolbar height in CSS pixels. */
export const VAB_TOOLBAR_HEIGHT: number = 52;

/** Parts panel width in CSS pixels. */
export const VAB_PARTS_PANEL_WIDTH: number = 280;

/** Scale bar strip width in CSS pixels. */
export const VAB_SCALE_BAR_WIDTH: number = 66;

/**
 * CSS pixels per metre at default zoom (zoom = 1).
 * 1 m = 20 px  ↔  1 px = 0.05 m.
 */
export const VAB_PIXELS_PER_METRE: number = 20;

// ---------------------------------------------------------------------------
// Grid colours
// ---------------------------------------------------------------------------

/** Dark space-blue background for the build canvas. */
const GRID_BG: number       = 0x070b14;
/** Minor grid lines (every 1 m = 20 px at default zoom). */
const GRID_MINOR: number    = 0x0c1a2e;
/** Major grid lines (every 5 m). */
const GRID_MAJOR: number    = 0x162e4c;
/** Rocket centreline (X = 0). */
const GRID_CENTRE: number   = 0x1a3d60;
/** Ground / launch-pad level (Y = 0). */
const GRID_GROUND: number   = 0x204a38;

/** How many minor cells between major lines. */
const MAJOR_EVERY: number = 5;

// ---------------------------------------------------------------------------
// Camera state
// ---------------------------------------------------------------------------

/**
 * camera.x — horizontal pan: screen X of world origin relative to build-area left.
 * camera.y — vertical pan:   screen Y of world origin relative to build-area top.
 * camera.zoom — scale multiplier (1 = default, >1 = zoomed in).
 */
const _camera: { x: number; y: number; zoom: number } = { x: 0, y: 0, zoom: 1 };

// ---------------------------------------------------------------------------
// PixiJS objects
// ---------------------------------------------------------------------------

/**
 * Root container wrapping all VAB layers.  Toggling its visibility with
 * showVabScene() / hideVabScene() lets the hub background show through
 * without destroying the VAB session.
 */
let _vabRoot: PIXI.Container | null = null;

let _grid: PIXI.Graphics | null = null;

// ---------------------------------------------------------------------------
// Part rendering objects
// ---------------------------------------------------------------------------

/** Container for all placed-part graphics + labels. */
let _partsContainer: PIXI.Container | null = null;

/** Container for the drag-ghost graphic. */
let _ghostContainer: PIXI.Container | null = null;

/** Container for snap-target highlight indicators. */
let _snapContainer: PIXI.Container | null = null;

// ---------------------------------------------------------------------------
// Part rendering state
// ---------------------------------------------------------------------------

let _assembly: RocketAssembly | null = null;

/** Part ID currently being dragged (for ghost rendering), or null. */
let _ghostPartId: string | null = null;

/** Screen X/Y of the drag ghost centre. */
let _ghostSX: number = 0;
let _ghostSY: number = 0;

let _snapCandidates: SnapCandidate[] = [];

/** Mirror ghost state — shown when symmetry mode is active during drag. */
let _mirrorGhostPartId: string | null = null;
let _mirrorGhostWX: number = 0;
let _mirrorGhostWY: number = 0;

/** Ghost leg deploy animation state (ping-pong 0→1→0). */
let _ghostLegAnimT: number = 0;
let _ghostLegAnimDir: number = 1;
let _lastGhostFrameTime: number | null = null;

/** RAF-based leg animation ticker state. */
let _legAnimRAF: number | null = null;

/** Selected-part leg animation state. */
let _selLegInstanceId: string | null = null;
let _selLegDef: PartDef | null = null;
let _selLegWorldX: number = 0;
let _selLegWorldY: number = 0;
let _selLegAnimT: number = 0;
let _selLegAnimDir: number = 1;
let _selLegLastTime: number | null = null;

// ---------------------------------------------------------------------------
// Part-type fill colours
// ---------------------------------------------------------------------------

const PART_FILL: Record<string, number> = {
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
  [PartType.LAUNCH_CLAMP]:         0x2a2818,
};

const PART_STROKE: Record<string, number> = {
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
  [PartType.LAUNCH_CLAMP]:         0x807040,
};

// ---------------------------------------------------------------------------
// Build-area helper
// ---------------------------------------------------------------------------

/**
 * Returns the screen-space rectangle of the build canvas (the transparent
 * region not covered by toolbar, parts panel, or scale bar).
 */
function getBuildArea(): { x: number; y: number; width: number; height: number } {
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
 */
function _worldToScreen(wx: number, wy: number): { sx: number; sy: number } {
  const area = getBuildArea();
  return {
    sx: area.x + _camera.x + wx * _camera.zoom,
    sy: area.y + _camera.y - wy * _camera.zoom,
  };
}

/**
 * Convert CSS client/screen coords to world coords.
 */
export function vabScreenToWorld(clientX: number, clientY: number): { worldX: number; worldY: number } {
  const area = getBuildArea();
  return {
    worldX: (clientX - area.x - _camera.x) / _camera.zoom,
    worldY: (area.y + _camera.y - clientY) / _camera.zoom,
  };
}

/**
 * Convert world coords to CSS screen coords.
 */
export function vabWorldToScreen(worldX: number, worldY: number): { screenX: number; screenY: number } {
  const { sx, sy } = _worldToScreen(worldX, worldY);
  return { screenX: sx, screenY: sy };
}

// ---------------------------------------------------------------------------
// Internal part / ghost / snap rendering helpers
// ---------------------------------------------------------------------------

/**
 * Draw a single placed part into an existing Graphics object.
 */
function _drawPart(g: PIXI.Graphics, placed: PlacedPart, def: PartDef, picked: boolean = false): void {
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
 */
function _makePartLabel(placed: PlacedPart, def: PartDef): PIXI.Text {
  const { sx, sy } = _worldToScreen(placed.x, placed.y);

  const label = new PIXI.Text({
    text: def.name,
    style: new PIXI.TextStyle({
      fill: '#c0ddf0',
      fontSize: 48,
      fontFamily: 'Courier New, Courier, monospace',
      fontWeight: 'bold',
    }),
  });
  label.anchor.set(0.5, 0.5);
  label.scale.set(10 / 48);
  label.x = sx;
  label.y = sy;
  return label;
}

/**
 * Redraw the _partsContainer to match the current assembly + camera state.
 */
function _renderPartsLayer(): void {
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
function _renderGhostLayer(): void {
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

  // Draw leg deploy preview struts for landing legs.
  if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
    _drawLegStruts(g, _ghostSX, _ghostSY, def, _ghostLegAnimT, 0.7);
  }

  _ghostContainer.addChild(g);

  const label = new PIXI.Text({
    text: def.name,
    style: new PIXI.TextStyle({
      fill: '#c0ddf0',
      fontSize: 48,
      fontFamily: 'Courier New, Courier, monospace',
      fontWeight: 'bold',
    }),
  });
  label.anchor.set(0.5, 0.5);
  label.scale.set(10 / 48);
  label.x = _ghostSX;
  label.y = _ghostSY;
  _ghostContainer.addChild(label);

  // Mirror ghost (dimmer copy shown on opposite side during symmetry drag).
  if (_mirrorGhostPartId) {
    const mDef = getPartById(_mirrorGhostPartId);
    if (mDef) {
      const { sx: msx, sy: msy } = _worldToScreen(_mirrorGhostWX, _mirrorGhostWY);
      const msw = mDef.width  * _camera.zoom;
      const msh = mDef.height * _camera.zoom;

      const mg = new PIXI.Graphics();
      mg.rect(msx - msw / 2, msy - msh / 2, msw, msh);
      mg.fill({ color: PART_FILL[mDef.type] ?? 0x1a4080, alpha: 0.4 });
      mg.stroke({ color: PART_STROKE[mDef.type] ?? 0x4090d0, width: 1, alpha: 0.5 });

      // Leg struts for mirror ghost.
      if (mDef.type === PartType.LANDING_LEGS || mDef.type === PartType.LANDING_LEG) {
        _drawLegStruts(mg, msx, msy, mDef, _ghostLegAnimT, 0.4);
      }

      _ghostContainer.addChild(mg);

      const mLabel = new PIXI.Text({
        text: mDef.name,
        style: new PIXI.TextStyle({
          fill: '#c0ddf0',
          fontSize: 48,
          fontFamily: 'Courier New, Courier, monospace',
          fontWeight: 'bold',
        }),
      });
      mLabel.anchor.set(0.5, 0.5);
      mLabel.scale.set(10 / 48);
      mLabel.alpha = 0.5;
      mLabel.x = msx;
      mLabel.y = msy;
      _ghostContainer.addChild(mLabel);
    }
  }
}

/**
 * Draw animated leg deploy struts on a Graphics object.
 */
function _drawLegStruts(g: PIXI.Graphics, cx: number, cy: number, def: PartDef, t: number, alpha: number): void {
  const sw = def.width  * _camera.zoom;
  const sh = def.height * _camera.zoom;

  // Strut extends outward and downward from part bottom.
  const dx = sw * 1.0 * t;
  const dy = sh * 1.5 * t;
  const footY = cy + sh / 2 + dy;
  const baseY = cy + sh / 4;

  // Left strut.
  const leftFootX = cx - dx;
  g.moveTo(cx, baseY);
  g.lineTo(leftFootX, footY);
  g.stroke({ color: 0x40c060, width: 2, alpha });
  g.circle(leftFootX, footY, 3 * _camera.zoom);
  g.fill({ color: 0x40c060, alpha });

  // Right strut.
  const rightFootX = cx + dx;
  g.moveTo(cx, baseY);
  g.lineTo(rightFootX, footY);
  g.stroke({ color: 0x40c060, width: 2, alpha });
  g.circle(rightFootX, footY, 3 * _camera.zoom);
  g.fill({ color: 0x40c060, alpha });
}

// ---------------------------------------------------------------------------
// Leg animation RAF ticker
// ---------------------------------------------------------------------------

/**
 * Advance ping-pong animation parameter.
 */
function _advancePingPong(t: number, dir: number, dtSec: number): { t: number; dir: number } {
  t += dir * dtSec / 1.0; // 1s per half-cycle
  if (t >= 1) { t = 1; dir = -1; }
  if (t <= 0) { t = 0; dir = 1; }
  return { t, dir };
}

/**
 * RAF callback that advances leg animations for both ghost and selected parts.
 */
function _tickLegAnimation(now: number): void {
  // Ghost animation.
  if (_ghostPartId) {
    if (_lastGhostFrameTime !== null) {
      const dtSec = (now - _lastGhostFrameTime) / 1000;
      const r = _advancePingPong(_ghostLegAnimT, _ghostLegAnimDir, dtSec);
      _ghostLegAnimT = r.t;
      _ghostLegAnimDir = r.dir;
    }
    _lastGhostFrameTime = now;
    _renderGhostLayer();
  }

  // Selected-part leg animation.
  if (_selLegInstanceId) {
    if (_selLegLastTime !== null) {
      const dtSec = (now - _selLegLastTime) / 1000;
      const r = _advancePingPong(_selLegAnimT, _selLegAnimDir, dtSec);
      _selLegAnimT = r.t;
      _selLegAnimDir = r.dir;
    }
    _selLegLastTime = now;
    _renderSelectedLegStruts();
  }

  // Continue loop if either animation is active.
  if (_ghostPartId || _selLegInstanceId) {
    _legAnimRAF = requestAnimationFrame(_tickLegAnimation);
  } else {
    _legAnimRAF = null;
  }
}

/** Start the leg animation ticker if not already running. */
function _startLegAnimTicker(): void {
  if (_legAnimRAF !== null) return;
  _legAnimRAF = requestAnimationFrame(_tickLegAnimation);
}

/** Cancel the RAF ticker if neither ghost nor selection needs it. */
function _stopLegAnimTickerIfIdle(): void {
  if (!_ghostPartId && !_selLegInstanceId) {
    if (_legAnimRAF !== null) {
      cancelAnimationFrame(_legAnimRAF);
      _legAnimRAF = null;
    }
  }
}

/**
 * Draw leg struts on the selected part (into the ghost container overlay).
 */
function _renderSelectedLegStruts(): void {
  // We draw into _ghostContainer — the ghost layer handles clearing in _renderGhostLayer,
  // so we append after any ghost content.  When there's no ghost, we need to clear first.
  if (!_ghostContainer || !_selLegDef) return;

  // Remove previous selection leg graphics (tagged with __selLeg).
  for (let i = _ghostContainer.children.length - 1; i >= 0; i--) {
    if ((_ghostContainer.children[i] as PIXI.Container & { __selLeg?: boolean }).__selLeg) {
      _ghostContainer.removeChildAt(i);
    }
  }

  const { sx, sy } = _worldToScreen(_selLegWorldX, _selLegWorldY);
  const g = new PIXI.Graphics() as PIXI.Graphics & { __selLeg?: boolean };
  g.__selLeg = true;
  _drawLegStruts(g, sx, sy, _selLegDef, _selLegAnimT, 0.7);
  _ghostContainer.addChild(g);
}

/**
 * Start animating leg struts on a selected placed part.
 */
export function vabSetSelectedLegAnimation(instanceId: string, worldX: number, worldY: number, def: PartDef): void {
  _selLegInstanceId = instanceId;
  _selLegWorldX = worldX;
  _selLegWorldY = worldY;
  _selLegDef = def;
  _selLegAnimT = 0;
  _selLegAnimDir = 1;
  _selLegLastTime = null;
  _startLegAnimTicker();
}

/** Stop the selected-part leg animation. */
export function vabClearSelectedLegAnimation(): void {
  if (!_selLegInstanceId) return;
  _selLegInstanceId = null;
  _selLegDef = null;
  _selLegLastTime = null;
  // Remove selection leg graphics from ghost container.
  if (_ghostContainer) {
    for (let i = _ghostContainer.children.length - 1; i >= 0; i--) {
      if ((_ghostContainer.children[i] as PIXI.Container & { __selLeg?: boolean }).__selLeg) {
        _ghostContainer.removeChildAt(i);
      }
    }
  }
  _stopLegAnimTickerIfIdle();
}

// ---------------------------------------------------------------------------
// Snap layer
// ---------------------------------------------------------------------------

/**
 * Redraw the snap-highlight indicators for the current candidates.
 */
function _renderSnapLayer(): void {
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

  // Mirror ghost snap highlight — dimmer green ring at the mirror target.
  if (_mirrorGhostPartId) {
    const { sx: msx, sy: msy } = _worldToScreen(_mirrorGhostWX, _mirrorGhostWY);
    const mr = Math.max(6, 8 * _camera.zoom);
    g.circle(msx, msy, mr);
    g.fill({ color: 0x204840, alpha: 0.2 });
    g.stroke({ color: 0x40a060, width: 1, alpha: 0.5 });
  }
}

// ---------------------------------------------------------------------------
// Grid drawing
// ---------------------------------------------------------------------------

/**
 * Redraw the grid Graphics object to match the current camera and window
 * size.  Called after any pan, zoom, or resize event.
 */
export function vabRedrawGrid(): void {
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
export function initVabRenderer(): void {
  const app = getApp();

  // Root container — hidden until the player navigates to the VAB.
  _vabRoot = new PIXI.Container();
  _vabRoot.visible = false;
  app.stage.addChild(_vabRoot);

  // Layer order (bottom → top): grid, placed parts, snap highlights, drag ghost.
  _grid = new PIXI.Graphics();
  _vabRoot.addChild(_grid);

  _partsContainer = new PIXI.Container();
  _vabRoot.addChild(_partsContainer);
  // Expose for e2e testing (Playwright can query placed-part text labels)
  window.__vabPartsContainer = _partsContainer;
  window.__vabWorldToScreen  = vabWorldToScreen;

  _snapContainer = new PIXI.Container();
  _vabRoot.addChild(_snapContainer);

  _ghostContainer = new PIXI.Container();
  _vabRoot.addChild(_ghostContainer);

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

}

/**
 * Make the VAB scene visible.
 * Call this when the player navigates to the Vehicle Assembly Building.
 */
export function showVabScene(): void {
  if (!_vabRoot) return;
  const app = getApp();
  // Re-attach if the container was orphaned by a flight renderer teardown.
  if (!_vabRoot.parent) {
    app.stage.addChild(_vabRoot);
  }
  _vabRoot.visible = true;
}

/**
 * Hide the VAB scene.
 * Call this when the player leaves the VAB (e.g. returns to the hub).
 */
export function hideVabScene(): void {
  if (_vabRoot) _vabRoot.visible = false;
}

/**
 * Pan the camera by a screen-pixel delta and redraw.
 */
export function vabPanCamera(dx: number, dy: number): void {
  _camera.x += dx;
  _camera.y += dy;
  vabRedrawGrid();
  _renderPartsLayer();
  _renderSnapLayer();
  // Ghost stays at cursor (screen-space), no need to re-render on camera pan.
}

/**
 * Set the zoom level (clamped to [0.25, 4]) and redraw.
 */
export function vabSetZoom(zoom: number): void {
  _camera.zoom = Math.max(0.25, Math.min(4, zoom));
  vabRedrawGrid();
  _renderPartsLayer();
  _renderSnapLayer();
  _renderGhostLayer();
}

/**
 * Set zoom while keeping a world-space point centred in the build area.
 */
export function vabSetZoomCentred(zoom: number, wx: number, wy: number): void {
  _camera.zoom = Math.max(0.25, Math.min(4, zoom));
  const area = getBuildArea();
  _camera.x = area.width  / 2 - wx * _camera.zoom;
  _camera.y = area.height / 2 + wy * _camera.zoom;
  vabRedrawGrid();
  _renderPartsLayer();
  _renderSnapLayer();
  _renderGhostLayer();
}

/**
 * Read-only snapshot of the current camera state.
 */
export function vabGetCamera(): { x: number; y: number; zoom: number } {
  return { ..._camera };
}

/**
 * Zoom and pan the camera so that the given world-space bounds fit within
 * 80% of the build area.  Clamps zoom to [0.25, 4].
 */
export function vabZoomToFit(bounds: { minX: number; maxX: number; minY: number; maxY: number }): void {
  if (!bounds) return;

  const area = getBuildArea();
  const worldW = bounds.maxX - bounds.minX;
  const worldH = bounds.maxY - bounds.minY;
  if (worldW <= 0 && worldH <= 0) return;

  const padding = 0.8; // use 80% of the available area
  const zoomX = worldW > 0 ? (area.width  * padding) / worldW : 4;
  const zoomY = worldH > 0 ? (area.height * padding) / worldH : 4;
  const zoom = Math.max(0.25, Math.min(4, Math.min(zoomX, zoomY)));

  // Centre camera on the rocket's centre.
  const centreWX = (bounds.minX + bounds.maxX) / 2;
  const centreWY = (bounds.minY + bounds.maxY) / 2;

  // Camera equations (from _worldToScreen):
  //   screenX = area.x + camera.x + worldX * zoom  →  camera.x = area.width/2 - centreWX * zoom
  //   screenY = area.y + camera.y - worldY * zoom  →  camera.y = area.height/2 + centreWY * zoom
  _camera.zoom = zoom;
  _camera.x = area.width  / 2 - centreWX * zoom;
  _camera.y = area.height / 2 + centreWY * zoom;

  vabRedrawGrid();
  _renderPartsLayer();
  _renderSnapLayer();
  _renderGhostLayer();
}

// ---------------------------------------------------------------------------
// Part assembly rendering API
// ---------------------------------------------------------------------------

/**
 * Provide the assembly reference used by the render layer.
 * Call once after creating the assembly in the UI layer; after that all
 * mutations to the assembly are picked up by the next vabRenderParts() call.
 */
export function vabSetAssembly(assembly: RocketAssembly): void {
  _assembly = assembly;
}

/**
 * Redraw all placed parts based on the current assembly state.
 * Call after any structural change to the assembly (add/remove/move part).
 */
export function vabRenderParts(): void {
  _renderPartsLayer();
}

// ---------------------------------------------------------------------------
// Drag ghost API
// ---------------------------------------------------------------------------

/**
 * Begin showing a drag ghost for the given part at the given screen position.
 */
export function vabSetDragGhost(partId: string, clientX: number, clientY: number): void {
  _ghostPartId = partId;
  _ghostSX = clientX;
  _ghostSY = clientY;
  _renderGhostLayer();
  // Start RAF ticker for continuous leg animation if this is a leg part.
  const def = getPartById(partId);
  if (def && (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG)) {
    _startLegAnimTicker();
  }
}

/**
 * Move the drag ghost to a new cursor position.
 */
export function vabMoveDragGhost(clientX: number, clientY: number): void {
  if (!_ghostPartId) return;
  _ghostSX = clientX;
  _ghostSY = clientY;
  _renderGhostLayer();
}

/**
 * Remove the drag ghost.
 */
export function vabClearDragGhost(): void {
  _ghostPartId = null;
  _ghostLegAnimT = 0;
  _ghostLegAnimDir = 1;
  _lastGhostFrameTime = null;
  if (_ghostContainer) {
    // Preserve selected-leg graphics when clearing ghost.
    for (let i = _ghostContainer.children.length - 1; i >= 0; i--) {
      if (!((_ghostContainer.children[i] as PIXI.Container & { __selLeg?: boolean }).__selLeg)) {
        _ghostContainer.removeChildAt(i);
      }
    }
  }
  _stopLegAnimTickerIfIdle();
}

// ---------------------------------------------------------------------------
// Mirror ghost API
// ---------------------------------------------------------------------------

/**
 * Show a mirror ghost for the given part at the given world position.
 * Used during symmetry-mode dragging to preview the mirrored placement.
 */
export function vabSetMirrorGhost(partId: string, worldX: number, worldY: number): void {
  _mirrorGhostPartId = partId;
  _mirrorGhostWX = worldX;
  _mirrorGhostWY = worldY;
  _renderGhostLayer();
}

/**
 * Remove the mirror ghost.
 */
export function vabClearMirrorGhost(): void {
  if (!_mirrorGhostPartId) return;
  _mirrorGhostPartId = null;
  _renderGhostLayer();
}

// ---------------------------------------------------------------------------
// Snap-highlight API
// ---------------------------------------------------------------------------

/**
 * Show snap-candidate highlight indicators.
 */
export function vabShowSnapHighlights(candidates: SnapCandidate[]): void {
  _snapCandidates = candidates;
  _renderSnapLayer();
}

/**
 * Remove all snap-candidate highlight indicators.
 */
export function vabClearSnapHighlights(): void {
  _snapCandidates = [];
  if (_snapContainer) {
    while (_snapContainer.children.length) _snapContainer.removeChildAt(0);
  }
}

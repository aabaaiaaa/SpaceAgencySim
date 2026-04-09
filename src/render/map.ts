/**
 * map.ts — PixiJS rendering for the top-down orbital map view.
 *
 * Draws a 2D body-centred map showing:
 *   - The central body (Earth) as a filled circle.
 *   - Altitude bands as semi-transparent concentric rings.
 *   - Orbit paths for the player craft and tracked orbital objects.
 *   - The player craft as a highlighted dot with a velocity indicator.
 *   - Periapsis / apoapsis markers on the craft's orbit.
 *   - Orbit prediction tick marks (a few orbital periods ahead).
 *   - An optional day/night shadow overlay on the body.
 *   - Labels for key items using a reusable PIXI.Text pool.
 *
 * COORDINATE MAPPING
 *   Orbital frame: origin at body centre; +X right, +Y up (metres).
 *   Screen frame:  origin at top-left; +X right, +Y down (pixels).
 *
 *   screenX = centreX + worldX × scale
 *   screenY = centreY − worldY × scale   (Y flipped)
 */

import * as PIXI from 'pixi.js';
import { getApp } from './index.ts';
import {
  BODY_RADIUS,
  ALTITUDE_BANDS,
  SurfaceItemType,
  BeltZone,
} from '../core/constants.ts';
import { CELESTIAL_BODIES } from '../data/bodies.ts';
import type { AltitudeBand } from '../data/bodies.ts';
import { getSurfaceItemsAtBody, areSurfaceItemsVisible } from '../core/surfaceOps.ts';
import {
  generateOrbitPath,
  getCraftMapPosition,
  getObjectMapPosition,
  getViewRadius,
  MapZoom,
  generateOrbitPredictions,
  getMapTransferTargets,
  getMapTransferRoute,
  generateTransferTrajectory,
  getMapCelestialBodies,
  getTransferProgressInfo,
} from '../core/mapView.ts';
import {
  getApoapsisAltitude,
  getPeriapsisAltitude,
  computeOrbitalElements,
} from '../core/orbit.ts';
import { FlightPhase } from '../core/constants.ts';
import { SOI_RADIUS } from '../core/manoeuvre.ts';
import { getCommsCoverageInfo } from '../core/comms.ts';

import type { ReadonlyPhysicsState, ReadonlyFlightState, ReadonlyGameState } from './types.ts';
import type { OrbitalElements, OrbitalObject } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Colour palette
// ---------------------------------------------------------------------------

const MAP_BG            = 0x050510;
const BODY_COLOR        = 0x1a4060;
const BODY_ATMOSPHERE   = 0x4080c0;
const CRAFT_COLOR       = 0x00ff88;
const CRAFT_ORBIT_COLOR = 0x00ccff;
const OBJECT_COLOR      = 0x6090b0;
const OBJECT_ORBIT_COLOR = 0x304860;
const TARGET_COLOR      = 0xff8844;
const TARGET_ORBIT_COLOR = 0x885522;
const PREDICTION_COLOR  = 0x00ccff;
const SHADOW_COLOR      = 0x000000;
const PE_COLOR          = 0x44aaff;
const AP_COLOR          = 0xff6644;

const TRANSFER_TARGET_COLOR = 0xffcc44;
const TRANSFER_ROUTE_COLOR  = 0xffaa22;
const TRANSFER_TRAJECTORY_COLOR = 0xff6644;
const MOON_BODY_COLOR       = 0xa0a0a0;
const DEST_BODY_COLOR       = 0xff8844;
const SOI_BOUNDARY_COLOR    = 0x334455;
const ASSIST_BODY_COLOR     = 0x88cc44;

const BAND_COLORS: Record<string, number> = {
  LEO: 0x104020,
  MEO: 0x403020,
  HEO: 0x401020,
};

// Asteroid belt colours.
const BELT_DOT_OUTER   = 0x998877;  // brownish for outer zones
const BELT_DOT_DENSE   = 0xcc9966;  // amber for dense zone
const BELT_DANGER_FILL = 0x884422;  // danger zone fill
const BELT_DANGER_EDGE = 0xaa6633;  // danger zone boundary lines
const BELT_LABEL_COLOR = 0xddaa44;  // label text

/** Visual atmosphere height (m above surface). */
const ATMOSPHERE_VISUAL_HEIGHT = 70_000;

// ---------------------------------------------------------------------------
// Label pool
// ---------------------------------------------------------------------------

const MAX_LABELS = 24;

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

/** Root container added to app.stage; toggled visible/invisible. */
let _mapRoot: PIXI.Container | null = null;

// Graphics objects — cleared and redrawn each frame.
let _bgGraphics: PIXI.Graphics | null       = null;
let _bandsGraphics: PIXI.Graphics | null     = null;
let _orbitsGraphics: PIXI.Graphics | null    = null;
let _bodyGraphics: PIXI.Graphics | null      = null;
let _shadowGraphics: PIXI.Graphics | null    = null;
let _objectsGraphics: PIXI.Graphics | null   = null;
let _craftGraphics: PIXI.Graphics | null     = null;
let _transferGraphics: PIXI.Graphics | null  = null;
let _surfaceGraphics: PIXI.Graphics | null   = null;
let _commsGraphics: PIXI.Graphics | null     = null;

let _beltGraphics: PIXI.Graphics | null   = null;

/** Container for reusable PIXI.Text labels. */
let _labelContainer: PIXI.Container | null = null;
let _labelPool: PIXI.Text[] = [];
let _nextLabel: number = 0;

// Zoom / view state
let _currentZoom: string     = MapZoom.ORBIT_DETAIL;
let _viewRadius: number      = 10_000_000;
let _customViewRadius: number | null = null;
let _selectedTarget: string | null  = null;
let _showShadow: boolean      = false;
let _showCommsOverlay: boolean = false;

/** Currently selected transfer route target body ID. */
let _selectedTransferTarget: string | null = null;

// Input handlers
let _wheelHandler: ((e: WheelEvent) => void) | null = null;

// ---------------------------------------------------------------------------
// Pre-generated asteroid belt dots
// ---------------------------------------------------------------------------

interface BeltDot {
  /** Distance from Sun centre (metres). */
  r: number;
  /** Angle in radians. */
  angle: number;
  /** Dot radius in pixels (before zoom scaling). */
  size: number;
  /** Alpha (opacity). */
  alpha: number;
  /** Hex colour. */
  color: number;
}

/** Cached belt dot positions — generated once, reused every frame. */
let _beltDots: BeltDot[] | null = null;

/**
 * Deterministic pseudo-random number generator (mulberry32).
 * Returns a function that produces values in [0, 1).
 */
function _seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate asteroid belt dots deterministically.
 * Called once on first render; cached in _beltDots.
 */
function _generateBeltDots(): BeltDot[] {
  const sunDef = CELESTIAL_BODIES.SUN;
  if (!sunDef) return [];

  const R_SUN = sunDef.radius;
  const beltBands = sunDef.altitudeBands.filter(
    (b: AltitudeBand) => b.beltZone != null,
  );
  if (beltBands.length === 0) return [];

  const rand = _seededRandom(42);
  const dots: BeltDot[] = [];

  for (const band of beltBands) {
    const isDense = band.beltZone === BeltZone.DENSE;
    // Dense zone gets more dots.
    const count = isDense ? 180 : 100;
    const color = isDense ? BELT_DOT_DENSE : BELT_DOT_OUTER;

    const innerR = R_SUN + band.min;
    const outerR = R_SUN + band.max;

    for (let i = 0; i < count; i++) {
      // Uniform distribution within the annular area.
      const u = rand();
      const r = Math.sqrt(innerR * innerR + u * (outerR * outerR - innerR * innerR));
      const angle = rand() * Math.PI * 2;
      const size = 1 + rand(); // 1–2 px base
      const alpha = 0.25 + rand() * 0.45; // 0.25–0.70

      dots.push({ r, angle, size, alpha, color });
    }
  }

  return dots;
}

// ---------------------------------------------------------------------------
// Public API — lifecycle
// ---------------------------------------------------------------------------

/**
 * Create all PixiJS containers for the map scene and add them to the stage
 * (hidden by default).  Call once when the flight scene starts.
 */
export function initMapRenderer(): void {
  const app = getApp();

  // Defensive cleanup.
  if (_mapRoot) {
    app.stage.removeChild(_mapRoot);
    _mapRoot.destroy({ children: true });
  }

  _mapRoot = new PIXI.Container();
  _mapRoot.visible = false;

  // Layer order (bottom → top):
  //   background → bands → belt → transfer → orbits → body → shadow → objects → craft → labels
  _bgGraphics       = new PIXI.Graphics();
  _bandsGraphics    = new PIXI.Graphics();
  _beltGraphics     = new PIXI.Graphics();
  _transferGraphics = new PIXI.Graphics();
  _orbitsGraphics   = new PIXI.Graphics();
  _bodyGraphics     = new PIXI.Graphics();
  _shadowGraphics   = new PIXI.Graphics();
  _surfaceGraphics  = new PIXI.Graphics();
  _commsGraphics    = new PIXI.Graphics();
  _objectsGraphics  = new PIXI.Graphics();
  _craftGraphics    = new PIXI.Graphics();
  _labelContainer   = new PIXI.Container();

  _mapRoot.addChild(_bgGraphics);
  _mapRoot.addChild(_bandsGraphics);
  _mapRoot.addChild(_beltGraphics);
  _mapRoot.addChild(_transferGraphics);
  _mapRoot.addChild(_orbitsGraphics);
  _mapRoot.addChild(_bodyGraphics);
  _mapRoot.addChild(_surfaceGraphics);
  _mapRoot.addChild(_commsGraphics);
  _mapRoot.addChild(_shadowGraphics);
  _mapRoot.addChild(_objectsGraphics);
  _mapRoot.addChild(_craftGraphics);
  _mapRoot.addChild(_labelContainer);

  app.stage.addChild(_mapRoot);

  // Create the reusable text label pool.
  _labelPool = [];
  for (let i = 0; i < MAX_LABELS; i++) {
    const t = new PIXI.Text({
      text: '',
      style: new PIXI.TextStyle({
        fontFamily: 'Courier New, Courier, monospace',
        fontSize: 11,
        fill: '#ffffff',
      }),
    });
    t.visible = false;
    _labelContainer.addChild(t);
    _labelPool.push(t);
  }

  _customViewRadius = null;
  _selectedTarget   = null;
  _showShadow       = false;
}

/**
 * Make the map scene visible.
 * Registers the map-specific scroll-wheel zoom handler.
 */
export function showMapScene(): void {
  if (!_mapRoot) return;
  _mapRoot.visible = true;
  if (!_wheelHandler) {
    _wheelHandler = _onWheel;
    window.addEventListener('wheel', _wheelHandler, { passive: false });
  }
}

/**
 * Hide the map scene.
 * Unregisters the scroll-wheel zoom handler so it doesn't conflict with
 * the flight renderer's zoom.
 */
export function hideMapScene(): void {
  if (!_mapRoot) return;
  _mapRoot.visible = false;
  if (_wheelHandler) {
    window.removeEventListener('wheel', _wheelHandler);
    _wheelHandler = null;
  }
}

export function isMapVisible(): boolean {
  return _mapRoot ? _mapRoot.visible : false;
}

/**
 * Tear down the map renderer and remove all PixiJS objects.
 */
export function destroyMapRenderer(): void {
  if (_wheelHandler) {
    window.removeEventListener('wheel', _wheelHandler);
    _wheelHandler = null;
  }

  if (_mapRoot) {
    const app = getApp();
    app.stage.removeChild(_mapRoot);
    _mapRoot.destroy({ children: true });
    _mapRoot = null;
  }

  _bgGraphics       = null;
  _bandsGraphics    = null;
  _beltGraphics     = null;
  _orbitsGraphics   = null;
  _bodyGraphics     = null;
  _shadowGraphics   = null;
  _objectsGraphics  = null;
  _craftGraphics    = null;
  _transferGraphics = null;
  _surfaceGraphics  = null;
  _labelContainer   = null;
  _labelPool        = [];
  _beltDots         = null;

  _customViewRadius        = null;
  _selectedTarget          = null;
  _selectedTransferTarget  = null;
  _showShadow              = false;
}

// ---------------------------------------------------------------------------
// Public API — zoom & target
// ---------------------------------------------------------------------------

/** Set the zoom level to a named preset. Resets any manual scroll zoom. */
export function setMapZoomLevel(level: string): void {
  _currentZoom = level;
  _customViewRadius = null;
}

/** Current MapZoom value. */
export function getMapZoomLevel(): string {
  return _currentZoom;
}

/** Cycle to the next zoom level preset (wraps around). */
export function cycleMapZoom(): void {
  const levels = [
    MapZoom.ORBIT_DETAIL,
    MapZoom.LOCAL_BODY,
    MapZoom.CRAFT_TO_TARGET,
    MapZoom.SOLAR_SYSTEM,
  ];
  const idx = levels.indexOf(_currentZoom as MapZoom);
  _currentZoom = levels[(idx + 1) % levels.length];
  _customViewRadius = null;
}

/** Set the selected target orbital object ID (for craft-to-target zoom and warp). */
export function setMapTarget(targetId: string | null): void {
  _selectedTarget = targetId;
}

export function getMapTarget(): string | null {
  return _selectedTarget;
}

/**
 * Cycle the selected target through all orbital objects for the given body.
 * Returns the new target ID (or null if none available).
 */
export function cycleMapTarget(orbitalObjects: OrbitalObject[], bodyId: string): string | null {
  const candidates = (orbitalObjects || []).filter((o) => o.bodyId === bodyId);
  if (candidates.length === 0) {
    _selectedTarget = null;
    return null;
  }
  const idx = candidates.findIndex((o) => o.id === _selectedTarget);
  const next = candidates[(idx + 1) % candidates.length];
  _selectedTarget = next.id;
  return _selectedTarget;
}

/** Toggle the day/night shadow overlay. */
export function toggleMapShadow(): void {
  _showShadow = !_showShadow;
}

/**
 * Toggle the comms coverage overlay on the map.
 * Shows connected zones (green) and dead zones (red) around the body.
 */
export function toggleMapCommsOverlay(): void {
  _showCommsOverlay = !_showCommsOverlay;
}

/**
 * Check whether the comms overlay is currently shown.
 */
export function isCommsOverlayVisible(): boolean {
  return _showCommsOverlay;
}

/**
 * Cycle through transfer target bodies (for route planning).
 *
 * @param bodyId  Current celestial body.
 * @param altitude  Current orbital altitude (m).
 * @param phase  Current flight phase.
 * @returns New selected transfer target body ID.
 */
export function cycleTransferTarget(bodyId: string, altitude: number, phase: string): string | null {
  const targets = getMapTransferTargets(bodyId, altitude, phase);
  if (targets.length === 0) {
    _selectedTransferTarget = null;
    return null;
  }
  const idx = targets.findIndex((t) => t.bodyId === _selectedTransferTarget);
  if (idx < 0) {
    // Nothing selected — select the first.
    _selectedTransferTarget = targets[0].bodyId;
  } else if (idx === targets.length - 1) {
    // Last one — deselect.
    _selectedTransferTarget = null;
  } else {
    // Next target.
    _selectedTransferTarget = targets[idx + 1].bodyId;
  }
  return _selectedTransferTarget;
}

/** Currently selected transfer target body ID. */
export function getSelectedTransferTarget(): string | null {
  return _selectedTransferTarget;
}

/** Set the selected transfer target body ID. */
export function setSelectedTransferTarget(bodyId: string | null): void {
  _selectedTransferTarget = bodyId;
}

export function isMapShadowEnabled(): boolean {
  return _showShadow;
}

// ---------------------------------------------------------------------------
// Public API — rendering
// ---------------------------------------------------------------------------

/**
 * Render one frame of the map view.
 */
export function renderMapFrame(
  ps: ReadonlyPhysicsState,
  flightState: ReadonlyFlightState,
  state: ReadonlyGameState,
  bodyId: string = 'EARTH',
  options?: { showDebris?: boolean },
): void {
  if (!_mapRoot || !_mapRoot.visible) return;

  const w  = window.innerWidth;
  const h  = window.innerHeight;
  const cx = w / 2;
  const cy = h / 2;
  const R  = BODY_RADIUS[bodyId];

  const isTransfer = flightState.phase === FlightPhase.TRANSFER ||
                     flightState.phase === FlightPhase.CAPTURE;
  const transferState = flightState.transferState;

  // Resolve target elements.
  let targetElements: OrbitalElements | null = null;
  if (_selectedTarget && state.orbitalObjects) {
    const target = state.orbitalObjects.find((o) => o.id === _selectedTarget);
    if (target) targetElements = target.elements;
  }

  // Compute view radius and scale.
  if (_customViewRadius) {
    _viewRadius = _customViewRadius;
  } else {
    _viewRadius = getViewRadius(_currentZoom, bodyId, flightState.orbitalElements, targetElements, transferState);
  }
  const screenHalf = Math.min(w, h) / 2 * 0.88;
  const scale = screenHalf / _viewRadius; // pixels per metre

  // Reset the label pool for this frame.
  _resetLabels();

  // 1. Background.
  _bgGraphics!.clear();
  _bgGraphics!.rect(0, 0, w, h);
  _bgGraphics!.fill(MAP_BG);

  // 2. Altitude bands.
  _drawBands(bodyId, cx, cy, scale);

  // 2a. Asteroid belt (Sun view only).
  _drawAsteroidBelt(bodyId, cx, cy, scale, w, h);

  // 2b. Transfer targets and route.
  _drawTransferTargets(ps, flightState, cx, cy, scale, bodyId);

  // 2c. During transfer: draw transfer trajectory, destination bodies, and SOI.
  if (isTransfer) {
    _drawTransferTrajectory(ps, flightState, cx, cy, scale, bodyId);
    _drawCelestialBodies(flightState, cx, cy, scale, bodyId);
    _drawTransferProgress(flightState, w, h);
  }

  // 3. Orbital-object orbits and positions.
  _drawOrbitalObjects(state, flightState, cx, cy, scale, bodyId, options);

  // 4. Craft orbit, position, and predictions.
  _drawCraft(ps, flightState, cx, cy, scale, bodyId);

  // 5. Body (drawn on top of orbits so the surface occludes near-surface paths).
  _drawBody(cx, cy, scale, R);

  // 5b. Surface items (flags, instruments, beacons) on the body surface.
  _drawSurfaceItems(state, bodyId, cx, cy, scale, R);

  // 6. Day/night shadow.
  _drawShadow(cx, cy, scale, R, flightState.timeElapsed);

  // 7. Comms coverage overlay.
  _drawCommsOverlay(state, bodyId, cx, cy, scale, R);
}

// ---------------------------------------------------------------------------
// Private — label pool helpers
// ---------------------------------------------------------------------------

function _resetLabels(): void {
  _nextLabel = 0;
  for (const l of _labelPool) l.visible = false;
}

/**
 * Claim the next label from the pool, configure it, and make it visible.
 * Returns null if the pool is exhausted.
 */
function _useLabel(text: string, x: number, y: number, color: number | string): PIXI.Text | null {
  if (_nextLabel >= MAX_LABELS) return null;
  const l = _labelPool[_nextLabel++];
  l.text = text;
  l.style.fill = typeof color === 'number' ? `#${color.toString(16).padStart(6, '0')}` : color;
  l.x = x;
  l.y = y;
  l.visible = true;
  return l;
}

// ---------------------------------------------------------------------------
// Private — drawing helpers
// ---------------------------------------------------------------------------

function _drawBody(cx: number, cy: number, scale: number, R: number): void {
  _bodyGraphics!.clear();

  const bodyPxR = R * scale;

  if (bodyPxR < 2) {
    // Too small — draw a dot.
    _bodyGraphics!.circle(cx, cy, 3);
    _bodyGraphics!.fill(BODY_COLOR);
    return;
  }

  // Atmosphere glow.
  if (bodyPxR > 10) {
    const atmosR = (R + ATMOSPHERE_VISUAL_HEIGHT) * scale;
    _bodyGraphics!.circle(cx, cy, atmosR);
    _bodyGraphics!.fill({ color: BODY_ATMOSPHERE, alpha: 0.08 });
  }

  // Solid body.
  _bodyGraphics!.circle(cx, cy, bodyPxR);
  _bodyGraphics!.fill(BODY_COLOR);

  // Edge highlight.
  _bodyGraphics!.circle(cx, cy, bodyPxR);
  _bodyGraphics!.stroke({ color: BODY_ATMOSPHERE, width: 1, alpha: 0.4 });
}

/** Map colours for each surface item type. */
const MAP_SURFACE_COLORS: Record<string, number> = {
  [SurfaceItemType.FLAG]:               0xff4444,
  [SurfaceItemType.SURFACE_SAMPLE]:     0xddcc88,
  [SurfaceItemType.SURFACE_INSTRUMENT]: 0x44aaff,
  [SurfaceItemType.BEACON]:             0x44ff44,
};

/** Map glyph labels for each surface item type. */
const MAP_SURFACE_GLYPHS: Record<string, string> = {
  [SurfaceItemType.FLAG]:               '\u2691',  // ⚑
  [SurfaceItemType.SURFACE_SAMPLE]:     '\u25CF',  // ●
  [SurfaceItemType.SURFACE_INSTRUMENT]: '\u25B2',  // ▲
  [SurfaceItemType.BEACON]:             '\u25C6',  // ◆
};

/**
 * Draw deployed surface items on the body surface (at the body radius).
 * Items are spread around the body circle at angles derived from their
 * world posX coordinate.
 *
 * Only visible if GPS coverage exists for the body (or it's Earth).
 */
function _drawSurfaceItems(state: ReadonlyGameState, bodyId: string, cx: number, cy: number, scale: number, R: number): void {
  if (!_surfaceGraphics) return;
  _surfaceGraphics.clear();

  if (!areSurfaceItemsVisible(state, bodyId)) return;

  const items = getSurfaceItemsAtBody(state, bodyId);
  if (items.length === 0) return;

  const bodyPxR = R * scale;
  if (bodyPxR < 5) return; // Body too small to show surface items.

  for (const item of items) {
    // Map world X to angular position on the body circle.
    // posX is in metres; spread items around the circumference.
    const angle = (item.posX / (R * 0.5)) % (2 * Math.PI);
    const ix = cx + Math.cos(angle) * bodyPxR;
    const iy = cy - Math.sin(angle) * bodyPxR;

    const color = MAP_SURFACE_COLORS[item.type] || 0xffffff;
    const dotR  = Math.max(3, Math.min(6, bodyPxR * 0.03));

    _surfaceGraphics.circle(ix, iy, dotR);
    _surfaceGraphics.fill({ color, alpha: 0.9 });

    // Label nearby if room.
    const glyph = MAP_SURFACE_GLYPHS[item.type] || '?';
    const labelText = `${glyph} ${item.label || item.type}`;
    _useLabel(labelText, ix + dotR + 3, iy - 5, color);
  }
}

function _drawBands(bodyId: string, cx: number, cy: number, scale: number): void {
  if (!_mapRoot) return;
  _bandsGraphics!.clear();

  const bands = ALTITUDE_BANDS[bodyId];
  const R     = BODY_RADIUS[bodyId];
  if (!bands) return;

  for (const band of bands) {
    const innerPx = (R + band.min) * scale;
    const outerPx = (R + band.max) * scale;

    // Skip bands entirely off-screen.
    if (innerPx > Math.max(window.innerWidth, window.innerHeight) * 1.5) continue;

    const color = BAND_COLORS[band.id] || 0x202020;

    // Semi-transparent fill for the band zone.
    // Draw outer filled circle then punch the inner with the background.
    // PixiJS doesn't easily support donut shapes, so we draw boundary lines only.
    _bandsGraphics!.circle(cx, cy, innerPx);
    _bandsGraphics!.stroke({ color, width: 1, alpha: 0.35 });
    _bandsGraphics!.circle(cx, cy, outerPx);
    _bandsGraphics!.stroke({ color, width: 1, alpha: 0.2 });

    // Band name label.
    if (innerPx > 30 && innerPx < window.innerWidth) {
      _useLabel(band.name, cx + innerPx + 6, cy - 8, color);
    }
  }
}

/**
 * Draw the asteroid belt when viewing the Sun's orbital system.
 * Renders scattered dots across the three belt zones plus a danger-zone
 * shading overlay on the dense belt.
 */
function _drawAsteroidBelt(bodyId: string, cx: number, cy: number, scale: number, w: number, h: number): void {
  if (!_mapRoot) return;
  if (!_beltGraphics) return;
  _beltGraphics.clear();

  // Only draw the belt when the central body is the Sun.
  if (bodyId !== 'SUN') return;

  const sunDef = CELESTIAL_BODIES.SUN;
  if (!sunDef) return;
  const R_SUN = sunDef.radius;

  // Find the dense belt band for the danger zone overlay.
  const denseBand = sunDef.altitudeBands.find(
    (b: AltitudeBand) => b.beltZone === BeltZone.DENSE,
  );

  // Check if the belt region is even potentially visible.
  // The innermost belt edge (Outer Belt A min).
  const beltBands = sunDef.altitudeBands.filter(
    (b: AltitudeBand) => b.beltZone != null,
  );
  if (beltBands.length === 0) return;

  const beltInnerR = R_SUN + beltBands[0].min;
  const beltOuterR = R_SUN + beltBands[beltBands.length - 1].max;
  const beltInnerPx = beltInnerR * scale;
  const beltOuterPx = beltOuterR * scale;

  // Early out: belt entirely off-screen or entirely too small to see.
  const screenDiag = Math.hypot(w, h);
  if (beltInnerPx > screenDiag * 1.5) return;
  if (beltOuterPx < 3) return;

  // --- Danger zone shading (dense belt) ---
  if (denseBand) {
    const denseInnerR = (R_SUN + denseBand.min) * scale;
    const denseOuterR = (R_SUN + denseBand.max) * scale;

    if (denseOuterR > 3 && denseInnerR < screenDiag * 1.5) {
      // Filled annular ring: outer circle clockwise, inner circle counter-clockwise.
      _beltGraphics.moveTo(cx + denseOuterR, cy);
      _beltGraphics.arc(cx, cy, denseOuterR, 0, Math.PI * 2, false);
      _beltGraphics.closePath();
      _beltGraphics.moveTo(cx + denseInnerR, cy);
      _beltGraphics.arc(cx, cy, denseInnerR, 0, Math.PI * 2, true);
      _beltGraphics.closePath();
      _beltGraphics.fill({ color: BELT_DANGER_FILL, alpha: 0.12 });

      // Dashed boundary lines at dense zone edges.
      const dashSegments = 72;
      for (let i = 0; i < dashSegments; i += 2) {
        const a1 = (Math.PI * 2 * i) / dashSegments;
        const a2 = (Math.PI * 2 * (i + 1)) / dashSegments;
        // Inner edge dash.
        _beltGraphics.moveTo(cx + denseInnerR * Math.cos(a1), cy - denseInnerR * Math.sin(a1));
        _beltGraphics.lineTo(cx + denseInnerR * Math.cos(a2), cy - denseInnerR * Math.sin(a2));
        // Outer edge dash.
        _beltGraphics.moveTo(cx + denseOuterR * Math.cos(a1), cy - denseOuterR * Math.sin(a1));
        _beltGraphics.lineTo(cx + denseOuterR * Math.cos(a2), cy - denseOuterR * Math.sin(a2));
      }
      _beltGraphics.stroke({ color: BELT_DANGER_EDGE, width: 1, alpha: 0.3 });
    }
  }

  // --- Scattered dots ---
  if (!_beltDots) {
    _beltDots = _generateBeltDots();
  }

  for (const dot of _beltDots) {
    const sx = cx + dot.r * Math.cos(dot.angle) * scale;
    const sy = cy - dot.r * Math.sin(dot.angle) * scale;

    // Cull dots that are off-screen.
    if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;

    // Scale dot size with zoom — clamp to 0.5–3 px.
    const dotPx = Math.max(0.5, Math.min(3, dot.size * Math.min(1, beltOuterPx / 200)));
    _beltGraphics.circle(sx, sy, dotPx);
    _beltGraphics.fill({ color: dot.color, alpha: dot.alpha });
  }

  // --- Label: "Warning Dense Belt" ---
  if (denseBand) {
    const denseMiddleR = (R_SUN + (denseBand.min + denseBand.max) / 2) * scale;
    // Show label when the dense zone is on-screen and at a reasonable scale.
    if (denseMiddleR > 40 && denseMiddleR < w * 1.2) {
      _useLabel(
        '\u26A0 Dense Belt',
        cx + denseMiddleR * 0.7 + 8,
        cy - denseMiddleR * 0.7 - 12,
        BELT_LABEL_COLOR,
      );
    }
  }
}

function _drawOrbitalObjects(
  state: ReadonlyGameState,
  flightState: ReadonlyFlightState,
  cx: number,
  cy: number,
  scale: number,
  bodyId: string,
  options?: { showDebris?: boolean },
): void {
  if (!_mapRoot) return;
  _objectsGraphics!.clear();

  if (!state.orbitalObjects || state.orbitalObjects.length === 0) return;

  const showDebris = options?.showDebris !== false;
  const t = flightState.timeElapsed;

  for (const obj of state.orbitalObjects) {
    if (obj.bodyId !== bodyId) continue;
    // Hide debris objects when Tracking Station tier < 2.
    if (!showDebris && obj.type === 'DEBRIS') continue;

    const isTarget   = obj.id === _selectedTarget;
    const orbitColor = isTarget ? TARGET_ORBIT_COLOR : OBJECT_ORBIT_COLOR;
    const dotColor   = isTarget ? TARGET_COLOR : OBJECT_COLOR;

    // Orbit path.
    _drawOrbitEllipse(_objectsGraphics!, obj.elements, bodyId, cx, cy, scale,
      orbitColor, isTarget ? 1.5 : 1, isTarget ? 0.6 : 0.3);

    // Position dot.
    const pos = getObjectMapPosition(obj.elements, t, bodyId);
    const sx  = cx + pos.x * scale;
    const sy  = cy - pos.y * scale;
    const dotSize = isTarget ? 5 : 3;

    _objectsGraphics!.circle(sx, sy, dotSize);
    _objectsGraphics!.fill(dotColor);

    // Label (target always labelled; others only if not too dense).
    if (isTarget) {
      _useLabel(obj.name, sx + dotSize + 4, sy - 6, dotColor);

      // Docking indicator ring — pulsing circle around the selected target.
      if (obj.type === 'CRAFT' || obj.type === 'STATION') {
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 300);
        _objectsGraphics!.circle(sx, sy, dotSize + 6 + pulse * 3);
        _objectsGraphics!.stroke({ color: 0x00ccff, width: 1.5, alpha: 0.4 + pulse * 0.3 });
      }
    }
  }
}

function _drawCraft(ps: ReadonlyPhysicsState, flightState: ReadonlyFlightState, cx: number, cy: number, scale: number, bodyId: string): void {
  if (!_mapRoot) return;
  _orbitsGraphics!.clear();
  _craftGraphics!.clear();

  const R = BODY_RADIUS[bodyId];

  // --- Orbit path ---
  if (flightState.orbitalElements) {
    // Stable orbit — draw the full ellipse.
    _drawOrbitEllipse(_orbitsGraphics!, flightState.orbitalElements, bodyId,
      cx, cy, scale, CRAFT_ORBIT_COLOR, 2, 0.7);

    // Prediction ticks along the orbit.
    const preds = generateOrbitPredictions(
      flightState.orbitalElements, bodyId, flightState.timeElapsed, 3, 36,
    );
    for (let i = 0; i < preds.length; i++) {
      const p     = preds[i];
      const px    = cx + p.x * scale;
      const py    = cy - p.y * scale;
      const alpha = 0.6 - (i / preds.length) * 0.45;
      _orbitsGraphics!.circle(px, py, 1.5);
      _orbitsGraphics!.fill({ color: PREDICTION_COLOR, alpha });
    }

    // Periapsis & apoapsis markers.
    _drawApsides(flightState.orbitalElements, bodyId, cx, cy, scale);
  } else {
    // Sub-orbital — project the trajectory as if it were a (possibly
    // intersecting-surface) ellipse and clip to above-surface.
    const projected = computeOrbitalElements(
      ps.posX, ps.posY, ps.velX, ps.velY, bodyId, flightState.timeElapsed,
    );
    if (projected) {
      const path = generateOrbitPath(projected, bodyId, 180);
      let started = false;
      for (let i = 0; i < path.length; i++) {
        const r = Math.sqrt(path[i].x ** 2 + path[i].y ** 2);
        if (r > R) {
          const px = cx + path[i].x * scale;
          const py = cy - path[i].y * scale;
          if (!started) {
            _orbitsGraphics!.moveTo(px, py);
            started = true;
          } else {
            _orbitsGraphics!.lineTo(px, py);
          }
        } else {
          started = false;
        }
      }
      if (started) {
        _orbitsGraphics!.stroke({ color: CRAFT_ORBIT_COLOR, width: 1.5, alpha: 0.4 });
      }
    }
  }

  // --- Craft dot ---
  const craftPos = getCraftMapPosition(ps, bodyId);
  const sx = cx + craftPos.x * scale;
  const sy = cy - craftPos.y * scale;

  // Outer glow.
  _craftGraphics!.circle(sx, sy, 8);
  _craftGraphics!.fill({ color: CRAFT_COLOR, alpha: 0.15 });

  // Inner dot.
  _craftGraphics!.circle(sx, sy, 4);
  _craftGraphics!.fill(CRAFT_COLOR);

  // Velocity direction indicator (prograde arrow).
  const speed = Math.hypot(ps.velX, ps.velY);
  if (speed > 10) {
    const vAngle   = Math.atan2(ps.velX, ps.velY);
    const arrowLen = 18;
    const tipX     = sx + Math.sin(vAngle) * arrowLen;
    const tipY     = sy - Math.cos(vAngle) * arrowLen;
    _craftGraphics!.moveTo(sx, sy);
    _craftGraphics!.lineTo(tipX, tipY);
    _craftGraphics!.stroke({ color: CRAFT_COLOR, width: 1.5, alpha: 0.8 });
  }

  // Label.
  _useLabel('CRAFT', sx + 10, sy - 5, CRAFT_COLOR);
}

function _drawApsides(elements: OrbitalElements, bodyId: string, cx: number, cy: number, scale: number): void {
  if (!_mapRoot) return;
  const { semiMajorAxis: a, eccentricity: e, argPeriapsis: omega } = elements;
  const R = BODY_RADIUS[bodyId];

  // Periapsis (true anomaly = 0).
  const rPe  = a * (1 - e);
  const peX  = cx + rPe * Math.cos(omega) * scale;
  const peY  = cy - rPe * Math.sin(omega) * scale;
  const peAlt = rPe - R;

  _orbitsGraphics!.circle(peX, peY, 3);
  _orbitsGraphics!.stroke({ color: PE_COLOR, width: 1.5 });
  _useLabel(`Pe ${_fmtAlt(peAlt)}`, peX + 6, peY - 5, PE_COLOR);

  // Apoapsis (true anomaly = π).
  const rAp  = a * (1 + e);
  const apX  = cx + rAp * Math.cos(omega + Math.PI) * scale;
  const apY  = cy - rAp * Math.sin(omega + Math.PI) * scale;
  const apAlt = rAp - R;

  _orbitsGraphics!.circle(apX, apY, 3);
  _orbitsGraphics!.stroke({ color: AP_COLOR, width: 1.5 });
  _useLabel(`Ap ${_fmtAlt(apAlt)}`, apX + 6, apY - 5, AP_COLOR);
}

/**
 * Draw an orbit ellipse by sampling it at many points.
 */
function _drawOrbitEllipse(
  g: PIXI.Graphics,
  elements: OrbitalElements,
  bodyId: string,
  cx: number,
  cy: number,
  scale: number,
  color: number,
  width: number,
  alpha: number,
): void {
  const path = generateOrbitPath(elements, bodyId, 180);
  if (path.length < 2) return;

  g.moveTo(cx + path[0].x * scale, cy - path[0].y * scale);
  for (let i = 1; i < path.length; i++) {
    g.lineTo(cx + path[i].x * scale, cy - path[i].y * scale);
  }
  g.stroke({ color, width, alpha });
}

function _drawTransferTargets(ps: ReadonlyPhysicsState, flightState: ReadonlyFlightState, cx: number, cy: number, scale: number, bodyId: string): void {
  if (!_mapRoot) return;
  _transferGraphics!.clear();

  const altitude = Math.max(0, ps.posY);
  const phase = flightState.phase;
  const targets = getMapTransferTargets(bodyId, altitude, phase);

  if (targets.length === 0) return;

  for (const target of targets) {
    const isSelected = target.bodyId === _selectedTransferTarget;

    // Draw the target body's orbit as a dashed circle indicator.
    const orbitPxR = target.orbitRadius * scale;
    if (orbitPxR > 10 && orbitPxR < window.innerWidth * 2) {
      // Orbit circle for the target body (dashed via segments).
      const segments = 72;
      for (let i = 0; i < segments; i += 2) {
        const a1 = (Math.PI * 2 * i) / segments;
        const a2 = (Math.PI * 2 * (i + 1)) / segments;
        _transferGraphics!.moveTo(cx + orbitPxR * Math.cos(a1), cy - orbitPxR * Math.sin(a1));
        _transferGraphics!.lineTo(cx + orbitPxR * Math.cos(a2), cy - orbitPxR * Math.sin(a2));
      }
      _transferGraphics!.stroke({
        color: isSelected ? TRANSFER_TARGET_COLOR : 0x555533,
        width: isSelected ? 1.5 : 0.5,
        alpha: isSelected ? 0.6 : 0.2,
      });
    }

    // Draw the target body as a dot at its position.
    const sx = cx + target.position.x * scale;
    const sy = cy - target.position.y * scale;
    const dotR = isSelected ? 8 : 5;

    // Body dot.
    _transferGraphics!.circle(sx, sy, dotR);
    _transferGraphics!.fill(isSelected ? TRANSFER_TARGET_COLOR : MOON_BODY_COLOR);

    // Label with delta-v info.
    if (isSelected) {
      _useLabel(
        `${target.name} — Δv ${target.departureDVStr} depart`,
        sx + dotR + 6, sy - 14,
        TRANSFER_TARGET_COLOR,
      );
      _useLabel(
        `Total Δv ${target.totalDVStr} — ${target.transferTimeStr}`,
        sx + dotR + 6, sy + 2,
        TRANSFER_TARGET_COLOR,
      );
    } else {
      _useLabel(
        `${target.name} (Δv ${target.departureDVStr})`,
        sx + dotR + 4, sy - 6,
        0x888866,
      );
    }

    // Draw transfer route arc if this target is selected.
    if (isSelected && flightState.orbitalElements) {
      const route = getMapTransferRoute(
        bodyId, target.bodyId, altitude, flightState.orbitalElements,
      );
      if (route && route.transferPath.length > 1) {
        const path = route.transferPath;
        _transferGraphics!.moveTo(
          cx + path[0].x * scale,
          cy - path[0].y * scale,
        );
        for (let i = 1; i < path.length; i++) {
          _transferGraphics!.lineTo(
            cx + path[i].x * scale,
            cy - path[i].y * scale,
          );
        }
        _transferGraphics!.stroke({
          color: TRANSFER_ROUTE_COLOR,
          width: 2,
          alpha: 0.5,
        });

        // Burn direction label.
        _useLabel(
          `Burn: ${route.burnDirection} at ${route.burnPoint}`,
          cx + 10, cy + Math.min(window.innerHeight, window.innerWidth) / 2 - 30,
          TRANSFER_ROUTE_COLOR,
        );
      }
    }
  }
}

/**
 * Draw the predicted transfer trajectory during TRANSFER/CAPTURE phase.
 * Shows the craft's projected path as a dotted/fading line.
 */
function _drawTransferTrajectory(ps: ReadonlyPhysicsState, flightState: ReadonlyFlightState, cx: number, cy: number, scale: number, bodyId: string): void {
  if (!_mapRoot) return;
  const points = generateTransferTrajectory(ps, bodyId, 120);
  if (points.length < 2) return;

  // Draw the trajectory as a fading line.
  _transferGraphics!.moveTo(
    cx + points[0].x * scale,
    cy - points[0].y * scale,
  );
  for (let i = 1; i < points.length; i++) {
    _transferGraphics!.lineTo(
      cx + points[i].x * scale,
      cy - points[i].y * scale,
    );
  }
  _transferGraphics!.stroke({
    color: TRANSFER_TRAJECTORY_COLOR,
    width: 2,
    alpha: 0.6,
  });

  // Draw tick marks along the trajectory for time reference.
  const tickInterval = Math.max(1, Math.floor(points.length / 12));
  for (let i = tickInterval; i < points.length; i += tickInterval) {
    const px = cx + points[i].x * scale;
    const py = cy - points[i].y * scale;
    const alpha = 0.7 - (i / points.length) * 0.5;
    _transferGraphics!.circle(px, py, 2);
    _transferGraphics!.fill({ color: TRANSFER_TRAJECTORY_COLOR, alpha });
  }
}

/**
 * Draw celestial bodies relevant during transfer (destination, intermediate bodies).
 */
function _drawCelestialBodies(flightState: ReadonlyFlightState, cx: number, cy: number, scale: number, bodyId: string): void {
  if (!_mapRoot) return;
  const bodies = getMapCelestialBodies(bodyId, flightState.transferState);

  for (const body of bodies) {
    const sx = cx + body.orbitRadius * Math.cos(body.angle) * scale;
    const sy = cy - body.orbitRadius * Math.sin(body.angle) * scale;

    // Draw orbit circle for the body (dashed).
    const orbitPxR = body.orbitRadius * scale;
    if (orbitPxR > 5 && orbitPxR < window.innerWidth * 3) {
      const segments = 72;
      for (let i = 0; i < segments; i += 2) {
        const a1 = (Math.PI * 2 * i) / segments;
        const a2 = (Math.PI * 2 * (i + 1)) / segments;
        _transferGraphics!.moveTo(cx + orbitPxR * Math.cos(a1), cy - orbitPxR * Math.sin(a1));
        _transferGraphics!.lineTo(cx + orbitPxR * Math.cos(a2), cy - orbitPxR * Math.sin(a2));
      }

      const isDestination = flightState.transferState &&
        body.bodyId === flightState.transferState.destinationBodyId;

      _transferGraphics!.stroke({
        color: isDestination ? DEST_BODY_COLOR : SOI_BOUNDARY_COLOR,
        width: isDestination ? 1.5 : 0.5,
        alpha: isDestination ? 0.5 : 0.2,
      });
    }

    // Body dot.
    const isDestination = flightState.transferState &&
      body.bodyId === flightState.transferState.destinationBodyId;
    const bodyR = BODY_RADIUS[body.bodyId] || 1000;
    const dotR = Math.max(4, Math.min(12, bodyR * scale));
    const color = isDestination ? DEST_BODY_COLOR : MOON_BODY_COLOR;

    _transferGraphics!.circle(sx, sy, dotR);
    _transferGraphics!.fill(color);

    // Label.
    _useLabel(body.name, sx + dotR + 4, sy - 6, color);

    // If destination, add a pulsing highlight ring.
    if (isDestination) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 400);
      _transferGraphics!.circle(sx, sy, dotR + 4 + pulse * 3);
      _transferGraphics!.stroke({ color: DEST_BODY_COLOR, width: 1.5, alpha: 0.3 + pulse * 0.3 });
    }
  }

  // Draw SOI boundary circle of current body during transfer.
  const soiR = SOI_RADIUS[bodyId];
  if (soiR && soiR !== Infinity) {
    const soiPx = soiR * scale;
    if (soiPx > 10 && soiPx < window.innerWidth * 3) {
      _transferGraphics!.circle(cx, cy, soiPx);
      _transferGraphics!.stroke({ color: SOI_BOUNDARY_COLOR, width: 1, alpha: 0.3 });
      _useLabel('SOI Boundary', cx + soiPx + 4, cy - 8, SOI_BOUNDARY_COLOR);
    }
  }
}

/**
 * Draw transfer progress indicator (ETA, progress bar, destination info).
 */
function _drawTransferProgress(flightState: ReadonlyFlightState, w: number, h: number): void {
  if (!_mapRoot) return;
  const info = getTransferProgressInfo(flightState.transferState, flightState.timeElapsed);
  if (!info) return;

  // Progress bar at the top of the screen.
  const barW = 300;
  const barH = 6;
  const barX = (w - barW) / 2;
  const barY = 60;

  // Background.
  _transferGraphics!.rect(barX, barY, barW, barH);
  _transferGraphics!.fill({ color: 0x222233, alpha: 0.8 });

  // Fill.
  _transferGraphics!.rect(barX, barY, barW * info.progress, barH);
  _transferGraphics!.fill({ color: TRANSFER_TRAJECTORY_COLOR, alpha: 0.9 });

  // Labels.
  _useLabel(
    `${info.originName} → ${info.destName}`,
    barX, barY - 16,
    TRANSFER_TRAJECTORY_COLOR,
  );
  _useLabel(
    `ETA: ${info.etaStr} — Capture Δv: ${info.captureDV}`,
    barX, barY + barH + 4,
    0xcccccc,
  );
}

function _drawShadow(cx: number, cy: number, scale: number, R: number, timeElapsed: number): void {
  _shadowGraphics!.clear();
  if (!_showShadow) return;

  const bodyPxR = R * scale;
  if (bodyPxR < 5) return;

  // Sun direction rotates as time passes (one full rotation per 86 400 s).
  const sunAngle = (timeElapsed / 86_400) * Math.PI * 2;
  const nightAngle = sunAngle + Math.PI;

  // Semi-circle shadow on the night side.
  _shadowGraphics!.moveTo(cx, cy);
  _shadowGraphics!.arc(cx, cy, bodyPxR, nightAngle - Math.PI / 2, nightAngle + Math.PI / 2);
  _shadowGraphics!.closePath();
  _shadowGraphics!.fill({ color: SHADOW_COLOR, alpha: 0.4 });
}

// ---------------------------------------------------------------------------
// Private — comms coverage overlay
// ---------------------------------------------------------------------------

const COMMS_CONNECTED_COLOR = 0x00cc44;
const COMMS_DEAD_ZONE_COLOR = 0xcc2200;
const COMMS_DIRECT_COLOR    = 0x4488ff;

/**
 * Draw comms coverage zones on the map.
 * Connected zones shown in green, dead zones in red.
 */
function _drawCommsOverlay(state: ReadonlyGameState, bodyId: string, cx: number, cy: number, scale: number, R: number): void {
  if (!_mapRoot) return;
  if (!_commsGraphics) return;
  _commsGraphics.clear();
  if (!_showCommsOverlay) return;

  const coverage = getCommsCoverageInfo(state, bodyId);
  if (!coverage) return;

  // Draw direct coverage ring (Earth only).
  if (coverage.hasDirectCoverage && coverage.directRange > 0) {
    const directPxR = coverage.directRange * scale;
    if (directPxR > 2) {
      _commsGraphics.circle(cx, cy, directPxR);
      _commsGraphics.stroke({ color: COMMS_DIRECT_COLOR, width: 1.5, alpha: 0.4 });
    }
  }

  // Draw local network coverage ring.
  if (coverage.hasLocalNetwork && coverage.localNetworkRange > 0) {
    const netPxR = coverage.localNetworkRange * scale;
    if (netPxR > 2) {
      if (coverage.fullCoverage) {
        // Full coverage — complete green ring.
        _commsGraphics.circle(cx, cy, netPxR);
        _commsGraphics.fill({ color: COMMS_CONNECTED_COLOR, alpha: 0.06 });
        _commsGraphics.circle(cx, cy, netPxR);
        _commsGraphics.stroke({ color: COMMS_CONNECTED_COLOR, width: 1.5, alpha: 0.3 });
      } else {
        // Partial coverage — green on signal side, red shadow on far side.
        const shadowRad = (coverage.shadowAngleDeg * Math.PI) / 180;

        // Draw the connected arc (front hemisphere).
        const frontStart = -Math.PI / 2 + shadowRad;
        const frontEnd = -Math.PI / 2 - shadowRad + 2 * Math.PI;

        _commsGraphics.moveTo(cx, cy);
        _commsGraphics.arc(cx, cy, netPxR, frontStart, frontEnd);
        _commsGraphics.closePath();
        _commsGraphics.fill({ color: COMMS_CONNECTED_COLOR, alpha: 0.06 });

        // Draw the dead zone arc (far side).
        _commsGraphics.moveTo(cx, cy);
        _commsGraphics.arc(cx, cy, netPxR, frontEnd, frontStart);
        _commsGraphics.closePath();
        _commsGraphics.fill({ color: COMMS_DEAD_ZONE_COLOR, alpha: 0.08 });

        // Outline.
        _commsGraphics.circle(cx, cy, netPxR);
        _commsGraphics.stroke({ color: COMMS_CONNECTED_COLOR, width: 1, alpha: 0.25 });
      }
    }
  }

  // Status label.
  if (!coverage.connectedToEarth && coverage.hasLocalNetwork) {
    _useLabel('NOT LINKED TO EARTH', cx - 70, cy - R * scale - 30, COMMS_DEAD_ZONE_COLOR);
  }
}

// ---------------------------------------------------------------------------
// Private — input
// ---------------------------------------------------------------------------

function _onWheel(e: WheelEvent): void {
  if (!_mapRoot || !_mapRoot.visible) return;
  e.preventDefault();

  const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;

  if (_customViewRadius == null) {
    _customViewRadius = _viewRadius;
  }
  _customViewRadius *= factor;

  // Clamp to reasonable bounds — wider range to support interplanetary + belt views.
  const minR = BODY_RADIUS.EARTH * 1.02;
  const maxR = 600_000_000_000; // ~4 AU, enough for asteroid belt (3.2 AU).
  _customViewRadius = Math.max(minR, Math.min(maxR, _customViewRadius));
}

// ---------------------------------------------------------------------------
// Private — formatting
// ---------------------------------------------------------------------------

function _fmtAlt(metres: number): string {
  if (metres >= 1_000_000) return `${(metres / 1_000_000).toFixed(0)} Mm`;
  if (metres >= 1_000)     return `${(metres / 1_000).toFixed(0)} km`;
  return `${metres.toFixed(0)} m`;
}

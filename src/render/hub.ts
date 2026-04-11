/**
 * hub.ts — PixiJS rendering for the Space Agency Hub scene.
 *
 * Renders a 2D side-on landscape background:
 *   - Blue sky filling the top 70 % of the screen.
 *   - Sandy-tan desert ground filling the bottom 30 %.
 *   - A solid horizontal ground line at the boundary.
 *   - Placeholder coloured rectangles for each of the four hub buildings,
 *     sitting on the ground line.
 *
 * VISIBILITY
 * ==========
 * The hub container starts hidden.  Call showHubScene() to display it and
 * hideHubScene() to hide it (e.g. when navigating to the VAB).
 */

import * as PIXI from 'pixi.js';
import { getApp } from './index.ts';
import { RendererPool } from './pool.ts';
import { getSkyVisual, getGroundVisual } from '../data/bodies.ts';

// ---------------------------------------------------------------------------
// Colours — defaults (Earth)
// ---------------------------------------------------------------------------

const DEFAULT_SKY_COLOR    = 0x87CEEB;
const DEFAULT_GROUND_COLOR = 0xC2A165;
const DEFAULT_GROUND_LINE_COLOR = 0x8B6914;
const STARFIELD_COLOR = 0x050510;

// Active hub visuals (set via setHubBodyVisuals)
let _skyColor: number    = DEFAULT_SKY_COLOR;
let _groundColor: number = DEFAULT_GROUND_COLOR;
let _groundLineColor: number = DEFAULT_GROUND_LINE_COLOR;
let _isOrbitalHub = false;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const GROUND_Y_PCT = 0.70;

interface BuildingDef {
  id: string;
  colorFill: number;
  colorStroke: number;
  widthPct: number;
  heightPct: number;
  xCenterPct: number;
}

const BUILDINGS: BuildingDef[] = [
  {
    id:           'launch-pad',
    colorFill:    0x7a6a5a,
    colorStroke:  0xb09880,
    widthPct:     0.07,
    heightPct:    0.22,
    xCenterPct:   0.07,
  },
  {
    id:           'vab',
    colorFill:    0x4a6a8a,
    colorStroke:  0x7098c0,
    widthPct:     0.10,
    heightPct:    0.32,
    xCenterPct:   0.19,
  },
  {
    id:           'mission-control',
    colorFill:    0x4a7a5a,
    colorStroke:  0x68a870,
    widthPct:     0.09,
    heightPct:    0.24,
    xCenterPct:   0.31,
  },
  {
    id:           'crew-admin',
    colorFill:    0x8a6a4a,
    colorStroke:  0xb89060,
    widthPct:     0.08,
    heightPct:    0.18,
    xCenterPct:   0.42,
  },
  {
    id:           'tracking-station',
    colorFill:    0x5a5a8a,
    colorStroke:  0x8080c0,
    widthPct:     0.09,
    heightPct:    0.26,
    xCenterPct:   0.53,
  },
  {
    id:           'rd-lab',
    colorFill:    0x6a5a7a,
    colorStroke:  0x9880b0,
    widthPct:     0.10,
    heightPct:    0.24,
    xCenterPct:   0.65,
  },
  {
    id:           'satellite-ops',
    colorFill:    0x4a6a6a,
    colorStroke:  0x70a0a0,
    widthPct:     0.09,
    heightPct:    0.20,
    xCenterPct:   0.77,
  },
  {
    id:           'library',
    colorFill:    0x6a6a5a,
    colorStroke:  0xa0a080,
    widthPct:     0.08,
    heightPct:    0.16,
    xCenterPct:   0.88,
  },
  {
    id:           'logistics-center',
    colorFill:    0x5a6a7a,
    colorStroke:  0x8098b0,
    widthPct:     0.06,
    heightPct:    0.18,
    xCenterPct:   0.95,
  },
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _hubRoot: PIXI.Container | null = null;
let _weatherVisibility = 0;
let _weatherExtreme = false;
let _builtFacilities: Set<string> | null = null;
const _pool = new RendererPool();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initHubRenderer(): void {
  const app = getApp();

  _hubRoot = new PIXI.Container();
  _hubRoot.visible = false;

  app.stage.addChildAt(_hubRoot, 0);

  window.addEventListener('resize', () => {
    if (_hubRoot && _hubRoot.visible) {
      _drawScene();
    }
  });

}

export function setHubWeather(visibility: number, extreme: boolean): void {
  _weatherVisibility = visibility;
  _weatherExtreme = extreme;
  if (_hubRoot && _hubRoot.visible) {
    _drawScene();
  }
}

export function setBuiltFacilities(builtIds: Set<string> | null): void {
  _builtFacilities = builtIds;
  if (_hubRoot && _hubRoot.visible) {
    _drawScene();
  }
}

/**
 * Set the hub background visuals based on the active hub's body and type.
 *
 * Surface hubs use the body's ground and sky colours.
 * Orbital hubs use a dark starfield background with no ground.
 */
export function setHubBodyVisuals(bodyId: string, hubType: 'surface' | 'orbital'): void {
  _isOrbitalHub = hubType === 'orbital';

  if (_isOrbitalHub) {
    _skyColor = STARFIELD_COLOR;
    _groundColor = STARFIELD_COLOR;
    _groundLineColor = STARFIELD_COLOR;
    return;
  }

  // Surface hub — look up body visuals, fall back to Earth defaults.
  const sky = getSkyVisual(bodyId);
  const ground = getGroundVisual(bodyId);

  _skyColor = sky?.seaLevelColor ?? DEFAULT_SKY_COLOR;
  _groundColor = ground?.color ?? DEFAULT_GROUND_COLOR;
  // Derive ground line colour: darken the ground colour by shifting channels.
  // If we have a custom ground colour, use a slightly darker variant.
  if (ground) {
    const r = Math.max(0, ((ground.color >> 16) & 0xFF) - 0x30);
    const g = Math.max(0, ((ground.color >> 8)  & 0xFF) - 0x30);
    const b = Math.max(0, ( ground.color         & 0xFF) - 0x30);
    _groundLineColor = (r << 16) | (g << 8) | b;
  } else {
    _groundLineColor = DEFAULT_GROUND_LINE_COLOR;
  }
}

export function showHubScene(): void {
  if (!_hubRoot) return;
  const app = getApp();
  if (!_hubRoot.parent) {
    app.stage.addChildAt(_hubRoot, 0);
  }
  _hubRoot.visible = true;
  _drawScene();
}

export function hideHubScene(): void {
  if (!_hubRoot) return;
  _hubRoot.visible = false;
}

// ---------------------------------------------------------------------------
// Private — scene drawing
// ---------------------------------------------------------------------------

function _drawScene(): void {
  if (!_hubRoot) return;

  _pool.releaseContainerChildren(_hubRoot);

  const app     = getApp();
  const W       = app.screen.width;
  const H       = app.screen.height;
  const groundY = Math.round(H * GROUND_Y_PCT);

  if (_isOrbitalHub) {
    // Orbital hub: starfield fills the entire screen, no ground.
    const bg = _pool.acquireGraphics();
    bg.rect(0, 0, W, H);
    bg.fill(STARFIELD_COLOR);
    _hubRoot.addChild(bg);
  } else {
    // Surface hub: sky + ground + ground line.
    const skyGfx = _pool.acquireGraphics();
    skyGfx.rect(0, 0, W, groundY);
    skyGfx.fill(_skyColor);
    _hubRoot.addChild(skyGfx);

    const ground = _pool.acquireGraphics();
    ground.rect(0, groundY, W, H - groundY);
    ground.fill(_groundColor);
    _hubRoot.addChild(ground);

    const groundLine = _pool.acquireGraphics();
    groundLine.moveTo(0, groundY);
    groundLine.lineTo(W, groundY);
    groundLine.stroke({ color: _groundLineColor, width: 2 });
    _hubRoot.addChild(groundLine);
  }

  for (const bld of BUILDINGS) {
    if (_builtFacilities && !_builtFacilities.has(bld.id)) continue;

    const bldW = W * bld.widthPct;
    const bldH = H * bld.heightPct;
    const bldX = W * bld.xCenterPct - bldW / 2;
    const bldY = groundY - bldH;

    const g = _pool.acquireGraphics();
    g.rect(bldX, bldY, bldW, bldH);
    g.fill({ color: bld.colorFill, alpha: 0.9 });
    g.stroke({ color: bld.colorStroke, width: 2 });
    _hubRoot.addChild(g);
  }

  if (_weatherVisibility > 0.01) {
    const hazeAlpha = Math.min(0.6, _weatherVisibility * 0.6);
    const hazeColor = _weatherExtreme ? 0x604030 : 0xc0c0c0;
    const haze = _pool.acquireGraphics();
    haze.rect(0, 0, W, H);
    haze.fill({ color: hazeColor, alpha: hazeAlpha });
    _hubRoot.addChild(haze);
  }
}

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

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const SKY_COLOR    = 0x87CEEB;
const GROUND_COLOR = 0xC2A165;
const GROUND_LINE_COLOR = 0x8B6914;

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

  const sky = _pool.acquireGraphics();
  sky.rect(0, 0, W, groundY);
  sky.fill(SKY_COLOR);
  _hubRoot.addChild(sky);

  const ground = _pool.acquireGraphics();
  ground.rect(0, groundY, W, H - groundY);
  ground.fill(GROUND_COLOR);
  _hubRoot.addChild(ground);

  const groundLine = _pool.acquireGraphics();
  groundLine.moveTo(0, groundY);
  groundLine.lineTo(W, groundY);
  groundLine.stroke({ color: GROUND_LINE_COLOR, width: 2 });
  _hubRoot.addChild(groundLine);

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

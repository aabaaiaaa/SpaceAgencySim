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
    id:           'crew-hab',
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
    widthPct:     0.07,
    heightPct:    0.16,
    xCenterPct:   0.86,
  },
  {
    id:           'logistics-center',
    colorFill:    0x5a6a7a,
    colorStroke:  0x8098b0,
    widthPct:     0.06,
    heightPct:    0.18,
    xCenterPct:   0.945,
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

/** Window resize handler reference — tracked so destroyHubRenderer can remove it. */
let _resizeHandler: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function initHubRenderer(): void {
  const app = getApp();

  _hubRoot = new PIXI.Container();
  _hubRoot.visible = false;

  app.stage.addChildAt(_hubRoot, 0);

  _resizeHandler = (): void => {
    if (_hubRoot && _hubRoot.visible) {
      _drawScene();
    }
  };
  window.addEventListener('resize', _resizeHandler);

}

/**
 * Tear down the hub PixiJS scene: destroy the scene-root container and all
 * its children, drain the RendererPool, and remove the resize listener.
 * Called from `destroyHubUI()` on the navigation-away path so that GPU
 * textures and Graphics geometry don't accumulate across hub ↔ VAB ↔ flight
 * swaps. Safe to call when the scene was never initialised (no-op).
 * `showHubScene()` lazily re-initialises the scene on next entry.
 */
export function destroyHubRenderer(): void {
  if (_resizeHandler) {
    window.removeEventListener('resize', _resizeHandler);
    _resizeHandler = null;
  }

  if (_hubRoot) {
    const app = getApp();
    if (_hubRoot.parent) app.stage.removeChild(_hubRoot);
    _hubRoot.destroy({ children: true });
    _hubRoot = null;
  }

  _builtFacilities = null;
  _weatherVisibility = 0;
  _weatherExtreme = false;

  // Drop the pool — its Graphics were just destroyed by the children:true above.
  _pool.drain();
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
  // Lazily re-initialise if a previous destroyHubRenderer() tore down the scene.
  if (!_hubRoot) {
    initHubRenderer();
  }
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

  if (_isOrbitalHub) {
    // Orbital hub: render buildings as station modules floating mid-screen
    // with connecting walkways between adjacent modules.
    const moduleCentreY = Math.round(H * 0.48);
    const rendered: Array<{ x: number; y: number; w: number; h: number }> = [];

    for (const bld of BUILDINGS) {
      if (_builtFacilities && !_builtFacilities.has(bld.id)) continue;

      // Modules look chunkier and more square than surface buildings.
      const bldW = W * bld.widthPct * 1.05;
      const bldH = Math.min(H * bld.heightPct * 0.7, bldW * 1.15);
      const bldX = W * bld.xCenterPct - bldW / 2;
      const bldY = moduleCentreY - bldH / 2;

      rendered.push({ x: bldX, y: bldY, w: bldW, h: bldH });
    }

    // Sort left-to-right so walkways connect adjacent modules.
    rendered.sort((a, b) => a.x - b.x);

    // Draw walkways first (underneath modules).
    for (let i = 0; i < rendered.length - 1; i++) {
      const a = rendered[i];
      const b = rendered[i + 1];
      const ax = a.x + a.w;
      const bx = b.x;
      if (bx <= ax) continue; // overlapping — skip walkway
      const yMid = (a.y + a.h / 2 + b.y + b.h / 2) / 2;
      const walkHeight = Math.max(6, Math.min(a.h, b.h) * 0.18);

      // Walkway rectangle (corridor body).
      const walk = _pool.acquireGraphics();
      walk.rect(ax, yMid - walkHeight / 2, bx - ax, walkHeight);
      walk.fill({ color: 0x3a4a5a, alpha: 0.85 });
      walk.stroke({ color: 0x6080a0, width: 1, alpha: 0.7 });
      _hubRoot.addChild(walk);

      // Rivets / window strip along the corridor.
      const windows = _pool.acquireGraphics();
      const winY = yMid - 1;
      const winStep = Math.max(6, (bx - ax) / 12);
      for (let x = ax + winStep / 2; x < bx; x += winStep) {
        windows.rect(x - 1, winY, 2, 2);
      }
      windows.fill({ color: 0xffd480, alpha: 0.9 });
      _hubRoot.addChild(windows);
    }

    // Draw modules on top of walkways.
    for (const r of rendered) {
      const g = _pool.acquireGraphics();
      // Main module body — rounded rectangle via rect + inset highlight.
      g.rect(r.x, r.y, r.w, r.h);
      g.fill({ color: 0x3f4f62, alpha: 0.95 });
      g.stroke({ color: 0x94b3d2, width: 2 });
      _hubRoot.addChild(g);

      // Solar-panel wings on modules with room.
      if (r.w > 40) {
        const panelW = Math.max(8, r.w * 0.35);
        const panelH = Math.max(4, r.h * 0.18);
        const panelYTop = r.y - panelH - 2;
        const panelYBot = r.y + r.h + 2;
        const panelXL = r.x + r.w / 2 - panelW;
        const panelXR = r.x + r.w / 2;
        const panels = _pool.acquireGraphics();
        panels.rect(panelXL, panelYTop, panelW * 2, panelH);
        panels.rect(panelXL, panelYBot, panelW * 2, panelH);
        panels.fill({ color: 0x1a3360, alpha: 0.9 });
        panels.stroke({ color: 0x446088, width: 1 });
        // Panel grid lines.
        panels.moveTo(panelXR, panelYTop);
        panels.lineTo(panelXR, panelYTop + panelH);
        panels.moveTo(panelXR, panelYBot);
        panels.lineTo(panelXR, panelYBot + panelH);
        panels.stroke({ color: 0x264772, width: 1 });
        _hubRoot.addChild(panels);
      }

      // Window strip across the module.
      const winGfx = _pool.acquireGraphics();
      const rowY = r.y + r.h * 0.4;
      const winStep = Math.max(5, r.w / 8);
      for (let x = r.x + winStep / 2; x < r.x + r.w; x += winStep) {
        winGfx.rect(x - 1.5, rowY - 1.5, 3, 3);
      }
      winGfx.fill({ color: 0xffe0a0, alpha: 0.95 });
      _hubRoot.addChild(winGfx);
    }
  } else {
    // Surface hub: legacy rectangle buildings on the ground line.
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

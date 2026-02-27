/**
 * hub.js — PixiJS rendering for the Space Agency Hub scene.
 *
 * Renders a 2D side-on landscape background:
 *   - Blue sky filling the top 70 % of the screen.
 *   - Sandy-tan desert ground filling the bottom 30 %.
 *   - A solid horizontal ground line at the boundary.
 *   - Placeholder coloured rectangles for each of the four hub buildings,
 *     sitting on the ground line.
 *
 * Interactive hit-testing (clicks, hover) is handled by transparent HTML
 * `<div>` elements in src/ui/hub.js that are positioned to sit exactly on
 * top of the PixiJS building rectangles.  This keeps the buildings
 * accessible to Playwright and screen readers.
 *
 * VISIBILITY
 * ==========
 * The hub container starts hidden.  Call showHubScene() to display it and
 * hideHubScene() to hide it (e.g. when navigating to the VAB).
 */

import * as PIXI from 'pixi.js';
import { getApp } from './index.js';

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** Sky colour — light blue (#87CEEB). */
const SKY_COLOR    = 0x87CEEB;

/** Desert ground colour — sandy tan (#C2A165). */
const GROUND_COLOR = 0xC2A165;

/** Ground line colour — a slightly darker earth tone. */
const GROUND_LINE_COLOR = 0x8B6914;

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/**
 * The ground sits at this fraction of the viewport height from the top.
 * Must match GROUND_Y_PCT in src/ui/hub.js.
 */
const GROUND_Y_PCT = 0.70;

/**
 * Building visual definitions.
 * xCenterPct / widthPct / heightPct are expressed as fractions of the
 * viewport width/height.  These values must be kept in sync with the
 * matching BUILDINGS array in src/ui/hub.js.
 *
 * @type {Array<{
 *   id: string,
 *   colorFill: number,
 *   colorStroke: number,
 *   widthPct: number,
 *   heightPct: number,
 *   xCenterPct: number,
 * }>}
 */
const BUILDINGS = [
  {
    id:           'launch-pad',
    colorFill:    0x7a6a5a,
    colorStroke:  0xb09880,
    widthPct:     0.09,
    heightPct:    0.22,
    xCenterPct:   0.14,
  },
  {
    id:           'vab',
    colorFill:    0x4a6a8a,
    colorStroke:  0x7098c0,
    widthPct:     0.16,
    heightPct:    0.32,
    xCenterPct:   0.35,
  },
  {
    id:           'mission-control',
    colorFill:    0x4a7a5a,
    colorStroke:  0x68a870,
    widthPct:     0.13,
    heightPct:    0.24,
    xCenterPct:   0.58,
  },
  {
    id:           'crew-admin',
    colorFill:    0x8a6a4a,
    colorStroke:  0xb89060,
    widthPct:     0.11,
    heightPct:    0.18,
    xCenterPct:   0.78,
  },
];

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Root PixiJS container for all hub scene layers. @type {PIXI.Container | null} */
let _hubRoot = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the hub PixiJS scene.
 * Must be called after initRenderer() has resolved.
 * The scene starts hidden; call showHubScene() to display it.
 */
export function initHubRenderer() {
  const app = getApp();

  _hubRoot = new PIXI.Container();
  _hubRoot.visible = false;

  // Insert at index 0 so the hub background sits behind the VAB layers.
  app.stage.addChildAt(_hubRoot, 0);

  // Redraw on resize so percentages remain accurate.
  window.addEventListener('resize', () => {
    if (_hubRoot && _hubRoot.visible) {
      _drawScene();
    }
  });

  console.log('[Hub Renderer] Initialized');
}

/**
 * Make the hub scene visible and draw it.
 * Call this when navigating to the hub screen.
 */
export function showHubScene() {
  if (!_hubRoot) return;
  _hubRoot.visible = true;
  _drawScene();
}

/**
 * Hide the hub scene.
 * Call this when navigating away from the hub (e.g. to the VAB).
 */
export function hideHubScene() {
  if (!_hubRoot) return;
  _hubRoot.visible = false;
}

// ---------------------------------------------------------------------------
// Private — scene drawing
// ---------------------------------------------------------------------------

/**
 * (Re)draw all hub scene elements into _hubRoot.
 * Safe to call multiple times (removes existing children first).
 */
function _drawScene() {
  if (!_hubRoot) return;

  // Clear previous draw.
  _hubRoot.removeChildren();

  const app     = getApp();
  const W       = app.screen.width;
  const H       = app.screen.height;
  const groundY = Math.round(H * GROUND_Y_PCT);

  // ── Sky ────────────────────────────────────────────────────────────────────
  const sky = new PIXI.Graphics();
  sky.rect(0, 0, W, groundY);
  sky.fill(SKY_COLOR);
  _hubRoot.addChild(sky);

  // ── Ground ─────────────────────────────────────────────────────────────────
  const ground = new PIXI.Graphics();
  ground.rect(0, groundY, W, H - groundY);
  ground.fill(GROUND_COLOR);
  _hubRoot.addChild(ground);

  // ── Ground line ─────────────────────────────────────────────────────────────
  const groundLine = new PIXI.Graphics();
  groundLine.moveTo(0, groundY);
  groundLine.lineTo(W, groundY);
  groundLine.stroke({ color: GROUND_LINE_COLOR, width: 2 });
  _hubRoot.addChild(groundLine);

  // ── Building rectangles ─────────────────────────────────────────────────────
  for (const bld of BUILDINGS) {
    const bldW = W * bld.widthPct;
    const bldH = H * bld.heightPct;
    const bldX = W * bld.xCenterPct - bldW / 2;
    const bldY = groundY - bldH;

    const g = new PIXI.Graphics();
    g.rect(bldX, bldY, bldW, bldH);
    g.fill({ color: bld.colorFill, alpha: 0.9 });
    g.stroke({ color: bld.colorStroke, width: 2 });
    _hubRoot.addChild(g);
  }
}

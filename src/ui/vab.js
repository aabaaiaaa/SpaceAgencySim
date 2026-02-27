/**
 * vab.js — Vehicle Assembly Building HTML overlay UI.
 *
 * Renders the VAB chrome over the PixiJS canvas:
 *   - Toolbar at the top: cash readout, "View Accepted Missions",
 *     "Rocket Engineer", and "Launch" (disabled until validation passes).
 *   - Parts panel on the right: scrollable list of unlocked parts grouped
 *     by type, each card showing name, mass, and cost.
 *   - Vertical scale bar on the left edge of the build area: metre labels
 *     that stay in sync with the camera's vertical pan and zoom.
 *   - Missions side panel: slides in from the build-canvas left edge when
 *     the "View Accepted Missions" button is clicked.
 *   - Rocket Engineer side panel: stub placeholder populated by TASK-019.
 *
 * Canvas panning (pointer drag) and zooming (wheel) are handled here via
 * events on the transparent #vab-canvas-area div; camera updates delegate
 * to src/render/vab.js.
 */

import { PARTS } from '../data/parts.js';
import { PartType } from '../core/constants.js';
import {
  VAB_TOOLBAR_HEIGHT,
  VAB_PARTS_PANEL_WIDTH,
  VAB_SCALE_BAR_WIDTH,
  VAB_PIXELS_PER_METRE,
  vabPanCamera,
  vabSetZoom,
  vabGetCamera,
} from '../render/vab.js';

// ---------------------------------------------------------------------------
// Part-type display helpers
// ---------------------------------------------------------------------------

/** Human-readable category label for each PartType value. */
const TYPE_LABELS = {
  [PartType.COMMAND_MODULE]:       'Command Modules',
  [PartType.COMPUTER_MODULE]:      'Computer Modules',
  [PartType.SERVICE_MODULE]:       'Service Modules',
  [PartType.FUEL_TANK]:            'Fuel Tanks',
  [PartType.ENGINE]:               'Engines',
  [PartType.SOLID_ROCKET_BOOSTER]: 'Solid Boosters',
  [PartType.STACK_DECOUPLER]:      'Decouplers',
  [PartType.RADIAL_DECOUPLER]:     'Decouplers',
  [PartType.DECOUPLER]:            'Decouplers',
  [PartType.LANDING_LEG]:          'Landing Gear',
  [PartType.LANDING_LEGS]:         'Landing Gear',
  [PartType.PARACHUTE]:            'Parachutes',
  [PartType.SATELLITE]:            'Satellites & Payloads',
  [PartType.HEAT_SHIELD]:          'Heat Shields',
  [PartType.RCS_THRUSTER]:         'RCS Thrusters',
  [PartType.SOLAR_PANEL]:          'Solar Panels',
};

/** Top-to-bottom display order for part-type groups in the panel. */
const TYPE_ORDER = [
  PartType.COMMAND_MODULE,
  PartType.COMPUTER_MODULE,
  PartType.SERVICE_MODULE,
  PartType.FUEL_TANK,
  PartType.ENGINE,
  PartType.SOLID_ROCKET_BOOSTER,
  PartType.STACK_DECOUPLER,
  PartType.RADIAL_DECOUPLER,
  PartType.DECOUPLER,
  PartType.LANDING_LEG,
  PartType.LANDING_LEGS,
  PartType.PARACHUTE,
  PartType.SATELLITE,
  PartType.HEAT_SHIELD,
  PartType.RCS_THRUSTER,
  PartType.SOLAR_PANEL,
];

/**
 * Format a dollar amount with $ prefix, commas, and no decimal places.
 * @param {number} n
 * @returns {string}
 */
function fmt$(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// CSS (injected once into <head>; IDs prevent double-injection)
// ---------------------------------------------------------------------------

const VAB_CSS = `
/* ── VAB root ───────────────────────────────────────────────────────── */
#vab-root {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  pointer-events: none;
  font-family: 'Courier New', Courier, monospace;
  color: #c0d4ec;
  user-select: none;
  overflow: hidden;
}

/* ── Toolbar ─────────────────────────────────────────────────────────── */
#vab-toolbar {
  height: ${VAB_TOOLBAR_HEIGHT}px;
  min-height: ${VAB_TOOLBAR_HEIGHT}px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  background: rgba(4, 8, 20, 0.97);
  border-bottom: 1px solid #162c48;
  pointer-events: auto;
  flex-shrink: 0;
  z-index: 20;
  gap: 12px;
}

.vab-cash-block {
  display: flex;
  flex-direction: column;
  line-height: 1.15;
  min-width: 130px;
}
.vab-cash-label {
  font-size: 9px;
  color: #3a6080;
  text-transform: uppercase;
  letter-spacing: .1em;
}
.vab-cash-value {
  font-size: 20px;
  font-weight: 700;
  color: #45df88;
  letter-spacing: .02em;
}

.vab-toolbar-btns {
  display: flex;
  gap: 8px;
  align-items: center;
}

.vab-btn {
  background: rgba(12, 26, 54, 0.92);
  border: 1px solid #1e3b60;
  color: #84aece;
  padding: 5px 13px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  border-radius: 2px;
  transition: background .1s, border-color .1s, color .1s;
  white-space: nowrap;
  line-height: 1.4;
}
.vab-btn:hover:not(:disabled) {
  background: rgba(22, 52, 90, 0.95);
  border-color: #3470a8;
  color: #c8e4ff;
}
.vab-btn:disabled {
  opacity: .28;
  cursor: not-allowed;
}

.vab-btn-launch {
  background: rgba(36, 12, 12, 0.92);
  border-color: #401818;
  color: #9a5858;
}
.vab-btn-launch:not(:disabled) {
  background: rgba(16, 58, 22, 0.92);
  border-color: #235828;
  color: #62c870;
}
.vab-btn-launch:hover:not(:disabled) {
  background: rgba(22, 80, 30, 0.97);
  border-color: #38883e;
  color: #8ef09a;
}

/* ── Main row (toolbar bottom to window bottom) ───────────────────── */
#vab-main {
  flex: 1;
  display: flex;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

/* ── Scale bar ───────────────────────────────────────────────────────── */
#vab-scale-bar {
  width: ${VAB_SCALE_BAR_WIDTH}px;
  min-width: ${VAB_SCALE_BAR_WIDTH}px;
  flex-shrink: 0;
  background: rgba(3, 6, 16, 0.92);
  border-right: 1px solid #0e1e30;
  position: relative;
  overflow: hidden;
  pointer-events: none;
}

.vab-scale-ticks {
  position: absolute;
  inset: 0;
}

.vab-tick {
  position: absolute;
  right: 0;
  height: 0;
  width: 100%;
  display: flex;
  align-items: center;
}

/* Tick mark line rendered via ::after */
.vab-tick-minor::after {
  content: '';
  position: absolute;
  right: 0;
  height: 1px;
  width: 6px;
  background: #16283e;
}
.vab-tick-major::after {
  content: '';
  position: absolute;
  right: 0;
  height: 1px;
  width: 12px;
  background: #1e3c5a;
}

.vab-tick-label {
  position: absolute;
  right: 16px;
  font-size: 8px;
  color: #2e5878;
  transform: translateY(-50%);
  white-space: nowrap;
  line-height: 1;
}

/* ── Build canvas (transparent — PixiJS grid visible beneath) ──────── */
#vab-canvas-area {
  flex: 1;
  min-width: 0;
  position: relative;
  pointer-events: auto;
  cursor: crosshair;
}
#vab-canvas-area.panning {
  cursor: grabbing;
}

/* ── Parts panel ─────────────────────────────────────────────────────── */
#vab-parts-panel {
  width: ${VAB_PARTS_PANEL_WIDTH}px;
  min-width: ${VAB_PARTS_PANEL_WIDTH}px;
  flex-shrink: 0;
  background: rgba(3, 6, 18, 0.97);
  border-left: 1px solid #162c48;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  z-index: 20;
}

.vab-parts-title {
  flex-shrink: 0;
  padding: 9px 12px 7px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: #2e5878;
  border-bottom: 1px solid #0e1e30;
}

.vab-parts-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0 14px;
  scrollbar-width: thin;
  scrollbar-color: #152a44 transparent;
}
.vab-parts-list::-webkit-scrollbar { width: 4px; }
.vab-parts-list::-webkit-scrollbar-thumb {
  background: #152a44;
  border-radius: 2px;
}

.vab-parts-group-hdr {
  padding: 8px 12px 3px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: #223850;
}

.vab-part-card {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 10px 5px 12px;
  cursor: grab;
  transition: background .08s;
}
.vab-part-card:hover {
  background: rgba(14, 38, 74, 0.55);
}
.vab-part-card:active {
  cursor: grabbing;
}

.vab-part-rect {
  flex-shrink: 0;
  background: rgba(36, 80, 140, 0.45);
  border: 1px solid #1e5898;
  border-radius: 1px;
  box-sizing: border-box;
}

.vab-part-info {
  flex: 1;
  min-width: 0;
}
.vab-part-name {
  font-size: 11px;
  color: #a8c8e8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.vab-part-meta {
  display: flex;
  gap: 6px;
  font-size: 9px;
  color: #365474;
  margin-top: 2px;
}

.vab-parts-empty {
  padding: 28px 16px;
  font-size: 10px;
  color: #224060;
  text-align: center;
  line-height: 1.75;
}

/* ── Side panels ─────────────────────────────────────────────────────── */
.vab-side-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${VAB_SCALE_BAR_WIDTH}px;
  width: 300px;
  background: rgba(3, 6, 18, 0.98);
  border-right: 1px solid #162c48;
  box-shadow: 6px 0 28px rgba(0,0,0,.75);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  z-index: 40;
}
.vab-side-panel[hidden] {
  display: none;
}

.vab-side-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  border-bottom: 1px solid #0e1e30;
  font-size: 12px;
  font-weight: 700;
  color: #88b4d0;
  flex-shrink: 0;
}

.vab-side-close {
  background: none;
  border: none;
  color: #2e5070;
  cursor: pointer;
  font-size: 14px;
  padding: 0 3px;
  line-height: 1;
  font-family: inherit;
}
.vab-side-close:hover { color: #88b4d0; }

.vab-side-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  scrollbar-width: thin;
  scrollbar-color: #152a44 transparent;
}
.vab-side-body::-webkit-scrollbar { width: 4px; }
.vab-side-body::-webkit-scrollbar-thumb {
  background: #152a44;
  border-radius: 2px;
}

.vab-mission-card {
  margin-bottom: 14px;
  padding: 10px 12px;
  background: rgba(10, 22, 46, 0.7);
  border: 1px solid #162c48;
  border-radius: 2px;
}
.vab-mission-title {
  font-size: 11px;
  font-weight: 700;
  color: #88bcdc;
  margin-bottom: 3px;
}
.vab-mission-reward {
  font-size: 9px;
  color: #45df88;
  margin-bottom: 5px;
}
.vab-mission-desc {
  font-size: 9px;
  color: #3a6080;
  line-height: 1.55;
}

.vab-side-empty {
  padding: 24px 0;
  font-size: 10px;
  color: #224060;
  text-align: center;
  line-height: 1.75;
}
`;

// ---------------------------------------------------------------------------
// Scale bar rendering
// ---------------------------------------------------------------------------

/** @type {HTMLElement | null} */
let _scaleTicks = null;

/** Cached build-area height in CSS pixels (updated by ResizeObserver). */
let _buildAreaHeight = 0;

/**
 * Regenerate the scale-bar tick marks to match the current camera state.
 * This is called on init, on window resize, and whenever the camera moves.
 */
function _drawScaleTicks() {
  if (!_scaleTicks || _buildAreaHeight === 0) return;

  const { zoom, y: camY } = vabGetCamera();
  const pxPerMetre = VAB_PIXELS_PER_METRE * zoom;
  const h = _buildAreaHeight;

  // Choose a readable tick interval (in metres) based on current zoom.
  let tickM = 1;
  if      (pxPerMetre < 5)   tickM = 200;
  else if (pxPerMetre < 10)  tickM = 100;
  else if (pxPerMetre < 20)  tickM = 50;
  else if (pxPerMetre < 40)  tickM = 10;
  else if (pxPerMetre < 80)  tickM = 5;
  else if (pxPerMetre < 160) tickM = 2;
  // ≥ 160 px/m: tick every 1 m.

  const majorEvery = 5; // label every Nth tick

  // Altitude at the top and bottom of the build area.
  const topM  = camY / pxPerMetre;
  const botM  = (camY - h) / pxPerMetre;

  const startM = Math.ceil(botM  / tickM) * tickM;
  const endM   = Math.floor(topM / tickM) * tickM;

  const frags = [];
  let idx = 0;

  for (let m = startM; m <= endM; m += tickM, idx++) {
    // barY: screen-Y offset from the top of the scale bar.
    const barY = camY - m * pxPerMetre;
    if (barY < 0 || barY > h) continue;

    const isMajor = idx % majorEvery === 0;
    frags.push(
      `<div class="vab-tick ${isMajor ? 'vab-tick-major' : 'vab-tick-minor'}" ` +
        `style="top:${barY.toFixed(1)}px">` +
        (isMajor ? `<span class="vab-tick-label">${m}m</span>` : '') +
      `</div>`,
    );
  }

  _scaleTicks.innerHTML = frags.join('');
}

// ---------------------------------------------------------------------------
// Parts panel HTML builder
// ---------------------------------------------------------------------------

/**
 * Build the inner HTML for the parts list from the current game state.
 * @param {import('../core/gameState.js').GameState} state
 * @returns {string}
 */
function _buildPartsHTML(state) {
  const unlocked = new Set(state.parts);
  const available = PARTS.filter((p) => unlocked.has(p.id));

  // Group parts by display label, preserving TYPE_ORDER.
  /** @type {Map<string, import('../data/parts.js').PartDef[]>} */
  const groups = new Map();
  for (const type of TYPE_ORDER) {
    const label = TYPE_LABELS[type];
    if (!label) continue;
    const matching = available.filter((p) => p.type === type);
    if (matching.length === 0) continue;
    if (!groups.has(label)) groups.set(label, []);
    for (const p of matching) groups.get(label).push(p);
  }

  if (groups.size === 0) {
    return `<p class="vab-parts-empty">No parts unlocked yet.<br>Complete missions to<br>unlock rocket components.</p>`;
  }

  const rows = [];
  for (const [label, parts] of groups) {
    rows.push(`<div class="vab-parts-group-hdr">${label}</div>`);
    for (const p of parts) {
      // Scale the part rect to fit within 36×36 while preserving aspect ratio.
      const scale = Math.min(36 / p.width, 36 / p.height, 1);
      const rw = Math.max(8,  Math.round(p.width  * scale));
      const rh = Math.max(4,  Math.round(p.height * scale));
      rows.push(
        `<div class="vab-part-card" data-part-id="${p.id}" ` +
            `title="${p.name} — ${p.mass} kg · ${fmt$(p.cost)}">` +
          `<div class="vab-part-rect" style="width:${rw}px;height:${rh}px"></div>` +
          `<div class="vab-part-info">` +
            `<div class="vab-part-name">${p.name}</div>` +
            `<div class="vab-part-meta">` +
              `<span>${p.mass}\u202fkg</span><span>${fmt$(p.cost)}</span>` +
            `</div>` +
          `</div>` +
        `</div>`,
      );
    }
  }
  return rows.join('');
}

// ---------------------------------------------------------------------------
// Missions side-panel HTML builder
// ---------------------------------------------------------------------------

/**
 * @param {import('../core/gameState.js').GameState} state
 * @returns {string}
 */
function _buildMissionsHTML(state) {
  const accepted = state.missions.accepted;
  if (accepted.length === 0) {
    return `<p class="vab-side-empty">No missions accepted.<br>Visit the mission board<br>to accept a mission first.</p>`;
  }
  return accepted.map((m) =>
    `<div class="vab-mission-card">` +
      `<div class="vab-mission-title">${m.title}</div>` +
      `<div class="vab-mission-reward">Reward: ${fmt$(m.reward)}</div>` +
      `<div class="vab-mission-desc">${m.description}</div>` +
    `</div>`,
  ).join('');
}

// ---------------------------------------------------------------------------
// Canvas panning & zooming
// ---------------------------------------------------------------------------

/**
 * Attach pointer-drag (pan) and wheel (zoom) listeners to the build-canvas
 * overlay div.
 * @param {HTMLElement} canvasArea
 */
function _setupPan(canvasArea) {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvasArea.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasArea.setPointerCapture(e.pointerId);
    canvasArea.classList.add('panning');
  });

  canvasArea.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    vabPanCamera(dx, dy);
    _drawScaleTicks();
  });

  const _stopDrag = () => {
    dragging = false;
    canvasArea.classList.remove('panning');
  };
  canvasArea.addEventListener('pointerup',     _stopDrag);
  canvasArea.addEventListener('pointercancel', _stopDrag);

  // Scroll-wheel zoom centred on the cursor.
  canvasArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const { zoom } = vabGetCamera();
    vabSetZoom(zoom * factor);
    _drawScaleTicks();
  }, { passive: false });
}

// ---------------------------------------------------------------------------
// Button event bindings
// ---------------------------------------------------------------------------

/**
 * @param {HTMLElement} root  The #vab-root element.
 */
function _bindButtons(root) {
  const missionsPanel = /** @type {HTMLElement} */ (root.querySelector('#vab-missions-panel'));
  const engineerPanel = /** @type {HTMLElement} */ (root.querySelector('#vab-engineer-panel'));

  // ── "View Accepted Missions" toggle ──────────────────────────────────────
  root.querySelector('#vab-btn-missions')?.addEventListener('click', () => {
    const willOpen = missionsPanel.hasAttribute('hidden');
    engineerPanel?.setAttribute('hidden', '');
    if (willOpen) missionsPanel.removeAttribute('hidden');
    else          missionsPanel.setAttribute('hidden', '');
  });

  root.querySelector('#vab-missions-close')?.addEventListener('click', () => {
    missionsPanel?.setAttribute('hidden', '');
  });

  // ── "Rocket Engineer" toggle ─────────────────────────────────────────────
  root.querySelector('#vab-btn-engineer')?.addEventListener('click', () => {
    const willOpen = engineerPanel.hasAttribute('hidden');
    missionsPanel?.setAttribute('hidden', '');
    if (willOpen) engineerPanel.removeAttribute('hidden');
    else          engineerPanel.setAttribute('hidden', '');
  });

  root.querySelector('#vab-engineer-close')?.addEventListener('click', () => {
    engineerPanel?.setAttribute('hidden', '');
  });

  // ── Launch (disabled; wired in later flight tasks) ───────────────────────
  root.querySelector('#vab-btn-launch')?.addEventListener('click', () => {
    console.log('[VAB] Launch requested — not yet implemented');
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the VAB HTML overlay.
 *
 * @param {HTMLElement} container  The #ui-overlay div from index.html.
 * @param {import('../core/gameState.js').GameState} state
 */
export function initVabUI(container, state) {
  // Inject styles once.
  if (!document.getElementById('vab-css')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'vab-css';
    styleEl.textContent = VAB_CSS;
    document.head.appendChild(styleEl);
  }

  // ── Root DOM ──────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'vab-root';
  root.innerHTML = `
    <!-- ── Toolbar ────────────────────────────────────────────────────── -->
    <div id="vab-toolbar">
      <div class="vab-cash-block">
        <span class="vab-cash-label">Cash</span>
        <span class="vab-cash-value" id="vab-cash">${fmt$(state.money)}</span>
      </div>
      <div class="vab-toolbar-btns">
        <button class="vab-btn" id="vab-btn-missions" type="button">
          View Accepted Missions
        </button>
        <button class="vab-btn" id="vab-btn-engineer" type="button">
          Rocket Engineer
        </button>
        <button class="vab-btn vab-btn-launch" id="vab-btn-launch" type="button" disabled>
          Launch
        </button>
      </div>
    </div>

    <!-- ── Main row ───────────────────────────────────────────────────── -->
    <div id="vab-main">

      <!-- Scale bar (left) -->
      <div id="vab-scale-bar">
        <div class="vab-scale-ticks" id="vab-scale-ticks"></div>
      </div>

      <!-- Build canvas (transparent — PixiJS renders grid beneath) -->
      <div id="vab-canvas-area"></div>

      <!-- Parts panel (right) -->
      <div id="vab-parts-panel">
        <div class="vab-parts-title">Parts</div>
        <div class="vab-parts-list" id="vab-parts-list">
          ${_buildPartsHTML(state)}
        </div>
      </div>

      <!-- Accepted Missions side panel -->
      <div class="vab-side-panel" id="vab-missions-panel" hidden>
        <div class="vab-side-hdr">
          <span>Accepted Missions</span>
          <button class="vab-side-close" id="vab-missions-close" type="button">&#x2715;</button>
        </div>
        <div class="vab-side-body" id="vab-missions-body">
          ${_buildMissionsHTML(state)}
        </div>
      </div>

      <!-- Rocket Engineer side panel (stub — full logic in TASK-019) -->
      <div class="vab-side-panel" id="vab-engineer-panel" hidden>
        <div class="vab-side-hdr">
          <span>Rocket Engineer</span>
          <button class="vab-side-close" id="vab-engineer-close" type="button">&#x2715;</button>
        </div>
        <div class="vab-side-body">
          <p class="vab-side-empty">
            Place parts on the build canvas<br>to validate your rocket.
          </p>
          <div id="vab-validation-results"></div>
        </div>
      </div>

    </div>
  `;
  container.appendChild(root);

  // ── Scale bar ─────────────────────────────────────────────────────────────
  _scaleTicks = root.querySelector('#vab-scale-ticks');
  const canvasArea = /** @type {HTMLElement} */ (root.querySelector('#vab-canvas-area'));

  // Keep _buildAreaHeight up to date and redraw ticks on layout changes.
  const ro = new ResizeObserver(() => {
    _buildAreaHeight = canvasArea.offsetHeight;
    _drawScaleTicks();
  });
  ro.observe(canvasArea);

  // Initial draw using an estimated height before the observer fires.
  _buildAreaHeight = Math.max(1, window.innerHeight - VAB_TOOLBAR_HEIGHT);
  _drawScaleTicks();

  // ── Canvas panning & zooming ───────────────────────────────────────────────
  _setupPan(canvasArea);

  // ── Toolbar buttons ────────────────────────────────────────────────────────
  _bindButtons(root);

  console.log('[VAB UI] Initialized');
}

/**
 * Update the cash readout in the toolbar.
 * @param {import('../core/gameState.js').GameState} state
 */
export function vabUpdateCash(state) {
  const el = document.getElementById('vab-cash');
  if (el) el.textContent = fmt$(state.money);
}

/**
 * Refresh the parts list from an updated game state (e.g. after a mission
 * unlock grants new parts).
 * @param {import('../core/gameState.js').GameState} state
 */
export function vabRefreshParts(state) {
  const el = document.getElementById('vab-parts-list');
  if (el) el.innerHTML = _buildPartsHTML(state);
}

/**
 * Refresh the accepted-missions side panel from an updated game state.
 * @param {import('../core/gameState.js').GameState} state
 */
export function vabRefreshMissions(state) {
  const el = document.getElementById('vab-missions-body');
  if (el) el.innerHTML = _buildMissionsHTML(state);
}

/**
 * Enable or disable the Launch button.
 * @param {boolean} valid  True when rocket validation passes.
 */
export function vabSetLaunchEnabled(valid) {
  const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('vab-btn-launch'));
  if (btn) btn.disabled = !valid;
}

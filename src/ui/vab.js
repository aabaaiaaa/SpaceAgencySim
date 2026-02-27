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

import { PARTS, getPartById } from '../data/parts.js';
import { PartType } from '../core/constants.js';
import {
  VAB_TOOLBAR_HEIGHT,
  VAB_PARTS_PANEL_WIDTH,
  VAB_SCALE_BAR_WIDTH,
  VAB_PIXELS_PER_METRE,
  vabPanCamera,
  vabSetZoom,
  vabGetCamera,
  vabScreenToWorld,
  vabSetAssembly,
  vabRenderParts,
  vabSetDragGhost,
  vabMoveDragGhost,
  vabClearDragGhost,
  vabShowSnapHighlights,
  vabClearSnapHighlights,
} from '../render/vab.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  removePartFromAssembly,
  movePlacedPart,
  connectParts,
  disconnectPart,
  findSnapCandidates,
  createStagingConfig,
  syncStagingWithAssembly,
  addStageToConfig,
  removeStageFromConfig,
  assignPartToStage,
  movePartBetweenStages,
  returnPartToUnstaged,
  validateStagingConfig,
  fireStagingStep,
} from '../core/rocketbuilder.js';

// ---------------------------------------------------------------------------
// Module-level state (VAB session)
// ---------------------------------------------------------------------------

/** The live rocket assembly being edited. @type {import('../core/rocketbuilder.js').RocketAssembly | null} */
let _assembly = null;

/** Reference to game state for cost refunds and cash updates. @type {import('../core/gameState.js').GameState | null} */
let _gameState = null;

/**
 * Active drag operation, or null when nothing is being dragged.
 * @type {{
 *   partId:     string,
 *   instanceId: string | null,  // null = dragging a new part from the panel
 * } | null}
 */
let _dragState = null;

/** Context-menu DOM element (created once, re-used). @type {HTMLElement | null} */
let _ctxMenu = null;

/** Staging configuration for the current VAB session. @type {import('../core/rocketbuilder.js').StagingConfig | null} */
let _stagingConfig = null;

/** True while a flight is in progress — enables Spacebar staging. */
let _flightActive = false;

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

/* ── Staging panel ───────────────────────────────────────────────────── */
.vab-staging-body {
  padding: 0;
  overflow-y: auto;
}

.vab-staging-section {
  padding: 10px 12px 8px;
  border-bottom: 1px solid #0e1e30;
}

.vab-staging-section-hdr {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .12em;
  color: #2e5878;
  margin-bottom: 6px;
}

.vab-staging-stage {
  padding: 8px 12px 6px;
  border-bottom: 1px solid #0a1826;
}

.vab-staging-stage-first {
  background: rgba(0, 12, 6, 0.35);
}

.vab-staging-stage-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  color: #5a8aaa;
  margin-bottom: 6px;
  padding: 2px 0;
}

.vab-staging-stage-first .vab-staging-stage-hdr {
  color: #42cc74;
}

.vab-staging-stage-current .vab-staging-stage-hdr {
  color: #e8b840;
}

.vab-staging-del {
  background: none;
  border: none;
  color: #2a4060;
  cursor: pointer;
  font-size: 11px;
  padding: 0 3px;
  font-family: inherit;
  line-height: 1;
}
.vab-staging-del:hover { color: #d06060; }

.vab-staging-zone {
  min-height: 32px;
  background: rgba(4, 10, 26, 0.6);
  border: 1px dashed #162c48;
  border-radius: 2px;
  padding: 5px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: flex-start;
  align-content: flex-start;
  transition: border-color .1s, background .1s;
  margin-bottom: 2px;
}

.vab-staging-zone.drag-over {
  border-color: #4890e0;
  background: rgba(16, 44, 100, 0.65);
}

.vab-staging-zone-empty {
  font-size: 9px;
  color: #1e3a54;
  text-align: center;
  line-height: 1.5;
  padding: 2px 0;
  width: 100%;
}

.vab-stage-chip {
  background: rgba(14, 36, 72, 0.9);
  border: 1px solid #1e3e68;
  border-radius: 2px;
  padding: 3px 8px;
  font-size: 10px;
  color: #88b8d8;
  cursor: grab;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  user-select: none;
  line-height: 1.4;
}
.vab-stage-chip:hover {
  border-color: #3870b8;
  color: #b8d8f0;
}
.vab-stage-chip:active { cursor: grabbing; }
.vab-stage-chip.dragging { opacity: 0.35; }

.vab-staging-controls {
  padding: 10px 12px;
  border-bottom: 1px solid #0e1e30;
  display: flex;
  gap: 8px;
}

.vab-staging-warnings {
  padding: 10px 12px;
}

.vab-staging-warn {
  font-size: 10px;
  color: #d0a030;
  background: rgba(48, 24, 0, 0.45);
  border: 1px solid #583010;
  border-radius: 2px;
  padding: 7px 9px;
  line-height: 1.5;
}

/* ── Context menu ────────────────────────────────────────────────────── */
#vab-ctx-menu {
  position: fixed;
  z-index: 200;
  background: rgba(4, 8, 22, 0.98);
  border: 1px solid #1e3a5c;
  border-radius: 2px;
  padding: 2px 0;
  box-shadow: 2px 4px 18px rgba(0,0,0,.85);
  min-width: 140px;
}
#vab-ctx-menu[hidden] {
  display: none;
}
.vab-ctx-item {
  display: block;
  width: 100%;
  padding: 6px 14px;
  font-size: 11px;
  font-family: 'Courier New', Courier, monospace;
  color: #a8c8e8;
  cursor: pointer;
  background: none;
  border: none;
  text-align: left;
  white-space: nowrap;
  box-sizing: border-box;
}
.vab-ctx-item:hover {
  background: rgba(14, 38, 74, 0.8);
  color: #c8e4ff;
}
.vab-ctx-item-danger {
  color: #e09090;
}
.vab-ctx-item-danger:hover {
  background: rgba(50, 8, 8, 0.8);
  color: #ffb0b0;
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
// Hit-testing helpers
// ---------------------------------------------------------------------------

/**
 * Find the topmost placed part whose bounding rectangle contains worldX/Y.
 * Returns the PlacedPart (with its partId) or null.
 * @param {number} worldX
 * @param {number} worldY
 * @returns {import('../core/rocketbuilder.js').PlacedPart | null}
 */
function _hitTestPlacedPart(worldX, worldY) {
  if (!_assembly) return null;
  // Iterate in reverse insertion order so newer parts are hit first.
  const all = [..._assembly.parts.values()];
  for (let i = all.length - 1; i >= 0; i--) {
    const placed = all[i];
    const def = getPartById(placed.partId);
    if (!def) continue;
    const hw = def.width  / 2;
    const hh = def.height / 2;
    if (
      worldX >= placed.x - hw && worldX <= placed.x + hw &&
      worldY >= placed.y - hh && worldY <= placed.y + hh
    ) {
      return placed;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Drag lifecycle
// ---------------------------------------------------------------------------

/**
 * Begin dragging a part (from panel or by picking up a placed part).
 * Adds global pointermove/pointerup listeners that are cleaned up in _endDrag.
 * @param {string}      partId      Part catalog ID.
 * @param {string|null} instanceId  Existing instance (null = from panel).
 * @param {number}      clientX
 * @param {number}      clientY
 */
function _startDrag(partId, instanceId, clientX, clientY) {
  _dragState = { partId, instanceId };
  vabSetDragGhost(partId, clientX, clientY);
  window.addEventListener('pointermove',  _onDragMove,   { capture: true });
  window.addEventListener('pointerup',    _onDragEnd,    { capture: true });
  window.addEventListener('pointercancel', _cancelDrag,  { capture: true });
}

/**
 * Cancel an in-progress drag (e.g. pointer captured by browser).
 * If the part was picked up (instanceId != null), put it back.
 */
function _cancelDrag() {
  if (!_dragState) return;
  window.removeEventListener('pointermove',  _onDragMove,  { capture: true });
  window.removeEventListener('pointerup',    _onDragEnd,   { capture: true });
  window.removeEventListener('pointercancel', _cancelDrag, { capture: true });

  const { instanceId } = _dragState;
  _dragState = null;
  vabClearDragGhost();
  vabClearSnapHighlights();

  // If a placed part was picked up but not re-dropped, its position was already
  // preserved in the assembly (it was disconnected but not removed). It will
  // remain at its last world position — acceptable fallback.
  if (instanceId !== null) {
    vabRenderParts();
  }
}

/**
 * Global pointermove handler during a drag.
 * @param {PointerEvent} e
 */
function _onDragMove(e) {
  if (!_dragState) return;

  vabMoveDragGhost(e.clientX, e.clientY);

  // Find snap candidates relative to current cursor world position.
  const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
  const { zoom } = vabGetCamera();
  const candidates = findSnapCandidates(
    _assembly, _dragState.partId, worldX, worldY, zoom,
  );

  if (candidates.length > 0) {
    vabShowSnapHighlights(candidates);
  } else {
    vabClearSnapHighlights();
  }
}

/**
 * Global pointerup handler — drop the part.
 * @param {PointerEvent} e
 */
function _onDragEnd(e) {
  if (!_dragState) return;

  window.removeEventListener('pointermove',  _onDragMove,  { capture: true });
  window.removeEventListener('pointerup',    _onDragEnd,   { capture: true });
  window.removeEventListener('pointercancel', _cancelDrag, { capture: true });

  const { partId, instanceId } = _dragState;
  _dragState = null;

  vabClearDragGhost();
  vabClearSnapHighlights();

  // Determine world drop position.
  const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
  const { zoom } = vabGetCamera();

  const candidates = findSnapCandidates(_assembly, partId, worldX, worldY, zoom);
  let finalX = worldX;
  let finalY = worldY;
  let bestCandidate = null;

  if (candidates.length > 0) {
    bestCandidate = candidates[0];
    finalX = bestCandidate.snapWorldX;
    finalY = bestCandidate.snapWorldY;
  }

  if (instanceId !== null) {
    // Re-place an already-placed part at new position.
    movePlacedPart(_assembly, instanceId, finalX, finalY);
    if (bestCandidate) {
      connectParts(
        _assembly,
        instanceId,                 bestCandidate.dragSnapIndex,
        bestCandidate.targetInstanceId, bestCandidate.targetSnapIndex,
      );
    }
  } else {
    // New part from the panel — deduct cost, add to assembly.
    const def = getPartById(partId);
    if (def && _gameState) {
      _gameState.money -= def.cost;
      vabUpdateCash(_gameState);
    }
    const newId = addPartToAssembly(_assembly, partId, finalX, finalY);
    if (bestCandidate) {
      connectParts(
        _assembly,
        newId,                          bestCandidate.dragSnapIndex,
        bestCandidate.targetInstanceId, bestCandidate.targetSnapIndex,
      );
    }
    // Sync staging — new activatable part may need to appear in unstaged pool.
    _syncAndRenderStaging();
  }

  vabRenderParts();
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

/**
 * Initialise the right-click context menu DOM element (created once).
 */
function _initContextMenu() {
  _ctxMenu = document.createElement('div');
  _ctxMenu.id = 'vab-ctx-menu';
  _ctxMenu.setAttribute('hidden', '');
  document.body.appendChild(_ctxMenu);

  // Clicking anywhere outside the menu dismisses it.
  document.addEventListener('pointerdown', (e) => {
    if (_ctxMenu && !_ctxMenu.contains(e.target)) {
      _ctxMenu.setAttribute('hidden', '');
    }
  }, { capture: true });
}

/**
 * Show the context menu for a placed part.
 * @param {import('../core/rocketbuilder.js').PlacedPart} placed
 * @param {number} clientX
 * @param {number} clientY
 */
function _showPartContextMenu(placed, clientX, clientY) {
  if (!_ctxMenu) return;

  const def = getPartById(placed.partId);
  const costLabel = def ? ` (+${fmt$(def.cost)})` : '';

  _ctxMenu.innerHTML =
    `<button class="vab-ctx-item vab-ctx-item-danger" id="vab-ctx-remove">` +
      `Remove Part${costLabel}` +
    `</button>`;

  _ctxMenu.style.left = `${clientX}px`;
  _ctxMenu.style.top  = `${clientY}px`;
  _ctxMenu.removeAttribute('hidden');

  _ctxMenu.querySelector('#vab-ctx-remove')?.addEventListener('click', () => {
    _ctxMenu.setAttribute('hidden', '');
    // Refund cost.
    if (def && _gameState) {
      _gameState.money += def.cost;
      vabUpdateCash(_gameState);
    }
    removePartFromAssembly(_assembly, placed.instanceId);
    // Sync staging — removed part must be pruned from its stage/unstaged slot.
    _syncAndRenderStaging();
    vabRenderParts();
  }, { once: true });
}

// ---------------------------------------------------------------------------
// Canvas panning, zooming, part drag & context menu
// ---------------------------------------------------------------------------

/**
 * Attach all pointer interactions to the build-canvas overlay div:
 *   - Left-button drag on empty space → pan camera.
 *   - Left-button drag on a placed part → pick it up.
 *   - Right-click on a placed part → context menu (Remove Part).
 *   - Scroll wheel → zoom.
 * @param {HTMLElement} canvasArea
 */
function _setupCanvas(canvasArea) {
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  canvasArea.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;  // only left-button for drag/pan

    const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
    const hit = _hitTestPlacedPart(worldX, worldY);

    if (hit) {
      // Pick up the placed part: disconnect it from the graph, start dragging.
      disconnectPart(_assembly, hit.instanceId);
      _startDrag(hit.partId, hit.instanceId, e.clientX, e.clientY);
      // Consume event so panning doesn't also start.
      e.stopPropagation();
      return;
    }

    // No hit — start camera pan.
    panning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasArea.setPointerCapture(e.pointerId);
    canvasArea.classList.add('panning');
  });

  canvasArea.addEventListener('pointermove', (e) => {
    if (!panning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    vabPanCamera(dx, dy);
    _drawScaleTicks();
  });

  const _stopPan = () => {
    panning = false;
    canvasArea.classList.remove('panning');
  };
  canvasArea.addEventListener('pointerup',     _stopPan);
  canvasArea.addEventListener('pointercancel', _stopPan);

  // Right-click → context menu for placed parts.
  canvasArea.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
    const hit = _hitTestPlacedPart(worldX, worldY);
    if (hit) {
      _showPartContextMenu(hit, e.clientX, e.clientY);
    }
  });

  // Scroll-wheel zoom.
  canvasArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const { zoom } = vabGetCamera();
    vabSetZoom(zoom * factor);
    _drawScaleTicks();
  }, { passive: false });
}

// ---------------------------------------------------------------------------
// Panel drag (new parts from the parts panel)
// ---------------------------------------------------------------------------

/**
 * Attach pointerdown listeners to the parts panel so clicking a part card
 * initiates a drag.
 * @param {HTMLElement} partsPanel
 */
function _setupPanelDrag(partsPanel) {
  partsPanel.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const card = /** @type {HTMLElement} */ (e.target)?.closest?.('.vab-part-card');
    if (!card) return;
    const partId = card.dataset.partId;
    if (!partId) return;

    e.preventDefault();
    _startDrag(partId, null, e.clientX, e.clientY);
  });
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
  const stagingPanel  = /** @type {HTMLElement} */ (root.querySelector('#vab-staging-panel'));

  /** Close all side panels. */
  const _closeAllPanels = () => {
    missionsPanel?.setAttribute('hidden', '');
    engineerPanel?.setAttribute('hidden', '');
    stagingPanel?.setAttribute('hidden', '');
  };

  // ── "View Accepted Missions" toggle ──────────────────────────────────────
  root.querySelector('#vab-btn-missions')?.addEventListener('click', () => {
    const willOpen = missionsPanel.hasAttribute('hidden');
    _closeAllPanels();
    if (willOpen) missionsPanel.removeAttribute('hidden');
  });

  root.querySelector('#vab-missions-close')?.addEventListener('click', () => {
    missionsPanel?.setAttribute('hidden', '');
  });

  // ── "Rocket Engineer" toggle ─────────────────────────────────────────────
  root.querySelector('#vab-btn-engineer')?.addEventListener('click', () => {
    const willOpen = engineerPanel.hasAttribute('hidden');
    _closeAllPanels();
    if (willOpen) engineerPanel.removeAttribute('hidden');
  });

  root.querySelector('#vab-engineer-close')?.addEventListener('click', () => {
    engineerPanel?.setAttribute('hidden', '');
  });

  // ── "Staging" toggle ─────────────────────────────────────────────────────
  root.querySelector('#vab-btn-staging')?.addEventListener('click', () => {
    const willOpen = stagingPanel.hasAttribute('hidden');
    _closeAllPanels();
    if (willOpen) {
      stagingPanel.removeAttribute('hidden');
      _renderStagingPanel(); // Refresh on open so it reflects latest assembly state.
    }
  });

  root.querySelector('#vab-staging-close')?.addEventListener('click', () => {
    stagingPanel?.setAttribute('hidden', '');
  });

  // ── Launch (disabled; wired in later flight tasks) ───────────────────────
  root.querySelector('#vab-btn-launch')?.addEventListener('click', () => {
    console.log('[VAB] Launch requested — not yet implemented');
  });
}

// ---------------------------------------------------------------------------
// Staging panel
// ---------------------------------------------------------------------------

/**
 * Sync staging config with the current assembly and re-render the staging panel.
 * Call after any part add or remove operation.
 */
function _syncAndRenderStaging() {
  if (_assembly && _stagingConfig) {
    syncStagingWithAssembly(_assembly, _stagingConfig);
    _renderStagingPanel();
  }
}

/**
 * Build and inject the staging panel's inner HTML from the current
 * `_stagingConfig` and `_assembly` state.
 */
function _renderStagingPanel() {
  const body = /** @type {HTMLElement|null} */ (document.getElementById('vab-staging-body'));
  if (!body) return;

  if (!_stagingConfig || !_assembly) {
    body.innerHTML = '<p class="vab-side-empty">No rocket assembly loaded.</p>';
    return;
  }

  const warnings  = validateStagingConfig(_assembly, _stagingConfig);
  const numStages = _stagingConfig.stages.length;
  const html      = [];

  // ── Unstaged parts ────────────────────────────────────────────────────────
  html.push('<div class="vab-staging-section">');
  html.push('<div class="vab-staging-section-hdr">Unstaged Parts</div>');
  html.push('<div class="vab-staging-zone" data-drop-zone="unstaged">');
  if (_stagingConfig.unstaged.length === 0) {
    html.push('<div class="vab-staging-zone-empty">All activatable parts staged.</div>');
  } else {
    for (const id of _stagingConfig.unstaged) {
      const placed = _assembly.parts.get(id);
      const def    = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      html.push(
        `<div class="vab-stage-chip" draggable="true" ` +
        `data-instance-id="${id}" data-source="unstaged" ` +
        `title="${def.name}">${def.name}</div>`,
      );
    }
  }
  html.push('</div>');  // zone
  html.push('</div>');  // section

  // ── Stages (highest number at top, Stage 1 at bottom) ────────────────────
  for (let i = numStages - 1; i >= 0; i--) {
    const stageNum = i + 1;
    const stage    = _stagingConfig.stages[i];
    const isEmpty  = stage.instanceIds.length === 0;
    const isFirst  = i === 0;
    const isCurrent = i === _stagingConfig.currentStageIdx;

    const stageClasses = [
      'vab-staging-stage',
      isFirst   ? 'vab-staging-stage-first'   : '',
      isCurrent ? 'vab-staging-stage-current' : '',
    ].filter(Boolean).join(' ');

    html.push(`<div class="${stageClasses}">`);

    // Stage header.
    html.push('<div class="vab-staging-stage-hdr">');
    const label = isFirst
      ? `Stage ${stageNum} \u2014 FIRES FIRST`
      : `Stage ${stageNum}`;
    html.push(`<span>${label}</span>`);
    // Delete button: only for empty stages when there's more than one stage.
    if (isEmpty && numStages > 1) {
      html.push(
        `<button class="vab-staging-del" data-stage-index="${i}" ` +
        `type="button" title="Remove empty stage">&#x2715;</button>`,
      );
    }
    html.push('</div>');  // stage-hdr

    // Parts drop zone.
    html.push(`<div class="vab-staging-zone" data-drop-zone="stage-${i}">`);
    if (isEmpty) {
      html.push('<div class="vab-staging-zone-empty">Drop parts here</div>');
    } else {
      for (const id of stage.instanceIds) {
        const placed = _assembly.parts.get(id);
        const def    = placed ? getPartById(placed.partId) : null;
        if (!def) continue;
        html.push(
          `<div class="vab-stage-chip" draggable="true" ` +
          `data-instance-id="${id}" data-source="stage-${i}" ` +
          `title="${def.name}">${def.name}</div>`,
        );
      }
    }
    html.push('</div>');  // zone
    html.push('</div>');  // stage
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  html.push('<div class="vab-staging-controls">');
  html.push(
    '<button class="vab-btn" id="vab-staging-add" type="button">' +
    '+ Add Stage</button>',
  );
  html.push('</div>');

  // ── Validation warnings ───────────────────────────────────────────────────
  if (warnings.length > 0) {
    html.push('<div class="vab-staging-warnings">');
    for (const w of warnings) {
      html.push(`<div class="vab-staging-warn">\u26a0 ${w}</div>`);
    }
    html.push('</div>');
  }

  body.innerHTML = html.join('');

  // Re-attach button listeners (replaced by innerHTML).
  body.querySelector('#vab-staging-add')?.addEventListener('click', () => {
    addStageToConfig(_stagingConfig);
    _renderStagingPanel();
  });
  body.querySelectorAll('.vab-staging-del').forEach((btn) => {
    const el = /** @type {HTMLElement} */ (btn);
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.stageIndex ?? '0', 10);
      removeStageFromConfig(_stagingConfig, idx);
      _renderStagingPanel();
    });
  });
}

/**
 * Set up HTML5 drag-and-drop event delegation on the staging panel body.
 * Uses event delegation — call once; survives innerHTML re-renders.
 * @param {HTMLElement} panelBody
 */
function _setupStagingDnD(panelBody) {
  // dragstart: fired on chip elements.
  panelBody.addEventListener('dragstart', (e) => {
    const chip = /** @type {HTMLElement} */ (
      /** @type {Element} */ (e.target).closest?.('.vab-stage-chip')
    );
    if (!chip) return;
    const instanceId = chip.dataset.instanceId ?? '';
    const source     = chip.dataset.source     ?? '';
    e.dataTransfer.setData('text/plain', `${instanceId}|${source}`);
    e.dataTransfer.effectAllowed = 'move';
    chip.classList.add('dragging');
  });

  // dragend: clean up dragging class.
  panelBody.addEventListener('dragend', (e) => {
    const chip = /** @type {Element} */ (e.target).closest?.('.vab-stage-chip');
    if (chip) chip.classList.remove('dragging');
    panelBody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  });

  // dragover: highlight the target zone.
  panelBody.addEventListener('dragover', (e) => {
    const zone = /** @type {Element} */ (e.target).closest?.('.vab-staging-zone');
    if (!zone) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('drag-over');
  });

  // dragleave: remove highlight only when truly leaving the zone.
  panelBody.addEventListener('dragleave', (e) => {
    const zone = /** @type {Element} */ (e.target).closest?.('.vab-staging-zone');
    if (!zone) return;
    if (!zone.contains(/** @type {Node} */ (e.relatedTarget))) {
      zone.classList.remove('drag-over');
    }
  });

  // drop: update staging config and re-render.
  panelBody.addEventListener('drop', (e) => {
    const zone = /** @type {HTMLElement} */ (
      /** @type {Element} */ (e.target).closest?.('.vab-staging-zone')
    );
    if (!zone || !_stagingConfig) return;
    e.preventDefault();
    zone.classList.remove('drag-over');

    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;

    const pipeIdx    = raw.indexOf('|');
    const instanceId = raw.slice(0, pipeIdx);
    const source     = raw.slice(pipeIdx + 1);
    const target     = zone.dataset.dropZone ?? '';

    if (target === source) return;   // Same zone — no-op.

    if (target === 'unstaged') {
      returnPartToUnstaged(_stagingConfig, instanceId);
    } else if (target.startsWith('stage-')) {
      const toIdx = parseInt(target.slice(6), 10);
      if (source === 'unstaged') {
        assignPartToStage(_stagingConfig, instanceId, toIdx);
      } else if (source.startsWith('stage-')) {
        const fromIdx = parseInt(source.slice(6), 10);
        movePartBetweenStages(_stagingConfig, instanceId, fromIdx, toIdx);
      }
    }

    _renderStagingPanel();
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
        <button class="vab-btn" id="vab-btn-staging" type="button">
          Staging
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

      <!-- Staging side panel -->
      <div class="vab-side-panel" id="vab-staging-panel" hidden>
        <div class="vab-side-hdr">
          <span>Staging</span>
          <button class="vab-side-close" id="vab-staging-close" type="button">&#x2715;</button>
        </div>
        <div class="vab-side-body vab-staging-body" id="vab-staging-body"></div>
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

  // ── Rocket assembly (part graph) ──────────────────────────────────────────
  _assembly  = createRocketAssembly();
  _gameState = state;
  vabSetAssembly(_assembly);

  // ── Staging configuration ──────────────────────────────────────────────────
  _stagingConfig = createStagingConfig();
  const stagingBody = /** @type {HTMLElement} */ (root.querySelector('#vab-staging-body'));
  if (stagingBody) {
    _setupStagingDnD(stagingBody);  // Set up DnD once (event delegation survives re-renders).
    _renderStagingPanel();          // Initial render (empty assembly — shows one empty stage).
  }

  // ── Spacebar: fire next stage during flight ────────────────────────────────
  // _flightActive is set to true by the flight system (implemented in a later task).
  // When active, each Spacebar press fires the current stage and advances to the next.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || !_flightActive || !_stagingConfig) return;
    e.preventDefault();
    const result = fireStagingStep(_stagingConfig);
    console.log(
      `[Flight] Stage ${result.firedStageIndex + 1} fired. ` +
      `Parts activated: [${result.instanceIds.join(', ')}]. ` +
      (result.nextStageIndex !== null
        ? `Next: Stage ${result.nextStageIndex + 1}`
        : 'All stages spent.'),
    );
    _renderStagingPanel();   // Update current-stage highlight.
  });

  // ── Canvas interactions (pan / pick-up placed parts / right-click) ─────────
  _setupCanvas(canvasArea);

  // ── Panel drag (new parts → canvas) ───────────────────────────────────────
  const partsPanel = /** @type {HTMLElement} */ (root.querySelector('#vab-parts-panel'));
  _setupPanelDrag(partsPanel);

  // ── Context menu ───────────────────────────────────────────────────────────
  _initContextMenu();

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

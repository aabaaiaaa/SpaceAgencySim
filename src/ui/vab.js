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
import { runValidation, getTotalMass, getRocketBounds } from '../core/rocketvalidator.js';
import { getActiveCrew } from '../core/crew.js';
import {
  VAB_TOOLBAR_HEIGHT,
  VAB_PARTS_PANEL_WIDTH,
  VAB_SCALE_BAR_WIDTH,
  VAB_PIXELS_PER_METRE,
  vabPanCamera,
  vabSetZoom,
  vabSetZoomCentred,
  vabGetCamera,
  vabScreenToWorld,
  vabSetAssembly,
  vabRenderParts,
  vabSetDragGhost,
  vabMoveDragGhost,
  vabClearDragGhost,
  vabShowSnapHighlights,
  vabClearSnapHighlights,
  vabSetMirrorGhost,
  vabClearMirrorGhost,
  vabZoomToFit,
  vabSetSelectedLegAnimation,
  vabClearSelectedLegAnimation,
} from '../render/vab.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  removePartFromAssembly,
  movePlacedPart,
  connectParts,
  disconnectPart,
  findSnapCandidates,
  findMirrorCandidate,
  addSymmetryPair,
  getMirrorPartId,
  createStagingConfig,
  syncStagingWithAssembly,
  addStageToConfig,
  removeStageFromConfig,
  assignPartToStage,
  movePartBetweenStages,
  returnPartToUnstaged,
  validateStagingConfig,
  fireStagingStep,
  autoStageNewPart,
  moveStage,
} from '../core/rocketbuilder.js';
import { createRocketDesign, saveDesign, deleteDesign } from '../core/gameState.js';
import {
  getAllDesigns,
  saveDesignToLibrary,
  deleteDesignFromLibrary,
  duplicateDesign,
  calculateCostBreakdown,
  checkDesignCompatibility,
  groupDesigns,
  getDesignGroupDefs,
  filterDesignsByGroup,
} from '../core/designLibrary.js';
import { airDensity, SEA_LEVEL_DENSITY } from '../core/atmosphere.js';
import { startFlightScene } from './flightController.js';
import { showReturnResultsOverlay } from './hub.js';
import { refreshTopBar } from './topbar.js';
import { buildRocketCard, injectRocketCardCSS } from './rocketCardUtil.js';
import {
  getInventoryCount,
  getInventoryForPart,
  useInventoryPart,
  addToInventory,
  refurbishPart,
  scrapPart,
  getEffectiveReliability,
} from '../core/partInventory.js';

// ---------------------------------------------------------------------------
// Module-level state (VAB session)
// ---------------------------------------------------------------------------

/** The live rocket assembly being edited. @type {import('../core/rocketbuilder.js').RocketAssembly | null} */
let _assembly = null;

/** Reference to game state for cost refunds and cash updates. @type {import('../core/gameState.js').GameState | null} */
let _gameState = null;

/** The #ui-overlay container stored so _doLaunch can pass it to the flight scene. @type {HTMLElement | null} */
let _container = null;

/**
 * Active drag operation, or null when nothing is being dragged.
 * @type {{
 *   partId:      string,
 *   instanceId:  string | null,  // null = dragging a new part from the panel
 *   startX:      number,
 *   startY:      number,
 *   hasMoved:    boolean,
 * } | null}
 */
let _dragState = null;

/** Context-menu DOM element (created once, re-used). @type {HTMLElement | null} */
let _ctxMenu = null;

/** Staging configuration for the current VAB session. @type {import('../core/rocketbuilder.js').StagingConfig | null} */
let _stagingConfig = null;

/** Altitude (metres) for VAB delta-v calculation. */
let _dvAltitude = 0;

/** True while a flight is in progress — enables Spacebar staging. */
let _flightActive = false;

/** Result of the last validation run, or null before the first run. @type {import('../core/rocketvalidator.js').ValidationResult | null} */
let _lastValidation = null;

/** Optional callback invoked when the player clicks "← Hub". @type {(() => void) | null} */
let _onBack = null;

/** Whether auto-zoom-to-fit is enabled. */
let _autoZoomEnabled = true;

/**
 * Whether radial symmetry is active.  When true, placing a part onto a
 * left/right snap point will also place a mirror copy on the opposite side
 * of the same parent (if that socket is free and compatible).
 * Defaults to true — the most common workflow for SRBs, legs, etc.
 */
let _symmetryMode = true;

/** Currently selected placed part instance ID (for delete + hover detail). @type {string | null} */
let _selectedInstanceId = null;

/** ID of the design currently loaded from savedDesigns, for overwrite on re-save. @type {string | null} */
let _currentDesignId = null;

/** Name of the last-saved design, for pre-filling the save prompt. @type {string} */
let _currentDesignName = '';

/** Set of currently open panel IDs (missions | staging | engineer | inventory). @type {Set<string>} */
const _openPanels = new Set();

/**
 * Tracks placed parts that came from inventory (not bought new).
 * Maps instanceId → InventoryPart entry (with wear, flights, etc.).
 * When a part from inventory is deleted, it's returned to inventory
 * instead of refunding cash.
 * @type {Map<string, import('../core/gameState.js').InventoryPart>}
 */
const _inventoryUsedParts = new Map();

/** The #vab-canvas-area element (stored for panel offset calculations). @type {HTMLElement | null} */
let _canvasArea = null;

/** Pending canvas pickup (pointer down on part but hasn't moved yet). @type {{ hit: any, startX: number, startY: number } | null} */
let _pendingPickup = null;

/** The panel width for each side panel. */
const SIDE_PANEL_WIDTH = 300;

// ---------------------------------------------------------------------------
// VAB ↔ gameState serialisation (persist assembly across save/load)
// ---------------------------------------------------------------------------

/**
 * Serialise the current VAB assembly and staging config onto `_gameState` so
 * that the next save call captures them.  No-op when there is no
 * active assembly or gameState reference.
 *
 * The `parts` Map is converted to a plain Array so `JSON.stringify` works.
 */
export function syncVabToGameState() {
  if (!_assembly || !_gameState) return;
  _gameState.vabAssembly = {
    parts:         [..._assembly.parts.values()],
    connections:   _assembly.connections,
    symmetryPairs: _assembly.symmetryPairs,
    _nextId:       _assembly._nextId,
  };
  _gameState.vabStagingConfig = _stagingConfig;
}

/**
 * If the supplied game state carries a serialised VAB assembly, restore it
 * into the module-level `_assembly` and `_stagingConfig` variables so the
 * VAB opens with the player's previous work.
 *
 * @param {import('../core/gameState.js').GameState} state
 */
function _restoreVabFromGameState(state) {
  const saved = state.vabAssembly;
  if (!saved || !Array.isArray(saved.parts) || saved.parts.length === 0) return;

  _assembly = {
    parts:         new Map(saved.parts.map(p => [p.instanceId, p])),
    connections:   saved.connections   ?? [],
    symmetryPairs: saved.symmetryPairs ?? [],
    _nextId:       saved._nextId       ?? 1,
  };

  if (state.vabStagingConfig) {
    _stagingConfig = state.vabStagingConfig;
  }

  // Reconcile staging with the restored part set.
  if (_assembly && _stagingConfig) {
    syncStagingWithAssembly(_assembly, _stagingConfig);
  }
}

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
  top: 44px; /* leave room for the global top bar (src/ui/topbar.js) */
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  pointer-events: none;
  font-family: system-ui, sans-serif;
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
  justify-content: flex-start;
  padding: 0 14px;
  background: rgba(4, 8, 20, 0.97);
  border-bottom: 1px solid #162c48;
  pointer-events: auto;
  flex-shrink: 0;
  z-index: 20;
  gap: 12px;
}

/* Toolbar stats (parts count + cost) — pushed right via spacer */
.vab-toolbar-spacer { flex: 1; }
.vab-toolbar-stat {
  font-size: 0.85rem;
  font-weight: 600;
  color: #8ab8d8;
  white-space: nowrap;
}
.vab-zoom-slider {
  width: 100px;
  cursor: pointer;
  accent-color: #2080c0;
}
.vab-toolbar-cost {
  font-size: 0.92rem;
  font-weight: 600;
  color: #5ddb50;
  letter-spacing: 0.02em;
}

.vab-toolbar-btns {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: 1;
}

#vab-btn-launch {
  margin-left: auto;
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

/* ── Symmetry toggle button ──────────────────────────────────────────── */
.vab-btn-symmetry {
  background: rgba(12, 26, 54, 0.92);
  border: 1px solid #1e3b60;
  color: #5a88a8;
  padding: 5px 10px;
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  border-radius: 2px;
  transition: background .1s, border-color .1s, color .1s;
  white-space: nowrap;
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 5px;
}
.vab-btn-symmetry[aria-pressed="true"] {
  background: rgba(8, 38, 60, 0.95);
  border-color: #2a6090;
  color: #60c0e8;
}
.vab-btn-symmetry:hover {
  background: rgba(16, 38, 72, 0.95);
  border-color: #3060a0;
  color: #88c8e8;
}
.vab-btn-symmetry-icon {
  font-size: 13px;
  line-height: 1;
}

/* ── Clear All button ─────────────────────────────────────────────── */
.vab-btn-clear-all {
  background: rgba(54, 12, 12, 0.92);
  border-color: #501818;
  color: #a06060;
}
.vab-btn-clear-all:hover {
  background: rgba(80, 20, 20, 0.95);
  border-color: #703030;
  color: #e08080;
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
  width: 8px;
  background: #1e3850;
}
.vab-tick-major::after {
  content: '';
  position: absolute;
  right: 0;
  height: 1px;
  width: 14px;
  background: #2a4e6e;
}

.vab-tick-label {
  position: absolute;
  right: 18px;
  font-size: 10px;
  color: #4a7a9a;
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

/* ── Inventory badge on part cards ──────────────────────────────────── */
.vab-inv-badge {
  display: inline-block;
  margin-left: 4px;
  padding: 0 4px;
  font-size: 9px;
  font-weight: 700;
  color: #50c860;
  background: rgba(40, 100, 50, 0.35);
  border-radius: 7px;
  line-height: 1.5;
  vertical-align: middle;
}
.vab-part-cost-free {
  color: #50c860;
  font-weight: 700;
}
.vab-part-cost-orig {
  text-decoration: line-through;
  color: #365474;
  margin-left: 3px;
  font-size: 8px;
}

/* ── Inventory panel ────────────────────────────────────────────────── */
.vab-inv-body {
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #152a44 transparent;
}
.vab-inv-empty {
  padding: 28px 16px;
  font-size: 10px;
  color: #224060;
  text-align: center;
  line-height: 1.75;
}
.vab-inv-group-hdr {
  padding: 8px 12px 3px;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .1em;
  color: #3a6848;
  border-bottom: 1px solid #0e1e30;
}
.vab-inv-item {
  padding: 5px 10px;
  border-bottom: 1px solid rgba(14, 30, 48, 0.5);
  transition: background .08s;
}
.vab-inv-item:hover {
  background: rgba(14, 38, 74, 0.35);
}
.vab-inv-item-info {
  display: flex;
  gap: 8px;
  font-size: 10px;
  margin-bottom: 4px;
}
.vab-inv-wear { font-weight: 700; }
.vab-inv-flights { color: #4a6a8a; }
.vab-inv-rel { color: #6080a0; }
.vab-inv-item-actions {
  display: flex;
  gap: 4px;
}
.vab-inv-btn {
  background: rgba(12, 26, 54, 0.92);
  border: 1px solid #1e3b60;
  color: #84aece;
  padding: 2px 8px;
  font-family: inherit;
  font-size: 9px;
  cursor: pointer;
  border-radius: 2px;
  transition: background .1s, border-color .1s;
}
.vab-inv-btn:hover {
  background: rgba(22, 52, 90, 0.95);
  border-color: #3470a8;
  color: #c8e4ff;
}
.vab-inv-btn-refurb {
  border-color: #2a5040;
  color: #50a870;
}
.vab-inv-btn-refurb:hover {
  background: rgba(22, 60, 40, 0.95);
  border-color: #40806a;
  color: #80d0a0;
}
.vab-inv-btn-scrap {
  border-color: #504020;
  color: #a08040;
}
.vab-inv-btn-scrap:hover {
  background: rgba(60, 40, 10, 0.95);
  border-color: #806830;
  color: #c0a060;
}

/* ── Inventory detail in part detail panel ──────────────────────────── */
.vab-detail-inv {
  padding: 4px 0;
  margin-bottom: 4px;
  border-radius: 3px;
}
.vab-detail-inv-count {
  display: block;
  font-size: 10px;
  font-weight: 700;
  color: #50c860;
}
.vab-detail-inv-wear {
  display: block;
  font-size: 9px;
  color: #6a9a7a;
  margin-top: 1px;
}

/* ── Part detail panel (bottom of parts list) ────────────────────────── */
#vab-part-detail {
  flex-shrink: 0;
  border-top: 1px solid #0e1e30;
  background: rgba(2, 4, 14, 0.98);
  padding: 10px 12px;
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #152a44 transparent;
}
#vab-part-detail[hidden] { display: none; }
.vab-detail-name {
  font-size: 12px;
  font-weight: 700;
  color: #a8c8e8;
  margin-bottom: 3px;
}
.vab-detail-type {
  font-size: 9px;
  color: #3a6080;
  text-transform: uppercase;
  letter-spacing: .1em;
  margin-bottom: 7px;
}
.vab-detail-desc {
  font-size: 11px;
  color: #608890;
  line-height: 1.6;
  margin-bottom: 8px;
}
.vab-detail-stats {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.vab-detail-stat {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
}
.vab-detail-stat-label { color: #3a6080; }
.vab-detail-stat-value { color: #7ab0d0; font-weight: 700; }

/* ── Part selection highlight on canvas ──────────────────────────────── */
#vab-selection-highlight {
  position: absolute;
  pointer-events: none;
  border: 2px solid #60d0ff;
  box-shadow: 0 0 8px rgba(96,208,255,0.4);
  border-radius: 1px;
  z-index: 30;
}
#vab-selection-highlight[hidden] { display: none; }

/* ── Off-screen part indicator arrows ────────────────────────────────── */
.vab-offscreen-indicator {
  position: absolute;
  pointer-events: auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 60, 100, 0.85);
  border: 1px solid #2a6090;
  border-radius: 3px;
  font-size: 11px;
  color: #80c0e8;
  cursor: default;
  z-index: 50;
  transition: background .1s;
}
.vab-offscreen-indicator:hover {
  background: rgba(30, 80, 130, 0.95);
}

/* (status bar content now lives inside the toolbar) */

/* ── Side panels — stackable ─────────────────────────────────────────── */
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
  gap: 4px;
}

.vab-stage-drag-handle {
  cursor: grab;
  font-size: 12px;
  color: #406a80;
  user-select: none;
  padding: 0 2px;
  line-height: 1;
}

.vab-stage-drag-handle:hover {
  color: #80c0e0;
}

.vab-staging-stage.dragging {
  opacity: 0.5;
  border-style: dashed;
}

.vab-staging-stage.drag-over {
  border-color: #40a0d0;
  background: rgba(30, 80, 120, 0.15);
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

/* ── Delta-V display ────────────────────────────────────────────────── */
.vab-staging-dv {
  padding: 8px 12px;
  border-bottom: 1px solid #0e1e30;
}

.vab-staging-dv-total {
  font-size: 11px;
  font-weight: 700;
  color: #60e0a0;
  margin-bottom: 6px;
}

.vab-stage-stats {
  display: flex;
  gap: 10px;
  font-size: 9px;
  margin-top: 2px;
}

.vab-stage-dv {
  color: #50c8a0;
}

.vab-stage-twr {
  color: #88b8d8;
}

.vab-stage-twr.warn {
  color: #d0a030;
}

.vab-dv-altitude {
  padding: 8px 12px 6px;
  border-bottom: 1px solid #0e1e30;
}

.vab-dv-altitude-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 9px;
  color: #5a8aaa;
}

.vab-dv-altitude input[type="range"] {
  flex: 1;
  accent-color: #3080b0;
  height: 14px;
}

.vab-dv-altitude-info {
  display: flex;
  justify-content: space-between;
  font-size: 8px;
  color: #6a98b8;
  font-variant-numeric: tabular-nums;
  margin-top: 3px;
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
  font-family: system-ui, sans-serif;
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

/* ── Rocket Engineer validation panel ───────────────────────────────── */
.vab-val-stats {
  padding: 10px 12px 8px;
  border-bottom: 1px solid #0e1e30;
}

.vab-val-stat-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: 10px;
  padding: 3px 0;
}

.vab-val-stat-label { color: #3a6080; }
.vab-val-stat-value { color: #88b8d8; font-weight: 700; letter-spacing: .02em; }
.vab-val-stat-good  { color: #42cc74 !important; }
.vab-val-stat-bad   { color: #e06060 !important; }

.vab-val-checks {
  padding: 4px 12px;
}

.vab-val-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #0a1826;
}
.vab-val-check:last-child { border-bottom: none; }

.vab-val-icon {
  flex-shrink: 0;
  font-size: 12px;
  width: 14px;
  text-align: center;
  margin-top: 1px;
}
.vab-val-icon-pass { color: #42cc74; }
.vab-val-icon-warn { color: #d0a030; }
.vab-val-icon-fail { color: #e06060; }

.vab-val-text  { flex: 1; min-width: 0; }

.vab-val-label {
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .10em;
  color: #4878a0;
  margin-bottom: 2px;
}

.vab-val-msg {
  font-size: 10px;
  line-height: 1.45;
  color: #4a7898;
}
.vab-val-msg-pass { color: #3a9858; }
.vab-val-msg-warn { color: #b07820; }
.vab-val-msg-fail { color: #a84040; }

.vab-val-status {
  margin: 8px 12px 10px;
  padding: 7px 10px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: 700;
  text-align: center;
  letter-spacing: .04em;
}
.vab-val-status-ready   { background: rgba(4,30,12,0.7); border: 1px solid #1a4c26; color: #42cc74; }
.vab-val-status-blocked { background: rgba(30,4,4,0.7);  border: 1px solid #4c1a1a; color: #d06060; }

/* ── Crew selection dialog ───────────────────────────────────────────── */
#vab-crew-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.72);
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: center;
}

#vab-crew-dialog {
  background: rgba(4, 8, 22, 0.99);
  border: 1px solid #1e3a5c;
  border-radius: 3px;
  box-shadow: 0 8px 48px rgba(0,0,0,.9);
  width: 340px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  font-family: system-ui, sans-serif;
}

.vab-crew-dlg-hdr {
  padding: 12px 16px;
  border-bottom: 1px solid #0e1e30;
  font-size: 12px;
  font-weight: 700;
  color: #88b4d0;
  flex-shrink: 0;
}

.vab-crew-dlg-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  scrollbar-width: thin;
  scrollbar-color: #152a44 transparent;
}
.vab-crew-dlg-body::-webkit-scrollbar { width: 4px; }
.vab-crew-dlg-body::-webkit-scrollbar-thumb { background: #152a44; border-radius: 2px; }

.vab-crew-seat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 0;
  border-bottom: 1px solid #0a1826;
}
.vab-crew-seat-row:last-child { border-bottom: none; }

.vab-crew-seat-label {
  font-size: 10px;
  color: #5a88a8;
  flex-shrink: 0;
  min-width: 50px;
}

.vab-crew-seat-select {
  flex: 1;
  background: rgba(8,18,40,0.9);
  border: 1px solid #1a3050;
  color: #a0c4e0;
  font-family: inherit;
  font-size: 10px;
  padding: 4px 6px;
  border-radius: 2px;
  cursor: pointer;
}
.vab-crew-seat-select:focus { outline: none; border-color: #3470a8; }

.vab-crew-dlg-footer {
  display: flex;
  gap: 8px;
  padding: 10px 16px;
  border-top: 1px solid #0e1e30;
  justify-content: flex-end;
  flex-shrink: 0;
}

/* ── Launch banner ───────────────────────────────────────────────────── */
#vab-launch-banner {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.85);
  z-index: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, sans-serif;
}

.vab-launch-msg {
  text-align: center;
  padding: 32px 40px;
  background: rgba(4,8,22,0.98);
  border: 1px solid #1e3a5c;
  border-radius: 3px;
  box-shadow: 0 8px 48px rgba(0,0,0,.9);
}

.vab-launch-title {
  font-size: 22px;
  font-weight: 700;
  color: #42cc74;
  letter-spacing: .06em;
  margin-bottom: 8px;
}
.vab-launch-sub {
  font-size: 11px;
  color: #3a6080;
  line-height: 1.7;
}

/* ── Save prompt modal ───────────────────────────────────────────── */
#vab-save-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.6);
  z-index: 300;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, sans-serif;
}
.vab-save-dialog {
  background: #1a1e28;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 10px;
  padding: 20px;
  min-width: 300px;
  max-width: 400px;
  color: #e8e8e8;
}
.vab-save-dialog h3 {
  margin: 0 0 12px;
  font-size: 1rem;
  font-weight: 700;
  text-align: center;
}
.vab-save-dialog input {
  width: 100%;
  box-sizing: border-box;
  background: #222838;
  border: 1px solid rgba(255,255,255,0.15);
  color: #e8e8e8;
  font-size: 0.9rem;
  padding: 8px 10px;
  border-radius: 5px;
  margin-bottom: 14px;
}
.vab-save-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.vab-save-dialog-footer button {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #e8e8e8;
  font-size: 0.82rem;
  padding: 6px 16px;
  border-radius: 5px;
  cursor: pointer;
}
.vab-save-dialog-footer .vab-save-confirm {
  background: #2a6040;
}
.vab-save-dialog-footer .vab-save-confirm:hover {
  background: #357a50;
}

/* ── Load designs overlay ────────────────────────────────────────── */
#vab-load-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 20, 0.96);
  z-index: 300;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 60px;
  font-family: system-ui, sans-serif;
  color: #e8e8e8;
  overflow-y: auto;
}
.vab-load-header {
  font-size: 1.3rem;
  font-weight: 700;
  margin-bottom: 20px;
}
.vab-load-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  max-width: 600px;
  padding: 0 20px;
}
.vab-load-empty {
  font-size: 0.95rem;
  color: #5a6880;
  text-align: center;
  margin-top: 40px;
  line-height: 1.6;
}
.vab-load-close {
  margin-top: 24px;
  margin-bottom: 40px;
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #e8e8e8;
  font-size: 0.85rem;
  padding: 8px 24px;
  border-radius: 5px;
  cursor: pointer;
}
.vab-load-close:hover {
  background: rgba(255,255,255,0.16);
}
.vab-load-card-load-btn {
  background: #1a4a70 !important;
  border-color: #2a6a90 !important;
}
.vab-load-card-load-btn:hover {
  background: #205a80 !important;
}
.vab-load-card-delete-btn {
  background: rgba(80,20,20,0.8) !important;
  border-color: #703030 !important;
  color: #d08080 !important;
}
.vab-load-card-delete-btn:hover {
  background: rgba(100,30,30,0.9) !important;
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

  // _worldToScreen (render/vab.js) gives viewport y = getBuildArea().y + camY - wy*zoom.
  // The scale bar starts at a different viewport y (below topbar + VAB toolbar + status bar),
  // so barY (relative to scale bar top) = viewport_y - scaleBarTop
  //   = (VAB_TOOLBAR_HEIGHT + camY - wy*zoom) - scaleBarTop.
  // Bake the constant part into adjustedCamY so the rest of the formulas stay simple.
  const scaleBarTop    = _scaleTicks.getBoundingClientRect().top;
  const adjustedCamY   = VAB_TOOLBAR_HEIGHT + camY - scaleBarTop;

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

  // Altitude at the top and bottom of the scale bar.
  const topM  = adjustedCamY / pxPerMetre;
  const botM  = (adjustedCamY - h) / pxPerMetre;

  const startM = Math.ceil(botM  / tickM) * tickM;
  const endM   = Math.floor(topM / tickM) * tickM;

  const frags = [];
  let idx = 0;

  // Always show 0m tick if it's on screen.
  const zeroBarY = adjustedCamY; // 0m world = adjustedCamY screen offset
  const zeroVisible = zeroBarY >= 0 && zeroBarY <= h;

  for (let m = startM; m <= endM; m += tickM, idx++) {
    // barY: screen-Y offset from the top of the scale bar.
    const barY = adjustedCamY - m * pxPerMetre;
    if (barY < 0 || barY > h) continue;

    const isMajor = m === 0 || idx % majorEvery === 0;
    frags.push(
      `<div class="vab-tick ${isMajor ? 'vab-tick-major' : 'vab-tick-minor'}" ` +
        `style="top:${barY.toFixed(1)}px">` +
        (isMajor ? `<span class="vab-tick-label">${m}m</span>` : '') +
      `</div>`,
    );
  }

  // If 0m wasn't hit by the regular loop but is visible, add it explicitly.
  if (zeroVisible && (startM > 0 || endM < 0)) {
    frags.push(
      `<div class="vab-tick vab-tick-major" style="top:${zeroBarY.toFixed(1)}px">` +
        `<span class="vab-tick-label">0m</span>` +
      `</div>`,
    );
  }

  _scaleTicks.innerHTML = frags.join('');

  // Draw rocket extent markers.
  _updateScaleBarExtents();
}

/**
 * Draw 'Top' and 'Bottom' extent markers on the scale bar based on placed parts.
 * Also draws a mid-point bracket label showing total rocket height.
 */
function _updateScaleBarExtents() {
  // Remove existing extent elements.
  const existingExtents = _scaleTicks?.querySelectorAll('.vab-tick-extent');
  existingExtents?.forEach((el) => el.remove());

  if (!_scaleTicks || _buildAreaHeight === 0 || !_assembly || _assembly.parts.size === 0) return;

  const { zoom, y: camY } = vabGetCamera();
  const h = _buildAreaHeight;

  // Same viewport→scale-bar adjustment as _drawScaleTicks.
  const scaleBarTop  = _scaleTicks.getBoundingClientRect().top;
  const adjustedCamY = VAB_TOOLBAR_HEIGHT + camY - scaleBarTop;

  // Find the world-Y extent of all placed parts.
  let maxWorldY = -Infinity;
  let minWorldY = Infinity;

  for (const placed of _assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    const top    = placed.y + def.height / 2;
    const bottom = placed.y - def.height / 2;
    if (top    > maxWorldY) maxWorldY = top;
    if (bottom < minWorldY) minWorldY = bottom;
  }

  if (!isFinite(maxWorldY) || !isFinite(minWorldY)) return;

  // Convert world Y → scale-bar Y, mirroring _worldToScreen then subtracting scaleBarTop.
  const topBarY    = adjustedCamY - maxWorldY * zoom;
  const bottomBarY = adjustedCamY - minWorldY * zoom;
  const midBarY    = (topBarY + bottomBarY) / 2;
  const heightM    = (maxWorldY - minWorldY) / VAB_PIXELS_PER_METRE;

  // Add Top marker if on screen.
  if (topBarY >= 0 && topBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${topBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label" style="color:#4ab870">Top</span>` +
      `<span style="position:absolute;right:0;width:16px;height:1px;background:#4ab870;top:0"></span>`;
    _scaleTicks.appendChild(el);
  }

  // Add Bottom marker if on screen.
  if (bottomBarY >= 0 && bottomBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${bottomBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label" style="color:#4ab870">Bot</span>` +
      `<span style="position:absolute;right:0;width:16px;height:1px;background:#4ab870;top:0"></span>`;
    _scaleTicks.appendChild(el);
  }

  // Add mid-point height label if both markers are on screen.
  if (midBarY >= 0 && midBarY <= h && topBarY >= 0 && bottomBarY <= h) {
    const el = document.createElement('div');
    el.className = 'vab-tick vab-tick-extent';
    el.style.top = `${midBarY.toFixed(1)}px`;
    el.innerHTML = `<span class="vab-tick-label" style="color:#c0a040;font-size:7px">&#x21D5;${heightM.toFixed(1)}m</span>`;
    _scaleTicks.appendChild(el);
  }
}

// ---------------------------------------------------------------------------
// Parts panel HTML builder
// ---------------------------------------------------------------------------

// Per-type colours for part cards — matches the PART_FILL / PART_STROKE maps
// in src/render/vab.js so the menu previews look like the placed parts.
const _hex = (n) => '#' + n.toString(16).padStart(6, '0');
const _CARD_FILL = {
  [PartType.COMMAND_MODULE]:       _hex(0x1a3860),
  [PartType.COMPUTER_MODULE]:      _hex(0x122848),
  [PartType.SERVICE_MODULE]:       _hex(0x1c2c58),
  [PartType.FUEL_TANK]:            _hex(0x0e2040),
  [PartType.ENGINE]:               _hex(0x3a1a08),
  [PartType.SOLID_ROCKET_BOOSTER]: _hex(0x301408),
  [PartType.STACK_DECOUPLER]:      _hex(0x142030),
  [PartType.RADIAL_DECOUPLER]:     _hex(0x142030),
  [PartType.DECOUPLER]:            _hex(0x142030),
  [PartType.LANDING_LEG]:          _hex(0x102018),
  [PartType.LANDING_LEGS]:         _hex(0x102018),
  [PartType.PARACHUTE]:            _hex(0x2e1438),
  [PartType.SATELLITE]:            _hex(0x142240),
  [PartType.HEAT_SHIELD]:          _hex(0x2c1000),
  [PartType.RCS_THRUSTER]:         _hex(0x182c30),
  [PartType.SOLAR_PANEL]:          _hex(0x0a2810),
};
const _CARD_STROKE = {
  [PartType.COMMAND_MODULE]:       _hex(0x4080c0),
  [PartType.COMPUTER_MODULE]:      _hex(0x2870a0),
  [PartType.SERVICE_MODULE]:       _hex(0x3860b0),
  [PartType.FUEL_TANK]:            _hex(0x2060a0),
  [PartType.ENGINE]:               _hex(0xc06020),
  [PartType.SOLID_ROCKET_BOOSTER]: _hex(0xa04818),
  [PartType.STACK_DECOUPLER]:      _hex(0x305080),
  [PartType.RADIAL_DECOUPLER]:     _hex(0x305080),
  [PartType.DECOUPLER]:            _hex(0x305080),
  [PartType.LANDING_LEG]:          _hex(0x207840),
  [PartType.LANDING_LEGS]:         _hex(0x207840),
  [PartType.PARACHUTE]:            _hex(0x8040a0),
  [PartType.SATELLITE]:            _hex(0x2868b0),
  [PartType.HEAT_SHIELD]:          _hex(0xa04010),
  [PartType.RCS_THRUSTER]:         _hex(0x2890a0),
  [PartType.SOLAR_PANEL]:          _hex(0x20a040),
};
const _CARD_FILL_DEFAULT  = '#1a4080';
const _CARD_STROKE_DEFAULT = '#4090d0';

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
      const invCount = getInventoryCount(state, p.id);
      const invBadge = invCount > 0
        ? `<span class="vab-inv-badge" title="${invCount} in inventory (free)">${invCount}</span>`
        : '';
      const costLabel = invCount > 0
        ? `<span class="vab-part-cost-free">Free</span><span class="vab-part-cost-orig">${fmt$(p.cost)}</span>`
        : `<span>${fmt$(p.cost)}</span>`;
      rows.push(
        `<div class="vab-part-card" data-part-id="${p.id}" ` +
            `title="${p.name} — ${p.mass} kg · ${invCount > 0 ? 'Free (inventory)' : fmt$(p.cost)}">` +
          `<div class="vab-part-rect" style="width:${rw}px;height:${rh}px;` +
              `background:${_CARD_FILL[p.type] ?? _CARD_FILL_DEFAULT};` +
              `border:1px solid ${_CARD_STROKE[p.type] ?? _CARD_STROKE_DEFAULT}"></div>` +
          `<div class="vab-part-info">` +
            `<div class="vab-part-name">${p.name}${invBadge}</div>` +
            `<div class="vab-part-meta">` +
              `<span>${p.mass}\u202fkg</span>${costLabel}` +
            `</div>` +
          `</div>` +
        `</div>`,
      );
    }
  }
  return rows.join('');
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
  _dragState = { partId, instanceId, startX: clientX, startY: clientY, hasMoved: false };
  // For new parts (from panel), wait for movement before showing ghost.
  // For existing parts already picked up, show ghost immediately.
  if (instanceId !== null) {
    vabSetDragGhost(partId, clientX, clientY);
  }
  window.addEventListener('pointermove',  _onDragMove,   { capture: true });
  window.addEventListener('pointerup',    _onDragEnd,    { capture: true });
  window.addEventListener('pointercancel', _cancelDrag,  { capture: true });
}

/**
 * Cancel an in-progress drag (e.g. pointer captured by browser).
 * If the part was picked up (instanceId != null), put it back.
 */
function _cancelDrag() {
  if (!_dragState && !_pendingPickup) return;
  window.removeEventListener('pointermove',  _onDragMove,  { capture: true });
  window.removeEventListener('pointerup',    _onDragEnd,   { capture: true });
  window.removeEventListener('pointercancel', _cancelDrag, { capture: true });

  const instanceId = _dragState ? _dragState.instanceId : null;
  _dragState = null;
  _pendingPickup = null;
  vabClearDragGhost();
  vabClearSnapHighlights();
  vabClearMirrorGhost();

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

  // Check if the pointer has moved enough to count as a real drag.
  if (!_dragState.hasMoved) {
    const dx = e.clientX - _dragState.startX;
    const dy = e.clientY - _dragState.startY;
    if (Math.hypot(dx, dy) < 8) return; // Not moved enough yet.
    _dragState.hasMoved = true;
    // Now show the ghost for new parts (existing parts already have it).
    if (_dragState.instanceId === null) {
      vabSetDragGhost(_dragState.partId, e.clientX, e.clientY);
    }
  }

  vabMoveDragGhost(e.clientX, e.clientY);

  // Find snap candidates relative to current cursor world position.
  const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
  const { zoom } = vabGetCamera();
  const candidates = findSnapCandidates(
    _assembly, _dragState.partId, worldX, worldY, zoom,
  );

  if (candidates.length > 0) {
    vabShowSnapHighlights(candidates);
    // Show mirror ghost when symmetry mode is active and best snap is radial.
    if (_symmetryMode) {
      const mirror = findMirrorCandidate(_assembly, candidates[0], _dragState.partId);
      if (mirror) {
        vabSetMirrorGhost(_dragState.partId, mirror.mirrorWorldX, mirror.mirrorWorldY);
      } else {
        vabClearMirrorGhost();
      }
    } else {
      vabClearMirrorGhost();
    }
  } else {
    vabClearSnapHighlights();
    vabClearMirrorGhost();
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

  const { partId, instanceId, hasMoved } = _dragState;
  _dragState = null;

  vabClearDragGhost();
  vabClearSnapHighlights();
  vabClearMirrorGhost();

  // If pointer didn't move enough, treat as a click rather than a drag.
  if (!hasMoved) {
    if (instanceId === null) {
      // Click on a part card → show detail panel.
      _showPartDetail(partId);
    }
    // For existing placed parts clicked on the canvas, the selection is handled
    // by _pendingPickup logic in _setupCanvas, not here.
    return;
  }

  // --- Drop on parts panel = discard / delete ---------------------------
  const partsPanel = document.getElementById('vab-parts-panel');
  if (partsPanel) {
    const panelRect = partsPanel.getBoundingClientRect();
    const overPanel = (
      e.clientX >= panelRect.left && e.clientX <= panelRect.right &&
      e.clientY >= panelRect.top  && e.clientY <= panelRect.bottom
    );
    if (overPanel) {
      if (instanceId !== null) {
        // Picked-up part dragged back to panel → delete it and refund/return.
        _refundOrReturnPart(instanceId, partId);
        if (_selectedInstanceId === instanceId) _setSelectedPart(null);
        removePartFromAssembly(_assembly, instanceId);
        _syncAndRenderStaging();
        _runAndRenderValidation();
        _refreshInventoryPanel();
      }
      // New part from panel dragged back to panel → simply don't place it.
      vabRenderParts();
      return;
    }
  }

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
      // Connect additional snap points (e.g. top + bottom of a middle part).
      // Skip candidates that target the same instance as the best (prevents a
      // thin part like a decoupler from using both snaps on a single neighbour).
      const usedDragSnaps = new Set([bestCandidate.dragSnapIndex]);
      for (const c of candidates) {
        if (usedDragSnaps.has(c.dragSnapIndex)) continue;
        if (c.targetInstanceId === bestCandidate.targetInstanceId) continue;
        connectParts(_assembly, instanceId, c.dragSnapIndex, c.targetInstanceId, c.targetSnapIndex);
        usedDragSnaps.add(c.dragSnapIndex);
      }
      // Symmetry: if placing onto a radial socket and symmetry is on, mirror it.
      if (_symmetryMode) {
        const mirror = findMirrorCandidate(_assembly, bestCandidate, partId);
        if (mirror) {
          const mirrorId = addPartToAssembly(_assembly, partId, mirror.mirrorWorldX, mirror.mirrorWorldY);
          connectParts(
            _assembly,
            mirrorId,                          mirror.mirrorDragSnapIndex,
            bestCandidate.targetInstanceId,    mirror.mirrorTargetSnapIndex,
          );
          addSymmetryPair(_assembly, instanceId, mirrorId);
          // New mirrored part needs staging sync + auto-stage.
          _syncAndRenderStaging();
          autoStageNewPart(_assembly, _stagingConfig, mirrorId);
          _renderStagingPanel();
          _runAndRenderValidation();
          // Deduct cost for the mirror copy (or use inventory).
          const def = getPartById(partId);
          if (def && _gameState) {
            const mirrorInv = useInventoryPart(_gameState, partId);
            if (mirrorInv) {
              _inventoryUsedParts.set(mirrorId, mirrorInv);
              const mirrorPlaced = _assembly.parts.get(mirrorId);
              if (mirrorPlaced) mirrorPlaced._fromInventory = true;
            } else {
              _gameState.money -= def.cost;
            }
            refreshTopBar();
          }
        }
      }
    }
    _runAndRenderValidation();
  } else {
    // New part from the panel — use inventory (free) or buy new (deduct cost).
    const def = getPartById(partId);
    if (def && _gameState) {
      const invPart = useInventoryPart(_gameState, partId);
      if (invPart) {
        // Free — part came from inventory. Track it so removal returns it.
        // (instanceId will be assigned below by addPartToAssembly)
        var _pendingInvPart = invPart;  // eslint-disable-line no-var
      } else {
        _gameState.money -= def.cost;
      }
      refreshTopBar();
    }
    const newId = addPartToAssembly(_assembly, partId, finalX, finalY);
    // Track inventory-sourced part.
    if (typeof _pendingInvPart !== 'undefined' && _pendingInvPart) {
      _inventoryUsedParts.set(newId, _pendingInvPart);
      // Mark the placed part visually as recovered.
      const placed = _assembly.parts.get(newId);
      if (placed) placed._fromInventory = true;
    }
    if (bestCandidate) {
      connectParts(
        _assembly,
        newId,                          bestCandidate.dragSnapIndex,
        bestCandidate.targetInstanceId, bestCandidate.targetSnapIndex,
      );
      // Connect additional snap points (e.g. top + bottom of a middle part).
      // Skip candidates that target the same instance as the best.
      const usedDragSnaps2 = new Set([bestCandidate.dragSnapIndex]);
      for (const c of candidates) {
        if (usedDragSnaps2.has(c.dragSnapIndex)) continue;
        if (c.targetInstanceId === bestCandidate.targetInstanceId) continue;
        connectParts(_assembly, newId, c.dragSnapIndex, c.targetInstanceId, c.targetSnapIndex);
        usedDragSnaps2.add(c.dragSnapIndex);
      }
      // Symmetry: if placing onto a radial socket and symmetry is on, mirror it.
      if (_symmetryMode) {
        const mirror = findMirrorCandidate(_assembly, bestCandidate, partId);
        if (mirror) {
          const mirrorId = addPartToAssembly(_assembly, partId, mirror.mirrorWorldX, mirror.mirrorWorldY);
          connectParts(
            _assembly,
            mirrorId,                          mirror.mirrorDragSnapIndex,
            bestCandidate.targetInstanceId,    mirror.mirrorTargetSnapIndex,
          );
          addSymmetryPair(_assembly, newId, mirrorId);
          // Deduct cost for the mirror copy (or use inventory).
          if (def && _gameState) {
            const mirrorInv = useInventoryPart(_gameState, partId);
            if (mirrorInv) {
              _inventoryUsedParts.set(mirrorId, mirrorInv);
              const mirrorPlaced = _assembly.parts.get(mirrorId);
              if (mirrorPlaced) mirrorPlaced._fromInventory = true;
            } else {
              _gameState.money -= def.cost;
            }
            refreshTopBar();
          }
        }
      }
    }
    // Sync staging — new activatable part(s) appear in the unstaged pool,
    // then auto-stage based on activation behaviour.
    _syncAndRenderStaging();
    autoStageNewPart(_assembly, _stagingConfig, newId);
    if (_symmetryMode) {
      // Mirror parts are tracked in symmetryPairs — find the mirror for newId.
      const mirrorPair = _assembly.symmetryPairs.find(
        ([a, b]) => a === newId || b === newId,
      );
      if (mirrorPair) {
        const mirrorId = mirrorPair[0] === newId ? mirrorPair[1] : mirrorPair[0];
        autoStageNewPart(_assembly, _stagingConfig, mirrorId);
      }
    }
    _renderStagingPanel();
    _runAndRenderValidation();
  }

  vabRenderParts();
  _updateStatusBar();
  _updateScaleBarExtents();
  _updateOffscreenIndicators();
}

// ---------------------------------------------------------------------------
// Inventory helpers
// ---------------------------------------------------------------------------

/**
 * Refund cash or return inventory part when removing a placed part.
 * If the part came from inventory, return it instead of refunding cash.
 * @param {string} instanceId
 * @param {string} partId
 */
function _refundOrReturnPart(instanceId, partId) {
  if (!_gameState) return;
  const invEntry = _inventoryUsedParts.get(instanceId);
  if (invEntry) {
    // Return to inventory (no cash change).
    addToInventory(_gameState, invEntry.partId, invEntry.wear, invEntry.flights);
    _inventoryUsedParts.delete(instanceId);
  } else {
    // Bought new — refund cash.
    const def = getPartById(partId);
    if (def) _gameState.money += def.cost;
  }
  refreshTopBar();
  // Refresh the parts list to update inventory counts.
  if (_gameState) vabRefreshParts(_gameState);
}

/**
 * Build the inventory panel HTML listing all recovered parts with
 * wear levels and refurbish/scrap actions.
 * @returns {string}
 */
function _buildInventoryHTML() {
  if (!_gameState || !Array.isArray(_gameState.partInventory) || _gameState.partInventory.length === 0) {
    return `<p class="vab-inv-empty">No recovered parts.<br>Land safely to recover<br>parts from flights.</p>`;
  }

  // Group by partId.
  /** @type {Map<string, import('../core/gameState.js').InventoryPart[]>} */
  const groups = new Map();
  for (const entry of _gameState.partInventory) {
    if (!groups.has(entry.partId)) groups.set(entry.partId, []);
    groups.get(entry.partId).push(entry);
  }

  const rows = [];
  for (const [partId, entries] of groups) {
    const def = getPartById(partId);
    if (!def) continue;
    const label = def.name;
    rows.push(`<div class="vab-inv-group-hdr">${label} (${entries.length})</div>`);
    // Sort best condition first.
    entries.sort((a, b) => a.wear - b.wear);
    for (const entry of entries) {
      const wearPct = Math.round(entry.wear);
      const wearColor = wearPct < 30 ? '#50c860' : wearPct < 60 ? '#c0a030' : '#c04040';
      const refurbCost = Math.round(def.cost * 0.3);
      const scrapValue = Math.round(def.cost * 0.15);
      const effRel = def.reliability !== undefined
        ? (getEffectiveReliability(def.reliability, entry.wear) * 100).toFixed(0) + '%'
        : '—';
      rows.push(
        `<div class="vab-inv-item" data-inv-id="${entry.id}">` +
          `<div class="vab-inv-item-info">` +
            `<span class="vab-inv-wear" style="color:${wearColor}">${wearPct}% wear</span>` +
            `<span class="vab-inv-flights">${entry.flights} flight${entry.flights !== 1 ? 's' : ''}</span>` +
            `<span class="vab-inv-rel">Rel: ${effRel}</span>` +
          `</div>` +
          `<div class="vab-inv-item-actions">` +
            `<button class="vab-inv-btn vab-inv-btn-refurb" data-inv-id="${entry.id}" ` +
                `title="Refurbish: pay ${fmt$(refurbCost)} to reset wear to 10%">` +
              `Refurb ${fmt$(refurbCost)}` +
            `</button>` +
            `<button class="vab-inv-btn vab-inv-btn-scrap" data-inv-id="${entry.id}" ` +
                `title="Scrap: sell for ${fmt$(scrapValue)}">` +
              `Scrap ${fmt$(scrapValue)}` +
            `</button>` +
          `</div>` +
        `</div>`,
      );
    }
  }
  return rows.join('');
}

/**
 * Render (or re-render) the inventory panel body.
 */
function _renderInventoryPanel() {
  const body = document.getElementById('vab-inventory-body');
  if (!body) return;
  body.innerHTML = _buildInventoryHTML();
}

/**
 * Refresh the inventory panel if it's open.
 */
function _refreshInventoryPanel() {
  if (_openPanels.has('inventory')) {
    _renderInventoryPanel();
  }
}

// ---------------------------------------------------------------------------
// Part detail panel
// ---------------------------------------------------------------------------

/**
 * Show part details in the detail panel at the bottom of the parts list.
 * @param {string} partId
 */
function _showPartDetail(partId) {
  const detailEl = document.getElementById('vab-part-detail');
  if (!detailEl) return;

  const def = getPartById(partId);
  if (!def) {
    detailEl.setAttribute('hidden', '');
    return;
  }

  const TYPE_LABEL = {
    command_module: 'Command Module', computer_module: 'Computer Module',
    service_module: 'Service Module', fuel_tank: 'Fuel Tank',
    engine: 'Engine', solid_rocket_booster: 'Solid Rocket Booster',
    stack_decoupler: 'Stack Decoupler', radial_decoupler: 'Radial Decoupler',
    landing_legs: 'Landing Legs', parachute: 'Parachute', satellite: 'Satellite',
    heat_shield: 'Heat Shield',
  };

  const typeLbl = TYPE_LABEL[def.type] ?? def.type;
  const stats = [
    ['Mass',  `${def.mass.toLocaleString('en-US')} kg`],
    ['Cost',  fmt$(def.cost)],
  ];

  // Type-specific stats.
  const p = def.properties ?? {};
  if (p.thrust      !== undefined) stats.push(['Thrust (atm)', `${p.thrust} kN`]);
  if (p.thrustVac   !== undefined) stats.push(['Thrust (vac)', `${p.thrustVac} kN`]);
  if (p.isp         !== undefined) stats.push(['Isp (atm)', `${p.isp} s`]);
  if (p.ispVac      !== undefined) stats.push(['Isp (vac)', `${p.ispVac} s`]);
  if (p.throttleable !== undefined) stats.push(['Throttle', p.throttleable ? 'Yes' : 'No (SRB)']);
  if (p.fuelMass     !== undefined) stats.push(['Fuel mass', `${p.fuelMass.toLocaleString('en-US')} kg`]);
  if (p.maxSafeMass  !== undefined) stats.push(['Max safe mass', `${p.maxSafeMass.toLocaleString('en-US')} kg`]);
  if (p.maxLandingSpeed !== undefined) stats.push(['Max landing speed', `${p.maxLandingSpeed} m/s`]);
  if (p.seats !== undefined) stats.push(['Crew seats', String(p.seats)]);
  if (p.experimentDuration !== undefined) stats.push(['Experiment time', `${p.experimentDuration} s`]);
  if (p.crashThreshold !== undefined) stats.push(['Crash rating', `${p.crashThreshold} m/s`]);
  if (p.heatTolerance !== undefined) stats.push(['Heat tolerance', `${p.heatTolerance.toLocaleString('en-US')}`]);

  // Reliability rating (from malfunction system).
  if (def.reliability !== undefined) {
    const pct = (def.reliability * 100).toFixed(0);
    stats.push(['Reliability', `${pct} %`]);
  }

  // Inventory availability info.
  const invCount = _gameState ? getInventoryCount(_gameState, partId) : 0;
  let invInfo = '';
  if (invCount > 0) {
    const bestPart = _gameState ? getInventoryForPart(_gameState, partId)[0] : null;
    const bestWear = bestPart ? Math.round(bestPart.wear) : 0;
    const effRel = (bestPart && def.reliability !== undefined)
      ? (getEffectiveReliability(def.reliability, bestPart.wear) * 100).toFixed(0)
      : null;
    invInfo =
      `<div class="vab-detail-inv">` +
        `<span class="vab-detail-inv-count">${invCount} in inventory (free)</span>` +
        `<span class="vab-detail-inv-wear">Best: ${bestWear}% wear` +
          (effRel ? ` / ${effRel}% eff. reliability` : '') +
        `</span>` +
      `</div>`;
  }

  detailEl.innerHTML =
    `<div class="vab-detail-name">${def.name}</div>` +
    `<div class="vab-detail-type">${typeLbl}</div>` +
    (def.description ? `<div class="vab-detail-desc">${def.description}</div>` : '') +
    invInfo +
    `<div class="vab-detail-stats">` +
      stats.map(([lbl, val]) =>
        `<div class="vab-detail-stat">` +
          `<span class="vab-detail-stat-label">${lbl}</span>` +
          `<span class="vab-detail-stat-value">${val}</span>` +
        `</div>`
      ).join('') +
    `</div>`;

  detailEl.removeAttribute('hidden');
}

// ---------------------------------------------------------------------------
// Selection highlight
// ---------------------------------------------------------------------------

/**
 * Select or deselect a placed part by instanceId.
 * @param {string | null} instanceId
 */
function _setSelectedPart(instanceId) {
  _selectedInstanceId = instanceId;
  const highlight = document.getElementById('vab-selection-highlight');
  if (!highlight) return;

  if (!instanceId || !_assembly) {
    highlight.setAttribute('hidden', '');
    vabClearSelectedLegAnimation();
    return;
  }

  const placed = _assembly.parts.get(instanceId);
  const def = placed ? getPartById(placed.partId) : null;
  if (!placed || !def) {
    highlight.setAttribute('hidden', '');
    vabClearSelectedLegAnimation();
    return;
  }

  _updateSelectionHighlight(placed, def, highlight);
  highlight.removeAttribute('hidden');

  // Animate leg struts on selected landing leg parts.
  if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
    vabSetSelectedLegAnimation(instanceId, placed.x, placed.y, def);
  } else {
    vabClearSelectedLegAnimation();
  }

  // Show detail for the selected part.
  _showPartDetail(placed.partId);
}

/**
 * Reposition the selection highlight div over the selected part.
 * @param {import('../core/rocketbuilder.js').PlacedPart} placed
 * @param {import('../data/parts.js').PartDef} def
 * @param {HTMLElement} highlight
 */
function _updateSelectionHighlight(placed, def, highlight) {
  const { zoom, x: camX, y: camY } = vabGetCamera();

  const canvasArea = _canvasArea;
  if (!canvasArea) return;

  // Mirror render/vab.js _worldToScreen: viewport = (area.x + camX + wx*zoom, area.y + camY - wy*zoom).
  // Subtract the canvas area's actual viewport position to get element-relative coords.
  // This accounts for open side panels shifting #vab-canvas-area horizontally, and for the
  // topbar + status bar height that getBuildArea().y (VAB_TOOLBAR_HEIGHT) doesn't include.
  const rect = canvasArea.getBoundingClientRect();
  const sx = (VAB_SCALE_BAR_WIDTH + camX + placed.x * zoom) - rect.left;
  const sy = (VAB_TOOLBAR_HEIGHT  + camY - placed.y * zoom) - rect.top;

  const w = def.width  * zoom;
  const h = def.height * zoom;

  highlight.style.left   = `${(sx - w / 2).toFixed(1)}px`;
  highlight.style.top    = `${(sy - h / 2).toFixed(1)}px`;
  highlight.style.width  = `${w.toFixed(1)}px`;
  highlight.style.height = `${h.toFixed(1)}px`;
}

// ---------------------------------------------------------------------------
// Auto-zoom helper
// ---------------------------------------------------------------------------

/**
 * Zoom/pan the camera so the entire rocket fits comfortably in the build area.
 * No-op when the assembly is empty.
 */
/** Return the world-space centre of the current rocket, or (0,0) if empty. */
function _getRocketCenter() {
  if (!_assembly) return { x: 0, y: 0 };
  const bounds = getRocketBounds(_assembly);
  if (!bounds) return { x: 0, y: 0 };
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

function _doZoomToFit() {
  if (!_assembly) return;
  const bounds = getRocketBounds(_assembly);
  if (bounds) vabZoomToFit(bounds);
  _syncZoomSlider();
}

/**
 * Sync the zoom slider value with the current camera zoom level.
 */
function _syncZoomSlider() {
  const slider = /** @type {HTMLInputElement|null} */ (document.getElementById('vab-zoom-slider'));
  if (slider) slider.value = String(vabGetCamera().zoom);
}

// ---------------------------------------------------------------------------
// Status bar (part count + cost)
// ---------------------------------------------------------------------------

/**
 * Update the parts count and cost readout in the status bar.
 */
function _updateStatusBar() {
  const partsEl = document.getElementById('vab-status-parts');
  const costEl  = document.getElementById('vab-status-cost');
  const massEl  = document.getElementById('vab-status-mass');
  if (!partsEl || !costEl || !_assembly) return;

  const count = _assembly.parts.size;
  let totalCost = 0;
  for (const placed of _assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def) totalCost += def.cost;
  }

  partsEl.textContent = `Parts: ${count}`;
  costEl.textContent  = `Cost: ${fmt$(totalCost)}`;

  if (massEl) {
    const massKg = getTotalMass(_assembly);
    massEl.textContent = massKg >= 1000
      ? `Mass: ${(massKg / 1000).toFixed(1)} t`
      : `Mass: ${massKg} kg`;
  }
}

// ---------------------------------------------------------------------------
// Off-screen part indicators
// ---------------------------------------------------------------------------

/**
 * Update the arrow indicators for any placed parts outside the visible canvas.
 */
function _updateOffscreenIndicators() {
  if (!_canvasArea || !_assembly) return;

  // Remove existing indicators.
  const existing = _canvasArea.querySelectorAll('.vab-offscreen-indicator');
  existing.forEach((el) => el.remove());

  const { zoom, x: camX, y: camY } = vabGetCamera();
  const canvasW = _canvasArea.offsetWidth;
  const canvasH = _canvasArea.offsetHeight;

  for (const placed of _assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;

    // Canvas-local coords matching render/vab.js _worldToScreen (minus area offset).
    // sx_canvas = camX + wx * zoom;  sy_canvas = camY - wy * zoom
    const sx = camX + placed.x * zoom;
    const sy = camY - placed.y * zoom;

    // Check if the part is visible.
    const hw = def.width  * zoom / 2;
    const hh = def.height * zoom / 2;
    const partLeft   = sx - hw;
    const partRight  = sx + hw;
    const partTop    = sy - hh;
    const partBottom = sy + hh;

    const offLeft  = partRight  < 0;
    const offRight = partLeft   > canvasW;
    const offTop   = partBottom < 0;
    const offBot   = partTop    > canvasH;

    if (!offLeft && !offRight && !offTop && !offBot) continue;

    // Determine edge and position.
    const margin = 8;
    const size   = 20;
    let indX = Math.max(margin, Math.min(canvasW - margin - size, sx));
    let indY = Math.max(margin, Math.min(canvasH - margin - size, sy));
    let arrow = '?';

    if (offLeft)  { indX = margin; arrow = '◀'; }
    if (offRight) { indX = canvasW - margin - size; arrow = '▶'; }
    if (offTop)   { indY = margin; arrow = '▲'; }
    if (offBot)   { indY = canvasH - margin - size; arrow = '▼'; }

    const ind = document.createElement('div');
    ind.className = 'vab-offscreen-indicator';
    ind.style.left = `${indX}px`;
    ind.style.top  = `${indY}px`;
    ind.title      = def.name;
    ind.textContent = arrow;
    _canvasArea.appendChild(ind);
  }
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
  const mirrorId = _assembly ? getMirrorPartId(_assembly, placed.instanceId) : null;

  let menuHtml =
    `<button class="vab-ctx-item vab-ctx-item-danger" id="vab-ctx-remove">` +
      `Remove Part${costLabel}` +
    `</button>`;

  if (mirrorId) {
    menuHtml +=
      `<button class="vab-ctx-item vab-ctx-item-danger" id="vab-ctx-remove-both">` +
        `Remove Both (mirror pair)` +
      `</button>`;
  }

  _ctxMenu.innerHTML = menuHtml;
  _ctxMenu.style.left = `${clientX}px`;
  _ctxMenu.style.top  = `${clientY}px`;
  _ctxMenu.removeAttribute('hidden');

  _ctxMenu.querySelector('#vab-ctx-remove')?.addEventListener('click', () => {
    _ctxMenu.setAttribute('hidden', '');
    _refundOrReturnPart(placed.instanceId, placed.partId);
    if (_selectedInstanceId === placed.instanceId) _setSelectedPart(null);
    removePartFromAssembly(_assembly, placed.instanceId);
    _syncAndRenderStaging();
    vabRenderParts();
    _refreshInventoryPanel();
  }, { once: true });

  if (mirrorId) {
    _ctxMenu.querySelector('#vab-ctx-remove-both')?.addEventListener('click', () => {
      _ctxMenu.setAttribute('hidden', '');
      _refundOrReturnPart(placed.instanceId, placed.partId);
      const mirrorPlaced = _assembly.parts.get(mirrorId);
      _refundOrReturnPart(mirrorId, mirrorPlaced?.partId ?? placed.partId);
      if (_selectedInstanceId === placed.instanceId || _selectedInstanceId === mirrorId) _setSelectedPart(null);
      removePartFromAssembly(_assembly, placed.instanceId);
      removePartFromAssembly(_assembly, mirrorId);
      _syncAndRenderStaging();
      vabRenderParts();
      _refreshInventoryPanel();
    }, { once: true });
  }
}

// ---------------------------------------------------------------------------
// Canvas panning, zooming, part drag & context menu
// ---------------------------------------------------------------------------

/**
 * Attach all pointer interactions to the build-canvas overlay div:
 *   - Left-button click on placed part → select it.
 *   - Left-button drag on placed part → pick it up.
 *   - Left-button drag on empty space → pan camera.
 *   - Right-click on a placed part → context menu (Remove Part).
 *   - Scroll wheel → zoom.
 * @param {HTMLElement} canvasArea
 */
function _setupCanvas(canvasArea) {
  _canvasArea = canvasArea;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  canvasArea.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;  // only left-button for drag/pan

    const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
    const hit = _hitTestPlacedPart(worldX, worldY);

    if (hit) {
      // Don't immediately pick up — wait for movement to distinguish click from drag.
      _pendingPickup = { hit, startX: e.clientX, startY: e.clientY };
      e.stopPropagation();
      return;
    }

    // No hit — deselect and start camera pan.
    _setSelectedPart(null);
    panning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasArea.setPointerCapture(e.pointerId);
    canvasArea.classList.add('panning');
  });

  canvasArea.addEventListener('pointermove', (e) => {
    if (_pendingPickup) {
      const dx = e.clientX - _pendingPickup.startX;
      const dy = e.clientY - _pendingPickup.startY;
      if (Math.hypot(dx, dy) > 8) {
        // Movement threshold exceeded → start dragging (pick up the part).
        const { hit } = _pendingPickup;
        _pendingPickup = null;
        disconnectPart(_assembly, hit.instanceId);
        _startDrag(hit.partId, hit.instanceId, e.clientX, e.clientY);
      }
      return;
    }
    if (!panning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    vabPanCamera(dx, dy);
    _drawScaleTicks();
    _updateOffscreenIndicators();
  });

  const _stopPan = (e) => {
    if (_pendingPickup) {
      // Pointer released without moving enough → treat as a click (select the part).
      _setSelectedPart(_pendingPickup.hit.instanceId);
      _pendingPickup = null;
      return;
    }
    panning = false;
    canvasArea.classList.remove('panning');
  };
  canvasArea.addEventListener('pointerup',     _stopPan);
  canvasArea.addEventListener('pointercancel', () => {
    _pendingPickup = null;
    panning = false;
    canvasArea.classList.remove('panning');
  });

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
    const c = _getRocketCenter();
    vabSetZoomCentred(zoom * factor, c.x, c.y);
    _drawScaleTicks();
    _updateScaleBarExtents();
    _updateOffscreenIndicators();
    _syncZoomSlider();
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
 * Recompute positions of all open side panels and the canvas area offset.
 * Panels stack left-to-right in the order they appear in _openPanels.
 */
function _recomputePanelPositions() {
  const root = document.getElementById('vab-main');
  if (!root) return;

  const panelMap = {
    inventory: document.getElementById('vab-inventory-panel'),
    engineer:  document.getElementById('vab-engineer-panel'),
    staging:   document.getElementById('vab-staging-panel'),
  };

  let idx = 0;
  for (const [id, el] of Object.entries(panelMap)) {
    if (!el) continue;
    if (_openPanels.has(id)) {
      el.style.left = `${VAB_SCALE_BAR_WIDTH + idx * SIDE_PANEL_WIDTH}px`;
      idx++;
    } else {
      el.setAttribute('hidden', '');
    }
  }

  // Offset the canvas area so it starts after all open panels.
  if (_canvasArea) {
    _canvasArea.style.marginLeft = `${_openPanels.size * SIDE_PANEL_WIDTH}px`;
  }
}

/**
 * Toggle a named side panel.
 * @param {string} panelId  'missions' | 'engineer' | 'staging'
 * @param {() => void} [onOpen]  Called when the panel is about to open.
 */
function _togglePanel(panelId, onOpen) {
  const panelMap = {
    inventory: document.getElementById('vab-inventory-panel'),
    engineer:  document.getElementById('vab-engineer-panel'),
    staging:   document.getElementById('vab-staging-panel'),
  };
  const el = panelMap[panelId];
  if (!el) return;

  if (_openPanels.has(panelId)) {
    _openPanels.delete(panelId);
  } else {
    _openPanels.add(panelId);
    el.removeAttribute('hidden');
    if (onOpen) onOpen();
  }
  _recomputePanelPositions();
}

/**
 * @param {HTMLElement} root  The #vab-root element.
 */
function _bindButtons(root) {
  // ── "← Hub" button — return to the space agency hub ──────────────────────
  root.querySelector('#vab-back-btn')?.addEventListener('click', () => {
    if (_onBack) _onBack();
  });

  // ── "Inventory" toggle ───────────────────────────────────────────────────
  root.querySelector('#vab-btn-inventory')?.addEventListener('click', () => {
    _togglePanel('inventory', () => _renderInventoryPanel());
  });

  root.querySelector('#vab-inventory-close')?.addEventListener('click', () => {
    _openPanels.delete('inventory');
    _recomputePanelPositions();
  });

  // Inventory panel: refurbish / scrap actions (event delegation).
  root.querySelector('#vab-inventory-body')?.addEventListener('click', (e) => {
    const btn = /** @type {HTMLElement} */ (e.target)?.closest?.('.vab-inv-btn');
    if (!btn || !_gameState) return;
    const invId = btn.dataset.invId;
    if (!invId) return;

    if (btn.classList.contains('vab-inv-btn-refurb')) {
      const result = refurbishPart(_gameState, invId);
      if (result.success) {
        _renderInventoryPanel();
        refreshTopBar();
        vabRefreshParts(_gameState);
      }
    } else if (btn.classList.contains('vab-inv-btn-scrap')) {
      const result = scrapPart(_gameState, invId);
      if (result.success) {
        _renderInventoryPanel();
        refreshTopBar();
        vabRefreshParts(_gameState);
      }
    }
  });

  // ── "Rocket Engineer" toggle ─────────────────────────────────────────────
  root.querySelector('#vab-btn-engineer')?.addEventListener('click', () => {
    _togglePanel('engineer', () => _renderEngineerPanel());
  });

  root.querySelector('#vab-engineer-close')?.addEventListener('click', () => {
    _openPanels.delete('engineer');
    _recomputePanelPositions();
  });

  // ── "Staging" toggle ─────────────────────────────────────────────────────
  root.querySelector('#vab-btn-staging')?.addEventListener('click', () => {
    _togglePanel('staging', () => _renderStagingPanel());
  });

  root.querySelector('#vab-staging-close')?.addEventListener('click', () => {
    _openPanels.delete('staging');
    _recomputePanelPositions();
  });

  // ── Symmetry toggle ───────────────────────────────────────────────────────
  const symmetryBtn = /** @type {HTMLButtonElement|null} */ (root.querySelector('#vab-btn-symmetry'));
  if (symmetryBtn) {
    symmetryBtn.setAttribute('aria-pressed', String(_symmetryMode));
    symmetryBtn.addEventListener('click', () => {
      _symmetryMode = !_symmetryMode;
      symmetryBtn.setAttribute('aria-pressed', String(_symmetryMode));
    });
  }

  // ── Clear All — remove all parts and refund cost ─────────────────────────
  root.querySelector('#vab-btn-clear-all')?.addEventListener('click', () => {
    if (!_assembly || _assembly.parts.size === 0) return;
    if (!confirm('Remove all parts? This will refund their cost.')) return;
    // Refund all part costs (or return inventory parts).
    for (const [instId, placed] of _assembly.parts) {
      _refundOrReturnPart(instId, placed.partId);
    }
    // Clear the assembly.
    _assembly.parts.clear();
    _assembly.connections.length = 0;
    _assembly.symmetryPairs.length = 0;
    _setSelectedPart(null);
    _currentDesignId   = null;
    _currentDesignName = '';
    _syncAndRenderStaging();
    vabRenderParts();
    _updateStatusBar();
    _updateScaleBarExtents();
    _updateOffscreenIndicators();
    _refreshInventoryPanel();
    // Refresh cash display.
    const cashEl = document.getElementById('vab-cash');
    if (cashEl && _gameState) cashEl.textContent = fmt$(_gameState.money);
  });

  // ── Save design ─────────────────────────────────────────────────────────────
  root.querySelector('#vab-btn-save')?.addEventListener('click', () => {
    _handleSaveDesign();
  });

  // ── Load design ────────────────────────────────────────────────────────────
  root.querySelector('#vab-btn-load')?.addEventListener('click', () => {
    _handleLoadDesign();
  });

  // ── Launch — enabled only when validation passes ──────────────────────────
  root.querySelector('#vab-btn-launch')?.addEventListener('click', () => {
    if (!_lastValidation?.canLaunch) return; // Guard: button should be disabled anyway.
    _handleLaunchClicked();
  });

  // ── Fit (zoom-to-fit) button ──────────────────────────────────────────────
  root.querySelector('#vab-btn-fit')?.addEventListener('click', () => {
    _doZoomToFit();
  });

  // ── Auto-zoom checkbox ────────────────────────────────────────────────────
  root.querySelector('#vab-chk-autozoom')?.addEventListener('change', (e) => {
    _autoZoomEnabled = /** @type {HTMLInputElement} */ (e.target).checked;
    if (_autoZoomEnabled) _doZoomToFit();
  });

  // ── Zoom slider ─────────────────────────────────────────────────────────
  root.querySelector('#vab-zoom-slider')?.addEventListener('input', (e) => {
    const value = parseFloat(/** @type {HTMLInputElement} */ (e.target).value);
    const c = _getRocketCenter();
    vabSetZoomCentred(value, c.x, c.y);
    _drawScaleTicks();
    _updateScaleBarExtents();
    _updateOffscreenIndicators();
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
    _runAndRenderValidation();
    _updateStatusBar();
    _updateScaleBarExtents();
    _updateOffscreenIndicators();
    if (_autoZoomEnabled) _doZoomToFit();
  }
}

/**
 * Compute the delta-v for a given stage index in the VAB.
 *
 * Uses the Tsiolkovsky rocket equation: ΔV = Isp × g₀ × ln(m₀ / m₁)
 * ISP is interpolated between sea-level and vacuum based on `_dvAltitude`.
 *
 * @param {number} stageIdx  Stage index (0 = fires first).
 * @returns {{ dv: number, engines: boolean }}
 */
function _computeVabStageDeltaV(stageIdx) {
  if (!_assembly || !_stagingConfig) return { dv: 0, engines: false };
  const stage = _stagingConfig.stages[stageIdx];
  if (!stage) return { dv: 0, engines: false };

  const G0 = 9.81;

  // Atmospheric fraction: 1 at sea level, 0 in vacuum.
  const density = airDensity(_dvAltitude);
  const atmFrac = Math.min(1, density / SEA_LEVEL_DENSITY);

  // Determine which parts are "active" at this stage — all parts except
  // those in earlier-firing stages (lower indices) which have already been
  // jettisoned by the time this stage fires.
  const jettisoned = new Set();
  for (let s = 0; s < stageIdx; s++) {
    for (const id of _stagingConfig.stages[s].instanceIds) {
      jettisoned.add(id);
    }
  }

  // Total mass and fuel at the point this stage fires.
  let totalMass = 0;
  let totalFuel = 0;
  for (const [instanceId, placed] of _assembly.parts) {
    if (jettisoned.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass = def.properties?.fuelMass ?? 0;
    totalMass += (def.mass ?? 0) + fuelMass;
    if (fuelMass > 0) totalFuel += fuelMass;
  }

  // Engines in this stage — sum thrust-weighted ISP.
  let thrustTotal    = 0;
  let ispTimesThrust = 0;
  let hasEngines     = false;
  for (const instanceId of stage.instanceIds) {
    if (jettisoned.has(instanceId)) continue;
    const placed = _assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    const thrustKN = def.properties?.thrust ?? 0;
    if (thrustKN > 0) {
      hasEngines = true;
      const thrustN = thrustKN * 1000; // kN → N
      const ispSL  = def.properties?.isp    ?? 300;
      const ispVac = def.properties?.ispVac ?? ispSL;
      const isp = ispSL * atmFrac + ispVac * (1 - atmFrac);
      thrustTotal    += thrustN;
      ispTimesThrust += isp * thrustN;
    }
  }

  const twr = totalMass > 0 && thrustTotal > 0
    ? thrustTotal / (totalMass * G0)
    : 0;

  if (totalFuel <= 0 || thrustTotal <= 0 || totalMass <= 0) {
    return { dv: 0, twr, engines: hasEngines };
  }

  const avgIsp = ispTimesThrust / thrustTotal;
  const dryMass = totalMass - totalFuel;
  if (dryMass <= 0) return { dv: 0, twr, engines: hasEngines };

  return { dv: avgIsp * G0 * Math.log(totalMass / dryMass), twr, engines: true };
}

/**
 * Update only the delta-v values and altitude label in the staging panel,
 * without replacing the full DOM (so the slider keeps focus during drag).
 * @param {HTMLElement} body
 */
function _updateStagingDvValues(body) {
  if (!_stagingConfig || !_assembly) return;

  const numStages = _stagingConfig.stages.length;
  let totalDv = 0;
  const stageDvs = [];
  for (let i = 0; i < numStages; i++) {
    const result = _computeVabStageDeltaV(i);
    stageDvs.push(result);
    totalDv += result.dv;
  }

  // Update altitude and density labels.
  const density = airDensity(_dvAltitude);
  const altStr = _dvAltitude >= 1000
    ? (_dvAltitude / 1000).toFixed(1) + ' km'
    : _dvAltitude + ' m';
  const altEl = body.querySelector('.vab-dv-alt-label');
  if (altEl) altEl.textContent = altStr;
  const densEl = body.querySelector('.vab-dv-density-label');
  if (densEl) densEl.textContent = `Air density: ${density.toFixed(3)} kg/m\u00B3`;

  // Update total delta-v.
  const totalEl = body.querySelector('.vab-staging-dv-total');
  if (totalEl) {
    totalEl.textContent = `Total \u0394V: ~${Math.round(totalDv).toLocaleString()} m/s`;
  }

  // Update per-stage delta-v and TWR.
  body.querySelectorAll('.vab-staging-stage').forEach((stageEl) => {
    const idx = parseInt(/** @type {HTMLElement} */ (stageEl).dataset.stageIndex ?? '0', 10);
    const sdv = stageDvs[idx];
    const dvEl = stageEl.querySelector('.vab-stage-dv');
    if (dvEl) {
      dvEl.textContent = sdv && sdv.dv > 0
        ? `\u0394V ~${Math.round(sdv.dv).toLocaleString()} m/s`
        : '';
    }
    const twrEl = stageEl.querySelector('.vab-stage-twr');
    if (twrEl && sdv) {
      twrEl.textContent = sdv.twr > 0 ? `TWR ${sdv.twr.toFixed(2)}` : '';
      twrEl.className = sdv.twr > 0 && sdv.twr < 1
        ? 'vab-stage-twr warn'
        : 'vab-stage-twr';
    }
  });
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

  // ── Delta-V altitude slider + total ────────────────────────────────────────
  let totalDv = 0;
  const stageDvs = [];
  for (let i = 0; i < numStages; i++) {
    const result = _computeVabStageDeltaV(i);
    stageDvs.push(result);
    totalDv += result.dv;
  }

  const density = airDensity(_dvAltitude);
  const altStr = _dvAltitude >= 1000
    ? (_dvAltitude / 1000).toFixed(1) + ' km'
    : _dvAltitude + ' m';
  const altDisplayLabel = `${altStr} (${density.toFixed(3)} kg/m³)`;

  html.push('<div class="vab-dv-altitude">');
  html.push('<div class="vab-dv-altitude-row">');
  html.push('<span>Altitude</span>');
  html.push(
    `<input type="range" id="vab-dv-alt-slider" min="0" max="70000" ` +
    `step="500" value="${_dvAltitude}">`,
  );
  html.push('</div>');
  html.push(
    `<div class="vab-dv-altitude-info">` +
    `<span class="vab-dv-alt-label">${altStr}</span>` +
    `<span class="vab-dv-density-label">Air density: ${density.toFixed(3)} kg/m\u00B3</span>` +
    `</div>`,
  );
  html.push('</div>');

  html.push('<div class="vab-staging-dv">');
  html.push(
    `<div class="vab-staging-dv-total">Total \u0394V: ~${Math.round(totalDv).toLocaleString()} m/s</div>`,
  );
  html.push('</div>');

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

    html.push(`<div class="${stageClasses}" data-stage-index="${i}">`);

    // Stage header.
    html.push('<div class="vab-staging-stage-hdr">');
    // Drag handle for stage reordering (only when more than one stage).
    if (numStages > 1) {
      html.push(
        `<span class="vab-stage-drag-handle" draggable="true" ` +
        `data-stage-drag="true" data-stage-index="${i}" ` +
        `title="Drag to reorder stage">&#x2807;</span>`,
      );
    }
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

    // Per-stage delta-v and TWR.
    const sdv = stageDvs[i];
    if (sdv && (sdv.dv > 0 || sdv.twr > 0)) {
      html.push('<div class="vab-stage-stats">');
      if (sdv.dv > 0) {
        html.push(`<span class="vab-stage-dv">\u0394V ~${Math.round(sdv.dv).toLocaleString()} m/s</span>`);
      }
      if (sdv.twr > 0) {
        const twrClass = sdv.twr < 1 ? 'vab-stage-twr warn' : 'vab-stage-twr';
        html.push(`<span class="${twrClass}">TWR ${sdv.twr.toFixed(2)}</span>`);
      }
      html.push('</div>');
    }

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
  // Altitude slider — update delta-v values in-place without full re-render.
  const altSlider = body.querySelector('#vab-dv-alt-slider');
  if (altSlider) {
    altSlider.addEventListener('input', (e) => {
      _dvAltitude = parseInt(/** @type {HTMLInputElement} */ (e.target).value, 10);
      _updateStagingDvValues(body);
    });
  }

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
  // dragstart: fired on chip elements OR stage drag handles.
  panelBody.addEventListener('dragstart', (e) => {
    // ── Stage handle drag (reorder stages) ──────────────────────────────
    const handle = /** @type {HTMLElement} */ (
      /** @type {Element} */ (e.target).closest?.('.vab-stage-drag-handle')
    );
    if (handle) {
      const stageIdx = handle.dataset.stageIndex ?? '';
      e.dataTransfer.setData('text/plain', `stage-reorder|${stageIdx}`);
      e.dataTransfer.effectAllowed = 'move';
      const stageEl = handle.closest('.vab-staging-stage');
      if (stageEl) stageEl.classList.add('dragging');
      return;
    }

    // ── Part chip drag (move parts between stages) ──────────────────────
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
    const stageEl = /** @type {Element} */ (e.target).closest?.('.vab-staging-stage');
    if (stageEl) stageEl.classList.remove('dragging');
    panelBody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  });

  // dragover: highlight the target zone or stage.
  panelBody.addEventListener('dragover', (e) => {
    const zone = /** @type {Element} */ (e.target).closest?.('.vab-staging-zone, .vab-staging-stage');
    if (!zone) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('drag-over');
  });

  // dragleave: remove highlight only when truly leaving the zone.
  panelBody.addEventListener('dragleave', (e) => {
    const zone = /** @type {Element} */ (e.target).closest?.('.vab-staging-zone, .vab-staging-stage');
    if (!zone) return;
    if (!zone.contains(/** @type {Node} */ (e.relatedTarget))) {
      zone.classList.remove('drag-over');
    }
  });

  // drop: update staging config and re-render.
  panelBody.addEventListener('drop', (e) => {
    if (!_stagingConfig) return;

    const raw = e.dataTransfer.getData('text/plain');
    if (!raw) return;

    const pipeIdx = raw.indexOf('|');
    const prefix  = raw.slice(0, pipeIdx);
    const suffix  = raw.slice(pipeIdx + 1);

    // ── Stage reorder drop ──────────────────────────────────────────────
    if (prefix === 'stage-reorder') {
      const targetStage = /** @type {HTMLElement} */ (
        /** @type {Element} */ (e.target).closest?.('.vab-staging-stage')
      );
      if (!targetStage) return;
      e.preventDefault();
      panelBody.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));

      const fromIndex = parseInt(suffix, 10);
      const toIndex   = parseInt(targetStage.dataset.stageIndex ?? '0', 10);
      if (fromIndex !== toIndex) {
        moveStage(_stagingConfig, fromIndex, toIndex);
        _renderStagingPanel();
        _runAndRenderValidation();
      }
      return;
    }

    // ── Part chip drop ──────────────────────────────────────────────────
    const zone = /** @type {HTMLElement} */ (
      /** @type {Element} */ (e.target).closest?.('.vab-staging-zone')
    );
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('drag-over');

    const instanceId = prefix;
    const source     = suffix;
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
    _runAndRenderValidation(); // Stage assignment affects TWR and Stage 1 engine checks.
  });
}

// ---------------------------------------------------------------------------
// Rocket Engineer validation panel
// ---------------------------------------------------------------------------

/**
 * Populate the Rocket Engineer side panel with the latest validation result.
 * Call after `_runAndRenderValidation()` or when the panel is opened.
 */
function _renderEngineerPanel() {
  const body = /** @type {HTMLElement|null} */ (document.getElementById('vab-engineer-body'));
  if (!body) return;

  if (!_assembly || !_stagingConfig || !_gameState) {
    body.innerHTML = '<p class="vab-side-empty">No rocket assembly loaded.</p>';
    return;
  }

  const result = _lastValidation ?? runValidation(_assembly, _stagingConfig, _gameState);
  const html   = [];

  // ── Stats ─────────────────────────────────────────────────────────────────
  html.push('<div class="vab-val-stats">');
  html.push(
    `<div class="vab-val-stat-row">` +
      `<span class="vab-val-stat-label">Total Mass</span>` +
      `<span class="vab-val-stat-value">${result.totalMassKg.toLocaleString('en-US')} kg</span>` +
    `</div>`,
  );
  html.push(
    `<div class="vab-val-stat-row">` +
      `<span class="vab-val-stat-label">Stage 1 Thrust</span>` +
      `<span class="vab-val-stat-value">${result.stage1Thrust.toFixed(0)} kN</span>` +
    `</div>`,
  );
  const twrGoodClass = result.twr > 1.0 ? 'vab-val-stat-good' : 'vab-val-stat-bad';
  html.push(
    `<div class="vab-val-stat-row">` +
      `<span class="vab-val-stat-label">TWR (Stage 1)</span>` +
      `<span class="vab-val-stat-value ${twrGoodClass}">${result.twr.toFixed(2)}</span>` +
    `</div>`,
  );
  html.push('</div>'); // stats

  // ── Checks ────────────────────────────────────────────────────────────────
  html.push('<div class="vab-val-checks">');
  for (const check of result.checks) {
    let iconClass, iconChar, msgClass;
    if (check.pass) {
      iconClass = 'vab-val-icon-pass';
      iconChar  = '&#x2713;'; // ✓
      msgClass  = 'vab-val-msg-pass';
    } else if (check.warn) {
      iconClass = 'vab-val-icon-warn';
      iconChar  = '&#x26a0;'; // ⚠
      msgClass  = 'vab-val-msg-warn';
    } else {
      iconClass = 'vab-val-icon-fail';
      iconChar  = '&#x2717;'; // ✗
      msgClass  = 'vab-val-msg-fail';
    }
    html.push(
      `<div class="vab-val-check">` +
        `<div class="vab-val-icon ${iconClass}">${iconChar}</div>` +
        `<div class="vab-val-text">` +
          `<div class="vab-val-label">${check.label}</div>` +
          `<div class="vab-val-msg ${msgClass}">${check.message}</div>` +
        `</div>` +
      `</div>`,
    );
  }
  html.push('</div>'); // checks

  // ── Launch status summary ─────────────────────────────────────────────────
  const statusClass = result.canLaunch ? 'vab-val-status-ready' : 'vab-val-status-blocked';
  const statusText  = result.canLaunch ? 'Ready for launch.' : 'Resolve failures to enable launch.';
  html.push(`<div class="vab-val-status ${statusClass}">${statusText}</div>`);

  body.innerHTML = html.join('');
}

/**
 * Run the rocket validation, cache the result, update the Launch button, and
 * refresh the Rocket Engineer panel if it is currently visible.
 *
 * Call this after every assembly change (add / remove part) or staging change.
 */
function _runAndRenderValidation() {
  if (!_assembly || !_stagingConfig || !_gameState) {
    vabSetLaunchEnabled(false);
    return;
  }

  _lastValidation = runValidation(_assembly, _stagingConfig, _gameState);
  vabSetLaunchEnabled(_lastValidation.canLaunch);

  // Refresh the Rocket Engineer panel only when it is open (no wasted work).
  const panel = document.getElementById('vab-engineer-panel');
  if (panel && !panel.hasAttribute('hidden')) {
    _renderEngineerPanel();
  }
}

// ---------------------------------------------------------------------------
// Launch sequence — crew dialog & flight state
// ---------------------------------------------------------------------------
// Save / Load design handlers
// ---------------------------------------------------------------------------

/**
 * Show a save-name prompt and persist the current assembly as a saved design.
 * Includes save-private toggle for per-save-slot storage.
 */
function _handleSaveDesign() {
  if (!_assembly || _assembly.parts.size === 0 || !_gameState) {
    alert('Nothing to save.');
    return;
  }

  // Remove any existing save overlay.
  document.getElementById('vab-save-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vab-save-overlay';

  const defaultName = _currentDesignName || 'Rocket Design ' + new Date().toLocaleDateString();

  // Check if the existing design was save-private.
  const existingDesign = _currentDesignId
    ? getAllDesigns(_gameState).find(d => d.id === _currentDesignId)
    : null;
  const wasPrivate = existingDesign?.savePrivate ?? false;

  overlay.innerHTML =
    `<div class="vab-save-dialog">` +
      `<h3>Save Design</h3>` +
      `<input type="text" id="vab-save-name" value="${defaultName.replace(/"/g, '&quot;')}" maxlength="60" />` +
      `<label class="vab-save-private-label">` +
        `<input type="checkbox" id="vab-save-private" ${wasPrivate ? 'checked' : ''} />` +
        `<span>Save-private (this save slot only)</span>` +
      `</label>` +
      `<div class="vab-save-dialog-footer">` +
        `<button type="button" id="vab-save-cancel">Cancel</button>` +
        `<button type="button" class="vab-save-confirm" id="vab-save-confirm">Save</button>` +
      `</div>` +
    `</div>`;

  document.body.appendChild(overlay);

  const nameInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#vab-save-name'));
  nameInput?.select();

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#vab-save-cancel')?.addEventListener('click', () => overlay.remove());

  const doSave = () => {
    const name = nameInput?.value.trim() || defaultName;
    const designId = _currentDesignId || ('design-' + Date.now());
    const isPrivate = /** @type {HTMLInputElement} */ (overlay.querySelector('#vab-save-private'))?.checked ?? false;

    const design = createRocketDesign({
      id:          designId,
      name,
      parts:       [..._assembly.parts.values()].map(p => ({ partId: p.partId, position: { x: p.x, y: p.y }, ...(p.instruments?.length ? { instruments: [...p.instruments] } : {}) })),
      staging:     { stages: _stagingConfig.stages.map(s => [...s.instanceIds]), unstaged: [..._stagingConfig.unstaged] },
      totalMass:   _lastValidation?.totalMassKg ?? 0,
      totalThrust: _lastValidation?.stage1Thrust ?? 0,
      savePrivate: isPrivate,
    });

    saveDesignToLibrary(_gameState, design);
    _currentDesignId   = designId;
    _currentDesignName = name;

    overlay.remove();

    // Brief confirmation toast.
    _showToast('Design saved.');
  };

  overlay.querySelector('#vab-save-confirm')?.addEventListener('click', doSave);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave();
  });
}

/**
 * Show a brief toast message near the top of the VAB.
 * @param {string} msg
 */
function _showToast(msg) {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.style.cssText =
    'position:fixed;top:60px;left:50%;transform:translateX(-50%);' +
    'background:#1a3a28;color:#80d0a0;border:1px solid #2a6040;' +
    'padding:8px 20px;border-radius:6px;font-size:0.85rem;z-index:400;' +
    'pointer-events:none;opacity:1;transition:opacity 0.4s;font-family:system-ui,sans-serif;';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 1200);
  setTimeout(() => { toast.remove(); }, 1700);
}

/**
 * Show the full design library overlay with filtering, cost breakdown,
 * compatibility indicators, duplicate, and grouping.
 */
function _handleLoadDesign() {
  if (!_gameState) return;

  injectRocketCardCSS();
  _injectLibraryCSS();

  document.getElementById('vab-load-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vab-load-overlay';

  // ── Header ──
  const header = document.createElement('div');
  header.className = 'vab-load-header';
  header.textContent = 'Design Library';
  overlay.appendChild(header);

  // ── Filter bar ──
  const filterBar = document.createElement('div');
  filterBar.className = 'vab-lib-filter-bar';

  // Search input
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search designs...';
  searchInput.className = 'vab-lib-search';
  filterBar.appendChild(searchInput);

  // Group filter buttons
  const groupDefs = getDesignGroupDefs();
  let activeGroupId = null;

  const groupBar = document.createElement('div');
  groupBar.className = 'vab-lib-group-bar';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'vab-lib-group-btn active';
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => {
    activeGroupId = null;
    _updateGroupBtns();
    renderList();
  });
  groupBar.appendChild(allBtn);

  for (const gd of groupDefs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vab-lib-group-btn';
    btn.textContent = gd.label;
    btn.dataset.groupId = gd.id;
    btn.addEventListener('click', () => {
      activeGroupId = activeGroupId === gd.id ? null : gd.id;
      _updateGroupBtns();
      renderList();
    });
    groupBar.appendChild(btn);
  }

  filterBar.appendChild(groupBar);
  overlay.appendChild(filterBar);

  function _updateGroupBtns() {
    const btns = groupBar.querySelectorAll('.vab-lib-group-btn');
    btns.forEach((b) => {
      const gid = b.dataset.groupId ?? null;
      b.classList.toggle('active', gid === activeGroupId || (!gid && !activeGroupId));
    });
  }

  // ── Design list ──
  const list = document.createElement('div');
  list.className = 'vab-load-list';
  overlay.appendChild(list);

  const renderList = () => {
    list.innerHTML = '';
    let designs = getAllDesigns(_gameState);

    // Apply group filter
    designs = filterDesignsByGroup(designs, activeGroupId);

    // Apply search filter
    const query = searchInput.value.trim().toLowerCase();
    if (query) {
      designs = designs.filter(d => d.name.toLowerCase().includes(query));
    }

    // Update group button visibility — hide groups with 0 matches in full set
    const allDesigns = getAllDesigns(_gameState);
    const grouped = groupDesigns(allDesigns);
    const activeGroups = new Set(grouped.map(g => g.groupId));
    groupBar.querySelectorAll('.vab-lib-group-btn[data-group-id]').forEach((btn) => {
      btn.style.display = activeGroups.has(btn.dataset.groupId) ? '' : 'none';
    });

    if (designs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'vab-load-empty';
      empty.textContent = query || activeGroupId
        ? 'No designs match the current filter.'
        : 'No saved designs. Use Save to store your current rocket.';
      list.appendChild(empty);
      return;
    }

    for (const design of designs) {
      const compat = checkDesignCompatibility(design, _gameState);
      const costInfo = calculateCostBreakdown(design);
      const card = _buildLibraryCard(design, compat, costInfo, overlay, renderList);
      list.appendChild(card);
    }
  };

  searchInput.addEventListener('input', renderList);

  renderList();

  const closeBtn = document.createElement('button');
  closeBtn.className = 'vab-load-close';
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => overlay.remove());
  overlay.appendChild(closeBtn);

  document.body.appendChild(overlay);
}

/**
 * Build a library card with compatibility indicator, cost breakdown,
 * and action buttons (Load, Duplicate, Delete).
 *
 * @param {import('../core/gameState.js').RocketDesign} design
 * @param {import('../core/designLibrary.js').CompatibilityResult} compat
 * @param {import('../core/designLibrary.js').CostBreakdown} costInfo
 * @param {HTMLElement} overlay  - The overlay element (for removal on load).
 * @param {() => void} rerender - Callback to re-render the list after changes.
 * @returns {HTMLElement}
 */
function _buildLibraryCard(design, compat, costInfo, overlay, rerender) {
  const card = buildRocketCard(design, []);

  // ── Compatibility indicator ──
  const compatDot = document.createElement('span');
  compatDot.className = `vab-lib-compat vab-lib-compat-${compat.status}`;
  const compatLabels = { green: 'Compatible', yellow: 'Partial', red: 'Locked parts' };
  compatDot.title = compat.status === 'green'
    ? 'All parts unlocked'
    : compat.lockedDetails.map(d => `${d.partName} (${d.techNodeName})`).join(', ');
  compatDot.textContent = compatLabels[compat.status];

  // Insert after the name
  const infoEl = card.querySelector('.rocket-card-info');
  if (infoEl) {
    const nameEl = infoEl.querySelector('.rocket-card-name');
    if (nameEl) nameEl.after(compatDot);
  }

  // ── Cost breakdown line ──
  const costEl = document.createElement('div');
  costEl.className = 'vab-lib-cost';
  costEl.innerHTML =
    `<span>Parts: ${_fmtCost(costInfo.partsCost)}</span>` +
    `<span>Fuel: ${_fmtCost(costInfo.fuelCost)}</span>` +
    `<span class="vab-lib-cost-total">Total: ${_fmtCost(costInfo.totalCost)}</span>`;
  if (infoEl) infoEl.appendChild(costEl);

  // ── Locked parts details (if any) ──
  if (compat.lockedDetails.length > 0) {
    const lockedEl = document.createElement('div');
    lockedEl.className = 'vab-lib-locked';
    lockedEl.innerHTML = compat.lockedDetails.map(d =>
      `<span class="vab-lib-locked-part">${d.partName} <span class="vab-lib-locked-node">(${d.techNodeName})</span></span>`
    ).join('');
    if (infoEl) infoEl.appendChild(lockedEl);
  }

  // ── Save-private badge ──
  if (design.savePrivate) {
    const badge = document.createElement('span');
    badge.className = 'vab-lib-private-badge';
    badge.textContent = 'Private';
    badge.title = 'This design is private to the current save slot';
    if (infoEl) {
      const nameEl = infoEl.querySelector('.rocket-card-name');
      if (nameEl) nameEl.after(badge);
    }
  }

  // ── Action buttons ──
  const actionsEl = document.createElement('div');
  actionsEl.className = 'rocket-card-actions';

  // Load button
  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'vab-load-card-load-btn';
  loadBtn.textContent = 'Load';
  if (compat.status === 'red') {
    loadBtn.title = 'Some parts are locked — rocket will fail validation until all parts are unlocked';
  }
  loadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _loadDesignIntoVab(design);
    overlay.remove();
  });
  actionsEl.appendChild(loadBtn);

  // Duplicate button
  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.textContent = 'Duplicate';
  dupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const copy = duplicateDesign(design);
    saveDesignToLibrary(_gameState, copy);
    rerender();
    _showToast('Design duplicated.');
  });
  actionsEl.appendChild(dupBtn);

  // Delete button
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'vab-load-card-delete-btn';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${design.name}"?`)) return;
    deleteDesignFromLibrary(_gameState, design.id);
    if (_currentDesignId === design.id) {
      _currentDesignId = null;
      _currentDesignName = '';
    }
    rerender();
  });
  actionsEl.appendChild(delBtn);

  // Replace any existing actions container
  const existingActions = card.querySelector('.rocket-card-actions');
  if (existingActions) existingActions.remove();
  card.appendChild(actionsEl);

  return card;
}

/**
 * Format a cost value as a dollar string.
 * @param {number} n
 * @returns {string}
 */
function _fmtCost(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/** Whether library CSS has been injected. */
let _libraryCssInjected = false;

/**
 * Inject design library CSS (idempotent).
 */
function _injectLibraryCSS() {
  if (_libraryCssInjected) return;
  if (document.getElementById('vab-library-css')) { _libraryCssInjected = true; return; }
  const style = document.createElement('style');
  style.id = 'vab-library-css';
  style.textContent = `
/* ── Design Library filter bar ──────────────────────────────────── */
.vab-lib-filter-bar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 600px;
  padding: 0 20px;
  margin-bottom: 14px;
}
.vab-lib-search {
  width: 100%;
  box-sizing: border-box;
  background: #181c28;
  border: 1px solid rgba(255,255,255,0.12);
  color: #e0e0e0;
  font-size: 0.85rem;
  padding: 8px 12px;
  border-radius: 6px;
  font-family: system-ui, sans-serif;
}
.vab-lib-search::placeholder { color: #4a5a70; }
.vab-lib-group-bar {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.vab-lib-group-btn {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.1);
  color: #7888a0;
  font-size: 0.75rem;
  font-weight: 600;
  padding: 4px 12px;
  border-radius: 14px;
  cursor: pointer;
  transition: all 0.15s;
  font-family: system-ui, sans-serif;
}
.vab-lib-group-btn:hover {
  background: rgba(255,255,255,0.1);
  color: #a0b8d0;
}
.vab-lib-group-btn.active {
  background: rgba(32, 100, 160, 0.35);
  border-color: #2870a0;
  color: #80c8f0;
}

/* ── Compatibility indicator ────────────────────────────────────── */
.vab-lib-compat {
  display: inline-block;
  font-size: 0.7rem;
  font-weight: 700;
  padding: 1px 8px;
  border-radius: 9px;
  margin-left: 8px;
  vertical-align: middle;
}
.vab-lib-compat-green {
  background: rgba(40, 160, 60, 0.2);
  color: #60d070;
  border: 1px solid rgba(40, 160, 60, 0.3);
}
.vab-lib-compat-yellow {
  background: rgba(180, 140, 20, 0.2);
  color: #d0b030;
  border: 1px solid rgba(180, 140, 20, 0.3);
}
.vab-lib-compat-red {
  background: rgba(180, 40, 40, 0.2);
  color: #e06060;
  border: 1px solid rgba(180, 40, 40, 0.3);
}

/* ── Cost breakdown ─────────────────────────────────────────────── */
.vab-lib-cost {
  display: flex;
  gap: 12px;
  font-size: 0.73rem;
  color: #5a7890;
  margin-top: 3px;
}
.vab-lib-cost-total {
  color: #70b870;
  font-weight: 600;
}

/* ── Locked parts ───────────────────────────────────────────────── */
.vab-lib-locked {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.vab-lib-locked-part {
  display: inline-block;
  font-size: 0.68rem;
  color: #c06060;
  background: rgba(160, 40, 40, 0.12);
  padding: 1px 7px;
  border-radius: 4px;
  border: 1px solid rgba(160, 40, 40, 0.2);
}
.vab-lib-locked-node {
  color: #907070;
  font-style: italic;
}

/* ── Private badge ──────────────────────────────────────────────── */
.vab-lib-private-badge {
  display: inline-block;
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgba(100, 60, 160, 0.2);
  color: #a080d0;
  border: 1px solid rgba(100, 60, 160, 0.3);
  margin-left: 6px;
  vertical-align: middle;
}

/* ── Save-private label in save dialog ──────────────────────────── */
.vab-save-private-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #8898b0;
  margin-bottom: 12px;
  cursor: pointer;
}
.vab-save-private-label input[type="checkbox"] {
  accent-color: #6050a0;
  cursor: pointer;
}

/* ── Disabled load button ───────────────────────────────────────── */
.vab-load-card-load-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
`;
  document.head.appendChild(style);
  _libraryCssInjected = true;
}

/**
 * Restore a saved RocketDesign into the VAB assembly and staging.
 *
 * @param {import('../core/gameState.js').RocketDesign} design
 */
function _loadDesignIntoVab(design) {
  if (!_gameState) return;

  // Refund current assembly parts before clearing (or return inventory parts).
  if (_assembly) {
    for (const [instId, placed] of _assembly.parts) {
      _refundOrReturnPart(instId, placed.partId);
    }
  }

  // Clear and rebuild assembly from the design.
  _assembly = createRocketAssembly();
  _stagingConfig = createStagingConfig();

  // Deduct costs and place parts.
  for (const p of design.parts) {
    const def = getPartById(p.partId);
    if (def) _gameState.money -= def.cost;
    const instId = addPartToAssembly(_assembly, p.partId, p.position.x, p.position.y);
    // Restore loaded instruments on science modules.
    if (p.instruments?.length) {
      const placed = _assembly.parts.get(instId);
      if (placed) placed.instruments = [...p.instruments];
    }
  }

  // Rebuild connections by checking snap-point overlap (same pattern as launchPad).
  _rebuildConnectionsFromSnaps(_assembly);

  // Restore staging from the design.
  if (design.staging && Array.isArray(design.staging.stages)) {
    // The design stores staging as instanceId arrays. Since addPartToAssembly
    // generates instanceIds sequentially (inst-1, inst-2, ...) matching the
    // order of design.parts, we can map the saved staging directly.
    _stagingConfig = {
      stages:          design.staging.stages.map(ids => ({
        instanceIds: Array.isArray(ids) ? [...ids] : [],
      })),
      unstaged:        Array.isArray(design.staging.unstaged) ? [...design.staging.unstaged] : [],
      currentStageIdx: 0,
    };
  }

  syncStagingWithAssembly(_assembly, _stagingConfig);

  _currentDesignId   = design.id;
  _currentDesignName = design.name;
  _setSelectedPart(null);

  // Re-render everything.
  vabSetAssembly(_assembly);
  vabRenderParts();
  _renderStagingPanel();
  _runAndRenderValidation();
  _updateStatusBar();
  _updateScaleBarExtents();
  _updateOffscreenIndicators();

  // Refresh cash display.
  const cashEl = document.getElementById('vab-cash');
  if (cashEl && _gameState) cashEl.textContent = fmt$(_gameState.money);
}

/**
 * Rebuild part connections by checking snap-point overlap.
 * Same algorithm as launchPad.js _rebuildConnections.
 *
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 */
function _rebuildConnectionsFromSnaps(assembly) {
  const OPPOSITE_SIDE = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const SNAP_TOLERANCE = 1;
  const parts = [...assembly.parts.values()];
  const occupied = new Set();

  for (let i = 0; i < parts.length; i++) {
    const pA = parts[i];
    const defA = getPartById(pA.partId);
    if (!defA) continue;

    for (let j = i + 1; j < parts.length; j++) {
      const pB = parts[j];
      const defB = getPartById(pB.partId);
      if (!defB) continue;

      for (let si = 0; si < defA.snapPoints.length; si++) {
        const spA = defA.snapPoints[si];
        const keyA = `${pA.instanceId}:${si}`;
        if (occupied.has(keyA)) continue;

        const awx = pA.x + spA.offsetX;
        const awy = pA.y - spA.offsetY;
        const neededSide = OPPOSITE_SIDE[spA.side];

        for (let sj = 0; sj < defB.snapPoints.length; sj++) {
          const spB = defB.snapPoints[sj];
          if (spB.side !== neededSide) continue;
          const keyB = `${pB.instanceId}:${sj}`;
          if (occupied.has(keyB)) continue;

          const bwx = pB.x + spB.offsetX;
          const bwy = pB.y - spB.offsetY;

          if (Math.abs(awx - bwx) < SNAP_TOLERANCE && Math.abs(awy - bwy) < SNAP_TOLERANCE) {
            connectParts(assembly, pA.instanceId, si, pB.instanceId, sj);
            occupied.add(keyA);
            occupied.add(keyB);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------

/**
 * Entry point called when the enabled Launch button is clicked.
 * If the rocket has crewed command modules, shows the crew assignment dialog.
 * Otherwise launches uncrewed immediately.
 */
function _handleLaunchClicked() {
  if (!_assembly || !_gameState || !_lastValidation?.canLaunch) return;

  // Count total available crew seats across all crewed command modules.
  let totalSeats = 0;
  for (const placed of _assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def?.type === PartType.COMMAND_MODULE) {
      totalSeats += def.properties?.seats ?? 0;
    }
  }

  if (totalSeats > 0) {
    _showCrewDialog(totalSeats);
  } else {
    // Uncrewed rocket — no dialog needed.
    _doLaunch([]);
  }
}

/**
 * Show the crew assignment modal.
 * Each seat gets a select dropdown listing all active crew members.
 * Duplicate selections across seats are ignored on confirm.
 *
 * @param {number} totalSeats  Number of seats to display.
 */
function _showCrewDialog(totalSeats) {
  if (!_gameState) return;

  const activeCrew = getActiveCrew(_gameState);

  // Build crew option HTML (reused for every seat select).
  const crewOpts = activeCrew.map(
    (c) => `<option value="${c.id}">${c.name}</option>`,
  ).join('');

  // Build one row per seat.
  const seatRows = [];
  for (let i = 0; i < totalSeats; i++) {
    seatRows.push(
      `<div class="vab-crew-seat-row">` +
        `<span class="vab-crew-seat-label">Seat ${i + 1}</span>` +
        `<select class="vab-crew-seat-select" data-seat="${i}">` +
          `<option value="">— Empty —</option>` +
          crewOpts +
        `</select>` +
      `</div>`,
    );
  }

  const infoMsg = activeCrew.length === 0
    ? `<p style="font-size:10px;color:#c07030;margin-bottom:10px;line-height:1.6;">` +
      `No active crew to assign.<br>Seats will launch empty.</p>`
    : `<p style="font-size:10px;color:#3a6080;margin-bottom:12px;line-height:1.6;">` +
      `Assign crew to seats before launch.<br>Seats may be left empty.</p>`;

  const overlay = document.createElement('div');
  overlay.id = 'vab-crew-overlay';
  overlay.innerHTML =
    `<div id="vab-crew-dialog">` +
      `<div class="vab-crew-dlg-hdr">Crew Assignment</div>` +
      `<div class="vab-crew-dlg-body">` +
        infoMsg +
        seatRows.join('') +
      `</div>` +
      `<div class="vab-crew-dlg-footer">` +
        `<button class="vab-btn" id="vab-crew-cancel" type="button">Cancel</button>` +
        `<button class="vab-btn vab-btn-launch" id="vab-crew-confirm" type="button">Launch</button>` +
      `</div>` +
    `</div>`;

  document.body.appendChild(overlay);

  // Close on backdrop click.
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#vab-crew-cancel')?.addEventListener('click', () => {
    overlay.remove();
  });

  overlay.querySelector('#vab-crew-confirm')?.addEventListener('click', () => {
    // Collect unique, non-empty crew IDs from the seat selects.
    const selects  = overlay.querySelectorAll('.vab-crew-seat-select');
    const crewIds  = [];
    const seen     = new Set();
    for (const sel of selects) {
      const id = /** @type {HTMLSelectElement} */ (sel).value;
      if (id && !seen.has(id)) {
        crewIds.push(id);
        seen.add(id);
      }
    }
    overlay.remove();
    _doLaunch(crewIds);
  });
}

/**
 * Create the initial FlightState, store it in game state, and transition to
 * the flight scene.  The actual flight renderer is implemented in TASK-027;
 * for now a transient overlay confirms the launch.
 *
 * @param {string[]} crewIds  IDs of crew members assigned to this launch.
 */
function _doLaunch(crewIds) {
  if (!_gameState || !_assembly) return;

  // Associate with the first accepted mission if one exists.
  const missionId = _gameState.missions.accepted[0]?.id ?? '';

  // Sum up initial fuel load across all parts.
  let totalFuel = 0;
  for (const placed of _assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def) totalFuel += def.properties?.fuelMass ?? 0;
  }

  // Auto-save the current rocket design so it can be re-launched from the launch pad.
  const launchDesign = createRocketDesign({
    id:          'launch-' + Date.now(),
    name:        'VAB Launch ' + new Date().toLocaleDateString(),
    parts:       [..._assembly.parts.values()].map(p => ({ partId: p.partId, position: { x: p.x, y: p.y }, ...(p.instruments?.length ? { instruments: [...p.instruments] } : {}) })),
    staging:     { stages: _stagingConfig.stages.map(s => [...s.instanceIds]), unstaged: [..._stagingConfig.unstaged] },
    totalMass:   _lastValidation?.totalMassKg ?? 0,
    totalThrust: _lastValidation?.stage1Thrust ?? 0,
  });
  _gameState.rockets.push(launchDesign);

  // Write the live flight state into game state.
  _gameState.currentFlight = {
    missionId,
    rocketId:        launchDesign.id,
    crewIds,
    timeElapsed:     0,
    altitude:        0,
    velocity:        0,
    fuelRemaining:   totalFuel,
    deltaVRemaining: 0,
    events:          [],
    aborted:         false,
  };

  console.log('[VAB] Launch initiated', {
    missionId:    missionId || '(none)',
    crewCount:    crewIds.length,
    crewIds,
    totalMassKg:  _lastValidation?.totalMassKg ?? 0,
    stage1Thrust: _lastValidation?.stage1Thrust ?? 0,
    twr:          (_lastValidation?.twr ?? 0).toFixed(2),
  });

  // Hide the VAB DOM overlay so it does not sit on top of the flight scene.
  const vabRoot = document.getElementById('vab-root');
  if (vabRoot) vabRoot.style.display = 'none';

  // Transition to the flight scene.
  // Deep-clone the staging config so flight mutations (currentStageIdx advancing,
  // etc.) do not corrupt the VAB's copy — the player's staging setup is preserved
  // when they return to the VAB after flight.
  const flightStagingConfig = {
    stages:          _stagingConfig.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
    unstaged:        [..._stagingConfig.unstaged],
    currentStageIdx: _stagingConfig.currentStageIdx,
  };

  const container = _container ?? document.getElementById('ui-overlay');
  if (container) {
    startFlightScene(
      container,
      _gameState,
      _assembly,
      flightStagingConfig,
      _gameState.currentFlight,
      (_state, returnResults, navigateTo) => {
        if (navigateTo === 'vab') {
          // "Retry with Same Design" — re-show the VAB directly without
          // going through the hub.  The module-level _assembly and
          // _stagingConfig are still intact (deep-cloned before flight).
          if (vabRoot) vabRoot.style.display = '';
          _renderStagingPanel();
          _runAndRenderValidation();
          return;
        }

        // Flight ended — restore the #vab-root and invoke the back callback
        // (which navigates to the hub).
        if (vabRoot) vabRoot.style.display = '';
        _onBack?.();

        // If the player chose "Return to Space Agency" (as opposed to
        // "Restart"), returnResults will be set.  Show the Return Results
        // summary overlay on top of the newly-mounted hub screen.
        if (returnResults) {
          const uiOverlay = container;
          showReturnResultsOverlay(uiOverlay, returnResults);
        }
      },
    );
  }
}

/**
 * Display a temporary "launch initiated" overlay until the flight scene
 * renderer is implemented in TASK-027.
 */
function _showLaunchInitiatedOverlay() {
  const banner = document.createElement('div');
  banner.id = 'vab-launch-banner';
  banner.innerHTML =
    `<div class="vab-launch-msg">` +
      `<div class="vab-launch-title">Launch Initiated</div>` +
      `<div class="vab-launch-sub">` +
        `Crew aboard: ${_gameState?.currentFlight?.crewIds?.length ?? 0}<br>` +
        `TWR: ${(_lastValidation?.twr ?? 0).toFixed(2)}<br>` +
        `<br>Flight scene coming in a later build.` +
      `</div>` +
      `<button class="vab-btn" id="vab-launch-dismiss" type="button" ` +
              `style="margin-top:14px">Return to VAB</button>` +
    `</div>`;

  document.body.appendChild(banner);

  banner.querySelector('#vab-launch-dismiss')?.addEventListener('click', () => {
    if (_gameState) _gameState.currentFlight = null;
    banner.remove();
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
export function initVabUI(container, state, { onBack } = {}) {
  _onBack    = onBack ?? null;
  _container = container;

  // Inject styles once.
  injectRocketCardCSS();
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
      <div class="vab-toolbar-btns">
        <button class="vab-btn" id="vab-back-btn" type="button">&#8592; Hub</button>
        <button class="vab-btn" id="vab-btn-inventory" type="button">
          Inventory
        </button>
        <button class="vab-btn" id="vab-btn-engineer" type="button">
          Rocket Engineer
        </button>
        <button class="vab-btn" id="vab-btn-staging" type="button">
          Staging
        </button>
        <button class="vab-btn-symmetry" id="vab-btn-symmetry" type="button"
                aria-pressed="true" title="Toggle radial symmetry (mirrors parts placed on left/right snap points)">
          <span class="vab-btn-symmetry-icon">&#x2194;</span>Mirror
        </button>
        <button class="vab-btn vab-btn-clear-all" id="vab-btn-clear-all" type="button"
                title="Remove all parts from the rocket (refunds cost)">
          Clear All
        </button>
        <button class="vab-btn" id="vab-btn-save" type="button">Save</button>
        <button class="vab-btn" id="vab-btn-load" type="button">Library</button>
        <button class="vab-btn vab-btn-launch" id="vab-btn-launch" type="button" disabled>
          Launch
        </button>
        <span class="vab-toolbar-spacer"></span>
        <button class="vab-btn" id="vab-btn-fit" type="button" title="Zoom to fit rocket">Zoom to Fit</button>
        <label class="vab-toolbar-stat" title="Automatically zoom to fit after changes">
          <input type="checkbox" id="vab-chk-autozoom" checked> Auto Zoom
        </label>
        <input type="range" id="vab-zoom-slider" class="vab-zoom-slider"
               min="0.25" max="4" step="0.05" value="1"
               title="Zoom level">
        <span class="vab-toolbar-spacer"></span>
        <span class="vab-toolbar-stat" id="vab-status-parts">Parts: 0</span>
        <span class="vab-toolbar-stat" id="vab-status-mass">Mass: 0 kg</span>
        <span class="vab-toolbar-stat vab-toolbar-cost" id="vab-status-cost">Cost: $0</span>
      </div>
    </div>

    <!-- ── Main row ───────────────────────────────────────────────────── -->
    <div id="vab-main">

      <!-- Scale bar (left) -->
      <div id="vab-scale-bar">
        <div class="vab-scale-ticks" id="vab-scale-ticks"></div>
      </div>

      <!-- Build canvas (transparent — PixiJS renders grid beneath) -->
      <div id="vab-canvas-area">
        <div id="vab-selection-highlight" hidden></div>
      </div>

      <!-- Parts panel (right) -->
      <div id="vab-parts-panel">
        <div class="vab-parts-title">Parts</div>
        <div class="vab-parts-list" id="vab-parts-list">
          ${_buildPartsHTML(state)}
        </div>
        <div id="vab-part-detail" hidden></div>
      </div>

      <!-- Inventory side panel -->
      <div class="vab-side-panel" id="vab-inventory-panel" hidden>
        <div class="vab-side-hdr">
          <span>Part Inventory</span>
          <button class="vab-side-close" id="vab-inventory-close" type="button">&#x2715;</button>
        </div>
        <div class="vab-side-body vab-inv-body" id="vab-inventory-body"></div>
      </div>

      <!-- Staging side panel -->
      <div class="vab-side-panel" id="vab-staging-panel" hidden>
        <div class="vab-side-hdr">
          <span>Staging</span>
          <button class="vab-side-close" id="vab-staging-close" type="button">&#x2715;</button>
        </div>
        <div class="vab-side-body vab-staging-body" id="vab-staging-body"></div>
      </div>

      <!-- Rocket Engineer side panel -->
      <div class="vab-side-panel" id="vab-engineer-panel" hidden>
        <div class="vab-side-hdr">
          <span>Rocket Engineer</span>
          <button class="vab-side-close" id="vab-engineer-close" type="button">&#x2715;</button>
        </div>
        <div class="vab-side-body" id="vab-engineer-body">
          <p class="vab-side-empty">Add parts to validate your rocket.</p>
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
  // If a serialised assembly exists on the loaded game state, restore it
  // before the fresh-assembly fallback runs.
  _restoreVabFromGameState(state);

  // Preserve the existing assembly if the player is returning to VAB (e.g.
  // after going back to hub and re-entering).  Only create a fresh assembly
  // when entering VAB for the very first time or after resetVabUI().
  if (!_assembly) {
    _assembly = createRocketAssembly();
  }
  _gameState = state;
  vabSetAssembly(_assembly);

  // ── Staging configuration ──────────────────────────────────────────────────
  if (!_stagingConfig) {
    _stagingConfig = createStagingConfig();
  }

  // Expose internals for e2e testing (Playwright can verify assembly/staging state)
  window.__vabAssembly      = _assembly;
  window.__vabStagingConfig = _stagingConfig;
  const stagingBody = /** @type {HTMLElement} */ (root.querySelector('#vab-staging-body'));
  if (stagingBody) {
    _setupStagingDnD(stagingBody);  // Set up DnD once (event delegation survives re-renders).
    _renderStagingPanel();          // Initial render (empty assembly — shows one empty stage).
  }

  // ── Delete / Backspace: remove selected part ──────────────────────────────
  window.addEventListener('keydown', (e) => {
    if ((e.code !== 'Delete' && e.code !== 'Backspace') || !_selectedInstanceId || !_assembly) return;
    // Don't intercept Backspace when focus is inside an input/textarea.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    const idToRemove = _selectedInstanceId;
    _setSelectedPart(null);
    removePartFromAssembly(_assembly, idToRemove);
    _syncAndRenderStaging();
    vabRenderParts();
    _updateStatusBar();
    _updateScaleBarExtents();
    _updateOffscreenIndicators();
  });

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

  // ── Restore visual state if returning to a previous assembly ──────────────
  if (_assembly.parts.size > 0) {
    vabRenderParts(_assembly, _selectedInstanceId);
    _updateStatusBar();
    _updateOffscreenIndicators();
    if (_autoZoomEnabled) _doZoomToFit();
  }

  // ── Initial / restored validation run ─────────────────────────────────────
  _runAndRenderValidation();

  console.log('[VAB UI] Initialized');
}

/**
 * Reset VAB session state so the next call to `initVabUI` creates a fresh
 * empty rocket.  Call this when starting a new game or loading a save.
 */
export function resetVabUI() {
  _assembly         = null;
  _stagingConfig    = null;
  _selectedInstanceId = null;
  _lastValidation   = null;
  _inventoryUsedParts.clear();
  if (_gameState) {
    _gameState.vabAssembly     = null;
    _gameState.vabStagingConfig = null;
  }
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
 * Enable or disable the Launch button.
 * @param {boolean} valid  True when rocket validation passes.
 */
/**
 * Returns the current map of instanceId → InventoryPart for parts placed
 * from inventory in the VAB. Called by the flight controller to attach
 * wear tracking data to the physics state.
 * @returns {Map<string, import('../core/gameState.js').InventoryPart>}
 */
export function getVabInventoryUsedParts() {
  return _inventoryUsedParts;
}

export function vabSetLaunchEnabled(valid) {
  const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('vab-btn-launch'));
  if (btn) btn.disabled = !valid;
}

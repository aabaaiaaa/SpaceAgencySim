/**
 * _init.js — Orchestrator: initVabUI, resetVabUI, syncVabToGameState,
 * vabRefreshParts, getVabInventoryUsedParts, vabSetLaunchEnabled,
 * and the state restore logic.
 *
 * Imports from all other sub-modules and wires everything together.
 */

import { getPartById } from '../../data/parts.js';
import {
  createRocketAssembly,
  createStagingConfig,
  syncStagingWithAssembly,
} from '../../core/rocketbuilder.js';
import {
  VAB_TOOLBAR_HEIGHT,
  vabSetAssembly,
  vabRenderParts,
} from '../../render/vab.js';
import { injectRocketCardCSS } from '../rocketCardUtil.js';

import { getVabState, setVabState } from './_state.js';
import { VAB_CSS } from './_css.js';
import { injectStyleOnce } from '../injectStyle.js';
import { buildPartsHTML, setupPanelDrag } from './_partsPanel.js';
import { drawScaleTicks, updateScaleBarExtents } from './_scalebar.js';
import {
  setupCanvas,
  initContextMenu,
  setSelectedPart,
  doZoomToFit,
  updateOffscreenIndicators,
  setCanvasCallbacks,
  startDrag,
} from './_canvasInteraction.js';
import { renderInventoryPanel, refundOrReturnPart } from './_inventory.js';
import { renderStagingPanel, setupStagingDnD, syncAndRenderStaging, setStagingCallbacks } from './_staging.js';
import { renderEngineerPanel, runAndRenderValidation as rawRunAndRenderValidation } from './_engineerPanel.js';
import {
  handleSaveDesign,
  handleLoadDesign,
  showToast,
  setDesignLibraryCallbacks,
} from './_designLibrary.js';
import {
  handleLaunchClicked,
  setLaunchFlowCallbacks,
} from './_launchFlow.js';
import {
  updateStatusBar,
  bindButtons,
  bindKeyboardShortcuts,
  setPanelCallbacks,
} from './_panels.js';

// ---------------------------------------------------------------------------
// Wrapped helpers that close over the public API
// ---------------------------------------------------------------------------

/** Wrapper: runAndRenderValidation with the vabSetLaunchEnabled arg. */
function _runAndRenderValidation() {
  rawRunAndRenderValidation(vabSetLaunchEnabled);
}

/** Wrapper: refundOrReturnPart with the vabRefreshParts arg. */
function _refundOrReturnPart(instanceId, partId) {
  refundOrReturnPart(instanceId, partId, vabRefreshParts);
}

// ---------------------------------------------------------------------------
// Wire up cross-module callbacks (breaks circular dependencies)
// ---------------------------------------------------------------------------

setCanvasCallbacks({
  renderStagingPanel,
  runAndRenderValidation: _runAndRenderValidation,
  syncAndRenderStaging,
  updateStatusBar,
  updateOffscreenIndicators,
  showToast,
  vabRefreshParts,
});

setStagingCallbacks({
  runAndRenderValidation: _runAndRenderValidation,
  updateStatusBar,
  updateScaleBarExtents,
  updateOffscreenIndicators,
  doZoomToFit,
});

setDesignLibraryCallbacks({
  renderStagingPanel,
  runAndRenderValidation: _runAndRenderValidation,
  updateStatusBar,
  updateScaleBarExtents,
  updateOffscreenIndicators,
  setSelectedPart,
  refundOrReturnPart: _refundOrReturnPart,
  vabRefreshParts,
});

setLaunchFlowCallbacks({
  renderStagingPanel,
  runAndRenderValidation: _runAndRenderValidation,
});

setPanelCallbacks({
  renderStagingPanel,
  runAndRenderValidation: _runAndRenderValidation,
  syncAndRenderStaging,
  renderEngineerPanel,
  handleSaveDesign,
  handleLoadDesign,
  handleLaunchClicked,
  vabRefreshParts,
});

// ---------------------------------------------------------------------------
// VAB <-> gameState serialisation (persist assembly across save/load)
// ---------------------------------------------------------------------------

/**
 * Serialise the current VAB assembly and staging config onto `_gameState` so
 * that the next save call captures them.
 */
export function syncVabToGameState() {
  const S = getVabState();
  if (!S.assembly || !S.gameState) return;
  S.gameState.vabAssembly = {
    parts:         [...S.assembly.parts.values()],
    connections:   S.assembly.connections,
    symmetryPairs: S.assembly.symmetryPairs,
    _nextId:       S.assembly._nextId,
  };
  S.gameState.vabStagingConfig = S.stagingConfig;
}

/**
 * If the supplied game state carries a serialised VAB assembly, restore it
 * into the module-level state.
 * @param {import('../../core/gameState.js').GameState} state
 */
function _restoreVabFromGameState(state) {
  const S = getVabState();
  const saved = state.vabAssembly;
  if (!saved || !Array.isArray(saved.parts) || saved.parts.length === 0) return;

  S.assembly = {
    parts:         new Map(saved.parts.map(p => [p.instanceId, p])),
    connections:   saved.connections   ?? [],
    symmetryPairs: saved.symmetryPairs ?? [],
    _nextId:       saved._nextId       ?? 1,
  };

  if (state.vabStagingConfig) {
    S.stagingConfig = state.vabStagingConfig;
  }

  if (S.assembly && S.stagingConfig) {
    syncStagingWithAssembly(S.assembly, S.stagingConfig);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize the VAB HTML overlay.
 *
 * @param {HTMLElement} container
 * @param {import('../../core/gameState.js').GameState} state
 */
export function initVabUI(container, state, { onBack } = {}) {
  const S = getVabState();
  S.onBack    = onBack ?? null;
  S.container = container;

  // Inject styles once.
  injectRocketCardCSS();
  injectStyleOnce('vab-css', VAB_CSS);

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
          ${buildPartsHTML(state)}
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
  S.scaleTicks = root.querySelector('#vab-scale-ticks');
  const canvasArea = /** @type {HTMLElement} */ (root.querySelector('#vab-canvas-area'));

  const ro = new ResizeObserver(() => {
    S.buildAreaHeight = canvasArea.offsetHeight;
    drawScaleTicks();
  });
  ro.observe(canvasArea);

  S.buildAreaHeight = Math.max(1, window.innerHeight - VAB_TOOLBAR_HEIGHT);
  drawScaleTicks();

  // ── Rocket assembly ──────────────────────────────────────────────────────
  _restoreVabFromGameState(state);

  if (!S.assembly) {
    S.assembly = createRocketAssembly();
  }
  S.gameState = state;
  vabSetAssembly(S.assembly);

  // ── Staging configuration ────────────────────────────────────────────────
  if (!S.stagingConfig) {
    S.stagingConfig = createStagingConfig();
  }

  // Expose internals for e2e testing.
  window.__vabAssembly      = S.assembly;
  window.__vabStagingConfig = S.stagingConfig;
  const stagingBody = /** @type {HTMLElement} */ (root.querySelector('#vab-staging-body'));
  if (stagingBody) {
    setupStagingDnD(stagingBody);
    renderStagingPanel();
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  bindKeyboardShortcuts();

  // ── Canvas interactions ──────────────────────────────────────────────────
  setupCanvas(canvasArea);

  // ── Panel drag (new parts → canvas) ──────────────────────────────────────
  const partsPanel = /** @type {HTMLElement} */ (root.querySelector('#vab-parts-panel'));
  setupPanelDrag(partsPanel, startDrag);

  // ── Context menu ─────────────────────────────────────────────────────────
  initContextMenu();

  // ── Toolbar buttons ──────────────────────────────────────────────────────
  bindButtons(root);

  // ── Restore visual state if returning to a previous assembly ─────────────
  if (S.assembly.parts.size > 0) {
    vabRenderParts(S.assembly, S.selectedInstanceId);
    updateStatusBar();
    updateOffscreenIndicators();
    if (S.autoZoomEnabled) doZoomToFit();
  }

  // ── Initial / restored validation run ────────────────────────────────────
  _runAndRenderValidation();

  console.log('[VAB UI] Initialized');
}

/**
 * Reset VAB session state so the next call to `initVabUI` creates a fresh
 * empty rocket.
 */
export function resetVabUI() {
  const S = getVabState();
  S.assembly         = null;
  S.stagingConfig    = null;
  S.selectedInstanceId = null;
  S.lastValidation   = null;
  S.inventoryUsedParts.clear();
  if (S.gameState) {
    S.gameState.vabAssembly     = null;
    S.gameState.vabStagingConfig = null;
  }
}

/**
 * Refresh the parts list from an updated game state.
 * @param {import('../../core/gameState.js').GameState} state
 */
export function vabRefreshParts(state) {
  const el = document.getElementById('vab-parts-list');
  if (el) el.innerHTML = buildPartsHTML(state);
}

/**
 * Returns the current map of instanceId → InventoryPart for parts placed
 * from inventory in the VAB.
 * @returns {Map<string, import('../../core/gameState.js').InventoryPart>}
 */
export function getVabInventoryUsedParts() {
  return getVabState().inventoryUsedParts;
}

/**
 * Enable or disable the Launch button.
 * @param {boolean} valid
 */
export function vabSetLaunchEnabled(valid) {
  const btn = /** @type {HTMLButtonElement|null} */ (document.getElementById('vab-btn-launch'));
  if (btn) btn.disabled = !valid;
}

/**
 * _panels.ts — Panel toggling, button bindings, status bar updates.
 */

import { getPartById } from '../../data/parts.js';
import { FacilityId, VAB_MAX_PARTS } from '../../core/constants.js';
import { getFacilityTier } from '../../core/construction.js';
import { getTotalMass } from '../../core/rocketvalidator.js';
import {
  VAB_SCALE_BAR_WIDTH,
  vabSetZoomCentred,
  vabRenderParts,
} from '../../render/vab.js';
import {
  removePartFromAssembly,
  fireStagingStep,
  syncStagingWithAssembly,
} from '../../core/rocketbuilder.js';
import {
  undo as undoAction,
  redo as redoAction,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
} from '../../core/undoRedo.js';
import {
  refurbishPart,
  scrapPart,
} from '../../core/partInventory.js';
import { refreshTopBar } from '../topbar.js';
import { getVabState, SIDE_PANEL_WIDTH } from './_state.js';
import { fmt$ } from './_partsPanel.js';
import { drawScaleTicks, updateScaleBarExtents } from './_scalebar.js';
import { renderInventoryPanel, refreshInventoryPanel, refundOrReturnPart } from './_inventory.js';
import {
  setSelectedPart,
  updateOffscreenIndicators,
  doZoomToFit,
  getRocketCenter,
} from './_canvasInteraction.js';
import {
  snapshotStaging,
  recordDeletion,
  recordClearAll,
} from './_undoActions.js';

import type { GameState } from '../../core/gameState.js';

// ---------------------------------------------------------------------------
// Forward references — set by _init.js to break circular deps
// ---------------------------------------------------------------------------
let _renderStagingPanelFn: () => void = () => {};
let _runAndRenderValidationFn: () => void = () => {};
let _syncAndRenderStagingFn: () => void = () => {};
let _renderEngineerPanelFn: () => void = () => {};
let _handleSaveDesignFn: () => void = () => {};
let _handleLoadDesignFn: () => void = () => {};
let _handleLaunchClickedFn: () => void = () => {};
let _vabRefreshPartsFn: (state: GameState) => void = (_state: GameState) => {};

export function setPanelCallbacks({
  renderStagingPanel,
  runAndRenderValidation,
  syncAndRenderStaging,
  renderEngineerPanel,
  handleSaveDesign,
  handleLoadDesign,
  handleLaunchClicked,
  vabRefreshParts,
}: {
  renderStagingPanel: () => void;
  runAndRenderValidation: () => void;
  syncAndRenderStaging: () => void;
  renderEngineerPanel: () => void;
  handleSaveDesign: () => void;
  handleLoadDesign: () => void;
  handleLaunchClicked: () => void;
  vabRefreshParts: (state: GameState) => void;
}): void {
  _renderStagingPanelFn = renderStagingPanel;
  _runAndRenderValidationFn = runAndRenderValidation;
  _syncAndRenderStagingFn = syncAndRenderStaging;
  _renderEngineerPanelFn = renderEngineerPanel;
  _handleSaveDesignFn = handleSaveDesign;
  _handleLoadDesignFn = handleLoadDesign;
  _handleLaunchClickedFn = handleLaunchClicked;
  _vabRefreshPartsFn = vabRefreshParts;
}

// ---------------------------------------------------------------------------
// Status bar (part count + cost)
// ---------------------------------------------------------------------------

/**
 * Update the parts count and cost readout in the status bar.
 */
export function updateStatusBar(): void {
  const S = getVabState();
  const partsEl = document.getElementById('vab-status-parts');
  const costEl  = document.getElementById('vab-status-cost');
  const massEl  = document.getElementById('vab-status-mass');
  if (!partsEl || !costEl || !S.assembly) return;

  const count = S.assembly.parts.size;
  let totalCost = 0;
  for (const placed of S.assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def) totalCost += def.cost;
  }

  const vabTier = S.gameState ? getFacilityTier(S.gameState, FacilityId.VAB) : 1;
  const maxParts = VAB_MAX_PARTS[vabTier] ?? VAB_MAX_PARTS[1];
  const limitLabel = isFinite(maxParts) ? `/${maxParts}` : '';
  partsEl.textContent = `Parts: ${count}${limitLabel}`;
  if (count > maxParts) partsEl.style.color = '#ff4444';
  else partsEl.style.color = '';

  costEl.textContent  = `Cost: ${fmt$(totalCost)}`;

  if (massEl) {
    const massKg = getTotalMass(S.assembly);
    massEl.textContent = massKg >= 1000
      ? `Mass: ${(massKg / 1000).toFixed(1)} t`
      : `Mass: ${massKg} kg`;
  }
}

// ---------------------------------------------------------------------------
// Panel toggling
// ---------------------------------------------------------------------------

/**
 * Recompute positions of all open side panels and the canvas area offset.
 */
export function recomputePanelPositions(): void {
  const S = getVabState();
  const root = document.getElementById('vab-main');
  if (!root) return;

  const panelMap: Record<string, HTMLElement | null> = {
    inventory: document.getElementById('vab-inventory-panel'),
    engineer:  document.getElementById('vab-engineer-panel'),
    staging:   document.getElementById('vab-staging-panel'),
  };

  let idx = 0;
  for (const [id, el] of Object.entries(panelMap)) {
    if (!el) continue;
    if (S.openPanels.has(id)) {
      el.style.left = `${VAB_SCALE_BAR_WIDTH + idx * SIDE_PANEL_WIDTH}px`;
      idx++;
    } else {
      el.setAttribute('hidden', '');
    }
  }

  if (S.canvasArea) {
    S.canvasArea.style.marginLeft = `${S.openPanels.size * SIDE_PANEL_WIDTH}px`;
  }
}

/**
 * Toggle a named side panel.
 */
export function togglePanel(panelId: string, onOpen?: () => void): void {
  const S = getVabState();
  const panelMap: Record<string, HTMLElement | null> = {
    inventory: document.getElementById('vab-inventory-panel'),
    engineer:  document.getElementById('vab-engineer-panel'),
    staging:   document.getElementById('vab-staging-panel'),
  };
  const el = panelMap[panelId];
  if (!el) return;

  if (S.openPanels.has(panelId)) {
    S.openPanels.delete(panelId);
  } else {
    S.openPanels.add(panelId);
    el.removeAttribute('hidden');
    if (onOpen) onOpen();
  }
  recomputePanelPositions();
}

// ---------------------------------------------------------------------------
// Button event bindings
// ---------------------------------------------------------------------------

export function bindButtons(root: HTMLElement): void {
  const S = getVabState();

  // ── "Hub" button ──
  root.querySelector('#vab-back-btn')?.addEventListener('click', () => {
    if (S.onBack) S.onBack();
  });

  // ── "Inventory" toggle ──
  root.querySelector('#vab-btn-inventory')?.addEventListener('click', () => {
    togglePanel('inventory', () => renderInventoryPanel());
  });

  root.querySelector('#vab-inventory-close')?.addEventListener('click', () => {
    S.openPanels.delete('inventory');
    recomputePanelPositions();
  });

  // Inventory panel: refurbish / scrap actions (event delegation).
  root.querySelector('#vab-inventory-body')?.addEventListener('click', (e: Event) => {
    const btn = (e.target as HTMLElement)?.closest?.('.vab-inv-btn') as HTMLElement | null;
    if (!btn || !S.gameState) return;
    const invId = btn.dataset.invId;
    if (!invId) return;

    if (btn.classList.contains('vab-inv-btn-refurb')) {
      const result = refurbishPart(S.gameState, invId);
      if (result.success) {
        renderInventoryPanel();
        refreshTopBar();
        _vabRefreshPartsFn(S.gameState);
      }
    } else if (btn.classList.contains('vab-inv-btn-scrap')) {
      const result = scrapPart(S.gameState, invId);
      if (result.success) {
        renderInventoryPanel();
        refreshTopBar();
        _vabRefreshPartsFn(S.gameState);
      }
    }
  });

  // ── "Rocket Engineer" toggle ──
  root.querySelector('#vab-btn-engineer')?.addEventListener('click', () => {
    togglePanel('engineer', () => _renderEngineerPanelFn());
  });

  root.querySelector('#vab-engineer-close')?.addEventListener('click', () => {
    S.openPanels.delete('engineer');
    recomputePanelPositions();
  });

  // ── "Staging" toggle ──
  root.querySelector('#vab-btn-staging')?.addEventListener('click', () => {
    togglePanel('staging', () => _renderStagingPanelFn());
  });

  root.querySelector('#vab-staging-close')?.addEventListener('click', () => {
    S.openPanels.delete('staging');
    recomputePanelPositions();
  });

  // ── Symmetry toggle ──
  const symmetryBtn = root.querySelector('#vab-btn-symmetry') as HTMLButtonElement | null;
  if (symmetryBtn) {
    symmetryBtn.setAttribute('aria-pressed', String(S.symmetryMode));
    symmetryBtn.addEventListener('click', () => {
      S.symmetryMode = !S.symmetryMode;
      symmetryBtn.setAttribute('aria-pressed', String(S.symmetryMode));
    });
  }

  // ── Clear All ──
  root.querySelector('#vab-btn-clear-all')?.addEventListener('click', () => {
    if (!S.assembly || S.assembly.parts.size === 0) return;
    if (!confirm('Remove all parts? This will refund their cost.')) return;
    // Compute total cost for undo and snapshot staging.
    let totalCost = 0;
    for (const placed of S.assembly.parts.values()) {
      const def = getPartById(placed.partId);
      if (def) totalCost += def.cost;
    }
    const stagingBefore = snapshotStaging();
    recordClearAll(totalCost, stagingBefore);
    for (const [instId, placed] of S.assembly.parts) {
      refundOrReturnPart(instId, placed.partId, _vabRefreshPartsFn);
    }
    S.assembly.parts.clear();
    S.assembly.connections.length = 0;
    S.assembly.symmetryPairs.length = 0;
    setSelectedPart(null);
    S.currentDesignId   = null;
    S.currentDesignName = '';
    _syncAndRenderStagingFn();
    vabRenderParts();
    updateStatusBar();
    updateScaleBarExtents();
    updateOffscreenIndicators();
    refreshInventoryPanel();
    const cashEl = document.getElementById('vab-cash');
    if (cashEl && S.gameState) cashEl.textContent = fmt$(S.gameState.money);
  });

  // ── Undo ──
  root.querySelector('#vab-btn-undo')?.addEventListener('click', () => {
    if (!canUndo() || !S.assembly || !S.stagingConfig) return;
    undoAction();
    syncStagingWithAssembly(S.assembly, S.stagingConfig);
    _refreshAfterUndoRedo();
  });

  // ── Redo ──
  root.querySelector('#vab-btn-redo')?.addEventListener('click', () => {
    if (!canRedo() || !S.assembly || !S.stagingConfig) return;
    redoAction();
    syncStagingWithAssembly(S.assembly, S.stagingConfig);
    _refreshAfterUndoRedo();
  });

  // ── Save design ──
  root.querySelector('#vab-btn-save')?.addEventListener('click', () => {
    _handleSaveDesignFn();
  });

  // ── Load design ──
  root.querySelector('#vab-btn-load')?.addEventListener('click', () => {
    _handleLoadDesignFn();
  });

  // ── Launch ──
  root.querySelector('#vab-btn-launch')?.addEventListener('click', () => {
    if (!S.lastValidation?.canLaunch) return;
    _handleLaunchClickedFn();
  });

  // ── Fit (zoom-to-fit) button ──
  root.querySelector('#vab-btn-fit')?.addEventListener('click', () => {
    doZoomToFit();
  });

  // ── Auto-zoom checkbox ──
  root.querySelector('#vab-chk-autozoom')?.addEventListener('change', (e: Event) => {
    S.autoZoomEnabled = (e.target as HTMLInputElement).checked;
    if (S.autoZoomEnabled) doZoomToFit();
  });

  // ── Zoom slider ──
  root.querySelector('#vab-zoom-slider')?.addEventListener('input', (e: Event) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    const c = getRocketCenter();
    vabSetZoomCentred(value, c.x, c.y);
    drawScaleTicks();
    updateScaleBarExtents();
    updateOffscreenIndicators();
  });
}

/**
 * Bind Delete/Backspace key to remove selected part and Spacebar for staging.
 */
export function bindKeyboardShortcuts(): void {
  const S = getVabState();

  // Delete / Backspace: remove selected part.
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.code !== 'Delete' && e.code !== 'Backspace') || !S.selectedInstanceId || !S.assembly) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    e.preventDefault();
    const idToRemove = S.selectedInstanceId;
    const placed = S.assembly.parts.get(idToRemove);
    const costRefund = placed ? (getPartById(placed.partId)?.cost ?? 0) : 0;
    const stagingBefore = snapshotStaging();
    recordDeletion([idToRemove], costRefund, stagingBefore);
    setSelectedPart(null);
    removePartFromAssembly(S.assembly, idToRemove);
    _syncAndRenderStagingFn();
    vabRenderParts();
    updateStatusBar();
    updateScaleBarExtents();
    updateOffscreenIndicators();
  });

  // Ctrl+Z: undo. Ctrl+Y / Ctrl+Shift+Z: redo.
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (!S.assembly || !S.stagingConfig) return;

    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyZ') {
      e.preventDefault();
      if (!canUndo()) return;
      undoAction();
      syncStagingWithAssembly(S.assembly, S.stagingConfig);
      _refreshAfterUndoRedo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.code === 'KeyY' || (e.shiftKey && e.code === 'KeyZ'))) {
      e.preventDefault();
      if (!canRedo()) return;
      redoAction();
      syncStagingWithAssembly(S.assembly, S.stagingConfig);
      _refreshAfterUndoRedo();
      return;
    }
  });

  // Spacebar: fire next stage during flight.
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Space' || !S.flightActive || !S.stagingConfig) return;
    e.preventDefault();
    fireStagingStep(S.stagingConfig);
    _renderStagingPanelFn();
  });
}

/**
 * Refresh all VAB UI elements after an undo/redo operation.
 */
function _refreshAfterUndoRedo(): void {
  vabRenderParts();
  _renderStagingPanelFn();
  _runAndRenderValidationFn();
  updateStatusBar();
  updateScaleBarExtents();
  updateOffscreenIndicators();
  refreshInventoryPanel();
  updateUndoRedoButtons();
  refreshTopBar();
}

/**
 * Update undo/redo toolbar button states (disabled + title).
 */
export function updateUndoRedoButtons(): void {
  const undoBtn = document.getElementById('vab-btn-undo') as HTMLButtonElement | null;
  const redoBtn = document.getElementById('vab-btn-redo') as HTMLButtonElement | null;
  if (undoBtn) {
    undoBtn.disabled = !canUndo();
    const label = peekUndoLabel();
    undoBtn.title = label ? `Undo: ${label}` : 'Undo (Ctrl+Z)';
  }
  if (redoBtn) {
    redoBtn.disabled = !canRedo();
    const label = peekRedoLabel();
    redoBtn.title = label ? `Redo: ${label}` : 'Redo (Ctrl+Y)';
  }
}

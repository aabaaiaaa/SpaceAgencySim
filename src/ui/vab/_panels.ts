/**
 * _panels.ts — Panel toggling, button bindings, status bar updates.
 */

import { getPartById } from '../../data/parts.ts';
import { FacilityId, VAB_MAX_PARTS } from '../../core/constants.ts';
import { getFacilityTier } from '../../core/construction.ts';
import { getTotalMass } from '../../core/rocketvalidator.ts';
import {
  VAB_SCALE_BAR_WIDTH,
  vabSetZoomCentred,
  vabRenderParts,
} from '../../render/vab.ts';
import {
  removePartFromAssembly,
  fireStagingStep,
  syncStagingWithAssembly,
} from '../../core/rocketbuilder.ts';
import {
  undo as undoAction,
  redo as redoAction,
  canUndo,
  canRedo,
  peekUndoLabel,
  peekRedoLabel,
} from '../../core/undoRedo.ts';
import {
  refurbishPart,
  scrapPart,
  computeAssemblyCashCost,
} from '../../core/partInventory.ts';
import { refreshTopBar } from '../topbar.ts';
import { getVabState, SIDE_PANEL_WIDTH, PARTS_PANEL_WIDTH } from './_state.ts';
import { fmt$ } from './_partsPanel.ts';
import { drawScaleTicks, updateScaleBarExtents } from './_scalebar.ts';
import { renderInventoryPanel, refreshInventoryPanel, refundOrReturnPart, toggleInventoryGroup } from './_inventory.ts';
import {
  setSelectedPart,
  updateOffscreenIndicators,
  doZoomToFit,
  getRocketCenter,
} from './_canvasInteraction.ts';
import {
  snapshotStaging,
  recordDeletion,
  recordClearAll,
} from './_undoActions.ts';
import { getVabListenerTracker } from './_listenerTracker.ts';

import type { GameState } from '../../core/gameState.ts';

/**
 * Register a DOM listener through the VAB tracker so it is cleaned up when
 * the VAB is destroyed.
 */
function _addTracked(
  target: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const tracker = getVabListenerTracker();
  if (tracker) tracker.add(target, event, handler, options);
}

// ---------------------------------------------------------------------------
// Forward references — set by _init.js to break circular deps
// ---------------------------------------------------------------------------
let _renderStagingPanelFn: () => void = () => {};
let _runAndRenderValidationFn: () => void = () => {};
let _syncAndRenderStagingFn: () => void = () => {};
let _renderEngineerPanelFn: () => void = () => {};
let _handleSaveDesignFn: () => void | Promise<void> = () => {};
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
  handleSaveDesign: () => void | Promise<void>;
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
  const inventoryIds = new Set(S.inventoryUsedParts.keys());
  const totalCost = computeAssemblyCashCost(S.assembly, inventoryIds);

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
 *
 * Inventory docks on the right edge, immediately left of the parts panel.
 * Engineer and staging stack from the left, starting next to the scale bar.
 */
export function recomputePanelPositions(): void {
  const S = getVabState();
  const root = document.getElementById('vab-main');
  if (!root) return;

  const leftPanelOrder = ['engineer', 'staging'] as const;
  const leftPanels: Record<string, HTMLElement | null> = {
    engineer: document.getElementById('vab-engineer-panel'),
    staging:  document.getElementById('vab-staging-panel'),
  };
  const inventoryEl = document.getElementById('vab-inventory-panel');

  let leftIdx = 0;
  for (const id of leftPanelOrder) {
    const el = leftPanels[id];
    if (!el) continue;
    if (S.openPanels.has(id)) {
      el.style.left  = `${VAB_SCALE_BAR_WIDTH + leftIdx * SIDE_PANEL_WIDTH}px`;
      el.style.right = '';
      leftIdx++;
    } else {
      el.setAttribute('hidden', '');
    }
  }

  if (inventoryEl) {
    if (S.openPanels.has('inventory')) {
      inventoryEl.style.left  = 'auto';
      inventoryEl.style.right = `${PARTS_PANEL_WIDTH}px`;
    } else {
      inventoryEl.setAttribute('hidden', '');
    }
  }

  if (S.canvasArea) {
    S.canvasArea.style.marginLeft  = `${leftIdx * SIDE_PANEL_WIDTH}px`;
    S.canvasArea.style.marginRight = S.openPanels.has('inventory') ? `${SIDE_PANEL_WIDTH}px` : '';
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
  const backBtn = root.querySelector('#vab-back-btn');
  if (backBtn) _addTracked(backBtn, 'click', () => {
    if (S.onBack) S.onBack();
  });

  // ── "Inventory" toggle ──
  const invBtn = root.querySelector('#vab-btn-inventory');
  if (invBtn) _addTracked(invBtn, 'click', () => {
    togglePanel('inventory', () => renderInventoryPanel());
  });

  const invCloseBtn = root.querySelector('#vab-inventory-close');
  if (invCloseBtn) _addTracked(invCloseBtn, 'click', () => {
    S.openPanels.delete('inventory');
    recomputePanelPositions();
  });

  // Inventory panel: refurbish / scrap actions + group expand/collapse.
  const invBody = root.querySelector('#vab-inventory-body');
  if (invBody) _addTracked(invBody, 'click', (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    const btn = target.closest?.('.vab-inv-btn') as HTMLElement | null;
    if (btn && S.gameState) {
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
      return;
    }

    const groupHdr = target.closest?.('.vab-inv-group-toggle') as HTMLElement | null;
    if (groupHdr) {
      const partId = groupHdr.dataset.partId;
      if (partId) toggleInventoryGroup(partId);
    }
  });

  // ── "Rocket Engineer" toggle ──
  const engBtn = root.querySelector('#vab-btn-engineer');
  if (engBtn) _addTracked(engBtn, 'click', () => {
    togglePanel('engineer', () => _renderEngineerPanelFn());
  });

  const engCloseBtn = root.querySelector('#vab-engineer-close');
  if (engCloseBtn) _addTracked(engCloseBtn, 'click', () => {
    S.openPanels.delete('engineer');
    recomputePanelPositions();
  });

  // ── "Staging" toggle ──
  const stgBtn = root.querySelector('#vab-btn-staging');
  if (stgBtn) _addTracked(stgBtn, 'click', () => {
    togglePanel('staging', () => _renderStagingPanelFn());
  });

  const stgCloseBtn = root.querySelector('#vab-staging-close');
  if (stgCloseBtn) _addTracked(stgCloseBtn, 'click', () => {
    S.openPanels.delete('staging');
    recomputePanelPositions();
  });

  // ── Symmetry toggle ──
  const symmetryBtn = root.querySelector('#vab-btn-symmetry') as HTMLButtonElement | null;
  if (symmetryBtn) {
    symmetryBtn.setAttribute('aria-pressed', String(S.symmetryMode));
    _addTracked(symmetryBtn, 'click', () => {
      S.symmetryMode = !S.symmetryMode;
      symmetryBtn.setAttribute('aria-pressed', String(S.symmetryMode));
    });
  }

  // ── Clear All ──
  const clearAllBtn = root.querySelector('#vab-btn-clear-all');
  if (clearAllBtn) _addTracked(clearAllBtn, 'click', () => {
    if (!S.assembly || S.assembly.parts.size === 0) return;
    if (!confirm('Remove all parts? This will refund their cost.')) return;
    // Compute cash refund for undo (inventory-sourced parts refund no cash; they
    // return to inventory instead — see refundOrReturnPart).
    const inventoryIdsForClear = new Set(S.inventoryUsedParts.keys());
    const totalCost = computeAssemblyCashCost(S.assembly, inventoryIdsForClear);
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
  const undoBtn = root.querySelector('#vab-btn-undo');
  if (undoBtn) _addTracked(undoBtn, 'click', () => {
    if (!canUndo() || !S.assembly || !S.stagingConfig) return;
    undoAction();
    syncStagingWithAssembly(S.assembly, S.stagingConfig);
    _refreshAfterUndoRedo();
  });

  // ── Redo ──
  const redoBtn = root.querySelector('#vab-btn-redo');
  if (redoBtn) _addTracked(redoBtn, 'click', () => {
    if (!canRedo() || !S.assembly || !S.stagingConfig) return;
    redoAction();
    syncStagingWithAssembly(S.assembly, S.stagingConfig);
    _refreshAfterUndoRedo();
  });

  // ── Save design ──
  const saveBtn = root.querySelector('#vab-btn-save');
  if (saveBtn) _addTracked(saveBtn, 'click', () => {
    void _handleSaveDesignFn();
  });

  // ── Load design ──
  const loadBtn = root.querySelector('#vab-btn-load');
  if (loadBtn) _addTracked(loadBtn, 'click', () => {
    _handleLoadDesignFn();
  });

  // ── Launch ──
  const launchBtn = root.querySelector('#vab-btn-launch');
  if (launchBtn) _addTracked(launchBtn, 'click', () => {
    if (!S.lastValidation?.canLaunch) return;
    _handleLaunchClickedFn();
  });

  // ── Fit (zoom-to-fit) button ──
  const fitBtn = root.querySelector('#vab-btn-fit');
  if (fitBtn) _addTracked(fitBtn, 'click', () => {
    doZoomToFit();
  });

  // ── Auto-zoom checkbox ──
  const autoZoomChk = root.querySelector('#vab-chk-autozoom');
  if (autoZoomChk) _addTracked(autoZoomChk, 'change', (e: Event) => {
    S.autoZoomEnabled = (e.target as HTMLInputElement).checked;
    if (S.autoZoomEnabled) doZoomToFit();
  });

  // ── Zoom slider ──
  const zoomSlider = root.querySelector('#vab-zoom-slider');
  if (zoomSlider) _addTracked(zoomSlider, 'input', (e: Event) => {
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
  const tracker = getVabListenerTracker();
  if (!tracker) throw new Error('VAB listener tracker not initialised');
  const addKeydown = (handler: (e: KeyboardEvent) => void): void => {
    tracker.add(window, 'keydown', handler as EventListener);
  };

  // Delete / Backspace: remove selected part.
  addKeydown((e: KeyboardEvent) => {
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
  addKeydown((e: KeyboardEvent) => {
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
  addKeydown((e: KeyboardEvent) => {
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

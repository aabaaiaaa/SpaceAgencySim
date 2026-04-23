/**
 * _canvasInteraction.ts — Hit-testing placed parts, drag/drop on canvas,
 * snap highlights, context menu, part selection/highlight.
 */

import { getPartById } from '../../data/parts.ts';
import type { PartDef } from '../../data/parts.ts';
import { PartType } from '../../core/constants.ts';
import {
  VAB_TOOLBAR_HEIGHT,
  VAB_SCALE_BAR_WIDTH,
  vabGetCamera,
  vabScreenToWorld,
  vabPanCamera,
  vabSetDragGhost,
  vabMoveDragGhost,
  vabClearDragGhost,
  vabShowSnapHighlights,
  vabClearSnapHighlights,
  vabSetMirrorGhost,
  vabClearMirrorGhost,
  vabRenderParts,
  vabSetSelectedLegAnimation,
  vabClearSelectedLegAnimation,
  vabZoomToFit,
  vabSetZoomCentred,
} from '../../render/vab.ts';
import {
  addPartToAssembly,
  removePartFromAssembly,
  movePlacedPart,
  connectParts,
  disconnectPart,
  findSnapCandidates,
  findMirrorCandidate,
  addSymmetryPair,
  getMirrorPartId,
  autoStageNewPart,
} from '../../core/rocketbuilder.ts';
import type { PlacedPart, PartConnection } from '../../core/rocketbuilder.ts';
import { removeFromInventory } from '../../core/partInventory.ts';
import type { InventoryPart } from '../../core/gameState.ts';
import { FacilityId, VAB_MAX_PARTS } from '../../core/constants.ts';
import { getFacilityTier } from '../../core/construction.ts';
import { getRocketBounds } from '../../core/rocketvalidator.ts';
import { refreshTopBar } from '../topbar.ts';
import { getVabState } from './_state.ts';
import { showPartDetail, fmt$ } from './_partsPanel.ts';
import { drawScaleTicks, updateScaleBarExtents } from './_scalebar.ts';
import { refreshInventoryPanel, refundOrReturnPart } from './_inventory.ts';
import {
  snapshotStaging,
  recordPlacement,
  recordDeletion,
  recordMove,
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
let _updateStatusBarFn: () => void = () => {};
let _updateOffscreenIndicatorsFn: () => void = () => {};
let _showToastFn: (msg: string) => void = (_msg: string) => {};
let _vabRefreshPartsFn: (state: GameState) => void = (_state: GameState) => {};

/**
 * Pre-move state captured when a placed part is picked up, before
 * disconnectPart() severs its connections.
 */
let _preMoveData: { oldX: number; oldY: number; oldConnections: PartConnection[] } | null = null;

export function setCanvasCallbacks({
  renderStagingPanel,
  runAndRenderValidation,
  syncAndRenderStaging,
  updateStatusBar,
  updateOffscreenIndicators,
  showToast,
  vabRefreshParts,
}: {
  renderStagingPanel: () => void;
  runAndRenderValidation: () => void;
  syncAndRenderStaging: () => void;
  updateStatusBar: () => void;
  updateOffscreenIndicators: () => void;
  showToast: (msg: string) => void;
  vabRefreshParts: (state: GameState) => void;
}): void {
  _renderStagingPanelFn = renderStagingPanel;
  _runAndRenderValidationFn = runAndRenderValidation;
  _syncAndRenderStagingFn = syncAndRenderStaging;
  _updateStatusBarFn = updateStatusBar;
  _updateOffscreenIndicatorsFn = updateOffscreenIndicators;
  _showToastFn = showToast;
  _vabRefreshPartsFn = vabRefreshParts;
}

// ---------------------------------------------------------------------------
// Hit-testing helpers
// ---------------------------------------------------------------------------

/**
 * Find the topmost placed part whose bounding rectangle contains worldX/Y.
 */
export function hitTestPlacedPart(worldX: number, worldY: number): PlacedPart | null {
  const S = getVabState();
  if (!S.assembly) return null;
  const all = [...S.assembly.parts.values()];
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
// Selection highlight
// ---------------------------------------------------------------------------

/**
 * Select or deselect a placed part by instanceId.
 */
export function setSelectedPart(instanceId: string | null): void {
  const S = getVabState();
  S.selectedInstanceId = instanceId;
  const highlight = document.getElementById('vab-selection-highlight');
  if (!highlight) return;

  if (!instanceId || !S.assembly) {
    highlight.setAttribute('hidden', '');
    vabClearSelectedLegAnimation();
    return;
  }

  const placed = S.assembly.parts.get(instanceId);
  const def = placed ? getPartById(placed.partId) : null;
  if (!placed || !def) {
    highlight.setAttribute('hidden', '');
    vabClearSelectedLegAnimation();
    return;
  }

  updateSelectionHighlight(placed, def, highlight);
  highlight.removeAttribute('hidden');

  // Animate leg struts on selected landing leg parts.
  if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
    vabSetSelectedLegAnimation(instanceId, placed.x, placed.y, def);
  } else {
    vabClearSelectedLegAnimation();
  }

  // Show detail for the selected part.
  showPartDetail(placed.partId);
}

/**
 * Reposition the selection highlight div over the selected part.
 */
function updateSelectionHighlight(placed: PlacedPart, def: PartDef, highlight: HTMLElement): void {
  positionHighlightOverPart(placed, def, highlight);
}

/**
 * Position an absolutely-positioned DOM element over a placed part so it
 * aligns with the part's canvas-space rectangle at the current camera zoom.
 */
function positionHighlightOverPart(placed: PlacedPart, def: PartDef, highlight: HTMLElement): void {
  const { zoom, x: camX, y: camY } = vabGetCamera();

  const S = getVabState();
  const canvasArea = S.canvasArea;
  if (!canvasArea) return;

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

/**
 * Show a transient hover highlight over the placed part with the given
 * instanceId, or clear it when null is passed. Unlike setSelectedPart this
 * only affects the visual overlay — it does not mutate state, animate legs,
 * or open the detail panel.
 */
export function setHoveredPart(instanceId: string | null): void {
  const highlight = document.getElementById('vab-hover-highlight');
  if (!highlight) return;

  const S = getVabState();
  if (!instanceId || !S.assembly) {
    highlight.setAttribute('hidden', '');
    return;
  }

  const placed = S.assembly.parts.get(instanceId);
  const def    = placed ? getPartById(placed.partId) : null;
  if (!placed || !def) {
    highlight.setAttribute('hidden', '');
    return;
  }

  positionHighlightOverPart(placed, def, highlight);
  highlight.removeAttribute('hidden');
}

// ---------------------------------------------------------------------------
// Auto-zoom helper
// ---------------------------------------------------------------------------

/** Return the world-space centre of the current rocket, or (0,0) if empty. */
export function getRocketCenter(): { x: number; y: number } {
  const S = getVabState();
  if (!S.assembly) return { x: 0, y: 0 };
  const bounds = getRocketBounds(S.assembly);
  if (!bounds) return { x: 0, y: 0 };
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function doZoomToFit(): void {
  const S = getVabState();
  if (!S.assembly) return;
  const bounds = getRocketBounds(S.assembly);
  if (bounds) vabZoomToFit(bounds);
  syncZoomSlider();
}

/**
 * Sync the zoom slider value with the current camera zoom level.
 */
export function syncZoomSlider(): void {
  const slider = document.getElementById('vab-zoom-slider') as HTMLInputElement | null;
  if (slider) slider.value = String(vabGetCamera().zoom);
}

// ---------------------------------------------------------------------------
// Off-screen part indicators
// ---------------------------------------------------------------------------

/**
 * Update the arrow indicators for any placed parts outside the visible canvas.
 */
export function updateOffscreenIndicators(): void {
  const S = getVabState();
  if (!S.canvasArea || !S.assembly) return;

  // Remove existing indicators.
  const existing = S.canvasArea.querySelectorAll('.vab-offscreen-indicator');
  existing.forEach((el) => el.remove());

  const { zoom, x: camX, y: camY } = vabGetCamera();
  const canvasW = S.canvasArea.offsetWidth;
  const canvasH = S.canvasArea.offsetHeight;

  for (const placed of S.assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;

    const sx = camX + placed.x * zoom;
    const sy = camY - placed.y * zoom;

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

    const margin = 8;
    const size   = 20;
    let indX = Math.max(margin, Math.min(canvasW - margin - size, sx));
    let indY = Math.max(margin, Math.min(canvasH - margin - size, sy));
    let arrow = '?';

    if (offLeft)  { indX = margin; arrow = '\u25C0'; }
    if (offRight) { indX = canvasW - margin - size; arrow = '\u25B6'; }
    if (offTop)   { indY = margin; arrow = '\u25B2'; }
    if (offBot)   { indY = canvasH - margin - size; arrow = '\u25BC'; }

    const ind = document.createElement('div');
    ind.className = 'vab-offscreen-indicator';
    ind.style.left = `${indX}px`;
    ind.style.top  = `${indY}px`;
    ind.title      = def.name;
    ind.textContent = arrow;
    S.canvasArea.appendChild(ind);
  }
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

/**
 * Initialise the right-click context menu DOM element (created once).
 */
export function initContextMenu(): void {
  const S = getVabState();
  S.ctxMenu = document.createElement('div');
  S.ctxMenu.id = 'vab-ctx-menu';
  S.ctxMenu.setAttribute('hidden', '');
  document.body.appendChild(S.ctxMenu);

  // Clicking anywhere outside the menu dismisses it.
  const tracker = getVabListenerTracker();
  if (!tracker) throw new Error('VAB listener tracker not initialised');
  tracker.add(document, 'pointerdown', ((e: PointerEvent) => {
    if (S.ctxMenu && !S.ctxMenu.contains(e.target as Node)) {
      S.ctxMenu.setAttribute('hidden', '');
    }
  }) as EventListener, { capture: true });
}

/**
 * Show the context menu for a placed part.
 */
function showPartContextMenu(placed: PlacedPart, clientX: number, clientY: number): void {
  const S = getVabState();
  if (!S.ctxMenu) return;

  const def = getPartById(placed.partId);
  const costLabel = def ? ` (+${fmt$(def.cost)})` : '';
  const mirrorId = S.assembly ? getMirrorPartId(S.assembly, placed.instanceId) : null;

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

  S.ctxMenu.innerHTML = menuHtml;
  S.ctxMenu.style.left = `${clientX}px`;
  S.ctxMenu.style.top  = `${clientY}px`;
  S.ctxMenu.removeAttribute('hidden');

  const ctxRemoveBtn = S.ctxMenu.querySelector('#vab-ctx-remove');
  if (ctxRemoveBtn) _addTracked(ctxRemoveBtn, 'click', () => {
    S.ctxMenu!.setAttribute('hidden', '');
    const stagingBefore = snapshotStaging();
    const costRefund = getPartById(placed.partId)?.cost ?? 0;
    recordDeletion([placed.instanceId], costRefund, stagingBefore);
    refundOrReturnPart(placed.instanceId, placed.partId, _vabRefreshPartsFn);
    if (S.selectedInstanceId === placed.instanceId) setSelectedPart(null);
    removePartFromAssembly(S.assembly!, placed.instanceId);
    _syncAndRenderStagingFn();
    vabRenderParts();
    refreshInventoryPanel();
  }, { once: true });

  if (mirrorId) {
    const ctxRemoveBothBtn = S.ctxMenu.querySelector('#vab-ctx-remove-both');
    if (ctxRemoveBothBtn) _addTracked(ctxRemoveBothBtn, 'click', () => {
      S.ctxMenu!.setAttribute('hidden', '');
      const stagingBefore = snapshotStaging();
      const mirrorPlaced = S.assembly!.parts.get(mirrorId);
      const cost1 = getPartById(placed.partId)?.cost ?? 0;
      const cost2 = getPartById(mirrorPlaced?.partId ?? placed.partId)?.cost ?? 0;
      recordDeletion([placed.instanceId, mirrorId], cost1 + cost2, stagingBefore);
      refundOrReturnPart(placed.instanceId, placed.partId, _vabRefreshPartsFn);
      refundOrReturnPart(mirrorId, mirrorPlaced?.partId ?? placed.partId, _vabRefreshPartsFn);
      if (S.selectedInstanceId === placed.instanceId || S.selectedInstanceId === mirrorId) setSelectedPart(null);
      removePartFromAssembly(S.assembly!, placed.instanceId);
      removePartFromAssembly(S.assembly!, mirrorId);
      _syncAndRenderStagingFn();
      vabRenderParts();
      refreshInventoryPanel();
    }, { once: true });
  }
}

// ---------------------------------------------------------------------------
// Drag lifecycle
// ---------------------------------------------------------------------------

/**
 * Begin dragging a part (from panel or by picking up a placed part).
 */
export function startDrag(partId: string, instanceId: string | null, clientX: number, clientY: number): void {
  const S = getVabState();
  S.dragState = { partId, instanceId, startX: clientX, startY: clientY, hasMoved: false };
  if (instanceId !== null) {
    vabSetDragGhost(partId, clientX, clientY);
  }
  const tracker = getVabListenerTracker();
  if (!tracker) throw new Error('VAB listener tracker not initialised');
  tracker.add(window, 'pointermove',   onDragMove   as EventListener, { capture: true });
  tracker.add(window, 'pointerup',     onDragEnd    as EventListener, { capture: true });
  tracker.add(window, 'pointercancel', cancelDrag   as EventListener, { capture: true });
}

/**
 * Begin dragging a specific inventory entry from the inventory panel.
 * On drop, that inventory entry is consumed (free) instead of buying new.
 */
export function startInventoryDrag(partId: string, inventoryEntryId: string, clientX: number, clientY: number): void {
  const S = getVabState();
  S.dragState = { partId, instanceId: null, startX: clientX, startY: clientY, hasMoved: false, inventoryEntryId };
  const tracker = getVabListenerTracker();
  if (!tracker) throw new Error('VAB listener tracker not initialised');
  tracker.add(window, 'pointermove',   onDragMove   as EventListener, { capture: true });
  tracker.add(window, 'pointerup',     onDragEnd    as EventListener, { capture: true });
  tracker.add(window, 'pointercancel', cancelDrag   as EventListener, { capture: true });
}

/**
 * Cancel an in-progress drag.
 */
function cancelDrag(): void {
  const S = getVabState();
  if (!S.dragState && !S.pendingPickup) return;
  window.removeEventListener('pointermove',  onDragMove,  { capture: true });
  window.removeEventListener('pointerup',    onDragEnd,   { capture: true });
  window.removeEventListener('pointercancel', cancelDrag, { capture: true });

  const instanceId = S.dragState ? S.dragState.instanceId : null;
  S.dragState = null;
  S.pendingPickup = null;
  vabClearDragGhost();
  vabClearSnapHighlights();
  vabClearMirrorGhost();

  if (instanceId !== null) {
    vabRenderParts();
  }
}

/**
 * Global pointermove handler during a drag.
 */
function onDragMove(e: PointerEvent): void {
  const S = getVabState();
  if (!S.dragState) return;

  if (!S.dragState.hasMoved) {
    const dx = e.clientX - S.dragState.startX;
    const dy = e.clientY - S.dragState.startY;
    if (Math.hypot(dx, dy) < 8) return;
    S.dragState.hasMoved = true;
    if (S.dragState.instanceId === null) {
      vabSetDragGhost(S.dragState.partId, e.clientX, e.clientY);
    }
  }

  vabMoveDragGhost(e.clientX, e.clientY);

  const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
  const { zoom } = vabGetCamera();
  const candidates = findSnapCandidates(
    S.assembly!, S.dragState.partId, worldX, worldY, zoom,
  );

  if (candidates.length > 0) {
    vabShowSnapHighlights(candidates);
    if (S.symmetryMode) {
      const mirror = findMirrorCandidate(S.assembly!, candidates[0], S.dragState.partId);
      if (mirror) {
        vabSetMirrorGhost(S.dragState.partId, mirror.mirrorWorldX, mirror.mirrorWorldY);
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
 */
function onDragEnd(e: PointerEvent): void {
  const S = getVabState();
  if (!S.dragState) return;

  window.removeEventListener('pointermove',  onDragMove,  { capture: true });
  window.removeEventListener('pointerup',    onDragEnd,   { capture: true });
  window.removeEventListener('pointercancel', cancelDrag, { capture: true });

  const { partId, instanceId, hasMoved, inventoryEntryId } = S.dragState;
  S.dragState = null;

  vabClearDragGhost();
  vabClearSnapHighlights();
  vabClearMirrorGhost();

  if (!hasMoved) {
    if (instanceId === null) {
      showPartDetail(partId);
    }
    return;
  }

  // --- Drop on parts panel or open inventory panel = discard / delete ---
  const partsPanel = document.getElementById('vab-parts-panel');
  const inventoryPanel = document.getElementById('vab-inventory-panel');
  const isOverRect = (el: HTMLElement | null): boolean => {
    if (!el || el.hasAttribute('hidden')) return false;
    const r = el.getBoundingClientRect();
    return (
      e.clientX >= r.left && e.clientX <= r.right &&
      e.clientY >= r.top  && e.clientY <= r.bottom
    );
  };
  if (isOverRect(partsPanel) || isOverRect(inventoryPanel)) {
    if (instanceId !== null) {
      // Record deletion undo BEFORE removing (uses pre-move connections).
      const stagingBefore = snapshotStaging();
      const costRefund = getPartById(partId)?.cost ?? 0;
      // Re-add the old connections temporarily so recordDeletion can capture them.
      if (_preMoveData) {
        for (const c of _preMoveData.oldConnections) S.assembly!.connections.push({ ...c });
        // Restore old position temporarily for accurate snapshot.
        const p = S.assembly!.parts.get(instanceId);
        if (p) { p.x = _preMoveData.oldX; p.y = _preMoveData.oldY; }
      }
      recordDeletion([instanceId], costRefund, stagingBefore);
      // Remove the temporary connections before the actual removal.
      if (_preMoveData) {
        for (let i = S.assembly!.connections.length - 1; i >= 0; i--) {
          const c = S.assembly!.connections[i];
          if (c.fromInstanceId === instanceId || c.toInstanceId === instanceId) {
            S.assembly!.connections.splice(i, 1);
          }
        }
      }
      _preMoveData = null;
      refundOrReturnPart(instanceId, partId, _vabRefreshPartsFn);
      if (S.selectedInstanceId === instanceId) setSelectedPart(null);
      removePartFromAssembly(S.assembly!, instanceId);
      _syncAndRenderStagingFn();
      _runAndRenderValidationFn();
      refreshInventoryPanel();
    }
    vabRenderParts();
    return;
  }

  // Determine world drop position.
  const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
  const { zoom } = vabGetCamera();

  const candidates = findSnapCandidates(S.assembly!, partId, worldX, worldY, zoom);
  let finalX = worldX;
  let finalY = worldY;
  let bestCandidate = candidates.length > 0 ? candidates[0] : null;

  if (bestCandidate) {
    finalX = bestCandidate.snapWorldX;
    finalY = bestCandidate.snapWorldY;
  }

  if (instanceId !== null) {
    // Capture pre-move data for undo.
    const moveOldX = _preMoveData ? _preMoveData.oldX : finalX;
    const moveOldY = _preMoveData ? _preMoveData.oldY : finalY;
    const moveOldConns = _preMoveData ? _preMoveData.oldConnections : [];
    _preMoveData = null;

    // Re-place an already-placed part at new position.
    movePlacedPart(S.assembly!, instanceId, finalX, finalY);
    if (bestCandidate) {
      connectParts(
        S.assembly!,
        instanceId,                 bestCandidate.dragSnapIndex,
        bestCandidate.targetInstanceId, bestCandidate.targetSnapIndex,
      );
      const usedDragSnaps = new Set([bestCandidate.dragSnapIndex]);
      for (const c of candidates) {
        if (usedDragSnaps.has(c.dragSnapIndex)) continue;
        if (c.targetInstanceId === bestCandidate.targetInstanceId) continue;
        connectParts(S.assembly!, instanceId, c.dragSnapIndex, c.targetInstanceId, c.targetSnapIndex);
        usedDragSnaps.add(c.dragSnapIndex);
      }
      // Symmetry: if placing onto a radial socket and symmetry is on, mirror it.
      if (S.symmetryMode) {
        const mirror = findMirrorCandidate(S.assembly!, bestCandidate, partId);
        if (mirror) {
          const mirrorId = addPartToAssembly(S.assembly!, partId, mirror.mirrorWorldX, mirror.mirrorWorldY);
          connectParts(
            S.assembly!,
            mirrorId,                          mirror.mirrorDragSnapIndex,
            bestCandidate.targetInstanceId,    mirror.mirrorTargetSnapIndex,
          );
          addSymmetryPair(S.assembly!, instanceId, mirrorId);
          _syncAndRenderStagingFn();
          autoStageNewPart(S.assembly!, S.stagingConfig!, mirrorId);
          _renderStagingPanelFn();
          _runAndRenderValidationFn();
          // Auto-created mirror always buys new.
          const def = getPartById(partId);
          if (def && S.gameState) {
            S.gameState.money -= def.cost;
            refreshTopBar();
          }
        }
      }
    }

    // Capture new connections after the move and record undo action.
    const moveNewConns = S.assembly!.connections
      .filter(c => c.fromInstanceId === instanceId || c.toInstanceId === instanceId)
      .map(c => ({ ...c }));
    recordMove(instanceId, moveOldX, moveOldY, finalX, finalY, moveOldConns, moveNewConns);

    _runAndRenderValidationFn();
  } else {
    // ── VAB tier part-count gate ──────────────────────────────────────────
    if (S.gameState) {
      const vabTier = getFacilityTier(S.gameState, FacilityId.VAB);
      const maxParts = VAB_MAX_PARTS[vabTier] ?? VAB_MAX_PARTS[1];
      const partsToAdd = S.symmetryMode ? 2 : 1;
      if (S.assembly!.parts.size + partsToAdd > maxParts) {
        _showToastFn(`Part limit reached (${maxParts}). Upgrade the VAB for more parts.`);
        vabRenderParts();
        return;
      }
    }

    // Snapshot staging before placement for undo.
    const stagingBefore = snapshotStaging();
    const moneyBefore = S.gameState ? S.gameState.money : 0;

    // New part from the parts panel always buys new. If dragged from the
    // inventory panel, consume that specific entry (free) instead.
    const def = getPartById(partId);
    let invPart: InventoryPart | null = null;
    if (inventoryEntryId && S.gameState) {
      invPart = removeFromInventory(S.gameState, inventoryEntryId);
    }
    if (def && S.gameState && !invPart) {
      S.gameState.money -= def.cost;
    }
    refreshTopBar();
    const newId = addPartToAssembly(S.assembly!, partId, finalX, finalY);
    if (invPart) {
      S.inventoryUsedParts.set(newId, invPart);
    }
    if (bestCandidate) {
      connectParts(
        S.assembly!,
        newId,                          bestCandidate.dragSnapIndex,
        bestCandidate.targetInstanceId, bestCandidate.targetSnapIndex,
      );
      const usedDragSnaps2 = new Set([bestCandidate.dragSnapIndex]);
      for (const c of candidates) {
        if (usedDragSnaps2.has(c.dragSnapIndex)) continue;
        if (c.targetInstanceId === bestCandidate.targetInstanceId) continue;
        connectParts(S.assembly!, newId, c.dragSnapIndex, c.targetInstanceId, c.targetSnapIndex);
        usedDragSnaps2.add(c.dragSnapIndex);
      }
      // Symmetry: if placing onto a radial socket and symmetry is on, mirror it.
      if (S.symmetryMode) {
        const mirror = findMirrorCandidate(S.assembly!, bestCandidate, partId);
        if (mirror) {
          const mirrorId = addPartToAssembly(S.assembly!, partId, mirror.mirrorWorldX, mirror.mirrorWorldY);
          connectParts(
            S.assembly!,
            mirrorId,                          mirror.mirrorDragSnapIndex,
            bestCandidate.targetInstanceId,    mirror.mirrorTargetSnapIndex,
          );
          addSymmetryPair(S.assembly!, newId, mirrorId);
          // Auto-created mirror always buys new; player can drag a second
          // inventory copy from the inventory panel if they want.
          if (def && S.gameState) {
            S.gameState.money -= def.cost;
            refreshTopBar();
          }
        }
      }
    }
    // Sync staging — new activatable part(s) appear in the unstaged pool,
    // then auto-stage based on activation behaviour.
    _syncAndRenderStagingFn();
    autoStageNewPart(S.assembly!, S.stagingConfig!, newId);
    if (S.symmetryMode) {
      const mirrorPair = S.assembly!.symmetryPairs.find(
        ([a, b]) => a === newId || b === newId,
      );
      if (mirrorPair) {
        const mirrorId = mirrorPair[0] === newId ? mirrorPair[1] : mirrorPair[0];
        autoStageNewPart(S.assembly!, S.stagingConfig!, mirrorId);
      }
    }
    _renderStagingPanelFn();
    _runAndRenderValidationFn();

    // Record the placement for undo.
    const addedIds = [newId];
    const mirrorPairForUndo = S.assembly!.symmetryPairs.find(
      ([a, b]) => a === newId || b === newId,
    );
    if (mirrorPairForUndo) {
      const mId = mirrorPairForUndo[0] === newId ? mirrorPairForUndo[1] : mirrorPairForUndo[0];
      addedIds.push(mId);
    }
    const costDelta = moneyBefore - (S.gameState ? S.gameState.money : 0);
    recordPlacement(addedIds, costDelta, stagingBefore);
  }

  vabRenderParts();
  _updateStatusBarFn();
  updateScaleBarExtents();
  _updateOffscreenIndicatorsFn();
}

// ---------------------------------------------------------------------------
// Canvas panning, zooming, part drag & context menu
// ---------------------------------------------------------------------------

/**
 * Attach all pointer interactions to the build-canvas overlay div.
 */
export function setupCanvas(canvasArea: HTMLElement): void {
  const S = getVabState();
  S.canvasArea = canvasArea;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  _addTracked(canvasArea, 'pointerdown', ((e: PointerEvent) => {
    if (e.button !== 0) return;

    const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
    const hit = hitTestPlacedPart(worldX, worldY);

    if (hit) {
      S.pendingPickup = { hit, startX: e.clientX, startY: e.clientY };
      e.stopPropagation();
      return;
    }

    setSelectedPart(null);
    panning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvasArea.setPointerCapture(e.pointerId);
    canvasArea.classList.add('panning');
  }) as EventListener);

  _addTracked(canvasArea, 'pointermove', ((e: PointerEvent) => {
    if (S.pendingPickup) {
      const dx = e.clientX - S.pendingPickup.startX;
      const dy = e.clientY - S.pendingPickup.startY;
      if (Math.hypot(dx, dy) > 8) {
        const { hit } = S.pendingPickup;
        S.pendingPickup = null;
        // Capture pre-move state before disconnecting.
        _preMoveData = {
          oldX: hit.x,
          oldY: hit.y,
          oldConnections: S.assembly!.connections
            .filter(c => c.fromInstanceId === hit.instanceId || c.toInstanceId === hit.instanceId)
            .map(c => ({ ...c })),
        };
        disconnectPart(S.assembly!, hit.instanceId);
        startDrag(hit.partId, hit.instanceId, e.clientX, e.clientY);
      }
      return;
    }
    if (!panning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    vabPanCamera(dx, dy);
    drawScaleTicks();
    updateOffscreenIndicators();
  }) as EventListener);

  const _stopPan = (_e: PointerEvent): void => {
    if (S.pendingPickup) {
      setSelectedPart(S.pendingPickup.hit.instanceId);
      S.pendingPickup = null;
      return;
    }
    panning = false;
    canvasArea.classList.remove('panning');
  };
  _addTracked(canvasArea, 'pointerup',     _stopPan as EventListener);
  _addTracked(canvasArea, 'pointercancel', (() => {
    S.pendingPickup = null;
    panning = false;
    canvasArea.classList.remove('panning');
  }) as EventListener);

  // Right-click context menu for placed parts.
  _addTracked(canvasArea, 'contextmenu', ((e: MouseEvent) => {
    e.preventDefault();
    const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
    const hit = hitTestPlacedPart(worldX, worldY);
    if (hit) {
      showPartContextMenu(hit, e.clientX, e.clientY);
    }
  }) as EventListener);

  // Scroll-wheel zoom.
  _addTracked(canvasArea, 'wheel', ((e: WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const { zoom } = vabGetCamera();
    const c = getRocketCenter();
    vabSetZoomCentred(zoom * factor, c.x, c.y);
    drawScaleTicks();
    updateScaleBarExtents();
    updateOffscreenIndicators();
    syncZoomSlider();
  }) as EventListener, { passive: false });
}

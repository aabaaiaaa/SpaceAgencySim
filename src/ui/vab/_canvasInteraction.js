/**
 * _canvasInteraction.js — Hit-testing placed parts, drag/drop on canvas,
 * snap highlights, context menu, part selection/highlight.
 */

import { getPartById } from '../../data/parts.js';
import { PartType } from '../../core/constants.js';
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
} from '../../render/vab.js';
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
} from '../../core/rocketbuilder.js';
import { FacilityId, VAB_MAX_PARTS } from '../../core/constants.js';
import { getFacilityTier } from '../../core/construction.js';
import { useInventoryPart } from '../../core/partInventory.js';
import { getRocketBounds } from '../../core/rocketvalidator.js';
import { refreshTopBar } from '../topbar.js';
import { getVabState } from './_state.js';
import { showPartDetail, fmt$ } from './_partsPanel.js';
import { drawScaleTicks, updateScaleBarExtents } from './_scalebar.js';
import { refreshInventoryPanel, refundOrReturnPart } from './_inventory.js';

// ---------------------------------------------------------------------------
// Forward references — set by _init.js to break circular deps
// ---------------------------------------------------------------------------
let _renderStagingPanelFn = () => {};
let _runAndRenderValidationFn = () => {};
let _syncAndRenderStagingFn = () => {};
let _updateStatusBarFn = () => {};
let _updateOffscreenIndicatorsFn = () => {};
let _showToastFn = (_msg) => {};
let _vabRefreshPartsFn = (_state) => {};

export function setCanvasCallbacks({
  renderStagingPanel,
  runAndRenderValidation,
  syncAndRenderStaging,
  updateStatusBar,
  updateOffscreenIndicators,
  showToast,
  vabRefreshParts,
}) {
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
 * @param {number} worldX
 * @param {number} worldY
 * @returns {import('../../core/rocketbuilder.js').PlacedPart | null}
 */
export function hitTestPlacedPart(worldX, worldY) {
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
 * @param {string | null} instanceId
 */
export function setSelectedPart(instanceId) {
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
 * @param {import('../../core/rocketbuilder.js').PlacedPart} placed
 * @param {import('../../data/parts.js').PartDef} def
 * @param {HTMLElement} highlight
 */
function updateSelectionHighlight(placed, def, highlight) {
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

// ---------------------------------------------------------------------------
// Auto-zoom helper
// ---------------------------------------------------------------------------

/** Return the world-space centre of the current rocket, or (0,0) if empty. */
export function getRocketCenter() {
  const S = getVabState();
  if (!S.assembly) return { x: 0, y: 0 };
  const bounds = getRocketBounds(S.assembly);
  if (!bounds) return { x: 0, y: 0 };
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function doZoomToFit() {
  const S = getVabState();
  if (!S.assembly) return;
  const bounds = getRocketBounds(S.assembly);
  if (bounds) vabZoomToFit(bounds);
  syncZoomSlider();
}

/**
 * Sync the zoom slider value with the current camera zoom level.
 */
export function syncZoomSlider() {
  const slider = /** @type {HTMLInputElement|null} */ (document.getElementById('vab-zoom-slider'));
  if (slider) slider.value = String(vabGetCamera().zoom);
}

// ---------------------------------------------------------------------------
// Off-screen part indicators
// ---------------------------------------------------------------------------

/**
 * Update the arrow indicators for any placed parts outside the visible canvas.
 */
export function updateOffscreenIndicators() {
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
export function initContextMenu() {
  const S = getVabState();
  S.ctxMenu = document.createElement('div');
  S.ctxMenu.id = 'vab-ctx-menu';
  S.ctxMenu.setAttribute('hidden', '');
  document.body.appendChild(S.ctxMenu);

  // Clicking anywhere outside the menu dismisses it.
  document.addEventListener('pointerdown', (e) => {
    if (S.ctxMenu && !S.ctxMenu.contains(e.target)) {
      S.ctxMenu.setAttribute('hidden', '');
    }
  }, { capture: true });
}

/**
 * Show the context menu for a placed part.
 * @param {import('../../core/rocketbuilder.js').PlacedPart} placed
 * @param {number} clientX
 * @param {number} clientY
 */
function showPartContextMenu(placed, clientX, clientY) {
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

  S.ctxMenu.querySelector('#vab-ctx-remove')?.addEventListener('click', () => {
    S.ctxMenu.setAttribute('hidden', '');
    refundOrReturnPart(placed.instanceId, placed.partId, _vabRefreshPartsFn);
    if (S.selectedInstanceId === placed.instanceId) setSelectedPart(null);
    removePartFromAssembly(S.assembly, placed.instanceId);
    _syncAndRenderStagingFn();
    vabRenderParts();
    refreshInventoryPanel();
  }, { once: true });

  if (mirrorId) {
    S.ctxMenu.querySelector('#vab-ctx-remove-both')?.addEventListener('click', () => {
      S.ctxMenu.setAttribute('hidden', '');
      refundOrReturnPart(placed.instanceId, placed.partId, _vabRefreshPartsFn);
      const mirrorPlaced = S.assembly.parts.get(mirrorId);
      refundOrReturnPart(mirrorId, mirrorPlaced?.partId ?? placed.partId, _vabRefreshPartsFn);
      if (S.selectedInstanceId === placed.instanceId || S.selectedInstanceId === mirrorId) setSelectedPart(null);
      removePartFromAssembly(S.assembly, placed.instanceId);
      removePartFromAssembly(S.assembly, mirrorId);
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
 * @param {string}      partId
 * @param {string|null} instanceId
 * @param {number}      clientX
 * @param {number}      clientY
 */
export function startDrag(partId, instanceId, clientX, clientY) {
  const S = getVabState();
  S.dragState = { partId, instanceId, startX: clientX, startY: clientY, hasMoved: false };
  if (instanceId !== null) {
    vabSetDragGhost(partId, clientX, clientY);
  }
  window.addEventListener('pointermove',  onDragMove,   { capture: true });
  window.addEventListener('pointerup',    onDragEnd,    { capture: true });
  window.addEventListener('pointercancel', cancelDrag,  { capture: true });
}

/**
 * Cancel an in-progress drag.
 */
function cancelDrag() {
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
 * @param {PointerEvent} e
 */
function onDragMove(e) {
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
    S.assembly, S.dragState.partId, worldX, worldY, zoom,
  );

  if (candidates.length > 0) {
    vabShowSnapHighlights(candidates);
    if (S.symmetryMode) {
      const mirror = findMirrorCandidate(S.assembly, candidates[0], S.dragState.partId);
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
 * @param {PointerEvent} e
 */
function onDragEnd(e) {
  const S = getVabState();
  if (!S.dragState) return;

  window.removeEventListener('pointermove',  onDragMove,  { capture: true });
  window.removeEventListener('pointerup',    onDragEnd,   { capture: true });
  window.removeEventListener('pointercancel', cancelDrag, { capture: true });

  const { partId, instanceId, hasMoved } = S.dragState;
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
        refundOrReturnPart(instanceId, partId, _vabRefreshPartsFn);
        if (S.selectedInstanceId === instanceId) setSelectedPart(null);
        removePartFromAssembly(S.assembly, instanceId);
        _syncAndRenderStagingFn();
        _runAndRenderValidationFn();
        refreshInventoryPanel();
      }
      vabRenderParts();
      return;
    }
  }

  // Determine world drop position.
  const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
  const { zoom } = vabGetCamera();

  const candidates = findSnapCandidates(S.assembly, partId, worldX, worldY, zoom);
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
    movePlacedPart(S.assembly, instanceId, finalX, finalY);
    if (bestCandidate) {
      connectParts(
        S.assembly,
        instanceId,                 bestCandidate.dragSnapIndex,
        bestCandidate.targetInstanceId, bestCandidate.targetSnapIndex,
      );
      const usedDragSnaps = new Set([bestCandidate.dragSnapIndex]);
      for (const c of candidates) {
        if (usedDragSnaps.has(c.dragSnapIndex)) continue;
        if (c.targetInstanceId === bestCandidate.targetInstanceId) continue;
        connectParts(S.assembly, instanceId, c.dragSnapIndex, c.targetInstanceId, c.targetSnapIndex);
        usedDragSnaps.add(c.dragSnapIndex);
      }
      // Symmetry: if placing onto a radial socket and symmetry is on, mirror it.
      if (S.symmetryMode) {
        const mirror = findMirrorCandidate(S.assembly, bestCandidate, partId);
        if (mirror) {
          const mirrorId = addPartToAssembly(S.assembly, partId, mirror.mirrorWorldX, mirror.mirrorWorldY);
          connectParts(
            S.assembly,
            mirrorId,                          mirror.mirrorDragSnapIndex,
            bestCandidate.targetInstanceId,    mirror.mirrorTargetSnapIndex,
          );
          addSymmetryPair(S.assembly, instanceId, mirrorId);
          _syncAndRenderStagingFn();
          autoStageNewPart(S.assembly, S.stagingConfig, mirrorId);
          _renderStagingPanelFn();
          _runAndRenderValidationFn();
          // Deduct cost for the mirror copy (or use inventory).
          const def = getPartById(partId);
          if (def && S.gameState) {
            const mirrorInv = useInventoryPart(S.gameState, partId);
            if (mirrorInv) {
              S.inventoryUsedParts.set(mirrorId, mirrorInv);
              const mirrorPlaced = S.assembly.parts.get(mirrorId);
              if (mirrorPlaced) mirrorPlaced._fromInventory = true;
            } else {
              S.gameState.money -= def.cost;
            }
            refreshTopBar();
          }
        }
      }
    }
    _runAndRenderValidationFn();
  } else {
    // ── VAB tier part-count gate ──────────────────────────────────────────
    if (S.gameState) {
      const vabTier = getFacilityTier(S.gameState, FacilityId.VAB);
      const maxParts = VAB_MAX_PARTS[vabTier] ?? VAB_MAX_PARTS[1];
      const partsToAdd = S.symmetryMode ? 2 : 1;
      if (S.assembly.parts.size + partsToAdd > maxParts) {
        _showToastFn(`Part limit reached (${maxParts}). Upgrade the VAB for more parts.`);
        vabRenderParts();
        return;
      }
    }

    // New part from the panel — use inventory (free) or buy new (deduct cost).
    const def = getPartById(partId);
    if (def && S.gameState) {
      var invPart = useInventoryPart(S.gameState, partId);
      if (!invPart) {
        S.gameState.money -= def.cost;
      }
      refreshTopBar();
    }
    const newId = addPartToAssembly(S.assembly, partId, finalX, finalY);
    // Track inventory-sourced part.
    if (invPart) {
      S.inventoryUsedParts.set(newId, invPart);
      const placed = S.assembly.parts.get(newId);
      if (placed) placed._fromInventory = true;
    }
    if (bestCandidate) {
      connectParts(
        S.assembly,
        newId,                          bestCandidate.dragSnapIndex,
        bestCandidate.targetInstanceId, bestCandidate.targetSnapIndex,
      );
      const usedDragSnaps2 = new Set([bestCandidate.dragSnapIndex]);
      for (const c of candidates) {
        if (usedDragSnaps2.has(c.dragSnapIndex)) continue;
        if (c.targetInstanceId === bestCandidate.targetInstanceId) continue;
        connectParts(S.assembly, newId, c.dragSnapIndex, c.targetInstanceId, c.targetSnapIndex);
        usedDragSnaps2.add(c.dragSnapIndex);
      }
      // Symmetry: if placing onto a radial socket and symmetry is on, mirror it.
      if (S.symmetryMode) {
        const mirror = findMirrorCandidate(S.assembly, bestCandidate, partId);
        if (mirror) {
          const mirrorId = addPartToAssembly(S.assembly, partId, mirror.mirrorWorldX, mirror.mirrorWorldY);
          connectParts(
            S.assembly,
            mirrorId,                          mirror.mirrorDragSnapIndex,
            bestCandidate.targetInstanceId,    mirror.mirrorTargetSnapIndex,
          );
          addSymmetryPair(S.assembly, newId, mirrorId);
          // Deduct cost for the mirror copy (or use inventory).
          if (def && S.gameState) {
            const mirrorInv = useInventoryPart(S.gameState, partId);
            if (mirrorInv) {
              S.inventoryUsedParts.set(mirrorId, mirrorInv);
              const mirrorPlaced = S.assembly.parts.get(mirrorId);
              if (mirrorPlaced) mirrorPlaced._fromInventory = true;
            } else {
              S.gameState.money -= def.cost;
            }
            refreshTopBar();
          }
        }
      }
    }
    // Sync staging — new activatable part(s) appear in the unstaged pool,
    // then auto-stage based on activation behaviour.
    _syncAndRenderStagingFn();
    autoStageNewPart(S.assembly, S.stagingConfig, newId);
    if (S.symmetryMode) {
      const mirrorPair = S.assembly.symmetryPairs.find(
        ([a, b]) => a === newId || b === newId,
      );
      if (mirrorPair) {
        const mirrorId = mirrorPair[0] === newId ? mirrorPair[1] : mirrorPair[0];
        autoStageNewPart(S.assembly, S.stagingConfig, mirrorId);
      }
    }
    _renderStagingPanelFn();
    _runAndRenderValidationFn();
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
 * @param {HTMLElement} canvasArea
 */
export function setupCanvas(canvasArea) {
  const S = getVabState();
  S.canvasArea = canvasArea;
  let panning = false;
  let lastX = 0;
  let lastY = 0;

  canvasArea.addEventListener('pointerdown', (e) => {
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
  });

  canvasArea.addEventListener('pointermove', (e) => {
    if (S.pendingPickup) {
      const dx = e.clientX - S.pendingPickup.startX;
      const dy = e.clientY - S.pendingPickup.startY;
      if (Math.hypot(dx, dy) > 8) {
        const { hit } = S.pendingPickup;
        S.pendingPickup = null;
        disconnectPart(S.assembly, hit.instanceId);
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
  });

  const _stopPan = (e) => {
    if (S.pendingPickup) {
      setSelectedPart(S.pendingPickup.hit.instanceId);
      S.pendingPickup = null;
      return;
    }
    panning = false;
    canvasArea.classList.remove('panning');
  };
  canvasArea.addEventListener('pointerup',     _stopPan);
  canvasArea.addEventListener('pointercancel', () => {
    S.pendingPickup = null;
    panning = false;
    canvasArea.classList.remove('panning');
  });

  // Right-click context menu for placed parts.
  canvasArea.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { worldX, worldY } = vabScreenToWorld(e.clientX, e.clientY);
    const hit = hitTestPlacedPart(worldX, worldY);
    if (hit) {
      showPartContextMenu(hit, e.clientX, e.clientY);
    }
  });

  // Scroll-wheel zoom.
  canvasArea.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const { zoom } = vabGetCamera();
    const c = getRocketCenter();
    vabSetZoomCentred(zoom * factor, c.x, c.y);
    drawScaleTicks();
    updateScaleBarExtents();
    updateOffscreenIndicators();
    syncZoomSlider();
  }, { passive: false });
}

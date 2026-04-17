/**
 * _designLibrary.ts — Save/load design overlays, library card building, design import into VAB.
 */

import { getPartById } from '../../data/parts.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
} from '../../core/rocketbuilder.ts';
import type { RocketAssembly } from '../../core/rocketbuilder.ts';
import { createRocketDesign } from '../../core/gameState.ts';
import type { GameState, RocketDesign, RocketPart } from '../../core/gameState.ts';
import './_designLibrary.css';
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
} from '../../core/designLibrary.ts';
import type { CostBreakdown, CompatibilityResult } from '../../core/designLibrary.ts';
import {
  vabSetAssembly,
  vabRenderParts,
} from '../../render/vab.ts';
import { buildRocketCard } from '../rocketCardUtil.ts';
import { getVabState } from './_state.ts';
import { fmt$ } from './_partsPanel.ts';
import { clearUndoRedo } from '../../core/undoRedo.ts';
import { getVabListenerTracker } from './_listenerTracker.ts';

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
let _updateStatusBarFn: () => void = () => {};
let _updateScaleBarExtentsFn: () => void = () => {};
let _updateOffscreenIndicatorsFn: () => void = () => {};
let _setSelectedPartFn: (id: string | null) => void = (_id: string | null) => {};
let _refundOrReturnPartFn: (instId: string, partId: string) => void = (_instId: string, _partId: string) => {};
let _vabRefreshPartsFn: (state: GameState) => void = (_state: GameState) => {};

export function setDesignLibraryCallbacks({
  renderStagingPanel,
  runAndRenderValidation,
  updateStatusBar,
  updateScaleBarExtents,
  updateOffscreenIndicators,
  setSelectedPart,
  refundOrReturnPart,
  vabRefreshParts,
}: {
  renderStagingPanel: () => void;
  runAndRenderValidation: () => void;
  updateStatusBar: () => void;
  updateScaleBarExtents: () => void;
  updateOffscreenIndicators: () => void;
  setSelectedPart: (id: string | null) => void;
  refundOrReturnPart: (instId: string, partId: string) => void;
  vabRefreshParts: (state: GameState) => void;
}): void {
  _renderStagingPanelFn = renderStagingPanel;
  _runAndRenderValidationFn = runAndRenderValidation;
  _updateStatusBarFn = updateStatusBar;
  _updateScaleBarExtentsFn = updateScaleBarExtents;
  _updateOffscreenIndicatorsFn = updateOffscreenIndicators;
  _setSelectedPartFn = setSelectedPart;
  _refundOrReturnPartFn = refundOrReturnPart;
  _vabRefreshPartsFn = vabRefreshParts;
}

/**
 * Show a brief toast message near the top of the VAB.
 */
export function showToast(msg: string): void {
  const toast = document.createElement('div');
  toast.textContent = msg;
  toast.className = 'vab-toast';
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; }, 1200);
  setTimeout(() => { toast.remove(); }, 1700);
}

/**
 * Show a save-name prompt and persist the current assembly as a saved design.
 */
export async function handleSaveDesign(): Promise<void> {
  const S = getVabState();
  if (!S.assembly || S.assembly.parts.size === 0 || !S.gameState) {
    alert('Nothing to save.');
    return;
  }

  document.getElementById('vab-save-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vab-save-overlay';

  const defaultName = S.currentDesignName || 'Rocket Design ' + new Date().toLocaleDateString();

  const allDesigns = S.currentDesignId ? await getAllDesigns(S.gameState) : [];
  const existingDesign = S.currentDesignId
    ? allDesigns.find((d: RocketDesign) => d.id === S.currentDesignId)
    : null;
  const wasPrivate = existingDesign?.savePrivate ?? false;

  overlay.innerHTML =
    `<div class="vab-save-dialog">` +
      `<h3>Save Design</h3>` +
      `<input type="text" id="vab-save-name" value="${defaultName.replace(/"/g, '&quot;')}" maxlength="60" />` +
      `<div id="vab-save-name-counter" class="vab-save-char-counter">${defaultName.length} / 60</div>` +
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

  const nameInput = overlay.querySelector('#vab-save-name') as HTMLInputElement | null;
  nameInput?.select();

  const saveNameCounter = overlay.querySelector('#vab-save-name-counter');
  const updateSaveNameCounter = (): void => {
    const len = nameInput?.value.length ?? 0;
    if (saveNameCounter) {
      saveNameCounter.textContent = `${len} / 60`;
      saveNameCounter.classList.toggle('warning', len >= 55);
    }
  };
  if (nameInput) _addTracked(nameInput, 'input', updateSaveNameCounter);

  _addTracked(overlay, 'pointerdown', ((e: PointerEvent) => {
    if (e.target === overlay) overlay.remove();
  }) as EventListener);

  const saveCancelBtn = overlay.querySelector('#vab-save-cancel');
  if (saveCancelBtn) _addTracked(saveCancelBtn, 'click', () => overlay.remove());

  const doSave = async (): Promise<void> => {
    const name = nameInput?.value.trim() || defaultName;
    const designId = S.currentDesignId || ('design-' + Date.now());
    const isPrivate = (overlay.querySelector('#vab-save-private') as HTMLInputElement | null)?.checked ?? false;

    const design = createRocketDesign({
      id:          designId,
      name,
      parts:       [...S.assembly!.parts.values()].map(p => ({ partId: p.partId, position: { x: p.x, y: p.y }, ...(p.instruments?.length ? { instruments: [...p.instruments] } : {}) })),
      staging:     {
        stages: S.stagingConfig!.stages.map(s => [...s.instanceIds] as Array<string & number>),
        unstaged: [...S.stagingConfig!.unstaged] as Array<string & number>,
      },
      totalMass:   S.lastValidation?.totalMassKg ?? 0,
      totalThrust: S.lastValidation?.stage1Thrust ?? 0,
      savePrivate: isPrivate,
    });

    await saveDesignToLibrary(S.gameState!, design);
    S.currentDesignId   = designId;
    S.currentDesignName = name;

    overlay.remove();
    showToast('Design saved.');
  };

  const saveConfirmBtn = overlay.querySelector('#vab-save-confirm');
  if (saveConfirmBtn) _addTracked(saveConfirmBtn, 'click', () => { void doSave(); });
  if (nameInput) _addTracked(nameInput, 'keydown', ((e: KeyboardEvent) => {
    if (e.key === 'Enter') void doSave();
  }) as EventListener);
}

/**
 * Format a cost value as a dollar string.
 */
function fmtCost(n: number): string {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/**
 * Show the full design library overlay.
 */
export function handleLoadDesign(): void {
  const S = getVabState();
  if (!S.gameState) return;

  document.getElementById('vab-load-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vab-load-overlay';

  const header = document.createElement('div');
  header.className = 'vab-load-header';
  header.textContent = 'Design Library';
  overlay.appendChild(header);

  // ── Filter bar ──
  const filterBar = document.createElement('div');
  filterBar.className = 'vab-lib-filter-bar';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search designs...';
  searchInput.className = 'vab-lib-search';
  filterBar.appendChild(searchInput);

  const groupDefs = getDesignGroupDefs();
  let activeGroupId: string | null = null;

  const groupBar = document.createElement('div');
  groupBar.className = 'vab-lib-group-bar';

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'vab-lib-group-btn active';
  allBtn.textContent = 'All';
  _addTracked(allBtn, 'click', () => {
    activeGroupId = null;
    _updateGroupBtns();
    void renderList();
  });
  groupBar.appendChild(allBtn);

  for (const gd of groupDefs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'vab-lib-group-btn';
    btn.textContent = gd.label;
    btn.dataset.groupId = gd.id;
    _addTracked(btn, 'click', () => {
      activeGroupId = activeGroupId === gd.id ? null : gd.id;
      _updateGroupBtns();
      void renderList();
    });
    groupBar.appendChild(btn);
  }

  filterBar.appendChild(groupBar);
  overlay.appendChild(filterBar);

  function _updateGroupBtns(): void {
    const btns = groupBar.querySelectorAll('.vab-lib-group-btn');
    btns.forEach((b) => {
      const gid = (b as HTMLElement).dataset.groupId ?? null;
      b.classList.toggle('active', gid === activeGroupId || (!gid && !activeGroupId));
    });
  }

  const list = document.createElement('div');
  list.className = 'vab-load-list';
  overlay.appendChild(list);

  const renderList = async (): Promise<void> => {
    list.innerHTML = '';
    let designs = await getAllDesigns(S.gameState!);

    designs = filterDesignsByGroup(designs, activeGroupId);

    const query = searchInput.value.trim().toLowerCase();
    if (query) {
      designs = designs.filter((d: RocketDesign) => d.name.toLowerCase().includes(query));
    }

    const allDesigns = await getAllDesigns(S.gameState!);
    const grouped = groupDesigns(allDesigns);
    const activeGroups = new Set(grouped.map((g) => g.groupId));
    groupBar.querySelectorAll('.vab-lib-group-btn[data-group-id]').forEach((btn) => {
      (btn as HTMLElement).style.display = activeGroups.has((btn as HTMLElement).dataset.groupId!) ? '' : 'none';
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
      const compat = checkDesignCompatibility(design, S.gameState!);
      const costInfo = calculateCostBreakdown(design);
      const card = buildLibraryCard(design, compat, costInfo, overlay, renderList);
      list.appendChild(card);
    }
  };

  _addTracked(searchInput, 'input', () => { void renderList(); });

  void renderList();

  const closeBtn = document.createElement('button');
  closeBtn.className = 'vab-load-close';
  closeBtn.type = 'button';
  closeBtn.textContent = 'Close';
  _addTracked(closeBtn, 'click', () => overlay.remove());
  overlay.appendChild(closeBtn);

  document.body.appendChild(overlay);
}

/**
 * Build a library card with compatibility indicator, cost breakdown,
 * and action buttons (Load, Duplicate, Delete).
 */
function buildLibraryCard(
  design: RocketDesign,
  compat: CompatibilityResult,
  costInfo: CostBreakdown,
  overlay: HTMLDivElement,
  rerender: () => Promise<void>,
): HTMLElement {
  const S = getVabState();
  const card = buildRocketCard(design, []);

  const compatDot = document.createElement('span');
  compatDot.className = `vab-lib-compat vab-lib-compat-${compat.status}`;
  const compatLabels: Record<string, string> = { green: 'Compatible', yellow: 'Partial', red: 'Locked parts' };
  compatDot.title = compat.status === 'green'
    ? 'All parts unlocked'
    : compat.lockedDetails.map((d) => `${d.partName} (${d.techNodeName})`).join(', ');
  compatDot.textContent = compatLabels[compat.status];

  const infoEl = card.querySelector('.rocket-card-info');
  if (infoEl) {
    const nameEl = infoEl.querySelector('.rocket-card-name');
    if (nameEl) nameEl.after(compatDot);
  }

  const costEl = document.createElement('div');
  costEl.className = 'vab-lib-cost';
  costEl.innerHTML =
    `<span>Parts: ${fmtCost(costInfo.partsCost)}</span>` +
    `<span>Fuel: ${fmtCost(costInfo.fuelCost)}</span>` +
    `<span class="vab-lib-cost-total">Total: ${fmtCost(costInfo.totalCost)}</span>`;
  if (infoEl) infoEl.appendChild(costEl);

  if (compat.lockedDetails.length > 0) {
    const lockedEl = document.createElement('div');
    lockedEl.className = 'vab-lib-locked';
    lockedEl.innerHTML = compat.lockedDetails.map((d) =>
      `<span class="vab-lib-locked-part">${d.partName} <span class="vab-lib-locked-node">(${d.techNodeName})</span></span>`
    ).join('');
    if (infoEl) infoEl.appendChild(lockedEl);
  }

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

  const actionsEl = document.createElement('div');
  actionsEl.className = 'rocket-card-actions';

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'vab-load-card-load-btn';
  loadBtn.textContent = 'Load';
  if (compat.status === 'red') {
    loadBtn.title = 'Some parts are locked — rocket will fail validation until all parts are unlocked';
  }
  _addTracked(loadBtn, 'click', ((e: MouseEvent) => {
    e.stopPropagation();
    loadDesignIntoVab(design);
    overlay.remove();
  }) as EventListener);
  actionsEl.appendChild(loadBtn);

  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.textContent = 'Duplicate';
  _addTracked(dupBtn, 'click', ((e: MouseEvent) => {
    e.stopPropagation();
    const copy = duplicateDesign(design, S.gameState!);
    void saveDesignToLibrary(S.gameState!, copy).then(() => {
      void rerender();
      showToast('Design duplicated.');
    });
  }) as EventListener);
  actionsEl.appendChild(dupBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'vab-load-card-delete-btn';
  delBtn.textContent = 'Delete';
  _addTracked(delBtn, 'click', ((e: MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${design.name}"?`)) return;
    void deleteDesignFromLibrary(S.gameState!, design.id).then(() => {
      if (S.currentDesignId === design.id) {
        S.currentDesignId = null;
        S.currentDesignName = '';
      }
      void rerender();
    });
  }) as EventListener);
  actionsEl.appendChild(delBtn);

  const existingActions = card.querySelector('.rocket-card-actions');
  if (existingActions) existingActions.remove();
  card.appendChild(actionsEl);

  return card;
}

/**
 * Restore a saved RocketDesign into the VAB assembly and staging.
 */
export function loadDesignIntoVab(design: RocketDesign): void {
  const S = getVabState();
  if (!S.gameState) return;

  // Loading a design is a new starting point — clear undo/redo stack.
  clearUndoRedo();

  // Refund current assembly parts before clearing (or return inventory parts).
  if (S.assembly) {
    for (const [instId, placed] of S.assembly.parts) {
      _refundOrReturnPartFn(instId, placed.partId);
    }
  }

  S.assembly = createRocketAssembly();
  S.stagingConfig = createStagingConfig();

  for (const p of design.parts) {
    const def = getPartById(p.partId);
    if (def) S.gameState.money -= def.cost;
    const instId = addPartToAssembly(S.assembly, p.partId, p.position.x, p.position.y);
    const pWithInstr = p as RocketPart & { instruments?: string[] };
    if (pWithInstr.instruments?.length) {
      const placed = S.assembly.parts.get(instId);
      if (placed) placed.instruments = [...pWithInstr.instruments];
    }
  }

  rebuildConnectionsFromSnaps(S.assembly);

  if (design.staging && Array.isArray(design.staging.stages)) {
    S.stagingConfig = {
      stages:          design.staging.stages.map((ids: (number | string)[]) => ({
        instanceIds: Array.isArray(ids) ? ids.map(String) : [],
      })),
      unstaged:        Array.isArray(design.staging.unstaged) ? design.staging.unstaged.map(String) : [],
      currentStageIdx: 0,
    };
  }

  syncStagingWithAssembly(S.assembly, S.stagingConfig);

  S.currentDesignId   = design.id;
  S.currentDesignName = design.name;
  _setSelectedPartFn(null);

  vabSetAssembly(S.assembly);
  vabRenderParts();
  _renderStagingPanelFn();
  _runAndRenderValidationFn();
  _updateStatusBarFn();
  _updateScaleBarExtentsFn();
  _updateOffscreenIndicatorsFn();

  const cashEl = document.getElementById('vab-cash');
  if (cashEl && S.gameState) cashEl.textContent = fmt$(S.gameState.money);
}

/**
 * Rebuild part connections by checking snap-point overlap.
 */
function rebuildConnectionsFromSnaps(assembly: RocketAssembly): void {
  const OPPOSITE_SIDE: Record<string, string> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const SNAP_TOLERANCE = 1;
  const parts = [...assembly.parts.values()];
  const occupied = new Set<string>();

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

/**
 * _designLibrary.js — Save/load design overlays, library card building, design import into VAB.
 */

import { getPartById } from '../../data/parts.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
} from '../../core/rocketbuilder.js';
import { createRocketDesign } from '../../core/gameState.js';
import { injectStyleOnce } from '../injectStyle.js';
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
} from '../../core/designLibrary.js';
import {
  vabSetAssembly,
  vabRenderParts,
} from '../../render/vab.js';
import { buildRocketCard, injectRocketCardCSS } from '../rocketCardUtil.js';
import { getVabState } from './_state.js';
import { fmt$ } from './_partsPanel.js';
import { clearUndoRedo } from '../../core/undoRedo.js';

// ---------------------------------------------------------------------------
// Forward references — set by _init.js to break circular deps
// ---------------------------------------------------------------------------
let _renderStagingPanelFn = () => {};
let _runAndRenderValidationFn = () => {};
let _updateStatusBarFn = () => {};
let _updateScaleBarExtentsFn = () => {};
let _updateOffscreenIndicatorsFn = () => {};
let _setSelectedPartFn = (_id) => {};
let _refundOrReturnPartFn = (_instId, _partId) => {};
let _vabRefreshPartsFn = (_state) => {};

export function setDesignLibraryCallbacks({
  renderStagingPanel,
  runAndRenderValidation,
  updateStatusBar,
  updateScaleBarExtents,
  updateOffscreenIndicators,
  setSelectedPart,
  refundOrReturnPart,
  vabRefreshParts,
}) {
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
 * @param {string} msg
 */
export function showToast(msg) {
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
 * Show a save-name prompt and persist the current assembly as a saved design.
 */
export function handleSaveDesign() {
  const S = getVabState();
  if (!S.assembly || S.assembly.parts.size === 0 || !S.gameState) {
    alert('Nothing to save.');
    return;
  }

  document.getElementById('vab-save-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'vab-save-overlay';

  const defaultName = S.currentDesignName || 'Rocket Design ' + new Date().toLocaleDateString();

  const existingDesign = S.currentDesignId
    ? getAllDesigns(S.gameState).find(d => d.id === S.currentDesignId)
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

  const nameInput = /** @type {HTMLInputElement} */ (overlay.querySelector('#vab-save-name'));
  nameInput?.select();

  const saveNameCounter = overlay.querySelector('#vab-save-name-counter');
  const updateSaveNameCounter = () => {
    const len = nameInput?.value.length ?? 0;
    if (saveNameCounter) {
      saveNameCounter.textContent = `${len} / 60`;
      saveNameCounter.classList.toggle('warning', len >= 55);
    }
  };
  nameInput?.addEventListener('input', updateSaveNameCounter);

  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  overlay.querySelector('#vab-save-cancel')?.addEventListener('click', () => overlay.remove());

  const doSave = () => {
    const name = nameInput?.value.trim() || defaultName;
    const designId = S.currentDesignId || ('design-' + Date.now());
    const isPrivate = /** @type {HTMLInputElement} */ (overlay.querySelector('#vab-save-private'))?.checked ?? false;

    const design = createRocketDesign({
      id:          designId,
      name,
      parts:       [...S.assembly.parts.values()].map(p => ({ partId: p.partId, position: { x: p.x, y: p.y }, ...(p.instruments?.length ? { instruments: [...p.instruments] } : {}) })),
      staging:     { stages: S.stagingConfig.stages.map(s => [...s.instanceIds]), unstaged: [...S.stagingConfig.unstaged] },
      totalMass:   S.lastValidation?.totalMassKg ?? 0,
      totalThrust: S.lastValidation?.stage1Thrust ?? 0,
      savePrivate: isPrivate,
    });

    saveDesignToLibrary(S.gameState, design);
    S.currentDesignId   = designId;
    S.currentDesignName = name;

    overlay.remove();
    showToast('Design saved.');
  };

  overlay.querySelector('#vab-save-confirm')?.addEventListener('click', doSave);
  nameInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSave();
  });
}

const VAB_LIBRARY_CSS = `
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

/* ── Save name character counter ────────────────────────────────── */
.vab-save-char-counter {
  font-size: 0.72rem;
  color: var(--color-text-muted, #6080a0);
  margin-top: 4px;
  margin-bottom: 8px;
  text-align: right;
}
.vab-save-char-counter.warning {
  color: var(--color-warning, #d8b860);
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

/**
 * Inject design library CSS (idempotent).
 */
function injectLibraryCSS() {
  injectStyleOnce('vab-library-css', VAB_LIBRARY_CSS);
}

/**
 * Format a cost value as a dollar string.
 * @param {number} n
 * @returns {string}
 */
function fmtCost(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/**
 * Show the full design library overlay.
 */
export function handleLoadDesign() {
  const S = getVabState();
  if (!S.gameState) return;

  injectRocketCardCSS();
  injectLibraryCSS();

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

  const list = document.createElement('div');
  list.className = 'vab-load-list';
  overlay.appendChild(list);

  const renderList = () => {
    list.innerHTML = '';
    let designs = getAllDesigns(S.gameState);

    designs = filterDesignsByGroup(designs, activeGroupId);

    const query = searchInput.value.trim().toLowerCase();
    if (query) {
      designs = designs.filter(d => d.name.toLowerCase().includes(query));
    }

    const allDesigns = getAllDesigns(S.gameState);
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
      const compat = checkDesignCompatibility(design, S.gameState);
      const costInfo = calculateCostBreakdown(design);
      const card = buildLibraryCard(design, compat, costInfo, overlay, renderList);
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
 */
function buildLibraryCard(design, compat, costInfo, overlay, rerender) {
  const S = getVabState();
  const card = buildRocketCard(design, []);

  const compatDot = document.createElement('span');
  compatDot.className = `vab-lib-compat vab-lib-compat-${compat.status}`;
  const compatLabels = { green: 'Compatible', yellow: 'Partial', red: 'Locked parts' };
  compatDot.title = compat.status === 'green'
    ? 'All parts unlocked'
    : compat.lockedDetails.map(d => `${d.partName} (${d.techNodeName})`).join(', ');
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
    lockedEl.innerHTML = compat.lockedDetails.map(d =>
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
  loadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    loadDesignIntoVab(design);
    overlay.remove();
  });
  actionsEl.appendChild(loadBtn);

  const dupBtn = document.createElement('button');
  dupBtn.type = 'button';
  dupBtn.textContent = 'Duplicate';
  dupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const copy = duplicateDesign(design);
    saveDesignToLibrary(S.gameState, copy);
    rerender();
    showToast('Design duplicated.');
  });
  actionsEl.appendChild(dupBtn);

  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'vab-load-card-delete-btn';
  delBtn.textContent = 'Delete';
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${design.name}"?`)) return;
    deleteDesignFromLibrary(S.gameState, design.id);
    if (S.currentDesignId === design.id) {
      S.currentDesignId = null;
      S.currentDesignName = '';
    }
    rerender();
  });
  actionsEl.appendChild(delBtn);

  const existingActions = card.querySelector('.rocket-card-actions');
  if (existingActions) existingActions.remove();
  card.appendChild(actionsEl);

  return card;
}

/**
 * Restore a saved RocketDesign into the VAB assembly and staging.
 * @param {import('../../core/gameState.js').RocketDesign} design
 */
export function loadDesignIntoVab(design) {
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
    if (p.instruments?.length) {
      const placed = S.assembly.parts.get(instId);
      if (placed) placed.instruments = [...p.instruments];
    }
  }

  rebuildConnectionsFromSnaps(S.assembly);

  if (design.staging && Array.isArray(design.staging.stages)) {
    S.stagingConfig = {
      stages:          design.staging.stages.map(ids => ({
        instanceIds: Array.isArray(ids) ? [...ids] : [],
      })),
      unstaged:        Array.isArray(design.staging.unstaged) ? [...design.staging.unstaged] : [],
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
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 */
function rebuildConnectionsFromSnaps(assembly) {
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

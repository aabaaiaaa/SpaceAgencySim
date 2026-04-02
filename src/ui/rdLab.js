/**
 * rdLab.js — R&D Lab / Tech Tree HTML overlay UI.
 *
 * Displays the technology tree organised by branch (Propulsion, Structural,
 * Recovery, Science) with 5 tiers each.  Nodes can be researched by spending
 * science points and funds.
 *
 * @module ui/rdLab
 */

import { TECH_NODES, TechBranch, BRANCH_NAMES } from '../data/techtree.js';
import {
  getTechTreeStatus,
  researchNode,
  getMaxResearchableTier,
} from '../core/techtree.js';
import { FacilityId, RD_LAB_TIER_LABELS } from '../core/constants.js';
import { getFacilityTier } from '../core/construction.js';
import { refreshTopBar } from './topbar.js';
import { injectStyleOnce } from './injectStyle.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const RD_STYLES = `
/* -- R&D Lab overlay ----------------------------------------------------- */
#rd-overlay {
  position: fixed;
  inset: 0;
  background: var(--color-surface);
  z-index: var(--z-facility);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  font-family: var(--font-family);
  color: var(--color-text-primary);
  padding-top: var(--topbar-height);
}

#rd-header {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--header-padding);
  flex-shrink: 0;
}

#rd-back-btn {
  background: var(--color-secondary-bg);
  border: 1px solid var(--color-secondary-border);
  color: var(--color-secondary-text);
  font-size: var(--font-size-label);
  padding: var(--btn-padding-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-default);
  white-space: nowrap;
}
#rd-back-btn:hover {
  background: var(--color-secondary-bg-hover);
}

#rd-title {
  font-size: var(--font-size-h2);
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--color-text-heading);
  margin: 0;
}

#rd-resources {
  margin-left: auto;
  display: flex;
  gap: 18px;
  font-size: 0.85rem;
  color: #8899aa;
}
#rd-resources .rd-res-val {
  font-weight: 700;
  color: #e0f0ff;
}

/* -- Branch tabs ---------------------------------------------------------- */
#rd-tabs {
  display: flex;
  gap: 2px;
  padding: 14px 20px 0;
  flex-shrink: 0;
}

.rd-tab {
  background: var(--color-surface-raised);
  border: 1px solid var(--color-card-border);
  border-bottom: none;
  border-radius: var(--radius-md) var(--radius-md) 0 0;
  color: var(--color-tab-text);
  font-size: var(--font-size-label);
  font-weight: 600;
  padding: var(--space-sm) 18px;
  cursor: pointer;
  transition: background var(--transition-default), color var(--transition-default);
}
.rd-tab:hover {
  background: var(--color-surface-hover);
  color: #c0d0e0;
}
.rd-tab.active {
  background: var(--color-surface-hover);
  color: var(--color-text-accent);
  border-color: rgba(128,200,255,0.3);
}

/* -- Content area --------------------------------------------------------- */
#rd-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 40px;
  border-top: 1px solid rgba(255,255,255,0.08);
}

/* -- Node cards ----------------------------------------------------------- */
.rd-node-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 700px;
}

.rd-node {
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rd-node.researched {
  border-color: rgba(80, 200, 120, 0.4);
  background: rgba(80, 200, 120, 0.06);
}
.rd-node.tutorial-unlocked {
  border-color: rgba(180, 160, 80, 0.4);
  background: rgba(180, 160, 80, 0.06);
}
.rd-node.available {
  border-color: rgba(128, 200, 255, 0.4);
  background: rgba(128, 200, 255, 0.06);
}

.rd-node-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.rd-node-tier {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6688aa;
  background: var(--color-surface-hover);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}

.rd-node-name {
  font-size: 1rem;
  font-weight: 700;
  color: #e0f0ff;
}

.rd-node-status {
  margin-left: auto;
  font-size: var(--font-size-small);
  font-weight: 600;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  white-space: nowrap;
}
.rd-node-status.researched {
  color: #50c878;
  background: rgba(80, 200, 120, 0.12);
}
.rd-node-status.tutorial {
  color: #c8a830;
  background: rgba(200, 168, 48, 0.12);
}
.rd-node-status.locked {
  color: #667788;
  background: rgba(255,255,255,0.04);
}

.rd-node-desc {
  font-size: 0.82rem;
  color: #8899aa;
  line-height: 1.4;
}

.rd-node-unlocks {
  font-size: 0.78rem;
  color: #6688aa;
}
.rd-node-unlocks strong {
  color: #8899aa;
}

.rd-node-cost {
  font-size: 0.82rem;
  color: #8899aa;
  display: flex;
  gap: 16px;
}
.rd-node-cost .rd-sci { color: #80c8ff; }
.rd-node-cost .rd-funds { color: #60d060; }

.rd-node-reason {
  font-size: 0.78rem;
  color: #aa6666;
  font-style: italic;
}

.rd-research-btn {
  align-self: flex-start;
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
  color: var(--color-primary-text);
  font-size: var(--font-size-caption);
  font-weight: 600;
  padding: var(--btn-padding-md);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
}
.rd-research-btn:hover {
  background: rgba(128, 200, 255, 0.25);
}

.rd-max-tier-note {
  font-size: 0.8rem;
  color: #6688aa;
  margin-bottom: 12px;
  font-style: italic;
}
`;

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

/** @type {import('../core/gameState.js').GameState | null} */
let _state = null;

/** @type {(() => void) | null} */
let _onBack = null;

/** @type {HTMLElement | null} */
let _overlay = null;

/** @type {string} */
let _activeBranch = TechBranch.PROPULSION;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the R&D Lab / Tech Tree overlay.
 *
 * @param {HTMLElement} container
 * @param {import('../core/gameState.js').GameState} state
 * @param {{ onBack: () => void }} opts
 */
export function initRdLabUI(container, state, { onBack }) {
  _state = state;
  _onBack = onBack;
  _activeBranch = TechBranch.PROPULSION;

  // Inject styles once.
  injectStyleOnce('rd-styles', RD_STYLES);

  _overlay = document.createElement('div');
  _overlay.id = 'rd-overlay';
  container.appendChild(_overlay);

  _render();


}

/**
 * Remove the R&D Lab overlay.
 */
export function destroyRdLabUI() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;
  _onBack = null;

}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _render() {
  if (!_overlay || !_state) return;
  _overlay.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.id = 'rd-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'rd-back-btn';
  backBtn.textContent = '\u2190 Hub';
  backBtn.addEventListener('click', () => {
    const cb = _onBack;
    destroyRdLabUI();
    if (cb) cb();
  });
  header.appendChild(backBtn);

  const rdTier = _state ? getFacilityTier(_state, FacilityId.RD_LAB) : 1;
  const rdTierLabel = RD_LAB_TIER_LABELS[rdTier] || '';
  const title = document.createElement('h1');
  title.id = 'rd-title';
  title.textContent = `R&D Lab \u2014 Tier ${rdTier}` + (rdTierLabel ? ` (${rdTierLabel})` : '');
  header.appendChild(title);

  // Resource display
  const resources = document.createElement('div');
  resources.id = 'rd-resources';
  resources.innerHTML =
    `Science: <span class="rd-res-val">${Math.floor(_state.sciencePoints ?? 0)}</span>` +
    `<span style="margin: 0 4px;">|</span>` +
    `Funds: <span class="rd-res-val">$${(_state.money ?? 0).toLocaleString('en-US')}</span>`;
  header.appendChild(resources);

  _overlay.appendChild(header);

  // Branch tabs
  const tabs = document.createElement('div');
  tabs.id = 'rd-tabs';
  const branches = [TechBranch.PROPULSION, TechBranch.STRUCTURAL, TechBranch.RECOVERY, TechBranch.SCIENCE];
  for (const branch of branches) {
    const tab = document.createElement('button');
    tab.className = 'rd-tab' + (branch === _activeBranch ? ' active' : '');
    tab.textContent = BRANCH_NAMES[branch];
    tab.dataset.branch = branch;
    tab.addEventListener('click', () => {
      _activeBranch = branch;
      _render();
    });
    tabs.appendChild(tab);
  }
  _overlay.appendChild(tabs);

  // Content
  const content = document.createElement('div');
  content.id = 'rd-content';
  _overlay.appendChild(content);

  _renderBranch(content);
}

/**
 * Render the nodes for the active branch.
 * @param {HTMLElement} content
 */
function _renderBranch(content) {
  if (!_state) return;

  const maxTier = getMaxResearchableTier(_state);
  if (maxTier > 0) {
    const note = document.createElement('div');
    note.className = 'rd-max-tier-note';
    note.textContent = `R&D Lab supports up to Tier ${maxTier} research`;
    content.appendChild(note);
  }

  const allStatus = getTechTreeStatus(_state);
  const branchNodes = allStatus
    .filter((n) => n.branch === _activeBranch)
    .sort((a, b) => a.tier - b.tier);

  const list = document.createElement('div');
  list.className = 'rd-node-list';

  for (const node of branchNodes) {
    const card = document.createElement('div');
    card.className = 'rd-node';
    if (node.researched) card.classList.add('researched');
    else if (node.tutorialUnlocked) card.classList.add('tutorial-unlocked');
    else if (node.canResearch) card.classList.add('available');

    // Header row: tier badge, name, status
    const headerRow = document.createElement('div');
    headerRow.className = 'rd-node-header';

    const tierBadge = document.createElement('span');
    tierBadge.className = 'rd-node-tier';
    tierBadge.textContent = `Tier ${node.tier}`;
    headerRow.appendChild(tierBadge);

    const name = document.createElement('span');
    name.className = 'rd-node-name';
    name.textContent = node.name;
    headerRow.appendChild(name);

    const statusBadge = document.createElement('span');
    statusBadge.className = 'rd-node-status';
    if (node.researched) {
      statusBadge.classList.add('researched');
      statusBadge.textContent = 'Researched';
    } else if (node.tutorialUnlocked) {
      statusBadge.classList.add('tutorial');
      statusBadge.textContent = 'Unlocked via tutorial';
    } else {
      statusBadge.classList.add('locked');
      statusBadge.textContent = 'Locked';
    }
    headerRow.appendChild(statusBadge);

    card.appendChild(headerRow);

    // Description
    const desc = document.createElement('div');
    desc.className = 'rd-node-desc';
    desc.textContent = node.description;
    card.appendChild(desc);

    // Unlocks
    const unlocks = [];
    if (node.unlocksParts.length > 0) {
      unlocks.push(`Parts: ${node.unlocksParts.join(', ')}`);
    }
    if (node.unlocksInstruments.length > 0) {
      unlocks.push(`Instruments: ${node.unlocksInstruments.join(', ')}`);
    }
    if (unlocks.length > 0) {
      const unlocksEl = document.createElement('div');
      unlocksEl.className = 'rd-node-unlocks';
      unlocksEl.innerHTML = `<strong>Unlocks:</strong> ${unlocks.join(' | ')}`;
      card.appendChild(unlocksEl);
    }

    // Cost (show for non-unlocked nodes)
    if (!node.researched && !node.tutorialUnlocked) {
      const costEl = document.createElement('div');
      costEl.className = 'rd-node-cost';
      costEl.innerHTML =
        `<span class="rd-sci">${node.scienceCost} Science</span>` +
        `<span class="rd-funds">$${node.fundsCost.toLocaleString('en-US')}</span>`;
      card.appendChild(costEl);

      if (node.canResearch) {
        const btn = document.createElement('button');
        btn.className = 'rd-research-btn';
        btn.textContent = 'Research';
        btn.dataset.nodeId = node.id;
        btn.addEventListener('click', () => _handleResearch(node.id));
        card.appendChild(btn);
      } else if (node.reason) {
        const reason = document.createElement('div');
        reason.className = 'rd-node-reason';
        reason.textContent = node.reason;
        card.appendChild(reason);
      }
    }

    list.appendChild(card);
  }

  content.appendChild(list);
}

/**
 * Handle clicking the Research button on a node.
 * @param {string} nodeId
 */
function _handleResearch(nodeId) {
  if (!_state) return;
  const result = researchNode(_state, nodeId);
  if (result.success) {
    refreshTopBar();
    _render();
  }
}

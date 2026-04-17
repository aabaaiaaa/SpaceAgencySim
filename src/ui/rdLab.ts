/**
 * rdLab.ts — R&D Lab / Tech Tree HTML overlay UI.
 *
 * Displays the technology tree organised by branch (Propulsion, Structural,
 * Recovery, Science) with up to 6 tiers each.  Nodes can be researched by spending
 * science points and funds.
 *
 * @module ui/rdLab
 */

import { TechBranch, BRANCH_NAMES } from '../data/techtree.ts';
import {
  getTechTreeStatus,
  researchNode,
  getMaxResearchableTier,
} from '../core/techtree.ts';
import { FacilityId, RD_LAB_TIER_LABELS } from '../core/constants.ts';
import { getFacilityTier } from '../core/construction.ts';
import { refreshTopBar } from './topbar.ts';
import { createListenerTracker, type ListenerTracker } from './listenerTracker.ts';
import './rdLab.css';
import type { GameState } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

let _state: GameState | null = null;
let _onBack: (() => void) | null = null;
let _overlay: HTMLDivElement | null = null;
let _activeBranch: string = TechBranch.PROPULSION;
let _listeners: ListenerTracker | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the R&D Lab / Tech Tree overlay.
 */
export function initRdLabUI(
  container: HTMLElement,
  state: GameState,
  { onBack }: { onBack: () => void },
): void {
  _state = state;
  _onBack = onBack;
  _activeBranch = TechBranch.PROPULSION;
  _listeners = createListenerTracker();

  _overlay = document.createElement('div');
  _overlay.id = 'rd-overlay';
  container.appendChild(_overlay);

  _render();
}

/**
 * Remove the R&D Lab overlay.
 */
export function destroyRdLabUI(): void {
  if (_listeners) {
    _listeners.removeAll();
    _listeners = null;
  }
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

function _render(): void {
  if (!_overlay || !_state) return;
  // Clear previously-registered listeners before rebuilding DOM.
  if (_listeners) _listeners.removeAll();
  _overlay.innerHTML = '';

  // Header
  const header: HTMLDivElement = document.createElement('div');
  header.id = 'rd-header';

  const backBtn: HTMLButtonElement = document.createElement('button');
  backBtn.id = 'rd-back-btn';
  backBtn.textContent = '\u2190 Hub';
  _listeners?.add(backBtn, 'click', () => {
    const cb = _onBack;
    destroyRdLabUI();
    if (cb) cb();
  });
  header.appendChild(backBtn);

  const rdTier = _state ? getFacilityTier(_state, FacilityId.RD_LAB) : 1;
  const rdTierLabel = RD_LAB_TIER_LABELS[rdTier] || '';
  const title: HTMLHeadingElement = document.createElement('h1');
  title.id = 'rd-title';
  title.textContent = `R&D Lab \u2014 Tier ${rdTier}` + (rdTierLabel ? ` (${rdTierLabel})` : '');
  header.appendChild(title);

  // Resource display
  const resources: HTMLDivElement = document.createElement('div');
  resources.id = 'rd-resources';
  resources.innerHTML =
    `Science: <span class="rd-res-val">${Math.floor(_state.sciencePoints ?? 0)}</span>` +
    `<span class="rd-res-sep">|</span>` +
    `Funds: <span class="rd-res-val">$${(_state.money ?? 0).toLocaleString('en-US')}</span>`;
  header.appendChild(resources);

  _overlay.appendChild(header);

  // Branch tabs
  const tabs: HTMLDivElement = document.createElement('div');
  tabs.id = 'rd-tabs';
  const branches: string[] = [TechBranch.PROPULSION, TechBranch.STRUCTURAL, TechBranch.RECOVERY, TechBranch.SCIENCE];
  for (const branch of branches) {
    const tab: HTMLButtonElement = document.createElement('button');
    tab.className = 'rd-tab' + (branch === _activeBranch ? ' active' : '');
    tab.textContent = BRANCH_NAMES[branch];
    tab.dataset.branch = branch;
    _listeners?.add(tab, 'click', () => {
      _activeBranch = branch;
      _render();
    });
    tabs.appendChild(tab);
  }
  _overlay.appendChild(tabs);

  // Content
  const content: HTMLDivElement = document.createElement('div');
  content.id = 'rd-content';
  _overlay.appendChild(content);

  _renderBranch(content);
}

/**
 * Render the nodes for the active branch.
 */
function _renderBranch(content: HTMLDivElement): void {
  if (!_state) return;

  const maxTier = getMaxResearchableTier(_state);
  if (maxTier > 0) {
    const note: HTMLDivElement = document.createElement('div');
    note.className = 'rd-max-tier-note';
    note.textContent = `R&D Lab supports up to Tier ${maxTier} research`;
    content.appendChild(note);
  }

  const allStatus = getTechTreeStatus(_state);
  const branchNodes = allStatus
    .filter((n) => n.branch === _activeBranch)
    .sort((a, b) => a.tier - b.tier);

  const list: HTMLDivElement = document.createElement('div');
  list.className = 'rd-node-list';

  for (const node of branchNodes) {
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'rd-node';
    if (node.researched) card.classList.add('researched');
    else if (node.tutorialUnlocked) card.classList.add('tutorial-unlocked');
    else if (node.canResearch) card.classList.add('available');

    // Header row: tier badge, name, status
    const headerRow: HTMLDivElement = document.createElement('div');
    headerRow.className = 'rd-node-header';

    const tierBadge: HTMLSpanElement = document.createElement('span');
    tierBadge.className = 'rd-node-tier';
    tierBadge.textContent = `Tier ${node.tier}`;
    headerRow.appendChild(tierBadge);

    const name: HTMLSpanElement = document.createElement('span');
    name.className = 'rd-node-name';
    name.textContent = node.name;
    headerRow.appendChild(name);

    const statusBadge: HTMLSpanElement = document.createElement('span');
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
    const desc: HTMLDivElement = document.createElement('div');
    desc.className = 'rd-node-desc';
    desc.textContent = node.description;
    card.appendChild(desc);

    // Unlocks
    const unlocks: string[] = [];
    if (node.unlocksParts.length > 0) {
      unlocks.push(`Parts: ${node.unlocksParts.join(', ')}`);
    }
    if (node.unlocksInstruments.length > 0) {
      unlocks.push(`Instruments: ${node.unlocksInstruments.join(', ')}`);
    }
    if (unlocks.length > 0) {
      const unlocksEl: HTMLDivElement = document.createElement('div');
      unlocksEl.className = 'rd-node-unlocks';
      unlocksEl.innerHTML = `<strong>Unlocks:</strong> ${unlocks.join(' | ')}`;
      card.appendChild(unlocksEl);
    }

    // Cost (show for non-unlocked nodes)
    if (!node.researched && !node.tutorialUnlocked) {
      const costEl: HTMLDivElement = document.createElement('div');
      costEl.className = 'rd-node-cost';
      costEl.innerHTML =
        `<span class="rd-sci">${node.scienceCost} Science</span>` +
        `<span class="rd-funds">$${node.fundsCost.toLocaleString('en-US')}</span>`;
      card.appendChild(costEl);

      if (node.canResearch) {
        const btn: HTMLButtonElement = document.createElement('button');
        btn.className = 'rd-research-btn';
        btn.textContent = 'Research';
        btn.dataset.nodeId = node.id;
        _listeners?.add(btn, 'click', () => _handleResearch(node.id));
        card.appendChild(btn);
      } else if (node.reason) {
        const reason: HTMLDivElement = document.createElement('div');
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
 */
function _handleResearch(nodeId: string): void {
  if (!_state) return;
  const result = researchNode(_state, nodeId);
  if (result.success) {
    refreshTopBar();
    _render();
  }
}

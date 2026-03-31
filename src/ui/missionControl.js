/**
 * missionControl.js — Mission Control Centre HTML overlay UI.
 *
 * Six tabs:
 *   - Available     : Lists all available tutorial missions with title, description,
 *                     reward, and an "Accept" button.
 *   - Accepted      : Lists currently accepted missions with their objectives.
 *   - Completed     : Lists all completed missions.
 *   - Contracts     : Board of procedurally generated contracts (pool).
 *   - Active        : Active (accepted) contracts with objectives and cancel option.
 *   - Achievements  : Prestige milestones and one-time achievement tracker.
 *
 * Mission unlock state is recalculated each time this screen is opened by
 * calling getUnlockedMissions() on init.
 *
 * @module missionControl
 */

import { acceptMission, getUnlockedMissions } from '../core/missions.js';
import { acceptContract, cancelContract, getContractCaps, getActiveConflicts, getMissionControlTier } from '../core/contracts.js';
import { CONTRACT_CATEGORY_ICONS, MCC_TIER_FEATURES, getReputationTier } from '../core/constants.js';
import { getPartById } from '../data/parts.js';
import { refreshTopBarMissions } from './topbar.js';
import { getAchievementStatus } from '../core/achievements.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const MISSION_CONTROL_STYLES = `
/* ── Mission Control overlay ──────────────────────────────────────────────── */
#mission-control-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 20, 0.96);
  z-index: 20;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  font-family: system-ui, sans-serif;
  color: #e8e8e8;
  /* leave room for the persistent top bar (approx 44px) */
  padding-top: 44px;
}

/* ── Header ──────────────────────────────────────────────────────────────── */
#mission-control-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px 0;
  flex-shrink: 0;
}

#mission-control-back-btn {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #e8e8e8;
  font-size: 0.85rem;
  padding: 6px 14px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}
#mission-control-back-btn:hover {
  background: rgba(255,255,255,0.16);
}

#mission-control-title {
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #f0f0f0;
  margin: 0;
}

/* ── Tab bar ──────────────────────────────────────────────────────────────── */
#mission-control-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 20px 0;
  border-bottom: 2px solid rgba(255,255,255,0.1);
  flex-shrink: 0;
}

.mc-tab {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  color: #9aa0b0;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 8px 18px;
  cursor: pointer;
  border-radius: 5px 5px 0 0;
  transition: color 0.15s, background 0.15s;
  position: relative;
  bottom: -2px;
}
.mc-tab:hover {
  color: #e0e0e0;
  background: rgba(255,255,255,0.05);
}
.mc-tab.active {
  color: #ffffff;
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.15);
  border-bottom-color: rgba(10, 12, 20, 0.96);
}

/* ── Tab content area ────────────────────────────────────────────────────── */
#mission-control-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

/* ── Mission card list (Available + Accepted tabs) ───────────────────────── */
.mc-mission-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 760px;
}

.mc-mission-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 8px;
  padding: 16px 18px;
}

.mc-mission-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.mc-mission-title {
  font-size: 1rem;
  font-weight: 700;
  color: #d4e0f0;
  margin: 0;
  line-height: 1.3;
}

.mc-mission-reward {
  font-size: 0.88rem;
  font-weight: 700;
  color: #7dd87d;
  white-space: nowrap;
  flex-shrink: 0;
}

.mc-mission-description {
  font-size: 0.85rem;
  color: #8898b0;
  line-height: 1.55;
  margin: 0 0 14px;
}

/* ── Completed card extras ─────────────────────────────────────────────── */
.mc-completed-date {
  font-size: 0.8rem;
  color: #5a8aa8;
  margin: 0 0 8px;
}

/* ── Reward parts ──────────────────────────────────────────────────────── */
.mc-mission-rewards {
  font-size: 0.8rem;
  color: #7db8d8;
  margin: 0 0 10px;
  line-height: 1.5;
}

.mc-mission-rewards .mc-rewards-label {
  color: #5a8aa8;
  font-weight: 600;
  margin-right: 4px;
}

/* ── Accept button / row ─────────────────────────────────────────────────── */
.mc-accept-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.mc-accept-btn {
  background: rgba(60, 120, 220, 0.2);
  border: 1px solid rgba(60, 120, 220, 0.45);
  color: #80b4f0;
  font-size: 0.85rem;
  font-weight: 700;
  padding: 7px 18px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  letter-spacing: 0.02em;
}
.mc-accept-btn:hover:not(:disabled) {
  background: rgba(60, 120, 220, 0.38);
  border-color: rgba(60, 120, 220, 0.75);
}
.mc-accept-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mc-tutorial-notice {
  font-size: 0.78rem;
  color: #a08040;
  font-style: italic;
}

/* ── Objectives list (Accepted tab) ──────────────────────────────────────── */
.mc-objectives-label {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #7080a0;
  margin: 12px 0 8px;
}

.mc-objectives-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mc-objective-item {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  font-size: 0.85rem;
  line-height: 1.4;
}

.mc-objective-indicator {
  flex-shrink: 0;
  font-size: 0.9rem;
  margin-top: 1px;
  width: 1.1em;
  text-align: center;
}
.mc-objective-indicator.completed {
  color: #7dd87d;
}
.mc-objective-indicator.pending {
  color: #5868a0;
}

.mc-objective-text.completed {
  color: #7dd87d;
  text-decoration: line-through;
  text-decoration-color: rgba(125, 216, 125, 0.4);
}
.mc-objective-text.pending {
  color: #c0cce0;
}

/* ── Empty state messages ────────────────────────────────────────────────── */
.mc-empty-msg {
  color: #666;
  font-style: italic;
  text-align: center;
  padding: 40px 20px;
  font-size: 0.9rem;
}

/* ── Tab group divider ──────────────────────────────────────────────────── */
.mc-tab-divider {
  width: 1px;
  background: rgba(255,255,255,0.15);
  margin: 6px 8px;
  flex-shrink: 0;
}

/* ── Contract-specific styles ───────────────────────────────────────────── */
.mc-contract-category {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(100, 140, 200, 0.15);
  color: #7098c0;
  display: inline-block;
  margin-bottom: 8px;
}

.mc-contract-meta {
  font-size: 0.78rem;
  color: #6878a0;
  margin: 6px 0 0;
  line-height: 1.5;
}

.mc-contract-meta span {
  margin-right: 16px;
}

.mc-contract-chain {
  font-size: 0.75rem;
  color: #a08850;
  font-weight: 600;
  margin-bottom: 6px;
}

.mc-cancel-btn {
  background: rgba(200, 60, 60, 0.15);
  border: 1px solid rgba(200, 60, 60, 0.35);
  color: #c07070;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 5px 14px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  margin-top: 10px;
}
.mc-cancel-btn:hover {
  background: rgba(200, 60, 60, 0.3);
  border-color: rgba(200, 60, 60, 0.6);
}

.mc-caps-info {
  font-size: 0.8rem;
  color: #6878a0;
  padding: 0 0 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  margin-bottom: 14px;
}

.mc-reputation-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.8rem;
  color: #8898b0;
  margin-bottom: 14px;
}

.mc-rep-fill {
  height: 6px;
  border-radius: 3px;
  background: #5090d0;
  transition: width 0.3s;
}

.mc-rep-track {
  flex: 1;
  max-width: 200px;
  height: 6px;
  border-radius: 3px;
  background: rgba(255,255,255,0.08);
}

/* ── Category icon ────────────────────────────────────────────────────── */
.mc-category-icon {
  margin-right: 5px;
  font-size: 0.85rem;
}

/* ── Bonus objectives ─────────────────────────────────────────────────── */
.mc-bonus-label {
  font-size: 0.78rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #c0a040;
  margin: 12px 0 8px;
}

.mc-objective-item.bonus .mc-objective-indicator.pending {
  color: #a08030;
}
.mc-objective-item.bonus .mc-objective-text.pending {
  color: #c0b070;
}
.mc-objective-item.bonus .mc-objective-indicator.completed {
  color: #d0c060;
}
.mc-objective-item.bonus .mc-objective-text.completed {
  color: #d0c060;
  text-decoration: line-through;
  text-decoration-color: rgba(208, 192, 96, 0.4);
}

.mc-bonus-reward {
  font-size: 0.82rem;
  color: #c0a040;
  font-weight: 700;
  margin: 4px 0 0;
}

/* ── Conflict warning ─────────────────────────────────────────────────── */
.mc-conflict-warning {
  font-size: 0.78rem;
  color: #d08040;
  background: rgba(200, 120, 40, 0.1);
  border: 1px solid rgba(200, 120, 40, 0.25);
  border-radius: 4px;
  padding: 6px 10px;
  margin: 8px 0 0;
  line-height: 1.4;
}

/* ── Achievement styles ──────────────────────────────────────────────── */
.mc-achievement-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 14px;
  max-width: 900px;
}

.mc-achievement-card {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 16px 18px;
  transition: border-color 0.2s, background 0.2s;
}
.mc-achievement-card.earned {
  background: rgba(80, 160, 80, 0.06);
  border-color: rgba(80, 160, 80, 0.25);
}
.mc-achievement-card.locked {
  opacity: 0.55;
}

.mc-achievement-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.mc-achievement-icon {
  font-size: 1.4rem;
  flex-shrink: 0;
  width: 1.6em;
  text-align: center;
}

.mc-achievement-title {
  font-size: 0.95rem;
  font-weight: 700;
  color: #d4e0f0;
  margin: 0;
}
.mc-achievement-card.earned .mc-achievement-title {
  color: #90d890;
}

.mc-achievement-desc {
  font-size: 0.82rem;
  color: #7888a0;
  line-height: 1.5;
  margin: 0 0 10px;
}

.mc-achievement-rewards {
  display: flex;
  gap: 16px;
  font-size: 0.8rem;
  font-weight: 600;
}
.mc-achievement-cash {
  color: #7dd87d;
}
.mc-achievement-rep {
  color: #70a8d0;
}

.mc-achievement-earned-date {
  font-size: 0.75rem;
  color: #5a8a5a;
  margin-top: 6px;
}

.mc-achievement-summary {
  font-size: 0.85rem;
  color: #8898b0;
  margin-bottom: 18px;
  padding-bottom: 14px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}
.mc-achievement-summary strong {
  color: #90d890;
}
`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The last mission in the linear tutorial chain.  Once this mission appears
 * in state.missions.completed, the single-accept restriction is lifted and
 * the player may accept multiple missions simultaneously.
 */
const TUTORIAL_GATE_MISSION_ID = 'mission-004';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The root overlay element. @type {HTMLElement | null} */
let _overlay = null;

/** Reference to the game state. @type {import('../core/gameState.js').GameState | null} */
let _state = null;

/** Callback to navigate back to the hub. @type {(() => void) | null} */
let _onBack = null;

/** Currently active tab id: 'available' | 'accepted' | 'completed' */
let _activeTab = 'available';

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO 8601 date string to a readable short date.
 * @param {string|null|undefined} iso
 * @returns {string}
 */
function _fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Format a cash amount as a dollar string.
 * @param {number} amount
 * @returns {string}
 */
function _fmtCash(amount) {
  return '$' + amount.toLocaleString();
}

/**
 * Build a rewards paragraph element listing unlocked part names.
 * Returns null if the mission has no unlockedParts.
 *
 * @param {import('../data/missions.js').MissionDef} mission
 * @returns {HTMLElement|null}
 */
function _buildRewardsEl(mission) {
  if (!Array.isArray(mission.unlockedParts) || mission.unlockedParts.length === 0) {
    return null;
  }
  const el = document.createElement('p');
  el.className = 'mc-mission-rewards';

  const label = document.createElement('span');
  label.className = 'mc-rewards-label';
  label.textContent = 'Rewards:';
  el.appendChild(label);

  const partNames = mission.unlockedParts
    .map((id) => getPartById(id)?.name ?? id)
    .join(', ');
  el.appendChild(document.createTextNode(' ' + partNames));
  return el;
}

// ---------------------------------------------------------------------------
// Tutorial phase helper
// ---------------------------------------------------------------------------

/**
 * Return true while the player is still in the early tutorial phase.
 *
 * The tutorial phase ends once `mission-004` appears in
 * `state.missions.completed`.  During the tutorial, at most one mission may
 * be accepted at a time.
 *
 * @param {import('../core/gameState.js').GameState} state
 * @returns {boolean}
 */
function _isTutorialPhase(state) {
  return !state.missions.completed.some((m) => m.id === TUTORIAL_GATE_MISSION_ID);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Mission Control overlay and recalculate mission unlock state.
 *
 * @param {HTMLElement} container   The #ui-overlay div.
 * @param {import('../core/gameState.js').GameState} state
 * @param {{ onBack: () => void }} callbacks
 */
export function initMissionControlUI(container, state, { onBack }) {
  _state     = state;
  _onBack    = onBack;
  _activeTab = 'available';

  // Recalculate mission unlock state on every open.
  getUnlockedMissions(state);

  // Inject CSS once.
  if (!document.getElementById('mission-control-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'mission-control-styles';
    styleEl.textContent = MISSION_CONTROL_STYLES;
    document.head.appendChild(styleEl);
  }

  _overlay = document.createElement('div');
  _overlay.id = 'mission-control-overlay';
  container.appendChild(_overlay);

  _renderShell();
  _renderAvailableTab();

  console.log('[Mission Control UI] Initialized');
}

/**
 * Remove the Mission Control overlay from the DOM.
 */
export function destroyMissionControlUI() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state  = null;
  _onBack = null;
  console.log('[Mission Control UI] Destroyed');
}

// ---------------------------------------------------------------------------
// Private — layout shell
// ---------------------------------------------------------------------------

/**
 * Build the static shell: header + tab bar + empty content area.
 */
function _renderShell() {
  if (!_overlay) return;

  // Header
  const header = document.createElement('div');
  header.id = 'mission-control-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'mission-control-back-btn';
  backBtn.textContent = '← Hub';
  backBtn.addEventListener('click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroyMissionControlUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'mission-control-title';
  const mccTierLevel = _state ? getMissionControlTier(_state) : 1;
  const mccTierInfo = MCC_TIER_FEATURES[mccTierLevel];
  title.textContent = `Mission Control Centre — Tier ${mccTierLevel}` + (mccTierInfo ? ` (${mccTierInfo.label})` : '');
  header.appendChild(title);

  _overlay.appendChild(header);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.id = 'mission-control-tabs';

  const tabs = [
    { id: 'available', label: 'Missions' },
    { id: 'accepted',  label: 'Accepted'  },
    { id: 'completed', label: 'Completed' },
    { id: '_divider',  label: '' },
    { id: 'contracts', label: 'Contracts' },
    { id: 'active-contracts', label: 'Active' },
    { id: '_divider2', label: '' },
    { id: 'achievements', label: 'Achievements' },
  ];

  for (const tab of tabs) {
    if (tab.id.startsWith('_divider')) {
      const divider = document.createElement('div');
      divider.className = 'mc-tab-divider';
      tabBar.appendChild(divider);
      continue;
    }
    const btn = document.createElement('button');
    btn.className = 'mc-tab' + (tab.id === _activeTab ? ' active' : '');
    btn.dataset.tabId = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => _switchTab(tab.id));
    tabBar.appendChild(btn);
  }

  _overlay.appendChild(tabBar);

  // Content area
  const content = document.createElement('div');
  content.id = 'mission-control-content';
  _overlay.appendChild(content);
}

/**
 * Switch to a different tab and re-render its content.
 * @param {string} tabId
 */
function _switchTab(tabId) {
  _activeTab = tabId;

  // Update tab button active class.
  if (_overlay) {
    _overlay.querySelectorAll('.mc-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tabId === tabId);
    });
  }

  if (tabId === 'available')        _renderAvailableTab();
  if (tabId === 'accepted')         _renderAcceptedTab();
  if (tabId === 'completed')        _renderCompletedTab();
  if (tabId === 'contracts')        _renderContractsBoardTab();
  if (tabId === 'active-contracts') _renderActiveContractsTab();
  if (tabId === 'achievements')     _renderAchievementsTab();
}

/**
 * Get the #mission-control-content element and clear it.
 * @returns {HTMLElement | null}
 */
function _getContent() {
  const el = _overlay ? _overlay.querySelector('#mission-control-content') : null;
  if (el) el.innerHTML = '';
  return el;
}

// ---------------------------------------------------------------------------
// Private — Available tab
// ---------------------------------------------------------------------------

function _renderAvailableTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const missions = _state.missions.available;

  if (missions.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No missions currently available. Complete your active missions to unlock more.';
    content.appendChild(msg);
    return;
  }

  // Determine whether the Accept button should be globally blocked.
  const tutorialPhase    = _isTutorialPhase(_state);
  const hasAcceptedMission = _state.missions.accepted.length > 0;
  const blockAccept      = tutorialPhase && hasAcceptedMission;

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  for (const mission of missions) {
    const card = _buildAvailableMissionCard(mission, blockAccept, tutorialPhase);
    list.appendChild(card);
  }

  content.appendChild(list);
}

/**
 * Build a mission card for the Available tab.
 *
 * @param {import('../data/missions.js').MissionDef} mission
 * @param {boolean} blockAccept  True if the Accept button should be disabled.
 * @param {boolean} tutorialPhase  True while in the early tutorial.
 * @returns {HTMLElement}
 */
function _buildAvailableMissionCard(mission, blockAccept, tutorialPhase) {
  const card = document.createElement('div');
  card.className = 'mc-mission-card';
  card.dataset.missionId = mission.id;

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = mission.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = _fmtCash(mission.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = mission.description;
  card.appendChild(desc);

  // Reward parts (shown before accept so the player knows what they'll earn).
  const availRewards = _buildRewardsEl(mission);
  if (availRewards) card.appendChild(availRewards);

  // Accept row
  const acceptRow = document.createElement('div');
  acceptRow.className = 'mc-accept-row';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'mc-accept-btn';
  acceptBtn.textContent = 'Accept Mission';
  acceptBtn.disabled = blockAccept;
  acceptBtn.dataset.missionId = mission.id;

  if (blockAccept) {
    acceptBtn.title = 'Complete your current mission before accepting a new one.';
  }

  acceptBtn.addEventListener('click', () => _handleAccept(mission.id));
  acceptRow.appendChild(acceptBtn);

  // Show a contextual notice during the tutorial when blocked.
  if (blockAccept && tutorialPhase) {
    const notice = document.createElement('span');
    notice.className = 'mc-tutorial-notice';
    notice.textContent = 'Complete your active mission first.';
    acceptRow.appendChild(notice);
  }

  card.appendChild(acceptRow);

  return card;
}

/**
 * Handle clicking the Accept button for a mission.
 * @param {string} missionId
 */
function _handleAccept(missionId) {
  if (!_state) return;

  const result = acceptMission(_state, missionId);

  if (result.success) {
    // Re-render the Available tab to reflect the updated state.
    _renderAvailableTab();
    refreshTopBarMissions();
  } else {
    console.warn('[Mission Control UI] acceptMission failed:', result.error);
  }
}

// ---------------------------------------------------------------------------
// Private — Accepted tab
// ---------------------------------------------------------------------------

function _renderAcceptedTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const missions = _state.missions.accepted;

  if (missions.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No missions currently accepted. Visit the Available tab to take on a mission.';
    content.appendChild(msg);
    return;
  }

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  for (const mission of missions) {
    const card = _buildAcceptedMissionCard(mission);
    list.appendChild(card);
  }

  content.appendChild(list);
}

/**
 * Build a mission card for the Accepted tab, including objectives.
 *
 * @param {import('../data/missions.js').MissionDef} mission
 * @returns {HTMLElement}
 */
function _buildAcceptedMissionCard(mission) {
  const card = document.createElement('div');
  card.className = 'mc-mission-card';
  card.dataset.missionId = mission.id;

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = mission.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = _fmtCash(mission.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = mission.description;
  card.appendChild(desc);

  // Objectives section
  if (mission.objectives && mission.objectives.length > 0) {
    const objLabel = document.createElement('p');
    objLabel.className = 'mc-objectives-label';
    objLabel.textContent = 'Objectives';
    card.appendChild(objLabel);

    const objList = document.createElement('ul');
    objList.className = 'mc-objectives-list';

    for (const obj of mission.objectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item';

      const indicator = document.createElement('span');
      indicator.className = `mc-objective-indicator ${obj.completed ? 'completed' : 'pending'}`;
      // Checkmark for completed, hollow circle for pending.
      indicator.textContent = obj.completed ? '✓' : '○';
      indicator.setAttribute('aria-label', obj.completed ? 'Completed' : 'Pending');
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = `mc-objective-text ${obj.completed ? 'completed' : 'pending'}`;
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      objList.appendChild(item);
    }

    card.appendChild(objList);
  }

  // Reward parts.
  const accRewards = _buildRewardsEl(mission);
  if (accRewards) card.appendChild(accRewards);

  return card;
}

// ---------------------------------------------------------------------------
// Private — Completed tab
// ---------------------------------------------------------------------------

function _renderCompletedTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const missions = _state.missions.completed;

  if (missions.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No missions completed yet. Accept a mission and launch to get started!';
    content.appendChild(msg);
    return;
  }

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  // Show most recently completed first.
  const sorted = missions.slice().reverse();

  for (const mission of sorted) {
    list.appendChild(_buildCompletedMissionCard(mission));
  }

  content.appendChild(list);
}

/**
 * Build a mission card for the Completed tab.
 * Matches the layout of accepted cards but with all objectives checked
 * and a completion date shown.
 *
 * @param {import('../data/missions.js').MissionDef} mission
 * @returns {HTMLElement}
 */
function _buildCompletedMissionCard(mission) {
  const card = document.createElement('div');
  card.className = 'mc-mission-card mc-mission-card-completed';
  card.dataset.missionId = mission.id;

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = mission.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = _fmtCash(mission.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Completed date
  if (mission.completedDate) {
    const dateEl = document.createElement('p');
    dateEl.className = 'mc-completed-date';
    dateEl.textContent = 'Completed ' + _fmtDate(mission.completedDate);
    card.appendChild(dateEl);
  }

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = mission.description;
  card.appendChild(desc);

  // Objectives section (all completed)
  if (mission.objectives && mission.objectives.length > 0) {
    const objLabel = document.createElement('p');
    objLabel.className = 'mc-objectives-label';
    objLabel.textContent = 'Objectives';
    card.appendChild(objLabel);

    const objList = document.createElement('ul');
    objList.className = 'mc-objectives-list';

    for (const obj of mission.objectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item';

      const indicator = document.createElement('span');
      indicator.className = 'mc-objective-indicator completed';
      indicator.textContent = '✓';
      indicator.setAttribute('aria-label', 'Completed');
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = 'mc-objective-text completed';
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      objList.appendChild(item);
    }

    card.appendChild(objList);
  }

  // Reward parts
  const rewards = _buildRewardsEl(mission);
  if (rewards) card.appendChild(rewards);

  return card;
}

// ---------------------------------------------------------------------------
// Private — Contracts Board tab
// ---------------------------------------------------------------------------

/**
 * Format a ContractCategory enum value as a readable label.
 * @param {string} category
 * @returns {string}
 */
function _categoryLabel(category) {
  const labels = {
    ALTITUDE_RECORD: 'Altitude',
    SPEED_RECORD: 'Speed',
    SCIENCE_SURVEY: 'Science',
    SATELLITE_DEPLOY: 'Satellite',
    SAFE_RECOVERY: 'Recovery',
    ORBITAL: 'Orbital',
    CRASH_TEST: 'Crash Test',
  };
  return labels[category] ?? category;
}

/**
 * Get the icon glyph for a contract category.
 * @param {string} category
 * @returns {string}
 */
function _categoryIcon(category) {
  return CONTRACT_CATEGORY_ICONS[category] ?? '';
}

function _renderContractsBoardTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const contracts = _state.contracts?.board ?? [];
  const caps = getContractCaps(_state);
  const mccTier = getMissionControlTier(_state);
  const tierInfo = MCC_TIER_FEATURES[mccTier];

  // MCC Tier info bar
  const tierBar = document.createElement('div');
  tierBar.className = 'mc-caps-info';
  tierBar.style.marginBottom = '4px';
  tierBar.innerHTML = `Mission Control: <strong>Tier ${mccTier}</strong> (${tierInfo?.label ?? 'Unknown'})`;
  if (mccTier < 3 && MCC_TIER_FEATURES[mccTier + 1]) {
    const nextInfo = MCC_TIER_FEATURES[mccTier + 1];
    const hint = document.createElement('span');
    hint.style.cssText = 'margin-left:8px;font-size:0.72rem;opacity:0.7';
    hint.textContent = `Upgrade to unlock: ${nextInfo.features[nextInfo.features.length - 1]}`;
    tierBar.appendChild(hint);
  }
  content.appendChild(tierBar);

  // Caps info bar
  const capsInfo = document.createElement('div');
  capsInfo.className = 'mc-caps-info';
  capsInfo.textContent = `Board: ${contracts.length}/${caps.pool} slots | Active: ${(_state.contracts?.active ?? []).length}/${caps.active} slots`;
  content.appendChild(capsInfo);

  // Reputation bar (colour-coded by tier)
  const rep = _state.reputation ?? 50;
  const repTier = getReputationTier(rep);
  const repBar = document.createElement('div');
  repBar.className = 'mc-reputation-bar';
  repBar.innerHTML = `<span>Reputation: <strong style="color:${repTier.color}">${Math.round(rep)}</strong></span><span style="font-size:0.72rem;color:${repTier.color};background:${repTier.color}22;border:1px solid ${repTier.color}44;padding:1px 6px;border-radius:3px;margin-left:4px;text-transform:uppercase;letter-spacing:0.04em;font-weight:600">${repTier.label}</span>`;
  const repTrack = document.createElement('div');
  repTrack.className = 'mc-rep-track';
  const repFill = document.createElement('div');
  repFill.className = 'mc-rep-fill';
  repFill.style.width = `${Math.max(0, Math.min(100, rep))}%`;
  repFill.style.backgroundColor = repTier.color;
  repTrack.appendChild(repFill);
  repBar.appendChild(repTrack);
  content.appendChild(repBar);

  if (contracts.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No contracts on the board. Complete a flight to generate new contracts.';
    content.appendChild(msg);
    return;
  }

  const activeCount = (_state.contracts?.active ?? []).length;
  const canAcceptMore = activeCount < caps.active;

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  for (const contract of contracts) {
    list.appendChild(_buildContractBoardCard(contract, canAcceptMore));
  }

  content.appendChild(list);
}

/**
 * Build a contract card for the Board tab.
 *
 * @param {import('../core/gameState.js').Contract} contract
 * @param {boolean} canAcceptMore
 * @returns {HTMLElement}
 */
function _buildContractBoardCard(contract, canAcceptMore) {
  const card = document.createElement('div');
  card.className = 'mc-mission-card';
  card.dataset.contractId = contract.id;

  // Category badge with icon
  const catBadge = document.createElement('span');
  catBadge.className = 'mc-contract-category';
  const icon = _categoryIcon(contract.category);
  catBadge.textContent = (icon ? icon + ' ' : '') + _categoryLabel(contract.category);
  card.appendChild(catBadge);

  // Chain indicator
  if (contract.chainId && contract.chainPart) {
    const chainEl = document.createElement('div');
    chainEl.className = 'mc-contract-chain';
    chainEl.textContent = `Chain: Part ${contract.chainPart} of ${contract.chainTotal}`;
    card.appendChild(chainEl);
  }

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = contract.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = _fmtCash(contract.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = contract.description;
  card.appendChild(desc);

  // Objectives preview
  if (contract.objectives && contract.objectives.length > 0) {
    const objLabel = document.createElement('p');
    objLabel.className = 'mc-objectives-label';
    objLabel.textContent = 'Objectives';
    card.appendChild(objLabel);

    const objList = document.createElement('ul');
    objList.className = 'mc-objectives-list';

    for (const obj of contract.objectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item';

      const indicator = document.createElement('span');
      indicator.className = 'mc-objective-indicator pending';
      indicator.textContent = '○';
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = 'mc-objective-text pending';
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      objList.appendChild(item);
    }
    card.appendChild(objList);
  }

  // Bonus objectives preview
  if (Array.isArray(contract.bonusObjectives) && contract.bonusObjectives.length > 0) {
    const bonusLabel = document.createElement('p');
    bonusLabel.className = 'mc-bonus-label';
    bonusLabel.textContent = 'Bonus Targets (Optional)';
    card.appendChild(bonusLabel);

    const bonusList = document.createElement('ul');
    bonusList.className = 'mc-objectives-list';

    for (const obj of contract.bonusObjectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item bonus';

      const indicator = document.createElement('span');
      indicator.className = 'mc-objective-indicator pending';
      indicator.textContent = '\u2606'; // ☆
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = 'mc-objective-text pending';
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      bonusList.appendChild(item);
    }
    card.appendChild(bonusList);

    if (contract.bonusReward) {
      const bonusRewardEl = document.createElement('p');
      bonusRewardEl.className = 'mc-bonus-reward';
      bonusRewardEl.textContent = `Bonus reward: ${_fmtCash(contract.bonusReward)}`;
      card.appendChild(bonusRewardEl);
    }
  }

  // Meta info
  const meta = document.createElement('p');
  meta.className = 'mc-contract-meta';
  const flightsLeft = contract.boardExpiryPeriod - (_state?.currentPeriod ?? 0);
  meta.innerHTML =
    `<span>Expires in ${flightsLeft} flight${flightsLeft !== 1 ? 's' : ''}</span>` +
    (contract.deadlinePeriod != null
      ? `<span>Deadline: ${contract.deadlinePeriod - (_state?.currentPeriod ?? 0)} flights after accept</span>`
      : '<span>No deadline</span>') +
    `<span>Penalty: ${_fmtCash(contract.penaltyFee)}</span>`;
  card.appendChild(meta);

  // Accept button
  const acceptRow = document.createElement('div');
  acceptRow.className = 'mc-accept-row';

  const acceptBtn = document.createElement('button');
  acceptBtn.className = 'mc-accept-btn';
  acceptBtn.textContent = 'Accept Contract';
  acceptBtn.disabled = !canAcceptMore;
  if (!canAcceptMore) {
    acceptBtn.title = 'Active contract limit reached.';
  }
  acceptBtn.addEventListener('click', () => _handleAcceptContract(contract.id));
  acceptRow.appendChild(acceptBtn);

  if (!canAcceptMore) {
    const notice = document.createElement('span');
    notice.className = 'mc-tutorial-notice';
    notice.textContent = 'Active contract limit reached.';
    acceptRow.appendChild(notice);
  }

  card.appendChild(acceptRow);

  return card;
}

/**
 * Handle clicking Accept on a board contract.
 * @param {string} contractId
 */
function _handleAcceptContract(contractId) {
  if (!_state) return;

  const result = acceptContract(_state, contractId);
  if (result.success) {
    _renderContractsBoardTab();
  } else {
    console.warn('[Mission Control UI] acceptContract failed:', result.error);
  }
}

// ---------------------------------------------------------------------------
// Private — Active Contracts tab
// ---------------------------------------------------------------------------

function _renderActiveContractsTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const contracts = _state.contracts?.active ?? [];
  const caps = getContractCaps(_state);

  // Caps info bar
  const capsInfo = document.createElement('div');
  capsInfo.className = 'mc-caps-info';
  capsInfo.textContent = `Active: ${contracts.length}/${caps.active} slots`;
  content.appendChild(capsInfo);

  if (contracts.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'mc-empty-msg';
    msg.textContent = 'No active contracts. Visit the Contracts tab to accept one.';
    content.appendChild(msg);
    return;
  }

  const list = document.createElement('div');
  list.className = 'mc-mission-list';

  for (const contract of contracts) {
    list.appendChild(_buildActiveContractCard(contract));
  }

  content.appendChild(list);
}

/**
 * Build a card for an active contract (objectives + cancel button).
 *
 * @param {import('../core/gameState.js').Contract} contract
 * @returns {HTMLElement}
 */
function _buildActiveContractCard(contract) {
  const card = document.createElement('div');
  card.className = 'mc-mission-card';
  card.dataset.contractId = contract.id;

  // Category badge with icon
  const catBadge = document.createElement('span');
  catBadge.className = 'mc-contract-category';
  const activeIcon = _categoryIcon(contract.category);
  catBadge.textContent = (activeIcon ? activeIcon + ' ' : '') + _categoryLabel(contract.category);
  card.appendChild(catBadge);

  // Chain indicator
  if (contract.chainId && contract.chainPart) {
    const chainEl = document.createElement('div');
    chainEl.className = 'mc-contract-chain';
    chainEl.textContent = `Chain: Part ${contract.chainPart} of ${contract.chainTotal}`;
    card.appendChild(chainEl);
  }

  // Header row: title + reward
  const cardHeader = document.createElement('div');
  cardHeader.className = 'mc-mission-card-header';

  const titleEl = document.createElement('h3');
  titleEl.className = 'mc-mission-title';
  titleEl.textContent = contract.title;
  cardHeader.appendChild(titleEl);

  const rewardEl = document.createElement('span');
  rewardEl.className = 'mc-mission-reward';
  rewardEl.textContent = _fmtCash(contract.reward);
  cardHeader.appendChild(rewardEl);

  card.appendChild(cardHeader);

  // Description
  const desc = document.createElement('p');
  desc.className = 'mc-mission-description';
  desc.textContent = contract.description;
  card.appendChild(desc);

  // Objectives section
  if (contract.objectives && contract.objectives.length > 0) {
    const objLabel = document.createElement('p');
    objLabel.className = 'mc-objectives-label';
    objLabel.textContent = 'Objectives';
    card.appendChild(objLabel);

    const objList = document.createElement('ul');
    objList.className = 'mc-objectives-list';

    for (const obj of contract.objectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item';

      const indicator = document.createElement('span');
      indicator.className = `mc-objective-indicator ${obj.completed ? 'completed' : 'pending'}`;
      indicator.textContent = obj.completed ? '✓' : '○';
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = `mc-objective-text ${obj.completed ? 'completed' : 'pending'}`;
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      objList.appendChild(item);
    }
    card.appendChild(objList);
  }

  // Bonus objectives (active contract — show progress)
  if (Array.isArray(contract.bonusObjectives) && contract.bonusObjectives.length > 0) {
    const bonusLabel = document.createElement('p');
    bonusLabel.className = 'mc-bonus-label';
    bonusLabel.textContent = 'Bonus Targets (Optional)';
    card.appendChild(bonusLabel);

    const bonusList = document.createElement('ul');
    bonusList.className = 'mc-objectives-list';

    for (const obj of contract.bonusObjectives) {
      const item = document.createElement('li');
      item.className = 'mc-objective-item bonus';

      const indicator = document.createElement('span');
      indicator.className = `mc-objective-indicator ${obj.completed ? 'completed' : 'pending'}`;
      indicator.textContent = obj.completed ? '\u2605' : '\u2606'; // ★ or ☆
      item.appendChild(indicator);

      const textEl = document.createElement('span');
      textEl.className = `mc-objective-text ${obj.completed ? 'completed' : 'pending'}`;
      textEl.textContent = obj.description;
      item.appendChild(textEl);

      bonusList.appendChild(item);
    }
    card.appendChild(bonusList);

    if (contract.bonusReward) {
      const bonusRewardEl = document.createElement('p');
      bonusRewardEl.className = 'mc-bonus-reward';
      bonusRewardEl.textContent = `Bonus reward: ${_fmtCash(contract.bonusReward)}`;
      card.appendChild(bonusRewardEl);
    }
  }

  // Conflict warning
  if (_state && Array.isArray(contract.conflictTags) && contract.conflictTags.length > 0) {
    const conflicts = getActiveConflicts(_state);
    const myConflicts = conflicts.filter(
      (c) => c.contractA === contract.id || c.contractB === contract.id,
    );
    if (myConflicts.length > 0) {
      const otherIds = myConflicts.map((c) =>
        c.contractA === contract.id ? c.contractB : c.contractA,
      );
      const otherTitles = otherIds.map((id) => {
        const other = _state.contracts.active.find((ac) => ac.id === id);
        return other ? other.title : id;
      });
      const warning = document.createElement('div');
      warning.className = 'mc-conflict-warning';
      warning.textContent = `Conflicts with: ${otherTitles.join(', ')}`;
      card.appendChild(warning);
    }
  }

  // Meta info (deadline)
  const meta = document.createElement('p');
  meta.className = 'mc-contract-meta';
  if (contract.deadlinePeriod != null) {
    const flightsLeft = contract.deadlinePeriod - (_state?.currentPeriod ?? 0);
    meta.innerHTML = `<span>Deadline: ${flightsLeft} flight${flightsLeft !== 1 ? 's' : ''} remaining</span>`;
  } else {
    meta.innerHTML = '<span>No deadline (open-ended)</span>';
  }
  card.appendChild(meta);

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'mc-cancel-btn';
  cancelBtn.textContent = `Cancel (${_fmtCash(contract.penaltyFee)} penalty)`;
  cancelBtn.addEventListener('click', () => _handleCancelContract(contract.id));
  card.appendChild(cancelBtn);

  return card;
}

/**
 * Handle clicking Cancel on an active contract.
 * @param {string} contractId
 */
function _handleCancelContract(contractId) {
  if (!_state) return;

  const result = cancelContract(_state, contractId);
  if (result.success) {
    _renderActiveContractsTab();
  } else {
    console.warn('[Mission Control UI] cancelContract failed:', result.error);
  }
}

// ---------------------------------------------------------------------------
// Private — Achievements tab
// ---------------------------------------------------------------------------

/** Achievement icon map — earned vs locked. */
const _ACHIEVEMENT_ICONS = {
  FIRST_ORBIT:          { earned: '\u{1F30D}', locked: '\u{1F311}' },
  FIRST_SATELLITE:      { earned: '\u{1F6F0}', locked: '\u{1F311}' },
  FIRST_CONSTELLATION:  { earned: '\u{2728}',  locked: '\u{1F311}' },
  FIRST_LUNAR_FLYBY:    { earned: '\u{1F319}', locked: '\u{1F311}' },
  FIRST_LUNAR_ORBIT:    { earned: '\u{1F31D}', locked: '\u{1F311}' },
  FIRST_LUNAR_LANDING:  { earned: '\u{1F311}', locked: '\u{1F311}' },
  FIRST_LUNAR_RETURN:   { earned: '\u{1F680}', locked: '\u{1F311}' },
  FIRST_MARS_ORBIT:     { earned: '\u{1FA90}', locked: '\u{1F311}' },
  FIRST_MARS_LANDING:   { earned: '\u{1F534}', locked: '\u{1F311}' },
  FIRST_SOLAR_SCIENCE:  { earned: '\u{2600}',  locked: '\u{1F311}' },
};

function _renderAchievementsTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const achievements = getAchievementStatus(_state);
  const earnedCount = achievements.filter((a) => a.earned).length;
  const totalCount = achievements.length;

  // Summary bar
  const summary = document.createElement('div');
  summary.className = 'mc-achievement-summary';
  summary.innerHTML = `<strong>${earnedCount}</strong> of ${totalCount} achievements earned`;
  content.appendChild(summary);

  // Grid of achievement cards
  const grid = document.createElement('div');
  grid.className = 'mc-achievement-grid';

  for (const ach of achievements) {
    const card = document.createElement('div');
    card.className = 'mc-achievement-card' + (ach.earned ? ' earned' : ' locked');

    // Header with icon and title
    const header = document.createElement('div');
    header.className = 'mc-achievement-header';

    const icon = document.createElement('span');
    icon.className = 'mc-achievement-icon';
    const iconMap = _ACHIEVEMENT_ICONS[ach.id] ?? { earned: '\u{1F3C6}', locked: '\u{1F311}' };
    icon.textContent = ach.earned ? iconMap.earned : iconMap.locked;
    header.appendChild(icon);

    const title = document.createElement('h3');
    title.className = 'mc-achievement-title';
    title.textContent = ach.earned ? ach.title : ach.title;
    header.appendChild(title);

    card.appendChild(header);

    // Description
    const desc = document.createElement('p');
    desc.className = 'mc-achievement-desc';
    desc.textContent = ach.description;
    card.appendChild(desc);

    // Rewards row
    const rewards = document.createElement('div');
    rewards.className = 'mc-achievement-rewards';

    const cash = document.createElement('span');
    cash.className = 'mc-achievement-cash';
    cash.textContent = _fmtCash(ach.cashReward);
    rewards.appendChild(cash);

    const rep = document.createElement('span');
    rep.className = 'mc-achievement-rep';
    rep.textContent = `+${ach.repReward} rep`;
    rewards.appendChild(rep);

    card.appendChild(rewards);

    // Earned date
    if (ach.earned && ach.earnedPeriod != null) {
      const earnedEl = document.createElement('div');
      earnedEl.className = 'mc-achievement-earned-date';
      earnedEl.textContent = `Earned on flight ${ach.earnedPeriod}`;
      card.appendChild(earnedEl);
    }

    grid.appendChild(card);
  }

  content.appendChild(grid);
}

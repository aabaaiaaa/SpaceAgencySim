/**
 * missionControl.js — Mission Control Centre HTML overlay UI.
 *
 * Three tabs:
 *   - Available  : Lists all available missions with title, description, reward,
 *                  and an "Accept" button.  During the early tutorial (missions
 *                  1–4), only one mission can be accepted at a time; if one is
 *                  already active the Accept button is disabled for all others.
 *                  After mission 4 is completed, multiple missions can be
 *                  accepted simultaneously.
 *   - Accepted   : Lists currently accepted missions with their objectives,
 *                  showing each objective description and a completion indicator
 *                  (checkmark if done, hollow circle if pending).
 *   - Completed  : Lists all completed missions with the date they were
 *                  completed and the reward received.
 *
 * Mission unlock state is recalculated each time this screen is opened by
 * calling getUnlockedMissions() on init.
 *
 * @module missionControl
 */

import { acceptMission, getUnlockedMissions } from '../core/missions.js';
import { getPartById } from '../data/parts.js';
import { refreshTopBarMissions } from './topbar.js';

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

/* ── Completed missions table ────────────────────────────────────────────── */
.mc-completed-table {
  width: 100%;
  max-width: 760px;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.mc-completed-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  color: #8090a8;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  white-space: nowrap;
}

.mc-completed-table td {
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  vertical-align: middle;
}

.mc-completed-table tr:last-child td {
  border-bottom: none;
}

.mc-completed-table tr:hover td {
  background: rgba(255,255,255,0.03);
}

.mc-completed-title-cell {
  font-weight: 600;
  color: #d4e0f0;
}

.mc-completed-reward-cell {
  color: #7dd87d;
  font-weight: 600;
  white-space: nowrap;
}

.mc-completed-date-cell {
  color: #8090a8;
  white-space: nowrap;
}

/* ── Empty state messages ────────────────────────────────────────────────── */
.mc-empty-msg {
  color: #666;
  font-style: italic;
  text-align: center;
  padding: 40px 20px;
  font-size: 0.9rem;
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
  title.textContent = 'Mission Control Centre';
  header.appendChild(title);

  _overlay.appendChild(header);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.id = 'mission-control-tabs';

  const tabs = [
    { id: 'available', label: 'Available' },
    { id: 'accepted',  label: 'Accepted'  },
    { id: 'completed', label: 'Completed' },
  ];

  for (const tab of tabs) {
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

  if (tabId === 'available') _renderAvailableTab();
  if (tabId === 'accepted')  _renderAcceptedTab();
  if (tabId === 'completed') _renderCompletedTab();
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

  const table = document.createElement('table');
  table.className = 'mc-completed-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Mission</th>
        <th>Completed</th>
        <th>Reward</th>
        <th>Parts Unlocked</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  // Show most recently completed first.
  const sorted = missions.slice().reverse();

  for (const mission of sorted) {
    const tr = document.createElement('tr');

    const titleTd = document.createElement('td');
    titleTd.className = 'mc-completed-title-cell';
    titleTd.textContent = mission.title;
    tr.appendChild(titleTd);

    const dateTd = document.createElement('td');
    dateTd.className = 'mc-completed-date-cell';
    // completedDate is stamped by completeMission() in core/missions.js.
    dateTd.textContent = _fmtDate(mission.completedDate);
    tr.appendChild(dateTd);

    const rewardTd = document.createElement('td');
    rewardTd.className = 'mc-completed-reward-cell';
    rewardTd.textContent = _fmtCash(mission.reward);
    tr.appendChild(rewardTd);

    const partsTd = document.createElement('td');
    partsTd.className = 'mc-completed-parts-cell';
    const parts = mission.unlockedParts ?? [];
    partsTd.textContent = parts.length > 0
      ? parts.map((id) => getPartById(id)?.name ?? id).join(', ')
      : '—';
    tr.appendChild(partsTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  content.appendChild(table);
}

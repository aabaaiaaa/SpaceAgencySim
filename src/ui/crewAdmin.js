/**
 * crewAdmin.js — Crew Administration Building HTML overlay UI.
 *
 * Four tabs (Training tab visible at Crew Admin Tier 2+):
 *   - Active Crew  : Lists active astronauts with name, missions/flights, Fire button.
 *   - Hire          : Form to hire a new astronaut (name optional; auto-generated if blank).
 *                     At Tier 3, also offers experienced crew recruitment.
 *   - Training      : (Tier 2+) Assign crew to skill training between flights.
 *   - History       : All crew ever hired (active, fired, KIA), sorted by hire date
 *                     descending.
 *
 * @module crewAdmin
 */

import {
  hireCrew, fireCrew, getActiveCrew, getFullHistory, getAdjustedHireCost,
  assignToTraining, cancelTraining, getTrainingCrew, getTrainingSlotInfo,
  hireExperiencedCrew, getExperiencedHireCost,
  payMedicalCare, payAdvancedMedicalCare, isCrewInjured,
} from '../core/crew.js';
import {
  AstronautStatus, FacilityId,
  CREW_ADMIN_TIER_FEATURES, TRAINING_COURSE_COST, TRAINING_COURSE_DURATION, TRAINING_SKILL_GAIN,
} from '../core/constants.js';
import { getFacilityTier } from '../core/construction.js';
import { refreshTopBar } from './topbar.js';
import { injectStyleOnce } from './injectStyle.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CREW_ADMIN_STYLES = `
/* ── Crew Admin overlay ────────────────────────────────────────────────────── */
#crew-admin-overlay {
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

/* ── Header ─────────────────────────────────────────────────────────────────── */
#crew-admin-header {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--header-padding);
  flex-shrink: 0;
}

#crew-admin-back-btn {
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
#crew-admin-back-btn:hover {
  background: var(--color-secondary-bg-hover);
}

#crew-admin-title {
  font-size: var(--font-size-h2);
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--color-text-heading);
  margin: 0;
}

/* ── Tab bar ─────────────────────────────────────────────────────────────────── */
#crew-admin-tabs {
  display: flex;
  gap: var(--space-xs);
  padding: var(--space-md) var(--space-xl) 0;
  border-bottom: 2px solid var(--color-border-tab);
  flex-shrink: 0;
}

.crew-admin-tab {
  background: transparent;
  border: 1px solid transparent;
  border-bottom: none;
  color: var(--color-tab-text);
  font-size: 0.9rem;
  font-weight: 600;
  padding: var(--space-sm) 18px;
  cursor: pointer;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  transition: color var(--transition-default), background var(--transition-default);
  position: relative;
  bottom: -2px;
}
.crew-admin-tab:hover {
  color: var(--color-tab-text-hover);
  background: var(--color-tab-bg-hover);
}
.crew-admin-tab.active {
  color: var(--color-tab-text-active);
  background: var(--color-tab-bg-active);
  border-color: var(--color-tab-border-active);
  border-bottom-color: var(--color-surface);
}

/* ── Tab content area ────────────────────────────────────────────────────────── */
#crew-admin-content {
  flex: 1;
  overflow-y: auto;
  padding: var(--panel-padding);
}

/* ── Active Crew tab ─────────────────────────────────────────────────────────── */
.crew-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.crew-table th {
  text-align: left;
  padding: 8px 12px;
  font-weight: 600;
  color: #8090a8;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  white-space: nowrap;
}

.crew-table td {
  padding: 9px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  vertical-align: middle;
}

.crew-table tr:last-child td {
  border-bottom: none;
}

.crew-table tr:hover td {
  background: rgba(255,255,255,0.03);
}

.crew-name-cell {
  font-weight: 600;
  color: #d4e0f0;
}

.crew-fire-btn {
  background: var(--color-danger-bg);
  border: 1px solid var(--color-danger-border);
  color: var(--color-danger);
  font-size: 0.8rem;
  padding: var(--btn-padding-sm);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-default), border-color var(--transition-default);
  white-space: nowrap;
}
.crew-fire-btn:hover {
  background: rgba(220, 60, 60, 0.3);
  border-color: rgba(220, 60, 60, 0.7);
}

.crew-empty-msg {
  color: var(--color-text-disabled);
  font-style: italic;
  text-align: center;
  padding: var(--space-4xl) var(--space-xl);
  font-size: 0.9rem;
}

/* ── Skill bars ──────────────────────────────────────────────────────────────── */
.crew-skills-cell {
  min-width: 180px;
}

.crew-skill-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 3px;
  font-size: 0.78rem;
}

.crew-skill-row:last-child {
  margin-bottom: 0;
}

.crew-skill-label {
  width: 52px;
  text-align: right;
  color: #8090a8;
  flex-shrink: 0;
}

.crew-skill-bar-bg {
  flex: 1;
  height: 8px;
  background: rgba(255,255,255,0.06);
  border-radius: 4px;
  overflow: hidden;
  min-width: 80px;
}

.crew-skill-bar-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

.crew-skill-bar-fill.piloting {
  background: linear-gradient(90deg, #4488cc, #66aaee);
}

.crew-skill-bar-fill.engineering {
  background: linear-gradient(90deg, #cc8844, #eeaa66);
}

.crew-skill-bar-fill.science {
  background: linear-gradient(90deg, #44aa66, #66dd88);
}

.crew-skill-value {
  width: 28px;
  text-align: right;
  color: #a0aab8;
  font-size: 0.72rem;
  flex-shrink: 0;
}

.crew-skill-effect {
  font-size: 0.7rem;
  color: #6a7a8a;
  margin-left: 58px;
  margin-top: -1px;
  margin-bottom: 4px;
}

/* ── Hire tab ────────────────────────────────────────────────────────────────── */
#crew-hire-panel {
  max-width: 460px;
  margin: 20px auto 0;
}

.hire-cash-display {
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  margin-bottom: 22px;
  font-size: 0.9rem;
}

.hire-cash-label {
  color: #8090a8;
  margin-bottom: 4px;
}

.hire-cash-amount {
  font-size: 1.2rem;
  font-weight: 700;
  color: #7dd87d;
}

.hire-cash-amount.insufficient {
  color: #e86060;
}

.hire-cost-note {
  color: #8090a8;
  font-size: 0.8rem;
  margin-top: 6px;
}

.hire-form-group {
  margin-bottom: 18px;
}

.hire-form-label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  color: #a0aab8;
  margin-bottom: 6px;
}

.hire-form-input {
  width: 100%;
  background: rgba(255,255,255,0.07);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: #e8e8e8;
  font-size: 0.9rem;
  padding: 9px 12px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s;
}
.hire-form-input::placeholder {
  color: #5a6070;
}
.hire-form-input:focus {
  border-color: rgba(100, 160, 255, 0.5);
}

.hire-char-counter {
  font-size: 0.72rem;
  color: var(--color-text-muted, #6080a0);
  margin-top: 4px;
  text-align: right;
}
.hire-char-counter.warning {
  color: var(--color-warning, #d8b860);
}

.hire-btn {
  width: 100%;
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
  color: var(--color-primary-text);
  font-size: 0.9rem;
  font-weight: 700;
  padding: 11px 20px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition-default), border-color var(--transition-default);
  letter-spacing: 0.03em;
}
.hire-btn:hover:not(:disabled) {
  background: var(--color-primary-bg-hover);
  border-color: var(--color-primary-border-hover);
}
.hire-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.hire-feedback {
  margin-top: 12px;
  font-size: 0.85rem;
  min-height: 1.2em;
  text-align: center;
}
.hire-feedback.success { color: #7dd87d; }
.hire-feedback.error   { color: #e86060; }

/* ── History tab ─────────────────────────────────────────────────────────────── */
.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.history-table th {
  text-align: left;
  padding: 8px 10px;
  font-weight: 600;
  color: #8090a8;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  white-space: nowrap;
}

.history-table td {
  padding: 8px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  vertical-align: top;
}

.history-table tr:last-child td {
  border-bottom: none;
}

.history-row-active td {
  color: #d4e0f0;
}
.history-row-active .hist-name-cell {
  font-weight: 600;
}

.history-row-fired td {
  color: #7a8090;
}

.history-row-kia td {
  color: #e07070;
}
.history-row-kia .hist-name-cell {
  font-weight: 600;
}

.kia-marker {
  margin-right: 5px;
  font-size: 0.85em;
}

.hist-status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 3px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.hist-status-badge.active {
  background: rgba(60, 180, 80, 0.2);
  color: #7dd87d;
  border: 1px solid rgba(60, 180, 80, 0.35);
}
.hist-status-badge.fired {
  background: rgba(130, 130, 130, 0.15);
  color: #999;
  border: 1px solid rgba(130, 130, 130, 0.3);
}
.hist-status-badge.kia {
  background: rgba(220, 60, 60, 0.2);
  color: #e86060;
  border: 1px solid rgba(220, 60, 60, 0.35);
}

.hist-cause-cell {
  font-size: 0.8rem;
  color: #c07070;
  font-style: italic;
}

.history-empty-msg {
  color: var(--color-text-disabled);
  font-style: italic;
  text-align: center;
  padding: var(--space-4xl) var(--space-xl);
  font-size: 0.9rem;
}

/* ── Tier info bar ─────────────────────────────────────────────────────────── */
.crew-tier-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 20px;
  background: rgba(255,255,255,0.03);
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 0.82rem;
  color: #8090a8;
  flex-shrink: 0;
}

.crew-tier-features {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
}

.crew-tier-feature {
  color: #6a7a8a;
  font-size: 0.78rem;
}

/* ── Training tab ──────────────────────────────────────────────────────────── */
.training-panel {
  max-width: 700px;
  margin: 0 auto;
}

.training-info-box {
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: var(--radius-lg);
  padding: 14px 18px;
  margin-bottom: 20px;
  font-size: 0.85rem;
  color: #8090a8;
}

.training-cost-note {
  color: #ccaa44;
  font-size: 0.8rem;
  margin-top: 6px;
}

.training-crew-item {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: 10px 14px;
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  margin-bottom: 8px;
}

.training-crew-name {
  font-weight: 600;
  color: #d4e0f0;
  min-width: 140px;
}

.training-skill-select {
  background: rgba(255,255,255,0.07);
  border: 1px solid var(--color-border-strong);
  border-radius: var(--radius-sm);
  color: #e8e8e8;
  font-size: 0.82rem;
  padding: 5px 8px;
}

.training-assign-btn,
.training-cancel-btn {
  font-size: 0.8rem;
  padding: 5px 12px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.training-assign-btn {
  background: rgba(60, 180, 80, 0.15);
  border: 1px solid rgba(60, 180, 80, 0.4);
  color: #7dd87d;
}
.training-assign-btn:hover {
  background: rgba(60, 180, 80, 0.3);
}

.training-cancel-btn {
  background: rgba(220, 160, 60, 0.15);
  border: 1px solid rgba(220, 160, 60, 0.4);
  color: #ddaa44;
}
.training-cancel-btn:hover {
  background: rgba(220, 160, 60, 0.3);
}

.training-status {
  font-size: 0.8rem;
  color: #66dd88;
  font-style: italic;
}

/* ── Experienced hire section ──────────────────────────────────────────────── */
.exp-hire-section {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid rgba(255,255,255,0.1);
}

.exp-hire-title {
  font-size: 1rem;
  font-weight: 700;
  color: #ccaa44;
  margin-bottom: 12px;
}

.exp-hire-desc {
  font-size: 0.82rem;
  color: #8090a8;
  margin-bottom: 14px;
}

/* ── Medical buttons ──────────────────────────────────────────────────────── */
.crew-medical-btn {
  background: rgba(60, 180, 120, 0.15);
  border: 1px solid rgba(60, 180, 120, 0.4);
  color: #66cc88;
  font-size: 0.75rem;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
  margin-left: 6px;
}
.crew-medical-btn:hover {
  background: rgba(60, 180, 120, 0.3);
}

.crew-injury-badge {
  display: inline-block;
  font-size: 0.72rem;
  color: #e0a040;
  background: rgba(220, 160, 60, 0.15);
  border: 1px solid rgba(220, 160, 60, 0.3);
  padding: 1px 8px;
  border-radius: 3px;
  margin-left: 6px;
}

.crew-training-badge {
  display: inline-block;
  font-size: 0.72rem;
  color: #66dd88;
  background: rgba(60, 180, 80, 0.12);
  border: 1px solid rgba(60, 180, 80, 0.3);
  padding: 1px 8px;
  border-radius: 3px;
  margin-left: 6px;
}
`;

// ---------------------------------------------------------------------------
// Random name pool
// ---------------------------------------------------------------------------

const FIRST_NAMES = [
  'Alex', 'Sam', 'Jordan', 'Casey', 'Morgan', 'Taylor', 'Drew', 'Riley',
  'Quinn', 'Avery', 'Skyler', 'Blake', 'Reese', 'Jamie', 'Rowan', 'Sage',
  'Finley', 'Parker', 'Harper', 'Dallas', 'Remy', 'Lennox', 'Arden', 'Ellis',
  'Ivan', 'Omar', 'Priya', 'Yuki', 'Nadia', 'Kofi', 'Leila', 'Soren',
];

const LAST_NAMES = [
  'Armstrong', 'Glenn', 'Aldrin', 'Collins', 'Lovell', 'Shepard', 'Conrad',
  'Bean', 'Mitchell', 'Scott', 'Irwin', 'Young', 'Cernan', 'Evans',
  'Stafford', 'Cooper', 'Gordon', 'Schweickart', 'Anders', 'Borman',
  'Tereshkova', 'Gagarin', 'Leonov', 'Titov', 'Savitskaya',
  'Ride', 'Jemison', 'Chang-Diaz', 'Musgrave', 'McAuliffe',
];

/**
 * Generate a random astronaut name.
 * @returns {string}
 */
function generateRandomName() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last  = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/**
 * Format an ISO 8601 date string to a readable short date.
 * @param {string|null} iso
 * @returns {string}
 */
function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year:  'numeric',
      month: 'short',
      day:   'numeric',
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
function fmtCash(amount) {
  return '$' + amount.toLocaleString();
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The root overlay element. @type {HTMLElement | null} */
let _overlay = null;

/** Reference to the game state. @type {import('../core/gameState.js').GameState | null} */
let _state = null;

/** Callback to navigate back to the hub. @type {(() => void) | null} */
let _onBack = null;

/** Currently active tab id: 'active' | 'hire' | 'history' */
let _activeTab = 'active';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Crew Administration overlay.
 *
 * @param {HTMLElement} container   The #ui-overlay div.
 * @param {import('../core/gameState.js').GameState} state
 * @param {{ onBack: () => void }} callbacks
 */
export function initCrewAdminUI(container, state, { onBack }) {
  _state   = state;
  _onBack  = onBack;
  _activeTab = 'active';

  // Inject CSS once.
  injectStyleOnce('crew-admin-styles', CREW_ADMIN_STYLES);

  _overlay = document.createElement('div');
  _overlay.id = 'crew-admin-overlay';
  container.appendChild(_overlay);

  _renderShell();
  _renderActiveTab();


}

/**
 * Remove the Crew Administration overlay from the DOM.
 */
export function destroyCrewAdminUI() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state   = null;
  _onBack  = null;

}

// ---------------------------------------------------------------------------
// Private — layout
// ---------------------------------------------------------------------------

/**
 * Build the static shell: header + tab bar + empty content area.
 * Tab content is rendered separately.
 */
function _renderShell() {
  if (!_overlay) return;

  // Header
  const header = document.createElement('div');
  header.id = 'crew-admin-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'crew-admin-back-btn';
  backBtn.textContent = '← Hub';
  backBtn.addEventListener('click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroyCrewAdminUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const crewAdminTier = _state ? getFacilityTier(_state, FacilityId.CREW_ADMIN) : 1;
  const tierFeatures = CREW_ADMIN_TIER_FEATURES[crewAdminTier];
  const title = document.createElement('h1');
  title.id = 'crew-admin-title';
  title.textContent = `Crew Administration \u2014 Tier ${crewAdminTier}` + (tierFeatures ? ` (${tierFeatures.label})` : '');
  header.appendChild(title);

  _overlay.appendChild(header);

  // Tier feature list
  if (tierFeatures) {
    const tierBar = document.createElement('div');
    tierBar.className = 'crew-tier-bar';

    const featureList = document.createElement('div');
    featureList.className = 'crew-tier-features';
    for (const feat of tierFeatures.features) {
      const span = document.createElement('span');
      span.className = 'crew-tier-feature';
      span.textContent = feat;
      featureList.appendChild(span);
    }
    tierBar.appendChild(featureList);
    _overlay.appendChild(tierBar);
  }

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.id = 'crew-admin-tabs';

  const tabs = [
    { id: 'active',  label: 'Active Crew' },
    { id: 'hire',    label: 'Hire' },
  ];

  // Training tab only visible at Tier 2+
  if (crewAdminTier >= 2) {
    tabs.push({ id: 'training', label: 'Training' });
  }

  tabs.push({ id: 'history', label: 'History' });

  for (const tab of tabs) {
    const btn = document.createElement('button');
    btn.className = 'crew-admin-tab' + (tab.id === _activeTab ? ' active' : '');
    btn.dataset.tabId = tab.id;
    btn.textContent = tab.label;
    btn.addEventListener('click', () => _switchTab(tab.id));
    tabBar.appendChild(btn);
  }

  _overlay.appendChild(tabBar);

  // Content area
  const content = document.createElement('div');
  content.id = 'crew-admin-content';
  _overlay.appendChild(content);
}

/**
 * Switch to a different tab and re-render content.
 * @param {string} tabId
 */
function _switchTab(tabId) {
  _activeTab = tabId;

  // Update tab button active state.
  if (_overlay) {
    _overlay.querySelectorAll('.crew-admin-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tabId === tabId);
    });
  }

  // Re-render the content area.
  if (tabId === 'active')   _renderActiveTab();
  if (tabId === 'hire')     _renderHireTab();
  if (tabId === 'training') _renderTrainingTab();
  if (tabId === 'history')  _renderHistoryTab();
}

/**
 * Get the content div and clear it.
 * @returns {HTMLElement | null}
 */
function _getContent() {
  const el = _overlay ? _overlay.querySelector('#crew-admin-content') : null;
  if (el) el.innerHTML = '';
  return el;
}

// ---------------------------------------------------------------------------
// Private — Active Crew tab
// ---------------------------------------------------------------------------

function _renderActiveTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const crew = getActiveCrew(_state);

  if (crew.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'crew-empty-msg';
    msg.textContent = 'No active crew. Visit the Hire tab to recruit astronauts.';
    content.appendChild(msg);
    return;
  }

  const crewAdminTier = getFacilityTier(_state, FacilityId.CREW_ADMIN);

  const table = document.createElement('table');
  table.className = 'crew-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Skills</th>
        <th>Status</th>
        <th>Missions</th>
        <th>Flights</th>
        <th></th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  for (const astronaut of crew) {
    const tr = document.createElement('tr');

    const nameTd = document.createElement('td');
    nameTd.className = 'crew-name-cell';
    nameTd.textContent = astronaut.name;
    tr.appendChild(nameTd);

    // Skills column with bars and effect descriptions
    const skillsTd = document.createElement('td');
    skillsTd.className = 'crew-skills-cell';
    const skills = astronaut.skills ?? { piloting: 0, engineering: 0, science: 0 };
    skillsTd.innerHTML = _renderSkillBars(skills);
    tr.appendChild(skillsTd);

    // Status column — injury, training, or ready
    const statusTd = document.createElement('td');
    const injured = isCrewInjured(_state, astronaut.id);
    if (injured) {
      const remaining = (astronaut.injuryEnds ?? 0) - (_state.currentPeriod ?? 0);
      const badge = document.createElement('span');
      badge.className = 'crew-injury-badge';
      badge.textContent = `Injured (${remaining} flights)`;
      statusTd.appendChild(badge);

      // Medical care button
      const medBtn = document.createElement('button');
      medBtn.className = 'crew-medical-btn';
      medBtn.textContent = crewAdminTier >= 3 ? 'Adv. Medical' : 'Medical';
      medBtn.addEventListener('click', () => {
        const result = crewAdminTier >= 3
          ? payAdvancedMedicalCare(_state, astronaut.id)
          : payMedicalCare(_state, astronaut.id);
        if (result.success) {
          refreshTopBar();
          _renderActiveTab();
        }
      });
      statusTd.appendChild(medBtn);
    } else if (astronaut.trainingSkill) {
      const badge = document.createElement('span');
      badge.className = 'crew-training-badge';
      const periodsLeft = Math.max(0, (astronaut.trainingEnds ?? 0) - (_state.currentPeriod ?? 0));
      badge.textContent = `Training: ${astronaut.trainingSkill} (${periodsLeft} left)`;
      statusTd.appendChild(badge);
    } else {
      statusTd.textContent = 'Ready';
      statusTd.style.color = '#7dd87d';
    }
    tr.appendChild(statusTd);

    const missionsTd = document.createElement('td');
    missionsTd.textContent = String(astronaut.missionsFlown);
    tr.appendChild(missionsTd);

    const flightsTd = document.createElement('td');
    flightsTd.textContent = String(astronaut.flightsFlown);
    tr.appendChild(flightsTd);

    const actionTd = document.createElement('td');
    const fireBtn = document.createElement('button');
    fireBtn.className = 'crew-fire-btn';
    fireBtn.textContent = 'Fire';
    fireBtn.dataset.crewId = astronaut.id;
    fireBtn.addEventListener('click', () => _handleFire(astronaut.id));
    actionTd.appendChild(fireBtn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  content.appendChild(table);
}

/**
 * Render skill bars with effect descriptions for a crew member.
 * @param {{ piloting: number, engineering: number, science: number }} skills
 * @returns {string}  HTML string.
 */
function _renderSkillBars(skills) {
  const p = Math.round(skills.piloting);
  const e = Math.round(skills.engineering);
  const s = Math.round(skills.science);

  const pilotEffect = `+${(p * 0.3).toFixed(0)}% turn rate`;
  const engEffect = `${(60 + (e / 100) * 20).toFixed(0)}% part recovery`;
  const sciDuration = (100 - (s / 100) * 33.3).toFixed(0);
  const sciEffect = `${sciDuration}% exp. time, +${((s / 100) * 50).toFixed(0)}% yield`;

  return `
    <div class="crew-skill-row">
      <span class="crew-skill-label">Pilot</span>
      <div class="crew-skill-bar-bg"><div class="crew-skill-bar-fill piloting" style="width:${p}%"></div></div>
      <span class="crew-skill-value">${p}</span>
    </div>
    <div class="crew-skill-effect">${pilotEffect}</div>
    <div class="crew-skill-row">
      <span class="crew-skill-label">Eng.</span>
      <div class="crew-skill-bar-bg"><div class="crew-skill-bar-fill engineering" style="width:${e}%"></div></div>
      <span class="crew-skill-value">${e}</span>
    </div>
    <div class="crew-skill-effect">${engEffect}</div>
    <div class="crew-skill-row">
      <span class="crew-skill-label">Science</span>
      <div class="crew-skill-bar-bg"><div class="crew-skill-bar-fill science" style="width:${s}%"></div></div>
      <span class="crew-skill-value">${s}</span>
    </div>
    <div class="crew-skill-effect">${sciEffect}</div>
  `;
}

/**
 * Handle the "Fire" button for an astronaut.
 * @param {string} id  Astronaut ID.
 */
function _handleFire(id) {
  if (!_state) return;
  const ok = fireCrew(_state, id);
  if (ok) {
    // Refresh the active crew list.
    _renderActiveTab();
  }
}

// ---------------------------------------------------------------------------
// Private — Hire tab
// ---------------------------------------------------------------------------

function _renderHireTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const cash         = _state.money;
  const hireCost     = getAdjustedHireCost(_state.reputation ?? 50);
  const canAfford    = cash >= hireCost;
  const activeCrew   = getActiveCrew(_state);
  const atCapacity   = activeCrew.length >= 20; // MAX_CREW_SIZE

  const panel = document.createElement('div');
  panel.id = 'crew-hire-panel';

  // Cash display
  const cashBox = document.createElement('div');
  cashBox.className = 'hire-cash-display';
  cashBox.innerHTML = `
    <div class="hire-cash-label">Current Funds</div>
    <div class="hire-cash-amount ${canAfford ? '' : 'insufficient'}">${fmtCash(cash)}</div>
    <div class="hire-cost-note">Hire cost: ${fmtCash(hireCost)} per astronaut</div>
  `;
  panel.appendChild(cashBox);

  if (atCapacity) {
    const capMsg = document.createElement('p');
    capMsg.className = 'crew-empty-msg';
    capMsg.style.cssText = 'margin: 0; padding: 16px 0; text-align: left;';
    capMsg.textContent = 'Crew roster is full (20 astronauts maximum).';
    panel.appendChild(capMsg);
    content.appendChild(panel);
    return;
  }

  // Name field
  const formGroup = document.createElement('div');
  formGroup.className = 'hire-form-group';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'hire-form-label';
  nameLabel.htmlFor = 'hire-name-input';
  nameLabel.textContent = 'Astronaut Name';
  formGroup.appendChild(nameLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'hire-name-input';
  nameInput.className = 'hire-form-input';
  nameInput.placeholder = 'Leave blank for a random name';
  nameInput.maxLength = 60;
  formGroup.appendChild(nameInput);

  const nameCounter = document.createElement('div');
  nameCounter.className = 'hire-char-counter';
  nameCounter.textContent = '0 / 60';
  formGroup.appendChild(nameCounter);

  nameInput.addEventListener('input', () => {
    const len = nameInput.value.length;
    nameCounter.textContent = `${len} / 60`;
    nameCounter.classList.toggle('warning', len >= 55);
  });

  panel.appendChild(formGroup);

  // Hire button
  const hireBtn = document.createElement('button');
  hireBtn.className = 'hire-btn';
  hireBtn.disabled = !canAfford;
  hireBtn.textContent = `Hire Astronaut — ${fmtCash(hireCost)}`;
  panel.appendChild(hireBtn);

  // Feedback message
  const feedback = document.createElement('p');
  feedback.className = 'hire-feedback';
  panel.appendChild(feedback);

  hireBtn.addEventListener('click', () => {
    if (!_state) return;
    const rawName = nameInput.value.trim();
    const name    = rawName.length > 0 ? rawName : generateRandomName();
    const result  = hireCrew(_state, name);

    if (result.success) {
      feedback.className = 'hire-feedback success';
      feedback.textContent = `${result.astronaut.name} has joined the crew!`;
      nameInput.value = '';
      // Sync the persistent top bar cash display.
      refreshTopBar();
      // Refresh cash display and button state.
      _renderHireTab();
      // Show the success message again after re-render.
      const newFeedback = content.querySelector('.hire-feedback');
      if (newFeedback) {
        newFeedback.className = 'hire-feedback success';
        newFeedback.textContent = `${result.astronaut.name} has joined the crew!`;
      }
    } else {
      feedback.className = 'hire-feedback error';
      feedback.textContent = result.error || 'Unable to hire astronaut.';
    }
  });

  // ── Experienced crew section (Tier 3) ────────────────────────────────────
  const crewAdminTier = getFacilityTier(_state, FacilityId.CREW_ADMIN);
  if (crewAdminTier >= 3 && !atCapacity) {
    const expSection = document.createElement('div');
    expSection.className = 'exp-hire-section';

    const expTitle = document.createElement('div');
    expTitle.className = 'exp-hire-title';
    expTitle.textContent = 'Recruit Experienced Astronaut';
    expSection.appendChild(expTitle);

    const expDesc = document.createElement('p');
    expDesc.className = 'exp-hire-desc';
    expDesc.textContent = 'Experienced recruits start with skills between 10–30 in all areas, but cost significantly more to hire.';
    expSection.appendChild(expDesc);

    const expCost = getExperiencedHireCost(_state.reputation ?? 50);
    const canAffordExp = cash >= expCost;

    const expNameGroup = document.createElement('div');
    expNameGroup.className = 'hire-form-group';
    const expLabel = document.createElement('label');
    expLabel.className = 'hire-form-label';
    expLabel.htmlFor = 'exp-hire-name-input';
    expLabel.textContent = 'Astronaut Name';
    expNameGroup.appendChild(expLabel);

    const expNameInput = document.createElement('input');
    expNameInput.type = 'text';
    expNameInput.id = 'exp-hire-name-input';
    expNameInput.className = 'hire-form-input';
    expNameInput.placeholder = 'Leave blank for a random name';
    expNameInput.maxLength = 60;
    expNameGroup.appendChild(expNameInput);
    expSection.appendChild(expNameGroup);

    const expBtn = document.createElement('button');
    expBtn.className = 'hire-btn';
    expBtn.disabled = !canAffordExp;
    expBtn.style.background = 'rgba(200, 160, 40, 0.25)';
    expBtn.style.borderColor = 'rgba(200, 160, 40, 0.5)';
    expBtn.style.color = '#ddcc66';
    expBtn.textContent = `Hire Experienced — ${fmtCash(expCost)}`;
    expSection.appendChild(expBtn);

    const expFeedback = document.createElement('p');
    expFeedback.className = 'hire-feedback';
    expSection.appendChild(expFeedback);

    expBtn.addEventListener('click', () => {
      if (!_state) return;
      const rawName = expNameInput.value.trim();
      const name = rawName.length > 0 ? rawName : generateRandomName();
      const result = hireExperiencedCrew(_state, name);

      if (result.success) {
        const sk = result.astronaut.skills;
        expFeedback.className = 'hire-feedback success';
        expFeedback.textContent = `${result.astronaut.name} joined (P:${Math.round(sk.piloting)} E:${Math.round(sk.engineering)} S:${Math.round(sk.science)})!`;
        expNameInput.value = '';
        refreshTopBar();
        _renderHireTab();
        // Show feedback again after re-render
        const newFb = content.querySelector('.exp-hire-section .hire-feedback');
        if (newFb) {
          newFb.className = 'hire-feedback success';
          newFb.textContent = `${result.astronaut.name} joined!`;
        }
      } else {
        expFeedback.className = 'hire-feedback error';
        expFeedback.textContent = result.error || 'Unable to hire experienced astronaut.';
      }
    });

    panel.appendChild(expSection);
  }

  content.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Private — Training tab (Tier 2+)
// ---------------------------------------------------------------------------

function _renderTrainingTab() {
  const content = _getContent();
  if (!content || !_state) return;

  const crewAdminTier = getFacilityTier(_state, FacilityId.CREW_ADMIN);
  if (crewAdminTier < 2) {
    const msg = document.createElement('p');
    msg.className = 'crew-empty-msg';
    msg.textContent = 'Upgrade Crew Administration to Tier 2 to unlock training.';
    content.appendChild(msg);
    return;
  }

  const panel = document.createElement('div');
  panel.className = 'training-panel';

  // Slot info
  const slotInfo = getTrainingSlotInfo(_state);
  const currentPeriod = _state.currentPeriod ?? 0;

  // Info box
  const infoBox = document.createElement('div');
  infoBox.className = 'training-info-box';
  infoBox.innerHTML = `
    Enrol astronauts in training courses to improve a chosen skill.
    <div class="training-cost-note">
      Course cost: ${fmtCash(TRAINING_COURSE_COST)} &bull; Duration: ${TRAINING_COURSE_DURATION} flights &bull; Gain: +${TRAINING_SKILL_GAIN} skill
    </div>
    <div class="training-cost-note" style="margin-top:4px;">
      Training slots: ${slotInfo.usedSlots} / ${slotInfo.maxSlots} in use
    </div>
  `;
  panel.appendChild(infoBox);

  // Currently training section
  const trainingCrew = getTrainingCrew(_state);
  if (trainingCrew.length > 0) {
    const sectionTitle = document.createElement('h3');
    sectionTitle.style.cssText = 'color: #a0aab8; font-size: 0.9rem; margin: 16px 0 10px;';
    sectionTitle.textContent = `Currently Training (${trainingCrew.length})`;
    panel.appendChild(sectionTitle);

    for (const astronaut of trainingCrew) {
      const item = document.createElement('div');
      item.className = 'training-crew-item';

      const name = document.createElement('span');
      name.className = 'training-crew-name';
      name.textContent = astronaut.name;
      item.appendChild(name);

      // Progress info: skill + periods remaining
      const periodsLeft = (astronaut.trainingEnds ?? 0) - currentPeriod;
      const status = document.createElement('span');
      status.className = 'training-status';
      status.textContent = `${astronaut.trainingSkill} — ${Math.max(0, periodsLeft)} flight${periodsLeft !== 1 ? 's' : ''} remaining`;
      item.appendChild(status);

      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'training-cancel-btn';
      cancelBtn.textContent = 'Cancel Course';
      cancelBtn.addEventListener('click', () => {
        cancelTraining(_state, astronaut.id);
        _renderTrainingTab();
        refreshTopBar(_state);
      });
      item.appendChild(cancelBtn);

      panel.appendChild(item);
    }
  }

  // Available for training
  const slotsAvailable = slotInfo.availableSlots > 0;
  const activeCrew = getActiveCrew(_state);
  const availableForTraining = activeCrew.filter((a) => {
    if (a.trainingSkill) return false; // already training
    if (a.assignedRocketId) return false; // assigned to rocket
    if (isCrewInjured(_state, a.id)) return false; // injured
    return true;
  });

  const availTitle = document.createElement('h3');
  availTitle.style.cssText = 'color: #a0aab8; font-size: 0.9rem; margin: 20px 0 10px;';
  availTitle.textContent = `Available for Training (${availableForTraining.length})`;
  panel.appendChild(availTitle);

  if (!slotsAvailable && availableForTraining.length > 0) {
    const slotMsg = document.createElement('p');
    slotMsg.className = 'crew-empty-msg';
    slotMsg.style.padding = '6px 0 12px';
    slotMsg.textContent = 'All training slots are in use. Wait for a course to finish or upgrade Crew Admin.';
    panel.appendChild(slotMsg);
  }

  if (availableForTraining.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'crew-empty-msg';
    msg.style.padding = '12px 0';
    msg.textContent = 'No crew available. Crew must be active, uninjured, and not assigned to a rocket.';
    panel.appendChild(msg);
  } else {
    for (const astronaut of availableForTraining) {
      const item = document.createElement('div');
      item.className = 'training-crew-item';

      const name = document.createElement('span');
      name.className = 'training-crew-name';
      name.textContent = astronaut.name;
      item.appendChild(name);

      // Skill selector
      const select = document.createElement('select');
      select.className = 'training-skill-select';
      for (const skill of ['piloting', 'engineering', 'science']) {
        const opt = document.createElement('option');
        opt.value = skill;
        const currentVal = Math.round(astronaut.skills?.[skill] ?? 0);
        opt.textContent = `${skill.charAt(0).toUpperCase() + skill.slice(1)} (${currentVal})`;
        select.appendChild(opt);
      }
      item.appendChild(select);

      const assignBtn = document.createElement('button');
      assignBtn.className = 'training-assign-btn';
      assignBtn.textContent = `Enrol (${fmtCash(TRAINING_COURSE_COST)})`;
      assignBtn.disabled = !slotsAvailable;
      assignBtn.addEventListener('click', () => {
        const result = assignToTraining(_state, astronaut.id, select.value);
        if (result.success) {
          _renderTrainingTab();
          refreshTopBar(_state);
        }
      });
      item.appendChild(assignBtn);

      panel.appendChild(item);
    }
  }

  content.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Private — History tab
// ---------------------------------------------------------------------------

function _renderHistoryTab() {
  const content = _getContent();
  if (!content || !_state) return;

  // Get full history sorted by hire date descending (newest first).
  const all = getFullHistory(_state).slice().sort((a, b) => {
    const da = new Date(a.hireDate).getTime();
    const db = new Date(b.hireDate).getTime();
    return db - da;
  });

  if (all.length === 0) {
    const msg = document.createElement('p');
    msg.className = 'history-empty-msg';
    msg.textContent = 'No crew history yet. Hire your first astronaut on the Hire tab.';
    content.appendChild(msg);
    return;
  }

  const table = document.createElement('table');
  table.className = 'history-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Hired</th>
        <th>Missions</th>
        <th>Status</th>
        <th>Details</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');

  for (const astronaut of all) {
    const isKia   = astronaut.status === AstronautStatus.KIA;
    const isFired = astronaut.status === AstronautStatus.FIRED;

    const tr = document.createElement('tr');
    tr.className = isKia
      ? 'history-row-kia'
      : isFired
        ? 'history-row-fired'
        : 'history-row-active';

    // Name
    const nameTd = document.createElement('td');
    nameTd.className = 'hist-name-cell';
    if (isKia) {
      const marker = document.createElement('span');
      marker.className = 'kia-marker';
      marker.textContent = '†';
      marker.title = 'Killed in Action';
      nameTd.appendChild(marker);
    }
    nameTd.appendChild(document.createTextNode(astronaut.name));
    tr.appendChild(nameTd);

    // Hire date
    const hireTd = document.createElement('td');
    hireTd.textContent = fmtDate(astronaut.hireDate);
    tr.appendChild(hireTd);

    // Missions flown
    const missionsTd = document.createElement('td');
    missionsTd.textContent = String(astronaut.missionsFlown);
    tr.appendChild(missionsTd);

    // Status badge
    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `hist-status-badge ${astronaut.status}`;
    badge.textContent = astronaut.status === AstronautStatus.ACTIVE
      ? 'Active'
      : astronaut.status === AstronautStatus.FIRED
        ? 'Fired'
        : 'KIA';
    statusTd.appendChild(badge);
    tr.appendChild(statusTd);

    // Details (death info for KIA, blank for others)
    const detailsTd = document.createElement('td');
    if (isKia) {
      detailsTd.className = 'hist-cause-cell';
      const deathInfo = [
        astronaut.deathDate ? fmtDate(astronaut.deathDate) : null,
        astronaut.deathCause || null,
      ]
        .filter(Boolean)
        .join(' — ');
      detailsTd.textContent = deathInfo || '—';
    } else {
      detailsTd.textContent = '—';
    }
    tr.appendChild(detailsTd);

    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  content.appendChild(table);
}

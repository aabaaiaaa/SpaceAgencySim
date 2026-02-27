/**
 * crewAdmin.js — Crew Administration Building HTML overlay UI.
 *
 * Three tabs:
 *   - Active Crew  : Lists active astronauts with name, missions/flights, Fire button.
 *   - Hire          : Form to hire a new astronaut (name optional; auto-generated if blank).
 *                     Shows hire cost and current cash so the player can judge affordability.
 *   - History       : All crew ever hired (active, fired, KIA), sorted by hire date
 *                     descending. KIA rows are visually distinguished in red. Each row
 *                     shows name, hire date, missions flown, status, and for KIA: death date
 *                     and cause of death.
 *
 * @module crewAdmin
 */

import { hireCrew, fireCrew, getActiveCrew, getFullHistory } from '../core/crew.js';
import { AstronautStatus, HIRE_COST } from '../core/constants.js';
import { refreshTopBar } from './topbar.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CREW_ADMIN_STYLES = `
/* ── Crew Admin overlay ────────────────────────────────────────────────────── */
#crew-admin-overlay {
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

/* ── Header ─────────────────────────────────────────────────────────────────── */
#crew-admin-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px 0;
  flex-shrink: 0;
}

#crew-admin-back-btn {
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
#crew-admin-back-btn:hover {
  background: rgba(255,255,255,0.16);
}

#crew-admin-title {
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #f0f0f0;
  margin: 0;
}

/* ── Tab bar ─────────────────────────────────────────────────────────────────── */
#crew-admin-tabs {
  display: flex;
  gap: 4px;
  padding: 12px 20px 0;
  border-bottom: 2px solid rgba(255,255,255,0.1);
  flex-shrink: 0;
}

.crew-admin-tab {
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
.crew-admin-tab:hover {
  color: #e0e0e0;
  background: rgba(255,255,255,0.05);
}
.crew-admin-tab.active {
  color: #ffffff;
  background: rgba(255,255,255,0.06);
  border-color: rgba(255,255,255,0.15);
  border-bottom-color: rgba(10, 12, 20, 0.96);
}

/* ── Tab content area ────────────────────────────────────────────────────────── */
#crew-admin-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
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
  background: rgba(220, 60, 60, 0.15);
  border: 1px solid rgba(220, 60, 60, 0.4);
  color: #e86060;
  font-size: 0.8rem;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  white-space: nowrap;
}
.crew-fire-btn:hover {
  background: rgba(220, 60, 60, 0.3);
  border-color: rgba(220, 60, 60, 0.7);
}

.crew-empty-msg {
  color: #666;
  font-style: italic;
  text-align: center;
  padding: 40px 20px;
  font-size: 0.9rem;
}

/* ── Hire tab ────────────────────────────────────────────────────────────────── */
#crew-hire-panel {
  max-width: 460px;
  margin: 20px auto 0;
}

.hire-cash-display {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
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
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 5px;
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

.hire-btn {
  width: 100%;
  background: rgba(60, 120, 220, 0.25);
  border: 1px solid rgba(60, 120, 220, 0.5);
  color: #80b4f0;
  font-size: 0.9rem;
  font-weight: 700;
  padding: 11px 20px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  letter-spacing: 0.03em;
}
.hire-btn:hover:not(:disabled) {
  background: rgba(60, 120, 220, 0.4);
  border-color: rgba(60, 120, 220, 0.8);
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
  color: #666;
  font-style: italic;
  text-align: center;
  padding: 40px 20px;
  font-size: 0.9rem;
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
  if (!document.getElementById('crew-admin-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'crew-admin-styles';
    styleEl.textContent = CREW_ADMIN_STYLES;
    document.head.appendChild(styleEl);
  }

  _overlay = document.createElement('div');
  _overlay.id = 'crew-admin-overlay';
  container.appendChild(_overlay);

  _renderShell();
  _renderActiveTab();

  console.log('[Crew Admin UI] Initialized');
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
  console.log('[Crew Admin UI] Destroyed');
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

  const title = document.createElement('h1');
  title.id = 'crew-admin-title';
  title.textContent = 'Crew Administration';
  header.appendChild(title);

  _overlay.appendChild(header);

  // Tab bar
  const tabBar = document.createElement('div');
  tabBar.id = 'crew-admin-tabs';

  const tabs = [
    { id: 'active',  label: 'Active Crew' },
    { id: 'hire',    label: 'Hire' },
    { id: 'history', label: 'History' },
  ];

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
  if (tabId === 'active')  _renderActiveTab();
  if (tabId === 'hire')    _renderHireTab();
  if (tabId === 'history') _renderHistoryTab();
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

  const table = document.createElement('table');
  table.className = 'crew-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Name</th>
        <th>Missions Flown</th>
        <th>Flights Flown</th>
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
  const canAfford    = cash >= HIRE_COST;
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
    <div class="hire-cost-note">Hire cost: ${fmtCash(HIRE_COST)} per astronaut</div>
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

  panel.appendChild(formGroup);

  // Hire button
  const hireBtn = document.createElement('button');
  hireBtn.className = 'hire-btn';
  hireBtn.disabled = !canAfford;
  hireBtn.textContent = `Hire Astronaut — ${fmtCash(HIRE_COST)}`;
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

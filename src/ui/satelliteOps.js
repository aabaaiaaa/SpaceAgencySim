/**
 * satelliteOps.js — Satellite Network Operations Centre HTML overlay UI.
 *
 * Displays:
 *   - Network overview: total active satellites, capacity, constellation status.
 *   - Per-satellite list: name, type, band, health bar, auto-maintain toggle.
 *   - Aggregate benefits panel: current bonuses from the active network.
 *   - Decommission button for each satellite.
 *
 * Requires the Satellite Ops facility to be built.
 *
 * @module satelliteOps
 */

import {
  SatelliteType,
  SATELLITE_VALID_BANDS,
  CONSTELLATION_THRESHOLD,
  SATELLITE_AUTO_MAINTENANCE_COST,
  SATELLITE_DEGRADED_THRESHOLD,
} from '../core/constants.js';
import {
  getNetworkSummary,
  setAutoMaintenance,
  decommissionSatellite,
} from '../core/satellites.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const SAT_OPS_STYLES = `
/* ── Satellite Ops overlay ───────────────────────────────────────────────── */
#sat-ops-overlay {
  position: fixed;
  inset: 0;
  background: rgba(10, 12, 20, 0.96);
  z-index: 20;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  font-family: system-ui, sans-serif;
  color: #e8e8e8;
  padding-top: 44px;
}

#sat-ops-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px 0;
  flex-shrink: 0;
}

#sat-ops-back-btn {
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
#sat-ops-back-btn:hover {
  background: rgba(255,255,255,0.16);
}

#sat-ops-title {
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #f0f0f0;
  margin: 0;
}

/* ── Content ─────────────────────────────────────────────────────────────── */
#sat-ops-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 40px;
}

.sat-section {
  margin-bottom: 24px;
}

.sat-section h2 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #80c8ff;
  margin: 0 0 10px;
  letter-spacing: 0.02em;
}

/* ── Overview cards ──────────────────────────────────────────────────────── */
.sat-overview {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.sat-overview-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 12px 16px;
  min-width: 140px;
  flex: 1;
}

.sat-overview-card .label {
  font-size: 0.75rem;
  color: #8899aa;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.sat-overview-card .value {
  font-size: 1.3rem;
  font-weight: 700;
  color: #e0f0ff;
}

.sat-overview-card .value.constellation {
  color: #60dd80;
}

/* ── Benefits table ──────────────────────────────────────────────────────── */
.sat-benefits-table {
  width: 100%;
  max-width: 500px;
  border-collapse: collapse;
  font-size: 0.88rem;
}

.sat-benefits-table th {
  text-align: left;
  color: #8899aa;
  font-weight: 600;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.1);
}

.sat-benefits-table td {
  padding: 6px 10px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.sat-benefits-table td.active {
  color: #60dd80;
  font-weight: 600;
}

.sat-benefits-table td.inactive {
  color: #666;
}

/* ── Satellite list ──────────────────────────────────────────────────────── */
.sat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sat-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
}

.sat-card.decommissioned {
  opacity: 0.4;
}

.sat-card .sat-info {
  flex: 1;
}

.sat-card .sat-name {
  font-weight: 700;
  font-size: 0.95rem;
  color: #e0f0ff;
  margin-bottom: 2px;
}

.sat-card .sat-meta {
  font-size: 0.78rem;
  color: #8899aa;
}

.sat-health-bar {
  width: 80px;
  height: 8px;
  background: rgba(255,255,255,0.1);
  border-radius: 4px;
  overflow: hidden;
}

.sat-health-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}

.sat-health-fill.good  { background: #60dd80; }
.sat-health-fill.warn  { background: #ddaa40; }
.sat-health-fill.bad   { background: #dd4040; }

.sat-controls {
  display: flex;
  gap: 8px;
  align-items: center;
}

.sat-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  color: #9aa0b0;
  cursor: pointer;
}

.sat-toggle input[type="checkbox"] {
  accent-color: #60dd80;
}

.sat-decommission-btn {
  background: rgba(220,60,60,0.15);
  border: 1px solid rgba(220,60,60,0.3);
  color: #dd6666;
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.sat-decommission-btn:hover {
  background: rgba(220,60,60,0.3);
}

.sat-empty {
  color: #667;
  font-style: italic;
  padding: 20px 0;
}
`;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _overlay = null;
let _state = null;
let _onBack = null;

// ---------------------------------------------------------------------------
// Satellite type display helpers
// ---------------------------------------------------------------------------

const SAT_TYPE_LABELS = {
  [SatelliteType.COMMUNICATION]: 'Communication',
  [SatelliteType.WEATHER]:       'Weather',
  [SatelliteType.SCIENCE]:       'Science',
  [SatelliteType.GPS]:           'GPS/Navigation',
  [SatelliteType.RELAY]:         'Relay',
  GENERIC:                       'Generic',
};

const SAT_TYPE_ICONS = {
  [SatelliteType.COMMUNICATION]: '\u{1F4E1}',
  [SatelliteType.WEATHER]:       '\u{1F327}',
  [SatelliteType.SCIENCE]:       '\u{1F52C}',
  [SatelliteType.GPS]:           '\u{1F4CD}',
  [SatelliteType.RELAY]:         '\u{1F4E8}',
  GENERIC:                       '\u{1F6F0}',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Satellite Operations Centre overlay.
 *
 * @param {HTMLElement} container  The #ui-overlay div.
 * @param {import('../core/gameState.js').GameState} state
 * @param {{ onBack: () => void }} opts
 */
export function initSatelliteOpsUI(container, state, { onBack }) {
  _state = state;
  _onBack = onBack;

  // Inject styles once.
  if (!document.getElementById('sat-ops-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'sat-ops-styles';
    styleEl.textContent = SAT_OPS_STYLES;
    document.head.appendChild(styleEl);
  }

  _overlay = document.createElement('div');
  _overlay.id = 'sat-ops-overlay';
  container.appendChild(_overlay);

  _render();

  console.log('[Satellite Ops UI] Initialized');
}

/**
 * Remove the Satellite Operations Centre overlay.
 */
export function destroySatelliteOpsUI() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;
  _onBack = null;
  console.log('[Satellite Ops UI] Destroyed');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _render() {
  if (!_overlay || !_state) return;

  const summary = getNetworkSummary(_state);

  _overlay.innerHTML = '';

  // Header.
  const header = document.createElement('div');
  header.id = 'sat-ops-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'sat-ops-back-btn';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', () => {
    destroySatelliteOpsUI();
    if (_onBack) _onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'sat-ops-title';
  title.textContent = 'Satellite Network Operations';
  header.appendChild(title);

  _overlay.appendChild(header);

  // Content area.
  const content = document.createElement('div');
  content.id = 'sat-ops-content';

  // Overview section.
  content.appendChild(_renderOverview(summary));

  // Benefits section.
  content.appendChild(_renderBenefits(summary));

  // Satellite list.
  content.appendChild(_renderSatelliteList(summary));

  _overlay.appendChild(content);
}

/**
 * Render the overview cards (active count, capacity, constellation status).
 */
function _renderOverview(summary) {
  const section = document.createElement('div');
  section.className = 'sat-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Network Overview';
  section.appendChild(h2);

  const cards = document.createElement('div');
  cards.className = 'sat-overview';

  // Active / Capacity
  const activeCard = _card('Active Satellites', `${summary.totalActive} / ${summary.capacity}`);
  cards.appendChild(activeCard);

  // Constellations
  const constellations = Object.entries(summary.byType)
    .filter(([, info]) => info.constellation)
    .map(([type]) => SAT_TYPE_LABELS[type] || type);

  const constCard = _card(
    'Constellations',
    constellations.length > 0 ? constellations.join(', ') : 'None',
    constellations.length > 0,
  );
  cards.appendChild(constCard);

  section.appendChild(cards);
  return section;
}

/**
 * Render the aggregate benefits table.
 */
function _renderBenefits(summary) {
  const section = document.createElement('div');
  section.className = 'sat-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Network Benefits';
  section.appendChild(h2);

  const table = document.createElement('table');
  table.className = 'sat-benefits-table';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Benefit</th><th>Value</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  const b = summary.benefits;

  const rows = [
    ['Science Transmit Bonus', b.transmitYieldBonus > 0, `+${(b.transmitYieldBonus * 100).toFixed(0)}%`],
    ['Weather Skip Discount', b.weatherSkipDiscount > 0, `${(b.weatherSkipDiscount * 100).toFixed(0)}% off`],
    ['Forecast Accuracy', b.forecastAccuracy > 0, `+${(b.forecastAccuracy * 100).toFixed(0)}%`],
    ['Passive Science/Period', b.sciencePerPeriod > 0, `+${b.sciencePerPeriod} SP`],
    ['Landing Threshold Bonus', b.landingThresholdBonus > 0, `+${b.landingThresholdBonus} m/s`],
    ['Recovery Bonus', b.recoveryBonus > 0, `+${(b.recoveryBonus * 100).toFixed(0)}%`],
    ['Deep Space Comms', b.deepSpaceComms, b.deepSpaceComms ? 'Enabled' : 'Disabled'],
  ];

  for (const [label, active, value] of rows) {
    const tr = document.createElement('tr');
    const tdLabel = document.createElement('td');
    tdLabel.textContent = label;
    const tdValue = document.createElement('td');
    tdValue.textContent = value;
    tdValue.className = active ? 'active' : 'inactive';
    tr.appendChild(tdLabel);
    tr.appendChild(tdValue);
    tbody.appendChild(tr);
  }

  table.appendChild(tbody);
  section.appendChild(table);
  return section;
}

/**
 * Render the list of all satellites (active and decommissioned).
 */
function _renderSatelliteList(summary) {
  const section = document.createElement('div');
  section.className = 'sat-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Satellites';
  section.appendChild(h2);

  const list = document.createElement('div');
  list.className = 'sat-list';

  if (summary.satellites.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sat-empty';
    empty.textContent = 'No satellites deployed. Deploy satellites from orbit by carrying them on a rocket and activating RELEASE.';
    list.appendChild(empty);
  } else {
    for (const sat of summary.satellites) {
      list.appendChild(_renderSatCard(sat));
    }
  }

  section.appendChild(list);
  return section;
}

/**
 * Render a single satellite card.
 */
function _renderSatCard(sat) {
  const card = document.createElement('div');
  card.className = 'sat-card' + (sat.health <= 0 ? ' decommissioned' : '');

  // Info
  const info = document.createElement('div');
  info.className = 'sat-info';

  const name = document.createElement('div');
  name.className = 'sat-name';
  const icon = SAT_TYPE_ICONS[sat.satelliteType] || SAT_TYPE_ICONS.GENERIC;
  const typeLabel = SAT_TYPE_LABELS[sat.satelliteType] || 'Generic';
  name.textContent = `${icon} ${typeLabel}`;
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'sat-meta';
  meta.textContent = `${sat.bodyId} - ${sat.bandId} | Deployed period ${sat.deployedPeriod}`;
  info.appendChild(meta);

  card.appendChild(info);

  // Health bar
  const healthBar = document.createElement('div');
  healthBar.className = 'sat-health-bar';
  const fill = document.createElement('div');
  fill.className = 'sat-health-fill';
  if (sat.health > 60) fill.classList.add('good');
  else if (sat.health > SATELLITE_DEGRADED_THRESHOLD) fill.classList.add('warn');
  else fill.classList.add('bad');
  fill.style.width = `${Math.max(0, sat.health)}%`;
  healthBar.appendChild(fill);
  card.appendChild(healthBar);

  // Health text
  const healthText = document.createElement('span');
  healthText.style.cssText = 'font-size:0.78rem;color:#8899aa;min-width:40px;text-align:right';
  healthText.textContent = sat.health > 0 ? `${sat.health}%` : 'Dead';
  card.appendChild(healthText);

  if (sat.health > 0) {
    const controls = document.createElement('div');
    controls.className = 'sat-controls';

    // Auto-maintain toggle.
    const toggle = document.createElement('label');
    toggle.className = 'sat-toggle';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = sat.autoMaintain;
    checkbox.addEventListener('change', () => {
      setAutoMaintenance(_state, sat.id, checkbox.checked);
      _render();
    });
    toggle.appendChild(checkbox);
    toggle.appendChild(document.createTextNode(
      `Auto ($${(SATELLITE_AUTO_MAINTENANCE_COST / 1000).toFixed(0)}k/period)`,
    ));
    controls.appendChild(toggle);

    // Decommission button.
    const decommBtn = document.createElement('button');
    decommBtn.className = 'sat-decommission-btn';
    decommBtn.textContent = 'Decommission';
    decommBtn.addEventListener('click', () => {
      decommissionSatellite(_state, sat.id);
      _render();
    });
    controls.appendChild(decommBtn);

    card.appendChild(controls);
  }

  return card;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _card(label, value, isConstellation = false) {
  const card = document.createElement('div');
  card.className = 'sat-overview-card';
  card.innerHTML = `
    <div class="label">${label}</div>
    <div class="value${isConstellation ? ' constellation' : ''}">${value}</div>
  `;
  return card;
}

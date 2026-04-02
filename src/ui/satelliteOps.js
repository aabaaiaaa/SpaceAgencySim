/**
 * satelliteOps.js — Satellite Network Operations Centre HTML overlay UI.
 *
 * Displays:
 *   - Network overview: total active satellites, capacity, constellation status.
 *   - Per-satellite list: name, type, band, health bar, auto-maintain toggle.
 *   - Aggregate benefits panel: current bonuses from the active network.
 *   - Decommission button for each satellite.
 *
 * Tier-gated features:
 *   - Tier 2+: Lease satellites to third parties for income, constellation mgmt.
 *   - Tier 3:  Satellite repositioning, advanced network planning.
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
  SATELLITE_LEASE_INCOME,
  SATELLITE_LEASE_INCOME_DEFAULT,
  SATELLITE_REPOSITION_COST,
  SATELLITE_REPOSITION_HEALTH_COST,
  SATELLITE_OPS_TIER_LABELS,
} from '../core/constants.js';
import {
  getNetworkSummary,
  setAutoMaintenance,
  decommissionSatellite,
  setSatelliteLease,
  getSatelliteLeaseIncome,
  repositionSatellite,
  getRepositionTargets,
} from '../core/satellites.js';
import { injectStyleOnce } from './injectStyle.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const SAT_OPS_STYLES = `
/* ── Satellite Ops overlay ───────────────────────────────────────────────── */
#sat-ops-overlay {
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

#sat-ops-header {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  padding: var(--header-padding);
  flex-shrink: 0;
}

#sat-ops-back-btn {
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
#sat-ops-back-btn:hover {
  background: var(--color-secondary-bg-hover);
}

#sat-ops-title {
  font-size: var(--font-size-h2);
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--color-text-heading);
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
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
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

.sat-overview-card .value.income {
  color: #ddcc40;
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
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: 6px;
  padding: 12px 16px;
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}

.sat-card.decommissioned {
  opacity: 0.4;
}

.sat-card.leased {
  border-color: rgba(220,200,60,0.3);
  background: rgba(220,200,60,0.04);
}

.sat-card .sat-info {
  flex: 1;
  min-width: 160px;
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

.sat-card .sat-lease-badge {
  font-size: 0.7rem;
  font-weight: 600;
  color: #ddcc40;
  background: rgba(220,200,60,0.15);
  border-radius: 3px;
  padding: 1px 6px;
  margin-left: 6px;
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
  flex-wrap: wrap;
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

.sat-lease-btn {
  background: rgba(220,200,60,0.12);
  border: 1px solid rgba(220,200,60,0.25);
  color: #ddcc40;
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.sat-lease-btn:hover {
  background: rgba(220,200,60,0.25);
}
.sat-lease-btn.active {
  background: rgba(220,200,60,0.25);
  border-color: rgba(220,200,60,0.5);
}

.sat-reposition-btn {
  background: rgba(100,180,255,0.12);
  border: 1px solid rgba(100,180,255,0.25);
  color: #80c8ff;
  font-size: 0.75rem;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
}
.sat-reposition-btn:hover {
  background: rgba(100,180,255,0.25);
}

.sat-reposition-select {
  background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.18);
  color: #e8e8e8;
  font-size: 0.75rem;
  padding: 3px 6px;
  border-radius: 4px;
}

.sat-empty {
  color: var(--color-text-disabled);
  font-style: italic;
  padding: 20px 0;
}

/* ── Constellation management (Tier 2+) ─────────────────────────────────── */
.sat-constellation-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.sat-constellation-card {
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: 6px;
  padding: 10px 14px;
}

.sat-constellation-card.active {
  border-color: rgba(96,221,128,0.3);
  background: rgba(96,221,128,0.05);
}

.sat-constellation-card .type-label {
  font-weight: 700;
  font-size: 0.9rem;
  color: #e0f0ff;
  margin-bottom: 4px;
}

.sat-constellation-card .count-label {
  font-size: 0.78rem;
  color: #8899aa;
}

.sat-constellation-card .status-label {
  font-size: 0.75rem;
  font-weight: 600;
  margin-top: 4px;
}

.sat-constellation-card .status-label.active {
  color: #60dd80;
  background: none;
  border: none;
}

.sat-constellation-card .status-label.inactive {
  color: #887755;
}

/* ── Network planning (Tier 3) ──────────────────────────────────────────── */
.sat-planning-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.sat-planning-card {
  background: var(--color-card-bg);
  border: 1px solid var(--color-card-border);
  border-radius: 6px;
  padding: 10px 14px;
}

.sat-planning-card .band-label {
  font-weight: 700;
  font-size: 0.85rem;
  color: #e0f0ff;
  margin-bottom: 2px;
}

.sat-planning-card .sat-count {
  font-size: 0.78rem;
  color: #8899aa;
}

.sat-tier-locked {
  color: #556;
  font-style: italic;
  font-size: 0.85rem;
  padding: 8px 0;
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
  injectStyleOnce('sat-ops-styles', SAT_OPS_STYLES);

  _overlay = document.createElement('div');
  _overlay.id = 'sat-ops-overlay';
  container.appendChild(_overlay);

  _render();


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
  backBtn.textContent = '← Hub';
  backBtn.addEventListener('click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroySatelliteOpsUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'sat-ops-title';
  const satTierLabel = SATELLITE_OPS_TIER_LABELS[summary.tier] || '';
  title.textContent = `Satellite Network Operations \u2014 Tier ${summary.tier}` + (satTierLabel ? ` (${satTierLabel})` : '');
  header.appendChild(title);

  _overlay.appendChild(header);

  // Content area.
  const content = document.createElement('div');
  content.id = 'sat-ops-content';

  // Overview section.
  content.appendChild(_renderOverview(summary));

  // Benefits section.
  content.appendChild(_renderBenefits(summary));

  // Constellation management (Tier 2+).
  if (summary.tier >= 2) {
    content.appendChild(_renderConstellationManagement(summary));
  }

  // Network planning (Tier 3).
  if (summary.tier >= 3) {
    content.appendChild(_renderNetworkPlanning(summary));
  }

  // Shadow overlay (Tier 3) — shows sunlight/eclipse status per orbit.
  if (summary.tier >= 3 && summary.totalActive > 0) {
    content.appendChild(_renderShadowOverlay(summary));
  }

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

  // Lease income (Tier 2+).
  if (summary.tier >= 2) {
    const leaseCard = _card(
      'Lease Income / Period',
      summary.totalLeaseIncome > 0
        ? `$${(summary.totalLeaseIncome / 1000).toFixed(0)}k`
        : 'None',
      false,
      summary.totalLeaseIncome > 0,
    );
    cards.appendChild(leaseCard);

    const leasedCard = _card('Leased Satellites', `${summary.leasedCount}`);
    cards.appendChild(leasedCard);
  }

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
 * Render constellation management panel (Tier 2+).
 * Shows each satellite type, its count, constellation status, and benefits.
 */
function _renderConstellationManagement(summary) {
  const section = document.createElement('div');
  section.className = 'sat-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Constellation Management';
  section.appendChild(h2);

  const grid = document.createElement('div');
  grid.className = 'sat-constellation-grid';

  for (const type of Object.values(SatelliteType)) {
    const info = summary.byType[type];
    if (!info) continue;

    const card = document.createElement('div');
    card.className = 'sat-constellation-card' + (info.constellation ? ' active' : '');

    const icon = SAT_TYPE_ICONS[type] || SAT_TYPE_ICONS.GENERIC;
    const label = SAT_TYPE_LABELS[type] || type;

    const typeLbl = document.createElement('div');
    typeLbl.className = 'type-label';
    typeLbl.textContent = `${icon} ${label}`;
    card.appendChild(typeLbl);

    const countLbl = document.createElement('div');
    countLbl.className = 'count-label';
    countLbl.textContent = `${info.count} satellite${info.count !== 1 ? 's' : ''} (${CONSTELLATION_THRESHOLD} needed)`;
    card.appendChild(countLbl);

    const statusLbl = document.createElement('div');
    statusLbl.className = 'status-label ' + (info.constellation ? 'active' : 'inactive');
    statusLbl.textContent = info.constellation ? 'Constellation Active (2x bonus)' : `Need ${Math.max(0, CONSTELLATION_THRESHOLD - info.count)} more`;
    card.appendChild(statusLbl);

    // Show valid bands.
    const validBands = SATELLITE_VALID_BANDS[type];
    if (validBands) {
      const bandsLbl = document.createElement('div');
      bandsLbl.style.cssText = 'font-size:0.72rem;color:#667;margin-top:4px';
      bandsLbl.textContent = `Bands: ${validBands.join(', ')}`;
      card.appendChild(bandsLbl);
    }

    grid.appendChild(card);
  }

  section.appendChild(grid);
  return section;
}

/**
 * Render network planning view (Tier 3).
 * Shows satellites grouped by altitude band and body.
 */
function _renderNetworkPlanning(summary) {
  const section = document.createElement('div');
  section.className = 'sat-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Network Planning';
  section.appendChild(h2);

  // Group active satellites by body → band.
  const activeSats = summary.satellites.filter(s => s.health > 0);
  const byBody = {};
  for (const sat of activeSats) {
    if (!byBody[sat.bodyId]) byBody[sat.bodyId] = {};
    if (!byBody[sat.bodyId][sat.bandId]) byBody[sat.bodyId][sat.bandId] = [];
    byBody[sat.bodyId][sat.bandId].push(sat);
  }

  if (Object.keys(byBody).length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sat-empty';
    empty.textContent = 'No active satellites to plan around.';
    section.appendChild(empty);
    return section;
  }

  for (const [bodyId, bands] of Object.entries(byBody)) {
    const bodyH3 = document.createElement('h3');
    bodyH3.style.cssText = 'font-size:0.95rem;color:#c0d8f0;margin:12px 0 6px;font-weight:600';
    bodyH3.textContent = bodyId;
    section.appendChild(bodyH3);

    const grid = document.createElement('div');
    grid.className = 'sat-planning-grid';

    for (const [bandId, sats] of Object.entries(bands)) {
      const card = document.createElement('div');
      card.className = 'sat-planning-card';

      const bandLbl = document.createElement('div');
      bandLbl.className = 'band-label';
      bandLbl.textContent = bandId;
      card.appendChild(bandLbl);

      const countLbl = document.createElement('div');
      countLbl.className = 'sat-count';
      const types = {};
      for (const s of sats) {
        const t = SAT_TYPE_LABELS[s.satelliteType] || 'Generic';
        types[t] = (types[t] || 0) + 1;
      }
      const typeStr = Object.entries(types).map(([t, c]) => `${c} ${t}`).join(', ');
      countLbl.textContent = `${sats.length} satellite${sats.length !== 1 ? 's' : ''}: ${typeStr}`;
      card.appendChild(countLbl);

      // Average health.
      const avgHealth = Math.round(sats.reduce((s, sat) => s + sat.health, 0) / sats.length);
      const healthLbl = document.createElement('div');
      healthLbl.style.cssText = `font-size:0.75rem;margin-top:4px;color:${avgHealth > 60 ? '#60dd80' : avgHealth > 30 ? '#ddaa40' : '#dd4040'}`;
      healthLbl.textContent = `Avg health: ${avgHealth}%`;
      card.appendChild(healthLbl);

      // Leased count in this band.
      const leasedInBand = sats.filter(s => s.leased).length;
      if (leasedInBand > 0) {
        const leaseLbl = document.createElement('div');
        leaseLbl.style.cssText = 'font-size:0.72rem;color:#ddcc40;margin-top:2px';
        leaseLbl.textContent = `${leasedInBand} leased`;
        card.appendChild(leaseLbl);
      }

      grid.appendChild(card);
    }

    section.appendChild(grid);
  }

  return section;
}

/**
 * Render the shadow overlay section showing sunlit/eclipse breakdown per orbit.
 * Tier 3 feature: visualises which fraction of each satellite's orbit is in
 * shadow vs sunlight with a simple bar chart.
 */
function _renderShadowOverlay(summary) {
  const section = document.createElement('div');
  section.className = 'sat-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Shadow Overlay';
  section.appendChild(h2);

  const desc = document.createElement('div');
  desc.style.cssText = 'font-size:0.8rem;color:#8899aa;margin-bottom:10px';
  desc.textContent = 'Shows the sunlit fraction of each satellite\'s orbit. Higher orbits spend less time in eclipse.';
  section.appendChild(desc);

  const activeSats = summary.satellites.filter(s => s.health > 0);
  if (activeSats.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'sat-empty';
    empty.textContent = 'No active satellites.';
    section.appendChild(empty);
    return section;
  }

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-direction:column;gap:8px';

  for (const sat of activeSats) {
    const pi = summary.satellitePowerInfo?.[sat.id];
    if (!pi) continue;

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px';

    const label = document.createElement('div');
    label.style.cssText = 'min-width:120px;font-size:0.82rem;color:#c0d8f0';
    const icon = SAT_TYPE_ICONS[sat.satelliteType] || SAT_TYPE_ICONS.GENERIC;
    label.textContent = `${icon} ${sat.bandId}`;
    row.appendChild(label);

    // Sunlit bar.
    const barOuter = document.createElement('div');
    barOuter.style.cssText = 'flex:1;height:16px;background:rgba(20,20,40,0.8);border-radius:3px;overflow:hidden;position:relative';

    const sunlit = document.createElement('div');
    const pct = Math.max(0, Math.min(100, pi.sunlitFraction * 100));
    sunlit.style.cssText = `width:${pct}%;height:100%;background:linear-gradient(90deg,#ffcc00,#ff9900);border-radius:3px 0 0 3px`;
    barOuter.appendChild(sunlit);

    // Shadow portion label.
    const shadowLabel = document.createElement('div');
    shadowLabel.style.cssText = 'position:absolute;right:4px;top:0;height:100%;display:flex;align-items:center;font-size:0.7rem;color:#8899aa';
    shadowLabel.textContent = `${(100 - pct).toFixed(0)}% eclipse`;
    barOuter.appendChild(shadowLabel);

    row.appendChild(barOuter);

    // Percentage label.
    const pctLabel = document.createElement('div');
    pctLabel.style.cssText = 'min-width:50px;text-align:right;font-size:0.82rem;color:#ffcc00;font-weight:600';
    pctLabel.textContent = `${pct.toFixed(0)}%`;
    row.appendChild(pctLabel);

    grid.appendChild(row);
  }

  section.appendChild(grid);
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
      const powerInfo = summary.satellitePowerInfo?.[sat.id] ?? null;
      list.appendChild(_renderSatCard(sat, summary.tier, powerInfo));
    }
  }

  section.appendChild(list);
  return section;
}

/**
 * Render a single satellite card.
 */
function _renderSatCard(sat, facilityTier, powerInfo) {
  const card = document.createElement('div');
  let cardClass = 'sat-card';
  if (sat.health <= 0) cardClass += ' decommissioned';
  else if (sat.leased) cardClass += ' leased';
  card.className = cardClass;

  // Info
  const info = document.createElement('div');
  info.className = 'sat-info';

  const name = document.createElement('div');
  name.className = 'sat-name';
  const icon = SAT_TYPE_ICONS[sat.satelliteType] || SAT_TYPE_ICONS.GENERIC;
  const typeLabel = SAT_TYPE_LABELS[sat.satelliteType] || 'Generic';
  name.textContent = `${icon} ${typeLabel}`;

  // Lease badge.
  if (sat.leased && sat.health > 0) {
    const leaseBadge = document.createElement('span');
    leaseBadge.className = 'sat-lease-badge';
    const income = getSatelliteLeaseIncome(sat);
    leaseBadge.textContent = `LEASED +$${(income / 1000).toFixed(0)}k/period`;
    name.appendChild(leaseBadge);
  }

  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'sat-meta';
  let metaText = `${sat.bodyId} - ${sat.bandId} | Deployed period ${sat.deployedPeriod}`;
  if (powerInfo) {
    const pct = (powerInfo.sunlitFraction * 100).toFixed(0);
    metaText += ` | Sunlit: ${pct}%`;
  }
  meta.textContent = metaText;
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

    // Lease toggle (Tier 2+).
    if (facilityTier >= 2) {
      const leaseBtn = document.createElement('button');
      leaseBtn.className = 'sat-lease-btn' + (sat.leased ? ' active' : '');
      leaseBtn.textContent = sat.leased ? 'End Lease' : 'Lease';
      leaseBtn.addEventListener('click', () => {
        setSatelliteLease(_state, sat.id, !sat.leased);
        _render();
      });
      controls.appendChild(leaseBtn);
    }

    // Reposition (Tier 3).
    if (facilityTier >= 3) {
      const targets = getRepositionTargets(_state, sat.id);
      if (targets.length > 0) {
        const reposBtn = document.createElement('button');
        reposBtn.className = 'sat-reposition-btn';
        reposBtn.textContent = `Reposition ($${(SATELLITE_REPOSITION_COST.SAME_BODY / 1000).toFixed(0)}k)`;
        reposBtn.addEventListener('click', () => {
          _showRepositionDropdown(card, sat, targets, reposBtn);
        });
        controls.appendChild(reposBtn);
      }
    }

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

/**
 * Show a dropdown to select repositioning target band.
 */
function _showRepositionDropdown(card, sat, targets, triggerBtn) {
  // Remove any existing dropdown.
  const existing = card.querySelector('.sat-reposition-select');
  if (existing) {
    existing.remove();
    return;
  }

  const select = document.createElement('select');
  select.className = 'sat-reposition-select';

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Select band...';
  select.appendChild(defaultOpt);

  for (const target of targets) {
    const opt = document.createElement('option');
    opt.value = target.id;
    opt.textContent = `${target.id} (${target.name})`;
    select.appendChild(opt);
  }

  select.addEventListener('change', () => {
    if (!select.value) return;
    const result = repositionSatellite(_state, sat.id, select.value);
    if (!result.success) {
      alert(result.reason);
    }
    _render();
  });

  // Insert after the trigger button.
  triggerBtn.parentElement.insertBefore(select, triggerBtn.nextSibling);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _card(label, value, isConstellation = false, isIncome = false) {
  const card = document.createElement('div');
  card.className = 'sat-overview-card';
  let valueClass = 'value';
  if (isConstellation) valueClass += ' constellation';
  if (isIncome) valueClass += ' income';
  card.innerHTML = `
    <div class="label">${label}</div>
    <div class="${valueClass}">${value}</div>
  `;
  return card;
}

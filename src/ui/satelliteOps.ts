/**
 * satelliteOps.ts — Satellite Network Operations Centre HTML overlay UI.
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

import type { GameState, SatelliteRecord } from '../core/gameState.ts';
import {
  SatelliteType,
  SATELLITE_VALID_BANDS,
  CONSTELLATION_THRESHOLD,
  SATELLITE_AUTO_MAINTENANCE_COST,
  SATELLITE_DEGRADED_THRESHOLD,
  SATELLITE_REPOSITION_COST,
  SATELLITE_OPS_TIER_LABELS,
} from '../core/constants.ts';
import {
  getNetworkSummary,
  setAutoMaintenance,
  decommissionSatellite,
  setSatelliteLease,
  getSatelliteLeaseIncome,
  repositionSatellite,
  getRepositionTargets,
} from '../core/satellites.ts';
import { createListenerTracker, type ListenerTracker } from './listenerTracker.ts';
import './satelliteOps.css';

// ---------------------------------------------------------------------------
// Local type for the network summary returned by getNetworkSummary.
// The interface is not exported from satellites.ts so we replicate it here.
// ---------------------------------------------------------------------------

interface NetworkBenefits {
  transmitYieldBonus: number;
  weatherSkipDiscount: number;
  forecastAccuracy: number;
  sciencePerPeriod: number;
  landingThresholdBonus: number;
  recoveryBonus: number;
  deepSpaceComms: boolean;
}

interface NetworkSummary {
  totalActive: number;
  capacity: number;
  tier: number;
  leasedCount: number;
  totalLeaseIncome: number;
  byType: Record<string, { count: number; constellation: boolean }>;
  benefits: NetworkBenefits;
  satellites: SatelliteRecord[];
  satellitePowerInfo: Record<string, { sunlitFraction: number; avgGeneration: number; altitude: number }>;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _overlay: HTMLDivElement | null = null;
let _state: GameState | null = null;
let _onBack: (() => void) | null = null;
let _listeners: ListenerTracker | null = null;

// ---------------------------------------------------------------------------
// Satellite type display helpers
// ---------------------------------------------------------------------------

const SAT_TYPE_LABELS: Record<string, string> = {
  [SatelliteType.COMMUNICATION]: 'Communication',
  [SatelliteType.WEATHER]:       'Weather',
  [SatelliteType.SCIENCE]:       'Science',
  [SatelliteType.GPS]:           'GPS/Navigation',
  [SatelliteType.RELAY]:         'Relay',
  GENERIC:                       'Generic',
};

const SAT_TYPE_ICONS: Record<string, string> = {
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
 */
export function initSatelliteOpsUI(
  container: HTMLElement,
  state: GameState,
  { onBack }: { onBack: () => void },
): void {
  _state = state;
  _onBack = onBack;
  _listeners = createListenerTracker();

  _overlay = document.createElement('div');
  _overlay.id = 'sat-ops-overlay';
  container.appendChild(_overlay);

  _render();
}

/**
 * Remove the Satellite Operations Centre overlay.
 */
export function destroySatelliteOpsUI(): void {
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

  const summary = getNetworkSummary(_state) as NetworkSummary;

  // Clear previously-registered render-scoped listeners before rebuilding DOM.
  if (_listeners) _listeners.removeAll();
  _overlay.innerHTML = '';

  // Header.
  const header = document.createElement('div');
  header.id = 'sat-ops-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'sat-ops-back-btn';
  backBtn.textContent = '\u2190 Hub';
  _listeners?.add(backBtn, 'click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroySatelliteOpsUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'sat-ops-title';
  const satTierLabel = (SATELLITE_OPS_TIER_LABELS as Record<number, string>)[summary.tier] || '';
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
function _renderOverview(summary: NetworkSummary): HTMLDivElement {
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
function _renderBenefits(summary: NetworkSummary): HTMLDivElement {
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

  const rows: [string, boolean, string][] = [
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
function _renderConstellationManagement(summary: NetworkSummary): HTMLDivElement {
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
    const validBands = (SATELLITE_VALID_BANDS as Record<string, string[]>)[type];
    if (validBands) {
      const bandsLbl = document.createElement('div');
      bandsLbl.className = 'sat-valid-bands';
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
function _renderNetworkPlanning(summary: NetworkSummary): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'sat-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Network Planning';
  section.appendChild(h2);

  // Group active satellites by body -> band.
  const activeSats = summary.satellites.filter(s => s.health > 0);
  const byBody: Record<string, Record<string, SatelliteRecord[]>> = {};
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
    bodyH3.className = 'sat-body-heading';
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
      const types: Record<string, number> = {};
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
      healthLbl.className = 'sat-health-label ' + (avgHealth > 60 ? 'good' : avgHealth > 30 ? 'warn' : 'bad');
      healthLbl.textContent = `Avg health: ${avgHealth}%`;
      card.appendChild(healthLbl);

      // Leased count in this band.
      const leasedInBand = sats.filter(s => s.leased).length;
      if (leasedInBand > 0) {
        const leaseLbl = document.createElement('div');
        leaseLbl.className = 'sat-leased-label';
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
function _renderShadowOverlay(summary: NetworkSummary): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'sat-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Shadow Overlay';
  section.appendChild(h2);

  const desc = document.createElement('div');
  desc.className = 'sat-shadow-desc';
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
  grid.className = 'sat-shadow-grid';

  for (const sat of activeSats) {
    const pi = summary.satellitePowerInfo?.[sat.id];
    if (!pi) continue;

    const row = document.createElement('div');
    row.className = 'sat-shadow-row';

    const label = document.createElement('div');
    label.className = 'sat-shadow-label';
    const icon = SAT_TYPE_ICONS[sat.satelliteType] || SAT_TYPE_ICONS.GENERIC;
    label.textContent = `${icon} ${sat.bandId}`;
    row.appendChild(label);

    // Sunlit bar.
    const barOuter = document.createElement('div');
    barOuter.className = 'sat-power-bar-outer';

    const sunlit = document.createElement('div');
    const pct = Math.max(0, Math.min(100, pi.sunlitFraction * 100));
    sunlit.className = 'sat-sunlit-bar';
    sunlit.style.width = `${pct}%`;
    barOuter.appendChild(sunlit);

    // Shadow portion label.
    const shadowLabel = document.createElement('div');
    shadowLabel.className = 'sat-eclipse-label';
    shadowLabel.textContent = `${(100 - pct).toFixed(0)}% eclipse`;
    barOuter.appendChild(shadowLabel);

    row.appendChild(barOuter);

    // Percentage label.
    const pctLabel = document.createElement('div');
    pctLabel.className = 'sat-sunlit-pct';
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
function _renderSatelliteList(summary: NetworkSummary): HTMLDivElement {
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
function _renderSatCard(
  sat: SatelliteRecord,
  facilityTier: number,
  powerInfo: { sunlitFraction: number; avgGeneration: number; altitude: number } | null,
): HTMLDivElement {
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
  healthText.className = 'sat-health-text';
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
    _listeners?.add(checkbox, 'change', () => {
      setAutoMaintenance(_state!, sat.id, checkbox.checked);
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
      _listeners?.add(leaseBtn, 'click', () => {
        setSatelliteLease(_state!, sat.id, !sat.leased);
        _render();
      });
      controls.appendChild(leaseBtn);
    }

    // Reposition (Tier 3).
    if (facilityTier >= 3) {
      const targets = getRepositionTargets(_state!, sat.id);
      if (targets.length > 0) {
        const reposBtn = document.createElement('button');
        reposBtn.className = 'sat-reposition-btn';
        reposBtn.textContent = `Reposition ($${((SATELLITE_REPOSITION_COST as Record<string, number>).SAME_BODY / 1000).toFixed(0)}k)`;
        _listeners?.add(reposBtn, 'click', () => {
          _showRepositionDropdown(card, sat, targets, reposBtn);
        });
        controls.appendChild(reposBtn);
      }
    }

    // Decommission button.
    const decommBtn = document.createElement('button');
    decommBtn.className = 'sat-decommission-btn';
    decommBtn.textContent = 'Decommission';
    _listeners?.add(decommBtn, 'click', () => {
      decommissionSatellite(_state!, sat.id);
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
function _showRepositionDropdown(
  card: HTMLDivElement,
  sat: SatelliteRecord,
  targets: Array<{ id: string; name: string }>,
  triggerBtn: HTMLButtonElement,
): void {
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

  _listeners?.add(select, 'change', () => {
    if (!select.value) return;
    const result = repositionSatellite(_state!, sat.id, select.value);
    if (!result.success) {
      alert(result.reason);
    }
    _render();
  });

  // Insert after the trigger button.
  triggerBtn.parentElement!.insertBefore(select, triggerBtn.nextSibling);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _card(label: string, value: string, isConstellation: boolean = false, isIncome: boolean = false): HTMLDivElement {
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

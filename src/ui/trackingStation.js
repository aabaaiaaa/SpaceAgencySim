/**
 * trackingStation.js — Tracking Station HTML overlay UI.
 *
 * Displays:
 *   - Current tier and feature list.
 *   - Orbital objects overview: satellites, debris, stations.
 *   - Tier 2+: Weather window predictions, debris tracking list.
 *   - Tier 3:  Transfer route planning summary, deep space comm status.
 *
 * Requires the Tracking Station facility to be built.
 *
 * @module trackingStation
 */

import {
  FacilityId,
  TRACKING_STATION_TIER_FEATURES,
  OrbitalObjectType,
} from '../core/constants.js';
import { getFacilityTier } from '../core/construction.js';
import { getWeatherForecast } from '../core/weather.js';
import { getTransferTargets } from '../core/manoeuvre.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const TS_STYLES = `
/* -- Tracking Station overlay -------------------------------------------- */
#ts-overlay {
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

#ts-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 20px 0;
  flex-shrink: 0;
}

#ts-back-btn {
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
#ts-back-btn:hover {
  background: rgba(255,255,255,0.16);
}

#ts-title {
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #f0f0f0;
  margin: 0;
}

#ts-tier-badge {
  font-size: 0.75rem;
  font-weight: 600;
  color: #80c8ff;
  background: rgba(128,200,255,0.12);
  border: 1px solid rgba(128,200,255,0.2);
  padding: 2px 10px;
  border-radius: 12px;
  letter-spacing: 0.04em;
}

/* -- Content ------------------------------------------------------------- */
#ts-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px 40px;
}

.ts-section {
  margin-bottom: 24px;
}

.ts-section h2 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #80c8ff;
  margin: 0 0 10px;
  letter-spacing: 0.02em;
}

/* -- Overview cards ------------------------------------------------------ */
.ts-overview {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 20px;
}

.ts-overview-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 12px 16px;
  min-width: 140px;
  flex: 1;
}

.ts-overview-card .label {
  font-size: 0.75rem;
  color: #8899aa;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.ts-overview-card .value {
  font-size: 1.3rem;
  font-weight: 700;
  color: #e0f0ff;
}

.ts-overview-card .value.debris-count {
  color: #ff9060;
}

/* -- Feature list -------------------------------------------------------- */
.ts-features {
  list-style: none;
  padding: 0;
  margin: 0;
}

.ts-features li {
  padding: 4px 0;
  font-size: 0.88rem;
  color: #c0d0e0;
}

.ts-features li::before {
  content: '\\2713 ';
  color: #60dd80;
  font-weight: 700;
  margin-right: 6px;
}

/* -- Object list --------------------------------------------------------- */
.ts-obj-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ts-obj-row {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 5px;
  padding: 8px 14px;
  font-size: 0.85rem;
}

.ts-obj-row .obj-name {
  font-weight: 600;
  color: #e0f0ff;
  flex: 1;
  min-width: 120px;
}

.ts-obj-row .obj-type {
  color: #8899aa;
  font-size: 0.78rem;
  min-width: 80px;
}

.ts-obj-row .obj-body {
  color: #8899aa;
  font-size: 0.78rem;
}

.ts-obj-row.debris .obj-name {
  color: #ff9060;
}

/* -- Weather forecast ---------------------------------------------------- */
.ts-forecast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.ts-forecast-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 10px 14px;
}

.ts-forecast-card .day-label {
  font-weight: 700;
  font-size: 0.85rem;
  color: #e0f0ff;
  margin-bottom: 4px;
}

.ts-forecast-card .day-desc {
  font-size: 0.82rem;
  color: #b0c0d0;
}

.ts-forecast-card .day-desc.extreme {
  color: #ff6060;
  font-weight: 600;
}

/* -- Transfer routes ----------------------------------------------------- */
.ts-transfer-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 10px;
}

.ts-transfer-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  padding: 10px 14px;
}

.ts-transfer-card .body-name {
  font-weight: 700;
  font-size: 0.9rem;
  color: #e0f0ff;
  margin-bottom: 2px;
}

.ts-transfer-card .route-info {
  font-size: 0.82rem;
  color: #b0c0d0;
}

.ts-tier-locked {
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
// Object type display helpers
// ---------------------------------------------------------------------------

const OBJ_TYPE_LABELS = {
  [OrbitalObjectType.CRAFT]:     'Craft',
  [OrbitalObjectType.SATELLITE]: 'Satellite',
  [OrbitalObjectType.DEBRIS]:    'Debris',
  [OrbitalObjectType.STATION]:   'Station',
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Tracking Station overlay.
 *
 * @param {HTMLElement} container  The #ui-overlay div.
 * @param {import('../core/gameState.js').GameState} state
 * @param {{ onBack: () => void }} opts
 */
export function initTrackingStationUI(container, state, { onBack }) {
  _state = state;
  _onBack = onBack;

  // Inject styles once.
  if (!document.getElementById('ts-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'ts-styles';
    styleEl.textContent = TS_STYLES;
    document.head.appendChild(styleEl);
  }

  _overlay = document.createElement('div');
  _overlay.id = 'ts-overlay';
  container.appendChild(_overlay);

  _render();

  console.log('[Tracking Station UI] Initialized');
}

/**
 * Remove the Tracking Station overlay.
 */
export function destroyTrackingStationUI() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;
  _onBack = null;
  console.log('[Tracking Station UI] Destroyed');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function _render() {
  if (!_overlay || !_state) return;

  const tier = getFacilityTier(_state, FacilityId.TRACKING_STATION);
  const tierInfo = TRACKING_STATION_TIER_FEATURES[tier] || TRACKING_STATION_TIER_FEATURES[1];

  _overlay.innerHTML = '';

  // Header.
  const header = document.createElement('div');
  header.id = 'ts-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'ts-back-btn';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', () => {
    destroyTrackingStationUI();
    if (_onBack) _onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'ts-title';
  title.textContent = 'Tracking Station';
  header.appendChild(title);

  // Tier badge.
  const badge = document.createElement('span');
  badge.id = 'ts-tier-badge';
  badge.textContent = `Tier ${tier} — ${tierInfo.label}`;
  header.appendChild(badge);

  _overlay.appendChild(header);

  // Content area.
  const content = document.createElement('div');
  content.id = 'ts-content';

  // Current tier features.
  content.appendChild(_renderFeatures(tierInfo));

  // Orbital objects overview.
  content.appendChild(_renderObjectOverview(tier));

  // Tracked objects list.
  content.appendChild(_renderObjectList(tier));

  // Weather forecast (Tier 2+).
  if (tier >= 2) {
    content.appendChild(_renderWeatherForecast());
  } else {
    const locked = document.createElement('div');
    locked.className = 'ts-section';
    const h2 = document.createElement('h2');
    h2.textContent = 'Weather Predictions';
    locked.appendChild(h2);
    const msg = document.createElement('div');
    msg.className = 'ts-tier-locked';
    msg.textContent = 'Upgrade to Tier 2 to unlock weather window predictions.';
    locked.appendChild(msg);
    content.appendChild(locked);
  }

  // Transfer route planning (Tier 3).
  if (tier >= 3) {
    content.appendChild(_renderTransferRoutes());
  } else {
    const locked = document.createElement('div');
    locked.className = 'ts-section';
    const h2 = document.createElement('h2');
    h2.textContent = 'Transfer Route Planning';
    locked.appendChild(h2);
    const msg = document.createElement('div');
    msg.className = 'ts-tier-locked';
    msg.textContent = tier < 2
      ? 'Upgrade to Tier 3 to unlock transfer route planning.'
      : 'Upgrade to Tier 3 to unlock deep space communication and transfer route planning.';
    locked.appendChild(msg);
    content.appendChild(locked);
  }

  _overlay.appendChild(content);
}

/**
 * Render current-tier feature list.
 */
function _renderFeatures(tierInfo) {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Capabilities';
  section.appendChild(h2);

  const ul = document.createElement('ul');
  ul.className = 'ts-features';
  for (const feat of tierInfo.features) {
    const li = document.createElement('li');
    li.textContent = feat;
    ul.appendChild(li);
  }
  section.appendChild(ul);

  return section;
}

/**
 * Render overview cards (counts of objects by type).
 */
function _renderObjectOverview(tier) {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Orbital Overview';
  section.appendChild(h2);

  const objects = _state.orbitalObjects || [];

  const satellites = objects.filter(o => o.type === OrbitalObjectType.SATELLITE).length;
  const stations = objects.filter(o => o.type === OrbitalObjectType.STATION).length;
  const debris = objects.filter(o => o.type === OrbitalObjectType.DEBRIS).length;
  const total = objects.length;

  const cards = document.createElement('div');
  cards.className = 'ts-overview';

  cards.appendChild(_makeCard('Total Objects', String(total)));
  cards.appendChild(_makeCard('Satellites', String(satellites)));
  cards.appendChild(_makeCard('Stations', String(stations)));

  if (tier >= 2) {
    const debrisCard = _makeCard('Debris', String(debris));
    debrisCard.querySelector('.value').classList.add('debris-count');
    cards.appendChild(debrisCard);
  } else {
    cards.appendChild(_makeCard('Debris', '???'));
  }

  section.appendChild(cards);

  return section;
}

/**
 * Render the tracked objects list.
 */
function _renderObjectList(tier) {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Tracked Objects';
  section.appendChild(h2);

  const objects = _state.orbitalObjects || [];

  if (objects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ts-tier-locked';
    empty.textContent = 'No objects currently in orbit.';
    section.appendChild(empty);
    return section;
  }

  const list = document.createElement('div');
  list.className = 'ts-obj-list';

  for (const obj of objects) {
    // Hide debris if tier < 2.
    if (obj.type === OrbitalObjectType.DEBRIS && tier < 2) continue;

    const row = document.createElement('div');
    row.className = 'ts-obj-row';
    if (obj.type === OrbitalObjectType.DEBRIS) row.classList.add('debris');

    const name = document.createElement('span');
    name.className = 'obj-name';
    name.textContent = obj.name;
    row.appendChild(name);

    const type = document.createElement('span');
    type.className = 'obj-type';
    type.textContent = OBJ_TYPE_LABELS[obj.type] || obj.type;
    row.appendChild(type);

    const body = document.createElement('span');
    body.className = 'obj-body';
    body.textContent = obj.bodyId;
    row.appendChild(body);

    list.appendChild(row);
  }

  section.appendChild(list);

  return section;
}

/**
 * Render weather forecast section (Tier 2+).
 */
function _renderWeatherForecast() {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Weather Window Predictions';
  section.appendChild(h2);

  const forecast = getWeatherForecast(_state, 'EARTH', 5);
  if (forecast.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'ts-tier-locked';
    msg.textContent = 'No forecast data available. Deploy weather satellites for predictions.';
    section.appendChild(msg);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'ts-forecast-grid';

  forecast.forEach((fc, i) => {
    const card = document.createElement('div');
    card.className = 'ts-forecast-card';

    const dayLabel = document.createElement('div');
    dayLabel.className = 'day-label';
    dayLabel.textContent = `Day +${i + 1}`;
    card.appendChild(dayLabel);

    const dayDesc = document.createElement('div');
    dayDesc.className = 'day-desc';
    if (fc.extreme) dayDesc.classList.add('extreme');
    dayDesc.textContent = `${fc.description} — Wind: ${fc.windSpeed.toFixed(0)} m/s`;
    card.appendChild(dayDesc);

    grid.appendChild(card);
  });

  section.appendChild(grid);

  return section;
}

/**
 * Render transfer route planning section (Tier 3).
 */
function _renderTransferRoutes() {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Transfer Route Planning';
  section.appendChild(h2);

  // Show available transfer destinations from Earth orbit.
  let targets;
  try {
    targets = getTransferTargets('EARTH', 200_000);
  } catch {
    targets = [];
  }

  if (!targets || targets.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'ts-tier-locked';
    msg.textContent = 'No transfer routes available from current position.';
    section.appendChild(msg);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'ts-transfer-grid';

  for (const t of targets) {
    const card = document.createElement('div');
    card.className = 'ts-transfer-card';

    const name = document.createElement('div');
    name.className = 'body-name';
    name.textContent = t.name || t.bodyId;
    card.appendChild(name);

    const info = document.createElement('div');
    info.className = 'route-info';
    const dvStr = t.departureDV ? `${(t.departureDV / 1000).toFixed(1)} km/s` : 'N/A';
    info.textContent = `Departure dv: ${dvStr}`;
    card.appendChild(info);

    grid.appendChild(card);
  }

  section.appendChild(grid);

  return section;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _makeCard(label, value) {
  const card = document.createElement('div');
  card.className = 'ts-overview-card';

  const labelEl = document.createElement('div');
  labelEl.className = 'label';
  labelEl.textContent = label;
  card.appendChild(labelEl);

  const valueEl = document.createElement('div');
  valueEl.className = 'value';
  valueEl.textContent = value;
  card.appendChild(valueEl);

  return card;
}

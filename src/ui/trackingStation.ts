/**
 * trackingStation.ts — Tracking Station HTML overlay UI.
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

import type { GameState } from '../core/gameState.ts';
import type { TierFeatureSet } from '../core/constants.ts';
import {
  FacilityId,
  TRACKING_STATION_TIER_FEATURES,
  OrbitalObjectType,
  DEFAULT_LIFE_SUPPORT_PERIODS,
  LIFE_SUPPORT_WARNING_THRESHOLD,
} from '../core/constants.ts';
import { getFacilityTier } from '../core/construction.ts';
import { getWeatherForecast } from '../core/weather.ts';
import { getTransferTargets } from '../core/manoeuvre.ts';
import './trackingStation.css';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _overlay: HTMLDivElement | null = null;
let _state: GameState | null = null;
let _onBack: (() => void) | null = null;

// ---------------------------------------------------------------------------
// Object type display helpers
// ---------------------------------------------------------------------------

const OBJ_TYPE_LABELS: Record<string, string> = {
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
 */
export function initTrackingStationUI(
  container: HTMLElement,
  state: GameState,
  { onBack }: { onBack: () => void },
): void {
  _state = state;
  _onBack = onBack;

  _overlay = document.createElement('div');
  _overlay.id = 'ts-overlay';
  container.appendChild(_overlay);

  _render();
}

/**
 * Remove the Tracking Station overlay.
 */
export function destroyTrackingStationUI(): void {
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

  const tier = getFacilityTier(_state, FacilityId.TRACKING_STATION);
  const tierInfo = TRACKING_STATION_TIER_FEATURES[tier] || TRACKING_STATION_TIER_FEATURES[1];

  _overlay.innerHTML = '';

  // Header.
  const header = document.createElement('div');
  header.id = 'ts-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'ts-back-btn';
  backBtn.textContent = '← Hub';
  backBtn.addEventListener('click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroyTrackingStationUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.id = 'ts-title';
  title.textContent = `Tracking Station \u2014 Tier ${tier} (${tierInfo.label})`;
  header.appendChild(title);

  _overlay.appendChild(header);

  // Content area.
  const content = document.createElement('div');
  content.id = 'ts-content';

  // Current tier features.
  content.appendChild(_renderFeatures(tierInfo));

  // Orbital objects overview.
  content.appendChild(_renderObjectOverview(tier));

  // Crewed vessels in the field (life support tracking).
  content.appendChild(_renderFieldCraft());

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
function _renderFeatures(tierInfo: TierFeatureSet): HTMLDivElement {
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
function _renderObjectOverview(tier: number): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Orbital Overview';
  section.appendChild(h2);

  const objects = _state!.orbitalObjects || [];

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
    debrisCard.querySelector('.value')!.classList.add('debris-count');
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
function _renderObjectList(tier: number): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Tracked Objects';
  section.appendChild(h2);

  const objects = _state!.orbitalObjects || [];

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
function _renderWeatherForecast(): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Weather Window Predictions';
  section.appendChild(h2);

  const forecast = getWeatherForecast(_state!, 'EARTH', 5);
  if (forecast.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'ts-tier-locked';
    msg.textContent = 'No forecast data available. Deploy weather satellites for predictions.';
    section.appendChild(msg);
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'ts-forecast-grid';

  forecast.forEach((fc: { extreme?: boolean; description: string; windSpeed: number }, i: number) => {
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
function _renderTransferRoutes(): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Transfer Route Planning';
  section.appendChild(h2);

  // Show available transfer destinations from Earth orbit.
  let targets: Array<{ bodyId: string; name: string; departureDV: number }>;
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

/**
 * Render crewed vessels in the field with life support status.
 */
function _renderFieldCraft(): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'ts-section';

  const h2 = document.createElement('h2');
  h2.textContent = 'Crewed Vessels';
  section.appendChild(h2);

  const fieldCraft = _state!.fieldCraft || [];
  if (fieldCraft.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ts-tier-locked';
    empty.textContent = 'No crewed vessels currently deployed in the field.';
    section.appendChild(empty);
    return section;
  }

  for (const craft of fieldCraft) {
    const card = document.createElement('div');
    card.className = 'ts-field-craft-card';

    // Apply warning/critical class based on supply level.
    if (!craft.hasExtendedLifeSupport) {
      if (craft.suppliesRemaining <= 0) {
        card.classList.add('critical');
      } else if (craft.suppliesRemaining <= LIFE_SUPPORT_WARNING_THRESHOLD) {
        card.classList.add('warning');
      }
    }

    // Header: name + status.
    const header = document.createElement('div');
    header.className = 'ts-field-craft-header';

    const nameEl = document.createElement('span');
    nameEl.className = 'ts-field-craft-name';
    nameEl.textContent = craft.name;
    header.appendChild(nameEl);

    const statusEl = document.createElement('span');
    statusEl.className = 'ts-field-craft-status';
    const statusLabel = craft.status === 'IN_ORBIT' ? 'In orbit' : 'Landed';
    statusEl.textContent = `${statusLabel} — ${craft.bodyId}`;
    if (craft.orbitBandId) {
      statusEl.textContent += ` (${craft.orbitBandId})`;
    }
    header.appendChild(statusEl);

    card.appendChild(header);

    // Details: crew count + supply status.
    const detail = document.createElement('div');
    detail.className = 'ts-field-craft-detail';

    // Crew count.
    const crewCount = craft.crewIds ? craft.crewIds.length : 0;
    const crewEl = document.createElement('span');
    crewEl.textContent = `Crew: ${crewCount}`;

    // Show crew names if available.
    if (crewCount > 0 && _state!.crew) {
      const names = craft.crewIds
        .map((id: string) => {
          const a = _state!.crew.find((c) => c.id === id);
          return a ? a.name : '???';
        })
        .join(', ');
      crewEl.textContent = `Crew: ${names}`;
    }
    detail.appendChild(crewEl);

    // Supply status.
    const supplyEl = document.createElement('span');
    if (craft.hasExtendedLifeSupport) {
      supplyEl.className = 'ts-supply-infinite';
      supplyEl.textContent = 'Supplies: Unlimited';
    } else {
      supplyEl.textContent = 'Supplies: ';
      const bar = document.createElement('span');
      bar.className = 'ts-supply-bar';
      for (let i = 0; i < DEFAULT_LIFE_SUPPORT_PERIODS; i++) {
        const pip = document.createElement('span');
        pip.className = 'ts-supply-pip';
        if (i >= craft.suppliesRemaining) {
          pip.classList.add('empty');
        } else if (craft.suppliesRemaining <= LIFE_SUPPORT_WARNING_THRESHOLD) {
          pip.classList.add('warning');
        }
        bar.appendChild(pip);
      }
      supplyEl.appendChild(bar);

      const countLabel = document.createElement('span');
      countLabel.style.marginLeft = '6px';
      countLabel.style.fontSize = '0.82rem';
      if (craft.suppliesRemaining <= LIFE_SUPPORT_WARNING_THRESHOLD) {
        countLabel.style.color = '#ffaa30';
        countLabel.style.fontWeight = '600';
      }
      countLabel.textContent = `${craft.suppliesRemaining}/${DEFAULT_LIFE_SUPPORT_PERIODS}`;
      supplyEl.appendChild(countLabel);
    }
    detail.appendChild(supplyEl);

    card.appendChild(detail);
    section.appendChild(card);
  }

  return section;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _makeCard(label: string, value: string): HTMLDivElement {
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

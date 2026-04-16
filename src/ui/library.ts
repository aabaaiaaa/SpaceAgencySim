/**
 * library.ts — Library facility HTML overlay UI.
 *
 * Displays three tabbed sections:
 *   1. Statistics & Records — total flights, records, crew careers, finances,
 *      exploration progress.
 *   2. Celestial Body Knowledge — properties of discovered bodies for
 *      mission planning.
 *   3. Frequently Flown Rockets — top 5 most-used rocket configurations
 *      with flight statistics.
 *
 * Free building with no upgrades. Reads game state but never mutates it.
 *
 * @module ui/library
 */

import {
  getAgencyStats,
  getRecords,
  getCrewCareers,
  getFinancialSummary,
  getExplorationProgress,
  getCelestialBodyKnowledge,
  getFrequentRockets,
} from '../core/library.ts';
import { AstronautStatus } from '../core/constants.ts';
import { escapeHtml } from './escapeHtml.ts';
import { createListenerTracker, type ListenerTracker } from './listenerTracker.ts';
import './library.css';
import type { GameState } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Tab ID type
// ---------------------------------------------------------------------------

type LibraryTab = 'stats' | 'bodies' | 'rockets';

interface TabDef {
  id: LibraryTab;
  label: string;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _overlay: HTMLDivElement | null = null;
let _state: GameState | null = null;
let _onBack: (() => void) | null = null;
let _activeTab: LibraryTab = 'stats';
let _tracker: ListenerTracker | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the Library overlay.
 *
 * @param container  The #ui-overlay div.
 * @param state
 * @param opts
 */
export function initLibraryUI(
  container: HTMLElement,
  state: GameState,
  { onBack }: { onBack: () => void },
): void {
  _state = state;
  _onBack = onBack;
  _activeTab = 'stats';
  _tracker = createListenerTracker();

  _overlay = document.createElement('div');
  _overlay.id = 'lib-overlay';
  container.appendChild(_overlay);

  _render();
}

/**
 * Remove the Library overlay.
 */
export function destroyLibraryUI(): void {
  if (_tracker) {
    _tracker.removeAll();
    _tracker = null;
  }
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;
  _onBack = null;
}

// ---------------------------------------------------------------------------
// Rendering — Main
// ---------------------------------------------------------------------------

function _render(): void {
  if (!_overlay || !_state) return;
  if (_tracker) _tracker.removeAll();
  _overlay.innerHTML = '';

  // Header.
  const header: HTMLDivElement = document.createElement('div');
  header.id = 'lib-header';

  const backBtn: HTMLButtonElement = document.createElement('button');
  backBtn.id = 'lib-back-btn';
  backBtn.textContent = '\u2190 Hub';
  _tracker!.add(backBtn, 'click', () => {
    const onBack = _onBack; // capture before destroy nulls it
    destroyLibraryUI();
    if (onBack) onBack();
  });
  header.appendChild(backBtn);

  const title: HTMLHeadingElement = document.createElement('h1');
  title.id = 'lib-title';
  title.textContent = 'Agency Library';
  header.appendChild(title);

  _overlay.appendChild(header);

  // Tabs.
  const tabs: HTMLDivElement = document.createElement('div');
  tabs.id = 'lib-tabs';

  const tabDefs: TabDef[] = [
    { id: 'stats',   label: 'Statistics & Records' },
    { id: 'bodies',  label: 'Celestial Bodies' },
    { id: 'rockets', label: 'Frequent Rockets' },
  ];

  for (const def of tabDefs) {
    const tab: HTMLButtonElement = document.createElement('button');
    tab.className = `lib-tab${def.id === _activeTab ? ' active' : ''}`;
    tab.textContent = def.label;
    _tracker!.add(tab, 'click', () => {
      _activeTab = def.id;
      _render();
    });
    tabs.appendChild(tab);
  }

  _overlay.appendChild(tabs);

  // Content.
  const content: HTMLDivElement = document.createElement('div');
  content.id = 'lib-content';

  switch (_activeTab) {
    case 'stats':
      _renderStatsTab(content);
      break;
    case 'bodies':
      _renderBodiesTab(content);
      break;
    case 'rockets':
      _renderRocketsTab(content);
      break;
  }

  _overlay.appendChild(content);
}

// ---------------------------------------------------------------------------
// Tab 1 — Statistics & Records
// ---------------------------------------------------------------------------

function _renderStatsTab(content: HTMLDivElement): void {
  const stats = getAgencyStats(_state!);
  const records = getRecords(_state!);
  const financial = getFinancialSummary(_state!);
  const exploration = getExplorationProgress(_state!);
  const crewCareers = getCrewCareers(_state!);

  // -- Overview stats --
  {
    const section = _makeSection('Agency Overview');
    const grid: HTMLDivElement = document.createElement('div');
    grid.className = 'lib-stat-grid';

    grid.appendChild(_makeStatCard('Total Flights', stats.totalFlights.toString(),
      `${stats.successfulFlights} successful, ${stats.failedFlights} failed`));
    grid.appendChild(_makeStatCard('Current Period', stats.currentPeriod.toString()));
    grid.appendChild(_makeStatCard('Science Points', _fmtNum(stats.sciencePoints)));
    grid.appendChild(_makeStatCard('Achievements', `${stats.achievementsEarned} / ${stats.totalAchievements}`));
    grid.appendChild(_makeStatCard('Satellites', stats.satellitesDeployed.toString()));
    grid.appendChild(_makeStatCard('Active Crew', stats.activeCrew.toString(),
      stats.crewLost > 0 ? `${stats.crewLost} lost` : undefined));

    section.appendChild(grid);
    content.appendChild(section);
  }

  // -- Records --
  {
    const section = _makeSection('Records');
    const grid: HTMLDivElement = document.createElement('div');
    grid.className = 'lib-record-grid';

    grid.appendChild(_makeRecordCard('Peak Altitude',
      records.maxAltitude.value > 0 ? _fmtAlt(records.maxAltitude.value) : 'None',
      records.maxAltitude.rocketName || undefined));

    grid.appendChild(_makeRecordCard('Peak Speed',
      records.maxSpeed.value > 0 ? _fmtSpeed(records.maxSpeed.value) : 'None',
      records.maxSpeed.rocketName || undefined));

    grid.appendChild(_makeRecordCard('Heaviest Rocket',
      records.heaviestRocket.mass > 0 ? _fmtMass(records.heaviestRocket.mass) : 'None',
      records.heaviestRocket.name || undefined));

    grid.appendChild(_makeRecordCard('Longest Flight',
      records.longestFlight.duration > 0 ? _fmtTime(records.longestFlight.duration) : 'None',
      records.longestFlight.rocketName || undefined));

    grid.appendChild(_makeRecordCard('Best Streak',
      records.mostFlightsInRow > 0 ? `${records.mostFlightsInRow} in a row` : 'None'));

    grid.appendChild(_makeRecordCard('Total Flight Time',
      _fmtTime(stats.totalFlightTime)));

    section.appendChild(grid);
    content.appendChild(section);
  }

  // -- Exploration per body --
  {
    const section = _makeSection('Exploration Progress');

    // Progress bar.
    const grid: HTMLDivElement = document.createElement('div');
    grid.className = 'lib-stat-grid';
    grid.appendChild(_makeStatCard('Bodies Discovered',
      `${exploration.discoveredBodies.length} / ${exploration.totalBodies}`));
    grid.appendChild(_makeStatCard('Biomes Explored',
      `${exploration.biomesExplored} / ${exploration.totalBiomes}`));
    grid.appendChild(_makeStatCard('Surface Items', exploration.surfaceItemCount.toString()));
    section.appendChild(grid);

    // Body status table.
    const bodyRecords = records.recordsByBody;
    const table: HTMLTableElement = document.createElement('table');
    table.className = 'lib-table';
    table.innerHTML = `<thead><tr>
      <th>Body</th><th>Visited</th><th>Orbited</th><th>Landed</th>
    </tr></thead>`;
    const tbody: HTMLTableSectionElement = document.createElement('tbody');

    for (const bodyId of Object.keys(bodyRecords)) {
      const rec = bodyRecords[bodyId];
      if (!rec.visited) continue;
      const tr: HTMLTableRowElement = document.createElement('tr');
      tr.innerHTML = `
        <td class="cell-bold">${bodyId}</td>
        <td>${rec.visited ? _badge('visited', 'Visited') : '\u2014'}</td>
        <td>${rec.orbited ? _badge('orbited', 'Orbited') : '\u2014'}</td>
        <td>${rec.landed ? _badge('landed', 'Landed') : '\u2014'}</td>
      `;
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    section.appendChild(table);

    content.appendChild(section);
  }

  // -- Financial summary --
  {
    const section = _makeSection('Financial History');
    const grid: HTMLDivElement = document.createElement('div');
    grid.className = 'lib-stat-grid';

    grid.appendChild(_makeStatCard('Current Balance', _fmtMoney(financial.currentBalance)));
    grid.appendChild(_makeStatCard('Loan Balance', _fmtMoney(financial.loanBalance)));
    grid.appendChild(_makeStatCard('Total Interest Paid', _fmtMoney(financial.totalInterestPaid)));
    grid.appendChild(_makeStatCard('Mission Revenue', _fmtMoney(financial.totalMissionRevenue)));
    grid.appendChild(_makeStatCard('Contract Revenue', _fmtMoney(financial.totalContractRevenue)));
    grid.appendChild(_makeStatCard('Reputation', `${financial.reputation} / 100`));

    section.appendChild(grid);
    content.appendChild(section);
  }

  // -- Crew careers --
  {
    const section = _makeSection('Crew Careers');

    if (crewCareers.length === 0) {
      const empty: HTMLParagraphElement = document.createElement('p');
      empty.className = 'lib-empty';
      empty.textContent = 'No astronauts hired yet.';
      section.appendChild(empty);
    } else {
      const table: HTMLTableElement = document.createElement('table');
      table.className = 'lib-table';
      table.innerHTML = `<thead><tr>
        <th>Name</th><th>Status</th><th class="num">Flights</th>
        <th class="num">Piloting</th><th class="num">Engineering</th>
        <th class="num">Science</th>
      </tr></thead>`;
      const tbody: HTMLTableSectionElement = document.createElement('tbody');

      // Sort: active crew first, then by flights.
      const sorted = [...crewCareers].sort((a, b) => {
        const aActive = a.status === AstronautStatus.ACTIVE ? 1 : 0;
        const bActive = b.status === AstronautStatus.ACTIVE ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return b.flightsFlown - a.flightsFlown;
      });

      for (const c of sorted) {
        const tr: HTMLTableRowElement = document.createElement('tr');
        const statusColor = c.status === AstronautStatus.KIA
          ? '#ff6060'
          : c.status === AstronautStatus.FIRED
            ? '#a0a0a0'
            : c.injuryEnds !== null
              ? '#ffaa30'
              : '#60dd80';
        const statusText = c.status === AstronautStatus.KIA
          ? 'KIA'
          : c.status === AstronautStatus.FIRED
            ? 'Fired'
            : c.injuryEnds !== null
              ? 'Injured'
              : 'Active';
        tr.innerHTML = `
          <td class="cell-bold">${escapeHtml(c.name)}</td>
          <td style="color:${statusColor}">${statusText}</td>
          <td class="num">${c.flightsFlown}</td>
          <td class="num">${c.skills.piloting}</td>
          <td class="num">${c.skills.engineering}</td>
          <td class="num">${c.skills.science}</td>
        `;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      section.appendChild(table);
    }

    content.appendChild(section);
  }
}

// ---------------------------------------------------------------------------
// Tab 2 — Celestial Body Knowledge
// ---------------------------------------------------------------------------

function _renderBodiesTab(content: HTMLDivElement): void {
  const bodies = getCelestialBodyKnowledge(_state!);

  if (bodies.length === 0) {
    const empty: HTMLParagraphElement = document.createElement('p');
    empty.className = 'lib-empty';
    empty.textContent = 'No celestial bodies discovered yet. Complete flights to discover new worlds.';
    content.appendChild(empty);
    return;
  }

  const section = _makeSection('Discovered Bodies');
  const desc: HTMLParagraphElement = document.createElement('p');
  desc.className = 'lib-section-desc';
  desc.textContent = 'Physical properties of bodies your agency has visited. Use this data to plan future missions.';
  section.appendChild(desc);

  const grid: HTMLDivElement = document.createElement('div');
  grid.className = 'lib-body-grid';

  for (const body of bodies) {
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'lib-body-card';

    const name: HTMLDivElement = document.createElement('div');
    name.className = 'body-name';
    name.textContent = body.name;
    card.appendChild(name);

    const props: HTMLDivElement = document.createElement('div');
    props.className = 'body-props';

    const propData: [string, string][] = [
      ['Surface Gravity', `${body.surfaceGravity} m/s\u00B2`],
      ['Radius', _fmtDist(body.radius)],
      ['Atmosphere', body.hasAtmosphere ? `Yes (${_fmtDist(body.atmosphereTop)} top)` : 'None'],
      ['Landable', body.landable ? 'Yes' : 'No'],
      ['Min. Orbit Alt.', _fmtDist(body.minOrbitAltitude)],
      ['Biomes', body.biomeCount.toString()],
      ['Orbits', body.parentName],
      ['Times Visited', body.timesVisited.toString()],
      ['Satellites', body.satellitesInOrbit.toString()],
    ];

    if (body.orbitalDistance > 0) {
      propData.splice(4, 0, ['Orbital Distance', _fmtDistLong(body.orbitalDistance)]);
    }

    for (const [label, value] of propData) {
      const lbl: HTMLSpanElement = document.createElement('span');
      lbl.className = 'prop-label';
      lbl.textContent = label;
      props.appendChild(lbl);

      const val: HTMLSpanElement = document.createElement('span');
      val.className = 'prop-value';
      val.textContent = value;
      props.appendChild(val);
    }

    card.appendChild(props);
    grid.appendChild(card);
  }

  section.appendChild(grid);
  content.appendChild(section);
}

// ---------------------------------------------------------------------------
// Tab 3 — Frequently Flown Rockets
// ---------------------------------------------------------------------------

function _renderRocketsTab(content: HTMLDivElement): void {
  const rockets = getFrequentRockets(_state!);

  if (rockets.length === 0) {
    const empty: HTMLParagraphElement = document.createElement('p');
    empty.className = 'lib-empty';
    empty.textContent = 'No flights recorded yet. Complete flights to see your most-used rocket designs.';
    content.appendChild(empty);
    return;
  }

  const section = _makeSection('Top 5 Most-Flown Rockets');
  const list: HTMLDivElement = document.createElement('div');
  list.className = 'lib-rocket-list';

  for (let i = 0; i < rockets.length; i++) {
    const r = rockets[i];
    const card: HTMLDivElement = document.createElement('div');
    card.className = 'lib-rocket-card';

    const rank: HTMLDivElement = document.createElement('div');
    rank.className = 'lib-rocket-rank';
    rank.textContent = `#${i + 1}`;
    card.appendChild(rank);

    const info: HTMLDivElement = document.createElement('div');
    info.className = 'lib-rocket-info';

    const name: HTMLDivElement = document.createElement('div');
    name.className = 'lib-rocket-name';
    name.textContent = r.rocketName || 'Unnamed Rocket';
    info.appendChild(name);

    const stats: HTMLDivElement = document.createElement('div');
    stats.className = 'lib-rocket-stats';
    stats.innerHTML = `
      <span>Flights: <span class="stat-val">${r.flightCount}</span></span>
      <span>Success: <span class="stat-val">${r.successRate}%</span></span>
      <span>Revenue: <span class="stat-val">${_fmtMoney(r.totalRevenue)}</span></span>
      <span>Last: <span class="stat-val">${_fmtDate(r.lastFlown)}</span></span>
    `;
    info.appendChild(stats);

    card.appendChild(info);
    list.appendChild(card);
  }

  section.appendChild(list);
  content.appendChild(section);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function _makeSection(title: string): HTMLDivElement {
  const section: HTMLDivElement = document.createElement('div');
  section.className = 'lib-section';
  const h2: HTMLHeadingElement = document.createElement('h2');
  h2.textContent = title;
  section.appendChild(h2);
  return section;
}

function _makeStatCard(label: string, value: string, sub?: string): HTMLDivElement {
  const card: HTMLDivElement = document.createElement('div');
  card.className = 'lib-stat-card';

  const lbl: HTMLDivElement = document.createElement('div');
  lbl.className = 'label';
  lbl.textContent = label;
  card.appendChild(lbl);

  const val: HTMLDivElement = document.createElement('div');
  val.className = 'value';
  val.textContent = value;
  card.appendChild(val);

  if (sub) {
    const s: HTMLDivElement = document.createElement('div');
    s.className = 'sub';
    s.textContent = sub;
    card.appendChild(s);
  }

  return card;
}

function _makeRecordCard(label: string, value: string, detail?: string): HTMLDivElement {
  const card: HTMLDivElement = document.createElement('div');
  card.className = 'lib-record-card';

  const lbl: HTMLDivElement = document.createElement('div');
  lbl.className = 'rec-label';
  lbl.textContent = label;
  card.appendChild(lbl);

  const val: HTMLDivElement = document.createElement('div');
  val.className = 'rec-value';
  val.textContent = value;
  card.appendChild(val);

  if (detail) {
    const d: HTMLDivElement = document.createElement('div');
    d.className = 'rec-detail';
    d.textContent = detail;
    card.appendChild(d);
  }

  return card;
}

function _badge(cls: string, text: string): string {
  return `<span class="lib-badge ${cls}">${text}</span>`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function _fmtNum(n: number): string {
  return n.toLocaleString();
}

function _fmtMoney(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${n.toLocaleString()}`;
}

function _fmtAlt(m: number): string {
  if (m >= 1_000_000) return `${(m / 1_000).toFixed(0)} km`;
  if (m >= 10_000) return `${(m / 1_000).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}

function _fmtSpeed(mps: number): string {
  if (mps >= 1_000) return `${(mps / 1_000).toFixed(2)} km/s`;
  return `${mps.toFixed(0)} m/s`;
}

function _fmtMass(kg: number): string {
  if (kg >= 1_000) return `${(kg / 1_000).toFixed(1)} t`;
  return `${kg.toFixed(0)} kg`;
}

function _fmtTime(seconds: number): string {
  if (seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function _fmtDist(m: number): string {
  if (m >= 1_000_000) return `${(m / 1_000).toFixed(0)} km`;
  if (m >= 1_000) return `${(m / 1_000).toFixed(1)} km`;
  return `${m.toFixed(0)} m`;
}

function _fmtDistLong(m: number): string {
  if (m >= 1e12) return `${(m / 1e9).toFixed(0)} Gm`;
  if (m >= 1e9) return `${(m / 1e9).toFixed(1)} Gm`;
  if (m >= 1e6) return `${(m / 1e6).toFixed(0)} Mm`;
  return `${(m / 1_000).toFixed(0)} km`;
}

function _fmtDate(isoStr: string): string {
  if (!isoStr) return '\u2014';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString();
  } catch {
    return '\u2014';
  }
}

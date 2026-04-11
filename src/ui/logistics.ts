/**
 * logistics.ts — Logistics Center UI panel.
 *
 * Displays mining site information with power budgets, module lists,
 * refinery recipe management, and resource storage levels.
 *
 * @module ui/logistics
 */

import type { GameState, MiningSite, Route, ProvenLeg, RouteLocation } from '../core/gameState.ts';
import { setRouteStatus, addCraftToLeg, calculateRouteThroughput } from '../core/routes.ts';
import { MiningModuleType } from '../core/constants.ts';
import type { ResourceType } from '../core/constants.ts';
import { REFINERY_RECIPES, setRefineryRecipe } from '../core/refinery.ts';
import { RESOURCES_BY_ID } from '../data/resources.ts';
import './logistics.css';

// ---------------------------------------------------------------------------
// Module State
// ---------------------------------------------------------------------------

let _overlay: HTMLDivElement | null = null;
let _state: GameState | null = null;
let _selectedBodyId: string | null = null;
let _activeTab: 'mining' | 'routes' = 'mining';
let _expandedRouteIds = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a module type name for display.
 * Replaces underscores with spaces and title-cases each word.
 * E.g. `MINING_DRILL` -> `Mining Drill`.
 */
function _formatModuleType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Format a resource type name for display.
 * E.g. `WATER_ICE` -> `Water Ice`, `CO2` -> `Co2`.
 */
function _formatResourceType(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Open the Logistics Center panel.
 */
export function openLogisticsPanel(state: GameState, parentEl: HTMLElement): void {
  _state = state;
  _activeTab = 'mining';
  _selectedBodyId = null;

  _overlay = document.createElement('div');
  _overlay.id = 'logistics-overlay';
  _overlay.className = 'facility-overlay';
  parentEl.appendChild(_overlay);

  _render();
}

/**
 * Close and remove the Logistics Center panel.
 */
export function closeLogisticsPanel(): void {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
  _state = null;
  _selectedBodyId = null;
  _expandedRouteIds = new Set<string>();
}

// ---------------------------------------------------------------------------
// Rendering — Main
// ---------------------------------------------------------------------------

function _render(): void {
  if (!_overlay || !_state) return;
  _overlay.innerHTML = '';

  // Header
  const header = document.createElement('div');
  header.className = 'facility-header';

  const backBtn = document.createElement('button');
  backBtn.id = 'logistics-back-btn';
  backBtn.className = 'btn-ghost';
  backBtn.textContent = '\u2190 Hub';
  backBtn.addEventListener('click', () => {
    closeLogisticsPanel();
  });
  header.appendChild(backBtn);

  const title = document.createElement('h1');
  title.className = 'facility-title';
  title.textContent = 'Logistics Center';
  header.appendChild(title);

  _overlay.appendChild(header);

  // Tabs
  const tabs = document.createElement('div');
  tabs.className = 'facility-tabs';

  const tabDefs: Array<{ id: 'mining' | 'routes'; label: string }> = [
    { id: 'mining', label: 'Mining Sites' },
    { id: 'routes', label: 'Route Management' },
  ];

  for (const def of tabDefs) {
    const tab = document.createElement('button');
    tab.className = 'facility-tab' + (def.id === _activeTab ? ' active' : '');
    tab.textContent = def.label;
    tab.addEventListener('click', () => {
      _activeTab = def.id;
      _render();
    });
    tabs.appendChild(tab);
  }

  _overlay.appendChild(tabs);

  // Body content
  if (_activeTab === 'mining') {
    _renderMiningTab();
  } else {
    _renderRoutesTab();
  }
}

// ---------------------------------------------------------------------------
// Mining Sites Tab
// ---------------------------------------------------------------------------

function _renderMiningTab(): void {
  if (!_overlay || !_state) return;

  const sites = _state.miningSites;

  if (sites.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'facility-content empty-msg';
    msg.textContent = 'No mining sites established. Land a Base Control Unit on a celestial body to create one.';
    _overlay.appendChild(msg);
    return;
  }

  // Group sites by bodyId
  const bodySites = new Map<string, MiningSite[]>();
  for (const site of sites) {
    const list = bodySites.get(site.bodyId);
    if (list) {
      list.push(site);
    } else {
      bodySites.set(site.bodyId, [site]);
    }
  }

  const bodyIds = [...bodySites.keys()];

  // Auto-select first body if none selected or selection is invalid
  if (!_selectedBodyId || !bodySites.has(_selectedBodyId)) {
    _selectedBodyId = bodyIds[0];
  }

  // Two-column layout
  const body = document.createElement('div');
  body.className = 'logistics-body';

  // Left sidebar — body list
  const sidebar = document.createElement('div');
  sidebar.className = 'logistics-sidebar';

  for (const bodyId of bodyIds) {
    const item = document.createElement('div');
    item.className = 'logistics-sidebar-item' + (bodyId === _selectedBodyId ? ' active' : '');
    item.textContent = bodyId;
    item.addEventListener('click', () => {
      _selectedBodyId = bodyId;
      _render();
    });
    sidebar.appendChild(item);
  }

  body.appendChild(sidebar);

  // Right content area — sites for selected body
  const content = document.createElement('div');
  content.className = 'logistics-content';

  const selectedSites = bodySites.get(_selectedBodyId!) ?? [];
  for (const site of selectedSites) {
    content.appendChild(_renderSiteCard(site));
  }

  body.appendChild(content);
  _overlay.appendChild(body);
}

// ---------------------------------------------------------------------------
// Site Card
// ---------------------------------------------------------------------------

function _renderSiteCard(site: MiningSite): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'logistics-site-card';

  // Site name and body
  const nameEl = document.createElement('h3');
  nameEl.className = 'logistics-site-name';
  nameEl.textContent = `${site.name} \u2014 ${site.bodyId}`;
  card.appendChild(nameEl);

  // Power budget
  card.appendChild(_renderPowerBar(site));

  // Module list
  card.appendChild(_renderModuleList(site));

  // Storage levels
  const storageEntries = Object.entries(site.storage) as Array<[ResourceType, number]>;
  if (storageEntries.length > 0) {
    card.appendChild(_renderResourceSection('Storage', storageEntries, 'logistics-storage-section'));
  }

  // Orbital buffer
  const bufferEntries = Object.entries(site.orbitalBuffer) as Array<[ResourceType, number]>;
  if (bufferEntries.length > 0) {
    card.appendChild(_renderResourceSection('Orbital Buffer', bufferEntries, 'logistics-buffer-section'));
  }

  return card;
}

// ---------------------------------------------------------------------------
// Power Bar
// ---------------------------------------------------------------------------

function _renderPowerBar(site: MiningSite): HTMLDivElement {
  const wrapper = document.createElement('div');

  const label = document.createElement('div');
  const ratio = site.powerRequired > 0 ? site.powerGenerated / site.powerRequired : 1;
  const pct = Math.min(ratio * 100, 100);

  let colorClass: string;
  if (ratio >= 1) {
    colorClass = 'logistics-power-ok';
  } else if (ratio >= 0.5) {
    colorClass = 'logistics-power-warn';
  } else {
    colorClass = 'logistics-power-crit';
  }

  label.textContent = `Power: ${site.powerGenerated} / ${site.powerRequired}`;
  if (ratio < 1) {
    label.style.color = 'var(--color-warning)';
  }
  wrapper.appendChild(label);

  const bar = document.createElement('div');
  bar.className = 'logistics-power-bar';

  const fill = document.createElement('div');
  fill.className = `logistics-power-fill ${colorClass}`;
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);

  wrapper.appendChild(bar);
  return wrapper;
}

// ---------------------------------------------------------------------------
// Module List
// ---------------------------------------------------------------------------

function _renderModuleList(site: MiningSite): HTMLUListElement {
  const list = document.createElement('ul');
  list.className = 'logistics-module-list';

  for (const mod of site.modules) {
    const li = document.createElement('li');
    li.className = 'logistics-module-item';

    const typeText = _formatModuleType(mod.type);
    let text = `${typeText} (${mod.partId})`;

    if (mod.type === MiningModuleType.REFINERY) {
      // Show current recipe and selector
      const span = document.createElement('span');
      span.textContent = text + ' \u2014 Recipe: ';
      li.appendChild(span);

      const select = document.createElement('select');
      select.className = 'logistics-recipe-select';

      // "None" option
      const noneOpt = document.createElement('option');
      noneOpt.value = '';
      noneOpt.textContent = 'None';
      select.appendChild(noneOpt);

      for (const recipe of REFINERY_RECIPES) {
        const opt = document.createElement('option');
        opt.value = recipe.id;
        opt.textContent = recipe.name;
        if (mod.recipeId === recipe.id) {
          opt.selected = true;
        }
        select.appendChild(opt);
      }

      // If no recipe is set, the "None" option stays selected by default
      if (!mod.recipeId) {
        noneOpt.selected = true;
      }

      select.addEventListener('change', () => {
        const value = select.value;
        if (value) {
          setRefineryRecipe(site, mod.id, value);
        } else {
          // Clear recipe — set recipeId to undefined
          mod.recipeId = undefined;
        }
        _render();
      });

      li.appendChild(select);
    } else {
      li.textContent = text;
    }

    list.appendChild(li);
  }

  return list;
}

// ---------------------------------------------------------------------------
// Resource Section (Storage / Orbital Buffer)
// ---------------------------------------------------------------------------

function _renderResourceSection(
  title: string,
  entries: Array<[ResourceType, number]>,
  cssClass: string,
): HTMLDivElement {
  const section = document.createElement('div');
  section.className = cssClass;

  const heading = document.createElement('h4');
  heading.textContent = title;
  heading.style.margin = '0 0 var(--space-xs)';
  heading.style.fontSize = 'var(--font-size-body)';
  heading.style.color = 'var(--color-text-secondary)';
  section.appendChild(heading);

  for (const [resourceType, amount] of entries) {
    const row = document.createElement('div');
    row.className = 'logistics-resource-row';

    const nameSpan = document.createElement('span');
    nameSpan.textContent = _formatResourceType(resourceType);
    row.appendChild(nameSpan);

    const amountSpan = document.createElement('span');
    amountSpan.className = 'logistics-resource-amount';
    amountSpan.textContent = `${amount.toFixed(1)} kg`;
    row.appendChild(amountSpan);

    section.appendChild(row);
  }

  return section;
}

// ---------------------------------------------------------------------------
// Routes Tab — Route Map
// ---------------------------------------------------------------------------

/** Return a fill colour for a celestial-body circle on the route map. */
function _getBodyColor(bodyId: string): string {
  const colors: Record<string, string> = {
    SUN: '#FFD700',
    EARTH: '#4488CC',
    MOON: '#999',
    MARS: '#CC5533',
    CERES: '#887766',
    JUPITER: '#CC9955',
    SATURN: '#CCBB77',
    TITAN: '#AA8844',
  };
  return colors[bodyId] ?? '#666';
}

/**
 * Build an SVG schematic of the solar system showing bodies that are
 * relevant to the player's logistics network (mining sites, route
 * endpoints) plus Earth which is always visible.
 */
function _renderRouteMap(): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'logistics-route-map');
  svg.setAttribute('viewBox', '0 0 800 200');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '200');

  // Determine which bodies to show
  const visibleBodies = new Set<string>();
  visibleBodies.add('EARTH'); // always shown

  if (_state) {
    for (const site of _state.miningSites) {
      visibleBodies.add(site.bodyId);
    }
    for (const route of _state.routes) {
      for (const leg of route.legs) {
        visibleBodies.add(leg.origin.bodyId);
        visibleBodies.add(leg.destination.bodyId);
      }
    }
  }

  // Schematic body positions (x, y) within the 800×200 viewBox
  const bodyPositions: Record<string, { x: number; y: number; label: string; radius: number }> = {
    SUN:     { x: 60,  y: 100, label: 'Sun',     radius: 20 },
    EARTH:   { x: 220, y: 100, label: 'Earth',   radius: 14 },
    MOON:    { x: 280, y: 60,  label: 'Moon',    radius: 8 },
    MARS:    { x: 400, y: 100, label: 'Mars',    radius: 12 },
    CERES:   { x: 510, y: 100, label: 'Ceres',   radius: 7 },
    JUPITER: { x: 620, y: 80,  label: 'Jupiter', radius: 18 },
    SATURN:  { x: 700, y: 120, label: 'Saturn',  radius: 16 },
    TITAN:   { x: 740, y: 60,  label: 'Titan',   radius: 7 },
  };

  // Render visible bodies
  for (const [bodyId, pos] of Object.entries(bodyPositions)) {
    if (!visibleBodies.has(bodyId)) continue;

    // Circle
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', String(pos.x));
    circle.setAttribute('cy', String(pos.y));
    circle.setAttribute('r', String(pos.radius));
    circle.setAttribute('class', `body-node body-${bodyId.toLowerCase()}`);
    circle.setAttribute('fill', _getBodyColor(bodyId));
    circle.setAttribute('stroke', '#666');
    circle.setAttribute('stroke-width', '1.5');
    svg.appendChild(circle);

    // Label below
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', String(pos.x));
    label.setAttribute('y', String(pos.y + pos.radius + 16));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'body-label');
    label.setAttribute('fill', '#ccc');
    label.setAttribute('font-size', '11');
    label.textContent = pos.label;
    svg.appendChild(label);
  }

  // --- Proven leg dashed lines ---
  if (_state) {
    for (const leg of _state.provenLegs) {
      const originPos = bodyPositions[leg.origin.bodyId];
      const destPos = bodyPositions[leg.destination.bodyId];
      if (!originPos || !destPos) continue;

      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(originPos.x));
      line.setAttribute('y1', String(originPos.y));
      line.setAttribute('x2', String(destPos.x));
      line.setAttribute('y2', String(destPos.y));
      line.setAttribute('stroke', '#888');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '6 4');
      line.setAttribute('class', 'proven-leg-line');
      line.style.cursor = 'pointer';

      // Tooltip on hover
      const titleEl = document.createElementNS(svgNS, 'title');
      titleEl.textContent = `Craft: ${leg.craftDesignId}\nCapacity: ${leg.cargoCapacityKg} kg\nCost/Run: $${leg.costPerRun.toLocaleString()}`;
      line.appendChild(titleEl);

      svg.appendChild(line);
    }

    // --- Active route solid lines ---
    for (const route of _state.routes) {
      for (const leg of route.legs) {
        const originPos = bodyPositions[leg.origin.bodyId];
        const destPos = bodyPositions[leg.destination.bodyId];
        if (!originPos || !destPos) continue;

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', String(originPos.x));
        line.setAttribute('y1', String(originPos.y));
        line.setAttribute('x2', String(destPos.x));
        line.setAttribute('y2', String(destPos.y));
        line.setAttribute('stroke-width', '2.5');
        line.setAttribute('class', `route-line route-${route.status}`);
        line.style.cursor = 'pointer';

        // Color by status
        if (route.status === 'broken') {
          line.setAttribute('stroke', '#CC3333');
        } else if (route.status === 'paused') {
          line.setAttribute('stroke', 'rgba(100, 180, 255, 0.4)');
        } else {
          line.setAttribute('stroke', '#64B4FF');
        }

        // Click to highlight route in table
        const routeId = route.id;
        line.addEventListener('click', () => {
          const tableRow = _overlay?.querySelector(`tr[data-route-id="${routeId}"]`);
          if (tableRow) {
            // Remove existing highlights
            _overlay?.querySelectorAll('tr.route-highlighted').forEach((el) => el.classList.remove('route-highlighted'));
            tableRow.classList.add('route-highlighted');
            tableRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });

        svg.appendChild(line);
      }
    }
  }

  return svg;
}

// ---------------------------------------------------------------------------
// Routes Tab
// ---------------------------------------------------------------------------

/**
 * Format a RouteLocation for display.
 * E.g. `"MOON (surface)"` or `"MARS (orbit, 200km)"`.
 */
function _formatLocation(loc: RouteLocation): string {
  if (loc.locationType === 'orbit' && loc.altitude !== undefined) {
    return `${loc.bodyId} (orbit, ${loc.altitude}km)`;
  }
  return `${loc.bodyId} (${loc.locationType})`;
}

function _renderRoutesTab(): void {
  if (!_overlay || !_state) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'logistics-routes-content';

  // --- Route map ---
  wrapper.appendChild(_renderRouteMap());

  // --- Routes table ---
  const routes = _state.routes;

  if (routes.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'empty-msg';
    msg.textContent = 'No routes created. Prove route legs by flying them manually, then assemble them into automated routes.';
    wrapper.appendChild(msg);
  } else {
    wrapper.appendChild(_renderRoutesTable(routes));
  }

  // --- Proven legs section ---
  const provenLegs = _state.provenLegs;
  wrapper.appendChild(_renderProvenLegsSection(provenLegs));

  _overlay.appendChild(wrapper);
}

function _renderRoutesTable(routes: Route[]): HTMLTableElement {
  const table = document.createElement('table');
  table.className = 'logistics-routes-table';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const headers = ['Name', 'Resource', 'Legs', 'Throughput', 'Cost/Period', 'Revenue/Period', 'Status'];
  for (const h of headers) {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Body
  const tbody = document.createElement('tbody');
  for (const route of routes) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-route-id', route.id);

    // Name
    const tdName = document.createElement('td');
    tdName.textContent = route.name;
    tr.appendChild(tdName);

    // Resource Type
    const tdResource = document.createElement('td');
    tdResource.textContent = _formatResourceType(route.resourceType);
    tr.appendChild(tdResource);

    // Legs (expandable)
    const tdLegs = document.createElement('td');
    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn-ghost logistics-expand-btn';
    const isExpanded = _expandedRouteIds.has(route.id);
    expandBtn.textContent = `${isExpanded ? '\u25BC' : '\u25B6'} ${route.legs.length} leg${route.legs.length !== 1 ? 's' : ''}`;
    expandBtn.addEventListener('click', () => {
      if (_expandedRouteIds.has(route.id)) {
        _expandedRouteIds.delete(route.id);
      } else {
        _expandedRouteIds.add(route.id);
      }
      _render();
    });
    tdLegs.appendChild(expandBtn);
    tr.appendChild(tdLegs);

    // Throughput
    const tdThroughput = document.createElement('td');
    tdThroughput.textContent = `${route.throughputPerPeriod.toFixed(1)} kg`;
    tr.appendChild(tdThroughput);

    // Cost/Period
    const tdCost = document.createElement('td');
    tdCost.textContent = `$${route.totalCostPerPeriod.toLocaleString()}`;
    tr.appendChild(tdCost);

    // Revenue/Period
    const tdRevenue = document.createElement('td');
    if (route.status === 'active' && route.legs.length > 0) {
      const lastLeg = route.legs[route.legs.length - 1];
      if (lastLeg.destination.bodyId === 'EARTH') {
        const resourceDef = RESOURCES_BY_ID[route.resourceType];
        const revenue = route.throughputPerPeriod * resourceDef.baseValuePerKg;
        tdRevenue.textContent = `$${Math.round(revenue).toLocaleString()}`;
      } else {
        tdRevenue.textContent = '$0';
      }
    } else {
      tdRevenue.textContent = '-';
    }
    tr.appendChild(tdRevenue);

    // Status toggle button
    const tdStatus = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = `logistics-route-status-btn status-${route.status}`;
    btn.textContent = route.status.charAt(0).toUpperCase() + route.status.slice(1);
    btn.addEventListener('click', () => {
      if (route.status === 'active') {
        setRouteStatus(route, 'paused');
      } else if (route.status === 'paused') {
        setRouteStatus(route, 'active');
      }
      // 'broken' routes cannot be toggled
      _render();
    });
    if (route.status === 'broken') {
      btn.disabled = true;
    }
    tdStatus.appendChild(btn);
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);

    // Expanded leg rows
    if (_expandedRouteIds.has(route.id)) {
      for (const leg of route.legs) {
        const legTr = document.createElement('tr');
        legTr.className = 'logistics-leg-row';

        // Empty cell (for Name column alignment)
        legTr.appendChild(document.createElement('td'));

        // Origin -> Destination
        const tdRoute = document.createElement('td');
        tdRoute.colSpan = 2;
        tdRoute.textContent = `${_formatLocation(leg.origin)} \u2192 ${_formatLocation(leg.destination)}`;
        tdRoute.className = 'logistics-leg-route';
        legTr.appendChild(tdRoute);

        // Craft design
        const tdCraft = document.createElement('td');
        tdCraft.textContent = leg.craftDesignId;
        legTr.appendChild(tdCraft);

        // Craft count with +/- buttons
        const tdCount = document.createElement('td');
        tdCount.className = 'logistics-craft-controls';

        const minusBtn = document.createElement('button');
        minusBtn.className = 'btn-ghost logistics-craft-btn';
        minusBtn.textContent = '\u2212';
        minusBtn.disabled = leg.craftCount <= 1;
        minusBtn.addEventListener('click', () => {
          if (leg.craftCount > 1) {
            leg.craftCount--;
            route.throughputPerPeriod = calculateRouteThroughput(route.legs);
            route.totalCostPerPeriod = route.legs.reduce((sum, l) => sum + l.costPerRun * l.craftCount, 0);
            _render();
          }
        });
        tdCount.appendChild(minusBtn);

        const countSpan = document.createElement('span');
        countSpan.className = 'logistics-craft-count';
        countSpan.textContent = String(leg.craftCount);
        tdCount.appendChild(countSpan);

        const plusBtn = document.createElement('button');
        plusBtn.className = 'btn-ghost logistics-craft-btn';
        plusBtn.textContent = '+';
        plusBtn.addEventListener('click', () => {
          addCraftToLeg(route, leg.id);
          _render();
        });
        tdCount.appendChild(plusBtn);

        legTr.appendChild(tdCount);

        // Empty cells for remaining columns (Revenue, Status)
        legTr.appendChild(document.createElement('td'));
        legTr.appendChild(document.createElement('td'));

        tbody.appendChild(legTr);
      }
    }
  }
  table.appendChild(tbody);

  return table;
}

function _renderProvenLegsSection(provenLegs: ProvenLeg[]): HTMLDivElement {
  const section = document.createElement('div');
  section.className = 'logistics-proven-legs-section';

  const heading = document.createElement('h3');
  heading.textContent = 'Proven Legs';
  section.appendChild(heading);

  if (provenLegs.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'empty-msg';
    msg.textContent = 'No proven legs yet. Successfully fly a route manually to prove it.';
    section.appendChild(msg);
    return section;
  }

  for (const leg of provenLegs) {
    const card = document.createElement('div');
    card.className = 'logistics-proven-leg-card';

    // Origin -> Destination
    const routeEl = document.createElement('div');
    routeEl.className = 'logistics-proven-leg-route';

    const originSpan = document.createElement('span');
    originSpan.textContent = _formatLocation(leg.origin);
    routeEl.appendChild(originSpan);

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'logistics-proven-leg-arrow';
    arrowSpan.textContent = '\u2192';
    routeEl.appendChild(arrowSpan);

    const destSpan = document.createElement('span');
    destSpan.textContent = _formatLocation(leg.destination);
    routeEl.appendChild(destSpan);

    card.appendChild(routeEl);

    // Details
    const details = document.createElement('div');
    details.className = 'logistics-proven-leg-details';

    const craftSpan = document.createElement('span');
    craftSpan.textContent = `Craft: ${leg.craftDesignId}`;
    details.appendChild(craftSpan);

    const capacitySpan = document.createElement('span');
    capacitySpan.textContent = `Capacity: ${leg.cargoCapacityKg.toFixed(1)} kg`;
    details.appendChild(capacitySpan);

    const costSpan = document.createElement('span');
    costSpan.textContent = `Cost/Run: $${leg.costPerRun.toLocaleString()}`;
    details.appendChild(costSpan);

    card.appendChild(details);

    section.appendChild(card);
  }

  return section;
}

/**
 * _routeTable.ts -- Route Management tab rendering for the Logistics Center.
 *
 * Handles the routes tab entry point, route table with status toggle and
 * leg expansion, craft +/- controls, revenue column, and proven legs
 * display.
 *
 * Route map SVG rendering lives in `_routeMap.ts`.
 * Route builder wizard lives in `_routeBuilder.ts`.
 *
 * @module ui/logistics/_routeTable
 */

import type { Route, ProvenLeg } from '../../core/gameState.ts';
import { setRouteStatus, addCraftToLeg, calculateRouteThroughput } from '../../core/routes.ts';
import { RESOURCES_BY_ID } from '../../data/resources.ts';
import {
  getLogisticsState,
  triggerRender,
  formatResourceType,
} from './_state.ts';
import { renderRouteMap, formatLocation } from './_routeMap.ts';
import { renderBuilderPanel } from './_routeBuilder.ts';

// ---------------------------------------------------------------------------
// Routes Tab (main entry)
// ---------------------------------------------------------------------------

export function renderRoutesTab(): void {
  const ls = getLogisticsState();
  if (!ls.overlay || !ls.state) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'logistics-routes-content';

  // --- Route map ---
  wrapper.appendChild(renderRouteMap());

  // --- Create Route button (always visible below the map) ---
  if (!ls.builderMode) {
    const createBtn = document.createElement('button');
    createBtn.className = 'logistics-builder-create-btn';
    createBtn.textContent = '+ Create Route';
    createBtn.addEventListener('click', () => {
      getLogisticsState().builderMode = true;
      triggerRender();
    });
    wrapper.appendChild(createBtn);
  }

  // --- Builder panel OR routes table ---
  if (ls.builderMode) {
    wrapper.appendChild(renderBuilderPanel());
  } else {
    // --- Routes table ---
    const routes = ls.state.routes;

    if (routes.length === 0) {
      const msg = document.createElement('div');
      msg.className = 'empty-msg';
      msg.textContent = 'No routes created. Prove route legs by flying them manually, then assemble them into automated routes.';
      wrapper.appendChild(msg);
    } else {
      wrapper.appendChild(_renderRoutesTable(routes));
    }
  }

  // --- Proven legs section ---
  const provenLegs = ls.state.provenLegs;
  wrapper.appendChild(_renderProvenLegsSection(provenLegs));

  ls.overlay.appendChild(wrapper);
}

// ---------------------------------------------------------------------------
// Routes Table
// ---------------------------------------------------------------------------

function _renderRoutesTable(routes: Route[]): HTMLTableElement {
  const ls = getLogisticsState();
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
    tdResource.textContent = formatResourceType(route.resourceType);
    tr.appendChild(tdResource);

    // Legs (expandable)
    const tdLegs = document.createElement('td');
    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn-ghost logistics-expand-btn';
    const isExpanded = ls.expandedRouteIds.has(route.id);
    expandBtn.textContent = `${isExpanded ? '\u25BC' : '\u25B6'} ${route.legs.length} leg${route.legs.length !== 1 ? 's' : ''}`;
    expandBtn.addEventListener('click', () => {
      const currentLs = getLogisticsState();
      if (currentLs.expandedRouteIds.has(route.id)) {
        currentLs.expandedRouteIds.delete(route.id);
      } else {
        currentLs.expandedRouteIds.add(route.id);
      }
      triggerRender();
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
      triggerRender();
    });
    if (route.status === 'broken') {
      btn.disabled = true;
    }
    tdStatus.appendChild(btn);
    tr.appendChild(tdStatus);

    tbody.appendChild(tr);

    // Expanded leg rows
    if (ls.expandedRouteIds.has(route.id)) {
      for (const leg of route.legs) {
        const legTr = document.createElement('tr');
        legTr.className = 'logistics-leg-row';

        // Empty cell (for Name column alignment)
        legTr.appendChild(document.createElement('td'));

        // Origin -> Destination
        const tdRoute = document.createElement('td');
        tdRoute.colSpan = 2;
        tdRoute.textContent = `${formatLocation(leg.origin)} \u2192 ${formatLocation(leg.destination)}`;
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
            triggerRender();
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
          triggerRender();
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
    originSpan.textContent = formatLocation(leg.origin);
    routeEl.appendChild(originSpan);

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'logistics-proven-leg-arrow';
    arrowSpan.textContent = '\u2192';
    routeEl.appendChild(arrowSpan);

    const destSpan = document.createElement('span');
    destSpan.textContent = formatLocation(leg.destination);
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

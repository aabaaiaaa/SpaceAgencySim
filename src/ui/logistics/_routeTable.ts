/**
 * _routeTable.ts -- Route Management tab rendering for the Logistics Center.
 *
 * Handles the route map SVG, route table with status toggle and leg
 * expansion, craft +/- controls, revenue column, route builder wizard,
 * and proven legs display.
 *
 * @module ui/logistics/_routeTable
 */

import type { Route, ProvenLeg, RouteLocation } from '../../core/gameState.ts';
import { setRouteStatus, addCraftToLeg, calculateRouteThroughput, createRoute } from '../../core/routes.ts';
import type { ResourceType } from '../../core/constants.ts';
import { RESOURCES_BY_ID } from '../../data/resources.ts';
import { getBodyDef } from '../../data/bodies.ts';
import {
  getLogisticsState,
  resetBuilderState,
  triggerRender,
  formatResourceType,
} from './_state.ts';

// ---------------------------------------------------------------------------
// Route Map helpers
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
 * Format a RouteLocation for display.
 * E.g. `"MOON (surface)"` or `"MARS (orbit, 200km)"`.
 */
function _formatLocation(loc: RouteLocation): string {
  if (loc.locationType === 'orbit' && loc.altitude !== undefined) {
    return `${loc.bodyId} (orbit, ${loc.altitude}km)`;
  }
  return `${loc.bodyId} (${loc.locationType})`;
}

// ---------------------------------------------------------------------------
// Route Map SVG
// ---------------------------------------------------------------------------

/**
 * Build an SVG schematic of the solar system showing bodies that are
 * relevant to the player's logistics network (mining sites, route
 * endpoints) plus Earth which is always visible.
 */
function _renderRouteMap(): SVGSVGElement {
  const ls = getLogisticsState();
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'logistics-route-map');
  svg.setAttribute('viewBox', '0 0 800 200');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '200');

  // Determine which bodies to show
  const visibleBodies = new Set<string>();
  visibleBodies.add('EARTH'); // always shown

  if (ls.state) {
    for (const site of ls.state.miningSites) {
      visibleBodies.add(site.bodyId);
    }
    for (const route of ls.state.routes) {
      for (const leg of route.legs) {
        visibleBodies.add(leg.origin.bodyId);
        visibleBodies.add(leg.destination.bodyId);
      }
    }
  }

  // Schematic body positions (x, y) within the 800x200 viewBox
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

    // In builder mode, highlight current body and make circles clickable
    if (ls.builderMode) {
      circle.style.cursor = 'pointer';
      if (ls.builderCurrentBodyId === bodyId) {
        circle.setAttribute('stroke', '#FFD700');
        circle.setAttribute('stroke-width', '3');
      }
      const clickBodyId = bodyId;
      circle.addEventListener('click', () => {
        // Only allow setting origin if no legs have been added yet
        if (getLogisticsState().builderLegs.length === 0) {
          getLogisticsState().builderCurrentBodyId = clickBodyId;
          triggerRender();
        }
      });
    }

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
  if (ls.state) {
    for (const leg of ls.state.provenLegs) {
      const originPos = bodyPositions[leg.origin.bodyId];
      const destPos = bodyPositions[leg.destination.bodyId];
      if (!originPos || !destPos) continue;

      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(originPos.x));
      line.setAttribute('y1', String(originPos.y));
      line.setAttribute('x2', String(destPos.x));
      line.setAttribute('y2', String(destPos.y));
      line.setAttribute('class', 'proven-leg-line');

      const isOutbound = ls.builderMode && ls.builderCurrentBodyId != null
        && leg.origin.bodyId === ls.builderCurrentBodyId;

      if (ls.builderMode && ls.builderCurrentBodyId != null) {
        if (isOutbound) {
          // Highlight outbound legs: solid line, bright color, clickable
          line.setAttribute('stroke', '#64B4FF');
          line.setAttribute('stroke-width', '2.5');
          // No dash -- solid line to distinguish from non-outbound
          line.style.cursor = 'pointer';

          const legId = leg.id;
          const destBodyId = leg.destination.bodyId;
          line.addEventListener('click', () => {
            const currentLs = getLogisticsState();
            currentLs.builderLegs.push(legId);
            currentLs.builderCurrentBodyId = destBodyId;
            triggerRender();
          });
        } else {
          // Fade non-outbound legs
          line.setAttribute('stroke', '#888');
          line.setAttribute('stroke-width', '1.5');
          line.setAttribute('stroke-dasharray', '6 4');
          line.setAttribute('opacity', '0.2');
          line.style.cursor = 'default';
        }
      } else {
        // Normal (non-builder) mode
        line.setAttribute('stroke', '#888');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-dasharray', '6 4');
        line.style.cursor = 'pointer';
      }

      // Tooltip on hover
      const titleEl = document.createElementNS(svgNS, 'title');
      titleEl.textContent = `Craft: ${leg.craftDesignId}\nCapacity: ${leg.cargoCapacityKg} kg\nCost/Run: $${leg.costPerRun.toLocaleString()}`;
      line.appendChild(titleEl);

      svg.appendChild(line);
    }

    // --- Active route solid lines ---
    for (const route of ls.state.routes) {
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
          const overlay = getLogisticsState().overlay;
          const tableRow = overlay?.querySelector(`tr[data-route-id="${routeId}"]`);
          if (tableRow) {
            // Remove existing highlights
            overlay?.querySelectorAll('tr.route-highlighted').forEach((el) => el.classList.remove('route-highlighted'));
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
// Routes Tab (main entry)
// ---------------------------------------------------------------------------

export function renderRoutesTab(): void {
  const ls = getLogisticsState();
  if (!ls.overlay || !ls.state) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'logistics-routes-content';

  // --- Route map ---
  wrapper.appendChild(_renderRouteMap());

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
    wrapper.appendChild(_renderBuilderPanel());
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
// Route Builder Panel
// ---------------------------------------------------------------------------

function _renderBuilderPanel(): HTMLDivElement {
  const ls = getLogisticsState();
  const panel = document.createElement('div');
  panel.className = 'logistics-builder-panel';

  const heading = document.createElement('h3');
  heading.className = 'logistics-builder-heading';
  heading.textContent = 'Create New Route';
  panel.appendChild(heading);

  // --- Resource type dropdown ---
  const resourceGroup = document.createElement('div');
  resourceGroup.className = 'logistics-builder-field';

  const resourceLabel = document.createElement('label');
  resourceLabel.className = 'logistics-builder-label';
  resourceLabel.textContent = 'Resource Type';
  resourceGroup.appendChild(resourceLabel);

  const resourceSelect = document.createElement('select');
  resourceSelect.className = 'logistics-builder-select';

  // Determine available resource types: resources that exist on bodies
  // touched by at least one proven leg
  const availableResourceTypes = _getAvailableResourceTypes();

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = '-- Select Resource --';
  resourceSelect.appendChild(defaultOpt);

  for (const rt of availableResourceTypes) {
    const opt = document.createElement('option');
    opt.value = rt;
    opt.textContent = formatResourceType(rt);
    if (ls.builderResourceType === rt) {
      opt.selected = true;
    }
    resourceSelect.appendChild(opt);
  }

  if (!ls.builderResourceType) {
    defaultOpt.selected = true;
  }

  resourceSelect.addEventListener('change', () => {
    getLogisticsState().builderResourceType = resourceSelect.value || null;
  });

  resourceGroup.appendChild(resourceSelect);
  panel.appendChild(resourceGroup);

  // --- Route name input ---
  const nameGroup = document.createElement('div');
  nameGroup.className = 'logistics-builder-field';

  const nameLabel = document.createElement('label');
  nameLabel.className = 'logistics-builder-label';
  nameLabel.textContent = 'Route Name';
  nameGroup.appendChild(nameLabel);

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'logistics-builder-input';
  nameInput.placeholder = 'e.g. Lunar Water Run';
  nameInput.value = ls.builderRouteName;
  nameInput.addEventListener('input', () => {
    getLogisticsState().builderRouteName = nameInput.value;
  });

  nameGroup.appendChild(nameInput);
  panel.appendChild(nameGroup);

  // --- Legs chain display ---
  const legsGroup = document.createElement('div');
  legsGroup.className = 'logistics-builder-field';

  const legsLabel = document.createElement('label');
  legsLabel.className = 'logistics-builder-label';
  legsLabel.textContent = 'Route Legs';
  legsGroup.appendChild(legsLabel);

  const legsDisplay = document.createElement('div');
  legsDisplay.className = 'logistics-builder-legs';

  if (ls.builderLegs.length === 0) {
    legsDisplay.textContent = 'No legs added yet';
    legsDisplay.classList.add('logistics-builder-legs-empty');
  } else {
    // Show summary of chained legs
    for (const legId of ls.builderLegs) {
      const leg = ls.state?.provenLegs.find((pl) => pl.id === legId);
      if (leg) {
        const legEl = document.createElement('div');
        legEl.className = 'logistics-builder-leg-item';
        legEl.textContent = `${_formatLocation(leg.origin)} \u2192 ${_formatLocation(leg.destination)}`;
        legsDisplay.appendChild(legEl);
      }
    }
  }

  legsGroup.appendChild(legsDisplay);
  panel.appendChild(legsGroup);

  // --- Action buttons ---
  const actions = document.createElement('div');
  actions.className = 'logistics-builder-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'logistics-builder-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    resetBuilderState();
    triggerRender();
  });
  actions.appendChild(cancelBtn);

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'logistics-builder-confirm-btn';
  confirmBtn.textContent = 'Create Route';
  confirmBtn.addEventListener('click', () => {
    const currentLs = getLogisticsState();
    // Validate inputs
    const errors: string[] = [];
    if (currentLs.builderLegs.length === 0) {
      errors.push('Add at least one leg by clicking a body then an outbound route on the map.');
    }
    if (!currentLs.builderResourceType) {
      errors.push('Select a resource type.');
    }
    if (!currentLs.builderRouteName.trim()) {
      errors.push('Enter a route name.');
    }

    // Show errors if validation fails
    const errorEl = panel.querySelector('.logistics-builder-error') as HTMLDivElement | null;
    if (errors.length > 0) {
      if (errorEl) {
        errorEl.textContent = errors.join(' ');
      }
      return;
    }

    // Attempt to create the route
    try {
      createRoute(currentLs.state!, {
        name: currentLs.builderRouteName.trim(),
        resourceType: currentLs.builderResourceType as ResourceType,
        provenLegIds: currentLs.builderLegs,
      });
      resetBuilderState();
      triggerRender();
    } catch (err: unknown) {
      if (errorEl) {
        errorEl.textContent = err instanceof Error ? err.message : String(err);
      }
    }
  });
  actions.appendChild(confirmBtn);

  panel.appendChild(actions);

  // --- Error display area ---
  const errorDiv = document.createElement('div');
  errorDiv.className = 'logistics-builder-error';
  panel.appendChild(errorDiv);

  return panel;
}

/**
 * Collect resource types available for route building.
 * A resource is available if at least one proven leg touches a body
 * that produces it (via its resource profile).
 */
function _getAvailableResourceTypes(): string[] {
  const ls = getLogisticsState();
  if (!ls.state) return [];

  // Gather all body IDs from proven leg origins and destinations
  const bodyIds = new Set<string>();
  for (const leg of ls.state.provenLegs) {
    bodyIds.add(leg.origin.bodyId);
    bodyIds.add(leg.destination.bodyId);
  }

  // Collect resource types from those bodies' resource profiles
  const resourceTypes = new Set<string>();
  for (const bodyId of bodyIds) {
    const bodyDef = getBodyDef(bodyId);
    if (bodyDef?.resourceProfile) {
      for (const entry of bodyDef.resourceProfile) {
        resourceTypes.add(entry.resourceType);
      }
    }
  }

  return [...resourceTypes].sort();
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

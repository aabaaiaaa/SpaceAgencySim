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
import {
  renderRouteMap,
  formatLocation,
  applyMapZoomTransforms,
  setRouteHover as _setRouteHover,
  toggleRouteSelection,
  refreshRouteSelection,
} from './_routeMap.ts';
import { renderBuilderPanel } from './_routeBuilder.ts';
import { getLogisticsListenerTracker } from './_listenerTracker.ts';

/**
 * Register a DOM listener through the logistics tracker.
 */
function _addTracked(
  target: EventTarget,
  event: string,
  handler: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
): void {
  const tracker = getLogisticsListenerTracker();
  if (tracker) tracker.add(target, event, handler, options);
}

// ---------------------------------------------------------------------------
// Routes Tab (main entry)
// ---------------------------------------------------------------------------

export function renderRoutesTab(): void {
  const ls = getLogisticsState();
  if (!ls.overlay || !ls.state) return;

  const wrapper = document.createElement('div');
  wrapper.className = 'logistics-routes-content';

  // --- Route map with zoom controls -------------------------------------
  const mapShell = document.createElement('div');
  mapShell.className = 'logistics-route-map-shell';

  const mapContainer = document.createElement('div');
  mapContainer.className = 'logistics-route-map-container';
  const svg = renderRouteMap();
  mapContainer.appendChild(svg);
  mapShell.appendChild(mapContainer);

  // Zoom / pan controls — vertical strip to the right of the map.
  mapShell.appendChild(_renderMapZoomControls(svg));

  wrapper.appendChild(mapShell);

  // --- Create Route button (always visible below the map) ---
  if (!ls.builderMode) {
    const createBtn = document.createElement('button');
    createBtn.className = 'logistics-builder-create-btn';
    createBtn.textContent = '+ Create Route';
    _addTracked(createBtn, 'click', () => {
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

  // Re-apply the persistent selection class (if any) to the freshly-built
  // rows and map paths so the player's selection survives re-renders.
  refreshRouteSelection();
}

// ---------------------------------------------------------------------------
// Route-map zoom / pan controls
// ---------------------------------------------------------------------------

const MAP_ZOOM_MIN = 0.4;
const MAP_ZOOM_MAX = 4;
const MAP_ZOOM_STEP = 0.1;

/**
 * Build the vertical zoom+pan control strip that sits alongside the route
 * map.  Slider is wired directly to the SVG's viewport transform so the
 * zoom change is smooth — no full re-render per tick.
 */
function _renderMapZoomControls(svg: SVGSVGElement): HTMLDivElement {
  const controls = document.createElement('div');
  controls.className = 'logistics-map-controls';

  // Apply current zoom/pan to the viewport + text counter-scale to every
  // fixed-size label.  Called on every zoom control change.
  const applyTransform = (): void => {
    applyMapZoomTransforms(svg);
  };

  const label = document.createElement('span');
  label.className = 'logistics-map-control-label';
  label.textContent = 'Zoom';
  controls.appendChild(label);

  const zoomInBtn = document.createElement('button');
  zoomInBtn.type = 'button';
  zoomInBtn.className = 'logistics-map-zoom-btn';
  zoomInBtn.textContent = '+';
  zoomInBtn.title = 'Zoom in';
  _addTracked(zoomInBtn, 'click', () => {
    const ls = getLogisticsState();
    ls.routeMapZoom = Math.min(MAP_ZOOM_MAX, ls.routeMapZoom + MAP_ZOOM_STEP);
    slider.value = String(ls.routeMapZoom);
    readout.textContent = `${Math.round(ls.routeMapZoom * 100)}%`;
    applyTransform();
  });
  controls.appendChild(zoomInBtn);

  // Vertical slider (rotated via CSS).
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(MAP_ZOOM_MIN);
  slider.max = String(MAP_ZOOM_MAX);
  slider.step = String(MAP_ZOOM_STEP);
  slider.value = String(getLogisticsState().routeMapZoom);
  slider.className = 'logistics-map-zoom-slider';
  slider.setAttribute('aria-label', 'Route map zoom');
  _addTracked(slider, 'input', () => {
    const ls = getLogisticsState();
    ls.routeMapZoom = parseFloat(slider.value);
    readout.textContent = `${Math.round(ls.routeMapZoom * 100)}%`;
    applyTransform();
  });
  controls.appendChild(slider);

  const zoomOutBtn = document.createElement('button');
  zoomOutBtn.type = 'button';
  zoomOutBtn.className = 'logistics-map-zoom-btn';
  zoomOutBtn.textContent = '−';
  zoomOutBtn.title = 'Zoom out';
  _addTracked(zoomOutBtn, 'click', () => {
    const ls = getLogisticsState();
    ls.routeMapZoom = Math.max(MAP_ZOOM_MIN, ls.routeMapZoom - MAP_ZOOM_STEP);
    slider.value = String(ls.routeMapZoom);
    readout.textContent = `${Math.round(ls.routeMapZoom * 100)}%`;
    applyTransform();
  });
  controls.appendChild(zoomOutBtn);

  const readout = document.createElement('span');
  readout.className = 'logistics-map-zoom-readout';
  readout.textContent = `${Math.round(getLogisticsState().routeMapZoom * 100)}%`;
  controls.appendChild(readout);

  const recenterBtn = document.createElement('button');
  recenterBtn.type = 'button';
  recenterBtn.className = 'logistics-map-recenter-btn';
  recenterBtn.textContent = 'Reset';
  recenterBtn.title = 'Recenter and reset zoom';
  _addTracked(recenterBtn, 'click', () => {
    const ls = getLogisticsState();
    ls.routeMapZoom = 1;
    ls.routeMapPanX = 0;
    ls.routeMapPanY = 0;
    slider.value = '1';
    readout.textContent = '100%';
    applyTransform();
  });
  controls.appendChild(recenterBtn);

  // Scroll-wheel zoom over the map itself — more comfortable than the slider.
  _addTracked(svg, 'wheel', ((e: WheelEvent) => {
    e.preventDefault();
    const ls = getLogisticsState();
    const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
    ls.routeMapZoom = Math.max(MAP_ZOOM_MIN, Math.min(MAP_ZOOM_MAX, ls.routeMapZoom * factor));
    slider.value = String(ls.routeMapZoom);
    readout.textContent = `${Math.round(ls.routeMapZoom * 100)}%`;
    applyTransform();
  }) as EventListener, { passive: false });

  return controls;
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
    tr.style.cursor = 'pointer';

    // Cross-highlight: hovering a row brightens the matching map route,
    // and hovering the map route brightens the row (wired by _routeMap).
    const rowRouteId = route.id;
    _addTracked(tr, 'mouseenter', () => { _setRouteHover(rowRouteId); });
    _addTracked(tr, 'mouseleave', () => { _setRouteHover(null); });

    // Click toggles persistent selection — highlights on map + row;
    // clicking the same route again deselects.  Guard against clicks on
    // the expand-legs button (it has its own handler) by checking target.
    _addTracked(tr, 'click', (e: Event) => {
      const t = e.target as HTMLElement;
      if (t.closest('button') != null) return; // let expand button handle itself
      toggleRouteSelection(rowRouteId);
    });

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
    _addTracked(expandBtn, 'click', () => {
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
    _addTracked(btn, 'click', () => {
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
        tdRoute.textContent = `${formatLocation(leg.origin, ls.state?.hubs)} \u2192 ${formatLocation(leg.destination, ls.state?.hubs)}`;
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
        _addTracked(minusBtn, 'click', () => {
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
        _addTracked(plusBtn, 'click', () => {
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
  const ls = getLogisticsState();
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
    originSpan.textContent = formatLocation(leg.origin, ls.state?.hubs);
    routeEl.appendChild(originSpan);

    const arrowSpan = document.createElement('span');
    arrowSpan.className = 'logistics-proven-leg-arrow';
    arrowSpan.textContent = '\u2192';
    routeEl.appendChild(arrowSpan);

    const destSpan = document.createElement('span');
    destSpan.textContent = formatLocation(leg.destination, ls.state?.hubs);
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

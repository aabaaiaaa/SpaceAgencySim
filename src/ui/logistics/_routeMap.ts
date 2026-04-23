/**
 * _routeMap.ts -- Route map SVG rendering for the Logistics Center.
 *
 * Renders a schematic SVG solar-system map showing celestial bodies,
 * proven leg dashed lines, and active route solid lines.  Also exports
 * small helpers (`getBodyColor` re-export, `formatLocation`) consumed
 * by sibling modules.  Geometry and colors delegate to core/mapGeometry.
 *
 * @module ui/logistics/_routeMap
 */

import type { RouteLocation } from '../../core/gameState.ts';
import type { Hub } from '../../core/hubTypes.ts';
import { getHubsOnBody } from '../../core/hubs.ts';
import { EARTH_HUB_ID } from '../../core/constants.ts';
import { bezierControlPoint, getBodyColorHex, ROUTE_STATUS_COLORS } from '../../core/mapGeometry.ts';
import {
  getLogisticsState,
  triggerRender,
} from './_state.ts';
import { computeSchematicLayout, getSchematicWidth } from './_schematicLayout.ts';
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
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Re-export getBodyColorHex as getBodyColor for backward compatibility.
 * Previously read CSS custom properties; now delegates to the shared
 * mapGeometry module which has the canonical color map.
 */
export { getBodyColorHex as getBodyColor } from '../../core/mapGeometry.ts';

/**
 * Format a RouteLocation for display.
 * E.g. `"MOON (surface)"` or `"MARS (orbit, 200km)"`.
 * When `hubs` is provided and the location has a `hubId`, the hub name
 * is prepended: `"Apollo Outpost (Moon, surface)"`.
 */
export function formatLocation(
  loc: RouteLocation,
  hubs?: { id: string; name: string }[],
): string {
  const locDetail =
    loc.locationType === 'orbit' && loc.altitude !== undefined
      ? `orbit, ${loc.altitude}km`
      : loc.locationType;

  if (loc.hubId && hubs) {
    const hub = hubs.find(h => h.id === loc.hubId);
    if (hub) {
      return `${hub.name} (${loc.bodyId}, ${locDetail})`;
    }
  }

  return `${loc.bodyId} (${locDetail})`;
}

// ---------------------------------------------------------------------------
// Bezier path helper (delegates to shared mapGeometry)
// ---------------------------------------------------------------------------

/**
 * Build an SVG quadratic Bézier path string using the shared control-point
 * computation.  Falls back to a straight line when the endpoints coincide.
 */
function bezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
  legIndex: number,
): string {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return `M ${x1},${y1} L ${x2},${y2}`;
  const { cx, cy } = bezierControlPoint(x1, y1, x2, y2, legIndex);
  return `M ${x1},${y1} Q ${cx},${cy} ${x2},${y2}`;
}

// ---------------------------------------------------------------------------
// Route Map SVG
// ---------------------------------------------------------------------------

/**
 * Build an SVG schematic of the solar system showing bodies that are
 * relevant to the player's logistics network (mining sites, route
 * endpoints) plus Earth which is always visible.
 */
export function renderRouteMap(): SVGSVGElement {
  const ls = getLogisticsState();
  const layout = computeSchematicLayout(ls.state);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('class', 'logistics-route-map');

  // Dynamic viewBox based on computed layout width.  The SVG fills the
  // parent container (width: 100%) so the schematic scales to whatever
  // space the logistics tab has.  Zoom + pan are applied via a group
  // transform so the viewBox stays constant — simpler hit-testing and
  // predictable pan bounds.
  const computedWidth = Math.max(getSchematicWidth(layout), 800);
  const svgHeight = 480;
  svg.setAttribute('viewBox', `0 0 ${computedWidth} ${svgHeight}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', `${svgHeight}px`);
  svg.style.touchAction = 'none';

  // Determine which bodies to show (needed BEFORE the viewport transform
  // because the content-centre calculation depends on visible nodes).
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

  // Compute the visible-content bounding box so we can centre it inside
  // the viewBox — the schematic layout anchors bodies along the left
  // edge, which leaves empty space on the right and makes zoom appear to
  // fly content off-screen.  We translate the content centroid to the
  // viewBox centre, and zoom is anchored on that centroid.
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  for (const [bodyId, node] of layout) {
    if (node.type === 'surfaceHub' || node.type === 'orbitalHub') {
      if (!node.parentId || !visibleBodies.has(node.parentId)) continue;
    } else if (!visibleBodies.has(bodyId)) {
      continue;
    }
    minX = Math.min(minX, node.x - node.radius);
    maxX = Math.max(maxX, node.x + node.radius);
    minY = Math.min(minY, node.y - node.radius);
    maxY = Math.max(maxY, node.y + node.radius);
  }
  if (!isFinite(minX)) {
    // No visible nodes — fall back to viewBox centre.
    minX = 0; maxX = computedWidth; minY = 0; maxY = svgHeight;
  }
  const contentCx = (minX + maxX) / 2;
  const contentCy = (minY + maxY) / 2;

  // Transform group — all content goes inside `viewport` so we can
  // translate + scale without redrawing.
  const zoom = ls.routeMapZoom;
  const panX = ls.routeMapPanX;
  const panY = ls.routeMapPanY;
  const cx = computedWidth / 2;
  const cy = svgHeight / 2;
  // Centre content + zoom around the content centroid:
  //   translate(viewBoxCentre + pan)  →  place centroid at viewBox centre
  //   scale(zoom)                     →  zoom around that centroid
  //   translate(-contentCentre)       →  source offset so content arrives centred
  const viewport = document.createElementNS(svgNS, 'g');
  viewport.setAttribute(
    'transform',
    `translate(${cx + panX}, ${cy + panY}) scale(${zoom}) translate(${-contentCx}, ${-contentCy})`,
  );
  // Stash the content centre so applyMapZoomTransforms() can re-apply the
  // same centred transform on zoom / pan changes without re-rendering.
  svg.setAttribute('data-content-cx', String(contentCx));
  svg.setAttribute('data-content-cy', String(contentCy));
  svg.appendChild(viewport);

  // Drag-to-pan: track pointer on the SVG, translate in viewBox units
  // (SVG auto-scales screen → viewBox via preserveAspectRatio).
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragPanX0 = 0;
  let dragPanY0 = 0;
  _addTracked(svg, 'pointerdown', ((e: PointerEvent) => {
    // Only start a pan on empty-background clicks — clicking a body /
    // hub / leg path should still fire their own click handlers.
    const t = e.target as SVGElement;
    if (t !== svg && t !== viewport) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    const cur = getLogisticsState();
    dragPanX0 = cur.routeMapPanX;
    dragPanY0 = cur.routeMapPanY;
    (svg as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId);
    svg.style.cursor = 'grabbing';
  }) as EventListener);
  _addTracked(svg, 'pointermove', ((e: PointerEvent) => {
    if (!dragging) return;
    const rect = svg.getBoundingClientRect();
    const scaleScreenToViewbox = computedWidth / rect.width;
    const dx = (e.clientX - dragStartX) * scaleScreenToViewbox;
    const dy = (e.clientY - dragStartY) * scaleScreenToViewbox;
    const cur = getLogisticsState();
    cur.routeMapPanX = dragPanX0 + dx;
    cur.routeMapPanY = dragPanY0 + dy;
    // Apply without a full re-render for smoothness.
    const z = cur.routeMapZoom;
    viewport.setAttribute(
      'transform',
      `translate(${cx + cur.routeMapPanX}, ${cy + cur.routeMapPanY}) scale(${z}) translate(${-contentCx}, ${-contentCy})`,
    );
  }) as EventListener);
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    try {
      (svg as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }
    svg.style.cursor = 'grab';
  };
  _addTracked(svg, 'pointerup', endDrag as EventListener);
  _addTracked(svg, 'pointercancel', endDrag as EventListener);
  svg.style.cursor = 'grab';

  // Render visible bodies.  Each body is wrapped in a group that carries
  // a `translate + scale(1/zoom)` transform so the CIRCLE stays at a
  // constant screen size while the viewport's `scale(zoom)` spreads its
  // POSITION across the map.  `data-mx/data-my` hold the unscaled centre
  // so applyMapZoomTransforms() can re-compute the counter-scale on zoom
  // changes without a full re-render.
  for (const [bodyId, node] of layout) {
    if (!visibleBodies.has(bodyId)) continue;

    const bodyGroup = document.createElementNS(svgNS, 'g');
    bodyGroup.setAttribute('data-mx', String(node.x));
    bodyGroup.setAttribute('data-my', String(node.y));
    bodyGroup.setAttribute('transform', `translate(${node.x}, ${node.y}) scale(${1 / zoom})`);
    bodyGroup.setAttribute('class', 'map-node-fixed');

    // Circle drawn in LOCAL coords (centre at 0,0) so the group's
    // transform fully places and sizes it.
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', '0');
    circle.setAttribute('cy', '0');
    circle.setAttribute('r', String(node.radius));
    circle.setAttribute('class', `body-node body-${bodyId.toLowerCase()}`);
    circle.setAttribute('fill', getBodyColorHex(bodyId));
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
      _addTracked(circle, 'click', ((e: Event) => {
        const currentLs = getLogisticsState();
        // Only allow setting origin if no legs have been added yet
        if (currentLs.builderLegs.length === 0) {
          currentLs.builderCurrentBodyId = clickBodyId;

          // Check how many hubs exist on this body
          if (currentLs.state) {
            const hubs = getHubsOnBody(currentLs.state, clickBodyId);
            // Include Earth hub for EARTH body
            const earthHub = clickBodyId === 'EARTH'
              ? currentLs.state.hubs.find(h => h.id === EARTH_HUB_ID)
              : undefined;
            const allHubs = earthHub && !hubs.some(h => h.id === EARTH_HUB_ID)
              ? [earthHub, ...hubs]
              : hubs;

            if (allHubs.length === 0) {
              // No hubs on this body — body-level endpoint
              currentLs.builderOriginHubId = null;
            } else if (allHubs.length === 1) {
              // Single hub — auto-select it
              currentLs.builderOriginHubId = allHubs[0].id;
            } else {
              // Multiple hubs — show a popover for selection
              _showHubPopover(e as MouseEvent, allHubs, clickBodyId);
              return; // Don't re-render yet; popover handles selection
            }
          } else {
            currentLs.builderOriginHubId = null;
          }

          triggerRender();
        }
      }) as EventListener);
    }

    bodyGroup.appendChild(circle);
    viewport.appendChild(bodyGroup);

    // Label below the body.
    // Text position stored as data-mx/data-my; the transform is what
    // actually places it.  The transform includes a counter-scale so the
    // label stays at a constant screen size regardless of zoom.  The
    // counter-scale is re-applied by _applyMapZoomTransforms() whenever
    // zoom changes.
    const label = document.createElementNS(svgNS, 'text');
    const lx = node.x;
    const ly = node.y + node.radius + 16;
    label.setAttribute('data-mx', String(lx));
    label.setAttribute('data-my', String(ly));
    label.setAttribute('transform', `translate(${lx}, ${ly}) scale(${1 / zoom})`);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'body-label map-label-fixed');
    label.setAttribute('fill', '#ccc');
    label.setAttribute('font-size', '11');
    label.textContent = node.label;
    viewport.appendChild(label);
  }

  // --- Hub nodes ---
  for (const [, node] of layout) {
    if (node.type !== 'surfaceHub' && node.type !== 'orbitalHub') continue;

    const parentNode = node.parentId ? layout.get(node.parentId) : null;
    const bodyColor = getBodyColorHex(node.parentId ?? '');

    // Hub status: online / under-construction / offline
    const hub = ls.state?.hubs.find(h => h.id === node.hubId);
    let opacity = '1';
    let dashArray = 'none';
    if (hub) {
      const isBuilding = hub.constructionQueue.some(p => p.completedPeriod === undefined);
      if (!hub.online && !isBuilding) { opacity = '0.4'; dashArray = '2,2'; }
      else if (!hub.online && isBuilding) { opacity = '0.6'; dashArray = '2,2'; }
    }

    // Connecting line to parent body
    if (parentNode) {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(parentNode.x));
      line.setAttribute('y1', String(parentNode.y));
      line.setAttribute('x2', String(node.x));
      line.setAttribute('y2', String(node.y));
      line.setAttribute('stroke', bodyColor);
      line.setAttribute('stroke-width', '1');
      line.setAttribute('vector-effect', 'non-scaling-stroke');
      line.setAttribute('opacity', '0.6');
      if (node.type === 'orbitalHub') {
        line.setAttribute('stroke-dasharray', '3,2');
      }
      viewport.appendChild(line);
    }

    // Hub icon — same counter-scale wrapper pattern as body circles so
    // the icon stays constant size while its position rides the viewport
    // zoom.  Local coords inside the group are centred at (0, 0); the
    // group's transform does both the positioning and the 1/zoom scale.
    const hubGroup = document.createElementNS(svgNS, 'g');
    hubGroup.setAttribute('data-mx', String(node.x));
    hubGroup.setAttribute('data-my', String(node.y));
    const orbitalRotate = node.type === 'orbitalHub' ? ' rotate(45)' : '';
    hubGroup.setAttribute(
      'transform',
      `translate(${node.x}, ${node.y}) scale(${1 / zoom})${orbitalRotate}`,
    );
    hubGroup.setAttribute('class', 'map-node-fixed');
    if (node.type === 'orbitalHub') hubGroup.setAttribute('data-orbital', '1');

    if (node.type === 'surfaceHub') {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', '-3');
      rect.setAttribute('y', '-3');
      rect.setAttribute('width', '6');
      rect.setAttribute('height', '6');
      rect.setAttribute('fill', bodyColor);
      rect.setAttribute('stroke', bodyColor);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('opacity', opacity);
      if (dashArray !== 'none') rect.setAttribute('stroke-dasharray', dashArray);
      rect.style.cursor = 'pointer';
      rect.setAttribute('data-hub-id', node.hubId ?? '');

      // Builder mode: highlight selected hub, add click handler
      if (ls.builderMode && node.hubId) {
        if (ls.builderOriginHubId === node.hubId) {
          rect.setAttribute('stroke', '#FFD700');
          rect.setAttribute('stroke-width', '2');
        }
        const clickHubId = node.hubId;
        const clickBodyId = node.parentId ?? '';
        _addTracked(rect, 'click', ((e: Event) => {
          e.stopPropagation();
          const currentLs = getLogisticsState();
          if (currentLs.builderLegs.length === 0) {
            currentLs.builderCurrentBodyId = clickBodyId;
            currentLs.builderOriginHubId = clickHubId;
            triggerRender();
          }
        }) as EventListener);
      }

      hubGroup.appendChild(rect);
      viewport.appendChild(hubGroup);
    } else {
      // orbitalHub — diamond shape (rotated square).  The outer group
      // already includes a rotate(45) so the inner rect is axis-aligned.
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', '-4');
      rect.setAttribute('y', '-4');
      rect.setAttribute('width', '8');
      rect.setAttribute('height', '8');
      rect.setAttribute('fill', bodyColor);
      rect.setAttribute('stroke', bodyColor);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('opacity', opacity);
      if (dashArray !== 'none') rect.setAttribute('stroke-dasharray', dashArray);
      rect.style.cursor = 'pointer';
      rect.setAttribute('data-hub-id', node.hubId ?? '');

      // Builder mode: highlight selected hub, add click handler
      if (ls.builderMode && node.hubId) {
        if (ls.builderOriginHubId === node.hubId) {
          rect.setAttribute('stroke', '#FFD700');
          rect.setAttribute('stroke-width', '2');
        }
        const clickHubId = node.hubId;
        const clickBodyId = node.parentId ?? '';
        _addTracked(rect, 'click', ((e: Event) => {
          e.stopPropagation();
          const currentLs = getLogisticsState();
          if (currentLs.builderLegs.length === 0) {
            currentLs.builderCurrentBodyId = clickBodyId;
            currentLs.builderOriginHubId = clickHubId;
            triggerRender();
          }
        }) as EventListener);
      }

      hubGroup.appendChild(rect);
      viewport.appendChild(hubGroup);
    }

    // Hub name label — counter-scaled so it stays readable at any zoom.
    const hubLabel = document.createElementNS(svgNS, 'text');
    const hx = node.x;
    const hy = node.y + (node.type === 'surfaceHub' ? 14 : 16);
    hubLabel.setAttribute('data-mx', String(hx));
    hubLabel.setAttribute('data-my', String(hy));
    hubLabel.setAttribute('transform', `translate(${hx}, ${hy}) scale(${1 / zoom})`);
    hubLabel.setAttribute('text-anchor', 'middle');
    hubLabel.setAttribute('class', 'map-label-fixed');
    hubLabel.setAttribute('fill', '#aaa');
    hubLabel.setAttribute('font-size', '8');
    hubLabel.setAttribute('opacity', opacity);
    hubLabel.textContent = node.label;
    viewport.appendChild(hubLabel);
  }

  // --- Proven leg Bezier curves ---
  if (ls.state) {
    let provenIndex = 0;
    for (const leg of ls.state.provenLegs) {
      const originPos = layout.get(leg.origin.bodyId);
      const destPos = layout.get(leg.destination.bodyId);
      if (!originPos || !destPos) continue;

      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', bezierPath(originPos.x, originPos.y, destPos.x, destPos.y, provenIndex));
      path.setAttribute('fill', 'none');
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      path.setAttribute('id', `route-leg-proven-${provenIndex}`);
      path.setAttribute('class', 'proven-leg-line');

      const isOutbound = ls.builderMode && ls.builderCurrentBodyId != null
        && leg.origin.bodyId === ls.builderCurrentBodyId;

      if (ls.builderMode && ls.builderCurrentBodyId != null) {
        if (isOutbound) {
          // Highlight outbound legs: solid line, bright color, clickable
          path.setAttribute('stroke', '#64B4FF');
          path.setAttribute('stroke-width', '2.5');
          // No dash -- solid line to distinguish from non-outbound
          path.style.cursor = 'pointer';

          const legId = leg.id;
          const destBodyId = leg.destination.bodyId;
          _addTracked(path, 'click', () => {
            const currentLs = getLogisticsState();
            currentLs.builderLegs.push(legId);
            currentLs.builderCurrentBodyId = destBodyId;
            triggerRender();
          });
        } else {
          // Fade non-outbound legs
          path.setAttribute('stroke', '#888');
          path.setAttribute('stroke-width', '1.5');
          path.setAttribute('stroke-dasharray', '6 4');
          path.setAttribute('opacity', '0.2');
          path.style.cursor = 'default';
        }
      } else {
        // Normal (non-builder) mode
        path.setAttribute('stroke', '#888');
        path.setAttribute('stroke-width', '1.5');
        path.setAttribute('stroke-dasharray', '6 4');
        path.style.cursor = 'pointer';
      }

      // Tooltip on hover
      const titleEl = document.createElementNS(svgNS, 'title');
      titleEl.textContent = `Craft: ${leg.craftDesignId}\nCapacity: ${leg.cargoCapacityKg} kg\nCost/Run: $${leg.costPerRun.toLocaleString()}`;
      path.appendChild(titleEl);

      viewport.appendChild(path);
      provenIndex++;
    }

    // --- Active route Bezier curves ---
    let activeLegCounter = 0;
    for (const route of ls.state.routes) {
      const routeIndex = ls.state.routes.indexOf(route);
      for (const leg of route.legs) {
        const originPos = layout.get(leg.origin.bodyId);
        const destPos = layout.get(leg.destination.bodyId);
        if (!originPos || !destPos) continue;

        const legIndex = route.legs.indexOf(leg);
        const path = document.createElementNS(svgNS, 'path');
        path.setAttribute('d', bezierPath(originPos.x, originPos.y, destPos.x, destPos.y, activeLegCounter));
        path.setAttribute('fill', 'none');
        path.setAttribute('vector-effect', 'non-scaling-stroke');
        path.setAttribute('id', `route-leg-active-${routeIndex}-${legIndex}`);
        path.setAttribute('data-route-id', route.id);
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('class', `route-line route-${route.status}`);
        path.style.cursor = 'pointer';

        // Color by status — use shared ROUTE_STATUS_COLORS
        const statusKey = route.status as keyof typeof ROUTE_STATUS_COLORS;
        const statusColor = ROUTE_STATUS_COLORS[statusKey] ?? ROUTE_STATUS_COLORS.active;
        path.setAttribute('stroke', statusColor.hex);
        if (route.status === 'paused') {
          path.setAttribute('opacity', '0.4');
        }

        // Cross-highlight: hovering a map path brightens every other leg
        // of the same route and the matching table row.
        const routeId = route.id;
        _addTracked(path, 'pointerenter', () => { setRouteHover(routeId); });
        _addTracked(path, 'pointerleave', () => { setRouteHover(null); });

        // Click toggles the persistent selection.  Clicking a different
        // route switches to it; clicking the same route clears.  When
        // selecting, scroll the table row into view for convenience.
        _addTracked(path, 'click', () => {
          const wasSelected = getLogisticsState().selectedRouteId === routeId;
          toggleRouteSelection(routeId);
          if (!wasSelected) {
            const overlay = getLogisticsState().overlay;
            const tableRow = overlay?.querySelector(`tr[data-route-id="${CSS.escape(routeId)}"]`);
            tableRow?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });

        viewport.appendChild(path);

        // Animated flow dots on active routes
        if (route.status === 'active') {
          const pathD = bezierPath(originPos.x, originPos.y, destPos.x, destPos.y, activeLegCounter);
          for (let dotIdx = 0; dotIdx < 3; dotIdx++) {
            const dot = document.createElementNS(svgNS, 'circle');
            dot.setAttribute('r', '2.5');
            dot.setAttribute('fill', '#64B4FF');
            dot.setAttribute('class', 'flow-dot');
            dot.setAttribute('style', `offset-path: path('${pathD}'); animation-delay: ${dotIdx}s;`);
            viewport.appendChild(dot);
          }
        }

        activeLegCounter++;
      }
    }
  }

  return svg;
}

// ---------------------------------------------------------------------------
// Hub selection popover (builder mode)
// ---------------------------------------------------------------------------

/** Currently open hub popover element, if any. */
let _activeHubPopover: HTMLDivElement | null = null;

/**
 * Dismiss any active hub selection popover.
 */
function _dismissHubPopover(): void {
  if (_activeHubPopover) {
    _activeHubPopover.remove();
    _activeHubPopover = null;
  }
}

/**
 * Show a small popover near the click position listing hub names on a body.
 * Each hub name is a button the player clicks to select as the builder origin.
 * Also includes a "No hub (body-level)" option to select the body without a hub.
 */
function _showHubPopover(
  event: MouseEvent,
  hubs: Hub[],
  bodyId: string,
): void {
  _dismissHubPopover();

  const ls = getLogisticsState();
  const overlay = ls.overlay;
  if (!overlay) return;

  const popover = document.createElement('div');
  popover.className = 'logistics-hub-popover';
  popover.style.position = 'absolute';
  popover.style.zIndex = '1000';

  // Position near the click, relative to the overlay
  const overlayRect = overlay.getBoundingClientRect();
  const x = event.clientX - overlayRect.left + 10;
  const y = event.clientY - overlayRect.top - 10;
  popover.style.left = `${x}px`;
  popover.style.top = `${y}px`;
  popover.style.background = '#1a1a2e';
  popover.style.border = '1px solid #444';
  popover.style.borderRadius = '4px';
  popover.style.padding = '4px 0';
  popover.style.minWidth = '120px';
  popover.style.boxShadow = '0 2px 8px rgba(0,0,0,0.5)';

  const heading = document.createElement('div');
  heading.style.padding = '4px 8px';
  heading.style.color = '#aaa';
  heading.style.fontSize = '10px';
  heading.style.borderBottom = '1px solid #333';
  heading.textContent = 'Select hub:';
  popover.appendChild(heading);

  for (const hub of hubs) {
    const btn = document.createElement('button');
    btn.className = 'logistics-hub-popover-btn';
    btn.style.display = 'block';
    btn.style.width = '100%';
    btn.style.padding = '4px 8px';
    btn.style.textAlign = 'left';
    btn.style.background = 'transparent';
    btn.style.border = 'none';
    btn.style.color = '#ccc';
    btn.style.cursor = 'pointer';
    btn.style.fontSize = '11px';
    btn.textContent = `${hub.name} (${hub.type})`;
    const hubId = hub.id;
    _addTracked(btn, 'mouseenter', () => { btn.style.background = '#2a2a4a'; });
    _addTracked(btn, 'mouseleave', () => { btn.style.background = 'transparent'; });
    _addTracked(btn, 'click', () => {
      const currentLs = getLogisticsState();
      currentLs.builderCurrentBodyId = bodyId;
      currentLs.builderOriginHubId = hubId;
      _dismissHubPopover();
      triggerRender();
    });
    popover.appendChild(btn);
  }

  // "No hub" option for body-level endpoint
  const noHubBtn = document.createElement('button');
  noHubBtn.className = 'logistics-hub-popover-btn';
  noHubBtn.style.display = 'block';
  noHubBtn.style.width = '100%';
  noHubBtn.style.padding = '4px 8px';
  noHubBtn.style.textAlign = 'left';
  noHubBtn.style.background = 'transparent';
  noHubBtn.style.border = 'none';
  noHubBtn.style.color = '#888';
  noHubBtn.style.cursor = 'pointer';
  noHubBtn.style.fontSize = '11px';
  noHubBtn.style.fontStyle = 'italic';
  noHubBtn.textContent = 'No hub (body-level)';
  _addTracked(noHubBtn, 'mouseenter', () => { noHubBtn.style.background = '#2a2a4a'; });
  _addTracked(noHubBtn, 'mouseleave', () => { noHubBtn.style.background = 'transparent'; });
  _addTracked(noHubBtn, 'click', () => {
    const currentLs = getLogisticsState();
    currentLs.builderCurrentBodyId = bodyId;
    currentLs.builderOriginHubId = null;
    _dismissHubPopover();
    triggerRender();
  });
  popover.appendChild(noHubBtn);

  overlay.appendChild(popover);
  _activeHubPopover = popover;

  // Dismiss when clicking outside the popover
  const dismissOnOutsideClick = (ev: MouseEvent) => {
    if (!popover.contains(ev.target as Node)) {
      _dismissHubPopover();
      document.removeEventListener('click', dismissOnOutsideClick, true);
    }
  };
  // Defer to avoid the current click event from immediately dismissing.
  // Tracked so a panel teardown mid-popover cleans it up; the explicit
  // removeEventListener in dismissOnOutsideClick still handles normal
  // dismissal.
  requestAnimationFrame(() => {
    _addTracked(document, 'click', dismissOnOutsideClick as EventListener, true);
  });
}

/**
 * Public helper to show a hub popover. Exported for use by _routeBuilder.ts.
 */
export { _showHubPopover as showHubPopover };

// ---------------------------------------------------------------------------
// Route cross-highlight (hover)
// ---------------------------------------------------------------------------

/**
 * Apply or clear the hover-highlight on both the map leg paths and the
 * matching table row.  `null` clears any existing hover state.
 *
 * Uses the `.route-hover` class — distinct from the persistent
 * `.route-highlighted` click-state used by click-on-path so the two
 * behaviours don't fight.
 */
export function setRouteHover(routeId: string | null): void {
  const overlay = getLogisticsState().overlay;
  if (!overlay) return;

  // Clear previous hover on both map paths and the table.
  overlay.querySelectorAll('.route-hover').forEach((el) => {
    el.classList.remove('route-hover');
  });

  if (!routeId) return;

  const selector = `[data-route-id="${CSS.escape(routeId)}"]`;
  overlay.querySelectorAll(selector).forEach((el) => {
    el.classList.add('route-hover');
  });
}

// ---------------------------------------------------------------------------
// Route click-selection (persistent toggle)
// ---------------------------------------------------------------------------

/**
 * Apply the `.route-highlighted` selection class to every element —
 * both map leg paths and table rows — matching the current
 * `state.selectedRouteId`.  Called after every render so selection
 * survives re-renders (tab switches, route-table updates, etc.).
 */
function _applySelectionClass(): void {
  const overlay = getLogisticsState().overlay;
  if (!overlay) return;
  const id = getLogisticsState().selectedRouteId;

  overlay.querySelectorAll('.route-highlighted').forEach((el) => {
    el.classList.remove('route-highlighted');
  });

  if (!id) return;
  const selector = `[data-route-id="${CSS.escape(id)}"]`;
  overlay.querySelectorAll(selector).forEach((el) => {
    el.classList.add('route-highlighted');
  });
}

/**
 * Toggle persistent selection on a route.  Clicking the same route again
 * clears the selection (second click === deselect).  Both map leg paths
 * and the matching table row receive/lose the `.route-highlighted` class.
 */
export function toggleRouteSelection(routeId: string): void {
  const ls = getLogisticsState();
  ls.selectedRouteId = ls.selectedRouteId === routeId ? null : routeId;
  _applySelectionClass();
}

/**
 * Re-apply selection highlights to the currently rendered elements.
 * Called by the routes-tab renderer after building fresh DOM so the
 * persistent selection survives a re-render.
 */
export function refreshRouteSelection(): void {
  _applySelectionClass();
}

/**
 * Re-apply the zoom/pan transforms to the map SVG without a full re-render.
 *
 * Bodies, hub icons, and leg paths ride the viewport's `scale(zoom)` so they
 * zoom normally — positions spread out, detail becomes visible.  Text
 * labels carry a counter-scale `scale(1/zoom)` on their own transform so
 * they stay at a constant screen size regardless of zoom.  This helper
 * updates those per-label transforms, and the viewport's global transform,
 * in place.
 */
export function applyMapZoomTransforms(svg: SVGSVGElement): void {
  const ls = getLogisticsState();
  const viewport = svg.firstElementChild as SVGGElement | null;
  if (!viewport) return;

  const viewBox = svg.getAttribute('viewBox')?.split(' ') ?? ['0', '0', '800', '480'];
  const w = parseFloat(viewBox[2]);
  const h = parseFloat(viewBox[3]);
  const cx = w / 2;
  const cy = h / 2;
  const z = ls.routeMapZoom;

  // Content centre is stashed on the svg at render time.  Fall back to
  // viewBox centre if for some reason the data-attrs are missing.
  const contentCx = parseFloat(svg.getAttribute('data-content-cx') ?? String(cx));
  const contentCy = parseFloat(svg.getAttribute('data-content-cy') ?? String(cy));

  viewport.setAttribute(
    'transform',
    `translate(${cx + ls.routeMapPanX}, ${cy + ls.routeMapPanY}) scale(${z}) translate(${-contentCx}, ${-contentCy})`,
  );

  // Counter-scale every fixed-size label so text stays one screen size.
  const labels = viewport.querySelectorAll('text.map-label-fixed');
  for (const node of labels) {
    const el = node as SVGTextElement;
    const mx = parseFloat(el.getAttribute('data-mx') ?? '0');
    const my = parseFloat(el.getAttribute('data-my') ?? '0');
    el.setAttribute('transform', `translate(${mx}, ${my}) scale(${1 / z})`);
  }

  // Counter-scale body-circle and hub-icon groups too, so their visual
  // size stays constant while their centre position rides the viewport
  // zoom.  Orbital-hub groups additionally keep their 45° rotation.
  const fixedNodes = viewport.querySelectorAll('g.map-node-fixed');
  for (const node of fixedNodes) {
    const el = node as SVGGElement;
    const mx = parseFloat(el.getAttribute('data-mx') ?? '0');
    const my = parseFloat(el.getAttribute('data-my') ?? '0');
    const rot = el.getAttribute('data-orbital') === '1' ? ' rotate(45)' : '';
    el.setAttribute('transform', `translate(${mx}, ${my}) scale(${1 / z})${rot}`);
  }
}

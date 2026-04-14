/**
 * _routeMap.ts -- Route map SVG rendering for the Logistics Center.
 *
 * Renders a schematic SVG solar-system map showing celestial bodies,
 * proven leg dashed lines, and active route solid lines.  Also exports
 * small helpers (`getBodyColor`, `formatLocation`) consumed by sibling
 * modules.
 *
 * @module ui/logistics/_routeMap
 */

import type { RouteLocation } from '../../core/gameState.ts';
import type { Hub } from '../../core/hubTypes.ts';
import { getHubsOnBody } from '../../core/hubs.ts';
import { EARTH_HUB_ID } from '../../core/constants.ts';
import {
  getLogisticsState,
  triggerRender,
} from './_state.ts';
import { computeSchematicLayout, getSchematicWidth } from './_schematicLayout.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Return a fill colour for a celestial-body circle on the route map.
 * Reads from CSS custom properties (--body-color-{bodyId}) so that
 * logistics.css is the single source of truth.  Falls back to #888
 * when the DOM is not attached (e.g. unit-test environment).
 */
export function getBodyColor(bodyId: string): string {
  if (typeof document === 'undefined') return '#888';
  const val = getComputedStyle(document.documentElement)
    .getPropertyValue(`--body-color-${bodyId.toLowerCase()}`)
    .trim();
  return val || '#888';
}

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
// Bezier curve helper
// ---------------------------------------------------------------------------

/**
 * Compute a quadratic Bezier path string between two points.
 * The control point is offset perpendicular to the line joining the
 * endpoints, alternating direction based on legIndex for visual clarity.
 */
function bezierPath(
  x1: number, y1: number,
  x2: number, y2: number,
  legIndex: number,
): string {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return `M ${x1},${y1} L ${x2},${y2}`;
  const px = -dy / dist;
  const py = dx / dist;
  const offset = 0.18 * dist;
  const sign = legIndex % 2 === 0 ? 1 : -1;
  const cx = mx + px * offset * sign;
  const cy = my + py * offset * sign;
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

  // Dynamic viewBox based on computed layout width
  const computedWidth = Math.max(getSchematicWidth(layout), 800);
  const svgHeight = 220;
  svg.setAttribute('viewBox', `0 0 ${computedWidth} ${svgHeight}`);
  svg.setAttribute('width', `${computedWidth}px`);
  svg.setAttribute('height', `${svgHeight}px`);

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

  // Render visible bodies
  for (const [bodyId, node] of layout) {
    if (!visibleBodies.has(bodyId)) continue;

    // Circle
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', String(node.x));
    circle.setAttribute('cy', String(node.y));
    circle.setAttribute('r', String(node.radius));
    circle.setAttribute('class', `body-node body-${bodyId.toLowerCase()}`);
    circle.setAttribute('fill', getBodyColor(bodyId));
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
      circle.addEventListener('click', (e: Event) => {
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
      });
    }

    svg.appendChild(circle);

    // Label below
    const label = document.createElementNS(svgNS, 'text');
    label.setAttribute('x', String(node.x));
    label.setAttribute('y', String(node.y + node.radius + 16));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'body-label');
    label.setAttribute('fill', '#ccc');
    label.setAttribute('font-size', '11');
    label.textContent = node.label;
    svg.appendChild(label);
  }

  // --- Hub nodes ---
  for (const [, node] of layout) {
    if (node.type !== 'surfaceHub' && node.type !== 'orbitalHub') continue;

    const parentNode = node.parentId ? layout.get(node.parentId) : null;
    const bodyColor = getBodyColor(node.parentId ?? '');

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
      line.setAttribute('opacity', '0.6');
      if (node.type === 'orbitalHub') {
        line.setAttribute('stroke-dasharray', '3,2');
      }
      svg.appendChild(line);
    }

    // Hub icon
    if (node.type === 'surfaceHub') {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', String(node.x - 3));
      rect.setAttribute('y', String(node.y - 3));
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
        rect.addEventListener('click', (e: Event) => {
          e.stopPropagation();
          const currentLs = getLogisticsState();
          if (currentLs.builderLegs.length === 0) {
            currentLs.builderCurrentBodyId = clickBodyId;
            currentLs.builderOriginHubId = clickHubId;
            triggerRender();
          }
        });
      }

      svg.appendChild(rect);
    } else {
      // orbitalHub — diamond shape (rotated square)
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('x', String(node.x - 4));
      rect.setAttribute('y', String(node.y - 4));
      rect.setAttribute('width', '8');
      rect.setAttribute('height', '8');
      rect.setAttribute('fill', bodyColor);
      rect.setAttribute('stroke', bodyColor);
      rect.setAttribute('stroke-width', '1');
      rect.setAttribute('transform', `rotate(45, ${node.x}, ${node.y})`);
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
        rect.addEventListener('click', (e: Event) => {
          e.stopPropagation();
          const currentLs = getLogisticsState();
          if (currentLs.builderLegs.length === 0) {
            currentLs.builderCurrentBodyId = clickBodyId;
            currentLs.builderOriginHubId = clickHubId;
            triggerRender();
          }
        });
      }

      svg.appendChild(rect);
    }

    // Hub name label
    const hubLabel = document.createElementNS(svgNS, 'text');
    hubLabel.setAttribute('x', String(node.x));
    hubLabel.setAttribute('y', String(node.y + (node.type === 'surfaceHub' ? 14 : 16)));
    hubLabel.setAttribute('text-anchor', 'middle');
    hubLabel.setAttribute('fill', '#aaa');
    hubLabel.setAttribute('font-size', '8');
    hubLabel.setAttribute('opacity', opacity);
    hubLabel.textContent = node.label;
    svg.appendChild(hubLabel);
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
          path.addEventListener('click', () => {
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

      svg.appendChild(path);
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
        path.setAttribute('id', `route-leg-active-${routeIndex}-${legIndex}`);
        path.setAttribute('stroke-width', '2.5');
        path.setAttribute('class', `route-line route-${route.status}`);
        path.style.cursor = 'pointer';

        // Color by status
        if (route.status === 'broken') {
          path.setAttribute('stroke', '#CC3333');
        } else if (route.status === 'paused') {
          path.setAttribute('stroke', 'rgba(100, 180, 255, 0.4)');
        } else {
          path.setAttribute('stroke', '#64B4FF');
        }

        // Click to highlight route in table
        const routeId = route.id;
        path.addEventListener('click', () => {
          const overlay = getLogisticsState().overlay;
          const tableRow = overlay?.querySelector(`tr[data-route-id="${routeId}"]`);
          if (tableRow) {
            // Remove existing highlights
            overlay?.querySelectorAll('tr.route-highlighted').forEach((el) => el.classList.remove('route-highlighted'));
            tableRow.classList.add('route-highlighted');
            tableRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        });

        svg.appendChild(path);

        // Animated flow dots on active routes
        if (route.status === 'active') {
          const pathD = bezierPath(originPos.x, originPos.y, destPos.x, destPos.y, activeLegCounter);
          for (let dotIdx = 0; dotIdx < 3; dotIdx++) {
            const dot = document.createElementNS(svgNS, 'circle');
            dot.setAttribute('r', '2.5');
            dot.setAttribute('fill', '#64B4FF');
            dot.setAttribute('class', 'flow-dot');
            dot.setAttribute('style', `offset-path: path('${pathD}'); animation-delay: ${dotIdx}s;`);
            svg.appendChild(dot);
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
    btn.addEventListener('mouseenter', () => { btn.style.background = '#2a2a4a'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
    btn.addEventListener('click', () => {
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
  noHubBtn.addEventListener('mouseenter', () => { noHubBtn.style.background = '#2a2a4a'; });
  noHubBtn.addEventListener('mouseleave', () => { noHubBtn.style.background = 'transparent'; });
  noHubBtn.addEventListener('click', () => {
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
  // Defer to avoid the current click event from immediately dismissing
  requestAnimationFrame(() => {
    document.addEventListener('click', dismissOnOutsideClick, true);
  });
}

/**
 * Public helper to show a hub popover. Exported for use by _routeBuilder.ts.
 */
export { _showHubPopover as showHubPopover };

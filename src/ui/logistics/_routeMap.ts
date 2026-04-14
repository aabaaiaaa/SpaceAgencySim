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
 */
export function formatLocation(loc: RouteLocation): string {
  if (loc.locationType === 'orbit' && loc.altitude !== undefined) {
    return `${loc.bodyId} (orbit, ${loc.altitude}km)`;
  }
  return `${loc.bodyId} (${loc.locationType})`;
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
    label.setAttribute('x', String(node.x));
    label.setAttribute('y', String(node.y + node.radius + 16));
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'body-label');
    label.setAttribute('fill', '#ccc');
    label.setAttribute('font-size', '11');
    label.textContent = node.label;
    svg.appendChild(label);
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
        activeLegCounter++;
      }
    }
  }

  return svg;
}

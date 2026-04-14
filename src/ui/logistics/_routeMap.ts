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
// Route Map SVG
// ---------------------------------------------------------------------------

/** Schematic body positions (x, y) within the 800x200 viewBox. */
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

/**
 * Build an SVG schematic of the solar system showing bodies that are
 * relevant to the player's logistics network (mining sites, route
 * endpoints) plus Earth which is always visible.
 */
export function renderRouteMap(): SVGSVGElement {
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

  // Render visible bodies
  for (const [bodyId, pos] of Object.entries(bodyPositions)) {
    if (!visibleBodies.has(bodyId)) continue;

    // Circle
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', String(pos.x));
    circle.setAttribute('cy', String(pos.y));
    circle.setAttribute('r', String(pos.radius));
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

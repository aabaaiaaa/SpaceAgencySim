/**
 * _schematicLayout.ts -- Schematic layout computation for the logistics SVG map.
 *
 * Computes positions for celestial bodies (and in the future, hubs) on
 * the schematic solar-system map.  Uses the body hierarchy from
 * src/data/bodies.ts and game state to determine which bodies are visible
 * and where they should be placed.
 *
 * @module ui/logistics/_schematicLayout
 */

import type { GameState } from '../../core/gameState.ts';
import { getBodyDef } from '../../data/bodies.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A positioned node on the schematic map. */
export interface SchematicNode {
  x: number;
  y: number;
  radius: number;
  type: 'body' | 'surfaceHub' | 'orbitalHub';
  /** Parent node ID (e.g. body ID for a hub or moon). */
  parentId?: string;
  /** Hub ID if this node represents a hub. */
  hubId?: string;
  /** Display label. */
  label: string;
}

/** Map of node IDs to their layout positions. */
export type SchematicLayout = Map<string, SchematicNode>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Centre Y position for top-level bodies (planets). */
const CENTER_Y = 100;

/** X position for the Sun. */
const SUN_X = 60;

/** Horizontal spacing between planets. */
const PLANET_SPACING = 120;

/** Vertical offset for moons above their parent. */
const MOON_Y_OFFSET = 50;

/** Horizontal stagger offset for multiple moons. */
const MOON_X_STAGGER = 20;

/** Right-side padding for total layout width. */
const LAYOUT_RIGHT_PAD = 80;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map body IDs to appropriate visual radii for the schematic. */
function getSchematicRadius(bodyId: string): number {
  const RADIUS_MAP: Record<string, number> = {
    SUN: 20, JUPITER: 18, SATURN: 16,
    VENUS: 13, EARTH: 14, MARS: 12,
    MERCURY: 10, CERES: 7,
  };
  return RADIUS_MAP[bodyId] ?? 7; // Default for moons and unknowns
}

/**
 * Determine which body IDs are visible based on game state.
 *
 * Visibility rules:
 * - Sun and Earth are always visible
 * - Bodies with mining sites, hubs, or route/provenLeg endpoints are visible
 * - If a moon is visible, its parent planet is also made visible
 */
function getVisibleBodies(state: GameState | null): Set<string> {
  const visible = new Set<string>(['SUN', 'EARTH']);

  if (!state) return visible;

  // Bodies with mining sites
  for (const site of state.miningSites) {
    visible.add(site.bodyId);
  }

  // Bodies with hubs
  for (const hub of state.hubs) {
    visible.add(hub.bodyId);
  }

  // Bodies that are route endpoints
  for (const route of state.routes) {
    for (const leg of route.legs) {
      visible.add(leg.origin.bodyId);
      visible.add(leg.destination.bodyId);
    }
  }

  // Bodies that are proven leg endpoints
  for (const leg of state.provenLegs) {
    visible.add(leg.origin.bodyId);
    visible.add(leg.destination.bodyId);
  }

  // Ensure parent planets of visible moons are also visible
  for (const bodyId of [...visible]) {
    const body = getBodyDef(bodyId);
    if (body && body.parentId && body.parentId !== 'SUN') {
      // This is a moon — add its parent planet
      visible.add(body.parentId);
    }
  }

  return visible;
}

/**
 * Compute schematic layout positions for all visible bodies.
 *
 * Uses the body hierarchy from src/data/bodies.ts to dynamically position
 * bodies based on what is relevant in the current game state.
 */
export function computeSchematicLayout(state: GameState | null): SchematicLayout {
  const layout: SchematicLayout = new Map();
  const visible = getVisibleBodies(state);

  // Always place the Sun
  const sunDef = getBodyDef('SUN');
  layout.set('SUN', {
    x: SUN_X,
    y: CENTER_Y,
    radius: getSchematicRadius('SUN'),
    type: 'body',
    label: sunDef?.name ?? 'Sun',
  });

  // Get the Sun's childIds to determine orbit order
  const sunChildren = sunDef?.childIds ?? [];

  // Filter to visible top-level bodies (planets orbiting the Sun)
  const visiblePlanets = sunChildren.filter((id) => visible.has(id));

  // Position each visible planet
  for (let i = 0; i < visiblePlanets.length; i++) {
    const planetId = visiblePlanets[i];
    const planetDef = getBodyDef(planetId);
    const planetX = SUN_X + (i + 1) * PLANET_SPACING;

    layout.set(planetId, {
      x: planetX,
      y: CENTER_Y,
      radius: getSchematicRadius(planetId),
      type: 'body',
      label: planetDef?.name ?? planetId,
    });

    // Position moons of this planet
    const moonIds = planetDef?.childIds ?? [];
    const visibleMoons = moonIds.filter((id) => visible.has(id));

    for (let m = 0; m < visibleMoons.length; m++) {
      const moonId = visibleMoons[m];
      const moonDef = getBodyDef(moonId);

      // Stagger moons horizontally around the parent
      // For 1 moon: centered on parent. For 2: -20 and +20. For 3: -20, 0, +20. etc.
      const moonCenterOffset = (m - (visibleMoons.length - 1) / 2) * MOON_X_STAGGER;
      const moonX = planetX + moonCenterOffset;
      const moonY = CENTER_Y - MOON_Y_OFFSET;

      layout.set(moonId, {
        x: moonX,
        y: moonY,
        radius: getSchematicRadius(moonId),
        type: 'body',
        parentId: planetId,
        label: moonDef?.name ?? moonId,
      });
    }
  }

  return layout;
}

/**
 * Get the total width needed for the schematic layout.
 */
export function getSchematicWidth(layout: SchematicLayout): number {
  let maxX = 0;
  for (const node of layout.values()) {
    if (node.x > maxX) maxX = node.x;
  }
  return maxX + LAYOUT_RIGHT_PAD;
}

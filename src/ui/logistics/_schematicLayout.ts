/**
 * _schematicLayout.ts -- Schematic layout computation for the logistics SVG map.
 *
 * Computes positions for celestial bodies (and in the future, hubs) on
 * the schematic solar-system map.  Currently reproduces the original
 * hardcoded positions; a dynamic algorithm will replace this in TASK-027.
 *
 * @module ui/logistics/_schematicLayout
 */

import type { GameState } from '../../core/gameState.ts';

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
// Hardcoded body positions (baseline for TASK-027 dynamic algorithm)
// ---------------------------------------------------------------------------

const BODY_POSITIONS: Record<string, { x: number; y: number; label: string; radius: number }> = {
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
 * Compute schematic layout positions for all visible bodies.
 *
 * Currently returns the hardcoded positions.  TASK-027 will replace this
 * with a dynamic algorithm based on body hierarchy and game state.
 */
export function computeSchematicLayout(_state: GameState | null): SchematicLayout {
  const layout: SchematicLayout = new Map();

  for (const [bodyId, pos] of Object.entries(BODY_POSITIONS)) {
    layout.set(bodyId, {
      x: pos.x,
      y: pos.y,
      radius: pos.radius,
      type: 'body',
      label: pos.label,
    });
  }

  return layout;
}

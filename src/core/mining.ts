/**
 * mining.ts — Mining site creation and proximity lookup.
 *
 * Creates mining sites on celestial bodies and provides spatial queries
 * to find the nearest site within a given radius.
 */

import type { GameState, MiningSite, MiningSiteModule } from './gameState.ts';
import type { MiningModuleType } from './constants.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum distance (in surface coordinate units) for proximity lookups. */
export const SITE_PROXIMITY_RADIUS = 500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSiteParams {
  name: string;
  bodyId: string;
  coordinates: { x: number; y: number };
  controlUnitPartId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateSiteId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `mining-site-${crypto.randomUUID()}`;
  }
  return `mining-site-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new mining site and add it to the game state.
 *
 * The site starts with an empty module list, zero power, and empty storage/
 * production/orbitalBuffer records.  The caller must add modules separately.
 */
export function createMiningSite(state: GameState, params: CreateSiteParams): MiningSite {
  const site: MiningSite = {
    id: generateSiteId(),
    name: params.name,
    bodyId: params.bodyId,
    coordinates: { x: params.coordinates.x, y: params.coordinates.y },
    controlUnit: { partId: params.controlUnitPartId },
    modules: [],
    storage: {},
    production: {},
    powerGenerated: 0,
    powerRequired: 0,
    orbitalBuffer: {},
  };

  state.miningSites.push(site);
  return site;
}

/**
 * Find the nearest mining site to the given coordinates on a specific body.
 *
 * Returns the closest site within `SITE_PROXIMITY_RADIUS`, or `null` if no
 * site on the given body is close enough.
 */
export function findNearestSite(
  state: GameState,
  bodyId: string,
  coordinates: { x: number; y: number },
): MiningSite | null {
  let nearest: MiningSite | null = null;
  let nearestDist = Infinity;

  for (const site of state.miningSites) {
    if (site.bodyId !== bodyId) continue;

    const dx = site.coordinates.x - coordinates.x;
    const dy = site.coordinates.y - coordinates.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= SITE_PROXIMITY_RADIUS && dist < nearestDist) {
      nearest = site;
      nearestDist = dist;
    }
  }

  return nearest;
}

// ---------------------------------------------------------------------------
// Module placement
// ---------------------------------------------------------------------------

export interface AddModuleParams {
  partId: string;
  type: MiningModuleType;
  powerDraw: number;
  powerOutput?: number; // only power generators have this
}

function generateModuleId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `module-${crypto.randomUUID()}`;
  }
  return `module-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Add a module to an existing mining site.
 *
 * Creates the module, pushes it to the site's module list, and updates
 * the site's power bookkeeping.
 */
export function addModuleToSite(site: MiningSite, params: AddModuleParams): MiningSiteModule {
  const mod: MiningSiteModule = {
    id: generateModuleId(),
    partId: params.partId,
    type: params.type,
    powerDraw: params.powerDraw,
    connections: [],
  };

  site.modules.push(mod);
  site.powerRequired += params.powerDraw;

  if (params.powerOutput != null && params.powerOutput > 0) {
    site.powerGenerated += params.powerOutput;
  }

  return mod;
}

// ---------------------------------------------------------------------------
// Pipe connections
// ---------------------------------------------------------------------------

/**
 * Toggle a bidirectional connection between two modules on a site.
 *
 * If the modules are already connected, disconnect them.
 * If they are not connected, connect them.
 *
 * Returns `true` on success, `false` if either module ID is not found.
 */
export function toggleConnection(site: MiningSite, moduleAId: string, moduleBId: string): boolean {
  const modA = site.modules.find((m) => m.id === moduleAId);
  const modB = site.modules.find((m) => m.id === moduleBId);

  if (!modA || !modB) return false;

  const idxInA = modA.connections.indexOf(moduleBId);

  if (idxInA !== -1) {
    // Already connected — disconnect
    modA.connections.splice(idxInA, 1);
    const idxInB = modB.connections.indexOf(moduleAId);
    if (idxInB !== -1) modB.connections.splice(idxInB, 1);
  } else {
    // Not connected — connect
    modA.connections.push(moduleBId);
    modB.connections.push(moduleAId);
  }

  return true;
}

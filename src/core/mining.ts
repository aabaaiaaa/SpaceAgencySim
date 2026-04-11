/**
 * mining.ts — Mining site creation and proximity lookup.
 *
 * Creates mining sites on celestial bodies and provides spatial queries
 * to find the nearest site within a given radius.
 */

import type { GameState, MiningSite, MiningSiteModule } from './gameState.ts';
import type { ResourceType } from './constants.ts';
import { MiningModuleType, ResourceState } from './constants.ts';
import { getBodyDef } from '../data/bodies.ts';
import { RESOURCES_BY_ID } from '../data/resources.ts';
import { getPartById } from '../data/parts.ts';

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

// ---------------------------------------------------------------------------
// Resource extraction
// ---------------------------------------------------------------------------

/** Storage module type to resource state mapping. */
const STORAGE_TYPE_TO_STATE: ReadonlyMap<MiningModuleType, ResourceState> = new Map([
  [MiningModuleType.STORAGE_SILO, ResourceState.SOLID],
  [MiningModuleType.PRESSURE_VESSEL, ResourceState.GAS],
  [MiningModuleType.FLUID_TANK, ResourceState.LIQUID],
]);

/**
 * Returns the power efficiency of a mining site, clamped to 0–1.
 * If no modules require power (powerRequired === 0), returns 1.0.
 */
export function getPowerEfficiency(site: MiningSite): number {
  if (site.powerRequired === 0) return 1.0;
  return Math.min(Math.max(site.powerGenerated / site.powerRequired, 0), 1);
}

/**
 * BFS from `moduleId` finding connected storage modules that match the
 * given `storageState` (SOLID, LIQUID, GAS).
 */
export function getConnectedStorage(
  site: MiningSite,
  moduleId: string,
  storageState: string,
): MiningSiteModule[] {
  const result: MiningSiteModule[] = [];
  const visited = new Set<string>();
  const queue: string[] = [moduleId];
  visited.add(moduleId);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = site.modules.find((m) => m.id === currentId);
    if (!current) continue;

    // Check if this module is a storage module matching the requested state
    const moduleState = STORAGE_TYPE_TO_STATE.get(current.type as MiningModuleType);
    if (moduleState === storageState && currentId !== moduleId) {
      result.push(current);
    }

    // Traverse connections
    for (const neighborId of current.connections) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push(neighborId);
      }
    }
  }

  return result;
}

/**
 * Process all mining sites: extract resources based on power efficiency
 * and connected storage capacity.
 */
export function processMiningSites(state: GameState): void {
  for (const site of state.miningSites) {
    const efficiency = getPowerEfficiency(site);
    if (efficiency <= 0) continue;

    const bodyDef = getBodyDef(site.bodyId);
    if (!bodyDef || !bodyDef.resourceProfile) continue;

    for (const mod of site.modules) {
      // Only process extractor modules
      if (
        mod.type !== MiningModuleType.MINING_DRILL &&
        mod.type !== MiningModuleType.GAS_COLLECTOR &&
        mod.type !== MiningModuleType.FLUID_EXTRACTOR
      ) {
        continue;
      }

      for (const resource of bodyDef.resourceProfile) {
        const resourceDef = RESOURCES_BY_ID[resource.resourceType];
        if (!resourceDef) continue;

        // Check that this extractor module type matches the resource's extraction module
        if (resourceDef.extractionModule !== mod.type) continue;

        // Find connected storage modules of the matching state
        const connectedStorage = getConnectedStorage(site, mod.id, resourceDef.state);
        if (connectedStorage.length === 0) continue;

        // Calculate total available storage capacity across connected storage
        let availableCapacity = 0;
        for (const storageMod of connectedStorage) {
          const partDef = getPartById(storageMod.partId);
          if (!partDef) continue;
          const capacity = (partDef.properties.storageCapacityKg as number) ?? 0;
          const stored = site.storage[resource.resourceType as ResourceType] ?? 0;
          // Each storage module contributes its capacity minus what's currently stored
          // (stored is site-wide, distributed proportionally, but we simplify to total)
          availableCapacity += capacity;
        }

        // Subtract total stored from total capacity
        const totalStored = site.storage[resource.resourceType as ResourceType] ?? 0;
        availableCapacity = Math.max(0, availableCapacity - totalStored);

        if (availableCapacity <= 0) continue;

        // Get extraction multiplier from the extractor part
        const extractorPartDef = getPartById(mod.partId);
        const extractionMultiplier = extractorPartDef
          ? ((extractorPartDef.properties.extractionMultiplier as number) ?? 1.0)
          : 1.0;

        // Calculate extraction amount
        const extracted = Math.min(
          resource.extractionRateKgPerPeriod * efficiency * extractionMultiplier,
          availableCapacity,
        );

        if (extracted > 0) {
          site.storage[resource.resourceType as ResourceType] =
            (site.storage[resource.resourceType as ResourceType] ?? 0) + extracted;
        }
      }
    }
  }
}

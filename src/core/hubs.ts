/**
 * hubs.ts — Hub CRUD operations and environment/tax helper functions.
 * @module core/hubs
 */

import type { GameState } from './gameState.ts';
import type { Hub, ConstructionProject, ResourceRequirement } from './hubTypes.ts';
import { EARTH_HUB_ID, FacilityId } from './constants.ts';
import {
  BODY_ENVIRONMENT,
  ENVIRONMENT_COST_MULTIPLIER,
  IMPORT_TAX_MULTIPLIER,
  DEFAULT_IMPORT_TAX,
  OFFWORLD_FACILITY_COSTS,
} from '../data/hubFacilities.ts';
import type { EnvironmentCategory } from '../data/hubFacilities.ts';

// ---------------------------------------------------------------------------
// CRUD Operations
// ---------------------------------------------------------------------------

/**
 * Returns the hub matching `state.activeHubId`.
 * Throws if no hub with that ID exists.
 */
export function getActiveHub(state: GameState): Hub {
  const hub = state.hubs.find(h => h.id === state.activeHubId);
  if (!hub) {
    throw new Error(`Active hub not found: ${state.activeHubId}`);
  }
  return hub;
}

/**
 * Returns the hub with the given ID, or undefined if not found.
 */
export function getHub(state: GameState, hubId: string): Hub | undefined {
  return state.hubs.find(h => h.id === hubId);
}

/**
 * Sets `state.activeHubId` to the given hub ID.
 * Throws if no hub with that ID exists.
 */
export function setActiveHub(state: GameState, hubId: string): void {
  const hub = state.hubs.find(h => h.id === hubId);
  if (!hub) {
    throw new Error(`Cannot set active hub — hub not found: ${hubId}`);
  }
  state.activeHubId = hubId;
}

/**
 * Returns all hubs located on the specified body.
 */
export function getHubsOnBody(state: GameState, bodyId: string): Hub[] {
  return state.hubs.filter(h => h.bodyId === bodyId);
}

/**
 * Creates a new hub and pushes it onto `state.hubs`.
 * The hub starts offline with a Crew Hab construction project in its queue.
 */
export function createHub(
  state: GameState,
  options: {
    name: string;
    type: 'surface' | 'orbital';
    bodyId: string;
    altitude?: number;
    coordinates?: { x: number; y: number };
    biomeId?: string;
  },
): Hub {
  const id = 'hub-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);

  // Look up Crew Hab cost definition
  const crewHabCost = OFFWORLD_FACILITY_COSTS.find(
    c => c.facilityId === FacilityId.CREW_HAB,
  );

  // Build the construction project for the initial Crew Hab
  const envMultiplier = getEnvironmentCostMultiplier(options.bodyId);

  const constructionQueue: ConstructionProject[] = [];
  if (crewHabCost) {
    const resourcesRequired: ResourceRequirement[] = crewHabCost.resources.map(r => ({
      resourceId: r.resourceId,
      amount: r.amount * envMultiplier,
    }));
    const resourcesDelivered: ResourceRequirement[] = crewHabCost.resources.map(r => ({
      resourceId: r.resourceId,
      amount: 0,
    }));

    constructionQueue.push({
      facilityId: FacilityId.CREW_HAB,
      resourcesRequired,
      resourcesDelivered,
      moneyCost: crewHabCost.moneyCost,
      startedPeriod: state.currentPeriod,
    });
  }

  const hub: Hub = {
    id,
    name: options.name,
    type: options.type,
    bodyId: options.bodyId,
    ...(options.altitude !== undefined ? { altitude: options.altitude } : {}),
    ...(options.coordinates ? { coordinates: options.coordinates } : {}),
    ...(options.biomeId ? { biomeId: options.biomeId } : {}),
    facilities: {},
    tourists: [],
    partInventory: [],
    constructionQueue,
    maintenanceCost: 0,
    established: state.currentPeriod,
    online: false,
  };

  state.hubs.push(hub);
  return hub;
}

// ---------------------------------------------------------------------------
// Environment & Tax Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the environment category for a celestial body,
 * or undefined for bodies not in the map (e.g. Earth).
 */
export function getEnvironmentCategory(bodyId: string): EnvironmentCategory | undefined {
  return BODY_ENVIRONMENT[bodyId];
}

/**
 * Returns the cost multiplier for the body's environment category.
 * Returns 1.0 if the body has no environment category (Earth case).
 */
export function getEnvironmentCostMultiplier(bodyId: string): number {
  const category = getEnvironmentCategory(bodyId);
  if (!category) return 1.0;
  return ENVIRONMENT_COST_MULTIPLIER[category];
}

/**
 * Returns the import tax multiplier for the given body.
 * Falls back to DEFAULT_IMPORT_TAX for unknown bodies.
 */
export function getImportTaxMultiplier(bodyId: string): number {
  if (bodyId in IMPORT_TAX_MULTIPLIER) {
    return IMPORT_TAX_MULTIPLIER[bodyId];
  }
  return DEFAULT_IMPORT_TAX;
}

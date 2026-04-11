/**
 * hubs.ts — Hub CRUD operations and environment/tax helper functions.
 * @module core/hubs
 */

import type { GameState } from './gameState.ts';
import type { Hub, ConstructionProject, ResourceRequirement } from './hubTypes.ts';
import { FacilityId } from './constants.ts';
import { spend } from './finance.ts';
import {
  BODY_ENVIRONMENT,
  ENVIRONMENT_COST_MULTIPLIER,
  IMPORT_TAX_MULTIPLIER,
  DEFAULT_IMPORT_TAX,
  OFFWORLD_FACILITY_COSTS,
  SURFACE_HUB_FACILITIES,
  ORBITAL_HUB_FACILITIES,
  EARTH_ONLY_FACILITIES,
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

// ---------------------------------------------------------------------------
// Outpost Deployment
// ---------------------------------------------------------------------------

/**
 * Deploys an Outpost Core, creating a new hub at the flight's current location.
 * Creates a surface hub if the flight is landed, or an orbital hub if in orbit.
 * Deducts the Crew Hab construction monetary cost via spend().
 *
 * Returns the created hub, or null if deployment failed.
 */
export function deployOutpostCore(
  state: GameState,
  flight: { bodyId: string; altitude: number; inOrbit: boolean; landed?: boolean },
  name: string,
): Hub | null {
  // Look up Crew Hab cost
  const crewHabCost = OFFWORLD_FACILITY_COSTS.find(
    c => c.facilityId === FacilityId.CREW_HAB,
  );
  const moneyCost = crewHabCost?.moneyCost ?? 200_000;

  // Check and deduct monetary cost
  if (!spend(state, moneyCost)) {
    return null; // Insufficient funds
  }

  // Determine hub type based on flight state
  if (flight.inOrbit) {
    // Orbital hub
    return createHub(state, {
      name,
      type: 'orbital',
      bodyId: flight.bodyId,
      altitude: flight.altitude,
    });
  } else {
    // Surface hub (landed)
    return createHub(state, {
      name,
      type: 'surface',
      bodyId: flight.bodyId,
    });
  }
}

// ---------------------------------------------------------------------------
// Construction Project Processing
// ---------------------------------------------------------------------------

/**
 * Delivers resources to a construction project.
 * Caps the delivered amount at the required amount for that resource.
 * Returns the amount actually delivered (may be less than requested if already near full).
 */
export function deliverResources(
  project: ConstructionProject,
  resourceId: string,
  amount: number,
): number {
  const reqEntry = project.resourcesRequired.find(r => r.resourceId === resourceId);
  if (!reqEntry) return 0;

  const delEntry = project.resourcesDelivered.find(r => r.resourceId === resourceId);
  if (!delEntry) return 0;

  const remaining = reqEntry.amount - delEntry.amount;
  const actual = Math.min(amount, remaining);
  if (actual <= 0) return 0;

  delEntry.amount += actual;
  return actual;
}

/**
 * Returns true if all resources for a construction project have been delivered.
 */
export function isConstructionComplete(project: ConstructionProject): boolean {
  for (const req of project.resourcesRequired) {
    const del = project.resourcesDelivered.find(r => r.resourceId === req.resourceId);
    if (!del || del.amount < req.amount) return false;
  }
  return true;
}

/**
 * Processes construction projects across all hubs.
 * Marks completed projects (sets completedPeriod), adds the facility at tier 1,
 * and brings the hub online when the Crew Hab is completed.
 */
export function processConstructionProjects(state: GameState): void {
  for (const hub of state.hubs) {
    for (const project of hub.constructionQueue) {
      // Skip already-completed projects
      if (project.completedPeriod !== undefined) continue;

      if (isConstructionComplete(project)) {
        project.completedPeriod = state.currentPeriod;
        hub.facilities[project.facilityId] = { built: true, tier: 1 };

        // Bring hub online when Crew Hab completes
        if (project.facilityId === FacilityId.CREW_HAB && !hub.online) {
          hub.online = true;
        }
      }
    }
  }
}

/**
 * Returns the list of facility IDs available to build at a given hub.
 * Excludes: already-built facilities, facilities with in-progress construction,
 * Earth-only facilities, and Crew Hab (which is auto-queued on hub creation).
 */
export function getAvailableFacilitiesToBuild(hub: Hub): string[] {
  // Determine which facilities this hub type supports
  const allowedFacilities = hub.type === 'surface'
    ? SURFACE_HUB_FACILITIES
    : ORBITAL_HUB_FACILITIES;

  // Facilities already built
  const builtIds = new Set(
    Object.entries(hub.facilities)
      .filter(([, state]) => state.built)
      .map(([id]) => id),
  );

  // Facilities with in-progress (not completed) construction projects
  const inProgressIds = new Set(
    hub.constructionQueue
      .filter(p => p.completedPeriod === undefined)
      .map(p => p.facilityId),
  );

  // Earth-only facilities
  const earthOnlyIds = new Set(EARTH_ONLY_FACILITIES);

  return allowedFacilities.filter(id => {
    if (builtIds.has(id)) return false;
    if (inProgressIds.has(id)) return false;
    if (earthOnlyIds.has(id)) return false;
    if (id === FacilityId.CREW_HAB) return false;
    return true;
  });
}

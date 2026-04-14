/**
 * hubs.ts — Hub CRUD operations and environment/tax helper functions.
 * @module core/hubs
 */

import type { GameState } from './gameState.ts';
import type { Hub, ConstructionProject, ResourceRequirement } from './hubTypes.ts';
import { FacilityId, EARTH_HUB_ID, HUB_PROXIMITY_DOCK_RADIUS } from './constants.ts';
import { spend } from './finance.ts';
import { evictTourists } from './hubTourists.ts';
import {
  BODY_ENVIRONMENT,
  ENVIRONMENT_COST_MULTIPLIER,
  IMPORT_TAX_MULTIPLIER,
  DEFAULT_IMPORT_TAX,
  OFFWORLD_FACILITY_COSTS,
  OFFWORLD_FACILITY_UPKEEP,
  SURFACE_HUB_FACILITIES,
  ORBITAL_HUB_FACILITIES,
  EARTH_ONLY_FACILITIES,
} from '../data/hubFacilities.ts';
import { HUB_NAME_POOL } from '../data/hubNames.ts';
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
      moneyCost: crewHabCost.moneyCost * envMultiplier,
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
// Hub Name Generation
// ---------------------------------------------------------------------------

/**
 * Generates a random hub name from the HUB_NAME_POOL that hasn't been used yet.
 * Appends " Outpost" for surface hubs or " Station" for orbital hubs.
 * Falls back to "Hub-N" naming when the pool is exhausted.
 */
export function generateHubName(state: GameState, hubType: 'surface' | 'orbital'): string {
  const suffix = hubType === 'surface' ? ' Outpost' : ' Station';

  // Extract base names from existing hubs by stripping known suffixes
  const usedBaseNames = new Set(
    state.hubs.map(h => h.name.replace(/ (Outpost|Station)$/, '')),
  );

  // Filter pool to unused names
  const available = HUB_NAME_POOL.filter(name => !usedBaseNames.has(name));

  if (available.length === 0) {
    // Pool exhausted — fallback naming
    return `Hub-${state.hubs.length}${suffix}`;
  }

  // Pick a random name from available pool
  const baseName = available[Math.floor(Math.random() * available.length)];
  return baseName + suffix;
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
  name?: string,
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

  // Determine hub type and generate name if not provided
  const hubType = flight.inOrbit ? 'orbital' : 'surface';
  const hubName = name ?? generateHubName(state, hubType);

  // Determine hub type based on flight state
  if (flight.inOrbit) {
    // Orbital hub
    return createHub(state, {
      name: hubName,
      type: 'orbital',
      bodyId: flight.bodyId,
      altitude: flight.altitude,
    });
  } else {
    // Surface hub (landed)
    return createHub(state, {
      name: hubName,
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
        const existing = hub.facilities[project.facilityId];
        if (existing && existing.built) {
          // Upgrade: increment tier
          existing.tier += 1;
        } else {
          // New build: set to tier 1
          hub.facilities[project.facilityId] = { built: true, tier: 1 };
        }

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

// ---------------------------------------------------------------------------
// Facility Tier Upgrades
// ---------------------------------------------------------------------------

/** Maximum facility tier. */
const MAX_FACILITY_TIER = 3;

/**
 * Queues a facility upgrade construction project at the given hub.
 * Tier N+1 costs (N+1)× the base resource amounts, environment-multiplied.
 * Money cost is also scaled by (N+1).
 *
 * Returns the queued project, or null if:
 *  - Facility is not built
 *  - Already at max tier (3)
 *  - An upgrade for this facility is already in progress
 *  - No cost definition found
 */
export function startFacilityUpgrade(
  state: GameState,
  hub: Hub,
  facilityId: string,
): ConstructionProject | null {
  const fState = hub.facilities[facilityId];
  if (!fState || !fState.built) return null;
  if (fState.tier >= MAX_FACILITY_TIER) return null;

  // Check for in-progress upgrade
  const alreadyInProgress = hub.constructionQueue.some(
    p => p.facilityId === facilityId && p.completedPeriod === undefined,
  );
  if (alreadyInProgress) return null;

  const costDef = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === facilityId);
  if (!costDef) return null;

  const nextTier = fState.tier + 1;
  const envMultiplier = getEnvironmentCostMultiplier(hub.bodyId);

  const resourcesRequired: ResourceRequirement[] = costDef.resources.map(r => ({
    resourceId: r.resourceId,
    amount: r.amount * nextTier * envMultiplier,
  }));
  const resourcesDelivered: ResourceRequirement[] = costDef.resources.map(r => ({
    resourceId: r.resourceId,
    amount: 0,
  }));

  const project: ConstructionProject = {
    facilityId,
    resourcesRequired,
    resourcesDelivered,
    moneyCost: costDef.moneyCost * nextTier * envMultiplier,
    startedPeriod: state.currentPeriod,
  };

  hub.constructionQueue.push(project);
  return project;
}

// ---------------------------------------------------------------------------
// Maintenance & Offline
// ---------------------------------------------------------------------------

/**
 * Calculates the per-period maintenance cost for a hub.
 * Earth hub returns 0 (uses existing system). Offline hubs return 0.
 * Each built facility's upkeep is scaled by its tier.
 */
export function calculateHubMaintenance(hub: Hub): number {
  if (hub.id === EARTH_HUB_ID) return 0;
  if (!hub.online) return 0;

  let total = 0;
  for (const [facilityId, fState] of Object.entries(hub.facilities)) {
    if (!fState.built) continue;
    const baseUpkeep = OFFWORLD_FACILITY_UPKEEP[facilityId] ?? 0;
    total += baseUpkeep * fState.tier;
  }
  return total;
}

/**
 * Processes maintenance costs for all hubs.
 * Deducts costs via spend(). If insufficient money, hub goes offline,
 * crew are evacuated to Earth, and tourists are evicted.
 */
export function processHubMaintenance(state: GameState): void {
  for (const hub of state.hubs) {
    const cost = calculateHubMaintenance(hub);
    if (cost <= 0) continue;

    hub.maintenanceCost = cost;

    if (!spend(state, cost)) {
      // Insufficient funds — take hub offline
      hub.online = false;

      // Evacuate crew to Earth
      for (const crew of state.crew) {
        if (crew.stationedHubId === hub.id) {
          crew.stationedHubId = EARTH_HUB_ID;
        }
      }

      // Evict tourists
      evictTourists(hub);
    }
  }
}

/**
 * Reactivates an offline hub by paying one period's maintenance.
 * Returns true on success, false if hub not found, already online,
 * or insufficient funds.
 */
export function reactivateHub(state: GameState, hubId: string): boolean {
  const hub = state.hubs.find(h => h.id === hubId);
  if (!hub) return false;
  if (hub.online) return false;

  // Temporarily bring online to calculate maintenance
  hub.online = true;
  const cost = calculateHubMaintenance(hub);
  hub.online = false;

  if (!spend(state, cost)) return false;

  hub.online = true;
  return true;
}

// ---------------------------------------------------------------------------
// Surface Hub Recovery
// ---------------------------------------------------------------------------

/**
 * Returns online surface hubs on the specified body, suitable for craft recovery.
 * Excludes offline hubs and orbital hubs.
 */
export function getSurfaceHubsForRecovery(state: GameState, bodyId: string): Hub[] {
  return state.hubs.filter(
    h => h.bodyId === bodyId && h.type === 'surface' && h.online,
  );
}

// ---------------------------------------------------------------------------
// Orbital Hub Proximity Detection
// ---------------------------------------------------------------------------

/**
 * Finds online orbital hubs within HUB_PROXIMITY_DOCK_RADIUS on the same body.
 * Used by the flight controller to detect docking opportunities.
 *
 * @param state   Game state
 * @param bodyId  The body the craft is orbiting
 * @param altitude  The craft's altitude above the body surface (metres)
 * @returns Array of orbital hubs within docking range, may be empty
 */
export function findNearbyOrbitalHub(
  state: GameState,
  bodyId: string,
  altitude: number,
): Hub[] {
  return state.hubs.filter(h => {
    if (h.type !== 'orbital') return false;
    if (h.bodyId !== bodyId) return false;
    if (!h.online) return false;
    const hubAltitude = h.altitude ?? 200_000;
    return Math.abs(hubAltitude - altitude) <= HUB_PROXIMITY_DOCK_RADIUS;
  });
}

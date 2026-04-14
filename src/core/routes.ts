/**
 * routes.ts -- Route leg proving functions.
 *
 * When a player manually flies a route (e.g. Earth surface -> LEO), the
 * successful flight "proves" that leg.  Proven legs can later be assembled
 * into automated resource transport routes.
 */

import type { GameState, MiningSite, ProvenLeg, Route, RouteLeg, RouteLocation, RouteStatus } from './gameState.ts';
import type { ResourceType } from './constants.ts';
import { spend, earn } from './finance.ts';
import { RESOURCES_BY_ID } from '../data/resources.ts';

// ---------------------------------------------------------------------------
// Public interface for proveRouteLeg params
// ---------------------------------------------------------------------------

export interface ProveRouteLegParams {
  origin: RouteLocation;
  destination: RouteLocation;
  craftDesignId: string;
  cargoCapacityKg: number;
  costPerRun: number;
  flightId: string;
  originHubId?: string | null;
  destinationHubId?: string | null;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Record a proven route leg on the game state.
 *
 * Call this after a successful manual flight to mark the origin->destination
 * pair as flyable with the given craft design.
 */
export function proveRouteLeg(
  state: GameState,
  params: ProveRouteLegParams,
): ProvenLeg {
  const leg: ProvenLeg = {
    id: `proven-leg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    origin: {
      ...params.origin,
      hubId: params.originHubId !== undefined ? params.originHubId : (params.origin.hubId ?? null),
    },
    destination: {
      ...params.destination,
      hubId: params.destinationHubId !== undefined ? params.destinationHubId : (params.destination.hubId ?? null),
    },
    craftDesignId: params.craftDesignId,
    cargoCapacityKg: params.cargoCapacityKg,
    costPerRun: params.costPerRun,
    provenFlightId: params.flightId,
    dateProven: state.currentPeriod,
  };
  state.provenLegs.push(leg);
  return leg;
}

/**
 * Compare two RouteLocations for logical equality.
 *
 * Two locations match when they share the same bodyId and locationType.
 * Altitude is compared only when both locations specify it; if either side
 * leaves altitude undefined they are considered matching (altitude is
 * irrelevant for surface locations and optional for orbit locations).
 */
export function locationsMatch(a: RouteLocation, b: RouteLocation): boolean {
  if (a.bodyId !== b.bodyId) return false;
  if (a.locationType !== b.locationType) return false;
  if (a.altitude !== undefined && b.altitude !== undefined) {
    return a.altitude === b.altitude;
  }
  return true;
}

/**
 * Return all proven legs whose origin and destination match the given
 * locations (using `locationsMatch` semantics).
 */
export function getProvenLegsForOriginDestination(
  state: GameState,
  origin: RouteLocation,
  destination: RouteLocation,
): ProvenLeg[] {
  return state.provenLegs.filter(
    (leg) =>
      locationsMatch(leg.origin, origin) &&
      locationsMatch(leg.destination, destination),
  );
}

// ---------------------------------------------------------------------------
// Route assembly types
// ---------------------------------------------------------------------------

export interface CreateRouteParams {
  name: string;
  resourceType: ResourceType;
  provenLegIds: string[];   // IDs of ProvenLeg entries to chain into the route
  hubOverrides?: Record<string, { originHubId?: string | null; destinationHubId?: string | null }>;
}

// ---------------------------------------------------------------------------
// Route throughput calculation
// ---------------------------------------------------------------------------

/**
 * Returns the minimum of `(leg.cargoCapacityKg * leg.craftCount)` across all
 * legs.  If legs is empty, returns 0.
 */
export function calculateRouteThroughput(legs: RouteLeg[]): number {
  if (legs.length === 0) return 0;
  return Math.min(...legs.map((l) => l.cargoCapacityKg * l.craftCount));
}

// ---------------------------------------------------------------------------
// Route creation
// ---------------------------------------------------------------------------

function generateRouteId(): string {
  return `route-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateRouteLegId(): string {
  return `route-leg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Assemble a new Route from proven legs and add it to the game state.
 *
 * Each proven leg referenced by `params.provenLegIds` is converted into a
 * `RouteLeg` with `craftCount: 1`.  The route starts in `'paused'` status.
 */
export function createRoute(state: GameState, params: CreateRouteParams): Route {
  const routeLegs: RouteLeg[] = params.provenLegIds.map((plId) => {
    const proven = state.provenLegs.find((pl) => pl.id === plId);
    if (!proven) throw new Error(`ProvenLeg not found: ${plId}`);

    // Apply hub overrides if provided
    const override = params.hubOverrides?.[plId];
    const origin = { ...proven.origin };
    const destination = { ...proven.destination };

    if (override?.originHubId !== undefined) {
      origin.hubId = override.originHubId;
    }
    if (override?.destinationHubId !== undefined) {
      destination.hubId = override.destinationHubId;
    }

    // Validate hub references
    if (origin.hubId !== null && origin.hubId !== undefined) {
      if (!state.hubs.some(h => h.id === origin.hubId)) {
        throw new Error(`Hub not found for route origin: ${origin.hubId}`);
      }
    }
    if (destination.hubId !== null && destination.hubId !== undefined) {
      if (!state.hubs.some(h => h.id === destination.hubId)) {
        throw new Error(`Hub not found for route destination: ${destination.hubId}`);
      }
    }

    return {
      id: generateRouteLegId(),
      origin,
      destination,
      craftDesignId: proven.craftDesignId,
      craftCount: 1,
      cargoCapacityKg: proven.cargoCapacityKg,
      costPerRun: proven.costPerRun,
      provenFlightId: proven.provenFlightId,
    };
  });

  const route: Route = {
    id: generateRouteId(),
    name: params.name,
    status: 'paused',
    resourceType: params.resourceType,
    legs: routeLegs,
    throughputPerPeriod: calculateRouteThroughput(routeLegs),
    totalCostPerPeriod: routeLegs.reduce((sum, l) => sum + l.costPerRun * l.craftCount, 0),
  };

  state.routes.push(route);
  return route;
}

// ---------------------------------------------------------------------------
// Route modification
// ---------------------------------------------------------------------------

/**
 * Add an additional craft to a specific leg within a route.
 *
 * Increments `craftCount` on the leg and recalculates the route's throughput
 * and total operating cost.  Returns `false` if the leg ID is not found.
 */
export function addCraftToLeg(route: Route, legId: string): boolean {
  const leg = route.legs.find((l) => l.id === legId);
  if (!leg) return false;

  leg.craftCount++;
  route.throughputPerPeriod = calculateRouteThroughput(route.legs);
  route.totalCostPerPeriod = route.legs.reduce((sum, l) => sum + l.costPerRun * l.craftCount, 0);
  return true;
}

/**
 * Set the operational status of a route.
 */
export function setRouteStatus(route: Route, status: RouteStatus): void {
  route.status = status;
}

// ---------------------------------------------------------------------------
// Per-period route processing (automation)
// ---------------------------------------------------------------------------

/**
 * Process all active routes for the current period.
 *
 * For each active route:
 * 1. Find the source mining site's orbital buffer for the route's resource type.
 * 2. Transport up to the route's throughput (limited by available buffer).
 * 3. Deduct operating costs via `spend()` — skip if insufficient funds.
 * 4. If the destination is Earth, sell the cargo at market value.
 * 5. Otherwise, deposit into the destination mining site's orbital buffer.
 */
// ---------------------------------------------------------------------------
// Route safety warnings
// ---------------------------------------------------------------------------

export interface SafeOrbitRange {
  minAltitude: number;
  maxAltitude: number;
}

/**
 * Returns all active routes that have any leg with an origin or destination
 * referencing the given body at the given orbit altitude.
 *
 * A route depends on that orbit if any leg's origin or destination has:
 * - `bodyId` matching the given bodyId
 * - `locationType === 'orbit'`
 * - `altitude` matching the given orbitAltitude (or altitude undefined, which
 *   is treated as matching any altitude)
 *
 * Only returns routes with status `'active'`.
 */
export function getRouteDependencies(
  state: GameState,
  bodyId: string,
  orbitAltitude: number,
): Route[] {
  return state.routes.filter((route) => {
    if (route.status !== 'active') return false;
    return route.legs.some((leg) => {
      return matchesOrbitLocation(leg.origin, bodyId, orbitAltitude)
        || matchesOrbitLocation(leg.destination, bodyId, orbitAltitude);
    });
  });
}

function matchesOrbitLocation(
  loc: RouteLocation,
  bodyId: string,
  altitude: number,
): boolean {
  if (loc.bodyId !== bodyId) return false;
  if (loc.locationType !== 'orbit') return false;
  // undefined altitude matches any query altitude
  if (loc.altitude === undefined) return true;
  return loc.altitude === altitude;
}

/**
 * Returns the altitude range that keeps all dependent routes valid, or null if
 * no active routes depend on any orbit around this body.
 *
 * Logic:
 * 1. Find all active routes with any leg referencing this body at orbit locations
 * 2. Collect all defined orbit altitudes used by those routes at this body
 * 3. If no defined orbit altitudes found, return null
 * 4. Return `{ minAltitude: min(altitudes), maxAltitude: max(altitudes) }`
 */
export function getSafeOrbitRange(
  state: GameState,
  bodyId: string,
  _currentAltitude: number,
): SafeOrbitRange | null {
  const altitudes: number[] = [];

  for (const route of state.routes) {
    if (route.status !== 'active') continue;
    for (const leg of route.legs) {
      collectOrbitAltitude(leg.origin, bodyId, altitudes);
      collectOrbitAltitude(leg.destination, bodyId, altitudes);
    }
  }

  if (altitudes.length === 0) return null;
  return {
    minAltitude: Math.min(...altitudes),
    maxAltitude: Math.max(...altitudes),
  };
}

function collectOrbitAltitude(
  loc: RouteLocation,
  bodyId: string,
  out: number[],
): void {
  if (loc.bodyId !== bodyId) return;
  if (loc.locationType !== 'orbit') return;
  if (loc.altitude !== undefined) {
    out.push(loc.altitude);
  }
}

// ---------------------------------------------------------------------------
// Mining site index helper
// ---------------------------------------------------------------------------

/**
 * Build an index mapping bodyId to mining sites for fast lookup.
 */
export function buildSiteIndex(sites: MiningSite[]): Map<string, MiningSite[]> {
  const index = new Map<string, MiningSite[]>();
  for (const site of sites) {
    const list = index.get(site.bodyId);
    if (list) {
      list.push(site);
    } else {
      index.set(site.bodyId, [site]);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// Per-period route processing (automation)
// ---------------------------------------------------------------------------

export function processRoutes(state: GameState): { revenue: number; operatingCost: number; delivered: Partial<Record<ResourceType, number>> } {
  let totalRevenue = 0;
  let totalOperatingCost = 0;
  const delivered: Partial<Record<ResourceType, number>> = {};
  const siteIndex = buildSiteIndex(state.miningSites);
  for (const route of state.routes) {
    if (route.status !== 'active') continue;
    if (route.legs.length === 0) continue;

    // Safety check: verify all hub references are valid
    const hasInvalidHub = route.legs.some(leg => {
      if (leg.origin.hubId && !state.hubs.find(h => h.id === leg.origin.hubId)) return true;
      if (leg.destination.hubId && !state.hubs.find(h => h.id === leg.destination.hubId)) return true;
      return false;
    });
    if (hasInvalidHub) {
      route.status = 'broken';
      continue;
    }

    // Find source body from first leg's origin
    const sourceBodyId = route.legs[0].origin.bodyId;

    // Find any mining site on the source body that has this resource in its orbital buffer
    const sourceSite = (siteIndex.get(sourceBodyId) ?? []).find(
      (s) => (s.orbitalBuffer[route.resourceType] ?? 0) > 0,
    );
    if (!sourceSite) continue;

    const availableInBuffer = sourceSite.orbitalBuffer[route.resourceType] ?? 0;
    const transportAmount = Math.min(route.throughputPerPeriod, availableInBuffer);
    if (transportAmount <= 0) continue;

    // Resolve destination before committing funds or resources
    const lastLeg = route.legs[route.legs.length - 1];
    const destBodyId = lastLeg.destination.bodyId;
    let destSite: MiningSite | undefined;
    if (destBodyId !== 'EARTH') {
      destSite = (siteIndex.get(destBodyId) ?? [])[0];
      if (!destSite) {
        route.status = 'broken';
        continue;
      }
    }

    // Deduct operating cost — skip if insufficient funds
    if (!spend(state, route.totalCostPerPeriod)) continue;
    totalOperatingCost += route.totalCostPerPeriod;

    // Deduct from source orbital buffer
    sourceSite.orbitalBuffer[route.resourceType] =
      (sourceSite.orbitalBuffer[route.resourceType] ?? 0) - transportAmount;

    // Deliver to destination
    if (destBodyId === 'EARTH') {
      // Sell cargo at market value
      const resourceDef = RESOURCES_BY_ID[route.resourceType];
      const revenue = transportAmount * resourceDef.baseValuePerKg;
      earn(state, revenue);
      totalRevenue += revenue;
    } else {
      // Deposit into destination mining site's orbital buffer
      // destSite is guaranteed non-null here: the guard at line 343 continues on undefined
      const dest = destSite as MiningSite;
      dest.orbitalBuffer[route.resourceType] =
        (dest.orbitalBuffer[route.resourceType] ?? 0) + transportAmount;
    }
    delivered[route.resourceType] = (delivered[route.resourceType] ?? 0) + transportAmount;
  }
  return { revenue: totalRevenue, operatingCost: totalOperatingCost, delivered };
}

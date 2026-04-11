/**
 * routes.ts -- Route leg proving functions.
 *
 * When a player manually flies a route (e.g. Earth surface -> LEO), the
 * successful flight "proves" that leg.  Proven legs can later be assembled
 * into automated resource transport routes.
 */

import type { GameState, ProvenLeg, Route, RouteLeg, RouteLocation, RouteStatus } from './gameState.ts';
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
    origin: params.origin,
    destination: params.destination,
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
    return {
      id: generateRouteLegId(),
      origin: proven.origin,
      destination: proven.destination,
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
export function processRoutes(state: GameState): void {
  for (const route of state.routes) {
    if (route.status !== 'active') continue;
    if (route.legs.length === 0) continue;

    // Find source body from first leg's origin
    const sourceBodyId = route.legs[0].origin.bodyId;

    // Find any mining site on the source body that has this resource in its orbital buffer
    const sourceSite = state.miningSites.find(
      (s) => s.bodyId === sourceBodyId && (s.orbitalBuffer[route.resourceType] ?? 0) > 0,
    );
    if (!sourceSite) continue;

    const availableInBuffer = sourceSite.orbitalBuffer[route.resourceType] ?? 0;
    const transportAmount = Math.min(route.throughputPerPeriod, availableInBuffer);
    if (transportAmount <= 0) continue;

    // Deduct operating cost — skip if insufficient funds
    if (!spend(state, route.totalCostPerPeriod)) continue;

    // Deduct from source orbital buffer
    sourceSite.orbitalBuffer[route.resourceType] =
      (sourceSite.orbitalBuffer[route.resourceType] ?? 0) - transportAmount;

    // Check destination
    const lastLeg = route.legs[route.legs.length - 1];
    const destBodyId = lastLeg.destination.bodyId;

    if (destBodyId === 'EARTH') {
      // Sell cargo at market value
      const resourceDef = RESOURCES_BY_ID[route.resourceType];
      const revenue = transportAmount * resourceDef.baseValuePerKg;
      earn(state, revenue);
    } else {
      // Deposit into destination mining site's orbital buffer
      const destSite = state.miningSites.find((s) => s.bodyId === destBodyId);
      if (destSite) {
        destSite.orbitalBuffer[route.resourceType] =
          (destSite.orbitalBuffer[route.resourceType] ?? 0) + transportAmount;
      }
    }
  }
}

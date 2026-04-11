/**
 * routes.ts -- Route leg proving functions.
 *
 * When a player manually flies a route (e.g. Earth surface -> LEO), the
 * successful flight "proves" that leg.  Proven legs can later be assembled
 * into automated resource transport routes.
 */

import type { GameState, ProvenLeg, RouteLocation } from './gameState.ts';

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

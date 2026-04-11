/**
 * hubCrew.ts — Crew management across hubs: hiring, transfers, and transit processing.
 *
 * Hiring at off-world hubs applies an import tax multiplier and transit delay.
 * Transfers between hubs are free when a route connects the bodies, otherwise
 * distance-based cost applies.
 *
 * @module core/hubCrew
 */

import type { GameState, CrewMember } from './gameState.ts';
import { createCrewMember } from './gameState.ts';
import { EARTH_HUB_ID, HIRE_COST, AstronautStatus } from './constants.ts';
import { getHub, getImportTaxMultiplier } from './hubs.ts';
import { spend } from './finance.ts';

// ---------------------------------------------------------------------------
// Transit Delay Table
// ---------------------------------------------------------------------------

/** Transit delay in periods by body ID (approximate travel time from Earth). */
const TRANSIT_DELAY: Readonly<Record<string, number>> = Object.freeze({
  EARTH: 0,
  MOON: 1,
  MARS: 3,
  CERES: 4,
  JUPITER: 6,
  SATURN: 8,
  TITAN: 8,
});

/** Default transit delay for unknown bodies. */
const DEFAULT_TRANSIT_DELAY = 5;

// ---------------------------------------------------------------------------
// Transfer Cost Constants
// ---------------------------------------------------------------------------

/** Cost for transferring crew between hubs on the same body. */
const SAME_BODY_TRANSFER_COST = 10_000;

/** Base cost for inter-body crew transfer (no route connection). */
const BASE_INTER_BODY_TRANSFER_COST = 50_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the transit delay in periods for a given body.
 * Used to determine how long a crew member is in transit after hiring or transfer.
 */
export function getTransitDelay(bodyId: string): number {
  if (bodyId in TRANSIT_DELAY) {
    return TRANSIT_DELAY[bodyId];
  }
  return DEFAULT_TRANSIT_DELAY;
}

/**
 * Checks whether an active route connects two bodies (in either direction).
 * Looks through all route legs to find a connection.
 */
function routeConnectsBodies(state: GameState, bodyIdA: string, bodyIdB: string): boolean {
  const routes = state.routes;
  if (!routes || routes.length === 0) return false;

  for (const route of routes) {
    if (route.status !== 'active') continue;
    for (const leg of route.legs) {
      const oBody = leg.origin.bodyId;
      const dBody = leg.destination.bodyId;
      if ((oBody === bodyIdA && dBody === bodyIdB) || (oBody === bodyIdB && dBody === bodyIdA)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns all active, non-in-transit crew stationed at the given hub.
 */
export function getCrewAtHub(state: GameState, hubId: string): CrewMember[] {
  return state.crew.filter(c =>
    c.stationedHubId === hubId &&
    c.status === AstronautStatus.ACTIVE &&
    (c.transitUntil === null || c.transitUntil <= state.currentPeriod),
  );
}

/**
 * Hires a new crew member at the specified hub.
 *
 * Cost = HIRE_COST * import tax multiplier for the hub's body.
 * Earth hires are immediate (transitUntil = null).
 * Off-world hires have a transit delay based on the body.
 *
 * Returns the new CrewMember, or null if the hub is not found or funds are insufficient.
 */
export function hireCrewAtHub(
  state: GameState,
  hubId: string,
  crewData: { name: string; salary?: number },
): CrewMember | null {
  const hub = getHub(state, hubId);
  if (!hub) return null;

  const cost = HIRE_COST * getImportTaxMultiplier(hub.bodyId);
  if (!spend(state, cost)) return null;

  const id = 'crew-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const member = createCrewMember({
    id,
    name: crewData.name,
    salary: crewData.salary ?? 2_000,
    hireDate: new Date().toISOString(),
  });

  member.stationedHubId = hubId;

  if (hubId === EARTH_HUB_ID || hub.bodyId === 'EARTH') {
    member.transitUntil = null;
  } else {
    member.transitUntil = state.currentPeriod + getTransitDelay(hub.bodyId);
  }

  state.crew.push(member);
  return member;
}

/**
 * Returns the cost to transfer a crew member between two hubs.
 *
 * - Same hub: 0
 * - Same body: 10,000
 * - Route connects the bodies: 0 (free transfer via existing logistics)
 * - Otherwise: 50,000 * destination import tax multiplier
 */
export function getTransferCost(state: GameState, fromHubId: string, toHubId: string): number {
  if (fromHubId === toHubId) return 0;

  const fromHub = getHub(state, fromHubId);
  const toHub = getHub(state, toHubId);
  if (!fromHub || !toHub) return 0;

  if (fromHub.bodyId === toHub.bodyId) return SAME_BODY_TRANSFER_COST;

  // Free transfer if an active route connects the two bodies
  if (routeConnectsBodies(state, fromHub.bodyId, toHub.bodyId)) return 0;

  // Distance-based cost using the destination's import tax multiplier
  return BASE_INTER_BODY_TRANSFER_COST * getImportTaxMultiplier(toHub.bodyId);
}

/**
 * Requests a crew transfer from the crew member's current hub to a destination hub.
 *
 * Deducts the transfer cost. Sets the crew member's stationedHubId to the
 * destination and applies a transit delay based on the destination body.
 * Transfers to Earth are instant (transitUntil = null).
 *
 * Returns true on success, false if the crew member is not found, not active,
 * or insufficient funds.
 */
export function requestCrewTransfer(state: GameState, crewId: string, toHubId: string): boolean {
  const member = state.crew.find(c => c.id === crewId);
  if (!member || member.status !== AstronautStatus.ACTIVE) return false;

  const fromHubId = member.stationedHubId;
  const toHub = getHub(state, toHubId);
  if (!toHub) return false;

  const cost = getTransferCost(state, fromHubId, toHubId);
  if (cost > 0 && !spend(state, cost)) return false;

  member.stationedHubId = toHubId;

  if (toHubId === EARTH_HUB_ID || toHub.bodyId === 'EARTH') {
    member.transitUntil = null;
  } else {
    member.transitUntil = state.currentPeriod + getTransitDelay(toHub.bodyId);
  }

  return true;
}

/**
 * Processes crew transits: clears transitUntil for crew whose transit period has elapsed.
 * Called once per period from advancePeriod().
 */
export function processCrewTransits(state: GameState): void {
  for (const member of state.crew) {
    if (member.transitUntil !== null && member.transitUntil <= state.currentPeriod) {
      member.transitUntil = null;
    }
  }
}

/**
 * hubTourists.ts — Tourist management functions for off-world hubs.
 *
 * Handles capacity checks, tourist admission, per-period revenue crediting,
 * departure processing, and eviction when a hub goes offline.
 *
 * @module core/hubTourists
 */

import type { GameState } from './gameState.ts';
import type { Hub, Tourist } from './hubTypes.ts';
import { getCrewAtHub } from './hubCrew.ts';
import { CREW_HAB_CAPACITY } from '../data/hubFacilities.ts';

// ---------------------------------------------------------------------------
// Capacity
// ---------------------------------------------------------------------------

/**
 * Returns the total crew + tourist capacity from the hub's Crew Hab tier.
 * Returns 0 if the hub has no Crew Hab facility.
 */
export function getHubCapacity(hub: Hub): number {
  const crewHab = hub.facilities['crew-hab'];
  if (!crewHab) return 0;
  return CREW_HAB_CAPACITY[crewHab.tier] ?? 0;
}

/**
 * Returns the remaining capacity at a hub (capacity minus current occupancy).
 * Occupancy = active non-in-transit crew + tourists.
 */
export function getHubCapacityRemaining(state: GameState, hub: Hub): number {
  const capacity = getHubCapacity(hub);
  const crewCount = getCrewAtHub(state, hub.id).length;
  const touristCount = hub.tourists.length;
  return capacity - crewCount - touristCount;
}

// ---------------------------------------------------------------------------
// Tourist Admission
// ---------------------------------------------------------------------------

/**
 * Adds a tourist to a hub if there is remaining capacity.
 * Returns true if the tourist was added, false if the hub is full.
 */
export function addTourist(state: GameState, hub: Hub, tourist: Tourist): boolean {
  if (getHubCapacityRemaining(state, hub) <= 0) return false;
  hub.tourists.push(tourist);
  return true;
}

// ---------------------------------------------------------------------------
// Period Processing
// ---------------------------------------------------------------------------

/**
 * Credits revenue for each tourist and removes departed tourists.
 * Called once per period from advancePeriod().
 */
export function processTouristRevenue(state: GameState): void {
  for (const hub of state.hubs) {
    // Credit revenue for each tourist
    for (const tourist of hub.tourists) {
      state.money += tourist.revenue;
    }

    // Remove departed tourists
    hub.tourists = hub.tourists.filter(t => t.departurePeriod > state.currentPeriod);
  }
}

// ---------------------------------------------------------------------------
// Eviction
// ---------------------------------------------------------------------------

/**
 * Evicts all tourists from a hub. Called when a hub goes offline.
 */
export function evictTourists(hub: Hub): void {
  hub.tourists = [];
}

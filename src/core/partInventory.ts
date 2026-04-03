/**
 * partInventory.ts — Part wear and reusability system.
 *
 * Recovered parts go into `state.partInventory` with wear tracking.
 * Each flight adds wear based on stress:
 *   - Engines:  high wear (15 %)
 *   - SRBs:     very high wear (40 %)
 *   - Passive:  low wear (5 %)
 *
 * Wear 0–100 % affects reliability:
 *   effectiveReliability = baseReliability × (1 - wear/100 × 0.5)
 *
 * Players can refurbish (30 % cost → wear reset to 10 %) or scrap (sell for
 * 15 % of base cost) inventory parts.
 *
 * @module core/partInventory
 */

import { getPartById } from '../data/parts.js';
import {
  PartType,
  WEAR_PER_FLIGHT_PASSIVE,
  WEAR_PER_FLIGHT_ENGINE,
  WEAR_PER_FLIGHT_SRB,
  WEAR_RELIABILITY_FACTOR,
  REFURBISH_COST_FRACTION,
  WEAR_AFTER_REFURBISH,
  SCRAP_VALUE_FRACTION,
} from './constants.js';
import { earn, spend } from './finance.js';
import type { GameState, InventoryPart } from './gameState.js';
import type { RocketAssembly, PhysicsState } from './physics.js';

// ---------------------------------------------------------------------------
// Wear calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the wear to add for a single flight based on part type.
 *
 * @param partType - PartType enum value.
 * @returns Wear percentage points to add (0–100 scale).
 */
export function getFlightWear(partType: string): number {
  switch (partType) {
    case PartType.ENGINE:
      return WEAR_PER_FLIGHT_ENGINE;
    case PartType.SOLID_ROCKET_BOOSTER:
      return WEAR_PER_FLIGHT_SRB;
    default:
      return WEAR_PER_FLIGHT_PASSIVE;
  }
}

/**
 * Compute effective reliability for a part given its base reliability and wear.
 *
 * @param baseReliability - Part catalog reliability (0–1).
 * @param wear - Current wear level (0–100).
 * @returns Effective reliability (0–1).
 */
export function getEffectiveReliability(baseReliability: number, wear: number): number {
  return baseReliability * (1 - (wear / 100) * WEAR_RELIABILITY_FACTOR);
}

// ---------------------------------------------------------------------------
// Inventory operations
// ---------------------------------------------------------------------------

/**
 * Generate a unique inventory entry ID.
 */
function _generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `inv-${crypto.randomUUID()}`;
  }
  return `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Add a recovered part to the player's inventory.
 *
 * @param state - Game state.
 * @param partId - Catalog part ID.
 * @param wear - Wear level (0–100).
 * @param flights - Number of flights the part has been through.
 * @returns The created inventory entry.
 */
export function addToInventory(
  state: GameState,
  partId: string,
  wear: number,
  flights: number = 1,
): InventoryPart {
  if (!Array.isArray(state.partInventory)) {
    state.partInventory = [];
  }
  const entry: InventoryPart = {
    id: _generateId(),
    partId,
    wear: Math.min(100, Math.max(0, wear)),
    flights,
  };
  state.partInventory.push(entry);
  return entry;
}

/**
 * Remove an inventory entry by its unique ID.
 *
 * @param state - Game state.
 * @param inventoryId - Unique ID of the inventory entry.
 * @returns The removed entry, or null.
 */
export function removeFromInventory(state: GameState, inventoryId: string): InventoryPart | null {
  if (!Array.isArray(state.partInventory)) return null;
  const idx = state.partInventory.findIndex((e) => e.id === inventoryId);
  if (idx < 0) return null;
  return state.partInventory.splice(idx, 1)[0];
}

/**
 * Get the count of inventory parts for a specific catalog part ID.
 */
export function getInventoryCount(state: GameState, partId: string): number {
  if (!Array.isArray(state.partInventory)) return 0;
  return state.partInventory.filter((e) => e.partId === partId).length;
}

/**
 * Get all inventory entries for a specific catalog part ID, sorted by wear
 * (lowest wear first — best condition first).
 */
export function getInventoryForPart(state: GameState, partId: string): InventoryPart[] {
  if (!Array.isArray(state.partInventory)) return [];
  return state.partInventory
    .filter((e) => e.partId === partId)
    .sort((a, b) => a.wear - b.wear);
}

export interface RefurbishResult {
  success: boolean;
  cost?: number;
  entry?: InventoryPart;
}

/**
 * Refurbish an inventory part: pay 30 % of base cost, reset wear to 10 %.
 */
export function refurbishPart(state: GameState, inventoryId: string): RefurbishResult {
  if (!Array.isArray(state.partInventory)) return { success: false };
  const entry = state.partInventory.find((e) => e.id === inventoryId);
  if (!entry) return { success: false };

  const def = getPartById(entry.partId);
  if (!def) return { success: false };

  const cost = Math.round(def.cost * REFURBISH_COST_FRACTION);
  if (!spend(state, cost)) return { success: false };

  entry.wear = WEAR_AFTER_REFURBISH;
  return { success: true, cost, entry };
}

export interface ScrapResult {
  success: boolean;
  value?: number;
}

/**
 * Scrap an inventory part: remove it and earn 15 % of base cost.
 */
export function scrapPart(state: GameState, inventoryId: string): ScrapResult {
  const entry = removeFromInventory(state, inventoryId);
  if (!entry) return { success: false };

  const def = getPartById(entry.partId);
  if (!def) return { success: false };

  const value = Math.round(def.cost * SCRAP_VALUE_FRACTION);
  if (value > 0) earn(state, value);
  return { success: true, value };
}

/**
 * Use (consume) the best-condition inventory part of the given catalog ID.
 * Returns the entry that was removed, or null if none available.
 */
export function useInventoryPart(state: GameState, partId: string): InventoryPart | null {
  const available = getInventoryForPart(state, partId);
  if (available.length === 0) return null;
  // Use the lowest-wear part first.
  return removeFromInventory(state, available[0].id);
}

export interface RecoverPartsResult {
  partsRecovered: number;
  entries: InventoryPart[];
}

/**
 * Recover parts from a completed flight into inventory.
 * Called from flightReturn.js when the rocket lands safely.
 *
 * @param state - Game state.
 * @param assembly - The rocket assembly.
 * @param ps - Physics state for active part filtering.
 * @param usedInventoryParts - Map of instanceId → InventoryPart for parts that came from
 *   inventory (so we accumulate wear on top of their existing wear).
 */
export function recoverPartsToInventory(
  state: GameState,
  assembly: RocketAssembly,
  ps: PhysicsState,
  usedInventoryParts: Map<string, InventoryPart> | null,
): RecoverPartsResult {
  const entries: InventoryPart[] = [];
  let partsRecovered = 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const flightWear = getFlightWear(def.type);
    const existingEntry = usedInventoryParts?.get(instanceId);
    const previousWear = existingEntry ? existingEntry.wear : 0;
    const previousFlights = existingEntry ? existingEntry.flights : 0;
    const totalWear = Math.min(100, previousWear + flightWear);

    // Don't add parts with 100% wear — they're too worn out.
    if (totalWear >= 100) continue;

    const entry = addToInventory(state, placed.partId, totalWear, previousFlights + 1);
    entries.push(entry);
    partsRecovered++;
  }

  return { partsRecovered, entries };
}

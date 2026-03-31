/**
 * partInventory.js — Part wear and reusability system.
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

// ---------------------------------------------------------------------------
// Wear calculation
// ---------------------------------------------------------------------------

/**
 * Calculate the wear to add for a single flight based on part type.
 *
 * @param {string} partType  PartType enum value.
 * @returns {number}  Wear percentage points to add (0–100 scale).
 */
export function getFlightWear(partType) {
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
 * @param {number} baseReliability  Part catalog reliability (0–1).
 * @param {number} wear             Current wear level (0–100).
 * @returns {number}  Effective reliability (0–1).
 */
export function getEffectiveReliability(baseReliability, wear) {
  return baseReliability * (1 - (wear / 100) * WEAR_RELIABILITY_FACTOR);
}

// ---------------------------------------------------------------------------
// Inventory operations
// ---------------------------------------------------------------------------

/**
 * Generate a unique inventory entry ID.
 * @returns {string}
 */
function _generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `inv-${crypto.randomUUID()}`;
  }
  return `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Add a recovered part to the player's inventory.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} partId        Catalog part ID.
 * @param {number} wear          Wear level (0–100).
 * @param {number} [flights=1]   Number of flights the part has been through.
 * @returns {import('./gameState.js').InventoryPart}  The created inventory entry.
 */
export function addToInventory(state, partId, wear, flights = 1) {
  if (!Array.isArray(state.partInventory)) {
    state.partInventory = [];
  }
  const entry = {
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
 * @param {import('./gameState.js').GameState} state
 * @param {string} inventoryId
 * @returns {import('./gameState.js').InventoryPart | null}  The removed entry, or null.
 */
export function removeFromInventory(state, inventoryId) {
  if (!Array.isArray(state.partInventory)) return null;
  const idx = state.partInventory.findIndex((e) => e.id === inventoryId);
  if (idx < 0) return null;
  return state.partInventory.splice(idx, 1)[0];
}

/**
 * Get the count of inventory parts for a specific catalog part ID.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} partId
 * @returns {number}
 */
export function getInventoryCount(state, partId) {
  if (!Array.isArray(state.partInventory)) return 0;
  return state.partInventory.filter((e) => e.partId === partId).length;
}

/**
 * Get all inventory entries for a specific catalog part ID, sorted by wear
 * (lowest wear first — best condition first).
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} partId
 * @returns {import('./gameState.js').InventoryPart[]}
 */
export function getInventoryForPart(state, partId) {
  if (!Array.isArray(state.partInventory)) return [];
  return state.partInventory
    .filter((e) => e.partId === partId)
    .sort((a, b) => a.wear - b.wear);
}

/**
 * Refurbish an inventory part: pay 30 % of base cost, reset wear to 10 %.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} inventoryId
 * @returns {{ success: boolean, cost?: number, entry?: import('./gameState.js').InventoryPart }}
 */
export function refurbishPart(state, inventoryId) {
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

/**
 * Scrap an inventory part: remove it and earn 15 % of base cost.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} inventoryId
 * @returns {{ success: boolean, value?: number }}
 */
export function scrapPart(state, inventoryId) {
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
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} partId
 * @returns {import('./gameState.js').InventoryPart | null}
 */
export function useInventoryPart(state, partId) {
  const available = getInventoryForPart(state, partId);
  if (available.length === 0) return null;
  // Use the lowest-wear part first.
  return removeFromInventory(state, available[0].id);
}

/**
 * Recover parts from a completed flight into inventory.
 * Called from flightReturn.js when the rocket lands safely.
 *
 * @param {import('./gameState.js').GameState}                     state
 * @param {import('./rocketbuilder.js').RocketAssembly}            assembly
 * @param {import('./physics.js').PhysicsState}                    ps
 * @param {Map<string, import('./gameState.js').InventoryPart>|null} usedInventoryParts
 *   Map of instanceId → InventoryPart for parts that came from inventory
 *   (so we accumulate wear on top of their existing wear).
 * @returns {{ partsRecovered: number, entries: import('./gameState.js').InventoryPart[] }}
 */
export function recoverPartsToInventory(state, assembly, ps, usedInventoryParts) {
  const entries = [];
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

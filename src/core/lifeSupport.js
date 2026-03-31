/**
 * lifeSupport.js — Crew life support system.
 *
 * Tracks supply countdowns for crewed vessels left in the field (orbit or
 * landed on non-Earth bodies).  Each command module provides 5 periods of
 * life support by default.  The Extended Mission Module makes supplies
 * infinite — a binary check (present or not, no stacking).
 *
 * Supply countdown only applies while crew are in a stable state (orbit
 * or safely landed on a body), not during active flight.  At 1 period
 * remaining, a warning is surfaced.  At 0 periods, crew die.
 *
 * Called once per period from advancePeriod().
 *
 * @module core/lifeSupport
 */

import { recordKIA } from './crew.js';
import {
  DEFAULT_LIFE_SUPPORT_PERIODS,
  LIFE_SUPPORT_WARNING_THRESHOLD,
  FieldCraftStatus,
} from './constants.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} LifeSupportResult
 * @property {Array<{craftId: string, craftName: string, suppliesRemaining: number, crewIds: string[]}>} warnings
 *   Craft at or below the warning threshold (1 period remaining).
 * @property {Array<{craftId: string, craftName: string, crewId: string, crewName: string}>} deaths
 *   Crew members who died from life support exhaustion this period.
 * @property {string[]} removedCraftIds
 *   IDs of field craft that were removed (all crew dead, no one left).
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Process life support for all crewed field vessels.
 *
 * For each field craft without the Extended Mission Module:
 *   1. Decrement suppliesRemaining by 1.
 *   2. If supplies reach 0, kill all crew aboard via recordKIA().
 *   3. If supplies are at the warning threshold, add to warnings.
 *
 * Field craft whose crew are all dead are removed from the array.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {LifeSupportResult}
 */
export function processLifeSupport(state) {
  if (!Array.isArray(state.fieldCraft)) {
    state.fieldCraft = [];
  }

  /** @type {LifeSupportResult['warnings']} */
  const warnings = [];
  /** @type {LifeSupportResult['deaths']} */
  const deaths = [];
  /** @type {string[]} */
  const removedCraftIds = [];

  for (const craft of state.fieldCraft) {
    // Extended Mission Module = infinite supplies, skip countdown.
    if (craft.hasExtendedLifeSupport) continue;

    // No crew aboard — nothing to tick.
    if (!Array.isArray(craft.crewIds) || craft.crewIds.length === 0) continue;

    // Tick down one period of supply.
    craft.suppliesRemaining = (craft.suppliesRemaining ?? 0) - 1;

    if (craft.suppliesRemaining <= 0) {
      // Life support exhausted — all crew die.
      for (const crewId of craft.crewIds) {
        const astronaut = state.crew.find((a) => a.id === crewId);
        if (astronaut && astronaut.status !== 'kia') {
          const crewName = astronaut.name;
          recordKIA(state, crewId, 'Life support exhausted');
          deaths.push({
            craftId: craft.id,
            craftName: craft.name,
            crewId,
            crewName,
          });
        }
      }
      // Clear crew from craft (they're dead).
      craft.crewIds = [];
    } else if (craft.suppliesRemaining <= LIFE_SUPPORT_WARNING_THRESHOLD) {
      // Warning: supplies critically low.
      warnings.push({
        craftId: craft.id,
        craftName: craft.name,
        suppliesRemaining: craft.suppliesRemaining,
        crewIds: [...craft.crewIds],
      });
    }
  }

  // Remove field craft with no crew left.
  const before = state.fieldCraft.length;
  state.fieldCraft = state.fieldCraft.filter((c) => {
    if (c.crewIds.length === 0) {
      removedCraftIds.push(c.id);
      return false;
    }
    return true;
  });

  return { warnings, deaths, removedCraftIds };
}

/**
 * Check whether a rocket assembly includes the Extended Mission Module.
 * Binary check: one module = infinite support, does not stack.
 *
 * @param {import('../core/rocketbuilder.js').RocketAssembly|null} assembly
 * @param {import('../core/physics.js').PhysicsState|null} ps  - Optional physics state to check only active parts.
 * @returns {boolean}
 */
export function hasExtendedLifeSupport(assembly, ps) {
  if (!assembly) return false;

  for (const [instanceId, placed] of assembly.parts) {
    // If physics state available, only check active (non-destroyed) parts.
    if (ps && !ps.activeParts.has(instanceId)) continue;

    const def = getPartById(placed.partId);
    if (def && def.properties && def.properties.extendedLifeSupport) {
      return true;
    }
  }
  return false;
}

/**
 * Create a field craft entry when a crewed vessel is left in orbit or
 * landed on a non-Earth body upon flight return.
 *
 * @param {object} opts
 * @param {string} opts.name               - Display name of the craft.
 * @param {string} opts.bodyId             - Celestial body the craft is at.
 * @param {string} opts.status             - FieldCraftStatus value.
 * @param {string[]} opts.crewIds          - Crew member IDs aboard.
 * @param {boolean} opts.hasExtendedLifeSupport - True if Extended Mission Module present.
 * @param {number} opts.deployedPeriod     - Current period number.
 * @param {import('./gameState.js').OrbitalElements|null} [opts.orbitalElements] - Orbital elements.
 * @param {string|null} [opts.orbitBandId] - Altitude band.
 * @returns {import('./gameState.js').FieldCraft}
 */
export function createFieldCraft({
  name,
  bodyId,
  status,
  crewIds,
  hasExtendedLifeSupport: extendedSupport,
  deployedPeriod,
  orbitalElements = null,
  orbitBandId = null,
}) {
  const id = _generateId();
  return {
    id,
    name,
    bodyId,
    status,
    crewIds: [...crewIds],
    suppliesRemaining: DEFAULT_LIFE_SUPPORT_PERIODS,
    hasExtendedLifeSupport: extendedSupport,
    deployedPeriod,
    orbitalElements: orbitalElements ? { ...orbitalElements } : null,
    orbitBandId,
  };
}

/**
 * Get all field craft that have a supply warning (at or below threshold).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('./gameState.js').FieldCraft[]}
 */
export function getFieldCraftWarnings(state) {
  if (!Array.isArray(state.fieldCraft)) return [];
  return state.fieldCraft.filter(
    (c) =>
      !c.hasExtendedLifeSupport &&
      c.crewIds.length > 0 &&
      c.suppliesRemaining <= LIFE_SUPPORT_WARNING_THRESHOLD,
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `fc-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

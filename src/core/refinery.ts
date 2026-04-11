/**
 * refinery.ts — Refinery recipe processing for the ISRU mining system.
 *
 * Defines refinery recipes (resource conversions) and processes refinery
 * modules on mining sites, consuming inputs and producing outputs scaled
 * by site power efficiency.
 *
 * @module core/refinery
 */

import type { GameState, MiningSite } from './gameState.ts';
import type { ResourceType } from './constants.ts';
import { MiningModuleType } from './constants.ts';
import { ResourceType as RT } from './constants.ts';
import { getPowerEfficiency, getConnectedStorage, recomputeSiteStorage } from './mining.ts';
import { RESOURCES_BY_ID } from '../data/resources.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single resource entry in a recipe (input or output). */
export interface RecipeEntry {
  resourceType: ResourceType;
  amountKg: number;
}

/** A refinery recipe converting input resources into output resources. */
export interface RefineryRecipe {
  id: string;
  name: string;
  inputs: readonly RecipeEntry[];
  outputs: readonly RecipeEntry[];
}

// ---------------------------------------------------------------------------
// Recipe Catalog
// ---------------------------------------------------------------------------

/**
 * Master list of all refinery recipes.
 * Frozen at module load — never mutated at runtime.
 */
export const REFINERY_RECIPES: readonly RefineryRecipe[] = Object.freeze([
  {
    id: 'water-electrolysis',
    name: 'Water Electrolysis',
    inputs: Object.freeze([{ resourceType: RT.WATER_ICE, amountKg: 100 }]),
    outputs: Object.freeze([
      { resourceType: RT.HYDROGEN, amountKg: 11 },
      { resourceType: RT.OXYGEN, amountKg: 89 },
    ]),
  },
  {
    id: 'sabatier-process',
    name: 'Sabatier Process',
    inputs: Object.freeze([
      { resourceType: RT.CO2, amountKg: 100 },
      { resourceType: RT.HYDROGEN, amountKg: 8 },
    ]),
    outputs: Object.freeze([
      { resourceType: RT.LIQUID_METHANE, amountKg: 33 },
      { resourceType: RT.OXYGEN, amountKg: 75 },
    ]),
  },
  {
    id: 'regolith-electrolysis',
    name: 'Regolith Electrolysis',
    inputs: Object.freeze([{ resourceType: RT.REGOLITH, amountKg: 100 }]),
    outputs: Object.freeze([{ resourceType: RT.OXYGEN, amountKg: 15 }]),
  },
  {
    id: 'hydrazine-synthesis',
    name: 'Hydrazine Synthesis',
    inputs: Object.freeze([{ resourceType: RT.HYDROGEN, amountKg: 50 }]),
    outputs: Object.freeze([{ resourceType: RT.HYDRAZINE, amountKg: 40 }]),
  },
] as const);

/**
 * Fast lookup of refinery recipes by recipe ID.
 * Built once from the REFINERY_RECIPES array and frozen.
 */
export const RECIPES_BY_ID: Readonly<Record<string, RefineryRecipe>> = Object.freeze(
  REFINERY_RECIPES.reduce(
    (acc, r) => {
      acc[r.id] = r;
      return acc;
    },
    {} as Record<string, RefineryRecipe>,
  ),
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set a refinery recipe on a module.
 *
 * Finds the module on the site, verifies it is a REFINERY type, and sets
 * `module.recipeId`. Returns `false` if the module is not found, is not a
 * refinery, or the recipe ID is unknown.
 */
export function setRefineryRecipe(site: MiningSite, moduleId: string, recipeId: string): boolean {
  const mod = site.modules.find((m) => m.id === moduleId);
  if (!mod || mod.type !== MiningModuleType.REFINERY) return false;
  if (!RECIPES_BY_ID[recipeId]) return false;

  mod.recipeId = recipeId;
  return true;
}

/**
 * Get the refinery recipe assigned to a module.
 *
 * Returns the recipe object for the module's `recipeId`, or `null` if the
 * module is not found, is not a refinery, or has no recipe set.
 */
export function getRefineryRecipe(site: MiningSite, moduleId: string): RefineryRecipe | null {
  const mod = site.modules.find((m) => m.id === moduleId);
  if (!mod || mod.type !== MiningModuleType.REFINERY) return null;
  if (!mod.recipeId) return null;

  return RECIPES_BY_ID[mod.recipeId] ?? null;
}

/**
 * Process all refinery modules across all mining sites.
 *
 * For each REFINERY module with a recipe set:
 * 1. Get the site's power efficiency (0–1).
 * 2. Scale all recipe input/output amounts by efficiency.
 * 3. For each input, find connected storage modules and sum the available
 *    amount of that resource across their `stored` fields. Skip if insufficient.
 * 4. For each output, find connected storage modules and sum remaining
 *    capacity. Skip if insufficient space.
 * 5. Consume inputs proportionally from source modules based on each
 *    module's share of the resource.
 * 6. Produce outputs proportionally to connected storage based on each
 *    module's remaining capacity share.
 * 7. After all refineries on a site are processed, recompute `site.storage`.
 */
export function processRefineries(state: GameState): { produced: Partial<Record<ResourceType, number>>; consumed: Partial<Record<ResourceType, number>> } {
  const produced: Partial<Record<ResourceType, number>> = {};
  const consumed: Partial<Record<ResourceType, number>> = {};
  for (const site of state.miningSites) {
    const efficiency = getPowerEfficiency(site);
    if (efficiency <= 0) continue;

    for (const mod of site.modules) {
      if (mod.type !== MiningModuleType.REFINERY) continue;
      if (!mod.recipeId) continue;

      const recipe = RECIPES_BY_ID[mod.recipeId];
      if (!recipe) continue;

      // Check connected storage exists for each input resource's state
      // and that sufficient resources are available across connected modules
      let storageOk = true;
      let inputsAvailable = true;
      for (const input of recipe.inputs) {
        const resDef = RESOURCES_BY_ID[input.resourceType];
        if (!resDef) { storageOk = false; break; }
        const connected = getConnectedStorage(site, mod.id, resDef.state);
        if (connected.length === 0) { storageOk = false; break; }

        // Sum available amount from connected modules' stored fields
        let totalAvailable = 0;
        for (const sm of connected) {
          totalAvailable += (sm.stored?.[input.resourceType] ?? 0);
        }
        const needed = input.amountKg * efficiency;
        if (totalAvailable < needed) {
          inputsAvailable = false;
          break;
        }
      }
      if (!storageOk || !inputsAvailable) continue;

      // Check connected storage exists for each output resource's state
      // and that sufficient capacity exists
      for (const output of recipe.outputs) {
        const resDef = RESOURCES_BY_ID[output.resourceType];
        if (!resDef) { storageOk = false; break; }
        const connected = getConnectedStorage(site, mod.id, resDef.state);
        if (connected.length === 0) { storageOk = false; break; }

        // Sum remaining capacity across connected storage modules
        let totalRemaining = 0;
        for (const sm of connected) {
          const cap = sm.storageCapacityKg ?? 0;
          let usedKg = 0;
          if (sm.stored) {
            for (const amt of Object.values(sm.stored)) {
              usedKg += (amt as number) ?? 0;
            }
          }
          totalRemaining += Math.max(0, cap - usedKg);
        }
        const produceAmt = output.amountKg * efficiency;
        if (totalRemaining < produceAmt) {
          storageOk = false;
          break;
        }
      }
      if (!storageOk) continue;

      // Consume inputs proportionally from source modules
      for (const input of recipe.inputs) {
        const consumeAmt = input.amountKg * efficiency;
        const resDef = RESOURCES_BY_ID[input.resourceType]!;
        const connected = getConnectedStorage(site, mod.id, resDef.state);

        // Calculate total available across connected modules
        let totalAvailable = 0;
        for (const sm of connected) {
          totalAvailable += (sm.stored?.[input.resourceType] ?? 0);
        }

        // Deduct proportionally from each module
        for (const sm of connected) {
          const moduleAmount = sm.stored?.[input.resourceType] ?? 0;
          if (moduleAmount <= 0 || totalAvailable <= 0) continue;
          const deduction = consumeAmt * (moduleAmount / totalAvailable);
          if (!sm.stored) sm.stored = {};
          sm.stored[input.resourceType] = (sm.stored[input.resourceType] ?? 0) - deduction;
        }

        consumed[input.resourceType] = (consumed[input.resourceType] ?? 0) + consumeAmt;
      }

      // Produce outputs proportionally to connected storage by remaining capacity
      for (const output of recipe.outputs) {
        const produceAmt = output.amountKg * efficiency;
        const resDef = RESOURCES_BY_ID[output.resourceType]!;
        const connected = getConnectedStorage(site, mod.id, resDef.state);

        // Calculate total remaining capacity across connected modules
        let totalRemaining = 0;
        for (const sm of connected) {
          const cap = sm.storageCapacityKg ?? 0;
          let usedKg = 0;
          if (sm.stored) {
            for (const amt of Object.values(sm.stored)) {
              usedKg += (amt as number) ?? 0;
            }
          }
          totalRemaining += Math.max(0, cap - usedKg);
        }

        // Distribute proportionally by remaining capacity
        for (const sm of connected) {
          const cap = sm.storageCapacityKg ?? 0;
          let usedKg = 0;
          if (sm.stored) {
            for (const amt of Object.values(sm.stored)) {
              usedKg += (amt as number) ?? 0;
            }
          }
          const moduleRemaining = Math.max(0, cap - usedKg);
          if (moduleRemaining <= 0 || totalRemaining <= 0) continue;
          const addition = produceAmt * (moduleRemaining / totalRemaining);
          if (!sm.stored) sm.stored = {};
          sm.stored[output.resourceType] = (sm.stored[output.resourceType] ?? 0) + addition;
        }

        produced[output.resourceType] = (produced[output.resourceType] ?? 0) + produceAmt;
      }
    }

    // Recompute site.storage from module-level stored values
    recomputeSiteStorage(site);
  }
  return { produced, consumed };
}

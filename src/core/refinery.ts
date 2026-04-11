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
import { getPowerEfficiency, getConnectedStorage } from './mining.ts';
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
 * 3. Verify that connected storage of the correct type exists for every
 *    input and output resource.
 * 4. Check that all scaled inputs are available in `site.storage`.
 * 5. If all checks pass: consume inputs, produce outputs.
 * 6. If any check fails: skip this module.
 */
export function processRefineries(state: GameState): void {
  for (const site of state.miningSites) {
    const efficiency = getPowerEfficiency(site);
    if (efficiency <= 0) continue;

    for (const mod of site.modules) {
      if (mod.type !== MiningModuleType.REFINERY) continue;
      if (!mod.recipeId) continue;

      const recipe = RECIPES_BY_ID[mod.recipeId];
      if (!recipe) continue;

      // Check connected storage exists for each input resource's state
      let storageOk = true;
      for (const input of recipe.inputs) {
        const resDef = RESOURCES_BY_ID[input.resourceType];
        if (!resDef) { storageOk = false; break; }
        const connected = getConnectedStorage(site, mod.id, resDef.state);
        if (connected.length === 0) { storageOk = false; break; }
      }
      if (!storageOk) continue;

      // Check connected storage exists for each output resource's state
      for (const output of recipe.outputs) {
        const resDef = RESOURCES_BY_ID[output.resourceType];
        if (!resDef) { storageOk = false; break; }
        const connected = getConnectedStorage(site, mod.id, resDef.state);
        if (connected.length === 0) { storageOk = false; break; }
      }
      if (!storageOk) continue;

      // Check all scaled inputs are available
      let inputsAvailable = true;
      for (const input of recipe.inputs) {
        const needed = input.amountKg * efficiency;
        const available = site.storage[input.resourceType] ?? 0;
        if (available < needed) {
          inputsAvailable = false;
          break;
        }
      }
      if (!inputsAvailable) continue;

      // Consume inputs
      for (const input of recipe.inputs) {
        const consume = input.amountKg * efficiency;
        site.storage[input.resourceType] = (site.storage[input.resourceType] ?? 0) - consume;
      }

      // Produce outputs
      for (const output of recipe.outputs) {
        const produce = output.amountKg * efficiency;
        site.storage[output.resourceType] = (site.storage[output.resourceType] ?? 0) + produce;
      }
    }
  }
}

import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  createMiningSite,
  addModuleToSite,
  toggleConnection,
  getPowerEfficiency,
  recomputeSiteStorage,
} from '../core/mining.ts';
import { MiningModuleType, ResourceType } from '../core/constants.ts';
import {
  REFINERY_RECIPES,
  RECIPES_BY_ID,
  setRefineryRecipe,
  getRefineryRecipe,
  processRefineries,
} from '../core/refinery.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mining site with a power generator, refinery, and storage modules
 * for solid, gas, and liquid resources — all connected to the refinery.
 */
function buildRefinerySite(state: ReturnType<typeof createGameState>) {
  const site = createMiningSite(state, {
    name: 'Refinery Test Site',
    bodyId: 'MOON',
    coordinates: { x: 0, y: 0 },
    controlUnitPartId: 'base-control-unit-mk1',
  });

  const generator = addModuleToSite(state, site, {
    partId: 'power-generator-solar-mk1',
    type: MiningModuleType.POWER_GENERATOR,
    powerDraw: 0,
    powerOutput: 100,
  });

  const refinery = addModuleToSite(state, site, {
    partId: 'refinery-mk1',
    type: MiningModuleType.REFINERY,
    powerDraw: 40,
  });

  const silo = addModuleToSite(state, site, {
    partId: 'storage-silo-mk1',
    type: MiningModuleType.STORAGE_SILO,
    powerDraw: 2,
  });

  const pressureVessel = addModuleToSite(state, site, {
    partId: 'pressure-vessel-mk1',
    type: MiningModuleType.PRESSURE_VESSEL,
    powerDraw: 5,
  });

  const fluidTank = addModuleToSite(state, site, {
    partId: 'fluid-tank-mk1',
    type: MiningModuleType.FLUID_TANK,
    powerDraw: 8,
  });

  // Connect refinery to all storage types
  toggleConnection(site, refinery.id, silo.id);
  toggleConnection(site, refinery.id, pressureVessel.id);
  toggleConnection(site, refinery.id, fluidTank.id);

  return { site, generator, refinery, silo, pressureVessel, fluidTank };
}

// ---------------------------------------------------------------------------
// Recipe catalog tests
// ---------------------------------------------------------------------------

describe('Refinery recipe catalog', () => {
  it('REFINERY_RECIPES contains exactly 4 recipes', () => {
    expect(REFINERY_RECIPES).toHaveLength(4);
  });

  it('RECIPES_BY_ID has expected keys', () => {
    const keys = Object.keys(RECIPES_BY_ID);
    expect(keys).toContain('water-electrolysis');
    expect(keys).toContain('sabatier-process');
    expect(keys).toContain('regolith-electrolysis');
    expect(keys).toContain('hydrazine-synthesis');
    expect(keys).toHaveLength(4);
  });

  it('water-electrolysis has correct input/output amounts', () => {
    const recipe = RECIPES_BY_ID['water-electrolysis'];
    expect(recipe).toBeDefined();
    expect(recipe.name).toBe('Water Electrolysis');

    // Inputs: 100 kg Water Ice
    expect(recipe.inputs).toHaveLength(1);
    expect(recipe.inputs[0].resourceType).toBe(ResourceType.WATER_ICE);
    expect(recipe.inputs[0].amountKg).toBe(100);

    // Outputs: 11 kg Hydrogen + 89 kg Oxygen
    expect(recipe.outputs).toHaveLength(2);

    const hydrogen = recipe.outputs.find((o) => o.resourceType === ResourceType.HYDROGEN);
    const oxygen = recipe.outputs.find((o) => o.resourceType === ResourceType.OXYGEN);
    expect(hydrogen).toBeDefined();
    expect(hydrogen!.amountKg).toBe(11);
    expect(oxygen).toBeDefined();
    expect(oxygen!.amountKg).toBe(89);
  });

  it('sabatier-process has correct input/output amounts', () => {
    const recipe = RECIPES_BY_ID['sabatier-process'];
    expect(recipe.inputs).toHaveLength(2);
    expect(recipe.outputs).toHaveLength(2);

    const co2Input = recipe.inputs.find((i) => i.resourceType === ResourceType.CO2);
    const h2Input = recipe.inputs.find((i) => i.resourceType === ResourceType.HYDROGEN);
    expect(co2Input!.amountKg).toBe(100);
    expect(h2Input!.amountKg).toBe(8);

    const methaneOut = recipe.outputs.find((o) => o.resourceType === ResourceType.LIQUID_METHANE);
    const oxygenOut = recipe.outputs.find((o) => o.resourceType === ResourceType.OXYGEN);
    expect(methaneOut!.amountKg).toBe(33);
    expect(oxygenOut!.amountKg).toBe(75);
  });
});

// ---------------------------------------------------------------------------
// setRefineryRecipe / getRefineryRecipe
// ---------------------------------------------------------------------------

describe('setRefineryRecipe', () => {
  it('sets recipe on a REFINERY module and returns true', () => {
    const state = createGameState();
    const { site, refinery } = buildRefinerySite(state);

    const result = setRefineryRecipe(site, refinery.id, 'water-electrolysis');
    expect(result).toBe(true);
    expect(refinery.recipeId).toBe('water-electrolysis');
  });

  it('returns false for non-existent module', () => {
    const state = createGameState();
    const { site } = buildRefinerySite(state);

    const result = setRefineryRecipe(site, 'nonexistent-id', 'water-electrolysis');
    expect(result).toBe(false);
  });

  it('returns false for non-REFINERY module', () => {
    const state = createGameState();
    const { site, silo } = buildRefinerySite(state);

    const result = setRefineryRecipe(site, silo.id, 'water-electrolysis');
    expect(result).toBe(false);
  });

  it('returns false for unknown recipe ID', () => {
    const state = createGameState();
    const { site, refinery } = buildRefinerySite(state);

    const result = setRefineryRecipe(site, refinery.id, 'unknown-recipe');
    expect(result).toBe(false);
  });
});

describe('getRefineryRecipe', () => {
  it('returns the recipe object when set', () => {
    const state = createGameState();
    const { site, refinery } = buildRefinerySite(state);

    setRefineryRecipe(site, refinery.id, 'water-electrolysis');
    const recipe = getRefineryRecipe(site, refinery.id);

    expect(recipe).not.toBeNull();
    expect(recipe!.id).toBe('water-electrolysis');
    expect(recipe!.name).toBe('Water Electrolysis');
  });

  it('returns null when no recipe set', () => {
    const state = createGameState();
    const { site, refinery } = buildRefinerySite(state);

    const recipe = getRefineryRecipe(site, refinery.id);
    expect(recipe).toBeNull();
  });

  it('returns null for non-REFINERY module', () => {
    const state = createGameState();
    const { site, silo } = buildRefinerySite(state);

    const recipe = getRefineryRecipe(site, silo.id);
    expect(recipe).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// processRefineries
// ---------------------------------------------------------------------------

describe('processRefineries', () => {
  it('water electrolysis converts water ice to hydrogen and oxygen @smoke', () => {
    const state = createGameState();
    const { site, refinery, silo, pressureVessel } = buildRefinerySite(state);

    setRefineryRecipe(site, refinery.id, 'water-electrolysis');

    // Stock 100 kg of water ice in the silo's stored field
    silo.stored = { [ResourceType.WATER_ICE]: 100 };
    recomputeSiteStorage(site);

    // Power efficiency: gen=100, required=40+2+5+8=55 → efficiency=1.0 (clamped)
    expect(getPowerEfficiency(site)).toBe(1.0);

    processRefineries(state);

    // Water ice should be fully consumed at module level and site level
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(0);
    expect(site.storage[ResourceType.WATER_ICE] ?? 0).toBe(0);
    // Hydrogen produced: 11 kg * 1.0 efficiency — stored in pressure vessel
    expect(pressureVessel.stored![ResourceType.HYDROGEN]).toBe(11);
    expect(site.storage[ResourceType.HYDROGEN]).toBe(11);
    // Oxygen produced: 89 kg * 1.0 efficiency — stored in pressure vessel
    expect(pressureVessel.stored![ResourceType.OXYGEN]).toBe(89);
    expect(site.storage[ResourceType.OXYGEN]).toBe(89);
  });

  it('does not process when inputs are insufficient', () => {
    const state = createGameState();
    const { site, refinery, silo } = buildRefinerySite(state);

    setRefineryRecipe(site, refinery.id, 'water-electrolysis');

    // Only 50 kg water ice — recipe needs 100 kg at full efficiency
    silo.stored = { [ResourceType.WATER_ICE]: 50 };
    recomputeSiteStorage(site);

    expect(getPowerEfficiency(site)).toBe(1.0);

    processRefineries(state);

    // Nothing should be consumed or produced
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(50);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(50);
    expect(site.storage[ResourceType.HYDROGEN] ?? 0).toBe(0);
    expect(site.storage[ResourceType.OXYGEN] ?? 0).toBe(0);
  });

  it('does not process when no recipe is set', () => {
    const state = createGameState();
    const { site, silo } = buildRefinerySite(state);

    // Stock resources but do NOT set a recipe
    silo.stored = { [ResourceType.WATER_ICE]: 100 };
    recomputeSiteStorage(site);

    processRefineries(state);

    // Water ice should remain untouched
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(100);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(100);
    expect(site.storage[ResourceType.HYDROGEN] ?? 0).toBe(0);
    expect(site.storage[ResourceType.OXYGEN] ?? 0).toBe(0);
  });

  it('scales production by power efficiency when power is limited', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Low Power Refinery',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    // Generator with low output — total draw will exceed output
    addModuleToSite(state, site, {
      partId: 'power-generator-solar-mk1',
      type: MiningModuleType.POWER_GENERATOR,
      powerDraw: 0,
      powerOutput: 30,
    });

    const refinery = addModuleToSite(state, site, {
      partId: 'refinery-mk1',
      type: MiningModuleType.REFINERY,
      powerDraw: 40,
    });

    const silo = addModuleToSite(state, site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    const pressureVessel = addModuleToSite(state, site, {
      partId: 'pressure-vessel-mk1',
      type: MiningModuleType.PRESSURE_VESSEL,
      powerDraw: 5,
    });

    toggleConnection(site, refinery.id, silo.id);
    toggleConnection(site, refinery.id, pressureVessel.id);

    setRefineryRecipe(site, refinery.id, 'water-electrolysis');

    // Efficiency: 30 / (40+2+5) = 30/47
    const efficiency = getPowerEfficiency(site);
    expect(efficiency).toBeCloseTo(30 / 47, 5);

    // Stock enough water ice for the scaled recipe in silo's stored field
    silo.stored = { [ResourceType.WATER_ICE]: 200 };
    recomputeSiteStorage(site);

    processRefineries(state);

    // Scaled consumption: 100 * efficiency
    const expectedConsumed = 100 * efficiency;
    expect(silo.stored![ResourceType.WATER_ICE]).toBeCloseTo(200 - expectedConsumed, 5);
    expect(site.storage[ResourceType.WATER_ICE]).toBeCloseTo(200 - expectedConsumed, 5);
    // Scaled production — stored in pressure vessel
    expect(pressureVessel.stored![ResourceType.HYDROGEN]).toBeCloseTo(11 * efficiency, 5);
    expect(pressureVessel.stored![ResourceType.OXYGEN]).toBeCloseTo(89 * efficiency, 5);
    expect(site.storage[ResourceType.HYDROGEN]).toBeCloseTo(11 * efficiency, 5);
    expect(site.storage[ResourceType.OXYGEN]).toBeCloseTo(89 * efficiency, 5);
  });

  it('does not process when no connected storage for output type', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Missing Storage Refinery',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    addModuleToSite(state, site, {
      partId: 'power-generator-solar-mk1',
      type: MiningModuleType.POWER_GENERATOR,
      powerDraw: 0,
      powerOutput: 100,
    });

    const refinery = addModuleToSite(state, site, {
      partId: 'refinery-mk1',
      type: MiningModuleType.REFINERY,
      powerDraw: 40,
    });

    // Only connect a silo (SOLID) — water electrolysis needs GAS storage for outputs
    const silo = addModuleToSite(state, site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    toggleConnection(site, refinery.id, silo.id);

    setRefineryRecipe(site, refinery.id, 'water-electrolysis');
    silo.stored = { [ResourceType.WATER_ICE]: 100 };
    recomputeSiteStorage(site);

    processRefineries(state);

    // Nothing should be consumed — no GAS storage connected for H2/O2 outputs
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(100);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(100);
    expect(site.storage[ResourceType.HYDROGEN] ?? 0).toBe(0);
    expect(site.storage[ResourceType.OXYGEN] ?? 0).toBe(0);
  });

  it('does not process when zero power', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'No Power Refinery',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    // No power generator
    const refinery = addModuleToSite(state, site, {
      partId: 'refinery-mk1',
      type: MiningModuleType.REFINERY,
      powerDraw: 40,
    });

    const silo = addModuleToSite(state, site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    const pressureVessel = addModuleToSite(state, site, {
      partId: 'pressure-vessel-mk1',
      type: MiningModuleType.PRESSURE_VESSEL,
      powerDraw: 5,
    });

    toggleConnection(site, refinery.id, silo.id);
    toggleConnection(site, refinery.id, pressureVessel.id);

    setRefineryRecipe(site, refinery.id, 'water-electrolysis');
    silo.stored = { [ResourceType.WATER_ICE]: 100 };
    recomputeSiteStorage(site);

    processRefineries(state);

    // Zero efficiency → nothing processed
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(100);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(100);
    expect(site.storage[ResourceType.HYDROGEN] ?? 0).toBe(0);
  });

  it('regolith electrolysis converts regolith to oxygen', () => {
    const state = createGameState();
    const { site, refinery, silo, pressureVessel } = buildRefinerySite(state);

    setRefineryRecipe(site, refinery.id, 'regolith-electrolysis');

    // Stock 100 kg of regolith in the silo (SOLID storage)
    silo.stored = { [ResourceType.REGOLITH]: 100 };
    recomputeSiteStorage(site);

    expect(getPowerEfficiency(site)).toBe(1.0);

    processRefineries(state);

    // Regolith should be fully consumed
    expect(silo.stored![ResourceType.REGOLITH]).toBe(0);
    expect(site.storage[ResourceType.REGOLITH] ?? 0).toBe(0);
    // Oxygen produced: 15 kg — stored in pressure vessel (GAS storage)
    expect(pressureVessel.stored![ResourceType.OXYGEN]).toBe(15);
    expect(site.storage[ResourceType.OXYGEN]).toBe(15);
  });

  it('hydrazine synthesis converts hydrogen to hydrazine @smoke', () => {
    const state = createGameState();
    const { site, refinery, pressureVessel, fluidTank } = buildRefinerySite(state);

    setRefineryRecipe(site, refinery.id, 'hydrazine-synthesis');

    // Stock 50 kg of hydrogen in the pressure vessel (GAS storage)
    pressureVessel.stored = { [ResourceType.HYDROGEN]: 50 };
    recomputeSiteStorage(site);

    expect(getPowerEfficiency(site)).toBe(1.0);

    processRefineries(state);

    // Hydrogen should be fully consumed
    expect(pressureVessel.stored![ResourceType.HYDROGEN]).toBe(0);
    expect(site.storage[ResourceType.HYDROGEN] ?? 0).toBe(0);
    // Hydrazine produced: 40 kg — stored in fluid tank (LIQUID storage)
    expect(fluidTank.stored![ResourceType.HYDRAZINE]).toBe(40);
    expect(site.storage[ResourceType.HYDRAZINE]).toBe(40);
  });
});

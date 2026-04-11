import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import { createMiningSite, findNearestSite, addModuleToSite, toggleConnection, getPowerEfficiency, processMiningSites, processSurfaceLaunchPads } from '../core/mining.ts';
import { MiningModuleType, ResourceType } from '../core/constants.ts';
import { processRefineries, setRefineryRecipe } from '../core/refinery.ts';

describe('GameState mining/route fields', () => {
  it('createGameState() initializes miningSites as empty array', () => {
    const state = createGameState();
    expect(state.miningSites).toEqual([]);
    expect(Array.isArray(state.miningSites)).toBe(true);
  });

  it('createGameState() initializes provenLegs as empty array', () => {
    const state = createGameState();
    expect(state.provenLegs).toEqual([]);
    expect(Array.isArray(state.provenLegs)).toBe(true);
  });

  it('createGameState() initializes routes as empty array', () => {
    const state = createGameState();
    expect(state.routes).toEqual([]);
    expect(Array.isArray(state.routes)).toBe(true);
  });
});

describe('createMiningSite', () => {
  it('creates a site with control unit and pushes to state', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Alpha Base',
      bodyId: 'moon',
      coordinates: { x: 100, y: 200 },
      controlUnitPartId: 'ctrl-unit-1',
    });

    expect(site.id).toMatch(/^mining-site-/);
    expect(site.name).toBe('Alpha Base');
    expect(site.bodyId).toBe('moon');
    expect(site.coordinates).toEqual({ x: 100, y: 200 });
    expect(site.controlUnit).toEqual({ partId: 'ctrl-unit-1' });
    expect(state.miningSites).toHaveLength(1);
    expect(state.miningSites[0]).toBe(site);
  });

  it('has empty storage and orbitalBuffer', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Beta Outpost',
      bodyId: 'mars',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-2',
    });

    expect(site.storage).toEqual({});
    expect(site.orbitalBuffer).toEqual({});
  });

  it('has zero powerGenerated and powerRequired', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Gamma Station',
      bodyId: 'moon',
      coordinates: { x: 50, y: 50 },
      controlUnitPartId: 'ctrl-3',
    });

    expect(site.powerGenerated).toBe(0);
    expect(site.powerRequired).toBe(0);
  });

  it('has empty modules array', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Delta Mine',
      bodyId: 'moon',
      coordinates: { x: 10, y: 10 },
      controlUnitPartId: 'ctrl-4',
    });

    expect(site.modules).toEqual([]);
    expect(Array.isArray(site.modules)).toBe(true);
  });
});

describe('findNearestSite', () => {
  it('returns site when within radius', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Nearby Site',
      bodyId: 'moon',
      coordinates: { x: 100, y: 100 },
      controlUnitPartId: 'ctrl-a',
    });

    const found = findNearestSite(state, 'moon', { x: 110, y: 110 });
    expect(found).toBe(site);
  });

  it('returns null when no sites within radius', () => {
    const state = createGameState();
    createMiningSite(state, {
      name: 'Far Site',
      bodyId: 'moon',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-b',
    });

    // Distance: sqrt(1000^2 + 1000^2) = ~1414, well beyond SITE_PROXIMITY_RADIUS (500)
    const found = findNearestSite(state, 'moon', { x: 1000, y: 1000 });
    expect(found).toBeNull();
  });

  it('ignores sites on other bodies', () => {
    const state = createGameState();
    createMiningSite(state, {
      name: 'Mars Site',
      bodyId: 'mars',
      coordinates: { x: 100, y: 100 },
      controlUnitPartId: 'ctrl-c',
    });

    const found = findNearestSite(state, 'moon', { x: 100, y: 100 });
    expect(found).toBeNull();
  });

  it('returns the nearest when multiple sites exist', () => {
    const state = createGameState();
    createMiningSite(state, {
      name: 'Far Site',
      bodyId: 'moon',
      coordinates: { x: 300, y: 0 },
      controlUnitPartId: 'ctrl-d',
    });
    const closer = createMiningSite(state, {
      name: 'Close Site',
      bodyId: 'moon',
      coordinates: { x: 50, y: 0 },
      controlUnitPartId: 'ctrl-e',
    });

    const found = findNearestSite(state, 'moon', { x: 0, y: 0 });
    expect(found).toBe(closer);
  });
});

describe('addModuleToSite', () => {
  function makeSite() {
    const state = createGameState();
    return createMiningSite(state, {
      name: 'Test Site',
      bodyId: 'moon',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
  }

  it('adds a drill module and updates powerRequired', () => {
    const site = makeSite();
    expect(site.powerRequired).toBe(0);

    addModuleToSite(site, {
      partId: 'drill-part-1',
      type: MiningModuleType.MINING_DRILL,
      powerDraw: 25,
    });

    expect(site.powerRequired).toBe(25);
  });

  it('adds a power generator and updates powerGenerated', () => {
    const site = makeSite();
    expect(site.powerGenerated).toBe(0);

    addModuleToSite(site, {
      partId: 'gen-part-1',
      type: MiningModuleType.POWER_GENERATOR,
      powerDraw: 0,
      powerOutput: 100,
    });

    expect(site.powerGenerated).toBe(100);
  });

  it('pushes the created module to site.modules with correct fields', () => {
    const site = makeSite();

    const mod = addModuleToSite(site, {
      partId: 'drill-part-2',
      type: MiningModuleType.MINING_DRILL,
      powerDraw: 30,
    });

    expect(site.modules).toHaveLength(1);
    expect(site.modules[0]).toBe(mod);
    expect(mod.id).toMatch(/^module-/);
    expect(mod.partId).toBe('drill-part-2');
    expect(mod.type).toBe(MiningModuleType.MINING_DRILL);
    expect(mod.powerDraw).toBe(30);
    expect(mod.connections).toEqual([]);
  });
});

describe('toggleConnection', () => {
  function makeSiteWithTwoModules() {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Pipe Test Site',
      bodyId: 'moon',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    const modA = addModuleToSite(site, {
      partId: 'drill-1',
      type: MiningModuleType.MINING_DRILL,
      powerDraw: 25,
    });
    const modB = addModuleToSite(site, {
      partId: 'silo-1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 5,
    });
    return { site, modA, modB };
  }

  it('connects two modules bidirectionally', () => {
    const { site, modA, modB } = makeSiteWithTwoModules();

    const result = toggleConnection(site, modA.id, modB.id);

    expect(result).toBe(true);
    expect(modA.connections).toContain(modB.id);
    expect(modB.connections).toContain(modA.id);
  });

  it('disconnects on second toggle', () => {
    const { site, modA, modB } = makeSiteWithTwoModules();

    toggleConnection(site, modA.id, modB.id);
    toggleConnection(site, modA.id, modB.id);

    expect(modA.connections).toEqual([]);
    expect(modB.connections).toEqual([]);
  });

  it('returns false when a module ID is not found', () => {
    const { site, modA } = makeSiteWithTwoModules();

    const result = toggleConnection(site, modA.id, 'nonexistent-id');

    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Resource extraction tests
// ---------------------------------------------------------------------------

describe('getPowerEfficiency', () => {
  function makeSite(powerGenerated: number, powerRequired: number) {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Power Test Site',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    site.powerGenerated = powerGenerated;
    site.powerRequired = powerRequired;
    return site;
  }

  it('returns 1.0 when powerRequired is 0', () => {
    const site = makeSite(0, 0);
    expect(getPowerEfficiency(site)).toBe(1.0);
  });

  it('returns 1.0 when powerGenerated >= powerRequired', () => {
    const site = makeSite(200, 100);
    expect(getPowerEfficiency(site)).toBe(1.0);
  });

  it('returns ratio when powerGenerated < powerRequired', () => {
    const site = makeSite(50, 100);
    expect(getPowerEfficiency(site)).toBe(0.5);
  });

  it('returns 0 when powerGenerated is 0 and powerRequired > 0', () => {
    const site = makeSite(0, 100);
    expect(getPowerEfficiency(site)).toBe(0);
  });
});

describe('processMiningSites', () => {
  function buildMoonSiteWithDrillAndStorage(state: ReturnType<typeof createGameState>) {
    const site = createMiningSite(state, {
      name: 'Moon Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    const generator = addModuleToSite(site, {
      partId: 'power-generator-solar-mk1',
      type: MiningModuleType.POWER_GENERATOR,
      powerDraw: 0,
      powerOutput: 100,
    });

    const drill = addModuleToSite(site, {
      partId: 'mining-drill-mk1',
      type: MiningModuleType.MINING_DRILL,
      powerDraw: 25,
    });

    const silo = addModuleToSite(site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    // Connect drill to silo so resources can flow
    toggleConnection(site, drill.id, silo.id);

    return { site, generator, drill, silo };
  }

  it('extracts resources with full power @smoke', () => {
    const state = createGameState();
    const { site, silo } = buildMoonSiteWithDrillAndStorage(state);

    // Site has powerGenerated=100, powerRequired=27 (25+2), so efficiency is clamped to 1.0
    processMiningSites(state);

    // MOON has WATER_ICE at 50 kg/period and REGOLITH at 200 kg/period (both MINING_DRILL, SOLID)
    // With efficiency 1.0 and extractionMultiplier 1.0, we expect full extraction rates
    const waterIce = site.storage[ResourceType.WATER_ICE] ?? 0;
    const regolith = site.storage[ResourceType.REGOLITH] ?? 0;

    expect(waterIce).toBe(50);  // 50 kg/period * 1.0 efficiency * 1.0 multiplier
    expect(regolith).toBe(200); // 200 kg/period * 1.0 efficiency * 1.0 multiplier

    // Verify module-level stored values match site.storage (proportional distribution)
    expect(silo.stored).toBeDefined();
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(50);
    expect(silo.stored![ResourceType.REGOLITH]).toBe(200);
  });

  it('no extraction with zero power', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'No Power Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    // Add drill and silo but NO power generator
    const drill = addModuleToSite(site, {
      partId: 'mining-drill-mk1',
      type: MiningModuleType.MINING_DRILL,
      powerDraw: 25,
    });

    const silo = addModuleToSite(site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    toggleConnection(site, drill.id, silo.id);

    // powerGenerated=0, powerRequired=27 → efficiency=0
    processMiningSites(state);

    const waterIce = site.storage[ResourceType.WATER_ICE] ?? 0;
    const regolith = site.storage[ResourceType.REGOLITH] ?? 0;

    expect(waterIce).toBe(0);
    expect(regolith).toBe(0);
  });

  it('reduced extraction with partial power', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Low Power Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    // Power generator with output 10, but total draw will be 27 → efficiency ~ 10/27
    addModuleToSite(site, {
      partId: 'power-generator-solar-mk1',
      type: MiningModuleType.POWER_GENERATOR,
      powerDraw: 0,
      powerOutput: 10,
    });

    const drill = addModuleToSite(site, {
      partId: 'mining-drill-mk1',
      type: MiningModuleType.MINING_DRILL,
      powerDraw: 25,
    });

    const silo = addModuleToSite(site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    toggleConnection(site, drill.id, silo.id);

    // powerGenerated=10, powerRequired=27 → efficiency=10/27
    processMiningSites(state);

    const efficiency = 10 / 27;
    const waterIce = site.storage[ResourceType.WATER_ICE] ?? 0;
    const regolith = site.storage[ResourceType.REGOLITH] ?? 0;

    // WATER_ICE: 50 * (10/27) * 1.0
    expect(waterIce).toBeCloseTo(50 * efficiency, 5);
    // REGOLITH: 200 * (10/27) * 1.0
    expect(regolith).toBeCloseTo(200 * efficiency, 5);

    // Verify module-level stored values match site.storage
    expect(silo.stored).toBeDefined();
    expect(silo.stored![ResourceType.WATER_ICE]).toBeCloseTo(50 * efficiency, 5);
    expect(silo.stored![ResourceType.REGOLITH]).toBeCloseTo(200 * efficiency, 5);
  });
});

// ---------------------------------------------------------------------------
// Surface launch pad tests
// ---------------------------------------------------------------------------

describe('processSurfaceLaunchPads', () => {
  function buildSiteWithLaunchPad(state: ReturnType<typeof createGameState>, opts?: { noPower?: boolean }) {
    const site = createMiningSite(state, {
      name: 'Launch Test Site',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    if (!opts?.noPower) {
      addModuleToSite(site, {
        partId: 'power-generator-solar-mk1',
        type: MiningModuleType.POWER_GENERATOR,
        powerDraw: 0,
        powerOutput: 100,
      });
    }

    addModuleToSite(site, {
      partId: 'surface-launch-pad-mk1',
      type: MiningModuleType.SURFACE_LAUNCH_PAD,
      powerDraw: 50,
    });

    return site;
  }

  it('transfers resources from storage to orbital buffer', () => {
    const state = createGameState();
    const site = buildSiteWithLaunchPad(state);

    site.storage[ResourceType.WATER_ICE] = 100;

    processSurfaceLaunchPads(state);

    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(100);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(0);
  });

  it('respects launch capacity limit', () => {
    const state = createGameState();
    const site = buildSiteWithLaunchPad(state);

    // Put more resources than the 200 kg capacity
    site.storage[ResourceType.WATER_ICE] = 500;

    processSurfaceLaunchPads(state);

    // At full power (100 gen / 50 draw → efficiency clamped to 1.0), capacity = 200
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(200);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(300);
  });

  it('does not transfer without power', () => {
    const state = createGameState();
    const site = buildSiteWithLaunchPad(state, { noPower: true });

    site.storage[ResourceType.WATER_ICE] = 100;

    processSurfaceLaunchPads(state);

    // No power generator → powerGenerated=0, powerRequired=50 → efficiency=0
    expect(site.orbitalBuffer[ResourceType.WATER_ICE] ?? 0).toBe(0);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// Integration test: extraction → refining → launch chain
// ---------------------------------------------------------------------------

describe('Integration: extraction → refining → launch chain', () => {
  it('processes the full extraction, refining, and launch pipeline @smoke', () => {
    const state = createGameState();

    // Build a Moon mining site with all modules
    const site = createMiningSite(state, {
      name: 'Moon ISRU Base',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    // Power generator: 100W output, 0W draw
    addModuleToSite(site, {
      partId: 'power-generator-solar-mk1',
      type: MiningModuleType.POWER_GENERATOR,
      powerDraw: 0,
      powerOutput: 100,
    });

    // Mining drill: 25W draw
    const drill = addModuleToSite(site, {
      partId: 'mining-drill-mk1',
      type: MiningModuleType.MINING_DRILL,
      powerDraw: 25,
    });

    // Storage silo (solid): 2W draw
    const silo = addModuleToSite(site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    // Refinery: 40W draw
    const refinery = addModuleToSite(site, {
      partId: 'refinery-mk1',
      type: MiningModuleType.REFINERY,
      powerDraw: 40,
    });

    // Pressure vessel (gas): 5W draw
    const pressureVessel = addModuleToSite(site, {
      partId: 'pressure-vessel-mk1',
      type: MiningModuleType.PRESSURE_VESSEL,
      powerDraw: 5,
    });

    // Surface launch pad: 50W draw
    addModuleToSite(site, {
      partId: 'surface-launch-pad-mk1',
      type: MiningModuleType.SURFACE_LAUNCH_PAD,
      powerDraw: 50,
    });

    // Total power draw: 25+2+40+5+50 = 122W, generation = 100W
    // Efficiency = 100/122 ≈ 0.8197
    expect(site.powerRequired).toBe(122);
    expect(site.powerGenerated).toBe(100);

    // Connect drill → silo (for solid extraction: water ice, regolith)
    toggleConnection(site, drill.id, silo.id);

    // Set refinery recipe to water-electrolysis
    const recipeSet = setRefineryRecipe(site, refinery.id, 'water-electrolysis');
    expect(recipeSet).toBe(true);

    // Connect refinery → silo (input: solid water ice from silo)
    toggleConnection(site, refinery.id, silo.id);

    // Connect refinery → pressure vessel (output: gas hydrogen + oxygen)
    toggleConnection(site, refinery.id, pressureVessel.id);

    // ── Step 1: Extract resources ──
    processMiningSites(state);

    // With efficiency ~0.82, water ice extraction rate = 50 * efficiency
    const waterIceAfterExtraction = site.storage[ResourceType.WATER_ICE] ?? 0;
    expect(waterIceAfterExtraction).toBeGreaterThan(0);

    // Regolith also extracted (both are SOLID from MINING_DRILL on MOON)
    const regolithAfterExtraction = site.storage[ResourceType.REGOLITH] ?? 0;
    expect(regolithAfterExtraction).toBeGreaterThan(0);

    // Verify resources flow through module-level storage
    expect(silo.stored).toBeDefined();
    expect(silo.stored![ResourceType.WATER_ICE]).toBeGreaterThan(0);
    expect(silo.stored![ResourceType.REGOLITH]).toBeGreaterThan(0);

    // ── Step 2: Refine water ice into hydrogen + oxygen ──
    // Water-electrolysis: 100 kg water ice → 11 kg hydrogen + 89 kg oxygen
    // Scaled by efficiency: needs ~82 kg water ice, produces ~9 kg H2 + ~73 kg O2
    // We have ~41 kg water ice (50 * 0.82), which is less than 82 kg needed,
    // so the refinery may not run if insufficient input.
    // To ensure the refinery runs, top up water ice in module-level storage
    // (processRefineries reads from module.stored, not site.storage).
    if (!silo.stored) silo.stored = {};
    silo.stored[ResourceType.WATER_ICE] = 200;
    site.storage[ResourceType.WATER_ICE] = 200;

    processRefineries(state);

    // Refinery should have consumed water ice and produced hydrogen + oxygen
    const hydrogenAfterRefining = site.storage[ResourceType.HYDROGEN] ?? 0;
    const oxygenAfterRefining = site.storage[ResourceType.OXYGEN] ?? 0;
    expect(hydrogenAfterRefining).toBeGreaterThan(0);
    expect(oxygenAfterRefining).toBeGreaterThan(0);

    // Water ice should have been partially consumed
    const waterIceAfterRefining = site.storage[ResourceType.WATER_ICE] ?? 0;
    expect(waterIceAfterRefining).toBeLessThan(200);

    // ── Step 3: Launch resources to orbit ──
    // Clear storage from earlier steps so the launch pad's limited capacity
    // (~164 kg at ~0.82 efficiency) isn't consumed by water ice / regolith.
    for (const key of Object.keys(site.storage)) {
      delete site.storage[key as ResourceType];
    }
    site.storage[ResourceType.HYDROGEN] = 50;
    site.storage[ResourceType.OXYGEN] = 80;

    processSurfaceLaunchPads(state);

    // Resources should have moved from storage to orbitalBuffer
    const hydrogenInOrbit = site.orbitalBuffer[ResourceType.HYDROGEN] ?? 0;
    const oxygenInOrbit = site.orbitalBuffer[ResourceType.OXYGEN] ?? 0;
    expect(hydrogenInOrbit + oxygenInOrbit).toBeGreaterThan(0);
  });
});

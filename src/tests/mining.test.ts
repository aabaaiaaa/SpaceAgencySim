import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import { createMiningSite, findNearestSite, addModuleToSite, toggleConnection, getPowerEfficiency, processMiningSites, processSurfaceLaunchPads, recomputeSiteStorage } from '../core/mining.ts';
import { MiningModuleType, ResourceType } from '../core/constants.ts';
import { processRefineries, setRefineryRecipe } from '../core/refinery.ts';
import { advancePeriod } from '../core/period.ts';
import { getPartById } from '../data/parts.ts';

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

    const launchPad = addModuleToSite(site, {
      partId: 'surface-launch-pad-mk1',
      type: MiningModuleType.SURFACE_LAUNCH_PAD,
      powerDraw: 50,
    });

    const silo = addModuleToSite(site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    // Connect launch pad to storage silo
    toggleConnection(site, launchPad.id, silo.id);

    return { site, launchPad, silo };
  }

  it('transfers resources from storage to orbital buffer', () => {
    const state = createGameState();
    const { site, silo } = buildSiteWithLaunchPad(state);

    // Set resources on the storage module's stored field
    silo.stored = { [ResourceType.WATER_ICE]: 100 };
    recomputeSiteStorage(site);

    processSurfaceLaunchPads(state);

    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(100);
    expect(site.storage[ResourceType.WATER_ICE] ?? 0).toBe(0);
    expect(silo.stored![ResourceType.WATER_ICE] ?? 0).toBe(0);
  });

  it('respects launch capacity limit', () => {
    const state = createGameState();
    const { site, silo } = buildSiteWithLaunchPad(state);

    // Put more resources than the 200 kg capacity
    silo.stored = { [ResourceType.WATER_ICE]: 500 };
    recomputeSiteStorage(site);

    processSurfaceLaunchPads(state);

    // At full power (100 gen / 52 draw → efficiency clamped to 1.0), capacity = 200
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(200);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(300);
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(300);
  });

  it('does not transfer without power', () => {
    const state = createGameState();
    const { site, silo } = buildSiteWithLaunchPad(state, { noPower: true });

    // Set resources on the storage module's stored field
    silo.stored = { [ResourceType.WATER_ICE]: 100 };
    recomputeSiteStorage(site);

    processSurfaceLaunchPads(state);

    // No power generator → powerGenerated=0, powerRequired=52 → efficiency=0
    expect(site.orbitalBuffer[ResourceType.WATER_ICE] ?? 0).toBe(0);
    expect(site.storage[ResourceType.WATER_ICE]).toBe(100);
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(100);
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
    const launchPad = addModuleToSite(site, {
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

    // Connect launch pad → silo (for solid resources) and pressure vessel (for gas)
    toggleConnection(site, launchPad.id, silo.id);
    toggleConnection(site, launchPad.id, pressureVessel.id);

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
    recomputeSiteStorage(site);

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
    // Clear module-level storage from earlier steps so the launch pad's limited capacity
    // (~164 kg at ~0.82 efficiency) isn't consumed by water ice / regolith.
    // Set hydrogen and oxygen on the pressure vessel's stored field.
    for (const m of site.modules) {
      if (m.stored) {
        for (const key of Object.keys(m.stored)) {
          delete m.stored[key as ResourceType];
        }
      }
    }
    pressureVessel.stored = { [ResourceType.HYDROGEN]: 50, [ResourceType.OXYGEN]: 80 };
    recomputeSiteStorage(site);

    processSurfaceLaunchPads(state);

    // Resources should have moved from storage to orbitalBuffer
    const hydrogenInOrbit = site.orbitalBuffer[ResourceType.HYDROGEN] ?? 0;
    const oxygenInOrbit = site.orbitalBuffer[ResourceType.OXYGEN] ?? 0;
    expect(hydrogenInOrbit + oxygenInOrbit).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Multi-period accumulation test
// ---------------------------------------------------------------------------

describe('Multi-period accumulation', () => {
  it('accumulates resources correctly over 3 periods with no corruption @smoke', () => {
    const state = createGameState();
    state.money = 1000000; // Enough to cover operating costs across periods

    // Build a Moon mining site with a full pipeline
    const site = createMiningSite(state, {
      name: 'Moon Accumulation Base',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'base-control-unit-mk1',
    });

    // 1. Power generator: 100W output, 0W draw
    addModuleToSite(site, {
      partId: 'power-generator-solar-mk1',
      type: MiningModuleType.POWER_GENERATOR,
      powerDraw: 0,
      powerOutput: 100,
    });

    // 2. Mining drill: 25W draw
    const drill = addModuleToSite(site, {
      partId: 'mining-drill-mk1',
      type: MiningModuleType.MINING_DRILL,
      powerDraw: 25,
    });

    // 3. Storage silo (solid): 2W draw, capacity 2000 kg
    const silo = addModuleToSite(site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    // 4. Refinery: 40W draw, recipe = water-electrolysis
    const refinery = addModuleToSite(site, {
      partId: 'refinery-mk1',
      type: MiningModuleType.REFINERY,
      powerDraw: 40,
    });

    // 5. Pressure vessel (gas): 5W draw, capacity 1000 kg
    const pressureVessel = addModuleToSite(site, {
      partId: 'pressure-vessel-mk1',
      type: MiningModuleType.PRESSURE_VESSEL,
      powerDraw: 5,
    });

    // 6. Surface launch pad: 50W draw
    const launchPad = addModuleToSite(site, {
      partId: 'surface-launch-pad-mk1',
      type: MiningModuleType.SURFACE_LAUNCH_PAD,
      powerDraw: 50,
    });

    // Total power draw: 25+2+40+5+50 = 122W, generation = 100W
    // Efficiency = 100/122 ≈ 0.8197
    expect(site.powerRequired).toBe(122);
    expect(site.powerGenerated).toBe(100);

    // Set up connections
    // drill ↔ silo (extraction flows to solid storage)
    toggleConnection(site, drill.id, silo.id);
    // refinery ↔ silo (refinery reads solid input from silo)
    toggleConnection(site, refinery.id, silo.id);
    // refinery ↔ pressure vessel (refinery outputs gas to pressure vessel)
    toggleConnection(site, refinery.id, pressureVessel.id);
    // launch pad ↔ silo (launch pad reads from solid storage)
    toggleConnection(site, launchPad.id, silo.id);
    // launch pad ↔ pressure vessel (launch pad reads from gas storage)
    toggleConnection(site, launchPad.id, pressureVessel.id);

    // Set refinery recipe to water-electrolysis
    const recipeSet = setRefineryRecipe(site, refinery.id, 'water-electrolysis');
    expect(recipeSet).toBe(true);

    // Run advancePeriod 3 times and collect summaries
    const summaries = [];
    for (let i = 0; i < 3; i++) {
      summaries.push(advancePeriod(state));
    }

    // ── Verify 1: Resources accumulate at each stage ──
    // Storage should have non-zero resource amounts after 3 extraction periods
    const storageHasResources = Object.values(site.storage).some(v => v > 0);
    const orbitalBufferHasResources = Object.values(site.orbitalBuffer).some(v => v > 0);
    expect(storageHasResources || orbitalBufferHasResources).toBe(true);

    // ── Verify 2: No negative values anywhere ──
    // Check site.storage
    for (const [resource, amount] of Object.entries(site.storage)) {
      expect(amount, `site.storage[${resource}] should be >= 0`).toBeGreaterThanOrEqual(0);
    }

    // Check all module stored values
    for (const mod of site.modules) {
      if (mod.stored) {
        for (const [resource, amount] of Object.entries(mod.stored)) {
          expect(amount, `module ${mod.id} stored[${resource}] should be >= 0`).toBeGreaterThanOrEqual(0);
        }
      }
    }

    // Check orbital buffer
    for (const [resource, amount] of Object.entries(site.orbitalBuffer)) {
      expect(amount, `orbitalBuffer[${resource}] should be >= 0`).toBeGreaterThanOrEqual(0);
    }

    // ── Verify 3: No double-counting ──
    // For each resource type, sum of all module stored values should match site.storage
    // (recomputeSiteStorage is called during processing, so they should be in sync)
    const moduleStorageTotals: Partial<Record<string, number>> = {};
    for (const mod of site.modules) {
      if (mod.stored) {
        for (const [resource, amount] of Object.entries(mod.stored)) {
          moduleStorageTotals[resource] = (moduleStorageTotals[resource] ?? 0) + amount;
        }
      }
    }
    for (const [resource, siteAmount] of Object.entries(site.storage)) {
      const moduleTotal = moduleStorageTotals[resource] ?? 0;
      expect(moduleTotal).toBeCloseTo(siteAmount as number, 5);
    }

    // ── Verify 4: Orbital buffer grows ──
    // After 3 periods of extraction + launch, orbital buffer should have entries > 0
    const orbitalBufferTotal = Object.values(site.orbitalBuffer).reduce((sum, v) => sum + v, 0);
    expect(orbitalBufferTotal).toBeGreaterThan(0);

    // ── Verify 5: PeriodSummary fields report non-zero amounts ──
    // At least one of the 3 period summaries should have non-zero miningExtracted
    const anyMiningExtracted = summaries.some(s => {
      const total = Object.values(s.miningExtracted).reduce((sum, v) => sum + (v ?? 0), 0);
      return total > 0;
    });
    expect(anyMiningExtracted).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Storage capacity overflow
// ---------------------------------------------------------------------------

describe('Storage capacity overflow', () => {
  it('clamps extracted resources to storage capacity @smoke', () => {
    const state = createGameState();

    // Build a Moon mining site with drill + silo + power
    const site = createMiningSite(state, {
      name: 'Overflow Test Site',
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

    // Storage silo (solid): 2W draw, capacity 2000 kg
    const silo = addModuleToSite(site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    // Connect drill to silo so resources can flow
    toggleConnection(site, drill.id, silo.id);

    // Pre-fill the silo to near-capacity (1980 kg out of 2000 kg)
    silo.stored = { [ResourceType.WATER_ICE]: 1980 };
    recomputeSiteStorage(site);

    // powerGenerated=100, powerRequired=27 (25+2), efficiency clamped to 1.0
    // MOON extracts 50 kg WATER_ICE + 200 kg REGOLITH per period = 250 kg total
    // Only 20 kg remaining capacity, so extraction should be capped
    processMiningSites(state);

    // Verify: sum of stored values in silo should not exceed storageCapacityKg (2000)
    const totalStored = Object.values(silo.stored!).reduce((sum, v) => sum + v, 0);
    expect(totalStored).toBeLessThanOrEqual(silo.storageCapacityKg!);

    // Verify: site.storage values should match module stored values
    for (const [resource, amount] of Object.entries(site.storage)) {
      const moduleTotal = silo.stored![resource as ResourceType] ?? 0;
      expect(moduleTotal).toBeCloseTo(amount as number, 5);
    }
  });
});

// ---------------------------------------------------------------------------
// Multi-resource extraction competition
// ---------------------------------------------------------------------------

describe('Multi-resource extraction competition', () => {
  it('extracts multiple resource types independently on Mars', () => {
    const state = createGameState();

    // Build a Mars site with a mining drill (for WATER_ICE solid) AND a gas collector (for CO2 gas)
    const site = createMiningSite(state, {
      name: 'Mars Multi-Resource Site',
      bodyId: 'MARS',
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

    // Mining drill: 25W draw (extracts SOLID resources: WATER_ICE on Mars)
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

    // Connect drill to silo
    toggleConnection(site, drill.id, silo.id);

    // Gas collector: 20W draw (extracts GAS resources: CO2 on Mars)
    const gasCollector = addModuleToSite(site, {
      partId: 'gas-collector-mk1',
      type: MiningModuleType.GAS_COLLECTOR,
      powerDraw: 20,
    });

    // Pressure vessel (gas): 5W draw
    const pressureVessel = addModuleToSite(site, {
      partId: 'pressure-vessel-mk1',
      type: MiningModuleType.PRESSURE_VESSEL,
      powerDraw: 5,
    });

    // Connect gas collector to pressure vessel
    toggleConnection(site, gasCollector.id, pressureVessel.id);

    // Total power draw: 25+2+20+5 = 52W, generation = 100W
    // Efficiency = 100/52 → clamped to 1.0
    expect(site.powerRequired).toBe(52);
    expect(site.powerGenerated).toBe(100);

    processMiningSites(state);

    // MARS has WATER_ICE at 80 kg/period (SOLID via MINING_DRILL)
    expect(silo.stored![ResourceType.WATER_ICE]).toBe(80);

    // MARS has CO2 at 150 kg/period (GAS via GAS_COLLECTOR)
    expect(pressureVessel.stored![ResourceType.CO2]).toBe(150);

    // Verify they are extracted independently (both non-zero)
    expect(site.storage[ResourceType.WATER_ICE]).toBe(80);
    expect(site.storage[ResourceType.CO2]).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// Orbital buffer unbounded accumulation
// ---------------------------------------------------------------------------

describe('orbital buffer accumulation', () => {
  it('orbital buffer grows without bound across multiple launch pad cycles', () => {
    const state = createGameState();

    // Build a Moon site with power, launch pad, and storage
    const site = createMiningSite(state, {
      name: 'Orbital Buffer Test Site',
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

    // Surface launch pad: 50W draw, 200 kg capacity per period
    const launchPad = addModuleToSite(site, {
      partId: 'surface-launch-pad-mk1',
      type: MiningModuleType.SURFACE_LAUNCH_PAD,
      powerDraw: 50,
    });

    // Storage silo (solid): 2W draw, 2000 kg capacity
    const silo = addModuleToSite(site, {
      partId: 'storage-silo-mk1',
      type: MiningModuleType.STORAGE_SILO,
      powerDraw: 2,
    });

    // Connect launch pad to storage silo
    toggleConnection(site, launchPad.id, silo.id);

    // powerGenerated=100, powerRequired=52 (50+2), efficiency clamped to 1.0
    // Launch capacity per period = 200 kg at full power

    // Run 5 cycles, refilling storage each time to ensure the launch pad
    // always has resources to transfer.
    const iterations = 5;
    const refillAmount = 500; // more than the 200 kg/period capacity

    for (let i = 0; i < iterations; i++) {
      // Refill storage module before each launch pad cycle
      silo.stored = { [ResourceType.WATER_ICE]: refillAmount };
      recomputeSiteStorage(site);

      processSurfaceLaunchPads(state);
    }

    // Each cycle transfers 200 kg (capped by launch capacity), so after 5 cycles
    // the orbital buffer should hold 1000 kg — well beyond any single-period limit.
    const orbitalWaterIce = site.orbitalBuffer[ResourceType.WATER_ICE] ?? 0;
    expect(orbitalWaterIce).toBe(200 * iterations);

    // The key assertion: orbital buffer is unbounded — no cap was applied.
    // 1000 kg exceeds the storage silo capacity (2000 kg) is not a limit here;
    // the orbital buffer has no maximum.
    expect(orbitalWaterIce).toBe(1000);
    expect(orbitalWaterIce).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Mk2 storage modules
// ---------------------------------------------------------------------------

describe('Mk2 storage modules', () => {
  describe('part definitions', () => {
    it('Storage Silo Mk2 exists with correct capacity and storage state', () => {
      const part = getPartById('storage-silo-mk2');
      expect(part).toBeDefined();
      expect(part!.name).toBe('Storage Silo Mk2');
      expect(part!.properties.storageCapacityKg).toBe(5000);
      expect(part!.properties.storageState).toBe('SOLID');
    });

    it('Pressure Vessel Mk2 exists with correct capacity and storage state', () => {
      const part = getPartById('pressure-vessel-mk2');
      expect(part).toBeDefined();
      expect(part!.name).toBe('Pressure Vessel Mk2');
      expect(part!.properties.storageCapacityKg).toBe(2500);
      expect(part!.properties.storageState).toBe('GAS');
    });

    it('Fluid Tank Mk2 exists with correct capacity and storage state', () => {
      const part = getPartById('fluid-tank-mk2');
      expect(part).toBeDefined();
      expect(part!.name).toBe('Fluid Tank Mk2');
      expect(part!.properties.storageCapacityKg).toBe(3750);
      expect(part!.properties.storageState).toBe('LIQUID');
    });
  });

  describe('addModuleToSite initializes Mk2 storage with correct capacity', () => {
    function makeSite() {
      const state = createGameState();
      return createMiningSite(state, {
        name: 'Mk2 Test Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });
    }

    it('Storage Silo Mk2 gets storageCapacityKg = 5000', () => {
      const site = makeSite();
      const mod = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      expect(mod.storageCapacityKg).toBe(5000);
      expect(mod.stored).toEqual({});
      expect(mod.storageState).toBe('SOLID');
    });

    it('Pressure Vessel Mk2 gets storageCapacityKg = 2500', () => {
      const site = makeSite();
      const mod = addModuleToSite(site, {
        partId: 'pressure-vessel-mk2',
        type: MiningModuleType.PRESSURE_VESSEL,
        powerDraw: 8,
      });

      expect(mod.storageCapacityKg).toBe(2500);
      expect(mod.stored).toEqual({});
      expect(mod.storageState).toBe('GAS');
    });

    it('Fluid Tank Mk2 gets storageCapacityKg = 3750', () => {
      const site = makeSite();
      const mod = addModuleToSite(site, {
        partId: 'fluid-tank-mk2',
        type: MiningModuleType.FLUID_TANK,
        powerDraw: 8,
      });

      expect(mod.storageCapacityKg).toBe(3750);
      expect(mod.stored).toEqual({});
      expect(mod.storageState).toBe('LIQUID');
    });
  });

  describe('extraction distributes proportionally across mixed Mk1+Mk2 storage', () => {
    it('distributes to Mk1 silo (2000kg) and Mk2 silo (5000kg) in ~29/71 ratio', () => {
      const state = createGameState();

      const site = createMiningSite(state, {
        name: 'Mixed Storage Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });

      // Power generator: 100W output
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

      // Mk1 storage silo: 2W draw, 2000 kg capacity
      const siloMk1 = addModuleToSite(site, {
        partId: 'storage-silo-mk1',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 2,
      });

      // Mk2 storage silo: 3W draw, 5000 kg capacity
      const siloMk2 = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      // Connect drill to both silos
      toggleConnection(site, drill.id, siloMk1.id);
      toggleConnection(site, drill.id, siloMk2.id);

      // Verify capacities initialized correctly
      expect(siloMk1.storageCapacityKg).toBe(2000);
      expect(siloMk2.storageCapacityKg).toBe(5000);

      // Run extraction — efficiency = 100/30 → clamped to 1.0
      processMiningSites(state);

      // MOON has WATER_ICE at 50 kg/period and REGOLITH at 200 kg/period (both SOLID)
      // Total extracted = 250 kg, distributed proportionally by remaining capacity:
      // Mk1 share = 2000/7000 = 2/7 ≈ 28.57%
      // Mk2 share = 5000/7000 = 5/7 ≈ 71.43%
      const mk1Total = Object.values(siloMk1.stored!).reduce((sum, v) => sum + (v ?? 0), 0);
      const mk2Total = Object.values(siloMk2.stored!).reduce((sum, v) => sum + (v ?? 0), 0);
      const totalExtracted = mk1Total + mk2Total;

      expect(totalExtracted).toBeGreaterThan(0);

      const mk1Ratio = mk1Total / totalExtracted;
      const mk2Ratio = mk2Total / totalExtracted;

      // Expected ratios: 2/7 ≈ 0.2857 and 5/7 ≈ 0.7143
      expect(mk1Ratio).toBeCloseTo(2 / 7, 2);
      expect(mk2Ratio).toBeCloseTo(5 / 7, 2);
    });
  });

  describe('per-module capacity limits', () => {
    it('Mk2 silo stops accepting resources at 5000kg capacity @smoke', () => {
      const state = createGameState();

      const site = createMiningSite(state, {
        name: 'Mk2 Capacity Limit Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });

      // Power generator: 100W output
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

      // Mk2 storage silo: 3W draw, 5000 kg capacity
      const siloMk2 = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      // Connect drill to silo
      toggleConnection(site, drill.id, siloMk2.id);

      // Pre-fill the Mk2 silo to near capacity (4980 kg out of 5000 kg)
      siloMk2.stored = { [ResourceType.WATER_ICE]: 4980 };
      recomputeSiteStorage(site);

      // Run extraction — MOON extracts 50 kg WATER_ICE + 200 kg REGOLITH = 250 kg total
      // Only 20 kg remaining capacity, so extraction should be capped
      processMiningSites(state);

      // Total stored in the silo should not exceed 5000 kg capacity
      const totalStored = Object.values(siloMk2.stored!).reduce((sum, v) => sum + (v ?? 0), 0);
      expect(totalStored).toBeLessThanOrEqual(siloMk2.storageCapacityKg!);
      expect(siloMk2.storageCapacityKg).toBe(5000);

      // Verify site.storage matches module stored values
      for (const [resource, amount] of Object.entries(site.storage)) {
        const moduleTotal = siloMk2.stored![resource as ResourceType] ?? 0;
        expect(moduleTotal).toBeCloseTo(amount as number, 5);
      }
    });
  });

  describe('Mk2-only end-to-end: extraction → storage → launch pad transfer', () => {
    it('extracts into Mk2 silo and transfers to orbital buffer via launch pad', () => {
      const state = createGameState();

      const site = createMiningSite(state, {
        name: 'Mk2-Only Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });

      // Power generator: 200W output (enough for all modules)
      addModuleToSite(site, {
        partId: 'power-generator-solar-mk1',
        type: MiningModuleType.POWER_GENERATOR,
        powerDraw: 0,
        powerOutput: 200,
      });

      // Mining drill: 25W draw
      const drill = addModuleToSite(site, {
        partId: 'mining-drill-mk1',
        type: MiningModuleType.MINING_DRILL,
        powerDraw: 25,
      });

      // Mk2 storage silo (SOLID): 3W draw, 5000 kg capacity — NO Mk1 storage
      const siloMk2 = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      // Surface launch pad: 50W draw, 200 kg/period capacity
      const launchPad = addModuleToSite(site, {
        partId: 'surface-launch-pad-mk1',
        type: MiningModuleType.SURFACE_LAUNCH_PAD,
        powerDraw: 50,
      });

      // Connect drill → Mk2 silo (extraction of solid resources)
      toggleConnection(site, drill.id, siloMk2.id);
      // Connect launch pad → Mk2 silo (transfer to orbit)
      toggleConnection(site, launchPad.id, siloMk2.id);

      expect(siloMk2.storageCapacityKg).toBe(5000);

      // Efficiency = 200 / (25 + 3 + 50) = 200/78 → clamped to 1.0
      const efficiency = getPowerEfficiency(site);
      expect(efficiency).toBe(1.0);

      // Step 1: Extract resources into Mk2 silo
      processMiningSites(state);

      // MOON SOLID resources via MINING_DRILL:
      // WATER_ICE 50 kg + REGOLITH 200 kg + IRON_ORE 30 kg = 280 kg total
      const waterIce = siloMk2.stored![ResourceType.WATER_ICE] ?? 0;
      const regolith = siloMk2.stored![ResourceType.REGOLITH] ?? 0;
      const ironOre = siloMk2.stored![ResourceType.IRON_ORE] ?? 0;
      expect(waterIce).toBeCloseTo(50, 5);
      expect(regolith).toBeCloseTo(200, 5);
      expect(ironOre).toBeCloseTo(30, 5);

      const totalExtracted = waterIce + regolith + ironOre;
      expect(totalExtracted).toBeCloseTo(280, 5);

      // site.storage should match module storage
      expect(site.storage[ResourceType.WATER_ICE]).toBeCloseTo(50, 5);
      expect(site.storage[ResourceType.REGOLITH]).toBeCloseTo(200, 5);
      expect(site.storage[ResourceType.IRON_ORE]).toBeCloseTo(30, 5);

      // Step 2: Transfer from Mk2 silo to orbital buffer via launch pad
      processSurfaceLaunchPads(state);

      // Launch pad capacity = 200 kg/period at efficiency 1.0
      // Total in silo = 280 kg, pad can move 200 kg
      const orbitalTotal = Object.values(site.orbitalBuffer).reduce((sum, v) => sum + (v ?? 0), 0);
      expect(orbitalTotal).toBeCloseTo(200, 5);

      // Silo should have 80 kg remaining (280 - 200)
      const siloRemaining = Object.values(siloMk2.stored!).reduce((sum, v) => sum + (v ?? 0), 0);
      expect(siloRemaining).toBeCloseTo(80, 5);

      // site.storage should reflect the reduced module storage
      const siteTotal = Object.values(site.storage).reduce((sum, v) => sum + (v ?? 0), 0);
      expect(siteTotal).toBeCloseTo(80, 5);
    });
  });

  describe('mixed Mk1+Mk2 extraction fills storage proportionally in each module', () => {
    it('each module receives its proportional share of extracted resources', () => {
      const state = createGameState();

      const site = createMiningSite(state, {
        name: 'Mixed Mk1+Mk2 Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });

      // Power generator: 200W output
      addModuleToSite(site, {
        partId: 'power-generator-solar-mk1',
        type: MiningModuleType.POWER_GENERATOR,
        powerDraw: 0,
        powerOutput: 200,
      });

      // Mining drill: 25W draw
      const drill = addModuleToSite(site, {
        partId: 'mining-drill-mk1',
        type: MiningModuleType.MINING_DRILL,
        powerDraw: 25,
      });

      // Mk1 silo: 2W draw, 2000 kg capacity
      const siloMk1 = addModuleToSite(site, {
        partId: 'storage-silo-mk1',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 2,
      });

      // Mk2 silo: 3W draw, 5000 kg capacity
      const siloMk2 = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      // Connect drill to both silos
      toggleConnection(site, drill.id, siloMk1.id);
      toggleConnection(site, drill.id, siloMk2.id);

      // Efficiency = 200 / (25+2+3) = 200/30 → clamped to 1.0
      expect(getPowerEfficiency(site)).toBe(1.0);

      processMiningSites(state);

      // MOON SOLID resources via MINING_DRILL:
      // WATER_ICE 50 kg + REGOLITH 200 kg + IRON_ORE 30 kg = 280 kg total
      // Distributed proportionally: Mk1 = 2000/7000, Mk2 = 5000/7000
      const mk1WaterIce = siloMk1.stored![ResourceType.WATER_ICE] ?? 0;
      const mk2WaterIce = siloMk2.stored![ResourceType.WATER_ICE] ?? 0;
      const mk1Regolith = siloMk1.stored![ResourceType.REGOLITH] ?? 0;
      const mk2Regolith = siloMk2.stored![ResourceType.REGOLITH] ?? 0;
      const mk1IronOre = siloMk1.stored![ResourceType.IRON_ORE] ?? 0;
      const mk2IronOre = siloMk2.stored![ResourceType.IRON_ORE] ?? 0;

      // Each resource is distributed by capacity ratio: 2/7 Mk1, 5/7 Mk2
      expect(mk1WaterIce).toBeCloseTo(50 * (2 / 7), 5);
      expect(mk2WaterIce).toBeCloseTo(50 * (5 / 7), 5);
      expect(mk1Regolith).toBeCloseTo(200 * (2 / 7), 5);
      expect(mk2Regolith).toBeCloseTo(200 * (5 / 7), 5);
      expect(mk1IronOre).toBeCloseTo(30 * (2 / 7), 5);
      expect(mk2IronOre).toBeCloseTo(30 * (5 / 7), 5);

      // Total across both modules matches extraction totals
      expect(mk1WaterIce + mk2WaterIce).toBeCloseTo(50, 5);
      expect(mk1Regolith + mk2Regolith).toBeCloseTo(200, 5);
      expect(mk1IronOre + mk2IronOre).toBeCloseTo(30, 5);

      // site.storage aggregates both modules
      expect(site.storage[ResourceType.WATER_ICE]).toBeCloseTo(50, 5);
      expect(site.storage[ResourceType.REGOLITH]).toBeCloseTo(200, 5);
      expect(site.storage[ResourceType.IRON_ORE]).toBeCloseTo(30, 5);
    });
  });

  describe('refinery with Mk2 input/output storage', () => {
    it('consumes input from Mk2 silo and produces output to Mk2 pressure vessel', () => {
      const state = createGameState();

      const site = createMiningSite(state, {
        name: 'Mk2 Refinery Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });

      // Power generator: 200W output
      addModuleToSite(site, {
        partId: 'power-generator-solar-mk1',
        type: MiningModuleType.POWER_GENERATOR,
        powerDraw: 0,
        powerOutput: 200,
      });

      // Mk2 storage silo (SOLID input): 3W draw, 5000 kg capacity
      const siloMk2 = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      // Refinery: 40W draw
      const refinery = addModuleToSite(site, {
        partId: 'refinery-mk1',
        type: MiningModuleType.REFINERY,
        powerDraw: 40,
      });

      // Mk2 pressure vessel (GAS output): 8W draw, 2500 kg capacity
      const pvMk2 = addModuleToSite(site, {
        partId: 'pressure-vessel-mk2',
        type: MiningModuleType.PRESSURE_VESSEL,
        powerDraw: 8,
      });

      // Set recipe: water-electrolysis (100 kg WATER_ICE → 11 kg HYDROGEN + 89 kg OXYGEN)
      const recipeSet = setRefineryRecipe(site, refinery.id, 'water-electrolysis');
      expect(recipeSet).toBe(true);

      // Connect refinery ↔ Mk2 silo (solid input)
      toggleConnection(site, refinery.id, siloMk2.id);
      // Connect refinery ↔ Mk2 pressure vessel (gas output)
      toggleConnection(site, refinery.id, pvMk2.id);

      // Pre-fill Mk2 silo with 500 kg water ice
      siloMk2.stored = { [ResourceType.WATER_ICE]: 500 };
      recomputeSiteStorage(site);

      // Efficiency = 200 / (3+40+8) = 200/51 → clamped to 1.0
      expect(getPowerEfficiency(site)).toBe(1.0);

      processRefineries(state);

      // At efficiency 1.0: consumes 100 kg WATER_ICE, produces 11 kg H2 + 89 kg O2
      const waterIceRemaining = siloMk2.stored![ResourceType.WATER_ICE] ?? 0;
      expect(waterIceRemaining).toBeCloseTo(400, 5); // 500 - 100

      const hydrogen = pvMk2.stored![ResourceType.HYDROGEN] ?? 0;
      const oxygen = pvMk2.stored![ResourceType.OXYGEN] ?? 0;
      expect(hydrogen).toBeCloseTo(11, 5);
      expect(oxygen).toBeCloseTo(89, 5);

      // site.storage reflects all module storage
      expect(site.storage[ResourceType.WATER_ICE]).toBeCloseTo(400, 5);
      expect(site.storage[ResourceType.HYDROGEN]).toBeCloseTo(11, 5);
      expect(site.storage[ResourceType.OXYGEN]).toBeCloseTo(89, 5);
    });

    it('refinery with mixed Mk1+Mk2 output distributes by remaining capacity', () => {
      const state = createGameState();

      const site = createMiningSite(state, {
        name: 'Mixed Refinery Output Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });

      // Power generator: 200W output
      addModuleToSite(site, {
        partId: 'power-generator-solar-mk1',
        type: MiningModuleType.POWER_GENERATOR,
        powerDraw: 0,
        powerOutput: 200,
      });

      // Mk2 silo (SOLID input): 5000 kg capacity
      const siloMk2 = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      // Refinery
      const refinery = addModuleToSite(site, {
        partId: 'refinery-mk1',
        type: MiningModuleType.REFINERY,
        powerDraw: 40,
      });

      // Mk1 pressure vessel (GAS output): 1000 kg capacity
      const pvMk1 = addModuleToSite(site, {
        partId: 'pressure-vessel-mk1',
        type: MiningModuleType.PRESSURE_VESSEL,
        powerDraw: 5,
      });

      // Mk2 pressure vessel (GAS output): 2500 kg capacity
      const pvMk2 = addModuleToSite(site, {
        partId: 'pressure-vessel-mk2',
        type: MiningModuleType.PRESSURE_VESSEL,
        powerDraw: 8,
      });

      // Set recipe: water-electrolysis
      setRefineryRecipe(site, refinery.id, 'water-electrolysis');

      // Connect refinery to input and both output vessels
      toggleConnection(site, refinery.id, siloMk2.id);
      toggleConnection(site, refinery.id, pvMk1.id);
      toggleConnection(site, refinery.id, pvMk2.id);

      // Pre-fill input
      siloMk2.stored = { [ResourceType.WATER_ICE]: 500 };
      recomputeSiteStorage(site);

      processRefineries(state);

      // Output: 11 kg H2 + 89 kg O2, distributed by remaining capacity
      // Mk1 PV: 1000 kg, Mk2 PV: 2500 kg → ratio 1000/3500 : 2500/3500
      const mk1H2 = pvMk1.stored![ResourceType.HYDROGEN] ?? 0;
      const mk2H2 = pvMk2.stored![ResourceType.HYDROGEN] ?? 0;
      const mk1O2 = pvMk1.stored![ResourceType.OXYGEN] ?? 0;
      const mk2O2 = pvMk2.stored![ResourceType.OXYGEN] ?? 0;

      // Each gas is distributed proportionally by remaining capacity
      expect(mk1H2 + mk2H2).toBeCloseTo(11, 5);
      expect(mk1O2 + mk2O2).toBeCloseTo(89, 5);

      // Mk1 gets 1000/3500 share, Mk2 gets 2500/3500 share
      const mk1Share = 1000 / 3500;
      const mk2Share = 2500 / 3500;
      expect(mk1H2).toBeCloseTo(11 * mk1Share, 4);
      expect(mk2H2).toBeCloseTo(11 * mk2Share, 4);
      expect(mk1O2).toBeCloseTo(89 * mk1Share, 4);
      expect(mk2O2).toBeCloseTo(89 * mk2Share, 4);
    });
  });

  describe('recomputeSiteStorage aggregates across Mk1 and Mk2 modules', () => {
    it('aggregates storage from multiple Mk1 and Mk2 modules of different types', () => {
      const state = createGameState();

      const site = createMiningSite(state, {
        name: 'Aggregation Test Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });

      // Mk1 silo (SOLID): 2000 kg capacity
      const siloMk1 = addModuleToSite(site, {
        partId: 'storage-silo-mk1',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 2,
      });

      // Mk2 silo (SOLID): 5000 kg capacity
      const siloMk2 = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      // Mk1 pressure vessel (GAS): 1000 kg capacity
      const pvMk1 = addModuleToSite(site, {
        partId: 'pressure-vessel-mk1',
        type: MiningModuleType.PRESSURE_VESSEL,
        powerDraw: 5,
      });

      // Mk2 pressure vessel (GAS): 2500 kg capacity
      const pvMk2 = addModuleToSite(site, {
        partId: 'pressure-vessel-mk2',
        type: MiningModuleType.PRESSURE_VESSEL,
        powerDraw: 8,
      });

      // Mk1 fluid tank (LIQUID): default capacity
      const ftMk1 = addModuleToSite(site, {
        partId: 'fluid-tank-mk1',
        type: MiningModuleType.FLUID_TANK,
        powerDraw: 5,
      });

      // Mk2 fluid tank (LIQUID): 3750 kg capacity
      const ftMk2 = addModuleToSite(site, {
        partId: 'fluid-tank-mk2',
        type: MiningModuleType.FLUID_TANK,
        powerDraw: 8,
      });

      // Pre-fill various modules with resources
      siloMk1.stored = { [ResourceType.WATER_ICE]: 100, [ResourceType.REGOLITH]: 300 };
      siloMk2.stored = { [ResourceType.WATER_ICE]: 250, [ResourceType.REGOLITH]: 1500 };
      pvMk1.stored = { [ResourceType.HYDROGEN]: 20, [ResourceType.OXYGEN]: 80 };
      pvMk2.stored = { [ResourceType.HYDROGEN]: 50, [ResourceType.OXYGEN]: 200 };
      ftMk1.stored = { [ResourceType.LIQUID_METHANE]: 100 };
      ftMk2.stored = { [ResourceType.LIQUID_METHANE]: 400 };

      recomputeSiteStorage(site);

      // SOLID: WATER_ICE = 100 + 250 = 350, REGOLITH = 300 + 1500 = 1800
      expect(site.storage[ResourceType.WATER_ICE]).toBeCloseTo(350, 5);
      expect(site.storage[ResourceType.REGOLITH]).toBeCloseTo(1800, 5);

      // GAS: HYDROGEN = 20 + 50 = 70, OXYGEN = 80 + 200 = 280
      expect(site.storage[ResourceType.HYDROGEN]).toBeCloseTo(70, 5);
      expect(site.storage[ResourceType.OXYGEN]).toBeCloseTo(280, 5);

      // LIQUID: LIQUID_METHANE = 100 + 400 = 500
      expect(site.storage[ResourceType.LIQUID_METHANE]).toBeCloseTo(500, 5);
    });

    it('handles empty modules without errors during aggregation', () => {
      const state = createGameState();

      const site = createMiningSite(state, {
        name: 'Empty Aggregation Site',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnitPartId: 'base-control-unit-mk1',
      });

      // Mix of empty Mk1 and Mk2 modules
      addModuleToSite(site, {
        partId: 'storage-silo-mk1',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 2,
      });

      const siloMk2 = addModuleToSite(site, {
        partId: 'storage-silo-mk2',
        type: MiningModuleType.STORAGE_SILO,
        powerDraw: 3,
      });

      // Only Mk2 has resources
      siloMk2.stored = { [ResourceType.WATER_ICE]: 750 };

      recomputeSiteStorage(site);

      // Should aggregate only the Mk2 stored value
      expect(site.storage[ResourceType.WATER_ICE]).toBeCloseTo(750, 5);

      // No other resources should be present
      const totalResources = Object.values(site.storage).reduce((sum, v) => sum + (v ?? 0), 0);
      expect(totalResources).toBeCloseTo(750, 5);
    });
  });
});

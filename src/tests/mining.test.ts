import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import { createMiningSite, findNearestSite, addModuleToSite, toggleConnection, SITE_PROXIMITY_RADIUS } from '../core/mining.ts';
import { MiningModuleType } from '../core/constants.ts';

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

  it('has empty storage, production, and orbitalBuffer', () => {
    const state = createGameState();
    const site = createMiningSite(state, {
      name: 'Beta Outpost',
      bodyId: 'mars',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-2',
    });

    expect(site.storage).toEqual({});
    expect(site.production).toEqual({});
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

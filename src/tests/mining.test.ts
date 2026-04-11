import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import { createMiningSite, findNearestSite, SITE_PROXIMITY_RADIUS } from '../core/mining.ts';

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

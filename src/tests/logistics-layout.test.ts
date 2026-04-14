/**
 * logistics-layout.test.ts -- Tests for the schematic layout algorithm.
 *
 * Verifies that computeSchematicLayout() dynamically positions celestial
 * bodies based on the body hierarchy and game state.
 */

import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import { createMiningSite } from '../core/mining.ts';
import { EARTH_HUB_ID } from '../core/constants.ts';
import { computeSchematicLayout, getSchematicWidth } from '../ui/logistics/_schematicLayout.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMiningSite(bodyId: string) {
  return {
    name: `Site on ${bodyId}`,
    bodyId,
    coordinates: { x: 0, y: 0 },
    controlUnitPartId: 'mining-control-unit',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeSchematicLayout', () => {
  it('@smoke Sun always present', () => {
    const state = createGameState();
    const layout = computeSchematicLayout(state);

    expect(layout.has('SUN')).toBe(true);
    const sun = layout.get('SUN')!;
    expect(sun.type).toBe('body');
    expect(sun.label).toBe('Sun');
    expect(sun.radius).toBe(20);
  });

  it('Sun present with null state', () => {
    const layout = computeSchematicLayout(null);

    expect(layout.has('SUN')).toBe(true);
    const sun = layout.get('SUN')!;
    expect(sun.label).toBe('Sun');
  });

  it('Earth always present', () => {
    const state = createGameState();
    const layout = computeSchematicLayout(state);

    expect(layout.has('EARTH')).toBe(true);
    const earth = layout.get('EARTH')!;
    expect(earth.type).toBe('body');
    expect(earth.label).toBe('Earth');
    expect(earth.radius).toBe(14);
    expect(earth.y).toBe(100);
  });

  it('Earth present with null state', () => {
    const layout = computeSchematicLayout(null);

    expect(layout.has('EARTH')).toBe(true);
  });

  it('Moon positioned as child of Earth when it has a mining site', () => {
    const state = createGameState();
    createMiningSite(state, makeMiningSite('MOON'));

    const layout = computeSchematicLayout(state);

    expect(layout.has('MOON')).toBe(true);
    const moon = layout.get('MOON')!;
    const earth = layout.get('EARTH')!;

    expect(moon.parentId).toBe('EARTH');
    expect(moon.type).toBe('body');
    expect(moon.label).toBe('Moon');
    // Moon should be above Earth (lower y value)
    expect(moon.y).toBeLessThan(earth.y);
  });

  it('Mars appears when it has a mining site', () => {
    const state = createGameState();
    createMiningSite(state, makeMiningSite('MARS'));

    const layout = computeSchematicLayout(state);

    expect(layout.has('MARS')).toBe(true);
    const mars = layout.get('MARS')!;
    expect(mars.type).toBe('body');
    expect(mars.label).toBe('Mars');
    expect(mars.radius).toBe(12);
    expect(mars.y).toBe(100);
  });

  it('invisible bodies excluded with default state', () => {
    const state = createGameState();
    const layout = computeSchematicLayout(state);

    // Only Sun and Earth should be visible in a fresh state
    // (Earth hub makes EARTH visible)
    expect(layout.has('JUPITER')).toBe(false);
    expect(layout.has('SATURN')).toBe(false);
    expect(layout.has('MARS')).toBe(false);
    expect(layout.has('MERCURY')).toBe(false);
    expect(layout.has('VENUS')).toBe(false);
    expect(layout.has('CERES')).toBe(false);
    expect(layout.has('TITAN')).toBe(false);
    expect(layout.has('MOON')).toBe(false);
  });

  it('multiple moons stagger horizontally', () => {
    const state = createGameState();
    createMiningSite(state, makeMiningSite('PHOBOS'));
    createMiningSite(state, makeMiningSite('DEIMOS'));

    const layout = computeSchematicLayout(state);

    expect(layout.has('PHOBOS')).toBe(true);
    expect(layout.has('DEIMOS')).toBe(true);
    // Mars should also be visible as parent of PHOBOS/DEIMOS
    expect(layout.has('MARS')).toBe(true);

    const phobos = layout.get('PHOBOS')!;
    const deimos = layout.get('DEIMOS')!;

    // Both moons should have different x positions
    expect(phobos.x).not.toBe(deimos.x);
    // Both should be above the center line (moons are above parent)
    expect(phobos.y).toBeLessThan(100);
    expect(deimos.y).toBeLessThan(100);
    // Both should have MARS as parent
    expect(phobos.parentId).toBe('MARS');
    expect(deimos.parentId).toBe('MARS');
  });

  it('planets sorted in orbit order', () => {
    const state = createGameState();
    // Add mining sites on Mars and Jupiter to make them visible
    createMiningSite(state, makeMiningSite('MARS'));
    createMiningSite(state, makeMiningSite('JUPITER'));

    const layout = computeSchematicLayout(state);

    const earth = layout.get('EARTH')!;
    const mars = layout.get('MARS')!;
    const jupiter = layout.get('JUPITER')!;

    // Earth is closer to the Sun than Mars, Mars closer than Jupiter
    expect(earth.x).toBeLessThan(mars.x);
    expect(mars.x).toBeLessThan(jupiter.x);
  });

  it('body visible when it has a hub', () => {
    const state = createGameState();
    // The default Earth hub makes Earth visible, add a Mars hub
    state.hubs.push({
      id: 'hub-mars',
      name: 'Mars Base',
      type: 'surface',
      bodyId: 'MARS',
      facilities: {},
      tourists: [],
      partInventory: [],
      constructionQueue: [],
      maintenanceCost: 0,
      established: 0,
      online: true,
    });

    const layout = computeSchematicLayout(state);

    expect(layout.has('MARS')).toBe(true);
  });

  it('body visible when it is a route endpoint', () => {
    const state = createGameState();
    state.routes.push({
      id: 'route-1',
      name: 'Earth to Mars',
      status: 'active',
      resourceType: 'WATER_ICE' as any,
      legs: [{
        id: 'leg-1',
        origin: { bodyId: 'EARTH', locationType: 'orbit', hubId: null },
        destination: { bodyId: 'MARS', locationType: 'orbit', hubId: null },
        craftDesignId: 'design-1',
        craftCount: 1,
        cargoCapacityKg: 5000,
        costPerRun: 100000,
        provenFlightId: 'flight-1',
      }],
      throughputPerPeriod: 5000,
      totalCostPerPeriod: 100000,
    });

    const layout = computeSchematicLayout(state);

    expect(layout.has('MARS')).toBe(true);
  });

  it('body visible when it is a proven leg endpoint', () => {
    const state = createGameState();
    state.provenLegs.push({
      id: 'pleg-1',
      origin: { bodyId: 'EARTH', locationType: 'orbit', hubId: null },
      destination: { bodyId: 'CERES', locationType: 'orbit', hubId: null },
      craftDesignId: 'design-1',
      cargoCapacityKg: 5000,
      costPerRun: 100000,
      provenFlightId: 'flight-1',
      dateProven: 1,
    });

    const layout = computeSchematicLayout(state);

    expect(layout.has('CERES')).toBe(true);
  });

  it('parent planet added when moon is visible', () => {
    const state = createGameState();
    // Add a mining site on Titan (moon of Saturn)
    createMiningSite(state, makeMiningSite('TITAN'));

    const layout = computeSchematicLayout(state);

    // Titan should be visible
    expect(layout.has('TITAN')).toBe(true);
    // Saturn should also be visible as Titan's parent
    expect(layout.has('SATURN')).toBe(true);
    expect(layout.get('TITAN')!.parentId).toBe('SATURN');
  });

  it('layout width includes padding', () => {
    const state = createGameState();
    const layout = computeSchematicLayout(state);
    const width = getSchematicWidth(layout);

    // With Sun at 60 and Earth at 180 (60 + 1 * 120), width should be 180 + 80 = 260
    const earth = layout.get('EARTH')!;
    expect(width).toBe(earth.x + 80);
  });

  // -------------------------------------------------------------------------
  // Hub node placement tests
  // -------------------------------------------------------------------------

  it('surface hub positioned below parent body', () => {
    const state = createGameState();
    // Make Mars visible by adding a mining site
    createMiningSite(state, makeMiningSite('MARS'));
    state.hubs.push({
      id: 'hub-mars-1', name: 'Mars Base', type: 'surface', bodyId: 'MARS',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });

    const layout = computeSchematicLayout(state);

    const mars = layout.get('MARS')!;
    const hubNode = layout.get('hub-surface-hub-mars-1')!;

    expect(hubNode).toBeDefined();
    expect(hubNode.type).toBe('surfaceHub');
    expect(hubNode.hubId).toBe('hub-mars-1');
    expect(hubNode.parentId).toBe('MARS');
    expect(hubNode.radius).toBe(4);
    expect(hubNode.x).toBe(mars.x); // single hub centered on parent
    expect(hubNode.y).toBe(mars.y + mars.radius + 20);
    expect(hubNode.label).toBe('Mars Base');
  });

  it('orbital hub positioned to upper-right of parent body', () => {
    const state = createGameState();
    createMiningSite(state, makeMiningSite('MARS'));
    state.hubs.push({
      id: 'hub-mars-orbit', name: 'Mars Station', type: 'orbital', bodyId: 'MARS',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });

    const layout = computeSchematicLayout(state);

    const mars = layout.get('MARS')!;
    const hubNode = layout.get('hub-orbital-hub-mars-orbit')!;

    expect(hubNode).toBeDefined();
    expect(hubNode.type).toBe('orbitalHub');
    expect(hubNode.hubId).toBe('hub-mars-orbit');
    expect(hubNode.parentId).toBe('MARS');
    expect(hubNode.radius).toBe(5);
    expect(hubNode.x).toBe(mars.x + mars.radius + 15);
    expect(hubNode.y).toBe(mars.y - 15);
    expect(hubNode.label).toBe('Mars Station');
  });

  it('multiple surface hubs on same body fan horizontally', () => {
    const state = createGameState();
    createMiningSite(state, makeMiningSite('MARS'));
    state.hubs.push({
      id: 'hub-mars-a', name: 'Base Alpha', type: 'surface', bodyId: 'MARS',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });
    state.hubs.push({
      id: 'hub-mars-b', name: 'Base Beta', type: 'surface', bodyId: 'MARS',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });

    const layout = computeSchematicLayout(state);

    const mars = layout.get('MARS')!;
    const hubA = layout.get('hub-surface-hub-mars-a')!;
    const hubB = layout.get('hub-surface-hub-mars-b')!;

    // Two hubs should be offset -12.5 and +12.5 from parent x
    expect(hubA.x).toBe(mars.x + (0 - 0.5) * 25);
    expect(hubB.x).toBe(mars.x + (1 - 0.5) * 25);
    // Both at same y
    expect(hubA.y).toBe(hubB.y);
    expect(hubA.y).toBe(mars.y + mars.radius + 20);
  });

  it('multiple orbital hubs on same body fan vertically', () => {
    const state = createGameState();
    createMiningSite(state, makeMiningSite('MARS'));
    state.hubs.push({
      id: 'hub-mars-o1', name: 'Station One', type: 'orbital', bodyId: 'MARS',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });
    state.hubs.push({
      id: 'hub-mars-o2', name: 'Station Two', type: 'orbital', bodyId: 'MARS',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });

    const layout = computeSchematicLayout(state);

    const mars = layout.get('MARS')!;
    const hub1 = layout.get('hub-orbital-hub-mars-o1')!;
    const hub2 = layout.get('hub-orbital-hub-mars-o2')!;

    // Both at same x
    expect(hub1.x).toBe(mars.x + mars.radius + 15);
    expect(hub2.x).toBe(mars.x + mars.radius + 15);
    // Fanned vertically by 20px
    expect(hub1.y).toBe(mars.y - 15);
    expect(hub2.y).toBe(mars.y - 15 + 20);
  });

  it('Earth hub is NOT rendered as a hub node', () => {
    const state = createGameState();
    const layout = computeSchematicLayout(state);

    // The default Earth hub should not produce a hub node
    const earthHubNode = layout.get(`hub-surface-${EARTH_HUB_ID}`);
    const earthHubNodeOrbital = layout.get(`hub-orbital-${EARTH_HUB_ID}`);
    expect(earthHubNode).toBeUndefined();
    expect(earthHubNodeOrbital).toBeUndefined();

    // Earth body node should still exist
    expect(layout.has('EARTH')).toBe(true);
  });

  it('hub on body not in layout is skipped', () => {
    const state = createGameState();
    // Add a hub on Jupiter but do NOT make Jupiter visible (no mining site, route, etc.)
    state.hubs.push({
      id: 'hub-jup-1', name: 'Jupiter Lab', type: 'orbital', bodyId: 'JUPITER',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });

    // NOTE: getVisibleBodies checks state.hubs so Jupiter WILL be visible.
    // To test the "parent not in layout" path we'd need a bodyId that doesn't
    // exist in the body definitions at all.
    // Instead, test with a non-existent body ID.
    state.hubs.push({
      id: 'hub-fake', name: 'Fake Base', type: 'surface', bodyId: 'NONEXISTENT_BODY',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });

    const layout = computeSchematicLayout(state);

    // The hub on a non-existent body should not appear
    expect(layout.has('hub-surface-hub-fake')).toBe(false);
  });

  it('hub label truncated to 12 chars with "..."', () => {
    const state = createGameState();
    createMiningSite(state, makeMiningSite('MARS'));
    state.hubs.push({
      id: 'hub-mars-long', name: 'Mars Research Colony Alpha', type: 'surface', bodyId: 'MARS',
      facilities: {}, tourists: [], partInventory: [], constructionQueue: [],
      maintenanceCost: 0, established: 0, online: true,
    });

    const layout = computeSchematicLayout(state);

    const hubNode = layout.get('hub-surface-hub-mars-long')!;
    expect(hubNode.label).toBe('Mars Researc...');
    expect(hubNode.label.length).toBe(15); // 12 chars + "..."
  });
});

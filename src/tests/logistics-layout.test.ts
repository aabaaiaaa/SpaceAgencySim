/**
 * logistics-layout.test.ts -- Tests for the schematic layout algorithm.
 *
 * Verifies that computeSchematicLayout() dynamically positions celestial
 * bodies based on the body hierarchy and game state.
 */

import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import { createMiningSite } from '../core/mining.ts';
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
        origin: { bodyId: 'EARTH', locationType: 'orbit' },
        destination: { bodyId: 'MARS', locationType: 'orbit' },
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
      origin: { bodyId: 'EARTH', locationType: 'orbit' },
      destination: { bodyId: 'CERES', locationType: 'orbit' },
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
});

import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  proveRouteLeg,
  locationsMatch,
  getProvenLegsForOriginDestination,
  calculateRouteThroughput,
  createRoute,
  addCraftToLeg,
  setRouteStatus,
  processRoutes,
  getRouteDependencies,
  getSafeOrbitRange,
} from '../core/routes.ts';
import type { SafeOrbitRange } from '../core/routes.ts';
import { createMiningSite } from '../core/mining.ts';
import { createHub } from '../core/hubs.ts';
import { advancePeriod } from '../core/period.ts';
import { ResourceType, EARTH_HUB_ID } from '../core/constants.ts';
import { RESOURCES_BY_ID } from '../data/resources.ts';

import type { RouteLocation, RouteLeg } from '../core/gameState.ts';
import type { ProveRouteLegParams } from '../core/routes.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function surface(bodyId: string): RouteLocation {
  return { bodyId, locationType: 'surface', hubId: null };
}

function orbit(bodyId: string, altitude?: number): RouteLocation {
  return altitude !== undefined
    ? { bodyId, locationType: 'orbit', altitude, hubId: null }
    : { bodyId, locationType: 'orbit', hubId: null };
}

function makeParams(overrides?: Partial<ProveRouteLegParams>): ProveRouteLegParams {
  return {
    origin: surface('earth'),
    destination: orbit('earth', 200),
    craftDesignId: 'design-1',
    cargoCapacityKg: 5000,
    costPerRun: 100_000,
    flightId: 'flight-001',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// proveRouteLeg
// ---------------------------------------------------------------------------

describe('proveRouteLeg', () => {
  it('creates a ProvenLeg and pushes it to state.provenLegs', () => {
    const state = createGameState();
    const leg = proveRouteLeg(state, makeParams());

    expect(state.provenLegs).toHaveLength(1);
    expect(state.provenLegs[0]).toBe(leg);
  });

  it('returns a ProvenLeg with a unique ID', () => {
    const state = createGameState();
    const leg1 = proveRouteLeg(state, makeParams({ flightId: 'f1' }));
    const leg2 = proveRouteLeg(state, makeParams({ flightId: 'f2' }));

    expect(leg1.id).toMatch(/^proven-leg-/);
    expect(leg2.id).toMatch(/^proven-leg-/);
    expect(leg1.id).not.toBe(leg2.id);
  });

  it('sets dateProven to state.currentPeriod', () => {
    const state = createGameState();
    state.currentPeriod = 42;
    const leg = proveRouteLeg(state, makeParams());

    expect(leg.dateProven).toBe(42);
  });

  it('copies origin, destination, craftDesignId, cargoCapacityKg, costPerRun from params', () => {
    const state = createGameState();
    const params = makeParams({
      origin: surface('moon'),
      destination: orbit('moon', 50),
      craftDesignId: 'lunar-shuttle',
      cargoCapacityKg: 800,
      costPerRun: 25_000,
      flightId: 'flight-lunar',
    });
    const leg = proveRouteLeg(state, params);

    expect(leg.origin).toEqual(surface('moon'));
    expect(leg.destination).toEqual(orbit('moon', 50));
    expect(leg.craftDesignId).toBe('lunar-shuttle');
    expect(leg.cargoCapacityKg).toBe(800);
    expect(leg.costPerRun).toBe(25_000);
    expect(leg.provenFlightId).toBe('flight-lunar');
  });

  it('stores hubId on origin and destination when provided', () => {
    const state = createGameState();
    const leg = proveRouteLeg(state, {
      ...makeParams(),
      origin: { bodyId: 'MOON', locationType: 'surface', hubId: null },
      destination: { bodyId: 'EARTH', locationType: 'orbit', hubId: null },
      originHubId: 'hub-moon-1',
      destinationHubId: 'hub-earth-1',
    });
    expect(leg.origin.hubId).toBe('hub-moon-1');
    expect(leg.destination.hubId).toBe('hub-earth-1');
  });

  it('stores null hubId when no hubs provided', () => {
    const state = createGameState();
    const leg = proveRouteLeg(state, makeParams());
    expect(leg.origin.hubId).toBeNull();
    expect(leg.destination.hubId).toBeNull();
  });

  it('preserves hubId from origin/destination when params not provided', () => {
    const state = createGameState();
    const leg = proveRouteLeg(state, {
      ...makeParams(),
      origin: { bodyId: 'MOON', locationType: 'surface', hubId: 'existing-hub' },
      destination: { bodyId: 'EARTH', locationType: 'orbit', hubId: null },
    });
    expect(leg.origin.hubId).toBe('existing-hub');
    expect(leg.destination.hubId).toBeNull();
  });

  it('supports multiple proven legs for the same route with different craft', () => {
    const state = createGameState();
    const leg1 = proveRouteLeg(
      state,
      makeParams({ craftDesignId: 'small-shuttle', cargoCapacityKg: 500 }),
    );
    const leg2 = proveRouteLeg(
      state,
      makeParams({ craftDesignId: 'heavy-lifter', cargoCapacityKg: 20_000 }),
    );

    expect(state.provenLegs).toHaveLength(2);
    expect(leg1.craftDesignId).toBe('small-shuttle');
    expect(leg2.craftDesignId).toBe('heavy-lifter');
  });
});

// ---------------------------------------------------------------------------
// locationsMatch
// ---------------------------------------------------------------------------

describe('locationsMatch', () => {
  it('returns true for identical surface locations', () => {
    expect(locationsMatch(surface('earth'), surface('earth'))).toBe(true);
  });

  it('returns true for identical orbit locations with same altitude', () => {
    expect(locationsMatch(orbit('earth', 200), orbit('earth', 200))).toBe(true);
  });

  it('returns false when bodyId differs', () => {
    expect(locationsMatch(surface('earth'), surface('moon'))).toBe(false);
  });

  it('returns false when locationType differs', () => {
    expect(locationsMatch(surface('earth'), orbit('earth'))).toBe(false);
  });

  it('returns false when both altitudes are defined but differ', () => {
    expect(locationsMatch(orbit('earth', 200), orbit('earth', 400))).toBe(false);
  });

  it('returns true when one altitude is undefined (left)', () => {
    expect(locationsMatch(orbit('earth'), orbit('earth', 200))).toBe(true);
  });

  it('returns true when one altitude is undefined (right)', () => {
    expect(locationsMatch(orbit('earth', 200), orbit('earth'))).toBe(true);
  });

  it('returns true when both altitudes are undefined', () => {
    expect(locationsMatch(orbit('earth'), orbit('earth'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getProvenLegsForOriginDestination
// ---------------------------------------------------------------------------

describe('getProvenLegsForOriginDestination', () => {
  it('returns matching legs for the given origin and destination', () => {
    const state = createGameState();
    proveRouteLeg(state, makeParams({
      origin: surface('earth'),
      destination: orbit('earth', 200),
      flightId: 'f1',
    }));
    proveRouteLeg(state, makeParams({
      origin: surface('earth'),
      destination: orbit('earth', 200),
      flightId: 'f2',
    }));
    // Different route — should not match.
    proveRouteLeg(state, makeParams({
      origin: surface('moon'),
      destination: orbit('moon', 50),
      flightId: 'f3',
    }));

    const results = getProvenLegsForOriginDestination(
      state,
      surface('earth'),
      orbit('earth', 200),
    );

    expect(results).toHaveLength(2);
    expect(results[0].provenFlightId).toBe('f1');
    expect(results[1].provenFlightId).toBe('f2');
  });

  it('returns empty array when no legs match', () => {
    const state = createGameState();
    proveRouteLeg(state, makeParams({
      origin: surface('earth'),
      destination: orbit('earth', 200),
    }));

    const results = getProvenLegsForOriginDestination(
      state,
      surface('mars'),
      orbit('mars', 300),
    );

    expect(results).toEqual([]);
  });

  it('returns empty array when state has no proven legs', () => {
    const state = createGameState();
    const results = getProvenLegsForOriginDestination(
      state,
      surface('earth'),
      orbit('earth', 200),
    );

    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// calculateRouteThroughput
// ---------------------------------------------------------------------------

describe('calculateRouteThroughput', () => {
  it('returns 0 for empty legs array', () => {
    expect(calculateRouteThroughput([])).toBe(0);
  });

  it('returns cargoCapacityKg * craftCount for a single leg', () => {
    const legs: RouteLeg[] = [
      {
        id: 'leg-1',
        origin: surface('earth'),
        destination: orbit('earth', 200),
        craftDesignId: 'design-1',
        craftCount: 3,
        cargoCapacityKg: 1000,
        costPerRun: 50_000,
        provenFlightId: 'f1',
      },
    ];
    expect(calculateRouteThroughput(legs)).toBe(3000);
  });

  it('returns the minimum of capacity*craftCount across all legs', () => {
    const legs: RouteLeg[] = [
      {
        id: 'leg-1',
        origin: surface('earth'),
        destination: orbit('earth', 200),
        craftDesignId: 'design-1',
        craftCount: 2,
        cargoCapacityKg: 5000,
        costPerRun: 100_000,
        provenFlightId: 'f1',
      },
      {
        id: 'leg-2',
        origin: orbit('earth', 200),
        destination: orbit('MOON', 50),
        craftDesignId: 'design-2',
        craftCount: 1,
        cargoCapacityKg: 2000,
        costPerRun: 200_000,
        provenFlightId: 'f2',
      },
    ];
    // leg-1: 2*5000 = 10000, leg-2: 1*2000 = 2000 → min = 2000
    expect(calculateRouteThroughput(legs)).toBe(2000);
  });
});

// ---------------------------------------------------------------------------
// createRoute
// ---------------------------------------------------------------------------

describe('createRoute', () => {
  it('creates a route from proven leg IDs and pushes it to state.routes @smoke', () => {
    const state = createGameState();
    const pl1 = proveRouteLeg(state, makeParams({ flightId: 'f1', cargoCapacityKg: 5000, costPerRun: 100_000 }));
    const pl2 = proveRouteLeg(state, makeParams({
      origin: orbit('earth', 200),
      destination: orbit('MOON', 50),
      flightId: 'f2',
      cargoCapacityKg: 2000,
      costPerRun: 200_000,
    }));

    const route = createRoute(state, {
      name: 'Earth to Moon',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl1.id, pl2.id],
    });

    expect(state.routes).toHaveLength(1);
    expect(state.routes[0]).toBe(route);
  });

  it('starts with status paused', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams());
    const route = createRoute(state, {
      name: 'Test Route',
      resourceType: ResourceType.REGOLITH,
      provenLegIds: [pl.id],
    });

    expect(route.status).toBe('paused');
  });

  it('assigns craftCount 1 to each leg', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams());
    const route = createRoute(state, {
      name: 'Test Route',
      resourceType: ResourceType.REGOLITH,
      provenLegIds: [pl.id],
    });

    expect(route.legs[0].craftCount).toBe(1);
  });

  it('calculates correct throughput and totalCostPerPeriod', () => {
    const state = createGameState();
    const pl1 = proveRouteLeg(state, makeParams({ cargoCapacityKg: 5000, costPerRun: 100_000, flightId: 'f1' }));
    const pl2 = proveRouteLeg(state, makeParams({
      origin: orbit('earth', 200),
      destination: orbit('MOON', 50),
      cargoCapacityKg: 3000,
      costPerRun: 150_000,
      flightId: 'f2',
    }));

    const route = createRoute(state, {
      name: 'Multi-leg',
      resourceType: ResourceType.IRON_ORE,
      provenLegIds: [pl1.id, pl2.id],
    });

    // craftCount = 1 for all legs, so throughput = min(5000*1, 3000*1) = 3000
    expect(route.throughputPerPeriod).toBe(3000);
    // totalCost = 100_000*1 + 150_000*1 = 250_000
    expect(route.totalCostPerPeriod).toBe(250_000);
  });

  it('copies fields from proven legs to route legs', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams({
      origin: surface('MOON'),
      destination: orbit('MOON', 50),
      craftDesignId: 'lunar-shuttle',
      cargoCapacityKg: 800,
      costPerRun: 25_000,
      flightId: 'flight-lunar',
    }));

    const route = createRoute(state, {
      name: 'Lunar Route',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });

    const leg = route.legs[0];
    expect(leg.origin).toEqual(surface('MOON'));
    expect(leg.destination).toEqual(orbit('MOON', 50));
    expect(leg.craftDesignId).toBe('lunar-shuttle');
    expect(leg.cargoCapacityKg).toBe(800);
    expect(leg.costPerRun).toBe(25_000);
    expect(leg.provenFlightId).toBe('flight-lunar');
  });

  it('generates unique route and leg IDs', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams());
    const r1 = createRoute(state, { name: 'Route 1', resourceType: ResourceType.REGOLITH, provenLegIds: [pl.id] });
    const r2 = createRoute(state, { name: 'Route 2', resourceType: ResourceType.REGOLITH, provenLegIds: [pl.id] });

    expect(r1.id).not.toBe(r2.id);
    expect(r1.legs[0].id).not.toBe(r2.legs[0].id);
  });
});

// ---------------------------------------------------------------------------
// addCraftToLeg
// ---------------------------------------------------------------------------

describe('addCraftToLeg', () => {
  it('increments craft count and recalculates throughput and cost', () => {
    const state = createGameState();
    const pl1 = proveRouteLeg(state, makeParams({ cargoCapacityKg: 5000, costPerRun: 100_000, flightId: 'f1' }));
    const pl2 = proveRouteLeg(state, makeParams({
      origin: orbit('earth', 200),
      destination: orbit('MOON', 50),
      cargoCapacityKg: 2000,
      costPerRun: 200_000,
      flightId: 'f2',
    }));

    const route = createRoute(state, {
      name: 'Test',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl1.id, pl2.id],
    });

    // Initially: throughput = min(5000*1, 2000*1) = 2000, cost = 300_000
    expect(route.throughputPerPeriod).toBe(2000);
    expect(route.totalCostPerPeriod).toBe(300_000);

    // Add craft to second leg (the bottleneck)
    const result = addCraftToLeg(route, route.legs[1].id);
    expect(result).toBe(true);
    expect(route.legs[1].craftCount).toBe(2);

    // Now: throughput = min(5000*1, 2000*2) = min(5000, 4000) = 4000
    expect(route.throughputPerPeriod).toBe(4000);
    // cost = 100_000*1 + 200_000*2 = 500_000
    expect(route.totalCostPerPeriod).toBe(500_000);
  });

  it('returns false for an unknown leg ID', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams());
    const route = createRoute(state, {
      name: 'Test',
      resourceType: ResourceType.REGOLITH,
      provenLegIds: [pl.id],
    });

    expect(addCraftToLeg(route, 'nonexistent-leg-id')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setRouteStatus
// ---------------------------------------------------------------------------

describe('setRouteStatus', () => {
  it('changes route status', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams());
    const route = createRoute(state, {
      name: 'Test',
      resourceType: ResourceType.REGOLITH,
      provenLegIds: [pl.id],
    });

    expect(route.status).toBe('paused');

    setRouteStatus(route, 'active');
    expect(route.status).toBe('active');

    setRouteStatus(route, 'broken');
    expect(route.status).toBe('broken');

    setRouteStatus(route, 'paused');
    expect(route.status).toBe('paused');
  });
});

// ---------------------------------------------------------------------------
// processRoutes
// ---------------------------------------------------------------------------

describe('processRoutes', () => {
  /**
   * Helper to set up a state with a mining site, proven leg, and route
   * for processRoutes tests.
   */
  function setupRouteState(opts?: {
    money?: number;
    bufferAmount?: number;
    resourceType?: ResourceType;
    destBodyId?: string;
  }) {
    const resourceType = opts?.resourceType ?? ResourceType.WATER_ICE;
    const destBodyId = opts?.destBodyId ?? 'EARTH';
    const state = createGameState();
    state.money = opts?.money ?? 10_000_000;

    // Create a mining site on the source body (MOON) with orbital buffer
    const site = createMiningSite(state, {
      name: 'Lunar Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    site.orbitalBuffer[resourceType] = opts?.bufferAmount ?? 5000;

    // Prove a leg from MOON orbit to the destination
    const pl = proveRouteLeg(state, {
      origin: orbit('MOON', 50),
      destination: destBodyId === 'EARTH' ? orbit('EARTH', 200) : orbit(destBodyId, 100),
      craftDesignId: 'cargo-shuttle',
      cargoCapacityKg: 2000,
      costPerRun: 50_000,
      flightId: 'flight-cargo-1',
    });

    // Create and activate the route
    const route = createRoute(state, {
      name: 'Lunar Export',
      resourceType,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    return { state, site, route };
  }

  it('transports resources and generates revenue when destination is Earth @smoke', () => {
    const { state, site, route } = setupRouteState({
      bufferAmount: 5000,
    });
    const initialMoney = state.money;
    const resourceDef = RESOURCES_BY_ID[ResourceType.WATER_ICE];

    processRoutes(state);

    // Transport amount = min(throughput=2000, buffer=5000) = 2000
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(3000); // 5000 - 2000
    // Revenue = 2000 * baseValuePerKg - operating cost
    const expectedRevenue = 2000 * resourceDef.baseValuePerKg;
    const expectedMoney = initialMoney - route.totalCostPerPeriod + expectedRevenue;
    expect(state.money).toBe(expectedMoney);
  });

  it('skips paused routes', () => {
    const { state, site, route } = setupRouteState();
    setRouteStatus(route, 'paused');
    const initialMoney = state.money;
    const initialBuffer = site.orbitalBuffer[ResourceType.WATER_ICE];

    processRoutes(state);

    expect(state.money).toBe(initialMoney);
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(initialBuffer);
  });

  it('deducts operating cost via spend', () => {
    const { state, route } = setupRouteState({ money: 10_000_000 });

    const moneyBefore = state.money;
    processRoutes(state);

    // Operating cost was deducted (and revenue added for Earth destination)
    const resourceDef = RESOURCES_BY_ID[ResourceType.WATER_ICE];
    const transportAmount = 2000; // min(2000 throughput, 5000 buffer)
    const expectedRevenue = transportAmount * resourceDef.baseValuePerKg;
    expect(state.money).toBe(moneyBefore - route.totalCostPerPeriod + expectedRevenue);
  });

  it('skips the route when spend returns false (insufficient funds)', () => {
    const { state, site } = setupRouteState({ money: 0 });

    processRoutes(state);

    // Nothing should change — spend failed, so buffer untouched
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(5000);
    expect(state.money).toBe(0);
  });

  it('transports to non-Earth destination orbital buffer', () => {
    const { state, site } = setupRouteState({
      destBodyId: 'MARS',
      bufferAmount: 5000,
    });

    // Create a destination mining site on Mars
    const marsSite = createMiningSite(state, {
      name: 'Mars Base',
      bodyId: 'MARS',
      coordinates: { x: 100, y: 100 },
      controlUnitPartId: 'ctrl-2',
    });

    const initialMoney = state.money;
    processRoutes(state);

    // Transport amount = min(2000, 5000) = 2000
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(3000);
    expect(marsSite.orbitalBuffer[ResourceType.WATER_ICE]).toBe(2000);
    // No revenue earned for non-Earth destination, only cost deducted
    expect(state.money).toBe(initialMoney - 50_000);
  });

  it('limits transport to available buffer when buffer is less than throughput', () => {
    const { state, site } = setupRouteState({
      bufferAmount: 500, // less than throughput of 2000
    });
    const initialMoney = state.money;
    const resourceDef = RESOURCES_BY_ID[ResourceType.WATER_ICE];

    processRoutes(state);

    // Transport amount = min(2000, 500) = 500
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(0);
    const expectedRevenue = 500 * resourceDef.baseValuePerKg;
    expect(state.money).toBe(initialMoney - 50_000 + expectedRevenue);
  });

  it('sets route to broken when non-Earth destination has no mining site without destination @smoke', () => {
    // Use the existing setupRouteState helper with destBodyId = 'MARS'
    // but do NOT create a mining site on Mars
    const { state, site, route } = setupRouteState({
      destBodyId: 'MARS',
      bufferAmount: 5000,
      money: 10_000_000,
    });

    const initialMoney = state.money;
    const initialBuffer = site.orbitalBuffer[ResourceType.WATER_ICE];

    processRoutes(state);

    // Route should be marked as broken
    expect(route.status).toBe('broken');
    // No money deducted
    expect(state.money).toBe(initialMoney);
    // No resources removed from buffer
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(initialBuffer);
  });
});

// ---------------------------------------------------------------------------
// getRouteDependencies
// ---------------------------------------------------------------------------

describe('getRouteDependencies', () => {
  it('returns active routes with legs at the given body and orbit altitude', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams({
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      flightId: 'f1',
    }));
    const route = createRoute(state, {
      name: 'Moon to Earth',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    const deps = getRouteDependencies(state, 'MOON', 50);
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe(route.id);
  });

  it('returns empty array when no routes at location', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams({
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      flightId: 'f1',
    }));
    const route = createRoute(state, {
      name: 'Moon to Earth',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    const deps = getRouteDependencies(state, 'MARS', 300);
    expect(deps).toEqual([]);
  });

  it('excludes paused and broken routes', () => {
    const state = createGameState();
    const pl1 = proveRouteLeg(state, makeParams({
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      flightId: 'f1',
    }));
    const pl2 = proveRouteLeg(state, makeParams({
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      flightId: 'f2',
    }));
    const pl3 = proveRouteLeg(state, makeParams({
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      flightId: 'f3',
    }));

    const routePaused = createRoute(state, {
      name: 'Paused Route',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl1.id],
    });
    setRouteStatus(routePaused, 'paused');

    const routeBroken = createRoute(state, {
      name: 'Broken Route',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl2.id],
    });
    setRouteStatus(routeBroken, 'broken');

    const routeActive = createRoute(state, {
      name: 'Active Route',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl3.id],
    });
    setRouteStatus(routeActive, 'active');

    const deps = getRouteDependencies(state, 'MOON', 50);
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe(routeActive.id);
  });

  it('matches routes where leg altitude is undefined', () => {
    const state = createGameState();
    const pl = proveRouteLeg(state, makeParams({
      origin: orbit('MOON'),           // no altitude
      destination: orbit('EARTH', 200),
      flightId: 'f1',
    }));
    const route = createRoute(state, {
      name: 'Undefined Altitude Route',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    const deps = getRouteDependencies(state, 'MOON', 50);
    expect(deps).toHaveLength(1);
    expect(deps[0].id).toBe(route.id);
  });
});

// ---------------------------------------------------------------------------
// getSafeOrbitRange
// ---------------------------------------------------------------------------

describe('getSafeOrbitRange', () => {
  it('returns altitude range covering all route orbit altitudes at the body', () => {
    const state = createGameState();

    // Route 1: MOON orbit at altitude 50
    const pl1 = proveRouteLeg(state, makeParams({
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      flightId: 'f1',
    }));
    const route1 = createRoute(state, {
      name: 'Route at 50',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl1.id],
    });
    setRouteStatus(route1, 'active');

    // Route 2: MOON orbit at altitude 100
    const pl2 = proveRouteLeg(state, makeParams({
      origin: orbit('MOON', 100),
      destination: orbit('EARTH', 200),
      flightId: 'f2',
    }));
    const route2 = createRoute(state, {
      name: 'Route at 100',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl2.id],
    });
    setRouteStatus(route2, 'active');

    const range: SafeOrbitRange | null = getSafeOrbitRange(state, 'MOON', 75);
    expect(range).not.toBeNull();
    expect(range!.minAltitude).toBe(50);
    expect(range!.maxAltitude).toBe(100);
  });

  it('returns null when no dependencies exist', () => {
    const state = createGameState();

    const range = getSafeOrbitRange(state, 'MARS', 300);
    expect(range).toBeNull();
  });

  it('ignores undefined altitudes', () => {
    const state = createGameState();

    // Route with undefined altitude at MOON orbit
    const pl = proveRouteLeg(state, makeParams({
      origin: orbit('MOON'),           // no altitude
      destination: orbit('EARTH', 200),
      flightId: 'f1',
    }));
    const route = createRoute(state, {
      name: 'Undefined Altitude Route',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    // Only leg at MOON has undefined altitude — no defined altitudes to collect
    const range = getSafeOrbitRange(state, 'MOON', 75);
    expect(range).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// createRoute — hub-targeted route creation
// ---------------------------------------------------------------------------

describe('createRoute with hub targets', () => {
  it('inherits hubIds from proven legs', () => {
    const state = createGameState();

    // Create hubs so validation passes
    const moonHub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const earthHub = createHub(state, { name: 'Earth Station', type: 'orbital', bodyId: 'EARTH', altitude: 200 });

    // Prove a leg with hubIds set
    const pl = proveRouteLeg(state, {
      origin: surface('MOON'),
      destination: orbit('EARTH', 200),
      craftDesignId: 'shuttle',
      cargoCapacityKg: 1000,
      costPerRun: 50_000,
      flightId: 'f-hub-1',
      originHubId: moonHub.id,
      destinationHubId: earthHub.id,
    });

    const route = createRoute(state, {
      name: 'Hub Route',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });

    expect(route.legs[0].origin.hubId).toBe(moonHub.id);
    expect(route.legs[0].destination.hubId).toBe(earthHub.id);
  });

  it('applies hubOverrides to route legs', () => {
    const state = createGameState();

    // Create hubs
    const moonHub = createHub(state, { name: 'Moon Outpost', type: 'surface', bodyId: 'MOON' });
    const earthHub = createHub(state, { name: 'Earth Dock', type: 'orbital', bodyId: 'EARTH', altitude: 200 });

    // Prove a leg with null hubIds
    const pl = proveRouteLeg(state, {
      origin: surface('MOON'),
      destination: orbit('EARTH', 200),
      craftDesignId: 'shuttle',
      cargoCapacityKg: 1000,
      costPerRun: 50_000,
      flightId: 'f-hub-2',
    });

    // Create route with overrides
    const route = createRoute(state, {
      name: 'Override Route',
      resourceType: ResourceType.REGOLITH,
      provenLegIds: [pl.id],
      hubOverrides: {
        [pl.id]: { originHubId: moonHub.id, destinationHubId: earthHub.id },
      },
    });

    expect(route.legs[0].origin.hubId).toBe(moonHub.id);
    expect(route.legs[0].destination.hubId).toBe(earthHub.id);
  });

  it('rejects invalid originHubId in hubOverrides', () => {
    const state = createGameState();

    const pl = proveRouteLeg(state, {
      origin: surface('MOON'),
      destination: orbit('EARTH', 200),
      craftDesignId: 'shuttle',
      cargoCapacityKg: 1000,
      costPerRun: 50_000,
      flightId: 'f-hub-3',
    });

    expect(() =>
      createRoute(state, {
        name: 'Bad Hub Route',
        resourceType: ResourceType.WATER_ICE,
        provenLegIds: [pl.id],
        hubOverrides: {
          [pl.id]: { originHubId: 'nonexistent-hub-id' },
        },
      }),
    ).toThrow('Hub not found for route origin: nonexistent-hub-id');
  });

  it('rejects invalid destinationHubId in hubOverrides', () => {
    const state = createGameState();

    const pl = proveRouteLeg(state, {
      origin: surface('MOON'),
      destination: orbit('EARTH', 200),
      craftDesignId: 'shuttle',
      cargoCapacityKg: 1000,
      costPerRun: 50_000,
      flightId: 'f-hub-4',
    });

    expect(() =>
      createRoute(state, {
        name: 'Bad Dest Route',
        resourceType: ResourceType.WATER_ICE,
        provenLegIds: [pl.id],
        hubOverrides: {
          [pl.id]: { destinationHubId: 'ghost-hub' },
        },
      }),
    ).toThrow('Hub not found for route destination: ghost-hub');
  });

  it('works with no overrides and null hubIds (existing behaviour preserved)', () => {
    const state = createGameState();

    const pl = proveRouteLeg(state, {
      origin: surface('MOON'),
      destination: orbit('EARTH', 200),
      craftDesignId: 'shuttle',
      cargoCapacityKg: 1000,
      costPerRun: 50_000,
      flightId: 'f-hub-5',
    });

    const route = createRoute(state, {
      name: 'No Hub Route',
      resourceType: ResourceType.IRON_ORE,
      provenLegIds: [pl.id],
    });

    expect(route.legs[0].origin.hubId).toBeNull();
    expect(route.legs[0].destination.hubId).toBeNull();
  });

  it('allows null hubOverride to clear an inherited hubId', () => {
    const state = createGameState();

    const moonHub = createHub(state, { name: 'Moon Clear', type: 'surface', bodyId: 'MOON' });

    // Prove a leg with a hubId on origin
    const pl = proveRouteLeg(state, {
      origin: surface('MOON'),
      destination: orbit('EARTH', 200),
      craftDesignId: 'shuttle',
      cargoCapacityKg: 1000,
      costPerRun: 50_000,
      flightId: 'f-hub-6',
      originHubId: moonHub.id,
    });

    // Override origin hubId to null
    const route = createRoute(state, {
      name: 'Cleared Hub Route',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
      hubOverrides: {
        [pl.id]: { originHubId: null },
      },
    });

    expect(route.legs[0].origin.hubId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Route revenue integration (via advancePeriod)
// ---------------------------------------------------------------------------

describe('route revenue integration', () => {
  it('advancePeriod reports correct revenue and deliveries for an Earth-bound route', () => {
    const state = createGameState();
    // Give enough money to cover all period costs (crew salaries, facility
    // upkeep, route operating costs, etc.)
    state.money = 50_000_000;

    // Create a mining site on the Moon with a stocked orbital buffer
    const resourceType = ResourceType.WATER_ICE;
    const site = createMiningSite(state, {
      name: 'Lunar Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    const bufferAmount = 10_000;
    site.orbitalBuffer[resourceType] = bufferAmount;

    // Prove a leg from MOON orbit to EARTH orbit
    const cargoCapacity = 3000;
    const costPerRun = 75_000;
    const pl = proveRouteLeg(state, {
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      craftDesignId: 'cargo-shuttle',
      cargoCapacityKg: cargoCapacity,
      costPerRun,
      flightId: 'flight-revenue-test',
    });

    // Create and activate the route
    const route = createRoute(state, {
      name: 'Lunar Water Export',
      resourceType,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    // Route has 1 craft → throughputPerPeriod = cargoCapacity * 1 = 3000
    expect(route.throughputPerPeriod).toBe(cargoCapacity);

    // Run advancePeriod and capture the summary
    const summary = advancePeriod(state);

    // Expected transport: min(throughput=3000, buffer=10000) = 3000
    const expectedTransport = Math.min(route.throughputPerPeriod, bufferAmount);
    const resourceDef = RESOURCES_BY_ID[resourceType];
    const expectedRevenue = expectedTransport * resourceDef.baseValuePerKg;

    // Verify PeriodSummary.routeRevenue
    expect(summary.routeRevenue).toBe(expectedRevenue);

    // Verify PeriodSummary.routeOperatingCost
    expect(summary.routeOperatingCost).toBe(route.totalCostPerPeriod);

    // Verify PeriodSummary.routeDeliveries
    expect(summary.routeDeliveries[resourceType]).toBe(expectedTransport);

    // Verify buffer was actually deducted
    expect(site.orbitalBuffer[resourceType]).toBe(bufferAmount - expectedTransport);
  });
});

// ---------------------------------------------------------------------------
// processRoutes — hub-targeted delivery
// ---------------------------------------------------------------------------

describe('processRoutes hub-targeted delivery', () => {
  it('delivers to Earth hub and generates revenue from market sale', () => {
    const state = createGameState();
    state.money = 10_000_000;

    // Create a mining site on MOON with stocked orbital buffer
    const site = createMiningSite(state, {
      name: 'Moon Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    site.orbitalBuffer[ResourceType.WATER_ICE] = 5000;

    // Prove a leg from MOON orbit to EARTH orbit with hub references
    const pl = proveRouteLeg(state, {
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      craftDesignId: 'cargo-shuttle',
      cargoCapacityKg: 2000,
      costPerRun: 50_000,
      flightId: 'flight-earth-hub',
      destinationHubId: EARTH_HUB_ID,
    });

    const route = createRoute(state, {
      name: 'Moon to Earth Hub',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    const initialMoney = state.money;
    const result = processRoutes(state);

    // Transport amount = min(throughput=2000, buffer=5000) = 2000
    const resourceDef = RESOURCES_BY_ID[ResourceType.WATER_ICE];
    const expectedRevenue = 2000 * resourceDef.baseValuePerKg;

    expect(result.revenue).toBe(expectedRevenue);
    expect(result.operatingCost).toBe(50_000);
    expect(result.delivered[ResourceType.WATER_ICE]).toBe(2000);
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(3000);
    expect(state.money).toBe(initialMoney - 50_000 + expectedRevenue);
  });

  it('delivers to off-world hub by depositing into destination orbital buffer', () => {
    const state = createGameState();
    state.money = 10_000_000;

    // Create a mining site on MOON (source) with stocked orbital buffer
    const moonSite = createMiningSite(state, {
      name: 'Moon Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    moonSite.orbitalBuffer[ResourceType.IRON_ORE] = 8000;

    // Create a hub and mining site on MARS (destination)
    const marsHub = createHub(state, { name: 'Mars Outpost', type: 'surface', bodyId: 'MARS' });
    const marsSite = createMiningSite(state, {
      name: 'Mars Base',
      bodyId: 'MARS',
      coordinates: { x: 100, y: 100 },
      controlUnitPartId: 'ctrl-2',
    });

    // Prove a leg from MOON orbit to MARS orbit with hub reference
    const pl = proveRouteLeg(state, {
      origin: orbit('MOON', 50),
      destination: orbit('MARS', 100),
      craftDesignId: 'cargo-shuttle',
      cargoCapacityKg: 3000,
      costPerRun: 80_000,
      flightId: 'flight-mars-hub',
      destinationHubId: marsHub.id,
    });

    const route = createRoute(state, {
      name: 'Moon to Mars Hub',
      resourceType: ResourceType.IRON_ORE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    const initialMoney = state.money;
    const result = processRoutes(state);

    // Transport amount = min(throughput=3000, buffer=8000) = 3000
    expect(result.revenue).toBe(0); // No revenue for non-Earth destination
    expect(result.operatingCost).toBe(80_000);
    expect(result.delivered[ResourceType.IRON_ORE]).toBe(3000);
    expect(moonSite.orbitalBuffer[ResourceType.IRON_ORE]).toBe(5000); // 8000 - 3000
    expect(marsSite.orbitalBuffer[ResourceType.IRON_ORE]).toBe(3000); // deposited
    expect(state.money).toBe(initialMoney - 80_000);
  });

  it('marks route as broken when a leg references a non-existent hub', () => {
    const state = createGameState();
    state.money = 10_000_000;

    // Create a mining site on MOON with stocked orbital buffer
    const site = createMiningSite(state, {
      name: 'Moon Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    site.orbitalBuffer[ResourceType.WATER_ICE] = 5000;

    // Prove a leg — no hub references during proving
    const pl = proveRouteLeg(state, {
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      craftDesignId: 'cargo-shuttle',
      cargoCapacityKg: 2000,
      costPerRun: 50_000,
      flightId: 'flight-broken-hub',
    });

    // Create a route (no hub validation at this point since hubIds are null)
    const route = createRoute(state, {
      name: 'Route with Bad Hub',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    // Manually inject an invalid hubId on a leg's destination to simulate
    // a hub that was deleted after the route was created
    route.legs[0].destination.hubId = 'deleted-hub-id';

    const initialMoney = state.money;
    const result = processRoutes(state);

    // Route should be marked as broken
    expect(route.status).toBe('broken');
    // No resources should have been transported
    expect(result.revenue).toBe(0);
    expect(result.operatingCost).toBe(0);
    expect(result.delivered).toEqual({});
    // Buffer and money should be unchanged
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(5000);
    expect(state.money).toBe(initialMoney);
  });

  it('marks route as broken when origin leg references a non-existent hub', () => {
    const state = createGameState();
    state.money = 10_000_000;

    // Create a mining site on MOON with stocked orbital buffer
    const site = createMiningSite(state, {
      name: 'Moon Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    site.orbitalBuffer[ResourceType.WATER_ICE] = 5000;

    const pl = proveRouteLeg(state, {
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      craftDesignId: 'cargo-shuttle',
      cargoCapacityKg: 2000,
      costPerRun: 50_000,
      flightId: 'flight-broken-origin',
    });

    const route = createRoute(state, {
      name: 'Route with Bad Origin Hub',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    // Manually inject an invalid hubId on a leg's origin
    route.legs[0].origin.hubId = 'nonexistent-origin-hub';

    const result = processRoutes(state);

    expect(route.status).toBe('broken');
    expect(result.revenue).toBe(0);
    expect(result.operatingCost).toBe(0);
    expect(site.orbitalBuffer[ResourceType.WATER_ICE]).toBe(5000);
  });

  it('does not mark route as broken when hub references are null', () => {
    const state = createGameState();
    state.money = 10_000_000;

    // Create a mining site on MOON with stocked orbital buffer
    const site = createMiningSite(state, {
      name: 'Moon Mine',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnitPartId: 'ctrl-1',
    });
    site.orbitalBuffer[ResourceType.WATER_ICE] = 5000;

    const pl = proveRouteLeg(state, {
      origin: orbit('MOON', 50),
      destination: orbit('EARTH', 200),
      craftDesignId: 'cargo-shuttle',
      cargoCapacityKg: 2000,
      costPerRun: 50_000,
      flightId: 'flight-null-hub',
    });

    const route = createRoute(state, {
      name: 'Route with Null Hubs',
      resourceType: ResourceType.WATER_ICE,
      provenLegIds: [pl.id],
    });
    setRouteStatus(route, 'active');

    // Legs have null hubIds by default — should be fine
    const result = processRoutes(state);

    expect(route.status).toBe('active');
    expect(result.delivered[ResourceType.WATER_ICE]).toBe(2000);
  });
});

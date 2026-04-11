import { describe, it, expect } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import {
  proveRouteLeg,
  locationsMatch,
  getProvenLegsForOriginDestination,
} from '../core/routes.ts';

import type { RouteLocation } from '../core/gameState.ts';
import type { ProveRouteLegParams } from '../core/routes.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function surface(bodyId: string): RouteLocation {
  return { bodyId, locationType: 'surface' };
}

function orbit(bodyId: string, altitude?: number): RouteLocation {
  return altitude !== undefined
    ? { bodyId, locationType: 'orbit', altitude }
    : { bodyId, locationType: 'orbit' };
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

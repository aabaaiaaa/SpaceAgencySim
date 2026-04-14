import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import { FacilityId, AstronautStatus } from '../core/constants.ts';
import type { Tourist } from '../core/hubTypes.ts';
import {
  getHubCapacity,
  getHubCapacityRemaining,
  addTourist,
  processTouristRevenue,
  evictTourists,
} from '../core/hubTourists.ts';
import { makeHub, makeCrewMember } from './_factories.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let touristCounter = 0;

/** Creates a Tourist with sensible defaults. */
function makeTourist(overrides: Partial<Tourist> = {}): Tourist {
  touristCounter++;
  return {
    id: overrides.id ?? `tourist-${touristCounter}`,
    name: overrides.name ?? `Tourist ${touristCounter}`,
    arrivalPeriod: overrides.arrivalPeriod ?? 0,
    departurePeriod: overrides.departurePeriod ?? 10,
    revenue: overrides.revenue ?? 5_000,
  };
}

// ---------------------------------------------------------------------------
// getHubCapacity
// ---------------------------------------------------------------------------

describe('getHubCapacity', () => {
  it('returns 0 when hub has no Crew Hab facility', () => {
    const hub = makeHub({ facilities: {} });
    expect(getHubCapacity(hub)).toBe(0);
  });

  it('returns 4 for tier 1 Crew Hab', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
    });
    expect(getHubCapacity(hub)).toBe(4);
  });

  it('returns 8 for tier 2 Crew Hab', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 2 } },
    });
    expect(getHubCapacity(hub)).toBe(8);
  });

  it('returns 16 for tier 3 Crew Hab', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 3 } },
    });
    expect(getHubCapacity(hub)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// getHubCapacityRemaining
// ---------------------------------------------------------------------------

describe('getHubCapacityRemaining', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState();
  });

  it('returns full capacity when hub has no crew or tourists', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
    });
    state.hubs.push(hub);
    expect(getHubCapacityRemaining(state, hub)).toBe(4);
  });

  it('subtracts crew count from capacity', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
    });
    state.hubs.push(hub);
    // Add 2 active crew stationed at this hub
    state.crew.push(
      makeCrewMember({ id: 'c1', stationedHubId: hub.id, status: AstronautStatus.ACTIVE, transitUntil: null }),
      makeCrewMember({ id: 'c2', stationedHubId: hub.id, status: AstronautStatus.ACTIVE, transitUntil: null }),
    );
    expect(getHubCapacityRemaining(state, hub)).toBe(2);
  });

  it('subtracts tourist count from capacity', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [makeTourist(), makeTourist()],
    });
    state.hubs.push(hub);
    expect(getHubCapacityRemaining(state, hub)).toBe(2);
  });

  it('returns 0 when at full capacity (crew + tourists fill it)', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [makeTourist(), makeTourist()],
    });
    state.hubs.push(hub);
    // 2 tourists + 2 crew = 4 = tier 1 capacity
    state.crew.push(
      makeCrewMember({ id: 'c3', stationedHubId: hub.id, status: AstronautStatus.ACTIVE, transitUntil: null }),
      makeCrewMember({ id: 'c4', stationedHubId: hub.id, status: AstronautStatus.ACTIVE, transitUntil: null }),
    );
    expect(getHubCapacityRemaining(state, hub)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// addTourist
// ---------------------------------------------------------------------------

describe('addTourist', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState();
  });

  it('adds tourist when capacity available, returns true', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
    });
    state.hubs.push(hub);
    const tourist = makeTourist();
    const result = addTourist(state, hub, tourist);
    expect(result).toBe(true);
  });

  it('returns false when hub is at capacity', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [makeTourist(), makeTourist(), makeTourist(), makeTourist()],
    });
    state.hubs.push(hub);
    const result = addTourist(state, hub, makeTourist());
    expect(result).toBe(false);
  });

  it('actually pushes tourist to hub.tourists array', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
    });
    state.hubs.push(hub);
    const tourist = makeTourist({ name: 'Space Fan' });
    addTourist(state, hub, tourist);
    expect(hub.tourists).toHaveLength(1);
    expect(hub.tourists[0].name).toBe('Space Fan');
  });
});

// ---------------------------------------------------------------------------
// processTouristRevenue
// ---------------------------------------------------------------------------

describe('processTouristRevenue', () => {
  let state: GameState;

  beforeEach(() => {
    state = createGameState();
  });

  it('credits revenue for each tourist per period @smoke', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [makeTourist({ revenue: 3_000 }), makeTourist({ revenue: 7_000 })],
    });
    state.hubs = [state.hubs[0], hub];
    const moneyBefore = state.money;
    processTouristRevenue(state);
    expect(state.money).toBe(moneyBefore + 3_000 + 7_000);
  });

  it('removes tourists whose departurePeriod <= currentPeriod', () => {
    state.currentPeriod = 5;
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [
        makeTourist({ departurePeriod: 3 }),  // should be removed
        makeTourist({ departurePeriod: 5 }),  // should be removed (<=)
      ],
    });
    state.hubs = [state.hubs[0], hub];
    processTouristRevenue(state);
    expect(hub.tourists).toHaveLength(0);
  });

  it('does not remove tourists whose departurePeriod > currentPeriod', () => {
    state.currentPeriod = 5;
    const stayingTourist = makeTourist({ departurePeriod: 10 });
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [stayingTourist],
    });
    state.hubs = [state.hubs[0], hub];
    processTouristRevenue(state);
    expect(hub.tourists).toHaveLength(1);
    expect(hub.tourists[0].id).toBe(stayingTourist.id);
  });

  it('handles multiple hubs', () => {
    const hub1 = makeHub({
      id: 'hub-a',
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [makeTourist({ revenue: 1_000 })],
    });
    const hub2 = makeHub({
      id: 'hub-b',
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 2 } },
      tourists: [makeTourist({ revenue: 2_000 }), makeTourist({ revenue: 3_000 })],
    });
    state.hubs = [state.hubs[0], hub1, hub2];
    const moneyBefore = state.money;
    processTouristRevenue(state);
    expect(state.money).toBe(moneyBefore + 1_000 + 2_000 + 3_000);
  });

  it('handles tourist with zero revenue without error', () => {
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [makeTourist({ revenue: 0, departurePeriod: 10 })],
    });
    state.hubs = [state.hubs[0], hub];
    const moneyBefore = state.money;
    processTouristRevenue(state);
    expect(state.money).toBe(moneyBefore); // $0 added
    expect(hub.tourists).toHaveLength(1); // still present
  });

  it('credits revenue and removes tourist when departurePeriod equals currentPeriod', () => {
    state.currentPeriod = 5;
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [makeTourist({ revenue: 2_000, departurePeriod: 5 })],
    });
    state.hubs = [state.hubs[0], hub];
    const moneyBefore = state.money;
    processTouristRevenue(state);
    expect(state.money).toBe(moneyBefore + 2_000); // revenue credited
    expect(hub.tourists).toHaveLength(0); // tourist removed
  });

  it('credits revenue for all tourists departing in the same period before removing them', () => {
    state.currentPeriod = 5;
    const hub = makeHub({
      facilities: { [FacilityId.CREW_HAB]: { built: true, tier: 1 } },
      tourists: [
        makeTourist({ revenue: 1_000, departurePeriod: 5 }),
        makeTourist({ revenue: 3_000, departurePeriod: 5 }),
        makeTourist({ revenue: 2_000, departurePeriod: 5 }),
      ],
    });
    state.hubs = [state.hubs[0], hub];
    const moneyBefore = state.money;
    processTouristRevenue(state);
    expect(state.money).toBe(moneyBefore + 1_000 + 3_000 + 2_000); // all revenue credited
    expect(hub.tourists).toHaveLength(0); // all removed
  });
});

// ---------------------------------------------------------------------------
// evictTourists
// ---------------------------------------------------------------------------

describe('evictTourists', () => {
  it('clears all tourists from hub', () => {
    const hub = makeHub({
      tourists: [makeTourist(), makeTourist(), makeTourist()],
    });
    expect(hub.tourists).toHaveLength(3);
    evictTourists(hub);
    expect(hub.tourists).toHaveLength(0);
  });

  it('works on already-empty tourists array', () => {
    const hub = makeHub({ tourists: [] });
    evictTourists(hub);
    expect(hub.tourists).toHaveLength(0);
  });
});

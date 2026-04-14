import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import { FacilityId, EARTH_HUB_ID } from '../core/constants.ts';
import {
  createHub,
  calculateHubMaintenance,
  processHubMaintenance,
  reactivateHub,
} from '../core/hubs.ts';
import { OFFWORLD_FACILITY_UPKEEP } from '../data/hubFacilities.ts';
import { makeCrewMember } from './_factories.ts';

describe('calculateHubMaintenance', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('returns 0 for Earth hub', () => {
    const earth = state.hubs[0];
    expect(calculateHubMaintenance(earth)).toBe(0);
  });

  it('returns 0 for offline hub', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    // hub starts offline
    expect(hub.online).toBe(false);
    expect(calculateHubMaintenance(hub)).toBe(0);
  });

  it('sums facility upkeep scaled by tier', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.online = true;
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    hub.facilities[FacilityId.VAB] = { built: true, tier: 2 };

    const expected =
      OFFWORLD_FACILITY_UPKEEP[FacilityId.CREW_HAB] * 1 +
      OFFWORLD_FACILITY_UPKEEP[FacilityId.VAB] * 2;
    expect(calculateHubMaintenance(hub)).toBe(expected);
  });

  it('skips unbuilt facilities', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.online = true;
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    hub.facilities[FacilityId.VAB] = { built: false, tier: 0 };

    expect(calculateHubMaintenance(hub)).toBe(OFFWORLD_FACILITY_UPKEEP[FacilityId.CREW_HAB] * 1);
  });
});

describe('processHubMaintenance', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('deducts maintenance cost for online hubs', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.online = true;
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };

    const initialMoney = state.money;
    processHubMaintenance(state);

    const expectedCost = OFFWORLD_FACILITY_UPKEEP[FacilityId.CREW_HAB] * 1;
    expect(state.money).toBe(initialMoney - expectedCost);
  });

  it('takes hub offline when money insufficient @smoke', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.online = true;
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    state.money = 0;

    processHubMaintenance(state);

    expect(hub.online).toBe(false);
  });

  it('evacuates crew to Earth when hub goes offline', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.online = true;
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };

    const crew = makeCrewMember({ id: 'crew-1', stationedHubId: hub.id });
    state.crew.push(crew);
    state.money = 0;

    processHubMaintenance(state);

    expect(crew.stationedHubId).toBe(EARTH_HUB_ID);
  });

  it('evicts tourists when hub goes offline', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.online = true;
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    hub.tourists = [{ id: 't1', name: 'Tourist', arrivalPeriod: 0, departurePeriod: 5, revenue: 1000 }];
    state.money = 0;

    processHubMaintenance(state);

    expect(hub.tourists).toEqual([]);
  });

  it('does not affect Earth hub', () => {
    const initialMoney = state.money;
    processHubMaintenance(state);
    expect(state.money).toBe(initialMoney);
  });
});

describe('reactivateHub', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('brings offline hub back online', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    // hub starts offline

    const result = reactivateHub(state, hub.id);
    expect(result).toBe(true);
    expect(hub.online).toBe(true);
  });

  it('deducts one period maintenance cost', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    const initialMoney = state.money;

    reactivateHub(state, hub.id);

    const expectedCost = OFFWORLD_FACILITY_UPKEEP[FacilityId.CREW_HAB] * 1;
    expect(state.money).toBe(initialMoney - expectedCost);
  });

  it('returns false if already online', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.online = true;
    expect(reactivateHub(state, hub.id)).toBe(false);
  });

  it('returns false if insufficient funds', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.facilities[FacilityId.CREW_HAB] = { built: true, tier: 1 };
    state.money = 0;

    expect(reactivateHub(state, hub.id)).toBe(false);
    expect(hub.online).toBe(false);
  });

  it('returns false for non-existent hub', () => {
    expect(reactivateHub(state, 'no-such-hub')).toBe(false);
  });
});

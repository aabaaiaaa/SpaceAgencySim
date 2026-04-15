import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, createCrewMember } from '../core/gameState.ts';
import type { GameState, CrewMember } from '../core/gameState.ts';
import { EARTH_HUB_ID, HIRE_COST, AstronautStatus, ResourceType } from '../core/constants.ts';
import { createHub } from '../core/hubs.ts';
import {
  getCrewAtHub,
  hireCrewAtHub,
  requestCrewTransfer,
  getTransferCost,
  processCrewTransits,
  getTransitDelay,
} from '../core/hubCrew.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a Moon surface hub on the given state and brings it online. */
function createMoonHub(state: GameState): ReturnType<typeof createHub> {
  const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
  hub.online = true;
  return hub;
}

/** Creates a Mars surface hub on the given state and brings it online. */
function createMarsHub(state: GameState): ReturnType<typeof createHub> {
  const hub = createHub(state, { name: 'Mars Outpost', type: 'surface', bodyId: 'MARS' });
  hub.online = true;
  return hub;
}

/** Adds a test crew member to state and returns it. */
let _crewTestSeq = 0;
function addCrew(state: GameState, overrides: Partial<CrewMember> = {}): CrewMember {
  const c = createCrewMember({
    id: overrides.id ?? `crew-test-${++_crewTestSeq}`,
    name: overrides.name ?? 'Test Astronaut',
    salary: overrides.salary ?? 2_000,
    hireDate: '2026-01-01T00:00:00.000Z',
  });
  Object.assign(c, overrides);
  state.crew.push(c);
  return c;
}

// ---------------------------------------------------------------------------
// getCrewAtHub
// ---------------------------------------------------------------------------

describe('getCrewAtHub', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('returns active crew stationed at the given hub', () => {
    const c1 = addCrew(state, { stationedHubId: EARTH_HUB_ID });
    const c2 = addCrew(state, { stationedHubId: EARTH_HUB_ID });
    const result = getCrewAtHub(state, EARTH_HUB_ID);
    expect(result).toHaveLength(2);
    expect(result.map(c => c.id)).toContain(c1.id);
    expect(result.map(c => c.id)).toContain(c2.id);
  });

  it('excludes crew stationed at a different hub', () => {
    const moonHub = createMoonHub(state);
    addCrew(state, { stationedHubId: EARTH_HUB_ID });
    addCrew(state, { stationedHubId: moonHub.id });
    const result = getCrewAtHub(state, EARTH_HUB_ID);
    expect(result).toHaveLength(1);
  });

  it('excludes crew in transit (transitUntil > currentPeriod)', () => {
    state.currentPeriod = 5;
    addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: 8 });
    addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: null });
    const result = getCrewAtHub(state, EARTH_HUB_ID);
    expect(result).toHaveLength(1);
  });

  it('includes crew whose transit has completed (transitUntil <= currentPeriod)', () => {
    state.currentPeriod = 10;
    addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: 10 });
    addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: 5 });
    const result = getCrewAtHub(state, EARTH_HUB_ID);
    expect(result).toHaveLength(2);
  });

  it('excludes non-active crew (fired, kia)', () => {
    addCrew(state, { stationedHubId: EARTH_HUB_ID, status: AstronautStatus.FIRED });
    addCrew(state, { stationedHubId: EARTH_HUB_ID, status: AstronautStatus.KIA });
    addCrew(state, { stationedHubId: EARTH_HUB_ID, status: AstronautStatus.ACTIVE });
    const result = getCrewAtHub(state, EARTH_HUB_ID);
    expect(result).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// hireCrewAtHub
// ---------------------------------------------------------------------------

describe('hireCrewAtHub', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('Earth hiring — no tax, no delay @smoke', () => {
    const startMoney = state.money;
    const member = hireCrewAtHub(state, EARTH_HUB_ID, { name: 'Alice' });
    expect(member).not.toBeNull();
    expect(member!.stationedHubId).toBe(EARTH_HUB_ID);
    expect(member!.transitUntil).toBeNull();
    expect(member!.status).toBe(AstronautStatus.ACTIVE);
    // Earth import tax = 1.0, so cost = HIRE_COST * 1.0
    expect(state.money).toBe(startMoney - HIRE_COST * 1.0);
    expect(state.crew).toContain(member);
  });

  it('off-world hiring (Moon) — applies import tax and transit delay', () => {
    const moonHub = createMoonHub(state);
    const startMoney = state.money;
    const member = hireCrewAtHub(state, moonHub.id, { name: 'Bob' });
    expect(member).not.toBeNull();
    expect(member!.stationedHubId).toBe(moonHub.id);
    // Moon import tax = 1.2
    expect(state.money).toBe(startMoney - HIRE_COST * 1.2);
    // Moon transit delay = 1
    expect(member!.transitUntil).toBe(state.currentPeriod + 1);
  });

  it('off-world hiring (Mars) — applies correct tax and delay', () => {
    const marsHub = createMarsHub(state);
    const startMoney = state.money;
    const member = hireCrewAtHub(state, marsHub.id, { name: 'Carol' });
    expect(member).not.toBeNull();
    // Mars import tax = 1.5
    expect(state.money).toBe(startMoney - HIRE_COST * 1.5);
    // Mars transit delay = 3
    expect(member!.transitUntil).toBe(state.currentPeriod + 3);
  });

  it('returns null when hub not found', () => {
    const member = hireCrewAtHub(state, 'nonexistent-hub', { name: 'Nobody' });
    expect(member).toBeNull();
  });

  it('returns null when insufficient funds', () => {
    state.money = 0;
    const member = hireCrewAtHub(state, EARTH_HUB_ID, { name: 'Broke' });
    expect(member).toBeNull();
    expect(state.crew).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getTransferCost
// ---------------------------------------------------------------------------

describe('getTransferCost', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('returns 0 for same hub', () => {
    const cost = getTransferCost(state, EARTH_HUB_ID, EARTH_HUB_ID);
    expect(cost).toBe(0);
  });

  it('returns 10,000 for same-body transfer', () => {
    // Create two hubs on the Moon
    const hub1 = createHub(state, { name: 'Moon Alpha', type: 'surface', bodyId: 'MOON' });
    const hub2 = createHub(state, { name: 'Moon Beta', type: 'surface', bodyId: 'MOON' });
    const cost = getTransferCost(state, hub1.id, hub2.id);
    expect(cost).toBe(10_000);
  });

  it('returns 0 when an active route connects the bodies', () => {
    const moonHub = createMoonHub(state);
    // Inject a route connecting Earth and Moon
    state.routes.push({
      id: 'route-test',
      name: 'Earth-Moon Route',
      status: 'active',
      resourceType: ResourceType.WATER_ICE,
      legs: [{
        id: 'leg-1',
        origin: { bodyId: 'EARTH', locationType: 'orbit', hubId: null },
        destination: { bodyId: 'MOON', locationType: 'orbit', hubId: null },
        craftDesignId: 'design-1',
        craftCount: 1,
        cargoCapacityKg: 1000,
        costPerRun: 5000,
        provenFlightId: 'flight-1',
      }],
      throughputPerPeriod: 1000,
      totalCostPerPeriod: 5000,
    });
    const cost = getTransferCost(state, EARTH_HUB_ID, moonHub.id);
    expect(cost).toBe(0);
  });

  it('returns distance-based cost when no route connects bodies', () => {
    const marsHub = createMarsHub(state);
    // Mars import tax = 1.5
    const cost = getTransferCost(state, EARTH_HUB_ID, marsHub.id);
    expect(cost).toBe(50_000 * 1.5);
  });

  it('ignores paused routes when checking connections', () => {
    const moonHub = createMoonHub(state);
    state.routes.push({
      id: 'route-paused',
      name: 'Paused Route',
      status: 'paused',
      resourceType: ResourceType.WATER_ICE,
      legs: [{
        id: 'leg-p',
        origin: { bodyId: 'EARTH', locationType: 'orbit', hubId: null },
        destination: { bodyId: 'MOON', locationType: 'orbit', hubId: null },
        craftDesignId: 'design-1',
        craftCount: 1,
        cargoCapacityKg: 1000,
        costPerRun: 5000,
        provenFlightId: 'flight-1',
      }],
      throughputPerPeriod: 1000,
      totalCostPerPeriod: 5000,
    });
    // Moon import tax = 1.2
    const cost = getTransferCost(state, EARTH_HUB_ID, moonHub.id);
    expect(cost).toBe(50_000 * 1.2);
  });
});

// ---------------------------------------------------------------------------
// requestCrewTransfer
// ---------------------------------------------------------------------------

describe('requestCrewTransfer', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('moves crew to new hub with transit delay @smoke', () => {
    const moonHub = createMoonHub(state);
    const crew = addCrew(state, { stationedHubId: EARTH_HUB_ID });
    const startMoney = state.money;

    const result = requestCrewTransfer(state, crew.id, moonHub.id);
    expect(result).toBe(true);
    expect(crew.stationedHubId).toBe(moonHub.id);
    // Moon transit delay = 1
    expect(crew.transitUntil).toBe(state.currentPeriod + 1);
    // Should have spent transfer cost (no route, Moon tax 1.2)
    expect(state.money).toBe(startMoney - 50_000 * 1.2);
  });

  it('same-body transfer has low cost', () => {
    const hub1 = createHub(state, { name: 'Moon A', type: 'surface', bodyId: 'MOON' });
    hub1.online = true;
    const hub2 = createHub(state, { name: 'Moon B', type: 'surface', bodyId: 'MOON' });
    hub2.online = true;
    const crew = addCrew(state, { stationedHubId: hub1.id });
    const startMoney = state.money;

    const result = requestCrewTransfer(state, crew.id, hub2.id);
    expect(result).toBe(true);
    expect(crew.stationedHubId).toBe(hub2.id);
    expect(state.money).toBe(startMoney - 10_000);
  });

  it('transfer to Earth is instant (no transit delay)', () => {
    const moonHub = createMoonHub(state);
    const crew = addCrew(state, { stationedHubId: moonHub.id });

    const result = requestCrewTransfer(state, crew.id, EARTH_HUB_ID);
    expect(result).toBe(true);
    expect(crew.stationedHubId).toBe(EARTH_HUB_ID);
    expect(crew.transitUntil).toBeNull();
  });

  it('returns false when crew not found', () => {
    const moonHub = createMoonHub(state);
    const result = requestCrewTransfer(state, 'nonexistent-id', moonHub.id);
    expect(result).toBe(false);
  });

  it('returns false when crew is not active', () => {
    const moonHub = createMoonHub(state);
    const crew = addCrew(state, {
      stationedHubId: EARTH_HUB_ID,
      status: AstronautStatus.FIRED,
    });
    const result = requestCrewTransfer(state, crew.id, moonHub.id);
    expect(result).toBe(false);
  });

  it('returns false when insufficient funds', () => {
    const marsHub = createMarsHub(state);
    state.money = 0;
    const crew = addCrew(state, { stationedHubId: EARTH_HUB_ID });

    const result = requestCrewTransfer(state, crew.id, marsHub.id);
    expect(result).toBe(false);
    // Crew should stay at original hub
    expect(crew.stationedHubId).toBe(EARTH_HUB_ID);
  });

  it('free transfer when route connects the bodies', () => {
    const moonHub = createMoonHub(state);
    // Inject active route
    state.routes.push({
      id: 'route-em',
      name: 'Earth-Moon',
      status: 'active',
      resourceType: ResourceType.WATER_ICE,
      legs: [{
        id: 'leg-em',
        origin: { bodyId: 'EARTH', locationType: 'orbit', hubId: null },
        destination: { bodyId: 'MOON', locationType: 'orbit', hubId: null },
        craftDesignId: 'd1',
        craftCount: 1,
        cargoCapacityKg: 500,
        costPerRun: 3000,
        provenFlightId: 'f1',
      }],
      throughputPerPeriod: 500,
      totalCostPerPeriod: 3000,
    });

    const crew = addCrew(state, { stationedHubId: EARTH_HUB_ID });
    const startMoney = state.money;
    const result = requestCrewTransfer(state, crew.id, moonHub.id);
    expect(result).toBe(true);
    // Free transfer via route
    expect(state.money).toBe(startMoney);
  });
});

// ---------------------------------------------------------------------------
// processCrewTransits
// ---------------------------------------------------------------------------

describe('processCrewTransits', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('clears transitUntil when period reached @smoke', () => {
    state.currentPeriod = 5;
    const c1 = addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: 5 });
    const c2 = addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: 3 });

    processCrewTransits(state);
    expect(c1.transitUntil).toBeNull();
    expect(c2.transitUntil).toBeNull();
  });

  it('does not clear transitUntil if period not yet reached', () => {
    state.currentPeriod = 5;
    const c = addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: 8 });

    processCrewTransits(state);
    expect(c.transitUntil).toBe(8);
  });

  it('handles mix of complete and incomplete transits', () => {
    state.currentPeriod = 10;
    const c1 = addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: 10 });
    const c2 = addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: 12 });
    const c3 = addCrew(state, { stationedHubId: EARTH_HUB_ID, transitUntil: null });

    processCrewTransits(state);
    expect(c1.transitUntil).toBeNull();
    expect(c2.transitUntil).toBe(12);
    expect(c3.transitUntil).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getTransitDelay
// ---------------------------------------------------------------------------

describe('getTransitDelay', () => {
  it('returns correct delay for known bodies', () => {
    expect(getTransitDelay('EARTH')).toBe(0);
    expect(getTransitDelay('MOON')).toBe(1);
    expect(getTransitDelay('MARS')).toBe(3);
    expect(getTransitDelay('CERES')).toBe(4);
    expect(getTransitDelay('JUPITER')).toBe(6);
    expect(getTransitDelay('SATURN')).toBe(8);
    expect(getTransitDelay('TITAN')).toBe(8);
  });

  it('returns default delay for unknown body', () => {
    expect(getTransitDelay('PLUTO')).toBe(5);
    expect(getTransitDelay('UNKNOWN')).toBe(5);
  });
});

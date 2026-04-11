import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import {
  EARTH_HUB_ID,
  FACILITY_DEFINITIONS,
  FacilityId,
} from '../core/constants.ts';
import {
  getActiveHub,
  getHub,
  setActiveHub,
  getHubsOnBody,
  createHub,
  getEnvironmentCategory,
  getEnvironmentCostMultiplier,
  getImportTaxMultiplier,
} from '../core/hubs.ts';
import {
  hasFacility,
  getFacilityTier,
  buildFacility,
  upgradeFacility,
} from '../core/construction.ts';
import {
  EnvironmentCategory,
  ENVIRONMENT_COST_MULTIPLIER,
  DEFAULT_IMPORT_TAX,
  OFFWORLD_FACILITY_COSTS,
} from '../data/hubFacilities.ts';

// ---------------------------------------------------------------------------
// GameState hub initialization
// ---------------------------------------------------------------------------

describe('GameState hub fields', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('initialises hubs array with one Earth hub', () => {
    expect(state.hubs).toBeInstanceOf(Array);
    expect(state.hubs).toHaveLength(1);
    expect(state.hubs[0].id).toBe(EARTH_HUB_ID);
  });

  it('sets activeHubId to EARTH_HUB_ID', () => {
    expect(state.activeHubId).toBe(EARTH_HUB_ID);
  });

  it('Earth hub has correct base properties', () => {
    const earth = state.hubs[0];
    expect(earth.name).toBe('Earth HQ');
    expect(earth.type).toBe('surface');
    expect(earth.bodyId).toBe('EARTH');
    expect(earth.online).toBe(true);
    expect(earth.maintenanceCost).toBe(0);
    expect(earth.established).toBe(0);
    expect(earth.tourists).toEqual([]);
    expect(earth.partInventory).toEqual([]);
    expect(earth.constructionQueue).toEqual([]);
  });

  it('Earth hub facilities match starter facilities', () => {
    const earth = state.hubs[0];
    const starterIds = FACILITY_DEFINITIONS
      .filter((f) => f.starter)
      .map((f) => f.id);

    // Every starter facility should be present and built at tier 1
    for (const id of starterIds) {
      expect(earth.facilities[id]).toBeDefined();
      expect(earth.facilities[id].built).toBe(true);
      expect(earth.facilities[id].tier).toBe(1);
    }

    // No extra facilities beyond the starters
    expect(Object.keys(earth.facilities)).toHaveLength(starterIds.length);
  });

  it('Earth hub facilities match top-level state.facilities', () => {
    const earth = state.hubs[0];
    expect(earth.facilities).toEqual(state.facilities);
  });
});

// ---------------------------------------------------------------------------
// Hub CRUD operations
// ---------------------------------------------------------------------------

describe('Hub CRUD — getActiveHub / getHub / setActiveHub', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('getActiveHub returns the Earth hub by default', () => {
    const hub = getActiveHub(state);
    expect(hub.id).toBe(EARTH_HUB_ID);
    expect(hub.name).toBe('Earth HQ');
  });

  it('getHub returns undefined for non-existent ID', () => {
    expect(getHub(state, 'nonexistent-hub')).toBeUndefined();
  });

  it('setActiveHub changes activeHubId', () => {
    // Create a second hub to switch to
    const newHub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    setActiveHub(state, newHub.id);
    expect(state.activeHubId).toBe(newHub.id);
    expect(getActiveHub(state).id).toBe(newHub.id);
  });

  it('setActiveHub throws for non-existent hub', () => {
    expect(() => setActiveHub(state, 'no-such-hub')).toThrow('hub not found');
  });

  it('getActiveHub throws when activeHubId is invalid', () => {
    state.activeHubId = 'bogus-id';
    expect(() => getActiveHub(state)).toThrow('Active hub not found');
  });
});

describe('Hub CRUD — getHubsOnBody', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('returns empty array for body with no hubs', () => {
    expect(getHubsOnBody(state, 'MARS')).toEqual([]);
  });

  it('returns hubs matching the body', () => {
    const earthHubs = getHubsOnBody(state, 'EARTH');
    expect(earthHubs).toHaveLength(1);
    expect(earthHubs[0].id).toBe(EARTH_HUB_ID);
  });

  it('returns multiple hubs on same body', () => {
    createHub(state, { name: 'Moon Alpha', type: 'surface', bodyId: 'MOON' });
    createHub(state, { name: 'Moon Beta', type: 'surface', bodyId: 'MOON' });
    const moonHubs = getHubsOnBody(state, 'MOON');
    expect(moonHubs).toHaveLength(2);
    expect(moonHubs.map(h => h.name)).toContain('Moon Alpha');
    expect(moonHubs.map(h => h.name)).toContain('Moon Beta');
  });
});

describe('Hub CRUD — createHub', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('creates a surface hub on Moon', () => {
    const hub = createHub(state, { name: 'Lunar Base', type: 'surface', bodyId: 'MOON' });
    expect(hub.name).toBe('Lunar Base');
    expect(hub.type).toBe('surface');
    expect(hub.bodyId).toBe('MOON');
    expect(hub.id).toMatch(/^hub-\d+-[a-z0-9]+$/);
  });

  it('creates an orbital hub with altitude', () => {
    const hub = createHub(state, {
      name: 'Mars Station',
      type: 'orbital',
      bodyId: 'MARS',
      altitude: 250_000,
    });
    expect(hub.type).toBe('orbital');
    expect(hub.altitude).toBe(250_000);
  });

  it('new hub is offline', () => {
    const hub = createHub(state, { name: 'Test Hub', type: 'surface', bodyId: 'MOON' });
    expect(hub.online).toBe(false);
  });

  it('new hub has Crew Hab construction project in queue', () => {
    const hub = createHub(state, { name: 'Test Hub', type: 'surface', bodyId: 'MOON' });
    expect(hub.constructionQueue).toHaveLength(1);
    expect(hub.constructionQueue[0].facilityId).toBe(FacilityId.CREW_HAB);
  });

  it('construction project has environment-scaled resource costs', () => {
    const hub = createHub(state, { name: 'Titan Outpost', type: 'surface', bodyId: 'TITAN' });
    const project = hub.constructionQueue[0];
    const crewHabCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.CREW_HAB)!;
    const titanMultiplier = ENVIRONMENT_COST_MULTIPLIER[EnvironmentCategory.HOSTILE_ATMOSPHERIC];

    // Each resource amount should be scaled by the Titan environment multiplier
    for (const req of project.resourcesRequired) {
      const baseCost = crewHabCost.resources.find(r => r.resourceId === req.resourceId)!;
      expect(req.amount).toBe(baseCost.amount * titanMultiplier);
    }

    // Delivered amounts should all be zero
    for (const del of project.resourcesDelivered) {
      expect(del.amount).toBe(0);
    }

    // Money cost is not scaled by environment
    expect(project.moneyCost).toBe(crewHabCost.moneyCost);
  });

  it('hub is added to state.hubs', () => {
    const initialCount = state.hubs.length;
    createHub(state, { name: 'New Base', type: 'surface', bodyId: 'MARS' });
    expect(state.hubs).toHaveLength(initialCount + 1);
  });
});

// ---------------------------------------------------------------------------
// Environment & tax helpers
// ---------------------------------------------------------------------------

describe('Environment & tax helpers', () => {
  it('getEnvironmentCategory returns correct category for Moon (AIRLESS_LOW_GRAVITY)', () => {
    expect(getEnvironmentCategory('MOON')).toBe(EnvironmentCategory.AIRLESS_LOW_GRAVITY);
  });

  it('getEnvironmentCategory returns correct category for Mars (ATMOSPHERIC_SURFACE)', () => {
    expect(getEnvironmentCategory('MARS')).toBe(EnvironmentCategory.ATMOSPHERIC_SURFACE);
  });

  it('getEnvironmentCategory returns undefined for Earth', () => {
    expect(getEnvironmentCategory('EARTH')).toBeUndefined();
  });

  it('getEnvironmentCostMultiplier returns 1.0 for Earth (no category)', () => {
    expect(getEnvironmentCostMultiplier('EARTH')).toBe(1.0);
  });

  it('getEnvironmentCostMultiplier returns correct multiplier for Moon (1.0 for AIRLESS_LOW_GRAVITY)', () => {
    expect(getEnvironmentCostMultiplier('MOON')).toBe(
      ENVIRONMENT_COST_MULTIPLIER[EnvironmentCategory.AIRLESS_LOW_GRAVITY],
    );
  });

  it('getEnvironmentCostMultiplier returns correct multiplier for Titan (1.8 for HOSTILE_ATMOSPHERIC)', () => {
    expect(getEnvironmentCostMultiplier('TITAN')).toBe(
      ENVIRONMENT_COST_MULTIPLIER[EnvironmentCategory.HOSTILE_ATMOSPHERIC],
    );
  });

  it('getImportTaxMultiplier returns 1.0 for Earth', () => {
    expect(getImportTaxMultiplier('EARTH')).toBe(1.0);
  });

  it('getImportTaxMultiplier returns 1.2 for Moon', () => {
    expect(getImportTaxMultiplier('MOON')).toBe(1.2);
  });

  it('getImportTaxMultiplier returns 3.0 for Saturn', () => {
    expect(getImportTaxMultiplier('SATURN')).toBe(3.0);
  });

  it('getImportTaxMultiplier returns DEFAULT_IMPORT_TAX (2.0) for unknown body', () => {
    expect(getImportTaxMultiplier('PLUTO')).toBe(DEFAULT_IMPORT_TAX);
  });
});

// ---------------------------------------------------------------------------
// Hub-aware construction
// ---------------------------------------------------------------------------

describe('Hub-aware construction', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('hasFacility checks active hub', () => {
    // Earth hub has starter facilities
    expect(hasFacility(state, FacilityId.LAUNCH_PAD)).toBe(true);
    // Create a Moon hub with no facilities, switch to it
    const moonHub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    setActiveHub(state, moonHub.id);
    expect(hasFacility(state, FacilityId.LAUNCH_PAD)).toBe(false);
  });

  it('getFacilityTier returns active hub tier', () => {
    expect(getFacilityTier(state, FacilityId.LAUNCH_PAD)).toBe(1);
    const moonHub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    setActiveHub(state, moonHub.id);
    expect(getFacilityTier(state, FacilityId.LAUNCH_PAD)).toBe(0);
  });

  it('explicit hubId overrides active hub', () => {
    const moonHub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    // Active is Earth, but explicitly query Moon hub
    expect(hasFacility(state, FacilityId.LAUNCH_PAD, moonHub.id)).toBe(false);
    // Explicitly query Earth hub
    expect(hasFacility(state, FacilityId.LAUNCH_PAD, EARTH_HUB_ID)).toBe(true);
  });
});

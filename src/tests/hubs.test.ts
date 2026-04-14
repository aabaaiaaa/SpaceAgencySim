import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState, createFlightState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import { createPhysicsState } from '../core/physics.ts';
import {
  EARTH_HUB_ID,
  FACILITY_DEFINITIONS,
  FacilityId,
  FlightPhase,
  BODY_RADIUS,
} from '../core/constants.ts';
import type { CelestialBody } from '../core/constants.ts';
import { getSurfaceGravity } from '../data/bodies.ts';
import type { RocketAssembly } from '../core/physics.ts';
import {
  getActiveHub,
  getHub,
  setActiveHub,
  getHubsOnBody,
  createHub,
  getEnvironmentCategory,
  getEnvironmentCostMultiplier,
  getImportTaxMultiplier,
  getSurfaceHubsForRecovery,
  findNearbyOrbitalHub,
  generateHubName,
  renameHub,
} from '../core/hubs.ts';
import { HUB_NAME_POOL } from '../data/hubNames.ts';
import {
  hasFacility,
  getFacilityTier,
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

// ---------------------------------------------------------------------------
// Orbital hub launch
// ---------------------------------------------------------------------------

describe('Orbital hub undocking launch', () => {
  it('craft spawns at correct altitude with orbital velocity', () => {
    const altitude = 200_000;
    const bodyId = 'EARTH';

    const flightState = createFlightState({
      missionId: 'test-orbital',
      rocketId: 'rocket-orbital',
      launchType: 'orbital',
      bodyId: bodyId as CelestialBody,
    });
    // Set altitude as the launch flow would.
    flightState.altitude = altitude;

    // Minimal assembly with no parts — sufficient for createPhysicsState.
    const assembly: RocketAssembly = {
      parts: new Map(),
      connections: [],
      _nextId: 0,
      symmetryPairs: [],
    };

    const ps = createPhysicsState(assembly, flightState);

    // Should be at the orbital altitude.
    expect(ps.posY).toBe(altitude);

    // Should have orbital velocity (non-zero horizontal).
    expect(ps.velX).toBeGreaterThan(0);
    expect(ps.velY).toBe(0);

    // Should not be grounded or landed.
    expect(ps.landed).toBe(false);
    expect(ps.grounded).toBe(false);

    // Should be in ORBIT phase.
    expect(flightState.phase).toBe(FlightPhase.ORBIT);
    expect(flightState.inOrbit).toBe(true);

    // Verify orbital velocity is approximately correct.
    // v = sqrt(GM / r), where GM = g_surface * R^2.
    const R = BODY_RADIUS[bodyId];
    const gSurface = getSurfaceGravity(bodyId);
    const GM = gSurface * R * R;
    const r = R + altitude;
    const expectedVelocity = Math.sqrt(GM / r);

    expect(ps.velX).toBeCloseTo(expectedVelocity, 0);
    // Sanity check: Earth LEO velocity should be ~7700-7800 m/s.
    expect(ps.velX).toBeGreaterThan(7000);
    expect(ps.velX).toBeLessThan(8500);
  });
});

// ---------------------------------------------------------------------------
// Surface hub recovery
// ---------------------------------------------------------------------------

describe('Surface hub recovery — getSurfaceHubsForRecovery', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('returns online surface hubs on the specified body', () => {
    const moonHub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    moonHub.online = true;

    const result = getSurfaceHubsForRecovery(state, 'MOON');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(moonHub.id);
  });

  it('returns Earth hub for Earth body', () => {
    const result = getSurfaceHubsForRecovery(state, 'EARTH');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(EARTH_HUB_ID);
  });

  it('excludes offline hubs', () => {
    const moonHub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    moonHub.online = false;

    const result = getSurfaceHubsForRecovery(state, 'MOON');
    expect(result).toHaveLength(0);
  });

  it('excludes orbital hubs', () => {
    const orbitalHub = createHub(state, { name: 'Moon Station', type: 'orbital', bodyId: 'MOON', altitude: 100_000 });
    orbitalHub.online = true;

    const result = getSurfaceHubsForRecovery(state, 'MOON');
    expect(result).toHaveLength(0);
  });

  it('returns multiple surface hubs on the same body', () => {
    const hub1 = createHub(state, { name: 'Moon Alpha', type: 'surface', bodyId: 'MOON' });
    hub1.online = true;
    const hub2 = createHub(state, { name: 'Moon Beta', type: 'surface', bodyId: 'MOON' });
    hub2.online = true;

    const result = getSurfaceHubsForRecovery(state, 'MOON');
    expect(result).toHaveLength(2);
  });

  it('returns empty array for body with no hubs', () => {
    const result = getSurfaceHubsForRecovery(state, 'MARS');
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Orbital hub proximity detection
// ---------------------------------------------------------------------------

describe('Orbital hub proximity detection', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('finds orbital hub within range on same body', () => {
    const hub = createHub(state, { name: 'LEO Station', type: 'orbital', bodyId: 'EARTH', altitude: 200_000 });
    hub.online = true;
    const found = findNearbyOrbitalHub(state, 'EARTH', 200_500);
    expect(found).toHaveLength(1);
    expect(found[0].id).toBe(hub.id);
  });

  it('does not find orbital hub beyond range', () => {
    const hub = createHub(state, { name: 'LEO Station', type: 'orbital', bodyId: 'EARTH', altitude: 200_000 });
    hub.online = true;
    const found = findNearbyOrbitalHub(state, 'EARTH', 202_000);
    expect(found).toHaveLength(0);
  });

  it('does not find orbital hub on different body', () => {
    const hub = createHub(state, { name: 'Moon Station', type: 'orbital', bodyId: 'MOON', altitude: 100_000 });
    hub.online = true;
    const found = findNearbyOrbitalHub(state, 'EARTH', 100_000);
    expect(found).toHaveLength(0);
  });

  it('does not find offline orbital hub', () => {
    const hub = createHub(state, { name: 'Station', type: 'orbital', bodyId: 'EARTH', altitude: 200_000 });
    hub.online = false;
    const found = findNearbyOrbitalHub(state, 'EARTH', 200_500);
    expect(found).toHaveLength(0);
  });

  it('does not find surface hubs', () => {
    const hub = createHub(state, { name: 'Base', type: 'surface', bodyId: 'EARTH' });
    hub.online = true;
    const found = findNearbyOrbitalHub(state, 'EARTH', 0);
    expect(found).toHaveLength(0);
  });

  it('finds hub exactly at range boundary', () => {
    const hub = createHub(state, { name: 'Station', type: 'orbital', bodyId: 'EARTH', altitude: 200_000 });
    hub.online = true;
    // Exactly 1000m away = exactly at boundary
    const found = findNearbyOrbitalHub(state, 'EARTH', 201_000);
    expect(found).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Hub name generation
// ---------------------------------------------------------------------------

describe('generateHubName', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('generates a name with Outpost suffix for surface hubs', () => {
    const name = generateHubName(state, 'surface');
    expect(name).toMatch(/ Outpost$/);
  });

  it('generates a name with Station suffix for orbital hubs', () => {
    const name = generateHubName(state, 'orbital');
    expect(name).toMatch(/ Station$/);
  });

  it('uses a name from HUB_NAME_POOL', () => {
    const name = generateHubName(state, 'surface');
    const baseName = name.replace(/ Outpost$/, '');
    expect(HUB_NAME_POOL).toContain(baseName);
  });

  it('excludes names already used by existing hubs', () => {
    // Add hubs using specific names from the pool
    state.hubs.push({
      ...state.hubs[0],
      id: 'hub-test-1',
      name: 'Apollo Outpost',
    });

    // Generate many names and verify Apollo is never picked
    const generatedBaseNames = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const name = generateHubName(state, 'surface');
      generatedBaseNames.add(name.replace(/ Outpost$/, ''));
    }
    expect(generatedBaseNames.has('Apollo')).toBe(false);
  });

  it('excludes names regardless of suffix type', () => {
    // "Apollo Station" should prevent "Apollo" from being used for any hub type
    state.hubs.push({
      ...state.hubs[0],
      id: 'hub-test-1',
      name: 'Apollo Station',
    });

    const generatedBaseNames = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const name = generateHubName(state, 'surface');
      generatedBaseNames.add(name.replace(/ Outpost$/, ''));
    }
    expect(generatedBaseNames.has('Apollo')).toBe(false);
  });

  it('falls back to Hub-N naming when pool is exhausted', () => {
    // Fill state.hubs with every name from the pool
    for (const poolName of HUB_NAME_POOL) {
      state.hubs.push({
        ...state.hubs[0],
        id: `hub-${poolName.toLowerCase()}`,
        name: `${poolName} Outpost`,
      });
    }

    const name = generateHubName(state, 'surface');
    const expectedCount = state.hubs.length; // Earth HQ + all pool names
    expect(name).toBe(`Hub-${expectedCount} Outpost`);
  });

  it('fallback includes Station suffix for orbital hubs', () => {
    for (const poolName of HUB_NAME_POOL) {
      state.hubs.push({
        ...state.hubs[0],
        id: `hub-${poolName.toLowerCase()}`,
        name: `${poolName} Station`,
      });
    }

    const name = generateHubName(state, 'orbital');
    expect(name).toMatch(/^Hub-\d+ Station$/);
  });
});

// ---------------------------------------------------------------------------
// Hub name uniqueness — createHub
// ---------------------------------------------------------------------------

describe('Hub name uniqueness — createHub', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('rejects duplicate name on create', () => {
    createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    expect(() => createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MARS' }))
      .toThrow('Hub name already exists: Moon Base');
  });

  it('rejects duplicate name case-insensitively on create', () => {
    createHub(state, { name: 'Alpha', type: 'surface', bodyId: 'MOON' });
    expect(() => createHub(state, { name: 'ALPHA', type: 'orbital', bodyId: 'MARS' }))
      .toThrow('Hub name already exists: ALPHA');
  });

  it('rejects name matching existing Earth hub', () => {
    // Earth hub is named "Earth HQ"
    expect(() => createHub(state, { name: 'earth hq', type: 'surface', bodyId: 'MOON' }))
      .toThrow('Hub name already exists: earth hq');
  });
});

// ---------------------------------------------------------------------------
// Hub renaming — renameHub
// ---------------------------------------------------------------------------

describe('Hub renaming — renameHub', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('valid rename succeeds', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const result = renameHub(state, hub.id, 'Lunar Outpost');
    expect(result).toEqual({ success: true });
    expect(hub.name).toBe('Lunar Outpost');
  });

  it('Earth hub can be renamed', () => {
    const earthHub = state.hubs[0];
    const result = renameHub(state, earthHub.id, 'Home Base');
    expect(result).toEqual({ success: true });
    expect(earthHub.name).toBe('Home Base');
  });

  it('rejects empty name', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const result = renameHub(state, hub.id, '   ');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Hub name cannot be empty');
    expect(hub.name).toBe('Moon Base'); // unchanged
  });

  it('rejects name over 40 characters', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const longName = 'A'.repeat(41);
    const result = renameHub(state, hub.id, longName);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Hub name cannot exceed 40 characters');
    expect(hub.name).toBe('Moon Base'); // unchanged
  });

  it('rejects duplicate name on rename', () => {
    createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const hub2 = createHub(state, { name: 'Mars Base', type: 'surface', bodyId: 'MARS' });
    const result = renameHub(state, hub2.id, 'Moon Base');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Hub name already exists: Moon Base');
    expect(hub2.name).toBe('Mars Base'); // unchanged
  });

  it('rejects duplicate name case-insensitively on rename', () => {
    createHub(state, { name: 'Alpha', type: 'surface', bodyId: 'MOON' });
    const hub2 = createHub(state, { name: 'Beta', type: 'surface', bodyId: 'MARS' });
    const result = renameHub(state, hub2.id, 'ALPHA');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Hub name already exists');
  });

  it('allows renaming to the same name (own name is not a conflict)', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const result = renameHub(state, hub.id, 'Moon Base');
    expect(result).toEqual({ success: true });
  });

  it('returns error for non-existent hub ID', () => {
    const result = renameHub(state, 'nonexistent-hub', 'New Name');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Hub not found');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { createGameState } from '../core/gameState.ts';
import type { GameState } from '../core/gameState.ts';
import { FacilityId } from '../core/constants.ts';
import {
  createHub,
  deliverResources,
  isConstructionComplete,
  processConstructionProjects,
  getAvailableFacilitiesToBuild,
  startFacilityUpgrade,
  getEnvironmentCostMultiplier,
  deployOutpostCore,
} from '../core/hubs.ts';
import { OFFWORLD_FACILITY_COSTS } from '../data/hubFacilities.ts';
import { makeConstructionProject } from './_factories.ts';
import type { ResourceType } from '../core/constants.ts';

describe('deliverResources', () => {
  it('records partial delivery capped at required amount', () => {
    const project = makeConstructionProject({
      resourcesRequired: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 500 }],
      resourcesDelivered: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 0 }],
    });
    const delivered = deliverResources(project, 'IRON_ORE', 200);
    expect(delivered).toBe(200);
    expect(project.resourcesDelivered[0].amount).toBe(200);
  });

  it('caps delivery at remaining required amount', () => {
    const project = makeConstructionProject({
      resourcesRequired: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 500 }],
      resourcesDelivered: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 400 }],
    });
    const delivered = deliverResources(project, 'IRON_ORE', 200);
    expect(delivered).toBe(100); // Only 100 remaining
    expect(project.resourcesDelivered[0].amount).toBe(500);
  });

  it('returns 0 for unknown resource', () => {
    const project = makeConstructionProject({
      resourcesRequired: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 500 }],
      resourcesDelivered: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 0 }],
    });
    const delivered = deliverResources(project, 'WATER_ICE', 100);
    expect(delivered).toBe(0);
  });

  it('returns 0 when already fully delivered', () => {
    const project = makeConstructionProject({
      resourcesRequired: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 500 }],
      resourcesDelivered: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 500 }],
    });
    const delivered = deliverResources(project, 'IRON_ORE', 100);
    expect(delivered).toBe(0);
  });
});

describe('isConstructionComplete', () => {
  it('returns false when resources are not fully delivered', () => {
    const project = makeConstructionProject({
      resourcesRequired: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 500 }],
      resourcesDelivered: [{ resourceId: 'IRON_ORE' as ResourceType, amount: 300 }],
    });
    expect(isConstructionComplete(project)).toBe(false);
  });

  it('returns true when all resources are delivered', () => {
    const project = makeConstructionProject({
      resourcesRequired: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 500 },
        { resourceId: 'WATER_ICE' as ResourceType, amount: 200 },
      ],
      resourcesDelivered: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 500 },
        { resourceId: 'WATER_ICE' as ResourceType, amount: 200 },
      ],
    });
    expect(isConstructionComplete(project)).toBe(true);
  });

  it('returns true when no resources required', () => {
    const project = makeConstructionProject({
      resourcesRequired: [],
      resourcesDelivered: [],
    });
    expect(isConstructionComplete(project)).toBe(true);
  });
});

describe('processConstructionProjects', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('marks completed projects and adds facility at tier 1 @smoke', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    // Fully deliver the Crew Hab resources
    for (const req of hub.constructionQueue[0].resourcesRequired) {
      const del = hub.constructionQueue[0].resourcesDelivered.find(d => d.resourceId === req.resourceId);
      if (del) del.amount = req.amount;
    }

    processConstructionProjects(state);

    expect(hub.constructionQueue[0].completedPeriod).toBe(state.currentPeriod);
    expect(hub.facilities[FacilityId.CREW_HAB]).toBeDefined();
    expect(hub.facilities[FacilityId.CREW_HAB].built).toBe(true);
    expect(hub.facilities[FacilityId.CREW_HAB].tier).toBe(1);
  });

  it('brings hub online when Crew Hab completes', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    expect(hub.online).toBe(false);

    // Complete the Crew Hab
    for (const req of hub.constructionQueue[0].resourcesRequired) {
      const del = hub.constructionQueue[0].resourcesDelivered.find(d => d.resourceId === req.resourceId);
      if (del) del.amount = req.amount;
    }

    processConstructionProjects(state);
    expect(hub.online).toBe(true);
  });

  it('skips already-completed projects', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.constructionQueue[0].completedPeriod = 0; // Already complete

    processConstructionProjects(state);

    // Should not add facility (project was already completed, not newly completing)
    // The fact that the project has completedPeriod set means it's already been processed
    expect(hub.constructionQueue[0].completedPeriod).toBe(0); // unchanged
  });

  it('does not mark incomplete projects as complete', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    // Don't deliver any resources — project stays incomplete

    processConstructionProjects(state);

    expect(hub.constructionQueue[0].completedPeriod).toBeUndefined();
    expect(hub.facilities[FacilityId.CREW_HAB]).toBeUndefined();
    expect(hub.online).toBe(false);
  });
});

describe('getAvailableFacilitiesToBuild', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('excludes already-built facilities', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.facilities[FacilityId.VAB] = { built: true, tier: 1 };

    const available = getAvailableFacilitiesToBuild(hub);
    expect(available).not.toContain(FacilityId.VAB);
  });

  it('excludes in-progress construction', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    // Crew Hab is already in queue (from createHub)
    const available = getAvailableFacilitiesToBuild(hub);
    expect(available).not.toContain(FacilityId.CREW_HAB);
  });

  it('excludes Earth-only facilities', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const available = getAvailableFacilitiesToBuild(hub);
    expect(available).not.toContain(FacilityId.MISSION_CONTROL);
    expect(available).not.toContain(FacilityId.CREW_ADMIN);
    expect(available).not.toContain(FacilityId.TRACKING_STATION);
  });

  it('always excludes Crew Hab', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    // Remove the Crew Hab from queue to test that it's excluded by the CREW_HAB rule
    hub.constructionQueue = [];
    const available = getAvailableFacilitiesToBuild(hub);
    expect(available).not.toContain(FacilityId.CREW_HAB);
  });

  it('returns buildable surface hub facilities', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const available = getAvailableFacilitiesToBuild(hub);
    // Surface hub can build LAUNCH_PAD, VAB, LOGISTICS_CENTER (CREW_HAB excluded)
    expect(available).toContain(FacilityId.LAUNCH_PAD);
    expect(available).toContain(FacilityId.VAB);
    expect(available).toContain(FacilityId.LOGISTICS_CENTER);
  });

  it('orbital hub does not include LAUNCH_PAD', () => {
    const hub = createHub(state, { name: 'Station', type: 'orbital', bodyId: 'EARTH', altitude: 200_000 });
    const available = getAvailableFacilitiesToBuild(hub);
    expect(available).not.toContain(FacilityId.LAUNCH_PAD);
    expect(available).toContain(FacilityId.VAB);
    expect(available).toContain(FacilityId.LOGISTICS_CENTER);
  });
});

describe('startFacilityUpgrade', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('queues upgrade project with tier-scaled costs', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.facilities[FacilityId.VAB] = { built: true, tier: 1 };

    const project = startFacilityUpgrade(state, hub, FacilityId.VAB);
    expect(project).not.toBeNull();
    expect(project!.facilityId).toBe(FacilityId.VAB);

    // Tier 2 costs = 2× base, environment-multiplied
    const baseCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.VAB)!;
    const envMult = getEnvironmentCostMultiplier('MOON');
    for (const req of project!.resourcesRequired) {
      const baseRes = baseCost.resources.find(r => r.resourceId === req.resourceId)!;
      expect(req.amount).toBe(baseRes.amount * 2 * envMult);
    }
    expect(project!.moneyCost).toBe(baseCost.moneyCost * 2 * envMult);
  });

  it('returns null if facility not built', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    expect(startFacilityUpgrade(state, hub, FacilityId.VAB)).toBeNull();
  });

  it('returns null if already at max tier', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.facilities[FacilityId.VAB] = { built: true, tier: 3 };
    expect(startFacilityUpgrade(state, hub, FacilityId.VAB)).toBeNull();
  });

  it('returns null if upgrade already in progress', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.facilities[FacilityId.VAB] = { built: true, tier: 1 };
    startFacilityUpgrade(state, hub, FacilityId.VAB);
    // Second call should fail
    expect(startFacilityUpgrade(state, hub, FacilityId.VAB)).toBeNull();
  });
});

describe('createHub money cost environment scaling', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('scales Crew Hab moneyCost by Mars environment multiplier (1.3)', () => {
    const hub = createHub(state, { name: 'Mars Base', type: 'surface', bodyId: 'MARS' });
    const crewHabCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.CREW_HAB)!;
    const envMult = getEnvironmentCostMultiplier('MARS');
    expect(envMult).toBeCloseTo(1.3);
    expect(hub.constructionQueue[0].moneyCost).toBeCloseTo(crewHabCost.moneyCost * envMult);
  });

  it('scales Crew Hab moneyCost by Moon environment multiplier (1.0)', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    const crewHabCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.CREW_HAB)!;
    const envMult = getEnvironmentCostMultiplier('MOON');
    expect(envMult).toBeCloseTo(1.0);
    expect(hub.constructionQueue[0].moneyCost).toBeCloseTo(crewHabCost.moneyCost * envMult);
  });

  it('scales Crew Hab moneyCost by Titan environment multiplier (1.8)', () => {
    const hub = createHub(state, { name: 'Titan Outpost', type: 'surface', bodyId: 'TITAN' });
    const crewHabCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.CREW_HAB)!;
    const envMult = getEnvironmentCostMultiplier('TITAN');
    expect(envMult).toBeCloseTo(1.8);
    expect(hub.constructionQueue[0].moneyCost).toBeCloseTo(crewHabCost.moneyCost * envMult);
  });
});

describe('startFacilityUpgrade money cost environment scaling', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('scales upgrade moneyCost by Mars environment multiplier', () => {
    const hub = createHub(state, { name: 'Mars Base', type: 'surface', bodyId: 'MARS' });
    hub.facilities[FacilityId.VAB] = { built: true, tier: 1 };

    const project = startFacilityUpgrade(state, hub, FacilityId.VAB);
    expect(project).not.toBeNull();

    const baseCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.VAB)!;
    const envMult = getEnvironmentCostMultiplier('MARS');
    expect(project!.moneyCost).toBeCloseTo(baseCost.moneyCost * 2 * envMult);
  });
});

describe('processConstructionProjects — upgrades', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('increments tier on upgrade completion', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.facilities[FacilityId.VAB] = { built: true, tier: 1 };

    const project = startFacilityUpgrade(state, hub, FacilityId.VAB)!;
    // Fully deliver all resources
    for (const req of project.resourcesRequired) {
      const del = project.resourcesDelivered.find(d => d.resourceId === req.resourceId);
      if (del) del.amount = req.amount;
    }

    processConstructionProjects(state);
    expect(hub.facilities[FacilityId.VAB].tier).toBe(2);
  });

  it('does not overwrite tier for new builds', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    // Complete the Crew Hab construction
    for (const req of hub.constructionQueue[0].resourcesRequired) {
      const del = hub.constructionQueue[0].resourcesDelivered.find(d => d.resourceId === req.resourceId);
      if (del) del.amount = req.amount;
    }

    processConstructionProjects(state);
    expect(hub.facilities[FacilityId.CREW_HAB].tier).toBe(1);
  });
});

describe('processConstructionProjects — lifecycle edge cases', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); });

  it('zero resources required completes immediately on next process call', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    // Clear the auto-queued Crew Hab project so we control the queue
    hub.constructionQueue = [];

    const project = makeConstructionProject({
      facilityId: FacilityId.VAB,
      resourcesRequired: [],
      resourcesDelivered: [],
      moneyCost: 50_000,
      startedPeriod: 0,
    });
    hub.constructionQueue.push(project);

    processConstructionProjects(state);

    expect(project.completedPeriod).toBe(state.currentPeriod);
    expect(hub.facilities[FacilityId.VAB]).toBeDefined();
    expect(hub.facilities[FacilityId.VAB].built).toBe(true);
    expect(hub.facilities[FacilityId.VAB].tier).toBe(1);
  });

  it('all resources already delivered completes on process', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.constructionQueue = [];

    const project = makeConstructionProject({
      facilityId: FacilityId.VAB,
      resourcesRequired: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 500 },
        { resourceId: 'WATER_ICE' as ResourceType, amount: 200 },
      ],
      resourcesDelivered: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 500 },
        { resourceId: 'WATER_ICE' as ResourceType, amount: 200 },
      ],
      moneyCost: 100_000,
      startedPeriod: 0,
    });
    hub.constructionQueue.push(project);

    processConstructionProjects(state);

    expect(project.completedPeriod).toBe(state.currentPeriod);
    expect(hub.facilities[FacilityId.VAB]).toBeDefined();
    expect(hub.facilities[FacilityId.VAB].built).toBe(true);
    expect(hub.facilities[FacilityId.VAB].tier).toBe(1);
  });

  it('partial delivery does not complete, resources tracked correctly', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.constructionQueue = [];

    const project = makeConstructionProject({
      facilityId: FacilityId.VAB,
      resourcesRequired: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 500 },
        { resourceId: 'WATER_ICE' as ResourceType, amount: 200 },
      ],
      resourcesDelivered: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 0 },
        { resourceId: 'WATER_ICE' as ResourceType, amount: 0 },
      ],
      moneyCost: 100_000,
      startedPeriod: 0,
    });
    hub.constructionQueue.push(project);

    // Deliver partial amounts
    deliverResources(project, 'IRON_ORE', 300);
    deliverResources(project, 'WATER_ICE', 50);

    processConstructionProjects(state);

    expect(project.completedPeriod).toBeUndefined();
    expect(hub.facilities[FacilityId.VAB]).toBeUndefined();
    // Verify delivered amounts are tracked correctly
    expect(project.resourcesDelivered[0].amount).toBe(300);
    expect(project.resourcesDelivered[1].amount).toBe(50);
  });

  it('multiple projects in queue process in FIFO order', () => {
    const hub = createHub(state, { name: 'Moon Base', type: 'surface', bodyId: 'MOON' });
    hub.constructionQueue = [];

    // First project: VAB — fully delivered (should complete)
    const projectVab = makeConstructionProject({
      facilityId: FacilityId.VAB,
      resourcesRequired: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 500 },
      ],
      resourcesDelivered: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 500 },
      ],
      moneyCost: 100_000,
      startedPeriod: 0,
    });

    // Second project: LAUNCH_PAD — not fully delivered (should remain pending)
    const projectPad = makeConstructionProject({
      facilityId: FacilityId.LAUNCH_PAD,
      resourcesRequired: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 1000 },
      ],
      resourcesDelivered: [
        { resourceId: 'IRON_ORE' as ResourceType, amount: 200 },
      ],
      moneyCost: 200_000,
      startedPeriod: 0,
    });

    hub.constructionQueue.push(projectVab, projectPad);

    processConstructionProjects(state);

    // First project should be completed
    expect(projectVab.completedPeriod).toBe(state.currentPeriod);
    expect(hub.facilities[FacilityId.VAB]).toBeDefined();
    expect(hub.facilities[FacilityId.VAB].built).toBe(true);

    // Second project should remain pending
    expect(projectPad.completedPeriod).toBeUndefined();
    expect(hub.facilities[FacilityId.LAUNCH_PAD]).toBeUndefined();
  });
});

describe('deployOutpostCore environment scaling', () => {
  let state: GameState;
  beforeEach(() => { state = createGameState(); state.money = 10_000_000; });

  it('Mars deployment deducts 1.3x base cost', () => {
    const baseCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.CREW_HAB)!;
    const envMult = getEnvironmentCostMultiplier('MARS');
    expect(envMult).toBeCloseTo(1.3);

    const moneyBefore = state.money;
    const hub = deployOutpostCore(state, { bodyId: 'MARS', altitude: 0, inOrbit: false, landed: true }, 'Mars Test Base');

    expect(hub).not.toBeNull();
    const expectedCost = baseCost.moneyCost * envMult;
    expect(moneyBefore - state.money).toBeCloseTo(expectedCost);
  });

  it('Moon deployment deducts 1.0x base cost', () => {
    const baseCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.CREW_HAB)!;
    const envMult = getEnvironmentCostMultiplier('MOON');
    expect(envMult).toBeCloseTo(1.0);

    const moneyBefore = state.money;
    const hub = deployOutpostCore(state, { bodyId: 'MOON', altitude: 0, inOrbit: false, landed: true }, 'Moon Test Base');

    expect(hub).not.toBeNull();
    const expectedCost = baseCost.moneyCost * envMult;
    expect(moneyBefore - state.money).toBeCloseTo(expectedCost);
  });

  it('deducted amount matches the construction project recorded moneyCost', () => {
    const baseCost = OFFWORLD_FACILITY_COSTS.find(c => c.facilityId === FacilityId.CREW_HAB)!;
    const envMult = getEnvironmentCostMultiplier('MARS');

    const moneyBefore = state.money;
    const hub = deployOutpostCore(state, { bodyId: 'MARS', altitude: 0, inOrbit: false, landed: true }, 'Mars Cost Check');

    expect(hub).not.toBeNull();
    const deducted = moneyBefore - state.money;
    // The construction project on the hub is created by createHub, which also applies envMultiplier
    const projectMoneyCost = hub!.constructionQueue[0].moneyCost;
    expect(deducted).toBeCloseTo(baseCost.moneyCost * envMult);
    expect(projectMoneyCost).toBeCloseTo(baseCost.moneyCost * envMult);
  });
});

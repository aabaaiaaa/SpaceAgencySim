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
} from '../core/hubs.ts';
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

  it('marks completed projects and adds facility at tier 1', () => {
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

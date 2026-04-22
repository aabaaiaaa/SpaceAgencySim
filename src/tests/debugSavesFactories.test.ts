/**
 * Tests for debug-save factory helpers (satellites, hubs, routes, field craft,
 * wealthy late-game base).
 */

import { describe, it, expect } from 'vitest';
import {
  makeSatellite,
  makeSurfaceHub,
  makeOrbitalHub,
  makeConstructionProject,
  makeRouteLeg,
  makeRoute,
  makeFieldCraft,
  wealthyLateGameBase,
} from '../core/debugSaves/factories.ts';
import { SatelliteType, GameMode, ResourceType, FieldCraftStatus } from '../core/constants.ts';

describe('makeSatellite', () => {
  it('@smoke pairs orbital object and satellite record by shared ID', () => {
    const { orbitalObject, satelliteRecord } = makeSatellite({
      recordId: 'sat-rec-123',
      orbitalObjectId: 'sat-obj-123',
      type: SatelliteType.COMMUNICATION,
      partId: 'satellite-comm',
      bodyId: 'EARTH',
      bandId: 'LEO',
    });

    expect(satelliteRecord.orbitalObjectId).toBe(orbitalObject.id);
    expect(satelliteRecord.id).toBe('sat-rec-123');
    expect(orbitalObject.id).toBe('sat-obj-123');
    expect(orbitalObject.bodyId).toBe('EARTH');
    expect(satelliteRecord.bandId).toBe('LEO');
    expect(satelliteRecord.satelliteType).toBe(SatelliteType.COMMUNICATION);
  });

  it('defaults health to 100 and autoMaintain to true', () => {
    const { satelliteRecord } = makeSatellite({
      recordId: 'r', orbitalObjectId: 'o',
      type: SatelliteType.GPS, partId: 'satellite-gps', bodyId: 'EARTH', bandId: 'MEO',
    });
    expect(satelliteRecord.health).toBe(100);
    expect(satelliteRecord.autoMaintain).toBe(true);
  });

  it('respects health, autoMaintain, leased, deployedPeriod overrides', () => {
    const { satelliteRecord } = makeSatellite({
      recordId: 'r', orbitalObjectId: 'o',
      type: SatelliteType.WEATHER, partId: 'satellite-weather', bodyId: 'EARTH', bandId: 'LEO',
      health: 25, autoMaintain: false, leased: true, deployedPeriod: 99,
    });
    expect(satelliteRecord.health).toBe(25);
    expect(satelliteRecord.autoMaintain).toBe(false);
    expect(satelliteRecord.leased).toBe(true);
    expect(satelliteRecord.deployedPeriod).toBe(99);
  });
});

describe('makeSurfaceHub', () => {
  it('@smoke returns a surface hub with coordinates and biome', () => {
    const hub = makeSurfaceHub({
      id: 'hub-mun-001',
      name: 'Mun Base Alpha',
      bodyId: 'MUN',
      biomeId: 'highlands',
      coordinates: { x: 1000, y: 0 },
      facilities: { habitat: { built: true, tier: 1 } },
      established: 50,
    });
    expect(hub.type).toBe('surface');
    expect(hub.coordinates).toEqual({ x: 1000, y: 0 });
    expect(hub.biomeId).toBe('highlands');
    expect(hub.bodyId).toBe('MUN');
    expect(hub.online).toBe(true);
    expect(hub.facilities.habitat.built).toBe(true);
  });
});

describe('makeOrbitalHub', () => {
  it('@smoke returns an orbital hub with altitude and no coordinates', () => {
    const hub = makeOrbitalHub({
      id: 'hub-leo-001',
      name: 'Station Alpha',
      bodyId: 'EARTH',
      altitude: 400_000,
      facilities: {},
      established: 40,
    });
    expect(hub.type).toBe('orbital');
    expect(hub.altitude).toBe(400_000);
    expect(hub.coordinates).toBeUndefined();
    expect(hub.online).toBe(true);
  });
});

describe('makeConstructionProject', () => {
  it('@smoke returns a project with delivered resources matching percentComplete', () => {
    const project = makeConstructionProject({
      facilityId: 'lab',
      percentComplete: 0.5,
      moneyCost: 100_000,
      resourcesRequired: [{ resourceId: ResourceType.REGOLITH, amount: 1000 }],
      startedPeriod: 40,
    });
    expect(project.facilityId).toBe('lab');
    expect(project.moneyCost).toBe(100_000);
    expect(project.resourcesRequired[0].amount).toBe(1000);
    expect(project.resourcesDelivered[0].amount).toBe(500);
  });

  it('produces a fully-delivered project when percentComplete is 1', () => {
    const project = makeConstructionProject({
      facilityId: 'lab', percentComplete: 1, moneyCost: 0, startedPeriod: 0,
      resourcesRequired: [{ resourceId: ResourceType.WATER_ICE, amount: 200 }],
    });
    expect(project.resourcesDelivered[0].amount).toBe(200);
  });
});

describe('makeRouteLeg and makeRoute', () => {
  it('@smoke builds a route with legs referencing origin and destination', () => {
    const leg = makeRouteLeg({
      id: 'leg-1',
      origin: { bodyId: 'EARTH', locationType: 'surface', hubId: 'EARTH_HUB' },
      destination: { bodyId: 'EARTH', locationType: 'orbit', altitude: 400_000, hubId: 'hub-leo' },
      craftDesignId: 'design-tug',
      cargoKg: 5000,
      cost: 10_000,
    });
    expect(leg.origin.bodyId).toBe('EARTH');
    expect(leg.destination.locationType).toBe('orbit');
    expect(leg.cargoCapacityKg).toBe(5000);

    const route = makeRoute({
      id: 'route-1',
      name: 'Earth → LEO',
      resource: ResourceType.WATER_ICE,
      legs: [leg],
      status: 'active',
    });
    expect(route.status).toBe('active');
    expect(route.resourceType).toBe(ResourceType.WATER_ICE);
    expect(route.legs).toHaveLength(1);
    expect(route.totalCostPerPeriod).toBeGreaterThan(0);
  });
});

describe('makeFieldCraft', () => {
  it('@smoke produces an in-orbit crewed vessel with supplies', () => {
    const craft = makeFieldCraft({
      id: 'fc-1',
      name: 'Mars Orbiter',
      bodyId: 'MARS',
      status: FieldCraftStatus.IN_ORBIT,
      bandId: 'LMO',
      deployedPeriod: 70,
      crewIds: ['crew-1'],
    });
    expect(craft.bodyId).toBe('MARS');
    expect(craft.status).toBe(FieldCraftStatus.IN_ORBIT);
    expect(craft.orbitBandId).toBe('LMO');
    expect(craft.orbitalElements).not.toBeNull();
    expect(craft.crewIds).toEqual(['crew-1']);
  });

  it('landed craft has null orbital elements and band', () => {
    const craft = makeFieldCraft({
      id: 'fc-2', name: 'Mun Lander', bodyId: 'MUN',
      status: FieldCraftStatus.LANDED, deployedPeriod: 50, crewIds: [],
    });
    expect(craft.orbitalElements).toBeNull();
    expect(craft.orbitBandId).toBeNull();
  });
});

describe('wealthyLateGameBase', () => {
  it('@smoke returns a FREEPLAY game state with wealth, tech, and full facilities', () => {
    const s = wealthyLateGameBase();
    expect(s.gameMode).toBe(GameMode.FREEPLAY);
    expect(s.tutorialMode).toBe(false);
    expect(s.money).toBeGreaterThanOrEqual(5_000_000);
    expect(s.techTree.researched.length).toBeGreaterThan(10);
    expect(s.crew.length).toBeGreaterThanOrEqual(3);
    expect(s.hubs.length).toBe(1);
    expect(s.parts.length).toBeGreaterThan(20);
  });
});

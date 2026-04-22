/**
 * lateGameStages.ts — Stages A–F of the late-game "Interplanetary" debug saves.
 *
 * Builds on the wealthy freeplay base produced by `factories.ts` and
 * composes satellites, hubs, routes, field craft, and functional rocket
 * designs into progressive snapshots of advanced play states.
 *
 * Each stage is fine-grained (single-subsystem focus where possible) to
 * support isolated testing of individual features.
 */

import {
  FacilityId,
  MissionState,
  SatelliteType,
  FieldCraftStatus,
  ResourceType,
} from '../constants.ts';
import type { DebugSaveDefinition } from './definitions.ts';
import type { GameState, Mission } from '../gameState.ts';
import { makeDesign } from './designFactory.ts';
import type { DesignRole } from './designFactory.ts';
import {
  makeSatellite,
  makeSurfaceHub,
  makeOrbitalHub,
  makeConstructionProject,
  makeRouteLeg,
  makeRoute,
  makeFieldCraft,
  wealthyLateGameBase,
} from './factories.ts';

const CATEGORY = 'Late Game — Interplanetary';

// ---------------------------------------------------------------------------
// Helpers local to late-game stages
// ---------------------------------------------------------------------------

function addDesigns(
  s: GameState,
  designs: Array<{ id: string; name: string; role: DesignRole }>,
): void {
  for (const d of designs) {
    s.savedDesigns.push(makeDesign(d));
  }
}

function addSatellites(
  s: GameState,
  recs: Array<{
    recordId: string;
    orbitalObjectId: string;
    type: SatelliteType | 'GENERIC';
    partId: string;
    bodyId: string;
    bandId: string;
    name?: string;
    health?: number;
    autoMaintain?: boolean;
    leased?: boolean;
    deployedPeriod?: number;
    phaseOffset?: number;
  }>,
): void {
  for (const r of recs) {
    const { orbitalObject, satelliteRecord } = makeSatellite(r);
    s.orbitalObjects.push(orbitalObject);
    s.satelliteNetwork.satellites.push(satelliteRecord);
  }
}

function completedMission(id: string, title: string, reward: number): Mission {
  return {
    id, title, description: '', reward,
    deadline: '2099-12-31T00:00:00.000Z',
    state: MissionState.COMPLETED,
    requirements: { minDeltaV: 0, minCrewCount: 0, requiredParts: [] },
    acceptedDate: '2026-01-01T00:00:00.000Z',
    completedDate: '2026-01-02T00:00:00.000Z',
  };
}

// ---------------------------------------------------------------------------
// Stage A — interplanetary-capable
// ---------------------------------------------------------------------------

function stageA(): GameState {
  const s = wealthyLateGameBase();
  s.currentPeriod = 80;

  s.missions.completed.push(
    completedMission('mission-mars-flyby', 'First Mars Flyby', 1_000_000),
    completedMission('mission-mars-orbit', 'Mars Orbital Insertion', 1_500_000),
  );

  addDesigns(s, [
    { id: 'design-late-001', name: 'Sub-Orbital Tourist', role: 'sub-orbital-tourist' },
    { id: 'design-late-002', name: 'LEO Launcher', role: 'leo-launcher' },
    { id: 'design-late-003', name: 'Mars Injection Vehicle', role: 'mars-injection' },
  ]);

  s.fieldCraft.push(
    makeFieldCraft({
      id: 'fc-mars-transfer',
      name: 'Ares I',
      bodyId: 'MARS',
      status: FieldCraftStatus.IN_ORBIT,
      bandId: 'HMO',
      deployedPeriod: 75,
      crewIds: [],
      suppliesRemaining: 60,
      hasExtendedLifeSupport: true,
    }),
    makeFieldCraft({
      id: 'fc-mars-orbit',
      name: 'Ares II',
      bodyId: 'MARS',
      status: FieldCraftStatus.IN_ORBIT,
      bandId: 'LMO',
      deployedPeriod: 78,
      crewIds: ['crew-d-002'],
      suppliesRemaining: 45,
    }),
  );

  return s;
}

// ---------------------------------------------------------------------------
// Stage B — first-constellation
// ---------------------------------------------------------------------------

function stageB(): GameState {
  const s = stageA();
  s.currentPeriod = 85;

  addDesigns(s, [
    { id: 'design-late-004', name: 'Satellite Deployer (LEO)', role: 'satellite-deployer-leo' },
  ]);

  addSatellites(s, [
    { recordId: 'sat-rec-leo-comm-1', orbitalObjectId: 'sat-obj-leo-comm-1', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'EARTH', bandId: 'LEO', name: 'CommSat Leo-1', phaseOffset: 0 },
    { recordId: 'sat-rec-leo-comm-2', orbitalObjectId: 'sat-obj-leo-comm-2', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'EARTH', bandId: 'LEO', name: 'CommSat Leo-2', phaseOffset: 2.1 },
    { recordId: 'sat-rec-leo-comm-3', orbitalObjectId: 'sat-obj-leo-comm-3', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'EARTH', bandId: 'LEO', name: 'CommSat Leo-3', phaseOffset: 4.2 },
  ]);

  s.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 1 };

  return s;
}

// ---------------------------------------------------------------------------
// Stage C — multi-body-networks
// ---------------------------------------------------------------------------

function stageC(): GameState {
  const s = stageB();
  s.currentPeriod = 95;

  addDesigns(s, [
    { id: 'design-late-005', name: 'HEO Deployer', role: 'heo-deployer' },
  ]);

  // Earth: add 3× GPS (MEO), 3× WEATHER (LEO, 1 degraded), 1× RELAY (HEO)
  addSatellites(s, [
    { recordId: 'sat-rec-earth-gps-1', orbitalObjectId: 'sat-obj-earth-gps-1', type: SatelliteType.GPS, partId: 'satellite-gps', bodyId: 'EARTH', bandId: 'MEO', name: 'GPS-1', phaseOffset: 0 },
    { recordId: 'sat-rec-earth-gps-2', orbitalObjectId: 'sat-obj-earth-gps-2', type: SatelliteType.GPS, partId: 'satellite-gps', bodyId: 'EARTH', bandId: 'MEO', name: 'GPS-2', phaseOffset: 2.1 },
    { recordId: 'sat-rec-earth-gps-3', orbitalObjectId: 'sat-obj-earth-gps-3', type: SatelliteType.GPS, partId: 'satellite-gps', bodyId: 'EARTH', bandId: 'MEO', name: 'GPS-3', phaseOffset: 4.2 },
    { recordId: 'sat-rec-earth-wx-1',  orbitalObjectId: 'sat-obj-earth-wx-1',  type: SatelliteType.WEATHER, partId: 'satellite-weather', bodyId: 'EARTH', bandId: 'LEO', name: 'Weather-1', phaseOffset: 0.5 },
    { recordId: 'sat-rec-earth-wx-2',  orbitalObjectId: 'sat-obj-earth-wx-2',  type: SatelliteType.WEATHER, partId: 'satellite-weather', bodyId: 'EARTH', bandId: 'LEO', name: 'Weather-2', phaseOffset: 2.6 },
    { recordId: 'sat-rec-earth-wx-3',  orbitalObjectId: 'sat-obj-earth-wx-3',  type: SatelliteType.WEATHER, partId: 'satellite-weather', bodyId: 'EARTH', bandId: 'LEO', name: 'Weather-3 (degraded)', phaseOffset: 4.7, health: 25 },
    { recordId: 'sat-rec-earth-relay', orbitalObjectId: 'sat-obj-earth-relay', type: SatelliteType.RELAY,   partId: 'satellite-relay',   bodyId: 'EARTH', bandId: 'HEO', name: 'Earth RELAY' },
    // Moon: 3× COMM (LLO) + 1× RELAY (HLO)
    { recordId: 'sat-rec-moon-comm-1', orbitalObjectId: 'sat-obj-moon-comm-1', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm',  bodyId: 'MOON', bandId: 'LLO', name: 'Lunar Comm-1', phaseOffset: 0 },
    { recordId: 'sat-rec-moon-comm-2', orbitalObjectId: 'sat-obj-moon-comm-2', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm',  bodyId: 'MOON', bandId: 'LLO', name: 'Lunar Comm-2', phaseOffset: 2.1 },
    { recordId: 'sat-rec-moon-comm-3', orbitalObjectId: 'sat-obj-moon-comm-3', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm',  bodyId: 'MOON', bandId: 'LLO', name: 'Lunar Comm-3', phaseOffset: 4.2 },
    { recordId: 'sat-rec-moon-relay',  orbitalObjectId: 'sat-obj-moon-relay',  type: SatelliteType.RELAY,         partId: 'satellite-relay', bodyId: 'MOON', bandId: 'HLO', name: 'Lunar RELAY' },
  ]);

  // Mark 2 of the Stage-B Earth COMM satellites as leased to exercise the
  // leasing economy path without disrupting the constellation count.
  for (const sat of s.satelliteNetwork.satellites) {
    if (sat.id === 'sat-rec-leo-comm-1' || sat.id === 'sat-rec-leo-comm-2') {
      sat.leased = true;
    }
  }

  s.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 2 };

  return s;
}

// ---------------------------------------------------------------------------
// Stage D — first-off-world-hub
// ---------------------------------------------------------------------------

function stageD(): GameState {
  const s = stageC();
  s.currentPeriod = 110;

  addDesigns(s, [
    { id: 'design-late-006', name: 'Lunar Cargo Lander', role: 'lunar-cargo-lander' },
  ]);

  // Increment hub ID counter for dynamic hubs.
  s.nextHubId = (s.nextHubId ?? 1) + 1;

  s.hubs.push(
    makeSurfaceHub({
      id: 'hub-mun-001',
      name: 'Selene Base',
      bodyId: 'MOON',
      biomeId: 'highlands',
      coordinates: { x: 0, y: 0 },
      facilities: {
        [FacilityId.CREW_HAB]: { built: true, tier: 1 },
        [FacilityId.RD_LAB]: { built: true, tier: 1 },
      },
      established: 95,
      maintenanceCost: 25_000,
      constructionQueue: [
        makeConstructionProject({
          facilityId: 'greenhouse',
          percentComplete: 0.6,
          moneyCost: 500_000,
          resourcesRequired: [{ resourceId: ResourceType.REGOLITH, amount: 2000 }],
          startedPeriod: 105,
        }),
      ],
    }),
  );

  // A crewed lander sitting at the Mun hub location (manual resupply flow).
  s.fieldCraft.push(
    makeFieldCraft({
      id: 'fc-mun-lander',
      name: 'Selene Lander',
      bodyId: 'MOON',
      status: FieldCraftStatus.LANDED,
      deployedPeriod: 95,
      crewIds: ['crew-d-003', 'crew-d-004'],
      suppliesRemaining: 40,
    }),
  );

  return s;
}

// ---------------------------------------------------------------------------
// Stage E — multi-hub-logistics
// ---------------------------------------------------------------------------

function stageE(): GameState {
  const s = stageD();
  s.currentPeriod = 130;

  addDesigns(s, [
    { id: 'design-late-007', name: 'LEO Supply Tug',  role: 'leo-tug' },
    { id: 'design-late-008', name: 'Lunar Transfer Tug', role: 'lunar-tug' },
  ]);

  // Orbital hub at Earth LEO.
  s.nextHubId = (s.nextHubId ?? 1) + 1;
  s.hubs.push(
    makeOrbitalHub({
      id: 'hub-leo-001',
      name: 'LEO Station Alpha',
      bodyId: 'EARTH',
      altitude: 400_000,
      facilities: {
        [FacilityId.CREW_HAB]: { built: true, tier: 1 },
        [FacilityId.LOGISTICS_CENTER]: { built: true, tier: 1 },
      },
      established: 120,
      maintenanceCost: 40_000,
    }),
  );

  // Proven legs + routes.
  const legEarthToLeo = makeRouteLeg({
    id: 'route-leg-1',
    origin: { bodyId: 'EARTH', locationType: 'surface', hubId: s.hubs[0].id },
    destination: { bodyId: 'EARTH', locationType: 'orbit', altitude: 400_000, hubId: 'hub-leo-001' },
    craftDesignId: 'design-late-007',
    cargoKg: 5000, cost: 25_000,
  });
  const legLeoToMoon = makeRouteLeg({
    id: 'route-leg-2',
    origin: { bodyId: 'EARTH', locationType: 'orbit', altitude: 400_000, hubId: 'hub-leo-001' },
    destination: { bodyId: 'MOON', locationType: 'surface', hubId: 'hub-mun-001' },
    craftDesignId: 'design-late-008',
    cargoKg: 3000, cost: 60_000,
  });
  const legDirectEarthToMoon = makeRouteLeg({
    id: 'route-leg-3',
    origin: { bodyId: 'EARTH', locationType: 'surface', hubId: s.hubs[0].id },
    destination: { bodyId: 'MOON', locationType: 'surface', hubId: 'hub-mun-001' },
    craftDesignId: 'design-late-006', // lunar-cargo-lander added in Stage D
    cargoKg: 2000, cost: 80_000,
  });

  s.provenLegs.push(
    { id: 'proven-1', origin: legEarthToLeo.origin, destination: legEarthToLeo.destination, craftDesignId: legEarthToLeo.craftDesignId, cargoCapacityKg: legEarthToLeo.cargoCapacityKg, costPerRun: legEarthToLeo.costPerRun, provenFlightId: legEarthToLeo.provenFlightId, dateProven: 118 },
    { id: 'proven-2', origin: legLeoToMoon.origin, destination: legLeoToMoon.destination, craftDesignId: legLeoToMoon.craftDesignId, cargoCapacityKg: legLeoToMoon.cargoCapacityKg, costPerRun: legLeoToMoon.costPerRun, provenFlightId: legLeoToMoon.provenFlightId, dateProven: 122 },
    { id: 'proven-3', origin: legDirectEarthToMoon.origin, destination: legDirectEarthToMoon.destination, craftDesignId: legDirectEarthToMoon.craftDesignId, cargoCapacityKg: legDirectEarthToMoon.cargoCapacityKg, costPerRun: legDirectEarthToMoon.costPerRun, provenFlightId: legDirectEarthToMoon.provenFlightId, dateProven: 110 },
  );

  s.routes.push(
    makeRoute({ id: 'route-1', name: 'Earth → LEO Supply', resource: ResourceType.HYDROGEN, legs: [legEarthToLeo], status: 'active' }),
    makeRoute({ id: 'route-2', name: 'LEO → Moon Relay',  resource: ResourceType.WATER_ICE, legs: [legLeoToMoon],  status: 'active' }),
    makeRoute({ id: 'route-3', name: 'Direct Earth → Moon', resource: ResourceType.REGOLITH, legs: [legDirectEarthToMoon], status: 'paused' }),
  );

  s.hubs[0].facilities[FacilityId.SATELLITE_OPS] = { built: true, tier: 3 };

  return s;
}

// ---------------------------------------------------------------------------
// Stage F — interplanetary-empire
// ---------------------------------------------------------------------------

function stageF(): GameState {
  const s = stageE();
  s.currentPeriod = 200;
  s.money = 50_000_000;
  s.reputation = 100;

  addDesigns(s, [
    { id: 'design-late-009', name: 'Venus Orbiter',   role: 'venus-orbiter' },
    { id: 'design-late-010', name: 'Mercury Probe',   role: 'mercury-probe' },
    { id: 'design-late-011', name: 'Phobos Lander',   role: 'phobos-lander' },
    { id: 'design-late-012', name: 'Deimos Lander',   role: 'deimos-lander' },
  ]);

  // Mars: 3× COMM, 3× GPS, 1× RELAY
  addSatellites(s, [
    { recordId: 'sat-rec-mars-comm-1', orbitalObjectId: 'sat-obj-mars-comm-1', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'MARS', bandId: 'LMO', name: 'Mars Comm-1', phaseOffset: 0 },
    { recordId: 'sat-rec-mars-comm-2', orbitalObjectId: 'sat-obj-mars-comm-2', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'MARS', bandId: 'LMO', name: 'Mars Comm-2', phaseOffset: 2.1 },
    { recordId: 'sat-rec-mars-comm-3', orbitalObjectId: 'sat-obj-mars-comm-3', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'MARS', bandId: 'LMO', name: 'Mars Comm-3', phaseOffset: 4.2 },
    { recordId: 'sat-rec-mars-gps-1',  orbitalObjectId: 'sat-obj-mars-gps-1',  type: SatelliteType.GPS,           partId: 'satellite-gps',  bodyId: 'MARS', bandId: 'MMO', name: 'Mars GPS-1' },
    { recordId: 'sat-rec-mars-gps-2',  orbitalObjectId: 'sat-obj-mars-gps-2',  type: SatelliteType.GPS,           partId: 'satellite-gps',  bodyId: 'MARS', bandId: 'MMO', name: 'Mars GPS-2', phaseOffset: 2.1 },
    { recordId: 'sat-rec-mars-gps-3',  orbitalObjectId: 'sat-obj-mars-gps-3',  type: SatelliteType.GPS,           partId: 'satellite-gps',  bodyId: 'MARS', bandId: 'MMO', name: 'Mars GPS-3', phaseOffset: 4.2 },
    { recordId: 'sat-rec-mars-relay',  orbitalObjectId: 'sat-obj-mars-relay',  type: SatelliteType.RELAY,         partId: 'satellite-relay', bodyId: 'MARS', bandId: 'HMO', name: 'Mars RELAY' },
    // Venus: 3× COMM (LVO) + 1× RELAY (HVO)
    { recordId: 'sat-rec-venus-comm-1', orbitalObjectId: 'sat-obj-venus-comm-1', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'VENUS', bandId: 'LVO', name: 'Venus Comm-1' },
    { recordId: 'sat-rec-venus-comm-2', orbitalObjectId: 'sat-obj-venus-comm-2', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'VENUS', bandId: 'LVO', name: 'Venus Comm-2', phaseOffset: 2.1 },
    { recordId: 'sat-rec-venus-comm-3', orbitalObjectId: 'sat-obj-venus-comm-3', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'VENUS', bandId: 'LVO', name: 'Venus Comm-3', phaseOffset: 4.2 },
    { recordId: 'sat-rec-venus-relay',  orbitalObjectId: 'sat-obj-venus-relay',  type: SatelliteType.RELAY,         partId: 'satellite-relay', bodyId: 'VENUS', bandId: 'HVO', name: 'Venus RELAY' },
    // Mercury: 3× COMM (LMeO) + 1× RELAY (HMeO)
    { recordId: 'sat-rec-merc-comm-1', orbitalObjectId: 'sat-obj-merc-comm-1', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'MERCURY', bandId: 'LMeO', name: 'Mercury Comm-1' },
    { recordId: 'sat-rec-merc-comm-2', orbitalObjectId: 'sat-obj-merc-comm-2', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'MERCURY', bandId: 'LMeO', name: 'Mercury Comm-2', phaseOffset: 2.1 },
    { recordId: 'sat-rec-merc-comm-3', orbitalObjectId: 'sat-obj-merc-comm-3', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'MERCURY', bandId: 'LMeO', name: 'Mercury Comm-3', phaseOffset: 4.2 },
    { recordId: 'sat-rec-merc-relay',  orbitalObjectId: 'sat-obj-merc-relay',  type: SatelliteType.RELAY,         partId: 'satellite-relay', bodyId: 'MERCURY', bandId: 'HMeO', name: 'Mercury RELAY' },
    // Phobos: 1× COMM + 1× RELAY
    { recordId: 'sat-rec-phobos-comm', orbitalObjectId: 'sat-obj-phobos-comm', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'PHOBOS', bandId: 'LPO', name: 'Phobos Comm' },
    { recordId: 'sat-rec-phobos-relay', orbitalObjectId: 'sat-obj-phobos-relay', type: SatelliteType.RELAY,        partId: 'satellite-relay', bodyId: 'PHOBOS', bandId: 'HPO', name: 'Phobos RELAY' },
    // Deimos: 1× COMM + 1× RELAY
    { recordId: 'sat-rec-deimos-comm', orbitalObjectId: 'sat-obj-deimos-comm', type: SatelliteType.COMMUNICATION, partId: 'satellite-comm', bodyId: 'DEIMOS', bandId: 'LDO', name: 'Deimos Comm' },
    { recordId: 'sat-rec-deimos-relay', orbitalObjectId: 'sat-obj-deimos-relay', type: SatelliteType.RELAY,        partId: 'satellite-relay', bodyId: 'DEIMOS', bandId: 'HDO', name: 'Deimos RELAY' },
  ]);

  // Vary health across satellites so the UI shows a mix of degraded/healthy.
  s.satelliteNetwork.satellites.forEach((sat, i) => {
    if (i % 3 === 0) sat.health = 60;
    else if (i % 5 === 0) sat.health = 40;
  });

  // Orbital lunar hub + Mars surface hub in addition to Stage D/E hubs.
  s.nextHubId = (s.nextHubId ?? 1) + 2;
  s.hubs.push(
    makeOrbitalHub({
      id: 'hub-lunar-orbit-001',
      name: 'Lunar Gateway',
      bodyId: 'MOON',
      altitude: 100_000,
      facilities: {
        [FacilityId.CREW_HAB]: { built: true, tier: 1 },
        [FacilityId.LOGISTICS_CENTER]: { built: true, tier: 1 },
      },
      established: 160,
      maintenanceCost: 45_000,
    }),
    makeSurfaceHub({
      id: 'hub-mars-001',
      name: 'Olympus Base',
      bodyId: 'MARS',
      biomeId: 'volcanic',
      coordinates: { x: 2000, y: 0 },
      facilities: {
        [FacilityId.CREW_HAB]: { built: true, tier: 1 },
        [FacilityId.RD_LAB]: { built: true, tier: 1 },
      },
      established: 180,
      maintenanceCost: 50_000,
    }),
  );

  // Broken route + additional active routes.
  const legEarthToLunarOrbit = makeRouteLeg({
    id: 'route-leg-4',
    origin: { bodyId: 'EARTH', locationType: 'orbit', altitude: 400_000, hubId: 'hub-leo-001' },
    destination: { bodyId: 'MOON', locationType: 'orbit', altitude: 100_000, hubId: 'hub-lunar-orbit-001' },
    craftDesignId: 'design-late-008',
    cargoKg: 2500, cost: 70_000,
  });
  const legLunarOrbitToMars = makeRouteLeg({
    id: 'route-leg-5',
    origin: { bodyId: 'MOON', locationType: 'orbit', altitude: 100_000, hubId: 'hub-lunar-orbit-001' },
    destination: { bodyId: 'MARS', locationType: 'surface', hubId: 'hub-mars-001' },
    craftDesignId: 'design-late-003', // mars-injection
    cargoKg: 1500, cost: 150_000,
  });
  const legEarthToMars = makeRouteLeg({
    id: 'route-leg-6',
    origin: { bodyId: 'EARTH', locationType: 'surface', hubId: s.hubs[0].id },
    destination: { bodyId: 'MARS', locationType: 'surface', hubId: 'hub-mars-001' },
    craftDesignId: 'design-late-003', // mars-injection
    cargoKg: 2000, cost: 200_000,
  });
  s.provenLegs.push(
    { id: 'proven-4', origin: legEarthToLunarOrbit.origin, destination: legEarthToLunarOrbit.destination, craftDesignId: legEarthToLunarOrbit.craftDesignId, cargoCapacityKg: legEarthToLunarOrbit.cargoCapacityKg, costPerRun: legEarthToLunarOrbit.costPerRun, provenFlightId: legEarthToLunarOrbit.provenFlightId, dateProven: 165 },
    { id: 'proven-5', origin: legLunarOrbitToMars.origin, destination: legLunarOrbitToMars.destination, craftDesignId: legLunarOrbitToMars.craftDesignId, cargoCapacityKg: legLunarOrbitToMars.cargoCapacityKg, costPerRun: legLunarOrbitToMars.costPerRun, provenFlightId: legLunarOrbitToMars.provenFlightId, dateProven: 185 },
    { id: 'proven-6', origin: legEarthToMars.origin, destination: legEarthToMars.destination, craftDesignId: legEarthToMars.craftDesignId, cargoCapacityKg: legEarthToMars.cargoCapacityKg, costPerRun: legEarthToMars.costPerRun, provenFlightId: legEarthToMars.provenFlightId, dateProven: 190 },
  );
  s.routes.push(
    makeRoute({ id: 'route-4', name: 'LEO → Lunar Gateway', resource: ResourceType.HYDROGEN, legs: [legEarthToLunarOrbit], status: 'active' }),
    makeRoute({ id: 'route-5', name: 'Gateway → Mars',      resource: ResourceType.WATER_ICE, legs: [legLunarOrbitToMars],  status: 'broken' }),
    makeRoute({ id: 'route-6', name: 'Earth → Mars Cargo',  resource: ResourceType.IRON_ORE,  legs: [legEarthToMars],       status: 'active' }),
  );

  // Field craft spread across the system: orbital craft at each outer body
  // plus a landed one somewhere in addition to the Stage D Mun lander.
  s.fieldCraft.push(
    makeFieldCraft({ id: 'fc-venus-orbiter',  name: 'Aphrodite', bodyId: 'VENUS',   status: FieldCraftStatus.IN_ORBIT, bandId: 'LVO', deployedPeriod: 170, crewIds: [] }),
    makeFieldCraft({ id: 'fc-mercury-probe',  name: 'Hermes',    bodyId: 'MERCURY', status: FieldCraftStatus.IN_ORBIT, bandId: 'LMeO', deployedPeriod: 175, crewIds: [] }),
    makeFieldCraft({ id: 'fc-phobos-lander',  name: 'Stickney',  bodyId: 'PHOBOS',  status: FieldCraftStatus.LANDED,   deployedPeriod: 185, crewIds: [] }),
    makeFieldCraft({ id: 'fc-deimos-lander',  name: 'Voltaire',  bodyId: 'DEIMOS',  status: FieldCraftStatus.LANDED,   deployedPeriod: 190, crewIds: [] }),
    makeFieldCraft({ id: 'fc-mars-surface',   name: 'Olympus I', bodyId: 'MARS',    status: FieldCraftStatus.LANDED,   deployedPeriod: 180, crewIds: ['crew-d-005'] }),
  );

  return s;
}

// ---------------------------------------------------------------------------
// Exported definitions
// ---------------------------------------------------------------------------

export const LATE_GAME_STAGES: DebugSaveDefinition[] = [
  {
    id: 'interplanetary-capable',
    name: 'Stage A — Interplanetary Capable',
    description: 'Wealthy agency with Mars-capable craft parked in Mars orbit. No networks or hubs beyond Earth. Tests deep-space flight and map rendering past the Moon.',
    category: CATEGORY,
    generate: stageA,
  },
  {
    id: 'first-constellation',
    name: 'Stage B — First Constellation',
    description: '3 COMM satellites in Earth LEO (constellation bonus active). Satellite Ops Tier 1. Tests constellation math in isolation.',
    category: CATEGORY,
    generate: stageB,
  },
  {
    id: 'multi-body-networks',
    name: 'Stage C — Multi-Body Networks',
    description: 'Earth + Moon constellations, RELAY for deep-space comms, leased satellites, degraded health. Satellite Ops Tier 2.',
    category: CATEGORY,
    generate: stageC,
  },
  {
    id: 'first-off-world-hub',
    name: 'Stage D — First Off-World Hub',
    description: 'Surface hub on the Mun with mid-progress construction and stationed crew. Manual resupply (no routes yet).',
    category: CATEGORY,
    generate: stageD,
  },
  {
    id: 'multi-hub-logistics',
    name: 'Stage E — Multi-Hub Logistics',
    description: 'LEO orbital hub plus Mun surface. 3 trade routes (2 active, 1 paused). Satellite Ops Tier 3 — repositioning unlocked.',
    category: CATEGORY,
    generate: stageE,
  },
  {
    id: 'interplanetary-empire',
    name: 'Stage F — Interplanetary Empire',
    description: '5 hubs, ~34 satellites across all 7 bodies, 4 active + 1 broken routes, field craft distributed across the system. Stress-tests UI with maximum state.',
    category: CATEGORY,
    generate: stageF,
  },
];

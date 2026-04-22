/**
 * factories.ts — Helpers for constructing debug-save state fragments.
 *
 * Satellites, hubs, construction projects, routes, field craft, and a
 * wealthy late-game base state used as a starting point by Stages A–F
 * of the late-game debug saves.
 */

import { createGameState, createCrewMember } from '../gameState.ts';
import {
  FacilityId,
  GameMode,
  FieldCraftStatus,
  OrbitalObjectType,
} from '../constants.ts';
import type {
  CrewMember,
  CrewSkills,
  FacilityState,
  FieldCraft,
  GameState,
  OrbitalElements,
  OrbitalObject,
  Route,
  RouteLeg,
  RouteLocation,
  RouteStatus,
  SatelliteRecord,
} from '../gameState.ts';
import type { ConstructionProject, Hub, ResourceRequirement } from '../hubTypes.ts';
import type { SatelliteType } from '../constants.ts';
import type { ResourceType } from '../constants.ts';

// ---------------------------------------------------------------------------
// Orbital element presets by altitude band
// ---------------------------------------------------------------------------

const BODY_RADII: Record<string, number> = {
  EARTH: 6_371_000,
  MOON: 1_737_400,
  MARS: 3_389_500,
  MERCURY: 2_439_700,
  VENUS: 6_051_800,
  PHOBOS: 11_267,
  DEIMOS: 6_200,
};

/** Altitude above surface (m) for each altitude band used in the saves. */
const BAND_ALTITUDES: Record<string, number> = {
  // Earth
  LEO: 400_000, MEO: 12_000_000, HEO: 35_786_000,
  // Moon (Mun)
  LLO: 100_000, MLO: 3_000_000, HLO: 10_000_000,
  // Mars
  LMO: 300_000, MMO: 5_000_000, HMO: 20_000_000,
  // Mercury
  LMeO: 200_000, MMeO: 4_000_000, HMeO: 15_000_000,
  // Venus
  LVO: 300_000, MVO: 8_000_000, HVO: 25_000_000,
  // Phobos / Deimos
  LPO: 3_000, HPO: 20_000,
  LDO: 2_000, HDO: 15_000,
};

function orbitalElementsForBand(bodyId: string, bandId: string, offset: number = 0): OrbitalElements {
  const radius = BODY_RADII[bodyId] ?? 6_371_000;
  const altitude = BAND_ALTITUDES[bandId] ?? 400_000;
  return {
    semiMajorAxis: radius + altitude,
    eccentricity: 0.001,
    argPeriapsis: offset,
    meanAnomalyAtEpoch: offset,
    epoch: 0,
  };
}

// ---------------------------------------------------------------------------
// Satellite factory
// ---------------------------------------------------------------------------

export interface MakeSatelliteOpts {
  recordId: string;
  orbitalObjectId: string;
  type: SatelliteType | 'GENERIC';
  partId: string;
  bodyId: string;
  bandId: string;
  health?: number;
  autoMaintain?: boolean;
  leased?: boolean;
  deployedPeriod?: number;
  /** Display name for the orbital object. Defaults to `<partId> @ <bandId>`. */
  name?: string;
  /** Rotational phase offset (radians) to space satellites around the same band. */
  phaseOffset?: number;
}

export interface SatellitePair {
  orbitalObject: OrbitalObject;
  satelliteRecord: SatelliteRecord;
}

export function makeSatellite(opts: MakeSatelliteOpts): SatellitePair {
  const elements = orbitalElementsForBand(opts.bodyId, opts.bandId, opts.phaseOffset ?? 0);
  const orbitalObject: OrbitalObject = {
    id: opts.orbitalObjectId,
    bodyId: opts.bodyId,
    type: OrbitalObjectType.SATELLITE,
    name: opts.name ?? `${opts.partId} @ ${opts.bandId}`,
    elements,
  };
  const satelliteRecord: SatelliteRecord = {
    id: opts.recordId,
    orbitalObjectId: opts.orbitalObjectId,
    satelliteType: opts.type,
    partId: opts.partId,
    bodyId: opts.bodyId,
    bandId: opts.bandId,
    health: opts.health ?? 100,
    autoMaintain: opts.autoMaintain ?? true,
    deployedPeriod: opts.deployedPeriod ?? 50,
  };
  if (opts.leased) satelliteRecord.leased = true;
  return { orbitalObject, satelliteRecord };
}

// ---------------------------------------------------------------------------
// Hub factories
// ---------------------------------------------------------------------------

export interface MakeSurfaceHubOpts {
  id: string;
  name: string;
  bodyId: string;
  biomeId: string;
  coordinates: { x: number; y: number };
  facilities: Record<string, FacilityState>;
  established: number;
  maintenanceCost?: number;
  constructionQueue?: ConstructionProject[];
}

export function makeSurfaceHub(opts: MakeSurfaceHubOpts): Hub {
  return {
    id: opts.id,
    name: opts.name,
    type: 'surface',
    bodyId: opts.bodyId,
    biomeId: opts.biomeId,
    coordinates: opts.coordinates,
    facilities: opts.facilities,
    tourists: [],
    partInventory: [],
    constructionQueue: opts.constructionQueue ?? [],
    maintenanceCost: opts.maintenanceCost ?? 0,
    established: opts.established,
    online: true,
  };
}

export interface MakeOrbitalHubOpts {
  id: string;
  name: string;
  bodyId: string;
  altitude: number;
  facilities: Record<string, FacilityState>;
  established: number;
  maintenanceCost?: number;
  constructionQueue?: ConstructionProject[];
}

export function makeOrbitalHub(opts: MakeOrbitalHubOpts): Hub {
  return {
    id: opts.id,
    name: opts.name,
    type: 'orbital',
    bodyId: opts.bodyId,
    altitude: opts.altitude,
    facilities: opts.facilities,
    tourists: [],
    partInventory: [],
    constructionQueue: opts.constructionQueue ?? [],
    maintenanceCost: opts.maintenanceCost ?? 0,
    established: opts.established,
    online: true,
  };
}

// ---------------------------------------------------------------------------
// Construction project factory
// ---------------------------------------------------------------------------

export interface MakeConstructionProjectOpts {
  facilityId: string;
  /** 0-1 fraction of resources + money delivered so far. */
  percentComplete: number;
  moneyCost: number;
  resourcesRequired: ResourceRequirement[];
  startedPeriod: number;
}

export function makeConstructionProject(opts: MakeConstructionProjectOpts): ConstructionProject {
  const pct = Math.max(0, Math.min(1, opts.percentComplete));
  const resourcesDelivered: ResourceRequirement[] = opts.resourcesRequired.map(r => ({
    resourceId: r.resourceId,
    amount: Math.floor(r.amount * pct),
  }));
  return {
    facilityId: opts.facilityId,
    resourcesRequired: opts.resourcesRequired,
    resourcesDelivered,
    moneyCost: opts.moneyCost,
    startedPeriod: opts.startedPeriod,
  };
}

// ---------------------------------------------------------------------------
// Route factories
// ---------------------------------------------------------------------------

export interface MakeRouteLegOpts {
  id: string;
  origin: RouteLocation;
  destination: RouteLocation;
  craftDesignId: string;
  cargoKg: number;
  cost: number;
  craftCount?: number;
  provenFlightId?: string;
}

export function makeRouteLeg(opts: MakeRouteLegOpts): RouteLeg {
  return {
    id: opts.id,
    origin: opts.origin,
    destination: opts.destination,
    craftDesignId: opts.craftDesignId,
    craftCount: opts.craftCount ?? 1,
    cargoCapacityKg: opts.cargoKg,
    costPerRun: opts.cost,
    provenFlightId: opts.provenFlightId ?? `flight-proven-${opts.id}`,
  };
}

export interface MakeRouteOpts {
  id: string;
  name: string;
  resource: ResourceType;
  legs: RouteLeg[];
  status: RouteStatus;
  /** Cargo throughput per period (kg). Defaults to sum of leg cargo capacity. */
  throughputPerPeriod?: number;
}

export function makeRoute(opts: MakeRouteOpts): Route {
  const totalCost = opts.legs.reduce((sum, l) => sum + l.costPerRun * l.craftCount, 0);
  const throughput = opts.throughputPerPeriod
    ?? opts.legs.reduce((sum, l) => sum + l.cargoCapacityKg * l.craftCount, 0);
  return {
    id: opts.id,
    name: opts.name,
    status: opts.status,
    resourceType: opts.resource,
    legs: opts.legs,
    throughputPerPeriod: throughput,
    totalCostPerPeriod: totalCost,
  };
}

// ---------------------------------------------------------------------------
// Field craft factory
// ---------------------------------------------------------------------------

export interface MakeFieldCraftOpts {
  id: string;
  name: string;
  bodyId: string;
  status: FieldCraftStatus;
  deployedPeriod: number;
  crewIds: string[];
  /** Required when status is IN_ORBIT; ignored when LANDED. */
  bandId?: string;
  suppliesRemaining?: number;
  hasExtendedLifeSupport?: boolean;
}

export function makeFieldCraft(opts: MakeFieldCraftOpts): FieldCraft {
  const inOrbit = opts.status === FieldCraftStatus.IN_ORBIT;
  const bandId = inOrbit ? (opts.bandId ?? 'LEO') : null;
  const elements = inOrbit ? orbitalElementsForBand(opts.bodyId, bandId!) : null;
  return {
    id: opts.id,
    name: opts.name,
    bodyId: opts.bodyId,
    status: opts.status,
    crewIds: opts.crewIds,
    suppliesRemaining: opts.suppliesRemaining ?? 30,
    hasExtendedLifeSupport: opts.hasExtendedLifeSupport ?? false,
    deployedPeriod: opts.deployedPeriod,
    orbitalElements: elements,
    orbitBandId: bandId,
  };
}

// ---------------------------------------------------------------------------
// Base state helper
// ---------------------------------------------------------------------------

function debugCrew(id: string, name: string, salary: number, skills: Partial<CrewSkills>): CrewMember {
  const c = createCrewMember({ id, name, salary, hireDate: '2026-01-01T00:00:00.000Z' });
  c.skills = { piloting: skills.piloting ?? 0, engineering: skills.engineering ?? 0, science: skills.science ?? 0 };
  return c;
}

/**
 * Produce a baseline wealthy freeplay state that the late-game stage
 * definitions build on.  All facilities at tier 3, full tech tree, broad
 * part catalog, healthy crew, loan paid off.
 */
export function wealthyLateGameBase(): GameState {
  const s = createGameState();
  s.agencyName = 'Debug Agency';
  s.gameMode = GameMode.FREEPLAY;
  s.tutorialMode = false;
  s.currentPeriod = 80;
  s.money = 25_000_000;
  s.loan = { balance: 0, interestRate: 0.03, totalInterestAccrued: 120_000 };
  s.reputation = 95;
  s.sciencePoints = 500;
  s.playTimeSeconds = 24_000;
  s.flightTimeSeconds = 9_000;

  s.parts = [
    'probe-core-mk1','cmd-mk1','tank-small','tank-medium','tank-large',
    'engine-spark','engine-spark-improved','engine-reliant','engine-poodle','engine-nerv','engine-ion','engine-deep-space',
    'srb-small','srb-large',
    'parachute-mk1','parachute-mk2','parachute-drogue',
    'landing-legs-small','landing-legs-large','landing-legs-powered',
    'heat-shield-mk1','heat-shield-mk2',
    'decoupler-stack-tr18','decoupler-radial',
    'docking-port-std','docking-port-small','nose-cone','tube-connector','relay-antenna',
    'satellite-mk1','satellite-comm','satellite-gps','satellite-relay','satellite-science','satellite-weather',
    'science-module-mk1','thermometer-mk1','sample-return-container','surface-instrument-package',
    'solar-panel-small','solar-panel-large','battery-small','battery-large','mission-module-extended',
  ];

  s.crew = [
    debugCrew('crew-d-001','Alex Mitchell',1200,{piloting:60,engineering:40,science:30}),
    debugCrew('crew-d-002','Jordan Lee',1500,{piloting:30,engineering:55,science:35}),
    debugCrew('crew-d-003','Sam Rivera',1300,{piloting:35,engineering:25,science:55}),
    debugCrew('crew-d-004','Casey Park',1400,{piloting:45,engineering:35,science:40}),
    debugCrew('crew-d-005','Morgan Chen',1600,{piloting:50,engineering:45,science:45}),
  ];

  const earthHub = s.hubs[0];
  earthHub.facilities[FacilityId.LAUNCH_PAD]       = { built: true, tier: 3 };
  earthHub.facilities[FacilityId.VAB]              = { built: true, tier: 3 };
  earthHub.facilities[FacilityId.MISSION_CONTROL]  = { built: true, tier: 3 };
  earthHub.facilities[FacilityId.CREW_ADMIN]       = { built: true, tier: 3 };
  earthHub.facilities[FacilityId.RD_LAB]           = { built: true, tier: 3 };
  earthHub.facilities[FacilityId.TRACKING_STATION] = { built: true, tier: 3 };
  earthHub.facilities[FacilityId.SATELLITE_OPS]    = { built: true, tier: 1 };
  earthHub.facilities[FacilityId.LIBRARY]          = { built: true, tier: 1 };

  s.techTree = {
    researched: [
      'prop-t1','prop-t2','prop-t3','prop-t4','prop-t5',
      'struct-t1','struct-t2','struct-t3','struct-t4','struct-t5',
      'recov-t1','recov-t2','recov-t3','recov-t4','recov-t5',
      'sci-t1','sci-t2','sci-t3','sci-t4','sci-t5',
    ],
    unlockedInstruments: ['barometer','surface-sampler','radiation-detector','gravity-gradiometer','magnetometer'],
  };

  return s;
}

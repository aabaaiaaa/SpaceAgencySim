/**
 * hubFacilities.ts — Hub facility definitions, environment categories,
 * cost multipliers, and maintenance data.
 * @module data/hubFacilities
 */

import { FacilityId } from '../core/constants.ts';
import type { ResourceType } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Environment Categories
// ---------------------------------------------------------------------------

export const EnvironmentCategory = Object.freeze({
  AIRLESS_LOW_GRAVITY: 'AIRLESS_LOW_GRAVITY',
  ATMOSPHERIC_SURFACE: 'ATMOSPHERIC_SURFACE',
  HOSTILE_ATMOSPHERIC: 'HOSTILE_ATMOSPHERIC',
  ORBITAL: 'ORBITAL',
  HARSH: 'HARSH',
} as const);

export type EnvironmentCategory = (typeof EnvironmentCategory)[keyof typeof EnvironmentCategory];

/** Cost multiplier per environment category (applied to construction resource costs). */
export const ENVIRONMENT_COST_MULTIPLIER: Readonly<Record<EnvironmentCategory, number>> = Object.freeze({
  [EnvironmentCategory.AIRLESS_LOW_GRAVITY]: 1.0,
  [EnvironmentCategory.ATMOSPHERIC_SURFACE]: 1.3,
  [EnvironmentCategory.HOSTILE_ATMOSPHERIC]: 1.8,
  [EnvironmentCategory.ORBITAL]: 1.5,
  [EnvironmentCategory.HARSH]: 2.5,
});

/** Map each celestial body to its environment category. */
export const BODY_ENVIRONMENT: Readonly<Record<string, EnvironmentCategory>> = Object.freeze({
  MOON: EnvironmentCategory.AIRLESS_LOW_GRAVITY,
  MARS: EnvironmentCategory.ATMOSPHERIC_SURFACE,
  CERES: EnvironmentCategory.AIRLESS_LOW_GRAVITY,
  TITAN: EnvironmentCategory.HOSTILE_ATMOSPHERIC,
  JUPITER: EnvironmentCategory.HARSH,
  SATURN: EnvironmentCategory.HARSH,
});

// ---------------------------------------------------------------------------
// Import Tax
// ---------------------------------------------------------------------------

/** Import tax multiplier per body (applied to part costs at off-world hubs). */
export const IMPORT_TAX_MULTIPLIER: Readonly<Record<string, number>> = Object.freeze({
  EARTH: 1.0,
  MOON: 1.2,
  MARS: 1.5,
  CERES: 1.8,
  TITAN: 2.2,
  JUPITER: 2.5,
  SATURN: 3.0,
});

/** Default import tax multiplier for bodies not in the map. */
export const DEFAULT_IMPORT_TAX = 2.0;

// ---------------------------------------------------------------------------
// Crew Hab Capacity
// ---------------------------------------------------------------------------

/** Maximum crew + tourist capacity per Crew Hab tier. */
export const CREW_HAB_CAPACITY: Readonly<Record<number, number>> = Object.freeze({
  1: 4,
  2: 8,
  3: 16,
});

// ---------------------------------------------------------------------------
// Facility Lists
// ---------------------------------------------------------------------------

/** Facilities available at surface hubs. */
export const SURFACE_HUB_FACILITIES: readonly string[] = Object.freeze([
  FacilityId.CREW_HAB,
  FacilityId.LAUNCH_PAD,
  FacilityId.VAB,
  FacilityId.LOGISTICS_CENTER,
]);

/** Facilities available at orbital hubs. */
export const ORBITAL_HUB_FACILITIES: readonly string[] = Object.freeze([
  FacilityId.CREW_HAB,
  FacilityId.VAB,
  FacilityId.LOGISTICS_CENTER,
]);

/** Facilities only available at Earth. */
export const EARTH_ONLY_FACILITIES: readonly string[] = Object.freeze([
  FacilityId.MISSION_CONTROL,
  FacilityId.CREW_ADMIN,
  FacilityId.TRACKING_STATION,
  FacilityId.RD_LAB,
  FacilityId.SATELLITE_OPS,
  FacilityId.LIBRARY,
]);

// ---------------------------------------------------------------------------
// Off-World Facility Costs
// ---------------------------------------------------------------------------

/** Resource cost for constructing a facility at an off-world hub. */
export interface FacilityResourceCost {
  readonly facilityId: string;
  readonly moneyCost: number;
  readonly resources: readonly { readonly resourceId: ResourceType; readonly amount: number }[];
}

/** Base construction costs for off-world facilities (before environment multiplier). */
export const OFFWORLD_FACILITY_COSTS: readonly FacilityResourceCost[] = Object.freeze([
  Object.freeze({
    facilityId: FacilityId.CREW_HAB,
    moneyCost: 200_000,
    resources: Object.freeze([
      Object.freeze({ resourceId: 'IRON_ORE' as ResourceType, amount: 500 }),
      Object.freeze({ resourceId: 'WATER_ICE' as ResourceType, amount: 200 }),
    ]),
  }),
  Object.freeze({
    facilityId: FacilityId.LAUNCH_PAD,
    moneyCost: 300_000,
    resources: Object.freeze([
      Object.freeze({ resourceId: 'IRON_ORE' as ResourceType, amount: 800 }),
    ]),
  }),
  Object.freeze({
    facilityId: FacilityId.VAB,
    moneyCost: 250_000,
    resources: Object.freeze([
      Object.freeze({ resourceId: 'IRON_ORE' as ResourceType, amount: 600 }),
    ]),
  }),
  Object.freeze({
    facilityId: FacilityId.LOGISTICS_CENTER,
    moneyCost: 350_000,
    resources: Object.freeze([
      Object.freeze({ resourceId: 'IRON_ORE' as ResourceType, amount: 400 }),
      Object.freeze({ resourceId: 'RARE_METALS' as ResourceType, amount: 100 }),
    ]),
  }),
]);

// ---------------------------------------------------------------------------
// Off-World Facility Upkeep
// ---------------------------------------------------------------------------

/** Per-period maintenance cost for each off-world facility (per tier). */
export const OFFWORLD_FACILITY_UPKEEP: Readonly<Record<string, number>> = Object.freeze({
  [FacilityId.CREW_HAB]: 5_000,
  [FacilityId.LAUNCH_PAD]: 8_000,
  [FacilityId.VAB]: 6_000,
  [FacilityId.LOGISTICS_CENTER]: 7_000,
});

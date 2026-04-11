/**
 * resources.ts — Resource definition catalog for the mining/ISRU system.
 *
 * Each resource is a data object describing its physical properties, value,
 * where it can be found, and what extraction module is required to harvest it.
 *
 * All entries are immutable at runtime — the core layer clones them when
 * instantiating resource inventories.
 *
 * @module data/resources
 */

import { ResourceType, ResourceState, MiningModuleType } from '../core/constants.ts';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/** Complete definition for a single harvestable resource. */
export interface ResourceDef {
  /** Unique identifier matching a ResourceType enum value. */
  id: ResourceType;
  /** Human-readable display name. */
  name: string;
  /** Short flavour description shown in UI tooltips. */
  description: string;
  /** Physical state of the resource (solid, liquid, gas). */
  state: ResourceState;
  /** Mass density in kg/m³. */
  massDensity: number;
  /** Base economic value per kilogram in dollars. */
  baseValuePerKg: number;
  /** Body IDs where this resource can be found (UPPERCASE, e.g. 'MOON'). */
  sources: readonly string[];
  /** Mining module type required to extract this resource. */
  extractionModule: MiningModuleType;
}

// ---------------------------------------------------------------------------
// Resource Catalog
// ---------------------------------------------------------------------------

/**
 * Master list of all harvestable resources.
 * Frozen at module load — never mutated at runtime.
 */
export const RESOURCES: readonly ResourceDef[] = Object.freeze([
  {
    id: ResourceType.WATER_ICE,
    name: 'Water Ice',
    description: 'Frozen water deposits found in permanently shadowed craters and polar regions.',
    state: ResourceState.SOLID,
    massDensity: 917,
    baseValuePerKg: 50,
    sources: Object.freeze(['MOON', 'MARS', 'CERES']),
    extractionModule: MiningModuleType.MINING_DRILL,
  },
  {
    id: ResourceType.REGOLITH,
    name: 'Regolith',
    description: 'Loose surface soil and rock fragments covering planetary bodies.',
    state: ResourceState.SOLID,
    massDensity: 1500,
    baseValuePerKg: 5,
    sources: Object.freeze(['MOON', 'MARS']),
    extractionModule: MiningModuleType.MINING_DRILL,
  },
  {
    id: ResourceType.IRON_ORE,
    name: 'Iron Ore',
    description: 'Iron-rich mineral deposits suitable for in-situ metal production.',
    state: ResourceState.SOLID,
    massDensity: 5000,
    baseValuePerKg: 200,
    sources: Object.freeze(['CERES', 'MOON']),
    extractionModule: MiningModuleType.MINING_DRILL,
  },
  {
    id: ResourceType.RARE_METALS,
    name: 'Rare Metals',
    description: 'Platinum-group and rare-earth elements concentrated in asteroid bodies.',
    state: ResourceState.SOLID,
    massDensity: 8000,
    baseValuePerKg: 5000,
    sources: Object.freeze(['CERES']),
    extractionModule: MiningModuleType.MINING_DRILL,
  },
  {
    id: ResourceType.CO2,
    name: 'Carbon Dioxide',
    description: 'Atmospheric CO₂ harvested for conversion into fuel and oxygen.',
    state: ResourceState.GAS,
    massDensity: 1.98,
    baseValuePerKg: 10,
    sources: Object.freeze(['MARS']),
    extractionModule: MiningModuleType.GAS_COLLECTOR,
  },
  {
    id: ResourceType.HYDROGEN,
    name: 'Hydrogen',
    description: 'Lightweight fuel gas extracted from gas giant atmospheres.',
    state: ResourceState.GAS,
    massDensity: 0.09,
    baseValuePerKg: 500,
    sources: Object.freeze(['JUPITER', 'SATURN']),
    extractionModule: MiningModuleType.GAS_COLLECTOR,
  },
  {
    id: ResourceType.OXYGEN,
    name: 'Oxygen',
    description: 'Atmospheric oxygen for life support and oxidizer production.',
    state: ResourceState.GAS,
    massDensity: 1.43,
    baseValuePerKg: 100,
    sources: Object.freeze(['MARS']),
    extractionModule: MiningModuleType.GAS_COLLECTOR,
  },
  {
    id: ResourceType.HELIUM_3,
    name: 'Helium-3',
    description: 'Rare helium isotope embedded in lunar regolith by solar wind — prized for fusion research.',
    state: ResourceState.GAS,
    massDensity: 0.16,
    baseValuePerKg: 50000,
    sources: Object.freeze(['MOON']),
    extractionModule: MiningModuleType.GAS_COLLECTOR,
  },
  {
    id: ResourceType.LIQUID_METHANE,
    name: 'Liquid Methane',
    description: 'Cryogenic methane lakes found on Titan, usable as rocket propellant.',
    state: ResourceState.LIQUID,
    massDensity: 422,
    baseValuePerKg: 300,
    sources: Object.freeze(['TITAN']),
    extractionModule: MiningModuleType.FLUID_EXTRACTOR,
  },
  {
    id: ResourceType.HYDRAZINE,
    name: 'Hydrazine',
    description: 'Synthesised hypergolic propellant — not found naturally but produced at refineries.',
    state: ResourceState.LIQUID,
    massDensity: 1004,
    baseValuePerKg: 800,
    sources: Object.freeze([]),
    extractionModule: MiningModuleType.FLUID_EXTRACTOR,
  },
] as const);

// ---------------------------------------------------------------------------
// Lookup Table
// ---------------------------------------------------------------------------

/**
 * Fast lookup of resource definitions by ResourceType ID.
 * Built once from the RESOURCES array and frozen.
 */
export const RESOURCES_BY_ID: Readonly<Record<ResourceType, ResourceDef>> = Object.freeze(
  RESOURCES.reduce((acc, r) => {
    acc[r.id] = r;
    return acc;
  }, {} as Record<ResourceType, ResourceDef>),
);

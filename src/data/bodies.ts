/**
 * bodies.ts — Celestial body definitions for the solar system.
 *
 * Each body is a data object parameterising physics and rendering:
 *   - Physical: surface gravity, radius, GM, atmosphere profile
 *   - Orbital: distance from parent, orbital period, SOI radius
 *   - Hierarchy: parent body, children list
 *   - Visual: ground colour, sky gradient, weather effects
 *   - Gameplay: landable flag, biomes, science multipliers
 *
 * SOI (Sphere of Influence):
 *   Each body has an SOI — the region where its gravity dominates.
 *   The Sun's SOI encompasses the entire solar system.
 *   When a craft crosses an SOI boundary it transitions from one body's
 *   gravitational dominance to another's (e.g., leaving Earth SOI enters
 *   Sun's, entering Moon's SOI leaves Earth's).
 *
 * @module data/bodies
 */

import { BeltZone } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface AtmosphereProfile {
  /** Air density at surface (kg/m³). */
  seaLevelDensity: number;
  /** Exponential scale height (m). */
  scaleHeight: number;
  /** Altitude above which density is zero (m). */
  topAltitude: number;
  /** Dominant gas(es) for flavour text. */
  composition?: string;
}

export interface SkyVisual {
  /** Hex colour at ground level. */
  seaLevelColor: number;
  /** Hex colour at upper atmosphere / space. */
  highAltColor: number;
  /** Hex colour in vacuum. */
  spaceColor: number;
  /** Altitude (m) where stars begin to appear. */
  starFadeStart: number;
  /** Altitude (m) where stars are fully visible. */
  starFadeEnd: number;
}

export interface GroundVisual {
  /** Primary surface colour (hex). */
  color: number;
  /** Short flavour text for rendering hints. */
  description: string;
}

export interface BiomeDef {
  /** Machine-readable identifier. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Minimum altitude in metres (surface-relative). */
  min: number;
  /** Maximum altitude in metres (Infinity for top). */
  max: number;
  /** Multiplier applied to science experiment value. */
  scienceMultiplier: number;
  /** Tint colour (hex) for label rendering. */
  color: number;
}

export interface AltitudeBand {
  /** Band identifier (e.g., 'LEO', 'LLO'). */
  id: string;
  /** Human-readable band name. */
  name: string;
  /** Minimum altitude in metres. */
  min: number;
  /** Maximum altitude in metres. */
  max: number;
  /** Asteroid belt zone tag, if this band falls within the belt. */
  beltZone?: BeltZone;
  /** Whether orbiting in this band is unsafe (e.g., high debris density). */
  unsafe?: boolean;
}

export interface CelestialBodyDef {
  /** Unique body identifier (matches CelestialBody enum). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Surface gravitational acceleration (m/s²). */
  surfaceGravity: number;
  /** Mean radius in metres. */
  radius: number;
  /** Gravitational parameter μ = G×M (m³/s²). */
  gm: number;
  /** Atmosphere profile or null if airless. */
  atmosphere: AtmosphereProfile | null;
  /** Mean distance from parent body (m). 0 for the Sun. */
  orbitalDistance: number;
  /** Orbital period in seconds. 0 for the Sun. */
  orbitalPeriod: number;
  /** Altitude-based biome definitions. */
  biomes: BiomeDef[];
  /** Orbital altitude band definitions. */
  altitudeBands: AltitudeBand[];
  /** Ground/surface rendering hints. */
  groundVisual: GroundVisual;
  /** Sky gradient rendering hints. */
  skyVisual: SkyVisual;
  /** Weather type or null (e.g., 'dust_storms'). */
  weather: string | null;
  /** Whether craft can land (false for Sun, gas giants). */
  landable: boolean;
  /** Sphere of Influence radius from body centre (m). */
  soiRadius: number;
  /** Parent body ID or null for the Sun. */
  parentId: string | null;
  /** IDs of bodies orbiting this one. */
  childIds: string[];
  /** Minimum stable orbit altitude (m above surface). */
  minOrbitAltitude: number;
  /** Description of destruction hazard or null. */
  destructionZone: string | null;
}

// ---------------------------------------------------------------------------
// Body definitions
// ---------------------------------------------------------------------------

const SUN: CelestialBodyDef = {
  id: 'SUN',
  name: 'Sun',
  surfaceGravity: 274,
  radius: 695_700_000,
  gm: 1.32712440018e20,
  atmosphere: null,
  orbitalDistance: 0,
  orbitalPeriod: 0,
  biomes: [
    { id: 'SUN_INFERNO',         name: 'Solar Inferno',        min: 0,                max: 500_000_000,     scienceMultiplier: 0,    color: 0xffffff },
    { id: 'SUN_INNER_CORONA',    name: 'Inner Corona',         min: 500_000_000,      max: 2_000_000_000,   scienceMultiplier: 12.0, color: 0xffee44 },
    { id: 'SUN_OUTER_CORONA',    name: 'Outer Corona',         min: 2_000_000_000,    max: 10_000_000_000,  scienceMultiplier: 8.0,  color: 0xffaa22 },
    { id: 'SUN_NEAR_SPACE',      name: 'Near Sun Space',       min: 10_000_000_000,   max: 30_000_000_000,  scienceMultiplier: 5.0,  color: 0xff8800 },
    { id: 'SUN_SOLAR_ORBIT',     name: 'Solar Orbit',          min: 30_000_000_000,   max: Infinity,        scienceMultiplier: 3.0,  color: 0x332200 },
  ],
  altitudeBands: [
    { id: 'INNER_CORONA', name: 'Inner Corona',   min: 500_000_000,     max: 2_000_000_000 },
    { id: 'OUTER_CORONA', name: 'Outer Corona',   min: 2_000_000_000,   max: 10_000_000_000 },
    { id: 'NSS',          name: 'Near Sun Space',  min: 10_000_000_000,  max: 30_000_000_000 },
    { id: 'SOL',          name: 'Solar Orbit',     min: 30_000_000_000,  max: 329_000_000_000 },
    { id: 'BELT_OUTER_A', name: 'Outer Belt A',    min: 329_000_000_000, max: 374_000_000_000, beltZone: BeltZone.OUTER_A },
    { id: 'BELT_DENSE',   name: 'Dense Belt',      min: 374_000_000_000, max: 419_000_000_000, beltZone: BeltZone.DENSE, unsafe: true },
    { id: 'BELT_OUTER_B', name: 'Outer Belt B',    min: 419_000_000_000, max: 479_000_000_000, beltZone: BeltZone.OUTER_B },
  ],
  groundVisual: { color: 0xffcc00, description: 'Incandescent plasma surface' },
  skyVisual: {
    seaLevelColor: 0xffdd44,
    highAltColor: 0xff8800,
    spaceColor: 0x000005,
    starFadeStart: 5_000_000_000,
    starFadeEnd: 10_000_000_000,
  },
  weather: null,
  landable: false,
  soiRadius: Infinity,
  parentId: null,
  childIds: ['MERCURY', 'VENUS', 'EARTH', 'MARS', 'CERES', 'JUPITER', 'SATURN'],
  minOrbitAltitude: 2_000_000_000,
  destructionZone: 'extreme_heat',
};

const MERCURY: CelestialBodyDef = {
  id: 'MERCURY',
  name: 'Mercury',
  surfaceGravity: 3.7,
  radius: 2_439_700,
  gm: 2.2032e13,
  atmosphere: null,
  orbitalDistance: 57_909_000_000,
  orbitalPeriod: 7_600_521,
  biomes: [
    { id: 'MERCURY_SURFACE',     name: 'Mercury Surface',      min: 0,       max: 100,       scienceMultiplier: 2.0,  color: 0x8a8a8a },
    { id: 'MERCURY_NEAR',        name: 'Near Surface',         min: 100,     max: 5_000,     scienceMultiplier: 2.5,  color: 0x707070 },
    { id: 'MERCURY_LOW_ALT',     name: 'Low Altitude',         min: 5_000,   max: 20_000,    scienceMultiplier: 3.0,  color: 0x505060 },
    { id: 'MERCURY_LOW_ORBIT',   name: 'Low Mercury Orbit',    min: 20_000,  max: 200_000,   scienceMultiplier: 3.5,  color: 0x303040 },
    { id: 'MERCURY_HIGH_ORBIT',  name: 'High Mercury Orbit',   min: 200_000, max: Infinity,  scienceMultiplier: 4.0,  color: 0x101020 },
  ],
  altitudeBands: [
    { id: 'LMeO', name: 'Low Mercury Orbit',    min: 20_000,  max: 200_000 },
    { id: 'MMeO', name: 'Medium Mercury Orbit',  min: 200_000, max: 1_000_000 },
    { id: 'HMeO', name: 'High Mercury Orbit',   min: 1_000_000, max: 5_000_000 },
  ],
  groundVisual: { color: 0x8a8a8a, description: 'Cratered grey regolith' },
  skyVisual: {
    seaLevelColor: 0x000005,
    highAltColor: 0x000005,
    spaceColor: 0x000005,
    starFadeStart: 0,
    starFadeEnd: 0,
  },
  weather: null,
  landable: true,
  soiRadius: 112_000_000,
  parentId: 'SUN',
  childIds: [],
  minOrbitAltitude: 20_000,
  destructionZone: null,
};

const VENUS: CelestialBodyDef = {
  id: 'VENUS',
  name: 'Venus',
  surfaceGravity: 8.87,
  radius: 6_051_800,
  gm: 3.24859e14,
  atmosphere: {
    seaLevelDensity: 65.0,
    scaleHeight: 15_900,
    topAltitude: 250_000,
    composition: 'CO₂ (96.5%), N₂ (3.5%)',
  },
  orbitalDistance: 108_208_000_000,
  orbitalPeriod: 19_414_149,
  biomes: [
    { id: 'VENUS_SURFACE',       name: 'Venus Surface',        min: 0,       max: 100,       scienceMultiplier: 3.0,  color: 0xd4a04a },
    { id: 'VENUS_LOW_ATMO',      name: 'Low Atmosphere',       min: 100,     max: 10_000,    scienceMultiplier: 2.5,  color: 0xcc9944 },
    { id: 'VENUS_MID_ATMO',      name: 'Mid Atmosphere',       min: 10_000,  max: 50_000,    scienceMultiplier: 2.0,  color: 0xbb8833 },
    { id: 'VENUS_UPPER_ATMO',    name: 'Upper Atmosphere',     min: 50_000,  max: 150_000,   scienceMultiplier: 2.5,  color: 0x886622 },
    { id: 'VENUS_EXOSPHERE',     name: 'Exosphere',            min: 150_000, max: 250_000,   scienceMultiplier: 3.0,  color: 0x443311 },
    { id: 'VENUS_LOW_ORBIT',     name: 'Low Venus Orbit',      min: 250_000, max: 500_000,   scienceMultiplier: 3.5,  color: 0x202020 },
    { id: 'VENUS_HIGH_ORBIT',    name: 'High Venus Orbit',     min: 500_000, max: Infinity,  scienceMultiplier: 4.0,  color: 0x101010 },
  ],
  altitudeBands: [
    { id: 'LVO', name: 'Low Venus Orbit',    min: 250_000,   max: 500_000 },
    { id: 'MVO', name: 'Medium Venus Orbit',  min: 500_000,   max: 2_000_000 },
    { id: 'HVO', name: 'High Venus Orbit',   min: 2_000_000, max: 10_000_000 },
  ],
  groundVisual: { color: 0xd4a04a, description: 'Volcanic basalt plains, orange haze' },
  skyVisual: {
    seaLevelColor: 0xd4a04a,
    highAltColor: 0x886622,
    spaceColor: 0x000005,
    starFadeStart: 150_000,
    starFadeEnd: 250_000,
  },
  weather: null,
  landable: true,
  soiRadius: 616_000_000,
  parentId: 'SUN',
  childIds: [],
  minOrbitAltitude: 250_000,
  destructionZone: null,
};

const EARTH: CelestialBodyDef = {
  id: 'EARTH',
  name: 'Earth',
  surfaceGravity: 9.81,
  radius: 6_371_000,
  gm: 3.986004418e14,
  atmosphere: {
    seaLevelDensity: 1.225,
    scaleHeight: 8_500,
    topAltitude: 70_000,
    composition: 'N₂ (78%), O₂ (21%)',
  },
  orbitalDistance: 149_598_000_000,
  orbitalPeriod: 31_557_600,
  biomes: [
    { id: 'GROUND',           name: 'Ground',           min: 0,       max: 100,       scienceMultiplier: 0.5, color: 0xc4a882 },
    { id: 'LOW_ATMOSPHERE',   name: 'Low Atmosphere',   min: 100,     max: 2_000,     scienceMultiplier: 1.0, color: 0x87ceeb },
    { id: 'MID_ATMOSPHERE',   name: 'Mid Atmosphere',   min: 2_000,   max: 10_000,    scienceMultiplier: 1.2, color: 0x6aadce },
    { id: 'UPPER_ATMOSPHERE', name: 'Upper Atmosphere',  min: 10_000,  max: 40_000,    scienceMultiplier: 1.5, color: 0x3a6a9e },
    { id: 'MESOSPHERE',       name: 'Mesosphere',        min: 40_000,  max: 70_000,    scienceMultiplier: 2.0, color: 0x1a1a4e },
    { id: 'NEAR_SPACE',       name: 'Near Space',        min: 70_000,  max: 100_000,   scienceMultiplier: 2.5, color: 0x0a0a2e },
    { id: 'LOW_ORBIT',        name: 'Low Orbit',         min: 100_000, max: 200_000,   scienceMultiplier: 3.0, color: 0x050520 },
    { id: 'HIGH_ORBIT',       name: 'High Orbit',        min: 200_000, max: Infinity,  scienceMultiplier: 4.0, color: 0x000010 },
  ],
  altitudeBands: [
    { id: 'LEO', name: 'Low Earth Orbit',    min: 80_000,     max: 200_000 },
    { id: 'MEO', name: 'Medium Earth Orbit',  min: 200_000,    max: 2_000_000 },
    { id: 'HEO', name: 'High Earth Orbit',   min: 2_000_000,  max: 35_786_000 },
  ],
  groundVisual: { color: 0xc4a882, description: 'Desert sandy terrain' },
  skyVisual: {
    seaLevelColor: 0x87ceeb,
    highAltColor: 0x1a1a4e,
    spaceColor: 0x000005,
    starFadeStart: 50_000,
    starFadeEnd: 70_000,
  },
  weather: null,
  landable: true,
  soiRadius: 924_000_000,
  parentId: 'SUN',
  childIds: ['MOON'],
  minOrbitAltitude: 70_000,
  destructionZone: null,
};

const MOON: CelestialBodyDef = {
  id: 'MOON',
  name: 'Moon',
  surfaceGravity: 1.62,
  radius: 1_737_400,
  gm: 4.9048695e12,
  atmosphere: null,
  orbitalDistance: 384_400_000,
  orbitalPeriod: 2_360_591,
  biomes: [
    { id: 'LUNAR_SURFACE',    name: 'Lunar Surface',     min: 0,       max: 100,       scienceMultiplier: 1.0, color: 0xa0a0a0 },
    { id: 'NEAR_SURFACE',     name: 'Near Surface',      min: 100,     max: 5_000,     scienceMultiplier: 1.5, color: 0x808080 },
    { id: 'LOW_ALTITUDE',     name: 'Low Altitude',      min: 5_000,   max: 15_000,    scienceMultiplier: 2.0, color: 0x404060 },
    { id: 'LOW_LUNAR_ORBIT',  name: 'Low Lunar Orbit',   min: 15_000,  max: 100_000,   scienceMultiplier: 3.0, color: 0x202040 },
    { id: 'HIGH_LUNAR_ORBIT', name: 'High Lunar Orbit',  min: 100_000, max: Infinity,  scienceMultiplier: 4.0, color: 0x101020 },
  ],
  altitudeBands: [
    { id: 'LLO', name: 'Low Lunar Orbit',    min: 15_000,    max: 100_000 },
    { id: 'MLO', name: 'Medium Lunar Orbit',  min: 100_000,   max: 1_000_000 },
    { id: 'HLO', name: 'High Lunar Orbit',   min: 1_000_000, max: 10_000_000 },
  ],
  groundVisual: { color: 0xa0a0a0, description: 'Grey lunar regolith' },
  skyVisual: {
    seaLevelColor: 0x000005,
    highAltColor: 0x000005,
    spaceColor: 0x000005,
    starFadeStart: 0,
    starFadeEnd: 0,
  },
  weather: null,
  landable: true,
  soiRadius: 66_100_000,
  parentId: 'EARTH',
  childIds: [],
  minOrbitAltitude: 15_000,
  destructionZone: null,
};

const MARS: CelestialBodyDef = {
  id: 'MARS',
  name: 'Mars',
  surfaceGravity: 3.72,
  radius: 3_389_500,
  gm: 4.282837e13,
  atmosphere: {
    seaLevelDensity: 0.020,
    scaleHeight: 11_100,
    topAltitude: 80_000,
    composition: 'CO₂ (95%), N₂ (2.7%)',
  },
  orbitalDistance: 227_939_000_000,
  orbitalPeriod: 59_354_294,
  biomes: [
    { id: 'MARS_SURFACE',       name: 'Mars Surface',        min: 0,       max: 100,       scienceMultiplier: 2.0,  color: 0xc1440e },
    { id: 'MARS_LOW_ATMO',      name: 'Low Atmosphere',      min: 100,     max: 5_000,     scienceMultiplier: 2.5,  color: 0xb0550e },
    { id: 'MARS_MID_ATMO',      name: 'Mid Atmosphere',      min: 5_000,   max: 20_000,    scienceMultiplier: 2.8,  color: 0x8a3a0a },
    { id: 'MARS_UPPER_ATMO',    name: 'Upper Atmosphere',    min: 20_000,  max: 50_000,    scienceMultiplier: 3.0,  color: 0x5a2208 },
    { id: 'MARS_EXOSPHERE',     name: 'Exosphere',           min: 50_000,  max: 80_000,    scienceMultiplier: 3.5,  color: 0x2a1104 },
    { id: 'MARS_LOW_ORBIT',     name: 'Low Mars Orbit',      min: 80_000,  max: 300_000,   scienceMultiplier: 4.0,  color: 0x150808 },
    { id: 'MARS_HIGH_ORBIT',    name: 'High Mars Orbit',     min: 300_000, max: Infinity,  scienceMultiplier: 5.0,  color: 0x0a0404 },
  ],
  altitudeBands: [
    { id: 'LMO', name: 'Low Mars Orbit',    min: 80_000,   max: 300_000 },
    { id: 'MMO', name: 'Medium Mars Orbit',  min: 300_000,  max: 2_000_000 },
    { id: 'HMO', name: 'High Mars Orbit',   min: 2_000_000, max: 20_000_000 },
  ],
  groundVisual: { color: 0xc1440e, description: 'Red iron-oxide desert' },
  skyVisual: {
    seaLevelColor: 0xd4a574,
    highAltColor: 0x4a2a10,
    spaceColor: 0x000005,
    starFadeStart: 50_000,
    starFadeEnd: 80_000,
  },
  weather: 'dust_storms',
  landable: true,
  soiRadius: 577_000_000,
  parentId: 'SUN',
  childIds: ['PHOBOS', 'DEIMOS'],
  minOrbitAltitude: 80_000,
  destructionZone: null,
};

const PHOBOS: CelestialBodyDef = {
  id: 'PHOBOS',
  name: 'Phobos',
  surfaceGravity: 0.0057,
  radius: 11_267,
  gm: 7.112e5,
  atmosphere: null,
  orbitalDistance: 9_376_000,
  orbitalPeriod: 27_554,
  biomes: [
    { id: 'PHOBOS_SURFACE',     name: 'Phobos Surface',      min: 0,      max: 50,        scienceMultiplier: 3.0, color: 0x6a6a60 },
    { id: 'PHOBOS_NEAR',        name: 'Near Phobos',         min: 50,     max: 1_000,     scienceMultiplier: 3.5, color: 0x505050 },
    { id: 'PHOBOS_ORBIT',       name: 'Phobos Orbit',        min: 1_000,  max: Infinity,  scienceMultiplier: 4.0, color: 0x303030 },
  ],
  altitudeBands: [
    { id: 'LPO', name: 'Low Phobos Orbit',  min: 1_000,  max: 5_000 },
    { id: 'HPO', name: 'High Phobos Orbit', min: 5_000,  max: 20_000 },
  ],
  groundVisual: { color: 0x6a6a60, description: 'Dark, cratered, carbon-rich regolith' },
  skyVisual: {
    seaLevelColor: 0x000005,
    highAltColor: 0x000005,
    spaceColor: 0x000005,
    starFadeStart: 0,
    starFadeEnd: 0,
  },
  weather: null,
  landable: true,
  soiRadius: 170_000,
  parentId: 'MARS',
  childIds: [],
  minOrbitAltitude: 1_000,
  destructionZone: null,
};

const DEIMOS: CelestialBodyDef = {
  id: 'DEIMOS',
  name: 'Deimos',
  surfaceGravity: 0.003,
  radius: 6_200,
  gm: 9.8e4,
  atmosphere: null,
  orbitalDistance: 23_463_000,
  orbitalPeriod: 109_075,
  biomes: [
    { id: 'DEIMOS_SURFACE',     name: 'Deimos Surface',      min: 0,      max: 50,        scienceMultiplier: 3.0, color: 0x7a7a70 },
    { id: 'DEIMOS_NEAR',        name: 'Near Deimos',         min: 50,     max: 1_000,     scienceMultiplier: 3.5, color: 0x606060 },
    { id: 'DEIMOS_ORBIT',       name: 'Deimos Orbit',        min: 1_000,  max: Infinity,  scienceMultiplier: 4.0, color: 0x404040 },
  ],
  altitudeBands: [
    { id: 'LDO', name: 'Low Deimos Orbit',  min: 500,    max: 3_000 },
    { id: 'HDO', name: 'High Deimos Orbit', min: 3_000,  max: 10_000 },
  ],
  groundVisual: { color: 0x7a7a70, description: 'Smooth, dusty, carbon-rich surface' },
  skyVisual: {
    seaLevelColor: 0x000005,
    highAltColor: 0x000005,
    spaceColor: 0x000005,
    starFadeStart: 0,
    starFadeEnd: 0,
  },
  weather: null,
  landable: true,
  soiRadius: 500_000,
  parentId: 'MARS',
  childIds: [],
  minOrbitAltitude: 500,
  destructionZone: null,
};

const CERES: CelestialBodyDef = {
  id: 'CERES',
  name: 'Ceres',
  surfaceGravity: 0.28,
  radius: 473_000,
  gm: 6.263e10,
  atmosphere: null,
  orbitalDistance: 413_700_000_000,
  orbitalPeriod: 145_310_000,
  biomes: [
    { id: 'CERES_SURFACE',     name: 'Ceres Surface',      min: 0,       max: 100,       scienceMultiplier: 4.0, color: 0x9a9a90 },
    { id: 'CERES_NEAR',        name: 'Near Surface',        min: 100,     max: 2_000,     scienceMultiplier: 4.5, color: 0x808078 },
    { id: 'CERES_LOW_ALT',     name: 'Low Altitude',        min: 2_000,   max: 10_000,    scienceMultiplier: 5.0, color: 0x606058 },
    { id: 'CERES_LOW_ORBIT',   name: 'Low Ceres Orbit',     min: 10_000,  max: 100_000,   scienceMultiplier: 5.5, color: 0x404038 },
    { id: 'CERES_HIGH_ORBIT',  name: 'High Ceres Orbit',    min: 100_000, max: Infinity,  scienceMultiplier: 6.0, color: 0x202018 },
  ],
  altitudeBands: [
    { id: 'LCO', name: 'Low Ceres Orbit',  min: 5_000,   max: 50_000 },
    { id: 'HCO', name: 'High Ceres Orbit', min: 50_000,  max: 200_000 },
  ],
  groundVisual: { color: 0x9a9a90, description: 'Dark rocky surface with bright salt deposits' },
  skyVisual: {
    seaLevelColor: 0x000005,
    highAltColor: 0x000005,
    spaceColor: 0x000005,
    starFadeStart: 0,
    starFadeEnd: 0,
  },
  weather: null,
  landable: true,
  soiRadius: 1_800_000,
  parentId: 'SUN',
  childIds: [],
  minOrbitAltitude: 5_000,
  destructionZone: null,
};

const JUPITER: CelestialBodyDef = {
  id: 'JUPITER',
  name: 'Jupiter',
  surfaceGravity: 24.79,
  radius: 69_911_000,
  gm: 1.26686534e17,
  atmosphere: {
    seaLevelDensity: 1.326,
    scaleHeight: 27_000,
    topAltitude: 200_000_000,
    composition: 'H₂ (89%), He (10%)',
  },
  orbitalDistance: 778_570_000_000,
  orbitalPeriod: 374_335_776,
  biomes: [
    { id: 'JUPITER_UPPER_CLOUD', name: 'Upper Cloud Layer',   min: 0,                max: 50_000_000,     scienceMultiplier: 0,    color: 0xe8d8a8 },
    { id: 'JUPITER_MID_ATMO',    name: 'Mid Atmosphere',      min: 50_000_000,       max: 100_000_000,    scienceMultiplier: 8.0,  color: 0xc4a868 },
    { id: 'JUPITER_UPPER_ATMO',  name: 'Upper Atmosphere',    min: 100_000_000,      max: 200_000_000,    scienceMultiplier: 7.0,  color: 0x8a7848 },
    { id: 'JUPITER_LOW_ORBIT',   name: 'Low Jupiter Orbit',   min: 200_000_000,      max: 500_000_000,    scienceMultiplier: 6.0,  color: 0x504828 },
    { id: 'JUPITER_HIGH_ORBIT',  name: 'High Jupiter Orbit',  min: 500_000_000,      max: Infinity,       scienceMultiplier: 5.0,  color: 0x282418 },
  ],
  altitudeBands: [
    { id: 'LJO', name: 'Low Jupiter Orbit',    min: 200_000_000,     max: 500_000_000 },
    { id: 'MJO', name: 'Medium Jupiter Orbit',  min: 500_000_000,     max: 2_000_000_000 },
    { id: 'HJO', name: 'High Jupiter Orbit',   min: 2_000_000_000,   max: 10_000_000_000 },
  ],
  groundVisual: { color: 0xe8d8a8, description: 'Swirling ammonia clouds and gas bands' },
  skyVisual: {
    seaLevelColor: 0xe8d8a8,
    highAltColor: 0x8a7848,
    spaceColor: 0x000005,
    starFadeStart: 100_000_000,
    starFadeEnd: 200_000_000,
  },
  weather: null,
  landable: false,
  soiRadius: 48_200_000_000,
  parentId: 'SUN',
  childIds: [],
  minOrbitAltitude: 200_000_000,
  destructionZone: 'extreme_pressure',
};

const SATURN: CelestialBodyDef = {
  id: 'SATURN',
  name: 'Saturn',
  surfaceGravity: 10.44,
  radius: 58_232_000,
  gm: 3.7931187e16,
  atmosphere: {
    seaLevelDensity: 0.687,
    scaleHeight: 59_500,
    topAltitude: 150_000_000,
    composition: 'H₂ (96%), He (3%)',
  },
  orbitalDistance: 1_433_500_000_000,
  orbitalPeriod: 929_596_608,
  biomes: [
    { id: 'SATURN_UPPER_CLOUD',  name: 'Upper Cloud Layer',   min: 0,                max: 40_000_000,     scienceMultiplier: 0,    color: 0xf0e0b0 },
    { id: 'SATURN_MID_ATMO',     name: 'Mid Atmosphere',      min: 40_000_000,       max: 80_000_000,     scienceMultiplier: 9.0,  color: 0xd4c490 },
    { id: 'SATURN_UPPER_ATMO',   name: 'Upper Atmosphere',    min: 80_000_000,       max: 150_000_000,    scienceMultiplier: 8.0,  color: 0xa89060 },
    { id: 'SATURN_LOW_ORBIT',    name: 'Low Saturn Orbit',    min: 150_000_000,      max: 400_000_000,    scienceMultiplier: 7.0,  color: 0x605030 },
    { id: 'SATURN_HIGH_ORBIT',   name: 'High Saturn Orbit',   min: 400_000_000,      max: Infinity,       scienceMultiplier: 6.0,  color: 0x302818 },
  ],
  altitudeBands: [
    { id: 'LSO', name: 'Low Saturn Orbit',    min: 150_000_000,     max: 400_000_000 },
    { id: 'MSO', name: 'Medium Saturn Orbit',  min: 400_000_000,     max: 1_500_000_000 },
    { id: 'HSO', name: 'High Saturn Orbit',   min: 1_500_000_000,   max: 8_000_000_000 },
  ],
  groundVisual: { color: 0xf0e0b0, description: 'Pale gold ammonia clouds with prominent ring system' },
  skyVisual: {
    seaLevelColor: 0xf0e0b0,
    highAltColor: 0xa89060,
    spaceColor: 0x000005,
    starFadeStart: 80_000_000,
    starFadeEnd: 150_000_000,
  },
  weather: null,
  landable: false,
  soiRadius: 54_800_000_000,
  parentId: 'SUN',
  childIds: ['TITAN'],
  minOrbitAltitude: 150_000_000,
  destructionZone: 'extreme_pressure',
};

const TITAN: CelestialBodyDef = {
  id: 'TITAN',
  name: 'Titan',
  surfaceGravity: 1.352,
  radius: 2_574_700,
  gm: 8.9781e12,
  atmosphere: {
    seaLevelDensity: 5.3,
    scaleHeight: 21_000,
    topAltitude: 600_000,
    composition: 'N₂ (94.2%), CH₄ (5.7%)',
  },
  orbitalDistance: 1_221_870_000,
  orbitalPeriod: 1_377_648,
  biomes: [
    { id: 'TITAN_SURFACE',      name: 'Titan Surface',       min: 0,         max: 100,       scienceMultiplier: 6.0, color: 0xcc9944 },
    { id: 'TITAN_LOW_ATMO',     name: 'Low Atmosphere',      min: 100,       max: 20_000,    scienceMultiplier: 5.5, color: 0xbb8833 },
    { id: 'TITAN_MID_ATMO',     name: 'Mid Atmosphere',      min: 20_000,    max: 100_000,   scienceMultiplier: 5.0, color: 0x997722 },
    { id: 'TITAN_UPPER_ATMO',   name: 'Upper Atmosphere',    min: 100_000,   max: 300_000,   scienceMultiplier: 5.5, color: 0x776611 },
    { id: 'TITAN_EXOSPHERE',    name: 'Exosphere',           min: 300_000,   max: 600_000,   scienceMultiplier: 6.0, color: 0x554400 },
    { id: 'TITAN_LOW_ORBIT',    name: 'Low Titan Orbit',     min: 600_000,   max: 2_000_000, scienceMultiplier: 7.0, color: 0x332200 },
    { id: 'TITAN_HIGH_ORBIT',   name: 'High Titan Orbit',    min: 2_000_000, max: Infinity,  scienceMultiplier: 8.0, color: 0x221100 },
  ],
  altitudeBands: [
    { id: 'LTO', name: 'Low Titan Orbit',    min: 200_000,    max: 500_000 },
    { id: 'MTO', name: 'Medium Titan Orbit',  min: 500_000,    max: 2_000_000 },
    { id: 'HTO', name: 'High Titan Orbit',   min: 2_000_000,  max: 10_000_000 },
  ],
  groundVisual: { color: 0xcc9944, description: 'Orange hydrocarbon dunes and methane lakes' },
  skyVisual: {
    seaLevelColor: 0xcc9944,
    highAltColor: 0x776611,
    spaceColor: 0x000005,
    starFadeStart: 300_000,
    starFadeEnd: 600_000,
  },
  weather: 'methane_rain',
  landable: true,
  soiRadius: 44_000_000,
  parentId: 'SATURN',
  childIds: [],
  minOrbitAltitude: 200_000,
  destructionZone: null,
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Complete catalog of all celestial bodies, keyed by body ID. */
export const CELESTIAL_BODIES: Readonly<Record<string, Readonly<CelestialBodyDef>>> = Object.freeze({
  SUN: Object.freeze(SUN),
  MERCURY: Object.freeze(MERCURY),
  VENUS: Object.freeze(VENUS),
  EARTH: Object.freeze(EARTH),
  MOON: Object.freeze(MOON),
  MARS: Object.freeze(MARS),
  PHOBOS: Object.freeze(PHOBOS),
  DEIMOS: Object.freeze(DEIMOS),
  CERES: Object.freeze(CERES),
  JUPITER: Object.freeze(JUPITER),
  SATURN: Object.freeze(SATURN),
  TITAN: Object.freeze(TITAN),
});

/** Ordered list of all body IDs for iteration. */
export const ALL_BODY_IDS: readonly string[] = Object.freeze(Object.keys(CELESTIAL_BODIES));

/** Get a celestial body definition by ID. */
export function getBodyDef(bodyId: string): CelestialBodyDef | undefined {
  return CELESTIAL_BODIES[bodyId];
}

/** Get the atmosphere profile for a body, or null if airless. */
export function getBodyAtmosphere(bodyId: string): AtmosphereProfile | null {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.atmosphere : null;
}

/**
 * Get air density at a given altitude for any body.
 * Uses the body's atmosphere profile (exponential model).
 * Returns 0 for airless bodies or altitudes above the atmosphere top.
 */
export function getAirDensity(altitude: number, bodyId: string): number {
  const body = CELESTIAL_BODIES[bodyId];
  if (!body || !body.atmosphere) return 0;

  const atmo = body.atmosphere;
  if (altitude >= atmo.topAltitude) return 0;
  const clamped = Math.max(0, altitude);
  return atmo.seaLevelDensity * Math.exp(-clamped / atmo.scaleHeight);
}

/** Get the atmosphere top altitude for a body. Returns 0 for airless bodies. */
export function getAtmosphereTop(bodyId: string): number {
  const body = CELESTIAL_BODIES[bodyId];
  if (!body || !body.atmosphere) return 0;
  return body.atmosphere.topAltitude;
}

/** Check if a body has an atmosphere. */
export function hasAtmosphere(bodyId: string): boolean {
  const body = CELESTIAL_BODIES[bodyId];
  return !!(body && body.atmosphere);
}

/** Get the surface gravity for a body. */
export function getSurfaceGravity(bodyId: string): number {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.surfaceGravity : 9.81;
}

/** Get the sky visual parameters for a body. */
export function getSkyVisual(bodyId: string): SkyVisual | null {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.skyVisual : null;
}

/** Get the ground visual parameters for a body. */
export function getGroundVisual(bodyId: string): GroundVisual | null {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.groundVisual : null;
}

/** Check if a body is landable (safe for craft to touch down). */
export function isLandable(bodyId: string): boolean {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.landable : false;
}

/** Check if a body has a destruction zone (e.g., Sun's extreme heat). */
export function getDestructionZone(bodyId: string): string | null {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.destructionZone : null;
}

/**
 * Get the full body hierarchy as parent → children mapping.
 * Useful for tree traversal and SOI nesting.
 */
export function getBodyHierarchy(): Record<string, string[]> {
  const hierarchy: Record<string, string[]> = {};
  for (const [id, body] of Object.entries(CELESTIAL_BODIES)) {
    hierarchy[id] = [...body.childIds];
  }
  return hierarchy;
}

/**
 * Find the path from one body to another through the hierarchy.
 * Returns an array of body IDs representing the route, or empty array
 * if no path exists.
 */
export function findBodyPath(fromId: string, toId: string): string[] {
  if (fromId === toId) return [fromId];

  // Build ancestry chains to root (Sun).
  const fromChain = _ancestryChain(fromId);
  const toChain = _ancestryChain(toId);

  // Find lowest common ancestor.
  const fromSet = new Set(fromChain);
  let lca: string | null = null;
  for (const id of toChain) {
    if (fromSet.has(id)) {
      lca = id;
      break;
    }
  }
  if (!lca) return [];

  // Build path: fromId → ... → LCA → ... → toId.
  const upPath: string[] = [];
  for (const id of fromChain) {
    upPath.push(id);
    if (id === lca) break;
  }
  const downPath: string[] = [];
  for (const id of toChain) {
    if (id === lca) break;
    downPath.push(id);
  }
  downPath.reverse();

  return [...upPath, ...downPath];
}

/** Build ancestry chain from body to root (Sun). */
function _ancestryChain(bodyId: string): string[] {
  const chain: string[] = [];
  let current: string | null = bodyId;
  while (current) {
    chain.push(current);
    const body: Readonly<CelestialBodyDef> | undefined = CELESTIAL_BODIES[current];
    current = body ? body.parentId : null;
  }
  return chain;
}

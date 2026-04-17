/**
 * constants/bodies.ts — Celestial body, altitude-band, biome, surface-op, and
 * life-support constants.
 *
 * Extracted from the omnibus `constants.ts` per iteration-19 §9. Self-contained:
 * no cross-references into other constants sub-modules.
 */

// ---------------------------------------------------------------------------
// Celestial Bodies & Orbital Mechanics
// ---------------------------------------------------------------------------

/**
 * Known celestial bodies.
 */
export const CelestialBody = Object.freeze({
  SUN: 'SUN',
  MERCURY: 'MERCURY',
  VENUS: 'VENUS',
  EARTH: 'EARTH',
  MOON: 'MOON',
  MARS: 'MARS',
  PHOBOS: 'PHOBOS',
  DEIMOS: 'DEIMOS',
  CERES: 'CERES',
  JUPITER: 'JUPITER',
  SATURN: 'SATURN',
  TITAN: 'TITAN',
} as const);

export type CelestialBody = (typeof CelestialBody)[keyof typeof CelestialBody];

// ---------------------------------------------------------------------------
// Asteroid Belt Zones
// ---------------------------------------------------------------------------

/**
 * Concentric orbital zones in the asteroid belt around the Sun,
 * beyond Mars (~1.52 AU). Used to tag Sun altitude bands.
 */
export const BeltZone = Object.freeze({
  /** Outer Belt A (2.2–2.5 AU) — safe orbit zone. */
  OUTER_A: 'OUTER_A',
  /** Dense Belt (2.5–2.8 AU) — high debris density, unsafe orbit zone. */
  DENSE: 'DENSE',
  /** Outer Belt B (2.8–3.2 AU) — safe orbit zone. */
  OUTER_B: 'OUTER_B',
} as const);

export type BeltZone = (typeof BeltZone)[keyof typeof BeltZone];

/**
 * Gravitational parameters (GM) in m^3/s^2 for each body.
 * mu = G * M, used in Keplerian orbit calculations.
 */
export const BODY_GM: Readonly<Record<string, number>> = Object.freeze({
  SUN: 1.32712440018e20,
  MERCURY: 2.2032e13,
  VENUS: 3.24859e14,
  EARTH: 3.986004418e14,
  MOON: 4.9048695e12,
  MARS: 4.282837e13,
  PHOBOS: 7.112e5,
  DEIMOS: 9.8e4,
  CERES: 6.263e10,
  JUPITER: 1.26686534e17,
  SATURN: 3.7931187e16,
  TITAN: 8.9781e12,
});

/**
 * Mean radius in metres for each body.
 */
export const BODY_RADIUS: Readonly<Record<string, number>> = Object.freeze({
  SUN: 695_700_000,
  MERCURY: 2_439_700,
  VENUS: 6_051_800,
  EARTH: 6_371_000,
  MOON: 1_737_400,
  MARS: 3_389_500,
  PHOBOS: 11_267,
  DEIMOS: 6_200,
  CERES: 473_000,
  JUPITER: 69_911_000,
  SATURN: 58_232_000,
  TITAN: 2_574_700,
});

/**
 * Minimum stable orbit altitude per celestial body (metres above the surface).
 * Below this altitude, atmospheric drag (or surface proximity for airless bodies)
 * prevents a stable orbit.  Used by orbit entry detection.
 */
export const MIN_ORBIT_ALTITUDE: Readonly<Record<string, number>> = Object.freeze({
  SUN: 2_000_000_000,
  MERCURY: 20_000,
  VENUS: 250_000,
  EARTH: 70_000,
  MOON: 15_000,
  MARS: 80_000,
  PHOBOS: 1_000,
  DEIMOS: 500,
  CERES: 5_000,
  JUPITER: 200_000_000,
  SATURN: 150_000_000,
  TITAN: 200_000,
});

/**
 * Altitude band definition for a celestial body.
 */
export interface AltitudeBand {
  readonly id: string;
  readonly name: string;
  readonly min: number;
  readonly max: number;
  /** Asteroid belt zone tag, if this band falls within the belt. */
  readonly beltZone?: BeltZone;
  /** Whether orbiting in this band is unsafe (e.g., high debris density). */
  readonly unsafe?: boolean;
}

/**
 * Altitude bands per celestial body.
 * Each band defines a range of altitudes (metres above the surface).
 * Objects in the same band can interact via proximity detection.
 */
export const ALTITUDE_BANDS: Readonly<Record<string, readonly AltitudeBand[]>> = Object.freeze({
  SUN: Object.freeze([
    Object.freeze({ id: 'INNER_CORONA', name: 'Inner Corona',   min: 500_000_000,     max: 2_000_000_000 }),
    Object.freeze({ id: 'OUTER_CORONA', name: 'Outer Corona',   min: 2_000_000_000,   max: 10_000_000_000 }),
    Object.freeze({ id: 'NSS',          name: 'Near Sun Space',  min: 10_000_000_000,  max: 30_000_000_000 }),
    Object.freeze({ id: 'SOL',          name: 'Solar Orbit',     min: 30_000_000_000,  max: 329_000_000_000 }),
    Object.freeze({ id: 'BELT_OUTER_A', name: 'Outer Belt A',   min: 329_000_000_000, max: 374_000_000_000, beltZone: BeltZone.OUTER_A as BeltZone }),
    Object.freeze({ id: 'BELT_DENSE',   name: 'Dense Belt',     min: 374_000_000_000, max: 419_000_000_000, beltZone: BeltZone.DENSE as BeltZone, unsafe: true }),
    Object.freeze({ id: 'BELT_OUTER_B', name: 'Outer Belt B',   min: 419_000_000_000, max: 479_000_000_000, beltZone: BeltZone.OUTER_B as BeltZone }),
  ]),
  MERCURY: Object.freeze([
    Object.freeze({ id: 'LMeO', name: 'Low Mercury Orbit', min: 20_000, max: 200_000 }),
    Object.freeze({ id: 'MMeO', name: 'Medium Mercury Orbit', min: 200_000, max: 1_000_000 }),
    Object.freeze({ id: 'HMeO', name: 'High Mercury Orbit', min: 1_000_000, max: 5_000_000 }),
  ]),
  VENUS: Object.freeze([
    Object.freeze({ id: 'LVO', name: 'Low Venus Orbit', min: 250_000, max: 500_000 }),
    Object.freeze({ id: 'MVO', name: 'Medium Venus Orbit', min: 500_000, max: 2_000_000 }),
    Object.freeze({ id: 'HVO', name: 'High Venus Orbit', min: 2_000_000, max: 10_000_000 }),
  ]),
  EARTH: Object.freeze([
    Object.freeze({ id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 }),
    Object.freeze({ id: 'MEO', name: 'Medium Earth Orbit', min: 200_000, max: 2_000_000 }),
    Object.freeze({ id: 'HEO', name: 'High Earth Orbit', min: 2_000_000, max: 35_786_000 }),
  ]),
  MOON: Object.freeze([
    Object.freeze({ id: 'LLO', name: 'Low Lunar Orbit', min: 15_000, max: 100_000 }),
    Object.freeze({ id: 'MLO', name: 'Medium Lunar Orbit', min: 100_000, max: 1_000_000 }),
    Object.freeze({ id: 'HLO', name: 'High Lunar Orbit', min: 1_000_000, max: 10_000_000 }),
  ]),
  MARS: Object.freeze([
    Object.freeze({ id: 'LMO', name: 'Low Mars Orbit', min: 80_000, max: 300_000 }),
    Object.freeze({ id: 'MMO', name: 'Medium Mars Orbit', min: 300_000, max: 2_000_000 }),
    Object.freeze({ id: 'HMO', name: 'High Mars Orbit', min: 2_000_000, max: 20_000_000 }),
  ]),
  PHOBOS: Object.freeze([
    Object.freeze({ id: 'LPO', name: 'Low Phobos Orbit', min: 1_000, max: 5_000 }),
    Object.freeze({ id: 'HPO', name: 'High Phobos Orbit', min: 5_000, max: 20_000 }),
  ]),
  DEIMOS: Object.freeze([
    Object.freeze({ id: 'LDO', name: 'Low Deimos Orbit', min: 500, max: 3_000 }),
    Object.freeze({ id: 'HDO', name: 'High Deimos Orbit', min: 3_000, max: 10_000 }),
  ]),
  CERES: Object.freeze([
    Object.freeze({ id: 'LCO', name: 'Low Ceres Orbit', min: 5_000, max: 50_000 }),
    Object.freeze({ id: 'HCO', name: 'High Ceres Orbit', min: 50_000, max: 200_000 }),
  ]),
  JUPITER: Object.freeze([
    Object.freeze({ id: 'LJO', name: 'Low Jupiter Orbit', min: 200_000_000, max: 500_000_000 }),
    Object.freeze({ id: 'MJO', name: 'Medium Jupiter Orbit', min: 500_000_000, max: 2_000_000_000 }),
    Object.freeze({ id: 'HJO', name: 'High Jupiter Orbit', min: 2_000_000_000, max: 10_000_000_000 }),
  ]),
  SATURN: Object.freeze([
    Object.freeze({ id: 'LSO', name: 'Low Saturn Orbit', min: 150_000_000, max: 400_000_000 }),
    Object.freeze({ id: 'MSO', name: 'Medium Saturn Orbit', min: 400_000_000, max: 1_500_000_000 }),
    Object.freeze({ id: 'HSO', name: 'High Saturn Orbit', min: 1_500_000_000, max: 8_000_000_000 }),
  ]),
  TITAN: Object.freeze([
    Object.freeze({ id: 'LTO', name: 'Low Titan Orbit', min: 200_000, max: 500_000 }),
    Object.freeze({ id: 'MTO', name: 'Medium Titan Orbit', min: 500_000, max: 2_000_000 }),
    Object.freeze({ id: 'HTO', name: 'High Titan Orbit', min: 2_000_000, max: 10_000_000 }),
  ]),
});

// ---------------------------------------------------------------------------
// Altitude Biomes
// ---------------------------------------------------------------------------

/**
 * Named altitude biome definition per celestial body.
 */
export interface BiomeDefinition {
  readonly id: string;
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly scienceMultiplier: number;
  readonly color: number;
}

/**
 * Named altitude biomes per celestial body.  Each biome defines:
 *   - id:              Machine-readable identifier.
 *   - name:            Human-readable display name.
 *   - min / max:       Altitude range in metres (surface-relative).
 *   - scienceMultiplier: Multiplier applied to science experiment value when
 *                        collected in this biome.
 *   - color:           Tint hint used by the flight renderer for label colouring.
 *
 * Biome boundaries are used for label fade-in/out and for the orbital science
 * system (elliptical orbits sweeping through multiple biomes).
 */
export const BIOME_DEFINITIONS: Readonly<Record<string, readonly BiomeDefinition[]>> = Object.freeze({
  SUN: Object.freeze([
    Object.freeze({ id: 'SUN_INFERNO',         name: 'Solar Inferno',        min: 0,               max: 500_000_000,     scienceMultiplier: 0,    color: 0xffffff }),
    Object.freeze({ id: 'SUN_INNER_CORONA',    name: 'Inner Corona',         min: 500_000_000,     max: 2_000_000_000,   scienceMultiplier: 12.0, color: 0xffee44 }),
    Object.freeze({ id: 'SUN_OUTER_CORONA',    name: 'Outer Corona',         min: 2_000_000_000,   max: 10_000_000_000,  scienceMultiplier: 8.0,  color: 0xffaa22 }),
    Object.freeze({ id: 'SUN_NEAR_SPACE',      name: 'Near Sun Space',       min: 10_000_000_000,  max: 30_000_000_000,  scienceMultiplier: 5.0,  color: 0xff8800 }),
    Object.freeze({ id: 'SUN_SOLAR_ORBIT',     name: 'Solar Orbit',          min: 30_000_000_000,  max: Infinity,        scienceMultiplier: 3.0,  color: 0x332200 }),
  ]),
  MERCURY: Object.freeze([
    Object.freeze({ id: 'MERCURY_SURFACE',     name: 'Mercury Surface',      min: 0,       max: 100,       scienceMultiplier: 2.0,  color: 0x8a8a8a }),
    Object.freeze({ id: 'MERCURY_NEAR',        name: 'Near Surface',         min: 100,     max: 5_000,     scienceMultiplier: 2.5,  color: 0x707070 }),
    Object.freeze({ id: 'MERCURY_LOW_ALT',     name: 'Low Altitude',         min: 5_000,   max: 20_000,    scienceMultiplier: 3.0,  color: 0x505060 }),
    Object.freeze({ id: 'MERCURY_LOW_ORBIT',   name: 'Low Mercury Orbit',    min: 20_000,  max: 200_000,   scienceMultiplier: 3.5,  color: 0x303040 }),
    Object.freeze({ id: 'MERCURY_HIGH_ORBIT',  name: 'High Mercury Orbit',   min: 200_000, max: Infinity,  scienceMultiplier: 4.0,  color: 0x101020 }),
  ]),
  VENUS: Object.freeze([
    Object.freeze({ id: 'VENUS_SURFACE',       name: 'Venus Surface',        min: 0,       max: 100,       scienceMultiplier: 3.0,  color: 0xd4a04a }),
    Object.freeze({ id: 'VENUS_LOW_ATMO',      name: 'Low Atmosphere',       min: 100,     max: 10_000,    scienceMultiplier: 2.5,  color: 0xcc9944 }),
    Object.freeze({ id: 'VENUS_MID_ATMO',      name: 'Mid Atmosphere',       min: 10_000,  max: 50_000,    scienceMultiplier: 2.0,  color: 0xbb8833 }),
    Object.freeze({ id: 'VENUS_UPPER_ATMO',    name: 'Upper Atmosphere',     min: 50_000,  max: 150_000,   scienceMultiplier: 2.5,  color: 0x886622 }),
    Object.freeze({ id: 'VENUS_EXOSPHERE',     name: 'Exosphere',            min: 150_000, max: 250_000,   scienceMultiplier: 3.0,  color: 0x443311 }),
    Object.freeze({ id: 'VENUS_LOW_ORBIT',     name: 'Low Venus Orbit',      min: 250_000, max: 500_000,   scienceMultiplier: 3.5,  color: 0x202020 }),
    Object.freeze({ id: 'VENUS_HIGH_ORBIT',    name: 'High Venus Orbit',     min: 500_000, max: Infinity,  scienceMultiplier: 4.0,  color: 0x101010 }),
  ]),
  EARTH: Object.freeze([
    Object.freeze({ id: 'GROUND',           name: 'Ground',           min: 0,       max: 100,       scienceMultiplier: 0.5, color: 0xc4a882 }),
    Object.freeze({ id: 'LOW_ATMOSPHERE',    name: 'Low Atmosphere',   min: 100,     max: 2_000,     scienceMultiplier: 1.0, color: 0x87ceeb }),
    Object.freeze({ id: 'MID_ATMOSPHERE',    name: 'Mid Atmosphere',   min: 2_000,   max: 10_000,    scienceMultiplier: 1.2, color: 0x6aadce }),
    Object.freeze({ id: 'UPPER_ATMOSPHERE',  name: 'Upper Atmosphere', min: 10_000,  max: 40_000,    scienceMultiplier: 1.5, color: 0x3a6a9e }),
    Object.freeze({ id: 'MESOSPHERE',        name: 'Mesosphere',       min: 40_000,  max: 70_000,    scienceMultiplier: 2.0, color: 0x1a1a4e }),
    Object.freeze({ id: 'NEAR_SPACE',        name: 'Near Space',       min: 70_000,  max: 100_000,   scienceMultiplier: 2.5, color: 0x0a0a2e }),
    Object.freeze({ id: 'LOW_ORBIT',         name: 'Low Orbit',        min: 100_000, max: 200_000,   scienceMultiplier: 3.0, color: 0x050520 }),
    Object.freeze({ id: 'HIGH_ORBIT',        name: 'High Orbit',       min: 200_000, max: Infinity,  scienceMultiplier: 4.0, color: 0x000010 }),
  ]),
  MOON: Object.freeze([
    Object.freeze({ id: 'LUNAR_SURFACE',    name: 'Lunar Surface',     min: 0,       max: 100,       scienceMultiplier: 1.0, color: 0xa0a0a0 }),
    Object.freeze({ id: 'NEAR_SURFACE',     name: 'Near Surface',      min: 100,     max: 5_000,     scienceMultiplier: 1.5, color: 0x808080 }),
    Object.freeze({ id: 'LOW_ALTITUDE',     name: 'Low Altitude',      min: 5_000,   max: 15_000,    scienceMultiplier: 2.0, color: 0x404060 }),
    Object.freeze({ id: 'LOW_LUNAR_ORBIT',  name: 'Low Lunar Orbit',   min: 15_000,  max: 100_000,   scienceMultiplier: 3.0, color: 0x202040 }),
    Object.freeze({ id: 'HIGH_LUNAR_ORBIT', name: 'High Lunar Orbit',  min: 100_000, max: Infinity,  scienceMultiplier: 4.0, color: 0x101020 }),
  ]),
  MARS: Object.freeze([
    Object.freeze({ id: 'MARS_SURFACE',       name: 'Mars Surface',        min: 0,       max: 100,       scienceMultiplier: 2.0,  color: 0xc1440e }),
    Object.freeze({ id: 'MARS_LOW_ATMO',      name: 'Low Atmosphere',      min: 100,     max: 5_000,     scienceMultiplier: 2.5,  color: 0xb0550e }),
    Object.freeze({ id: 'MARS_MID_ATMO',      name: 'Mid Atmosphere',      min: 5_000,   max: 20_000,    scienceMultiplier: 2.8,  color: 0x8a3a0a }),
    Object.freeze({ id: 'MARS_UPPER_ATMO',    name: 'Upper Atmosphere',    min: 20_000,  max: 50_000,    scienceMultiplier: 3.0,  color: 0x5a2208 }),
    Object.freeze({ id: 'MARS_EXOSPHERE',     name: 'Exosphere',           min: 50_000,  max: 80_000,    scienceMultiplier: 3.5,  color: 0x2a1104 }),
    Object.freeze({ id: 'MARS_LOW_ORBIT',     name: 'Low Mars Orbit',      min: 80_000,  max: 300_000,   scienceMultiplier: 4.0,  color: 0x150808 }),
    Object.freeze({ id: 'MARS_HIGH_ORBIT',    name: 'High Mars Orbit',     min: 300_000, max: Infinity,  scienceMultiplier: 5.0,  color: 0x0a0404 }),
  ]),
  PHOBOS: Object.freeze([
    Object.freeze({ id: 'PHOBOS_SURFACE',     name: 'Phobos Surface',      min: 0,      max: 50,        scienceMultiplier: 3.0, color: 0x6a6a60 }),
    Object.freeze({ id: 'PHOBOS_NEAR',        name: 'Near Phobos',         min: 50,     max: 1_000,     scienceMultiplier: 3.5, color: 0x505050 }),
    Object.freeze({ id: 'PHOBOS_ORBIT',       name: 'Phobos Orbit',        min: 1_000,  max: Infinity,  scienceMultiplier: 4.0, color: 0x303030 }),
  ]),
  DEIMOS: Object.freeze([
    Object.freeze({ id: 'DEIMOS_SURFACE',     name: 'Deimos Surface',      min: 0,      max: 50,        scienceMultiplier: 3.0, color: 0x7a7a70 }),
    Object.freeze({ id: 'DEIMOS_NEAR',        name: 'Near Deimos',         min: 50,     max: 1_000,     scienceMultiplier: 3.5, color: 0x606060 }),
    Object.freeze({ id: 'DEIMOS_ORBIT',       name: 'Deimos Orbit',        min: 1_000,  max: Infinity,  scienceMultiplier: 4.0, color: 0x404040 }),
  ]),
  CERES: Object.freeze([
    Object.freeze({ id: 'CERES_SURFACE',     name: 'Ceres Surface',      min: 0,       max: 100,       scienceMultiplier: 4.0, color: 0x9a9a90 }),
    Object.freeze({ id: 'CERES_NEAR',        name: 'Near Surface',        min: 100,     max: 2_000,     scienceMultiplier: 4.5, color: 0x808078 }),
    Object.freeze({ id: 'CERES_LOW_ALT',     name: 'Low Altitude',        min: 2_000,   max: 10_000,    scienceMultiplier: 5.0, color: 0x606058 }),
    Object.freeze({ id: 'CERES_LOW_ORBIT',   name: 'Low Ceres Orbit',     min: 10_000,  max: 100_000,   scienceMultiplier: 5.5, color: 0x404038 }),
    Object.freeze({ id: 'CERES_HIGH_ORBIT',  name: 'High Ceres Orbit',    min: 100_000, max: Infinity,  scienceMultiplier: 6.0, color: 0x202018 }),
  ]),
  JUPITER: Object.freeze([
    Object.freeze({ id: 'JUPITER_UPPER_CLOUD', name: 'Upper Cloud Layer',   min: 0,                max: 50_000_000,     scienceMultiplier: 0,    color: 0xe8d8a8 }),
    Object.freeze({ id: 'JUPITER_MID_ATMO',    name: 'Mid Atmosphere',      min: 50_000_000,       max: 100_000_000,    scienceMultiplier: 8.0,  color: 0xc4a868 }),
    Object.freeze({ id: 'JUPITER_UPPER_ATMO',  name: 'Upper Atmosphere',    min: 100_000_000,      max: 200_000_000,    scienceMultiplier: 7.0,  color: 0x8a7848 }),
    Object.freeze({ id: 'JUPITER_LOW_ORBIT',   name: 'Low Jupiter Orbit',   min: 200_000_000,      max: 500_000_000,    scienceMultiplier: 6.0,  color: 0x504828 }),
    Object.freeze({ id: 'JUPITER_HIGH_ORBIT',  name: 'High Jupiter Orbit',  min: 500_000_000,      max: Infinity,       scienceMultiplier: 5.0,  color: 0x282418 }),
  ]),
  SATURN: Object.freeze([
    Object.freeze({ id: 'SATURN_UPPER_CLOUD',  name: 'Upper Cloud Layer',   min: 0,                max: 40_000_000,     scienceMultiplier: 0,    color: 0xf0e0b0 }),
    Object.freeze({ id: 'SATURN_MID_ATMO',     name: 'Mid Atmosphere',      min: 40_000_000,       max: 80_000_000,     scienceMultiplier: 9.0,  color: 0xd4c490 }),
    Object.freeze({ id: 'SATURN_UPPER_ATMO',   name: 'Upper Atmosphere',    min: 80_000_000,       max: 150_000_000,    scienceMultiplier: 8.0,  color: 0xa89060 }),
    Object.freeze({ id: 'SATURN_LOW_ORBIT',    name: 'Low Saturn Orbit',    min: 150_000_000,      max: 400_000_000,    scienceMultiplier: 7.0,  color: 0x605030 }),
    Object.freeze({ id: 'SATURN_HIGH_ORBIT',   name: 'High Saturn Orbit',   min: 400_000_000,      max: Infinity,       scienceMultiplier: 6.0,  color: 0x302818 }),
  ]),
  TITAN: Object.freeze([
    Object.freeze({ id: 'TITAN_SURFACE',      name: 'Titan Surface',       min: 0,         max: 100,       scienceMultiplier: 6.0, color: 0xcc9944 }),
    Object.freeze({ id: 'TITAN_LOW_ATMO',     name: 'Low Atmosphere',      min: 100,       max: 20_000,    scienceMultiplier: 5.5, color: 0xbb8833 }),
    Object.freeze({ id: 'TITAN_MID_ATMO',     name: 'Mid Atmosphere',      min: 20_000,    max: 100_000,   scienceMultiplier: 5.0, color: 0x997722 }),
    Object.freeze({ id: 'TITAN_UPPER_ATMO',   name: 'Upper Atmosphere',    min: 100_000,   max: 300_000,   scienceMultiplier: 5.5, color: 0x776611 }),
    Object.freeze({ id: 'TITAN_EXOSPHERE',    name: 'Exosphere',           min: 300_000,   max: 600_000,   scienceMultiplier: 6.0, color: 0x554400 }),
    Object.freeze({ id: 'TITAN_LOW_ORBIT',    name: 'Low Titan Orbit',     min: 600_000,   max: 2_000_000, scienceMultiplier: 7.0, color: 0x332200 }),
    Object.freeze({ id: 'TITAN_HIGH_ORBIT',   name: 'High Titan Orbit',    min: 2_000_000, max: Infinity,  scienceMultiplier: 8.0, color: 0x221100 }),
  ]),
});

// ---------------------------------------------------------------------------
// Surface Operations
// ---------------------------------------------------------------------------

/**
 * Types of items that can be deployed on a celestial body's surface.
 */
export const SurfaceItemType = Object.freeze({
  /** Ceremonial flag -- one per body, crewed only. */
  FLAG: 'FLAG',
  /** Surface sample container -- requires crewed module, must return to lab. */
  SURFACE_SAMPLE: 'SURFACE_SAMPLE',
  /** Deployed science instrument package -- requires science module with surface instrument. */
  SURFACE_INSTRUMENT: 'SURFACE_INSTRUMENT',
  /** Landing site beacon -- shows on map, allows returning to landing site. */
  BEACON: 'BEACON',
} as const);

export type SurfaceItemType = (typeof SurfaceItemType)[keyof typeof SurfaceItemType];

/** Cash bonus awarded for planting the first flag on a celestial body. */
export const FLAG_MILESTONE_BONUS: number = 100_000;

/** Reputation gained for planting the first flag on a body. */
export const FLAG_MILESTONE_REP: number = 5;

/** Science points awarded for collecting a surface sample (base, before biome multiplier). */
export const SURFACE_SAMPLE_BASE_SCIENCE: number = 15;

/** Science points per period generated by a deployed surface instrument. */
export const SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD: number = 3;

/** Number of GPS satellites required at a body for surface items to be visible on map. */
export const GPS_VISIBILITY_THRESHOLD: number = 1;

// ---------------------------------------------------------------------------
// Life Support System
// ---------------------------------------------------------------------------

/**
 * Default number of periods of life support provided by the command module.
 * Each period a crewed craft spends in the field (orbit or landed on a
 * non-Earth body) consumes one period of supply.
 */
export const DEFAULT_LIFE_SUPPORT_PERIODS: number = 5;

/**
 * Government fine charged per crew member who dies from life support
 * exhaustion (same as crash death fine).
 */
export const LIFE_SUPPORT_DEATH_FINE: number = 500_000;

/**
 * Supply level at which a critical warning is shown, giving the player
 * one last chance to launch a rescue mission.
 */
export const LIFE_SUPPORT_WARNING_THRESHOLD: number = 1;

/**
 * Status of a crewed vessel left in the field.
 */
export const FieldCraftStatus = Object.freeze({
  /** Vessel is in a stable orbit around a celestial body. */
  IN_ORBIT: 'IN_ORBIT',
  /** Vessel is safely landed on a non-Earth celestial body. */
  LANDED: 'LANDED',
} as const);

export type FieldCraftStatus = (typeof FieldCraftStatus)[keyof typeof FieldCraftStatus];

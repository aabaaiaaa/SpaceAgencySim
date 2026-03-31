/**
 * bodies.js — Celestial body definitions for the solar system.
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

// ---------------------------------------------------------------------------
// Atmosphere profile helper — returns null for airless bodies
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} AtmosphereProfile
 * @property {number} seaLevelDensity   Air density at surface (kg/m³).
 * @property {number} scaleHeight       Exponential scale height (m).
 * @property {number} topAltitude       Altitude above which density is zero (m).
 * @property {string} [composition]     Dominant gas(es) for flavour text.
 */

/**
 * @typedef {Object} SkyVisual
 * @property {number} seaLevelColor     Hex colour at ground level.
 * @property {number} highAltColor      Hex colour at upper atmosphere / space.
 * @property {number} spaceColor        Hex colour in vacuum.
 * @property {number} starFadeStart     Altitude (m) where stars begin to appear.
 * @property {number} starFadeEnd       Altitude (m) where stars are fully visible.
 */

/**
 * @typedef {Object} GroundVisual
 * @property {number} color             Primary surface colour (hex).
 * @property {string} description       Short flavour text for rendering hints.
 */

/**
 * @typedef {Object} BiomeDef
 * @property {string} id                Machine-readable identifier.
 * @property {string} name              Human-readable display name.
 * @property {number} min               Minimum altitude in metres (surface-relative).
 * @property {number} max               Maximum altitude in metres (Infinity for top).
 * @property {number} scienceMultiplier Multiplier applied to science experiment value.
 * @property {number} color             Tint colour (hex) for label rendering.
 */

/**
 * @typedef {Object} AltitudeBand
 * @property {string} id    Band identifier (e.g., 'LEO', 'LLO').
 * @property {string} name  Human-readable band name.
 * @property {number} min   Minimum altitude in metres.
 * @property {number} max   Maximum altitude in metres.
 */

/**
 * @typedef {Object} CelestialBodyDef
 * @property {string}               id              Unique body identifier (matches CelestialBody enum).
 * @property {string}               name            Human-readable name.
 * @property {number}               surfaceGravity  Surface gravitational acceleration (m/s²).
 * @property {number}               radius          Mean radius in metres.
 * @property {number}               gm              Gravitational parameter μ = G×M (m³/s²).
 * @property {AtmosphereProfile|null} atmosphere     Atmosphere profile or null if airless.
 * @property {number}               orbitalDistance  Mean distance from parent body (m). 0 for the Sun.
 * @property {number}               orbitalPeriod   Orbital period in seconds. 0 for the Sun.
 * @property {BiomeDef[]}           biomes          Altitude-based biome definitions.
 * @property {AltitudeBand[]}       altitudeBands   Orbital altitude band definitions.
 * @property {GroundVisual}         groundVisual    Ground/surface rendering hints.
 * @property {SkyVisual}            skyVisual       Sky gradient rendering hints.
 * @property {string|null}          weather         Weather type or null (e.g., 'dust_storms').
 * @property {boolean}              landable        Whether craft can land (false for Sun, gas giants).
 * @property {number}               soiRadius       Sphere of Influence radius from body centre (m).
 * @property {string|null}          parentId        Parent body ID or null for the Sun.
 * @property {string[]}             childIds        IDs of bodies orbiting this one.
 * @property {number}               minOrbitAltitude Minimum stable orbit altitude (m above surface).
 * @property {string|null}          destructionZone  Description of destruction hazard or null.
 */

// ---------------------------------------------------------------------------
// Body definitions
// ---------------------------------------------------------------------------

/** @type {CelestialBodyDef} */
const SUN = {
  id: 'SUN',
  name: 'Sun',
  surfaceGravity: 274,
  radius: 695_700_000,
  gm: 1.32712440018e20,
  atmosphere: null, // Plasma, not a conventional atmosphere
  orbitalDistance: 0,
  orbitalPeriod: 0,
  biomes: [
    { id: 'SOLAR_CORONA',        name: 'Solar Corona',         min: 0,           max: 2_000_000_000, scienceMultiplier: 10.0, color: 0xffdd44 },
    { id: 'NEAR_SUN',            name: 'Near Sun Space',       min: 2_000_000_000, max: Infinity,    scienceMultiplier: 6.0,  color: 0xff8800 },
  ],
  altitudeBands: [
    { id: 'INNER_CORONA', name: 'Inner Corona',  min: 0,               max: 2_000_000_000 },
    { id: 'OUTER_CORONA', name: 'Outer Corona',  min: 2_000_000_000,   max: 20_000_000_000 },
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
  soiRadius: Infinity, // Sun's SOI encompasses the entire solar system
  parentId: null,
  childIds: ['MERCURY', 'VENUS', 'EARTH', 'MARS'],
  minOrbitAltitude: 2_000_000_000, // Well above the corona
  destructionZone: 'extreme_heat', // Craft destroyed below corona altitude
};

/** @type {CelestialBodyDef} */
const MERCURY = {
  id: 'MERCURY',
  name: 'Mercury',
  surfaceGravity: 3.7,
  radius: 2_439_700,
  gm: 2.2032e13,
  atmosphere: null, // Essentially no atmosphere
  orbitalDistance: 57_909_000_000, // ~57.9 million km from Sun
  orbitalPeriod: 7_600_521, // ~87.97 days in seconds
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
    seaLevelColor: 0x000005, // No atmosphere — always black sky
    highAltColor: 0x000005,
    spaceColor: 0x000005,
    starFadeStart: 0,
    starFadeEnd: 0, // Stars always visible
  },
  weather: null,
  landable: true,
  soiRadius: 112_000_000, // ~112,000 km Hill sphere
  parentId: 'SUN',
  childIds: [],
  minOrbitAltitude: 20_000,
  destructionZone: null,
};

/** @type {CelestialBodyDef} */
const VENUS = {
  id: 'VENUS',
  name: 'Venus',
  surfaceGravity: 8.87,
  radius: 6_051_800,
  gm: 3.24859e14,
  atmosphere: {
    seaLevelDensity: 65.0, // ~65 kg/m³ — extremely dense CO₂ atmosphere
    scaleHeight: 15_900,
    topAltitude: 250_000,
    composition: 'CO₂ (96.5%), N₂ (3.5%)',
  },
  orbitalDistance: 108_208_000_000, // ~108.2 million km from Sun
  orbitalPeriod: 19_414_149, // ~224.7 days in seconds
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
    seaLevelColor: 0xd4a04a, // Thick orange haze
    highAltColor: 0x886622,
    spaceColor: 0x000005,
    starFadeStart: 150_000,
    starFadeEnd: 250_000,
  },
  weather: null,
  landable: true,
  soiRadius: 616_000_000, // ~616,000 km
  parentId: 'SUN',
  childIds: [],
  minOrbitAltitude: 250_000, // Above the dense atmosphere
  destructionZone: null,
};

/** @type {CelestialBodyDef} */
const EARTH = {
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
  orbitalDistance: 149_598_000_000, // ~149.6 million km from Sun (1 AU)
  orbitalPeriod: 31_557_600, // ~365.25 days in seconds
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

/** @type {CelestialBodyDef} */
const MOON = {
  id: 'MOON',
  name: 'Moon',
  surfaceGravity: 1.62,
  radius: 1_737_400,
  gm: 4.9048695e12,
  atmosphere: null, // No atmosphere
  orbitalDistance: 384_400_000, // ~384,400 km from Earth
  orbitalPeriod: 2_360_591, // ~27.32 days in seconds
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

/** @type {CelestialBodyDef} */
const MARS = {
  id: 'MARS',
  name: 'Mars',
  surfaceGravity: 3.72,
  radius: 3_389_500,
  gm: 4.282837e13,
  atmosphere: {
    seaLevelDensity: 0.020, // ~0.02 kg/m³ — very thin CO₂ atmosphere
    scaleHeight: 11_100,
    topAltitude: 80_000,
    composition: 'CO₂ (95%), N₂ (2.7%)',
  },
  orbitalDistance: 227_939_000_000, // ~228 million km from Sun
  orbitalPeriod: 59_354_294, // ~687 days in seconds
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
    seaLevelColor: 0xd4a574, // Butterscotch / salmon pink Martian sky
    highAltColor: 0x4a2a10,
    spaceColor: 0x000005,
    starFadeStart: 50_000,
    starFadeEnd: 80_000,
  },
  weather: 'dust_storms',
  landable: true,
  soiRadius: 577_000_000, // ~577,000 km
  parentId: 'SUN',
  childIds: ['PHOBOS', 'DEIMOS'],
  minOrbitAltitude: 80_000, // Above the thin atmosphere
  destructionZone: null,
};

/** @type {CelestialBodyDef} */
const PHOBOS = {
  id: 'PHOBOS',
  name: 'Phobos',
  surfaceGravity: 0.0057,
  radius: 11_267, // Mean radius (~11.267 km, irregular shape)
  gm: 7.112e5, // ~0.0007112 km³/s² → 711,200 m³/s²
  atmosphere: null,
  orbitalDistance: 9_376_000, // ~9,376 km from Mars centre
  orbitalPeriod: 27_554, // ~7.66 hours in seconds
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
  soiRadius: 170_000, // Very small SOI due to tiny mass and close to Mars
  parentId: 'MARS',
  childIds: [],
  minOrbitAltitude: 1_000,
  destructionZone: null,
};

/** @type {CelestialBodyDef} */
const DEIMOS = {
  id: 'DEIMOS',
  name: 'Deimos',
  surfaceGravity: 0.003,
  radius: 6_200, // Mean radius (~6.2 km, irregular shape)
  gm: 9.8e4, // ~0.000098 km³/s² → 98,000 m³/s²
  atmosphere: null,
  orbitalDistance: 23_463_000, // ~23,463 km from Mars centre
  orbitalPeriod: 109_075, // ~30.3 hours in seconds
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
  soiRadius: 500_000, // Very small SOI
  parentId: 'MARS',
  childIds: [],
  minOrbitAltitude: 500,
  destructionZone: null,
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Complete catalog of all celestial bodies, keyed by body ID.
 * @type {Readonly<Record<string, Readonly<CelestialBodyDef>>>}
 */
export const CELESTIAL_BODIES = Object.freeze({
  SUN: Object.freeze(SUN),
  MERCURY: Object.freeze(MERCURY),
  VENUS: Object.freeze(VENUS),
  EARTH: Object.freeze(EARTH),
  MOON: Object.freeze(MOON),
  MARS: Object.freeze(MARS),
  PHOBOS: Object.freeze(PHOBOS),
  DEIMOS: Object.freeze(DEIMOS),
});

/**
 * Ordered list of all body IDs for iteration.
 * @type {readonly string[]}
 */
export const ALL_BODY_IDS = Object.freeze(Object.keys(CELESTIAL_BODIES));

/**
 * Get a celestial body definition by ID.
 * @param {string} bodyId
 * @returns {CelestialBodyDef|undefined}
 */
export function getBodyDef(bodyId) {
  return CELESTIAL_BODIES[bodyId];
}

/**
 * Get the atmosphere profile for a body, or null if airless.
 * @param {string} bodyId
 * @returns {AtmosphereProfile|null}
 */
export function getBodyAtmosphere(bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.atmosphere : null;
}

/**
 * Get air density at a given altitude for any body.
 * Uses the body's atmosphere profile (exponential model).
 * Returns 0 for airless bodies or altitudes above the atmosphere top.
 *
 * @param {number} altitude  Metres above body surface.
 * @param {string} bodyId    Celestial body ID.
 * @returns {number} Air density in kg/m³.
 */
export function getAirDensity(altitude, bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  if (!body || !body.atmosphere) return 0;

  const atmo = body.atmosphere;
  if (altitude >= atmo.topAltitude) return 0;
  const clamped = Math.max(0, altitude);
  return atmo.seaLevelDensity * Math.exp(-clamped / atmo.scaleHeight);
}

/**
 * Get the atmosphere top altitude for a body. Returns 0 for airless bodies.
 * @param {string} bodyId
 * @returns {number}
 */
export function getAtmosphereTop(bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  if (!body || !body.atmosphere) return 0;
  return body.atmosphere.topAltitude;
}

/**
 * Check if a body has an atmosphere.
 * @param {string} bodyId
 * @returns {boolean}
 */
export function hasAtmosphere(bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  return !!(body && body.atmosphere);
}

/**
 * Get the surface gravity for a body.
 * @param {string} bodyId
 * @returns {number} Surface gravity in m/s², or 9.81 as fallback.
 */
export function getSurfaceGravity(bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.surfaceGravity : 9.81;
}

/**
 * Get the sky visual parameters for a body.
 * @param {string} bodyId
 * @returns {SkyVisual|null}
 */
export function getSkyVisual(bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.skyVisual : null;
}

/**
 * Get the ground visual parameters for a body.
 * @param {string} bodyId
 * @returns {GroundVisual|null}
 */
export function getGroundVisual(bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.groundVisual : null;
}

/**
 * Check if a body is landable (safe for craft to touch down).
 * @param {string} bodyId
 * @returns {boolean}
 */
export function isLandable(bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.landable : false;
}

/**
 * Check if a body has a destruction zone (e.g., Sun's extreme heat).
 * @param {string} bodyId
 * @returns {string|null} Destruction zone type or null.
 */
export function getDestructionZone(bodyId) {
  const body = CELESTIAL_BODIES[bodyId];
  return body ? body.destructionZone : null;
}

/**
 * Get the full body hierarchy as parent → children mapping.
 * Useful for tree traversal and SOI nesting.
 * @returns {Record<string, string[]>}
 */
export function getBodyHierarchy() {
  const hierarchy = {};
  for (const [id, body] of Object.entries(CELESTIAL_BODIES)) {
    hierarchy[id] = [...body.childIds];
  }
  return hierarchy;
}

/**
 * Find the path from one body to another through the hierarchy.
 * Returns an array of body IDs representing the route, or empty array
 * if no path exists.
 *
 * @param {string} fromId  Starting body ID.
 * @param {string} toId    Target body ID.
 * @returns {string[]}  Path of body IDs from start to target (inclusive).
 */
export function findBodyPath(fromId, toId) {
  if (fromId === toId) return [fromId];

  // Build ancestry chains to root (Sun).
  const fromChain = _ancestryChain(fromId);
  const toChain = _ancestryChain(toId);

  // Find lowest common ancestor.
  const fromSet = new Set(fromChain);
  let lca = null;
  for (const id of toChain) {
    if (fromSet.has(id)) {
      lca = id;
      break;
    }
  }
  if (!lca) return [];

  // Build path: fromId → ... → LCA → ... → toId.
  const upPath = [];
  for (const id of fromChain) {
    upPath.push(id);
    if (id === lca) break;
  }
  const downPath = [];
  for (const id of toChain) {
    if (id === lca) break;
    downPath.push(id);
  }
  downPath.reverse();

  return [...upPath, ...downPath];
}

/**
 * Build ancestry chain from body to root (Sun).
 * @param {string} bodyId
 * @returns {string[]}
 */
function _ancestryChain(bodyId) {
  const chain = [];
  let current = bodyId;
  while (current) {
    chain.push(current);
    const body = CELESTIAL_BODIES[current];
    current = body ? body.parentId : null;
  }
  return chain;
}

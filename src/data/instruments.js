/**
 * instruments.js — Science instrument definition catalog.
 *
 * Instruments are loaded into science module containers in the VAB.
 * Each science module has a limited number of instrument slots; the player
 * chooses which instruments to install before flight.
 *
 * During flight, each loaded instrument can be individually activated
 * (via staging or the part context menu) to run a timed experiment.
 * On completion the instrument produces either a SAMPLE or ANALYSIS result.
 *
 * DATA TYPES
 * ==========
 *   SAMPLE   — Physical sample that must be returned to the ground for full
 *              yield.  Cannot be transmitted.
 *   ANALYSIS — Telemetry / data that can be transmitted from orbit at reduced
 *              yield (40–60 %), or physically returned for full yield.
 *
 * YIELD FORMULA
 * =============
 *   finalYield = baseYield × biomeMultiplier × scienceSkillBonus × diminishingReturn
 *
 *   diminishingReturn:
 *     1st collection in this (instrument, biome) pair → 100 %
 *     2nd                                             →  25 %
 *     3rd                                             →  10 %
 *     4th+                                            →   0 %
 *
 * BIOME VALIDITY
 * ==============
 * Each instrument defines `validBiomes` — the altitude biome IDs where the
 * instrument produces meaningful data.  Activating an instrument outside its
 * valid biomes is blocked (the experiment will not start).
 *
 * TECH TIERS
 * ==========
 * Each instrument has a `techTier` that determines when it becomes available:
 *   0 — starter (available from game start)
 *   1 — Tech Tier 1 (requires basic research)
 *   2 — Tech Tier 2 (requires intermediate research)
 *   3 — Tech Tier 3 (requires advanced research)
 *
 * ADDING INSTRUMENTS
 * ==================
 * Append a plain-object entry to the INSTRUMENTS array.  No other files
 * need to change for new instruments — the science module system discovers
 * instruments by ID from this catalog.
 *
 * @module data/instruments
 */

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * Complete definition for a single science instrument.
 *
 * @typedef {Object} InstrumentDef
 * @property {string}   id                  Stable unique identifier.
 * @property {string}   name                Human-readable display name.
 * @property {string}   description         Short description shown in the VAB.
 * @property {string}   dataType            'SAMPLE' or 'ANALYSIS'.
 * @property {number}   baseYield           Base science points produced on completion.
 * @property {number}   experimentDuration  Seconds the experiment takes to run.
 * @property {number}   mass                Mass in kilograms added to the module.
 * @property {number}   cost                Purchase price in dollars.
 * @property {string[]} validBiomes         Biome IDs where the instrument produces data.
 * @property {number}   techTier            Tech tree tier required (0 = starter).
 */

// ---------------------------------------------------------------------------
// Instrument Catalog
// ---------------------------------------------------------------------------

/**
 * Authoritative list of every science instrument in the game.
 *
 * @type {InstrumentDef[]}
 */
export const INSTRUMENTS = [

  // ── Starter instruments (Tech Tier 0) ───────────────────────────────────

  /**
   * Thermometer Mk1 — basic temperature sensor.
   * Cheap, light, and fast.  Works near the surface and in the low
   * atmosphere — ideal for first sub-orbital flights.
   */
  {
    id: 'thermometer-mk1',
    name: 'Thermometer Mk1',
    description: 'Measures ambient temperature at the current altitude. Cheap and quick — ideal for first flights. Works on the ground and in the low atmosphere.',
    dataType: 'ANALYSIS',
    baseYield: 5,
    experimentDuration: 10,
    mass: 50,
    cost: 2_000,
    validBiomes: ['GROUND', 'LOW_ATMOSPHERE'],
    techTier: 0,
  },

  // ── Tech Tier 1 ─────────────────────────────────────────────────────────

  /**
   * Barometer — atmospheric pressure recorder.
   * Requires some altitude to produce useful data; best in the mid and
   * upper atmosphere where pressure gradients are scientifically rich.
   */
  {
    id: 'barometer',
    name: 'Barometer',
    description: 'Records atmospheric pressure profiles. Produces meaningful data in the mid and upper atmosphere where pressure gradients are strongest.',
    dataType: 'ANALYSIS',
    baseYield: 10,
    experimentDuration: 15,
    mass: 80,
    cost: 4_000,
    validBiomes: ['MID_ATMOSPHERE', 'UPPER_ATMOSPHERE'],
    techTier: 1,
  },

  // ── Tech Tier 2 ─────────────────────────────────────────────────────────

  /**
   * Radiation Detector — charged-particle flux sensor.
   * Operates in the mesosphere and near space where cosmic radiation
   * becomes measurable above the bulk of the atmosphere.
   */
  {
    id: 'radiation-detector',
    name: 'Radiation Detector',
    description: 'Measures charged-particle flux and cosmic radiation levels. Operates in the mesosphere and near space above most atmospheric shielding.',
    dataType: 'ANALYSIS',
    baseYield: 20,
    experimentDuration: 20,
    mass: 120,
    cost: 8_000,
    validBiomes: ['MESOSPHERE', 'NEAR_SPACE'],
    techTier: 2,
  },

  // ── Tech Tier 3 ─────────────────────────────────────────────────────────

  /**
   * Magnetometer — magnetic field mapper.
   * Spans a wide altitude range from the upper atmosphere through near
   * space, mapping field strength and direction for geophysics research.
   */
  {
    id: 'magnetometer',
    name: 'Magnetometer',
    description: 'Maps magnetic field strength and direction. Covers a wide altitude range from the upper atmosphere through near space.',
    dataType: 'ANALYSIS',
    baseYield: 15,
    experimentDuration: 25,
    mass: 150,
    cost: 12_000,
    validBiomes: ['UPPER_ATMOSPHERE', 'MESOSPHERE', 'NEAR_SPACE'],
    techTier: 3,
  },

  /**
   * Gravity Gradiometer — micro-gravity field mapper.
   * Requires the stable, low-drag environment of orbital flight.
   * Produces the highest science yield of any analysis instrument.
   */
  {
    id: 'gravity-gradiometer',
    name: 'Gravity Gradiometer',
    description: 'Maps micro-variations in gravitational field strength. Requires the stable environment of orbital flight for accurate readings.',
    dataType: 'ANALYSIS',
    baseYield: 40,
    experimentDuration: 30,
    mass: 200,
    cost: 15_000,
    validBiomes: ['LOW_ORBIT', 'HIGH_ORBIT'],
    techTier: 3,
  },

  // ── Sample instruments (must be physically returned) ────────────────────

  /**
   * Atmospheric Sampler — collects gas / particle samples.
   * Works across a broad range of atmospheric biomes.  Samples cannot be
   * transmitted — they must be physically returned for full yield.
   */
  {
    id: 'surface-sampler',
    name: 'Atmospheric Sampler',
    description: 'Collects gas or particle samples from the surrounding environment. Must be physically returned — samples cannot be transmitted.',
    dataType: 'SAMPLE',
    baseYield: 30,
    experimentDuration: 40,
    mass: 25,
    cost: 6_000,
    validBiomes: ['GROUND', 'LOW_ATMOSPHERE', 'MID_ATMOSPHERE', 'UPPER_ATMOSPHERE'],
    techTier: 1,
  },

];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** @type {Map<string, InstrumentDef>} */
const _byId = new Map(INSTRUMENTS.map((i) => [i.id, i]));

/**
 * Look up an instrument definition by its ID.
 * @param {string} id
 * @returns {InstrumentDef|undefined}
 */
export function getInstrumentById(id) {
  return _byId.get(id);
}

/**
 * Return all instrument definitions.
 * @returns {InstrumentDef[]}
 */
export function getAllInstruments() {
  return INSTRUMENTS;
}

/**
 * Return instruments available at a given tech tier (and below).
 * @param {number} maxTier  Maximum unlocked tech tier.
 * @returns {InstrumentDef[]}
 */
export function getInstrumentsByTier(maxTier) {
  return INSTRUMENTS.filter((i) => i.techTier <= maxTier);
}

/**
 * Check whether an instrument can produce data in the given biome.
 * @param {string} instrumentId
 * @param {string} biomeId
 * @returns {boolean}
 */
export function isInstrumentValidForBiome(instrumentId, biomeId) {
  const def = _byId.get(instrumentId);
  if (!def) return false;
  if (!def.validBiomes || def.validBiomes.length === 0) return true;
  return def.validBiomes.includes(biomeId);
}

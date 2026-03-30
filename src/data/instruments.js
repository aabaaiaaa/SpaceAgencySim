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
 * @property {string}  id              Stable unique identifier.
 * @property {string}  name            Human-readable display name.
 * @property {string}  description     Short description shown in the VAB.
 * @property {string}  dataType        'SAMPLE' or 'ANALYSIS'.
 * @property {number}  baseYield       Base science points produced on completion.
 * @property {number}  experimentDuration  Seconds the experiment takes to run.
 * @property {number}  mass            Mass in kilograms added to the module.
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

  // ── Analysis instruments (transmittable) ─────────────────────────────────

  {
    id: 'thermometer',
    name: 'Thermometer',
    description: 'Measures ambient temperature at the current altitude. Lightweight and quick — ideal for first flights.',
    dataType: 'ANALYSIS',
    baseYield: 8,
    experimentDuration: 10,
    mass: 5,
  },

  {
    id: 'barometer',
    name: 'Barometer',
    description: 'Records atmospheric pressure. Only produces meaningful data in atmosphere (below Near Space).',
    dataType: 'ANALYSIS',
    baseYield: 10,
    experimentDuration: 12,
    mass: 5,
  },

  {
    id: 'radiation-detector',
    name: 'Radiation Detector',
    description: 'Measures charged-particle flux. Higher-altitude biomes produce richer datasets.',
    dataType: 'ANALYSIS',
    baseYield: 18,
    experimentDuration: 25,
    mass: 12,
  },

  {
    id: 'magnetometer',
    name: 'Magnetometer',
    description: 'Maps magnetic field strength and direction. Best results above the atmosphere.',
    dataType: 'ANALYSIS',
    baseYield: 15,
    experimentDuration: 20,
    mass: 10,
  },

  {
    id: 'spectrometer',
    name: 'Spectrometer',
    description: 'Analyses spectral emissions. Produces a moderate amount of high-quality data.',
    dataType: 'ANALYSIS',
    baseYield: 22,
    experimentDuration: 30,
    mass: 18,
  },

  // ── Sample instruments (must be physically returned) ─────────────────────

  {
    id: 'surface-sampler',
    name: 'Atmospheric Sampler',
    description: 'Collects gas or particle samples from the surrounding environment. Must be physically returned — samples cannot be transmitted.',
    dataType: 'SAMPLE',
    baseYield: 30,
    experimentDuration: 40,
    mass: 25,
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

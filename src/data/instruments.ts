/**
 * instruments.ts — Science instrument definition catalog.
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

import type { GameState } from '../core/gameState.js';
import type { ScienceDataType } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/** Complete definition for a single science instrument. */
export interface InstrumentDef {
  /** Stable unique identifier. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Short description shown in the VAB. */
  description: string;
  /** 'SAMPLE' or 'ANALYSIS'. */
  dataType: ScienceDataType;
  /** Base science points produced on completion. */
  baseYield: number;
  /** Seconds the experiment takes to run. */
  experimentDuration: number;
  /** Mass in kilograms added to the module. */
  mass: number;
  /** Purchase price in dollars. */
  cost: number;
  /** Biome IDs where the instrument produces data. */
  validBiomes: string[];
  /** Tech tree tier required (0 = starter). */
  techTier: number;
}

// ---------------------------------------------------------------------------
// Instrument Catalog
// ---------------------------------------------------------------------------

/** Authoritative list of every science instrument in the game. */
export const INSTRUMENTS: InstrumentDef[] = [

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

const _byId = new Map<string, InstrumentDef>(INSTRUMENTS.map((i) => [i.id, i]));

/** Look up an instrument definition by its ID. */
export function getInstrumentById(id: string): InstrumentDef | undefined {
  return _byId.get(id);
}

/** Return all instrument definitions. */
export function getAllInstruments(): InstrumentDef[] {
  return INSTRUMENTS;
}

/** Return instruments available at a given tech tier (and below). */
export function getInstrumentsByTier(maxTier: number): InstrumentDef[] {
  return INSTRUMENTS.filter((i) => i.techTier <= maxTier);
}

/**
 * Return instruments available to the player based on tech tree state.
 *
 * An instrument is available if:
 *   1. Its `techTier` is 0 (starter — always available), OR
 *   2. Its ID appears in `state.techTree.unlockedInstruments`.
 */
export function getAvailableInstruments(state: GameState): InstrumentDef[] {
  const unlocked = new Set(state.techTree?.unlockedInstruments ?? []);
  return INSTRUMENTS.filter(
    (i) => i.techTier === 0 || unlocked.has(i.id),
  );
}

/** Check whether an instrument can produce data in the given biome. */
export function isInstrumentValidForBiome(instrumentId: string, biomeId: string): boolean {
  const def = _byId.get(instrumentId);
  if (!def) return false;
  if (!def.validBiomes || def.validBiomes.length === 0) return true;
  return def.validBiomes.includes(biomeId);
}

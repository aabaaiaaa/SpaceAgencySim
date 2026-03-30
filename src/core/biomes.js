/**
 * biomes.js — Altitude biome system.
 *
 * Provides biome lookup, transition detection, and orbital biome tracking.
 * Each celestial body defines a set of named altitude bands (biomes) with
 * distinct science multipliers.  The system tracks biome transitions during
 * flight and orbital passes for the science system.
 *
 * PUBLIC API
 * ==========
 *   getBiome(altitude, bodyId)                    → BiomeDef | null
 *   getBiomeId(altitude, bodyId)                  → string | null
 *   getScienceMultiplier(altitude, bodyId)         → number
 *   getBiomeTransition(altitude, bodyId)           → { ratio: number, from: BiomeDef, to: BiomeDef } | null
 *   getOrbitalBiomes(elements, bodyId)             → BiomeDef[]
 *   BIOME_FADE_RANGE                               → number (metres)
 *
 * @module biomes
 */

import { BIOME_DEFINITIONS } from './constants.js';
import { getPeriapsisAltitude, getApoapsisAltitude } from './orbit.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Distance in metres from a biome boundary over which labels cross-fade.
 * At `boundary ± BIOME_FADE_RANGE` the label is fully one biome or the other;
 * within the range the alpha interpolates linearly.
 */
export const BIOME_FADE_RANGE = 50;

// ---------------------------------------------------------------------------
// Biome lookup
// ---------------------------------------------------------------------------

/**
 * Return the biome definition for a given altitude and body.
 *
 * @param {number} altitude  Altitude above the surface in metres.
 * @param {string} bodyId    Celestial body ID (e.g. 'EARTH').
 * @returns {{ id: string, name: string, min: number, max: number, scienceMultiplier: number, color: number } | null}
 */
export function getBiome(altitude, bodyId) {
  const biomes = BIOME_DEFINITIONS[bodyId];
  if (!biomes) return null;

  const alt = Math.max(0, altitude);
  for (const biome of biomes) {
    if (alt >= biome.min && alt < biome.max) return biome;
  }
  return null;
}

/**
 * Return the biome ID string for a given altitude, or null.
 *
 * @param {number} altitude
 * @param {string} bodyId
 * @returns {string | null}
 */
export function getBiomeId(altitude, bodyId) {
  const biome = getBiome(altitude, bodyId);
  return biome ? biome.id : null;
}

/**
 * Return the science multiplier for the given altitude and body.
 * Falls back to 1.0 if no biome is found.
 *
 * @param {number} altitude
 * @param {string} bodyId
 * @returns {number}
 */
export function getScienceMultiplier(altitude, bodyId) {
  const biome = getBiome(altitude, bodyId);
  return biome ? biome.scienceMultiplier : 1.0;
}

// ---------------------------------------------------------------------------
// Biome transition (for label fading)
// ---------------------------------------------------------------------------

/**
 * Detect whether the craft is near a biome boundary and return cross-fade info.
 *
 * When the altitude is within `BIOME_FADE_RANGE` of a boundary, returns the
 * two biomes and a `ratio` in [0, 1]:
 *   - ratio = 0 → fully in `from` biome
 *   - ratio = 1 → fully in `to` biome
 *
 * Returns null if the altitude is not near any boundary.
 *
 * @param {number} altitude
 * @param {string} bodyId
 * @returns {{ ratio: number, from: object, to: object } | null}
 */
export function getBiomeTransition(altitude, bodyId) {
  const biomes = BIOME_DEFINITIONS[bodyId];
  if (!biomes) return null;

  const alt = Math.max(0, altitude);

  // Check each boundary between consecutive biomes.
  for (let i = 0; i < biomes.length - 1; i++) {
    const lower = biomes[i];
    const upper = biomes[i + 1];
    const boundary = lower.max; // === upper.min

    const dist = alt - boundary;
    if (Math.abs(dist) <= BIOME_FADE_RANGE) {
      // ratio: 0 = fully in lower biome, 1 = fully in upper biome
      const ratio = (dist + BIOME_FADE_RANGE) / (2 * BIOME_FADE_RANGE);
      return {
        ratio: Math.max(0, Math.min(1, ratio)),
        from: lower,
        to: upper,
      };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Orbital biome tracking
// ---------------------------------------------------------------------------

/**
 * Return all biomes that an elliptical orbit passes through, ordered from
 * lowest to highest.  Used by the science system to determine which biome
 * samples are available during an orbital pass.
 *
 * @param {import('./orbit.js').OrbitalElements} elements
 * @param {string} bodyId
 * @returns {Array<{ id: string, name: string, min: number, max: number, scienceMultiplier: number, color: number }>}
 */
export function getOrbitalBiomes(elements, bodyId) {
  const biomes = BIOME_DEFINITIONS[bodyId];
  if (!biomes) return [];

  const periAlt = getPeriapsisAltitude(elements, bodyId);
  const apoAlt = getApoapsisAltitude(elements, bodyId);

  const result = [];
  for (const biome of biomes) {
    // Orbit overlaps this biome if altitude range intersects.
    if (periAlt < biome.max && apoAlt >= biome.min) {
      result.push(biome);
    }
  }
  return result;
}

/**
 * Check whether two biome IDs differ (i.e. a biome transition occurred).
 *
 * @param {string | null} prevBiomeId
 * @param {string | null} currentBiomeId
 * @returns {boolean}
 */
export function hasBiomeChanged(prevBiomeId, currentBiomeId) {
  if (prevBiomeId == null || currentBiomeId == null) return false;
  return prevBiomeId !== currentBiomeId;
}

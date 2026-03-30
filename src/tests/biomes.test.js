/**
 * biomes.test.js — Unit tests for the altitude biome system (TASK-014).
 *
 * Tests cover:
 *   getBiome()             — returns correct biome for various altitudes
 *   getBiomeId()           — returns biome ID string
 *   getScienceMultiplier() — returns correct multiplier per biome
 *   getBiomeTransition()   — detects boundary cross-fade zones
 *   getOrbitalBiomes()     — returns biomes an elliptical orbit passes through
 *   hasBiomeChanged()      — detects biome transitions
 *   BIOME_DEFINITIONS      — validates all defined biomes
 */

import { describe, it, expect } from 'vitest';
import {
  getBiome,
  getBiomeId,
  getScienceMultiplier,
  getBiomeTransition,
  getOrbitalBiomes,
  hasBiomeChanged,
  BIOME_FADE_RANGE,
} from '../core/biomes.js';
import { BIOME_DEFINITIONS } from '../core/constants.js';

// ---------------------------------------------------------------------------
// BIOME_DEFINITIONS validation
// ---------------------------------------------------------------------------

describe('BIOME_DEFINITIONS', () => {
  it('defines Earth biomes', () => {
    expect(BIOME_DEFINITIONS.EARTH).toBeDefined();
    expect(BIOME_DEFINITIONS.EARTH.length).toBe(8);
  });

  it('biomes are contiguous (no gaps)', () => {
    const biomes = BIOME_DEFINITIONS.EARTH;
    for (let i = 0; i < biomes.length - 1; i++) {
      expect(biomes[i].max).toBe(biomes[i + 1].min);
    }
  });

  it('first biome starts at 0', () => {
    expect(BIOME_DEFINITIONS.EARTH[0].min).toBe(0);
  });

  it('last biome extends to Infinity', () => {
    const last = BIOME_DEFINITIONS.EARTH[BIOME_DEFINITIONS.EARTH.length - 1];
    expect(last.max).toBe(Infinity);
  });

  it('each biome has required properties', () => {
    for (const biome of BIOME_DEFINITIONS.EARTH) {
      expect(biome.id).toBeTruthy();
      expect(biome.name).toBeTruthy();
      expect(typeof biome.min).toBe('number');
      expect(typeof biome.max).toBe('number');
      expect(typeof biome.scienceMultiplier).toBe('number');
      expect(typeof biome.color).toBe('number');
    }
  });

  it('science multipliers increase with altitude', () => {
    const biomes = BIOME_DEFINITIONS.EARTH;
    for (let i = 1; i < biomes.length; i++) {
      expect(biomes[i].scienceMultiplier).toBeGreaterThanOrEqual(biomes[i - 1].scienceMultiplier);
    }
  });
});

// ---------------------------------------------------------------------------
// getBiome()
// ---------------------------------------------------------------------------

describe('getBiome()', () => {
  it('returns Ground at altitude 0', () => {
    const biome = getBiome(0, 'EARTH');
    expect(biome.id).toBe('GROUND');
  });

  it('returns Ground at altitude 50', () => {
    const biome = getBiome(50, 'EARTH');
    expect(biome.id).toBe('GROUND');
  });

  it('returns Low Atmosphere at altitude 100', () => {
    const biome = getBiome(100, 'EARTH');
    expect(biome.id).toBe('LOW_ATMOSPHERE');
  });

  it('returns Mid Atmosphere at 5000 m', () => {
    const biome = getBiome(5000, 'EARTH');
    expect(biome.id).toBe('MID_ATMOSPHERE');
  });

  it('returns Upper Atmosphere at 20000 m', () => {
    const biome = getBiome(20000, 'EARTH');
    expect(biome.id).toBe('UPPER_ATMOSPHERE');
  });

  it('returns Mesosphere at 50000 m', () => {
    const biome = getBiome(50000, 'EARTH');
    expect(biome.id).toBe('MESOSPHERE');
  });

  it('returns Near Space at 80000 m', () => {
    const biome = getBiome(80000, 'EARTH');
    expect(biome.id).toBe('NEAR_SPACE');
  });

  it('returns Low Orbit at 150000 m', () => {
    const biome = getBiome(150000, 'EARTH');
    expect(biome.id).toBe('LOW_ORBIT');
  });

  it('returns High Orbit at 300000 m', () => {
    const biome = getBiome(300000, 'EARTH');
    expect(biome.id).toBe('HIGH_ORBIT');
  });

  it('returns High Orbit at very high altitude (1000 km)', () => {
    const biome = getBiome(1_000_000, 'EARTH');
    expect(biome.id).toBe('HIGH_ORBIT');
  });

  it('clamps negative altitudes to 0 (Ground)', () => {
    const biome = getBiome(-100, 'EARTH');
    expect(biome.id).toBe('GROUND');
  });

  it('returns null for unknown body', () => {
    expect(getBiome(1000, 'MARS')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getBiomeId()
// ---------------------------------------------------------------------------

describe('getBiomeId()', () => {
  it('returns biome ID string', () => {
    expect(getBiomeId(500, 'EARTH')).toBe('LOW_ATMOSPHERE');
  });

  it('returns null for unknown body', () => {
    expect(getBiomeId(500, 'JUPITER')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getScienceMultiplier()
// ---------------------------------------------------------------------------

describe('getScienceMultiplier()', () => {
  it('returns 0.5 for Ground', () => {
    expect(getScienceMultiplier(50, 'EARTH')).toBe(0.5);
  });

  it('returns 1.0 for Low Atmosphere', () => {
    expect(getScienceMultiplier(1000, 'EARTH')).toBe(1.0);
  });

  it('returns 1.2 for Mid Atmosphere', () => {
    expect(getScienceMultiplier(5000, 'EARTH')).toBe(1.2);
  });

  it('returns 1.5 for Upper Atmosphere', () => {
    expect(getScienceMultiplier(20000, 'EARTH')).toBe(1.5);
  });

  it('returns 2.0 for Mesosphere', () => {
    expect(getScienceMultiplier(50000, 'EARTH')).toBe(2.0);
  });

  it('returns 2.5 for Near Space', () => {
    expect(getScienceMultiplier(80000, 'EARTH')).toBe(2.5);
  });

  it('returns 3.0 for Low Orbit', () => {
    expect(getScienceMultiplier(150000, 'EARTH')).toBe(3.0);
  });

  it('returns 4.0 for High Orbit', () => {
    expect(getScienceMultiplier(500000, 'EARTH')).toBe(4.0);
  });

  it('falls back to 1.0 for unknown body', () => {
    expect(getScienceMultiplier(500, 'MARS')).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// getBiomeTransition()
// ---------------------------------------------------------------------------

describe('getBiomeTransition()', () => {
  it('returns null when far from any boundary', () => {
    // 1000 m is well inside Low Atmosphere (100–2000), far from boundaries
    expect(getBiomeTransition(1000, 'EARTH')).toBeNull();
  });

  it('detects transition near the 100 m boundary (Ground → Low Atmosphere)', () => {
    const t = getBiomeTransition(100, 'EARTH');
    expect(t).not.toBeNull();
    expect(t.from.id).toBe('GROUND');
    expect(t.to.id).toBe('LOW_ATMOSPHERE');
    expect(t.ratio).toBeCloseTo(0.5, 1);
  });

  it('ratio approaches 0 well inside lower biome', () => {
    const t = getBiomeTransition(100 - BIOME_FADE_RANGE, 'EARTH');
    expect(t).not.toBeNull();
    expect(t.ratio).toBeCloseTo(0, 1);
  });

  it('ratio approaches 1 well inside upper biome', () => {
    const t = getBiomeTransition(100 + BIOME_FADE_RANGE, 'EARTH');
    expect(t).not.toBeNull();
    expect(t.ratio).toBeCloseTo(1, 1);
  });

  it('returns null for unknown body', () => {
    expect(getBiomeTransition(100, 'MARS')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getOrbitalBiomes()
// ---------------------------------------------------------------------------

describe('getOrbitalBiomes()', () => {
  it('returns a single biome for a circular orbit within one biome', () => {
    // Circular orbit at 150 km (Low Orbit: 100–200 km)
    const elements = {
      semiMajorAxis: 6_371_000 + 150_000, // R + altitude
      eccentricity: 0,
      argPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    };
    const biomes = getOrbitalBiomes(elements, 'EARTH');
    expect(biomes.length).toBe(1);
    expect(biomes[0].id).toBe('LOW_ORBIT');
  });

  it('returns multiple biomes for an elliptical orbit spanning biome boundaries', () => {
    // Elliptical orbit: periapsis ~80 km (Near Space), apoapsis ~300 km (High Orbit)
    // semi-major axis = (R+80000 + R+300000)/2
    const R = 6_371_000;
    const rPeri = R + 80_000;
    const rApo = R + 300_000;
    const a = (rPeri + rApo) / 2;
    const e = (rApo - rPeri) / (rApo + rPeri);
    const elements = {
      semiMajorAxis: a,
      eccentricity: e,
      argPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    };
    const biomes = getOrbitalBiomes(elements, 'EARTH');
    // Should span Near Space, Low Orbit, High Orbit
    expect(biomes.length).toBeGreaterThanOrEqual(3);
    const ids = biomes.map(b => b.id);
    expect(ids).toContain('NEAR_SPACE');
    expect(ids).toContain('LOW_ORBIT');
    expect(ids).toContain('HIGH_ORBIT');
  });

  it('returns empty array for unknown body', () => {
    const elements = {
      semiMajorAxis: 6_371_000 + 150_000,
      eccentricity: 0,
      argPeriapsis: 0,
      meanAnomalyAtEpoch: 0,
      epoch: 0,
    };
    expect(getOrbitalBiomes(elements, 'MARS')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// hasBiomeChanged()
// ---------------------------------------------------------------------------

describe('hasBiomeChanged()', () => {
  it('returns false when biomes are the same', () => {
    expect(hasBiomeChanged('LOW_ORBIT', 'LOW_ORBIT')).toBe(false);
  });

  it('returns true when biomes differ', () => {
    expect(hasBiomeChanged('LOW_ORBIT', 'HIGH_ORBIT')).toBe(true);
  });

  it('returns false when either is null', () => {
    expect(hasBiomeChanged(null, 'LOW_ORBIT')).toBe(false);
    expect(hasBiomeChanged('LOW_ORBIT', null)).toBe(false);
  });
});

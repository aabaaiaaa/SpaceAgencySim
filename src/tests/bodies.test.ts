// @ts-nocheck
/**
 * bodies.test.js — Unit tests for the celestial body data system (TASK-039).
 *
 * Tests cover:
 *   CELESTIAL_BODIES catalog  — all 8 bodies defined with correct properties
 *   getBodyDef()              — lookup by ID
 *   getAirDensity()           — body-aware atmosphere model
 *   getSurfaceGravity()       — per-body gravity values
 *   getAtmosphereTop()        — atmosphere ceiling per body
 *   hasAtmosphere()           — correctly identifies atmospheric/airless bodies
 *   isLandable()              — landability flag
 *   getDestructionZone()      — Sun's extreme heat zone
 *   findBodyPath()            — hierarchical path between bodies
 *   SOI consistency           — SOI values match between bodies.js and manoeuvre.js
 *   Biome/band consistency    — biomes and altitude bands match constants.js
 */

import { describe, it, expect } from 'vitest';
import {
  CELESTIAL_BODIES,
  ALL_BODY_IDS,
  getBodyDef,
  getBodyAtmosphere,
  getAirDensity,
  getAtmosphereTop,
  hasAtmosphere,
  getSurfaceGravity,
  getSkyVisual,
  getGroundVisual,
  isLandable,
  getDestructionZone,
  getBodyHierarchy,
  findBodyPath,
} from '../data/bodies.ts';
import { CelestialBody, BODY_GM, BODY_RADIUS, MIN_ORBIT_ALTITUDE, ALTITUDE_BANDS, BIOME_DEFINITIONS } from '../core/constants.ts';
import { SOI_RADIUS, BODY_PARENT, BODY_CHILDREN, BODY_ORBIT_RADIUS } from '../core/manoeuvre.ts';
import {
  airDensityForBody,
  atmosphereTopForBody,
  isReentryConditionForBody,
} from '../core/atmosphere.ts';

// ---------------------------------------------------------------------------
// Catalog completeness
// ---------------------------------------------------------------------------

describe('CELESTIAL_BODIES catalog', () => {
  const expectedBodies = ['SUN', 'MERCURY', 'VENUS', 'EARTH', 'MOON', 'MARS', 'PHOBOS', 'DEIMOS'];

  it('contains all 8 required bodies', () => {
    expect(ALL_BODY_IDS).toHaveLength(8);
    for (const id of expectedBodies) {
      expect(CELESTIAL_BODIES[id]).toBeDefined();
    }
  });

  it('ALL_BODY_IDS matches CELESTIAL_BODIES keys', () => {
    expect(ALL_BODY_IDS).toEqual(Object.keys(CELESTIAL_BODIES));
  });

  it('every body has all required fields', () => {
    const requiredFields = [
      'id', 'name', 'surfaceGravity', 'radius', 'gm',
      'atmosphere', 'orbitalDistance', 'orbitalPeriod',
      'biomes', 'altitudeBands', 'groundVisual', 'skyVisual',
      'weather', 'landable', 'soiRadius', 'parentId', 'childIds',
      'minOrbitAltitude', 'destructionZone',
    ];

    for (const id of ALL_BODY_IDS) {
      const body = CELESTIAL_BODIES[id];
      for (const field of requiredFields) {
        expect(body).toHaveProperty(field);
      }
    }
  });

  it('body IDs match their key in the catalog', () => {
    for (const [key, body] of Object.entries(CELESTIAL_BODIES)) {
      expect(body.id).toBe(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Surface gravity values
// ---------------------------------------------------------------------------

describe('Surface gravity', () => {
  const expectedGravities = {
    SUN: 274,
    MERCURY: 3.7,
    VENUS: 8.87,
    EARTH: 9.81,
    MOON: 1.62,
    MARS: 3.72,
    PHOBOS: 0.0057,
    DEIMOS: 0.003,
  };

  for (const [bodyId, expected] of Object.entries(expectedGravities)) {
    it(`${bodyId} has surface gravity ${expected} m/s²`, () => {
      expect(getSurfaceGravity(bodyId)).toBe(expected);
      expect(CELESTIAL_BODIES[bodyId].surfaceGravity).toBe(expected);
    });
  }

  it('returns 9.81 fallback for unknown body', () => {
    expect(getSurfaceGravity('PLUTO')).toBe(9.81);
  });
});

// ---------------------------------------------------------------------------
// Atmosphere profiles
// ---------------------------------------------------------------------------

describe('Atmosphere profiles', () => {
  it('Earth has an atmosphere', () => {
    expect(hasAtmosphere('EARTH')).toBe(true);
    const atmo = getBodyAtmosphere('EARTH');
    expect(atmo).not.toBeNull();
    expect(atmo.seaLevelDensity).toBe(1.225);
    expect(atmo.scaleHeight).toBe(8_500);
    expect(atmo.topAltitude).toBe(70_000);
  });

  it('Venus has a very dense atmosphere', () => {
    expect(hasAtmosphere('VENUS')).toBe(true);
    const atmo = getBodyAtmosphere('VENUS');
    expect(atmo.seaLevelDensity).toBe(65.0);
    expect(atmo.topAltitude).toBe(250_000);
  });

  it('Mars has a thin atmosphere', () => {
    expect(hasAtmosphere('MARS')).toBe(true);
    const atmo = getBodyAtmosphere('MARS');
    expect(atmo.seaLevelDensity).toBe(0.020);
    expect(atmo.topAltitude).toBe(80_000);
  });

  it('Moon is airless', () => {
    expect(hasAtmosphere('MOON')).toBe(false);
    expect(getBodyAtmosphere('MOON')).toBeNull();
  });

  it('Mercury is airless', () => {
    expect(hasAtmosphere('MERCURY')).toBe(false);
    expect(getBodyAtmosphere('MERCURY')).toBeNull();
  });

  it('Sun has no conventional atmosphere', () => {
    expect(hasAtmosphere('SUN')).toBe(false);
  });

  it('Phobos and Deimos are airless', () => {
    expect(hasAtmosphere('PHOBOS')).toBe(false);
    expect(hasAtmosphere('DEIMOS')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Body-aware air density
// ---------------------------------------------------------------------------

describe('getAirDensity()', () => {
  it('returns sea-level density at altitude 0 for Earth', () => {
    expect(getAirDensity(0, 'EARTH')).toBeCloseTo(1.225, 3);
  });

  it('returns 0 above Earth atmosphere top', () => {
    expect(getAirDensity(70_000, 'EARTH')).toBe(0);
    expect(getAirDensity(100_000, 'EARTH')).toBe(0);
  });

  it('returns 0 for airless Moon at any altitude', () => {
    expect(getAirDensity(0, 'MOON')).toBe(0);
    expect(getAirDensity(1_000, 'MOON')).toBe(0);
  });

  it('returns very high density at Venus surface', () => {
    expect(getAirDensity(0, 'VENUS')).toBeCloseTo(65.0, 1);
  });

  it('returns low density at Mars surface', () => {
    expect(getAirDensity(0, 'MARS')).toBeCloseTo(0.020, 3);
  });

  it('density decreases with altitude', () => {
    expect(getAirDensity(10_000, 'EARTH')).toBeLessThan(getAirDensity(0, 'EARTH'));
    expect(getAirDensity(10_000, 'VENUS')).toBeLessThan(getAirDensity(0, 'VENUS'));
    expect(getAirDensity(10_000, 'MARS')).toBeLessThan(getAirDensity(0, 'MARS'));
  });

  it('returns 0 for unknown body', () => {
    expect(getAirDensity(0, 'PLUTO')).toBe(0);
  });

  it('clamps negative altitudes to 0', () => {
    expect(getAirDensity(-100, 'EARTH')).toBeCloseTo(1.225, 3);
  });
});

// ---------------------------------------------------------------------------
// Atmosphere top
// ---------------------------------------------------------------------------

describe('getAtmosphereTop()', () => {
  it('Earth atmosphere top is 70,000 m', () => {
    expect(getAtmosphereTop('EARTH')).toBe(70_000);
  });

  it('Venus atmosphere top is 250,000 m', () => {
    expect(getAtmosphereTop('VENUS')).toBe(250_000);
  });

  it('Mars atmosphere top is 80,000 m', () => {
    expect(getAtmosphereTop('MARS')).toBe(80_000);
  });

  it('airless bodies return 0', () => {
    expect(getAtmosphereTop('MOON')).toBe(0);
    expect(getAtmosphereTop('MERCURY')).toBe(0);
    expect(getAtmosphereTop('PHOBOS')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// atmosphere.js bridge functions
// ---------------------------------------------------------------------------

describe('atmosphere.js body-aware functions', () => {
  it('airDensityForBody matches getAirDensity', () => {
    expect(airDensityForBody(0, 'EARTH')).toBeCloseTo(getAirDensity(0, 'EARTH'), 6);
    expect(airDensityForBody(0, 'MARS')).toBeCloseTo(getAirDensity(0, 'MARS'), 6);
    expect(airDensityForBody(0, 'MOON')).toBe(0);
  });

  it('atmosphereTopForBody returns correct values', () => {
    expect(atmosphereTopForBody('EARTH')).toBe(70_000);
    expect(atmosphereTopForBody('VENUS')).toBe(250_000);
    expect(atmosphereTopForBody('MOON')).toBe(0);
  });

  it('isReentryConditionForBody detects reentry on atmospheric bodies', () => {
    expect(isReentryConditionForBody(50_000, 2_000, 'EARTH')).toBe(true);
    expect(isReentryConditionForBody(50_000, 2_000, 'MARS')).toBe(true);
    expect(isReentryConditionForBody(200_000, 2_000, 'VENUS')).toBe(true);
  });

  it('isReentryConditionForBody returns false for airless bodies', () => {
    expect(isReentryConditionForBody(50_000, 2_000, 'MOON')).toBe(false);
    expect(isReentryConditionForBody(50_000, 2_000, 'MERCURY')).toBe(false);
  });

  it('isReentryConditionForBody returns false for low speed', () => {
    expect(isReentryConditionForBody(50_000, 500, 'EARTH')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Landability and destruction zones
// ---------------------------------------------------------------------------

describe('Landability', () => {
  it('Sun is not landable', () => {
    expect(isLandable('SUN')).toBe(false);
  });

  it('all other bodies are landable', () => {
    const landableBodies = ['MERCURY', 'VENUS', 'EARTH', 'MOON', 'MARS', 'PHOBOS', 'DEIMOS'];
    for (const id of landableBodies) {
      expect(isLandable(id)).toBe(true);
    }
  });

  it('Sun has a destruction zone', () => {
    expect(getDestructionZone('SUN')).toBe('extreme_heat');
  });

  it('other bodies have no destruction zone', () => {
    const others = ['MERCURY', 'VENUS', 'EARTH', 'MOON', 'MARS', 'PHOBOS', 'DEIMOS'];
    for (const id of others) {
      expect(getDestructionZone(id)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Visual properties
// ---------------------------------------------------------------------------

describe('Visual properties', () => {
  it('every body has ground and sky visuals', () => {
    for (const id of ALL_BODY_IDS) {
      expect(getSkyVisual(id)).not.toBeNull();
      expect(getGroundVisual(id)).not.toBeNull();
    }
  });

  it('airless bodies have black sky at surface', () => {
    const airlessBodies = ['MOON', 'MERCURY', 'PHOBOS', 'DEIMOS'];
    for (const id of airlessBodies) {
      const sky = getSkyVisual(id);
      expect(sky.seaLevelColor).toBe(0x000005);
    }
  });

  it('Earth has blue sky at surface', () => {
    const sky = getSkyVisual('EARTH');
    expect(sky.seaLevelColor).toBe(0x87ceeb);
  });

  it('Mars has a butterscotch sky', () => {
    const sky = getSkyVisual('MARS');
    expect(sky.seaLevelColor).toBe(0xd4a574);
  });
});

// ---------------------------------------------------------------------------
// Body hierarchy
// ---------------------------------------------------------------------------

describe('Body hierarchy', () => {
  it('Sun is the root (no parent)', () => {
    expect(CELESTIAL_BODIES.SUN.parentId).toBeNull();
  });

  it('planets orbit the Sun', () => {
    expect(CELESTIAL_BODIES.MERCURY.parentId).toBe('SUN');
    expect(CELESTIAL_BODIES.VENUS.parentId).toBe('SUN');
    expect(CELESTIAL_BODIES.EARTH.parentId).toBe('SUN');
    expect(CELESTIAL_BODIES.MARS.parentId).toBe('SUN');
  });

  it('Moon orbits Earth', () => {
    expect(CELESTIAL_BODIES.MOON.parentId).toBe('EARTH');
  });

  it('Phobos and Deimos orbit Mars', () => {
    expect(CELESTIAL_BODIES.PHOBOS.parentId).toBe('MARS');
    expect(CELESTIAL_BODIES.DEIMOS.parentId).toBe('MARS');
  });

  it('Sun has Mercury, Venus, Earth, Mars as children', () => {
    expect(CELESTIAL_BODIES.SUN.childIds).toEqual(['MERCURY', 'VENUS', 'EARTH', 'MARS']);
  });

  it('Earth has Moon as child', () => {
    expect(CELESTIAL_BODIES.EARTH.childIds).toEqual(['MOON']);
  });

  it('Mars has Phobos and Deimos as children', () => {
    expect(CELESTIAL_BODIES.MARS.childIds).toEqual(['PHOBOS', 'DEIMOS']);
  });

  it('leaf bodies have no children', () => {
    for (const id of ['MERCURY', 'VENUS', 'MOON', 'PHOBOS', 'DEIMOS']) {
      expect(CELESTIAL_BODIES[id].childIds).toEqual([]);
    }
  });

  it('getBodyHierarchy returns all parent→children mappings', () => {
    const hierarchy = getBodyHierarchy();
    expect(hierarchy.SUN).toEqual(['MERCURY', 'VENUS', 'EARTH', 'MARS']);
    expect(hierarchy.EARTH).toEqual(['MOON']);
    expect(hierarchy.MARS).toEqual(['PHOBOS', 'DEIMOS']);
    expect(hierarchy.MOON).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findBodyPath
// ---------------------------------------------------------------------------

describe('findBodyPath()', () => {
  it('same body returns single-element path', () => {
    expect(findBodyPath('EARTH', 'EARTH')).toEqual(['EARTH']);
  });

  it('Earth → Moon: direct parent to child', () => {
    const path = findBodyPath('EARTH', 'MOON');
    expect(path).toEqual(['EARTH', 'MOON']);
  });

  it('Moon → Earth: child to parent', () => {
    const path = findBodyPath('MOON', 'EARTH');
    expect(path).toEqual(['MOON', 'EARTH']);
  });

  it('Earth → Mars: through Sun', () => {
    const path = findBodyPath('EARTH', 'MARS');
    expect(path).toEqual(['EARTH', 'SUN', 'MARS']);
  });

  it('Moon → Phobos: through Earth, Sun, Mars', () => {
    const path = findBodyPath('MOON', 'PHOBOS');
    expect(path).toEqual(['MOON', 'EARTH', 'SUN', 'MARS', 'PHOBOS']);
  });

  it('returns empty array for unknown body', () => {
    expect(findBodyPath('EARTH', 'PLUTO')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// SOI values
// ---------------------------------------------------------------------------

describe('SOI radius', () => {
  it('Sun has infinite SOI', () => {
    expect(CELESTIAL_BODIES.SUN.soiRadius).toBe(Infinity);
  });

  it('all non-Sun bodies have finite SOI', () => {
    for (const id of ALL_BODY_IDS) {
      if (id === 'SUN') continue;
      expect(CELESTIAL_BODIES[id].soiRadius).toBeGreaterThan(0);
      expect(isFinite(CELESTIAL_BODIES[id].soiRadius)).toBe(true);
    }
  });

  it('SOI > body radius for all bodies', () => {
    for (const id of ALL_BODY_IDS) {
      if (id === 'SUN') continue;
      expect(CELESTIAL_BODIES[id].soiRadius).toBeGreaterThan(CELESTIAL_BODIES[id].radius);
    }
  });
});

// ---------------------------------------------------------------------------
// Consistency with constants.js
// ---------------------------------------------------------------------------

describe('Consistency with constants.js', () => {
  it('CelestialBody enum has all body IDs', () => {
    for (const id of ALL_BODY_IDS) {
      expect(CelestialBody[id]).toBe(id);
    }
  });

  it('BODY_GM matches body definitions', () => {
    for (const id of ALL_BODY_IDS) {
      expect(BODY_GM[id]).toBe(CELESTIAL_BODIES[id].gm);
    }
  });

  it('BODY_RADIUS matches body definitions', () => {
    for (const id of ALL_BODY_IDS) {
      expect(BODY_RADIUS[id]).toBe(CELESTIAL_BODIES[id].radius);
    }
  });

  it('MIN_ORBIT_ALTITUDE matches body definitions', () => {
    for (const id of ALL_BODY_IDS) {
      expect(MIN_ORBIT_ALTITUDE[id]).toBe(CELESTIAL_BODIES[id].minOrbitAltitude);
    }
  });

  it('BIOME_DEFINITIONS exist for all bodies', () => {
    for (const id of ALL_BODY_IDS) {
      expect(BIOME_DEFINITIONS[id]).toBeDefined();
      expect(BIOME_DEFINITIONS[id].length).toBeGreaterThan(0);
    }
  });

  it('ALTITUDE_BANDS exist for all bodies', () => {
    for (const id of ALL_BODY_IDS) {
      expect(ALTITUDE_BANDS[id]).toBeDefined();
      expect(ALTITUDE_BANDS[id].length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Consistency with manoeuvre.js
// ---------------------------------------------------------------------------

describe('Consistency with manoeuvre.js', () => {
  it('SOI_RADIUS matches body definitions', () => {
    for (const id of ALL_BODY_IDS) {
      expect(SOI_RADIUS[id]).toBe(CELESTIAL_BODIES[id].soiRadius);
    }
  });

  it('BODY_PARENT matches body definitions', () => {
    for (const id of ALL_BODY_IDS) {
      expect(BODY_PARENT[id]).toBe(CELESTIAL_BODIES[id].parentId);
    }
  });

  it('BODY_CHILDREN matches body definitions', () => {
    for (const id of ALL_BODY_IDS) {
      const expected = CELESTIAL_BODIES[id].childIds;
      expect([...BODY_CHILDREN[id]]).toEqual(expected);
    }
  });

  it('BODY_ORBIT_RADIUS exists for all non-root bodies', () => {
    for (const id of ALL_BODY_IDS) {
      if (id === 'SUN') continue;
      expect(BODY_ORBIT_RADIUS[id]).toBe(CELESTIAL_BODIES[id].orbitalDistance);
    }
  });
});

// ---------------------------------------------------------------------------
// Biome integrity
// ---------------------------------------------------------------------------

describe('Biome integrity', () => {
  for (const id of ALL_BODY_IDS) {
    describe(`${id} biomes`, () => {
      const body = CELESTIAL_BODIES[id];

      it('biomes start at altitude 0', () => {
        expect(body.biomes[0].min).toBe(0);
      });

      it('last biome extends to Infinity', () => {
        const last = body.biomes[body.biomes.length - 1];
        expect(last.max).toBe(Infinity);
      });

      it('biomes are contiguous (no gaps)', () => {
        for (let i = 0; i < body.biomes.length - 1; i++) {
          expect(body.biomes[i].max).toBe(body.biomes[i + 1].min);
        }
      });

      it('biome IDs are unique', () => {
        const ids = body.biomes.map(b => b.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('all biomes have non-negative science multipliers (0 for destruction zones)', () => {
        for (const biome of body.biomes) {
          expect(biome.scienceMultiplier).toBeGreaterThanOrEqual(0);
        }
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

describe('Weather', () => {
  it('Mars has dust storms', () => {
    expect(CELESTIAL_BODIES.MARS.weather).toBe('dust_storms');
  });

  it('other bodies have no weather', () => {
    for (const id of ALL_BODY_IDS) {
      if (id === 'MARS') continue;
      expect(CELESTIAL_BODIES[id].weather).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// getBodyDef
// ---------------------------------------------------------------------------

describe('getBodyDef()', () => {
  it('returns the body definition for valid IDs', () => {
    const earth = getBodyDef('EARTH');
    expect(earth).toBeDefined();
    expect(earth.name).toBe('Earth');
  });

  it('returns undefined for unknown IDs', () => {
    expect(getBodyDef('PLUTO')).toBeUndefined();
  });
});

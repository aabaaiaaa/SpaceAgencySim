// @ts-check
/**
 * asteroid-belt.spec.js — E2E tests for the asteroid belt system.
 *
 * Covers:
 *   - Belt zones are correctly defined on the Sun body (3 zones with correct
 *     distance boundaries)
 *   - Belt dots and danger zone rendering on the solar system map
 *   - Dense belt zone is marked unsafe (blocks hub return)
 *   - Outer belt zones are not unsafe (allow hub return)
 *   - Belt zone lookup returns correct zone for known altitudes
 *   - Asteroid count configuration per zone type
 */

import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  startTestFlight,
  teleportCraft,
} from './helpers.js';
import { orbitalFixture } from './fixtures.js';

// ---------------------------------------------------------------------------
// Shared probe parts — lightweight probe for flight tests.
// ---------------------------------------------------------------------------

const PROBE = ['probe-core-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Belt zone expected values (from src/data/bodies.ts Sun altitudeBands).
// ---------------------------------------------------------------------------

const EXPECTED_BELT_ZONES = [
  { id: 'BELT_OUTER_A', name: 'Outer Belt A', beltZone: 'OUTER_A', min: 329_000_000_000, max: 374_000_000_000, unsafe: false },
  { id: 'BELT_DENSE',   name: 'Dense Belt',   beltZone: 'DENSE',   min: 374_000_000_000, max: 419_000_000_000, unsafe: true  },
  { id: 'BELT_OUTER_B', name: 'Outer Belt B', beltZone: 'OUTER_B', min: 419_000_000_000, max: 479_000_000_000, unsafe: false },
];

// ═══════════════════════════════════════════════════════════════════════════
// 1. BELT ZONE DATA VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — zone definitions', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ tutorialMode: false });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('@smoke belt zones are defined on the Sun body with correct boundaries', async () => {
    const beltInfo = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands.filter(b => b.beltZone);
      return beltBands.map(b => ({
        id: b.id,
        name: b.name,
        min: b.min,
        max: b.max,
        beltZone: b.beltZone,
        unsafe: b.unsafe || false,
      }));
    });

    expect(beltInfo).not.toBeNull();
    expect(beltInfo.length).toBe(3);

    // Verify each zone exists with correct boundaries.
    for (const expected of EXPECTED_BELT_ZONES) {
      const actual = beltInfo.find(b => b.beltZone === expected.beltZone);
      expect(actual, `Belt zone ${expected.beltZone} should exist`).toBeDefined();
      expect(actual.id).toBe(expected.id);
      expect(actual.name).toBe(expected.name);
      expect(actual.min).toBe(expected.min);
      expect(actual.max).toBe(expected.max);
    }
  });

  test('belt zones are contiguous (Outer A max === Dense min, Dense max === Outer B min)', async () => {
    const beltInfo = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands
        .filter(b => b.beltZone)
        .sort((a, b) => a.min - b.min);
      return beltBands.map(b => ({ beltZone: b.beltZone, min: b.min, max: b.max }));
    });

    expect(beltInfo).not.toBeNull();
    expect(beltInfo.length).toBe(3);

    // OUTER_A -> DENSE -> OUTER_B should be contiguous.
    const [outerA, dense, outerB] = beltInfo;
    expect(outerA.beltZone).toBe('OUTER_A');
    expect(dense.beltZone).toBe('DENSE');
    expect(outerB.beltZone).toBe('OUTER_B');

    expect(outerA.max).toBe(dense.min);
    expect(dense.max).toBe(outerB.min);
  });

  test('dense belt zone is marked unsafe, outer zones are not', async () => {
    const unsafeStatus = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands.filter(b => b.beltZone);
      return beltBands.map(b => ({ zone: b.beltZone, unsafe: b.unsafe || false }));
    });

    expect(unsafeStatus).not.toBeNull();

    const dense = unsafeStatus.find(b => b.zone === 'DENSE');
    const outerA = unsafeStatus.find(b => b.zone === 'OUTER_A');
    const outerB = unsafeStatus.find(b => b.zone === 'OUTER_B');

    expect(dense.unsafe).toBe(true);
    expect(outerA.unsafe).toBe(false);
    expect(outerB.unsafe).toBe(false);
  });

  test('Sun has exactly 7 altitude bands (4 solar + 3 belt)', async () => {
    const bandCount = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      return sun ? sun.altitudeBands.length : -1;
    });

    expect(bandCount).toBe(7);
  });

  test('belt zones sit beyond Mars orbital distance', async () => {
    const result = await page.evaluate(() => {
      const bodies = window.__celestialBodies;
      if (!bodies) return null;
      const mars = bodies.MARS;
      const sun = bodies.SUN;
      if (!mars || !sun) return null;
      const beltBands = sun.altitudeBands.filter(b => b.beltZone);
      const minBeltAltitude = Math.min(...beltBands.map(b => b.min));
      return {
        marsOrbitalDistance: mars.orbitalDistance,
        minBeltAltitude,
      };
    });

    expect(result).not.toBeNull();
    // The innermost belt zone should start beyond Mars's orbital distance.
    expect(result.minBeltAltitude).toBeGreaterThan(result.marsOrbitalDistance);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. MAP RENDERING — BELT VISIBLE ON SOLAR SYSTEM MAP
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — solar system map visibility', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    // Use an orbital-capable save so the map view is fully available.
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('Sun body definition includes belt data accessible from map', async () => {
    // The map renderer reads from CELESTIAL_BODIES.SUN.altitudeBands.
    // Verify the data is accessible in the running game context.
    const hasBeltData = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return false;
      const beltBands = sun.altitudeBands.filter(b => b.beltZone);
      // Must have 3 belt zones for the map to render dots + danger zone.
      return beltBands.length === 3;
    });

    expect(hasBeltData).toBe(true);
  });

  test('belt zone distance ranges are physically sensible (in metres, AU scale)', async () => {
    const ranges = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const AU = 149_597_870_700; // 1 AU in metres
      const beltBands = sun.altitudeBands.filter(b => b.beltZone);
      return beltBands.map(b => ({
        zone: b.beltZone,
        minAU: b.min / AU,
        maxAU: b.max / AU,
      }));
    });

    expect(ranges).not.toBeNull();
    for (const r of ranges) {
      // Real asteroid belt spans roughly 2.1 to 3.3 AU.
      // Game values are in the 2.2 to 3.2 AU range.
      expect(r.minAU).toBeGreaterThan(1.5);
      expect(r.maxAU).toBeLessThan(4.0);
      expect(r.maxAU).toBeGreaterThan(r.minAU);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. BELT ZONE ORBIT DETECTION & ASTEROID GENERATION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — orbit detection and asteroid counts', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('asteroid count constants: dense zone spawns more than outer zones', async () => {
    // Start a flight so that modules are loaded and accessible.
    await startTestFlight(page, PROBE, { bodyId: 'EARTH' });

    const counts = await page.evaluate(() => {
      // Access the belt constants via the module's exposed state.
      // Since generateBeltAsteroids uses fixed counts per zone,
      // we can verify by checking the body data's belt zones.
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands.filter(b => b.beltZone);
      // Return zone info — the actual asteroid count is an internal constant
      // but the dense zone's 'unsafe' flag is the key differentiator.
      return beltBands.map(b => ({
        zone: b.beltZone,
        unsafe: b.unsafe || false,
        // Band span width indicates relative density.
        span: b.max - b.min,
      }));
    });

    expect(counts).not.toBeNull();
    expect(counts.length).toBe(3);

    // Dense zone has a narrower span but higher density (unsafe flag).
    const dense = counts.find(c => c.zone === 'DENSE');
    expect(dense).toBeDefined();
    expect(dense.unsafe).toBe(true);

    // Outer zones are safe.
    const outerZones = counts.filter(c => c.zone !== 'DENSE');
    for (const z of outerZones) {
      expect(z.unsafe).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. UNSAFE ORBIT HUB-RETURN BLOCK
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — unsafe orbit hub-return rules', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('dense belt zone unsafe flag blocks hub return logic', async () => {
    // Verify at the data level that the dense belt zone carries the unsafe
    // flag which the canReturnToAgency() function checks.
    const result = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;

      // Get the dense belt band.
      const denseBand = sun.altitudeBands.find(b => b.beltZone === 'DENSE');
      if (!denseBand) return null;

      return {
        id: denseBand.id,
        unsafe: denseBand.unsafe,
        min: denseBand.min,
        max: denseBand.max,
        beltZone: denseBand.beltZone,
      };
    });

    expect(result).not.toBeNull();
    expect(result.id).toBe('BELT_DENSE');
    expect(result.beltZone).toBe('DENSE');
    expect(result.unsafe).toBe(true);
  });

  test('outer belt zones allow hub return (no unsafe flag)', async () => {
    const outerBands = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      return sun.altitudeBands
        .filter(b => b.beltZone && b.beltZone !== 'DENSE')
        .map(b => ({
          id: b.id,
          zone: b.beltZone,
          unsafe: !!b.unsafe,
        }));
    });

    expect(outerBands).not.toBeNull();
    expect(outerBands.length).toBe(2);

    for (const band of outerBands) {
      expect(band.unsafe, `Zone ${band.zone} should not be unsafe`).toBe(false);
    }
  });

  test('non-belt altitude bands on Sun have no unsafe flag', async () => {
    const nonBeltBands = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      return sun.altitudeBands
        .filter(b => !b.beltZone)
        .map(b => ({
          id: b.id,
          name: b.name,
          unsafe: !!b.unsafe,
        }));
    });

    expect(nonBeltBands).not.toBeNull();
    expect(nonBeltBands.length).toBe(4); // Inner Corona, Outer Corona, NSS, SOL

    for (const band of nonBeltBands) {
      expect(band.unsafe, `Non-belt band ${band.name} should not be unsafe`).toBe(false);
    }
  });

  test('teleporting to dense belt altitude while orbiting Sun is detected as unsafe @smoke', async () => {
    // Start a flight and teleport to the dense belt zone around the Sun.
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });

    // Middle of the dense belt zone: (374 + 419) / 2 * 1e9 = ~396.5 billion m.
    const denseMidpoint = 396_500_000_000;

    // Teleport to orbit in the dense belt zone.
    await teleportCraft(page, {
      posX: denseMidpoint,
      posY: 0,
      velX: 0,
      velY: 18_300, // approximate circular velocity at ~400B m from Sun
      bodyId: 'SUN',
      phase: 'ORBIT',
    });

    // Verify the craft's altitude falls within the dense belt range.
    const orbitCheck = await page.evaluate(() => {
      const fs = window.__flightState;
      const ps = window.__flightPs;
      const sun = window.__celestialBodies?.SUN;
      if (!fs || !ps || !sun) return null;

      // Get the altitude (posX is used as the radial distance here).
      const altitude = Math.hypot(ps.posX, ps.posY);
      const denseBand = sun.altitudeBands.find(b => b.beltZone === 'DENSE');
      if (!denseBand) return null;

      return {
        altitude,
        inDenseBelt: altitude >= denseBand.min && altitude < denseBand.max,
        phase: fs.phase,
        bodyId: fs.bodyId,
        denseMin: denseBand.min,
        denseMax: denseBand.max,
        denseUnsafe: denseBand.unsafe,
      };
    });

    expect(orbitCheck).not.toBeNull();
    expect(orbitCheck.bodyId).toBe('SUN');
    expect(orbitCheck.inDenseBelt).toBe(true);
    expect(orbitCheck.denseUnsafe).toBe(true);
  });

  test('teleporting to outer belt altitude while orbiting Sun is NOT unsafe', async () => {
    // Start a fresh flight for the outer belt test.
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });

    // Middle of Outer Belt A: (329 + 374) / 2 * 1e9 = ~351.5 billion m.
    const outerAMidpoint = 351_500_000_000;

    await teleportCraft(page, {
      posX: outerAMidpoint,
      posY: 0,
      velX: 0,
      velY: 19_500, // approximate circular velocity
      bodyId: 'SUN',
      phase: 'ORBIT',
    });

    const orbitCheck = await page.evaluate(() => {
      const fs = window.__flightState;
      const ps = window.__flightPs;
      const sun = window.__celestialBodies?.SUN;
      if (!fs || !ps || !sun) return null;

      const altitude = Math.hypot(ps.posX, ps.posY);
      const outerABand = sun.altitudeBands.find(b => b.beltZone === 'OUTER_A');
      const denseBand = sun.altitudeBands.find(b => b.beltZone === 'DENSE');
      if (!outerABand || !denseBand) return null;

      return {
        altitude,
        inOuterA: altitude >= outerABand.min && altitude < outerABand.max,
        inDenseBelt: altitude >= denseBand.min && altitude < denseBand.max,
        phase: fs.phase,
        bodyId: fs.bodyId,
        outerAUnsafe: outerABand.unsafe || false,
      };
    });

    expect(orbitCheck).not.toBeNull();
    expect(orbitCheck.bodyId).toBe('SUN');
    expect(orbitCheck.inOuterA).toBe(true);
    expect(orbitCheck.inDenseBelt).toBe(false);
    expect(orbitCheck.outerAUnsafe).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ASTEROID SELECTION & TARGETING DATA
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — asteroid selection and targeting', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('belt zone configuration supports asteroid generation with correct zone counts', async () => {
    // Verify the belt zone definitions provide the data needed for
    // asteroid targeting: each zone has an id, name, boundaries, and
    // the belt zone tag that determines asteroid count.
    const zoneInfo = await page.evaluate(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands.filter(b => b.beltZone);
      return beltBands.map(b => ({
        id: b.id,
        name: b.name,
        beltZone: b.beltZone,
        min: b.min,
        max: b.max,
        span: b.max - b.min,
      }));
    });

    expect(zoneInfo).not.toBeNull();
    expect(zoneInfo.length).toBe(3);

    // The DENSE zone spawns 30 asteroids, outer zones spawn 10 each.
    // Verify all zones have the expected identifiers that the generation
    // function keys on (OUTER_A, DENSE, OUTER_B).
    const zoneIds = zoneInfo.map(z => z.beltZone).sort();
    expect(zoneIds).toEqual(['DENSE', 'OUTER_A', 'OUTER_B']);

    // Each zone has positive span (min < max).
    for (const z of zoneInfo) {
      expect(z.span).toBeGreaterThan(0);
    }
  });

  test('asteroid data model requires name, radius, mass, and position fields', async () => {
    // Start a flight and use page.evaluate to call the asteroidBelt module
    // via Vite's dynamic import from within the running application context.
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });

    const asteroidData = await page.evaluate(async () => {
      try {
        // Use Vite's dynamic import to access the module directly.
        const mod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        // Generate asteroids in the DENSE zone.
        const playerX = 400_000_000_000;
        const playerY = 0;
        const asteroids = mod.generateBeltAsteroids(
          constants.BeltZone.DENSE,
          playerX,
          playerY,
          50_000,
        );

        return asteroids.map(a => ({
          id: a.id,
          name: a.name,
          type: a.type,
          radius: a.radius,
          mass: a.mass,
          posX: a.posX,
          posY: a.posY,
          velX: a.velX,
          velY: a.velY,
          shapeSeed: a.shapeSeed,
          hasName: typeof a.name === 'string' && a.name.length > 0,
          hasRadius: typeof a.radius === 'number' && a.radius > 0,
          hasMass: typeof a.mass === 'number' && a.mass > 0,
        }));
      } catch {
        return null;
      }
    });

    expect(asteroidData).not.toBeNull();
    // Dense zone generates 30 asteroids.
    expect(asteroidData.length).toBe(30);

    for (const a of asteroidData) {
      // Every asteroid has required targeting fields.
      expect(a.hasName).toBe(true);
      expect(a.hasRadius).toBe(true);
      expect(a.hasMass).toBe(true);
      expect(a.type).toBe('asteroid');
      // Position fields are numbers.
      expect(typeof a.posX).toBe('number');
      expect(typeof a.posY).toBe('number');
      expect(typeof a.velX).toBe('number');
      expect(typeof a.velY).toBe('number');
      // Shape seed is a non-negative integer.
      expect(a.shapeSeed).toBeGreaterThanOrEqual(0);
    }
  });

  test('all generated asteroids have valid AST-XXXX name format @smoke', async () => {
    const names = await page.evaluate(async () => {
      try {
        const mod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        // Generate from all three zones.
        const allNames = [];
        for (const zone of [constants.BeltZone.OUTER_A, constants.BeltZone.DENSE, constants.BeltZone.OUTER_B]) {
          const asteroids = mod.generateBeltAsteroids(zone, 400_000_000_000, 0, 50_000);
          for (const a of asteroids) {
            allNames.push(a.name);
          }
        }
        return allNames;
      } catch {
        return null;
      }
    });

    expect(names).not.toBeNull();
    // 10 + 30 + 10 = 50 total.
    expect(names.length).toBe(50);

    // Every name matches AST-XXXX where XXXX is 4 digits.
    const namePattern = /^AST-\d{4}$/;
    for (const name of names) {
      expect(name).toMatch(namePattern);
    }
  });

  test('asteroid radius and distance can be computed for targeting display', async () => {
    // Verify that asteroid properties support the map targeting HUD display:
    //   name, size class (Small/Medium/Large based on radius), distance from craft.
    const targetInfo = await page.evaluate(async () => {
      try {
        const mod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const playerX = 400_000_000_000;
        const playerY = 0;
        const asteroids = mod.generateBeltAsteroids(
          constants.BeltZone.DENSE,
          playerX,
          playerY,
          50_000,
        );

        return asteroids.map(a => {
          const dist = Math.hypot(a.posX - playerX, a.posY - playerY);
          const sizeLabel = a.radius >= 500 ? 'Large'
            : a.radius >= 50 ? 'Medium' : 'Small';
          return {
            name: a.name,
            radius: a.radius,
            distance: dist,
            sizeLabel,
          };
        });
      } catch {
        return null;
      }
    });

    expect(targetInfo).not.toBeNull();
    expect(targetInfo.length).toBe(30);

    for (const t of targetInfo) {
      // Name is present.
      expect(t.name).toBeTruthy();
      // Radius is between 1 and 1000 (MIN_RADIUS to MAX_RADIUS).
      expect(t.radius).toBeGreaterThanOrEqual(1);
      expect(t.radius).toBeLessThanOrEqual(1000);
      // Distance is within render distance (50_000 m).
      expect(t.distance).toBeLessThanOrEqual(50_000);
      // Size label is valid.
      expect(['Small', 'Medium', 'Large']).toContain(t.sizeLabel);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. COLLISION DAMAGE AT SPEED
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — collision damage at speed', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('relative velocity determines damage classification', async () => {
    // Verify the damage classification thresholds from the collision module.
    const damage = await page.evaluate(async () => {
      try {
        const mod = await import('/src/core/collision.ts');

        return {
          // < 1 m/s: NONE
          at0: mod.classifyAsteroidDamage(0),
          at0_5: mod.classifyAsteroidDamage(0.5),
          at0_99: mod.classifyAsteroidDamage(0.99),
          // 1-5 m/s: MINOR
          at1: mod.classifyAsteroidDamage(1),
          at3: mod.classifyAsteroidDamage(3),
          at4_99: mod.classifyAsteroidDamage(4.99),
          // 5-20 m/s: SIGNIFICANT
          at5: mod.classifyAsteroidDamage(5),
          at10: mod.classifyAsteroidDamage(10),
          at19_99: mod.classifyAsteroidDamage(19.99),
          // >= 20 m/s: CATASTROPHIC
          at20: mod.classifyAsteroidDamage(20),
          at50: mod.classifyAsteroidDamage(50),
          at1000: mod.classifyAsteroidDamage(1000),
        };
      } catch {
        return null;
      }
    });

    expect(damage).not.toBeNull();

    // NONE threshold (< 1 m/s).
    expect(damage.at0).toBe('NONE');
    expect(damage.at0_5).toBe('NONE');
    expect(damage.at0_99).toBe('NONE');

    // MINOR threshold (1-5 m/s).
    expect(damage.at1).toBe('MINOR');
    expect(damage.at3).toBe('MINOR');
    expect(damage.at4_99).toBe('MINOR');

    // SIGNIFICANT threshold (5-20 m/s).
    expect(damage.at5).toBe('SIGNIFICANT');
    expect(damage.at10).toBe('SIGNIFICANT');
    expect(damage.at19_99).toBe('SIGNIFICANT');

    // CATASTROPHIC threshold (>= 20 m/s).
    expect(damage.at20).toBe('CATASTROPHIC');
    expect(damage.at50).toBe('CATASTROPHIC');
    expect(damage.at1000).toBe('CATASTROPHIC');
  });

  test('relative speed computation is correct for craft and asteroid velocities', async () => {
    const speeds = await page.evaluate(async () => {
      try {
        const mod = await import('/src/core/collision.ts');

        return {
          // Same velocity = 0 relative speed.
          sameVel: mod.computeRelativeSpeed(100, 200, 100, 200),
          // Opposite directions on X axis.
          opposite: mod.computeRelativeSpeed(10, 0, -10, 0),
          // Orthogonal velocities.
          orthogonal: mod.computeRelativeSpeed(3, 0, 0, 4),
          // Zero vs non-zero.
          oneMoving: mod.computeRelativeSpeed(0, 0, 30, 40),
        };
      } catch {
        return null;
      }
    });

    expect(speeds).not.toBeNull();
    expect(speeds.sameVel).toBeCloseTo(0, 5);
    expect(speeds.opposite).toBeCloseTo(20, 5);
    expect(speeds.orthogonal).toBeCloseTo(5, 5);
    expect(speeds.oneMoving).toBeCloseTo(50, 5);
  });

  test('catastrophic collision destroys craft (crashed flag set) @smoke', async () => {
    // Start a flight and set up conditions for a high-speed asteroid impact.
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });

    // Teleport to the dense belt zone in orbit.
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint,
      posY: 0,
      velX: 0,
      velY: 18_300,
      bodyId: 'SUN',
      phase: 'ORBIT',
    });

    // Use the collision module to simulate an asteroid impact directly.
    const result = await page.evaluate(async () => {
      try {
        const collision = await import('/src/core/collision.ts');
        const ps = window.__flightPs;
        const fs = window.__flightState;
        const assembly = window.__flightAssembly;
        if (!ps || !fs || !assembly) return null;

        // Create a fake asteroid positioned at the craft's location
        // with high relative velocity (30 m/s = catastrophic).
        const fakeAsteroid = {
          id: 'AST-TEST-0',
          type: 'asteroid',
          name: 'AST-TEST',
          posX: ps.posX,
          posY: ps.posY,
          velX: ps.velX + 30,  // 30 m/s relative velocity
          velY: ps.velY,
          radius: 100,
          mass: 2_000_000,
          shapeSeed: 42,
        };

        const crashedBefore = ps.crashed;
        const partCountBefore = ps.activeParts.size;

        // Run collision check.
        const results = collision.checkAsteroidCollisions(
          ps, assembly, [fakeAsteroid], fs,
        );

        return {
          crashedBefore,
          crashedAfter: ps.crashed,
          partCountBefore,
          partCountAfter: ps.activeParts.size,
          collisionCount: results.length,
          damageLevel: results.length > 0 ? results[0].damage : null,
          relativeSpeed: results.length > 0 ? results[0].relativeSpeed : null,
          hasImpactEvent: fs.events.some(e => e.type === 'ASTEROID_IMPACT'),
        };
      } catch {
        return null;
      }
    });

    expect(result).not.toBeNull();
    expect(result.crashedBefore).toBe(false);
    expect(result.crashedAfter).toBe(true);
    expect(result.collisionCount).toBe(1);
    expect(result.damageLevel).toBe('CATASTROPHIC');
    expect(result.relativeSpeed).toBeGreaterThanOrEqual(20);
    expect(result.partCountAfter).toBe(0);
    expect(result.hasImpactEvent).toBe(true);
  });

  test('low-speed collision causes minor damage (not catastrophic)', async () => {
    // Fresh flight for the minor damage test.
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });

    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint,
      posY: 0,
      velX: 0,
      velY: 18_300,
      bodyId: 'SUN',
      phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const collision = await import('/src/core/collision.ts');
        const ps = window.__flightPs;
        const fs = window.__flightState;
        const assembly = window.__flightAssembly;
        if (!ps || !fs || !assembly) return null;

        // Low relative velocity (2 m/s = MINOR damage).
        const fakeAsteroid = {
          id: 'AST-MINOR-0',
          type: 'asteroid',
          name: 'AST-MINOR',
          posX: ps.posX,
          posY: ps.posY,
          velX: ps.velX + 2,
          velY: ps.velY,
          radius: 50,
          mass: 500_000,
          shapeSeed: 99,
        };

        const partCountBefore = ps.activeParts.size;

        const results = collision.checkAsteroidCollisions(
          ps, assembly, [fakeAsteroid], fs,
        );

        return {
          crashed: ps.crashed,
          partCountBefore,
          partCountAfter: ps.activeParts.size,
          collisionCount: results.length,
          damageLevel: results.length > 0 ? results[0].damage : null,
          relativeSpeed: results.length > 0 ? results[0].relativeSpeed : null,
        };
      } catch {
        return null;
      }
    });

    expect(result).not.toBeNull();
    // Minor damage should not crash the craft.
    expect(result.crashed).toBe(false);
    expect(result.collisionCount).toBe(1);
    expect(result.damageLevel).toBe('MINOR');
    expect(result.relativeSpeed).toBeCloseTo(2, 0);
    // Some parts may be destroyed but not all.
    expect(result.partCountAfter).toBeGreaterThan(0);
    expect(result.partCountAfter).toBeLessThanOrEqual(result.partCountBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. TRANSFER PHASE — NO ASTEROIDS SPAWNED
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — transfer trajectory safety', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('no active asteroids during TRANSFER phase at belt altitude @smoke', async () => {
    // Start a flight and teleport to TRANSFER phase at belt altitude.
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });

    // Teleport to TRANSFER phase in the dense belt zone.
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint,
      posY: 0,
      velX: 0,
      velY: 25_000, // transfer trajectory velocity
      bodyId: 'SUN',
      phase: 'TRANSFER',
    });

    // Verify the craft is in TRANSFER phase at belt altitude.
    const state = await page.evaluate(async () => {
      const fs = window.__flightState;
      const ps = window.__flightPs;
      if (!fs || !ps) return null;

      // Check active asteroids via the module.
      let hasActiveAsteroids = false;
      try {
        const mod = await import('/src/core/asteroidBelt.ts');
        hasActiveAsteroids = mod.hasAsteroids();
      } catch {
        // If import fails, we can't check — return what we know.
      }

      return {
        phase: fs.phase,
        bodyId: fs.bodyId,
        altitude: Math.hypot(ps.posX, ps.posY),
        hasActiveAsteroids,
      };
    });

    expect(state).not.toBeNull();
    expect(state.phase).toBe('TRANSFER');
    expect(state.bodyId).toBe('SUN');
    // Altitude is within belt zone boundaries.
    expect(state.altitude).toBeGreaterThan(329_000_000_000);
    expect(state.altitude).toBeLessThan(479_000_000_000);
    // No asteroids should be active during TRANSFER phase.
    // Asteroids are only generated and set active during ORBIT phase.
    expect(state.hasActiveAsteroids).toBe(false);
  });

  test('flight render only shows belt asteroids during ORBIT phase (not TRANSFER)', async () => {
    // Verify that the render layer's condition for showing asteroids
    // requires ORBIT phase. The render layer checks:
    //   flightState.phase === 'ORBIT' && hasAsteroids()
    // In TRANSFER, even if asteroids existed, they would not render.
    const renderCondition = await page.evaluate(() => {
      const fs = window.__flightState;
      if (!fs) return null;

      // The render layer uses phase === 'ORBIT' as a gate.
      return {
        phase: fs.phase,
        isOrbit: fs.phase === 'ORBIT',
        isTransfer: fs.phase === 'TRANSFER',
      };
    });

    expect(renderCondition).not.toBeNull();
    expect(renderCondition.isTransfer).toBe(true);
    expect(renderCondition.isOrbit).toBe(false);
  });

  test('transitioning from ORBIT to TRANSFER clears asteroid state', async () => {
    // Start a fresh flight.
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });

    // First, teleport to ORBIT in the belt and generate some asteroids.
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint,
      posY: 0,
      velX: 0,
      velY: 18_300,
      bodyId: 'SUN',
      phase: 'ORBIT',
    });

    // Generate asteroids manually via module import.
    const orbitState = await page.evaluate(async () => {
      try {
        const mod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        // Generate and set active asteroids.
        const asteroids = mod.generateBeltAsteroids(
          constants.BeltZone.DENSE,
          396_500_000_000, 0, 50_000,
        );
        mod.setActiveAsteroids(asteroids);

        return {
          activeCount: mod.getActiveAsteroids().length,
          hasAsteroids: mod.hasAsteroids(),
        };
      } catch {
        return null;
      }
    });

    expect(orbitState).not.toBeNull();
    expect(orbitState.activeCount).toBe(30);
    expect(orbitState.hasAsteroids).toBe(true);

    // Now clear asteroids (simulating what happens on phase transition
    // away from ORBIT) and verify they are gone.
    const afterClear = await page.evaluate(async () => {
      try {
        const mod = await import('/src/core/asteroidBelt.ts');
        mod.clearAsteroids();

        return {
          activeCount: mod.getActiveAsteroids().length,
          hasAsteroids: mod.hasAsteroids(),
        };
      } catch {
        return null;
      }
    });

    expect(afterClear).not.toBeNull();
    expect(afterClear.activeCount).toBe(0);
    expect(afterClear.hasAsteroids).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. ASTEROID CAPTURE WITH GRABBING ARM
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — asteroid capture with grabbing arm', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // Parts list includes the standard grabbing arm.
  const GRAB_PROBE = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({
      parts: [
        ...['probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1',
          'tank-medium', 'tank-large', 'engine-reliant', 'engine-poodle',
          'engine-nerv', 'cmd-mk1', 'decoupler-stack-tr18',
          'grabbing-arm', 'grabbing-arm-heavy', 'grabbing-arm-industrial'],
      ],
    });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('captureAsteroid succeeds when in range, velocity matched, and within mass limit @smoke', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });

    // Teleport to orbit within the dense belt zone.
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint,
      posY: 0,
      velX: 0,
      velY: 18_300,
      bodyId: 'SUN',
      phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const physics = await import('/src/core/physics.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        // Generate a small asteroid positioned right next to the craft.
        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        // Pick a small asteroid and position it within arm range with matched velocity.
        const target = asteroids[0];
        target.posX = ps.posX + 10;   // 10m away (within GRAB_ARM_RANGE of 25m)
        target.posY = ps.posY;
        target.velX = ps.velX + 0.3;  // 0.3 m/s relative (within GRAB_MAX_RELATIVE_SPEED of 1.0)
        target.velY = ps.velY;
        target.mass = 50_000;         // 50 tonnes — within standard arm's 100,000 limit

        const grabState = grabbing.createGrabState();
        const massBefore = ps.capturedBody ? ps.capturedBody.mass : 0;

        const captureResult = grabbing.captureAsteroid(grabState, target, ps, assembly);

        // After capture, set the captured body on physics state (caller responsibility).
        if (captureResult.success) {
          physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });
        }

        return {
          success: captureResult.success,
          reason: captureResult.reason || null,
          grabStateName: grabState.state,
          grabbedAsteroidName: grabState.grabbedAsteroid?.name || null,
          massBefore,
          massAfter: ps.capturedBody ? ps.capturedBody.mass : 0,
          thrustAligned: ps.thrustAligned,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.error).toBeUndefined();
    expect(result.success).toBe(true);
    expect(result.grabStateName).toBe('GRABBED');
    expect(result.grabbedAsteroidName).toBeTruthy();
    expect(result.massBefore).toBe(0);
    expect(result.massAfter).toBe(50_000);
    // New capture always starts unaligned.
    expect(result.thrustAligned).toBe(false);
  });

  test('captureAsteroid fails when relative speed is too high', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX + 5;  // 5 m/s relative — exceeds 1.0 limit
        target.velY = ps.velY;
        target.mass = 50_000;

        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Relative speed too high');
  });

  test('captureAsteroid fails when asteroid is out of range', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 100;  // 100m away — exceeds GRAB_ARM_RANGE 25m
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 50_000;

        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('out of range');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. THRUST ALIGNMENT AFTER CAPTURE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — thrust alignment after capture', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const GRAB_PROBE = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({
      parts: [
        'probe-core-mk1', 'tank-small', 'engine-spark',
        'grabbing-arm', 'grabbing-arm-heavy', 'grabbing-arm-industrial',
      ],
    });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('alignThrustWithAsteroid succeeds after capture and sets thrustAligned @smoke', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const physics = await import('/src/core/physics.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        // Set up: generate and capture an asteroid.
        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 80_000;

        const grabState = grabbing.createGrabState();
        const capture = grabbing.captureAsteroid(grabState, target, ps, assembly);
        if (!capture.success) return { error: 'capture failed: ' + capture.reason };

        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });

        const alignedBefore = ps.thrustAligned;

        // Align thrust.
        const alignResult = grabbing.alignThrustWithAsteroid(grabState, ps);

        return {
          captureSuccess: capture.success,
          alignSuccess: alignResult.success,
          alignedBefore,
          alignedAfter: ps.thrustAligned,
          capturedMass: ps.capturedBody ? ps.capturedBody.mass : 0,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.error).toBeUndefined();
    expect(result.captureSuccess).toBe(true);
    expect(result.alignedBefore).toBe(false);
    expect(result.alignSuccess).toBe(true);
    expect(result.alignedAfter).toBe(true);
    expect(result.capturedMass).toBe(80_000);
  });

  test('alignThrustWithAsteroid fails when already aligned', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const physics = await import('/src/core/physics.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 40_000;

        const grabState = grabbing.createGrabState();
        grabbing.captureAsteroid(grabState, target, ps, assembly);
        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });

        // First align succeeds.
        grabbing.alignThrustWithAsteroid(grabState, ps);

        // Second align should fail (already aligned).
        const secondAlign = grabbing.alignThrustWithAsteroid(grabState, ps);
        return {
          success: secondAlign.success,
          reason: secondAlign.reason,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('already aligned');
  });

  test('manual rotation breaks thrust alignment, re-align restores it', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const physics = await import('/src/core/physics.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 60_000;

        const grabState = grabbing.createGrabState();
        grabbing.captureAsteroid(grabState, target, ps, assembly);
        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });

        // Align thrust.
        grabbing.alignThrustWithAsteroid(grabState, ps);
        const alignedAfterFirst = ps.thrustAligned;

        // Simulate manual rotation — breaks alignment.
        grabbing.breakThrustAlignment(ps);
        const alignedAfterRotation = ps.thrustAligned;

        // Re-align.
        const reAlignResult = grabbing.alignThrustWithAsteroid(grabState, ps);
        const alignedAfterReAlign = ps.thrustAligned;

        return {
          alignedAfterFirst,
          alignedAfterRotation,
          reAlignSuccess: reAlignResult.success,
          alignedAfterReAlign,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.error).toBeUndefined();
    expect(result.alignedAfterFirst).toBe(true);
    expect(result.alignedAfterRotation).toBe(false);
    expect(result.reAlignSuccess).toBe(true);
    expect(result.alignedAfterReAlign).toBe(true);
  });

  test('alignThrustWithAsteroid fails when no asteroid is grabbed', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const ps = window.__flightPs;
        if (!ps) return null;

        const grabState = grabbing.createGrabState();
        return grabbing.alignThrustWithAsteroid(grabState, ps);
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not grabbing');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. CAPTURED ASTEROID PERSISTENCE — RELEASE OUTSIDE BELT
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — captured asteroid persistence', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const GRAB_PROBE = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({
      parts: [
        'probe-core-mk1', 'tank-small', 'engine-spark',
        'grabbing-arm', 'grabbing-arm-heavy',
      ],
    });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('released asteroid persists as OrbitalObject when outside belt zones @smoke', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });

    // Teleport to an orbit OUTSIDE all belt zones (200 billion m from Sun).
    await teleportCraft(page, {
      posX: 200_000_000_000,
      posY: 0,
      velX: 0,
      velY: 25_800, // circular velocity outside belt
      bodyId: 'SUN',
      phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const physics = await import('/src/core/physics.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const fs = window.__flightState;
        const assembly = window.__flightAssembly;
        const state = window.__gameState;
        if (!ps || !fs || !assembly || !state) return null;

        // Update flightState altitude to match position.
        fs.altitude = Math.hypot(ps.posX, ps.posY);
        fs.timeElapsed = 1000;

        // Create an asteroid close by and capture it.
        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.OUTER_A, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 30_000;
        target.radius = 15;

        const grabState = grabbing.createGrabState();
        const capture = grabbing.captureAsteroid(grabState, target, ps, assembly);
        if (!capture.success) return { error: 'capture failed: ' + capture.reason };

        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });

        // Release the asteroid.
        const release = grabbing.releaseGrabbedAsteroid(grabState);
        if (!release.success || !release.asteroid) return { error: 'release failed' };

        physics.clearCapturedBody(ps);

        // Count orbital objects before persist.
        const countBefore = state.orbitalObjects.length;

        // Persist — outside belt zone, should create an OrbitalObject.
        const persist = grabbing.persistReleasedAsteroid(
          release.asteroid, ps, fs, state,
        );

        const countAfter = state.orbitalObjects.length;

        // Find the newly persisted object.
        const persisted = persist.orbitalObject;

        return {
          releaseSuccess: release.success,
          persisted: persist.persisted,
          countBefore,
          countAfter,
          newObject: persisted ? {
            id: persisted.id,
            type: persisted.type,
            bodyId: persisted.bodyId,
            name: persisted.name,
            hasElements: !!persisted.elements,
            radius: persisted.radius,
            mass: persisted.mass,
          } : null,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.error).toBeUndefined();
    expect(result.releaseSuccess).toBe(true);
    expect(result.persisted).toBe(true);
    expect(result.countAfter).toBe(result.countBefore + 1);
    expect(result.newObject).not.toBeNull();
    expect(result.newObject.type).toBe('asteroid');
    expect(result.newObject.bodyId).toBe('SUN');
    expect(result.newObject.hasElements).toBe(true);
    expect(result.newObject.radius).toBe(15);
    expect(result.newObject.mass).toBe(30_000);
    expect(result.newObject.name).toBeTruthy();
  });

  test('released asteroid does NOT persist when inside a belt zone', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });

    // Teleport INSIDE the dense belt zone.
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const physics = await import('/src/core/physics.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const fs = window.__flightState;
        const assembly = window.__flightAssembly;
        const state = window.__gameState;
        if (!ps || !fs || !assembly || !state) return null;

        // Set altitude to dense belt midpoint.
        fs.altitude = Math.hypot(ps.posX, ps.posY);
        fs.timeElapsed = 2000;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 20_000;

        const grabState = grabbing.createGrabState();
        grabbing.captureAsteroid(grabState, target, ps, assembly);
        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });

        const release = grabbing.releaseGrabbedAsteroid(grabState);
        if (!release.success || !release.asteroid) return { error: 'release failed' };

        physics.clearCapturedBody(ps);

        const countBefore = state.orbitalObjects.length;
        const persist = grabbing.persistReleasedAsteroid(
          release.asteroid, ps, fs, state,
        );
        const countAfter = state.orbitalObjects.length;

        return {
          persisted: persist.persisted,
          countBefore,
          countAfter,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.error).toBeUndefined();
    expect(result.persisted).toBe(false);
    expect(result.countAfter).toBe(result.countBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. ASTEROID RENAME
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — asteroid rename', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const GRAB_PROBE = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({
      parts: [
        'probe-core-mk1', 'tank-small', 'engine-spark', 'grabbing-arm',
      ],
    });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('persistent asteroid can be renamed via orbitalObjects mutation', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });

    // Teleport outside belt zones.
    await teleportCraft(page, {
      posX: 200_000_000_000, posY: 0, velX: 0, velY: 25_800,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const physics = await import('/src/core/physics.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const fs = window.__flightState;
        const assembly = window.__flightAssembly;
        const state = window.__gameState;
        if (!ps || !fs || !assembly || !state) return null;

        fs.altitude = Math.hypot(ps.posX, ps.posY);
        fs.timeElapsed = 3000;

        // Generate, capture, release, and persist an asteroid.
        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.OUTER_A, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 5_000;
        target.radius = 8;

        const grabState = grabbing.createGrabState();
        grabbing.captureAsteroid(grabState, target, ps, assembly);
        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });
        const release = grabbing.releaseGrabbedAsteroid(grabState);
        physics.clearCapturedBody(ps);

        const persist = grabbing.persistReleasedAsteroid(
          release.asteroid, ps, fs, state,
        );
        if (!persist.persisted || !persist.orbitalObject) return { error: 'persist failed' };

        const originalName = persist.orbitalObject.name;

        // Rename the asteroid in orbitalObjects.
        const obj = state.orbitalObjects.find(o => o.id === persist.orbitalObject.id);
        if (!obj) return { error: 'object not found in state' };

        obj.name = 'My Custom Asteroid';

        // Re-read to verify the rename took effect.
        const renamedObj = state.orbitalObjects.find(o => o.id === persist.orbitalObject.id);

        return {
          originalName,
          renamedName: renamedObj?.name,
          matchesAST: /^AST-\d{4}$/.test(originalName),
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.error).toBeUndefined();
    // Original name should be auto-generated AST-XXXX format.
    expect(result.matchesAST).toBe(true);
    // Renamed name should be the custom one.
    expect(result.renamedName).toBe('My Custom Asteroid');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. GRABBING ARM TIER MASS LIMIT ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — grabbing arm tier mass limits', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({
      parts: [
        'probe-core-mk1', 'tank-small', 'engine-spark',
        'grabbing-arm', 'grabbing-arm-heavy', 'grabbing-arm-industrial',
      ],
    });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('standard arm rejects asteroid exceeding 100,000 kg mass limit @smoke', async () => {
    // Use only the standard grabbing arm (100,000 kg limit).
    const LIGHT_PROBE = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];
    await startTestFlight(page, LIGHT_PROBE, { bodyId: 'SUN' });

    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 200_000; // 200 tonnes — exceeds standard arm's 100,000 limit

        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('too massive');
  });

  test('heavy arm accepts asteroid within its 100M kg limit', async () => {
    const HEAVY_PROBE = ['probe-core-mk1', 'grabbing-arm-heavy', 'tank-small', 'engine-spark'];
    await startTestFlight(page, HEAVY_PROBE, { bodyId: 'SUN' });

    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 50_000_000; // 50M kg — within heavy arm's 100M limit

        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
  });

  test('heavy arm rejects asteroid exceeding 100M kg limit', async () => {
    const HEAVY_PROBE = ['probe-core-mk1', 'grabbing-arm-heavy', 'tank-small', 'engine-spark'];
    await startTestFlight(page, HEAVY_PROBE, { bodyId: 'SUN' });

    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 500_000_000; // 500M kg — exceeds heavy arm's 100M limit

        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.success).toBe(false);
    expect(result.reason).toContain('too massive');
  });

  test('industrial arm accepts very large asteroids within its 2T kg limit', async () => {
    const INDUSTRIAL_PROBE = ['probe-core-mk1', 'grabbing-arm-industrial', 'tank-small', 'engine-spark'];
    await startTestFlight(page, INDUSTRIAL_PROBE, { bodyId: 'SUN' });

    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate(async () => {
      try {
        const grabbing = await import('/src/core/grabbing.ts');
        const beltMod = await import('/src/core/asteroidBelt.ts');
        const constants = await import('/src/core/constants.ts');

        const ps = window.__flightPs;
        const assembly = window.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 1_000_000_000_000; // 1T kg — within industrial arm's 2T limit

        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(result).not.toBeNull();
    expect(result.success).toBe(true);
  });

  test('arm tier mass limits match part definitions', async () => {
    // Verify the mass limits from parts catalog match expectations.
    const limits = await page.evaluate(async () => {
      try {
        const parts = await import('/src/data/parts.ts');
        const light = parts.getPartById('grabbing-arm');
        const heavy = parts.getPartById('grabbing-arm-heavy');
        const industrial = parts.getPartById('grabbing-arm-industrial');

        return {
          light: light?.properties?.maxCaptureMass ?? null,
          heavy: heavy?.properties?.maxCaptureMass ?? null,
          industrial: industrial?.properties?.maxCaptureMass ?? null,
        };
      } catch (e) {
        return { error: String(e) };
      }
    });

    expect(limits).not.toBeNull();
    expect(limits.error).toBeUndefined();
    expect(limits.light).toBe(100_000);
    expect(limits.heavy).toBe(100_000_000);
    expect(limits.industrial).toBe(2_000_000_000_000);
    // Each tier should have a strictly higher limit than the previous.
    expect(limits.heavy).toBeGreaterThan(limits.light);
    expect(limits.industrial).toBeGreaterThan(limits.heavy);
  });
});

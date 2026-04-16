/**
 * asteroid-belt.spec.ts — E2E tests for the asteroid belt system.
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

import { test, expect, type Page } from '@playwright/test';
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

const PROBE: string[] = ['probe-core-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Belt zone expected values (from src/data/bodies.ts Sun altitudeBands).
// ---------------------------------------------------------------------------

interface ExpectedBeltZone {
  id: string;
  name: string;
  beltZone: string;
  min: number;
  max: number;
  unsafe: boolean;
}

const EXPECTED_BELT_ZONES: ExpectedBeltZone[] = [
  { id: 'BELT_OUTER_A', name: 'Outer Belt A', beltZone: 'OUTER_A', min: 329_000_000_000, max: 374_000_000_000, unsafe: false },
  { id: 'BELT_DENSE',   name: 'Dense Belt',   beltZone: 'DENSE',   min: 374_000_000_000, max: 419_000_000_000, unsafe: true  },
  { id: 'BELT_OUTER_B', name: 'Outer Belt B', beltZone: 'OUTER_B', min: 419_000_000_000, max: 479_000_000_000, unsafe: false },
];

// ---------------------------------------------------------------------------
// Browser-context type aliases (used as callback parameter annotations
// inside page.evaluate).  The window.d.ts augmentation makes game globals
// available on `window` directly — no cast needed.
// ---------------------------------------------------------------------------

interface AltitudeBand {
  id: string;
  name: string;
  min: number;
  max: number;
  beltZone?: string;
  unsafe?: boolean;
}

interface OrbitalObject {
  id: string;
  type: string;
  bodyId: string;
  name: string;
  elements?: unknown;
  radius?: number;
  mass?: number;
}

// ---------------------------------------------------------------------------
// Shared result interfaces for page.evaluate() return types
// ---------------------------------------------------------------------------

interface BeltBandInfo {
  id: string;
  name: string;
  min: number;
  max: number;
  beltZone: string;
  unsafe: boolean;
}

interface BeltBandMinimal {
  beltZone: string;
  min: number;
  max: number;
}

interface UnsafeStatus {
  zone: string;
  unsafe: boolean;
}

interface BeltRangeInfo {
  zone: string;
  minAU: number;
  maxAU: number;
}

interface ZoneCountInfo {
  zone: string;
  unsafe: boolean;
  span: number;
}

interface ZoneInfo {
  id: string;
  name: string;
  beltZone: string;
  min: number;
  max: number;
  span: number;
}

interface AsteroidDataItem {
  id: string;
  name: string;
  type: string;
  radius: number;
  mass: number;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  shapeSeed: number;
  hasName: boolean;
  hasRadius: boolean;
  hasMass: boolean;
}

interface TargetInfo {
  name: string;
  radius: number;
  distance: number;
  sizeLabel: string;
}

interface DamageClassification {
  at0: string;
  at0_5: string;
  at0_99: string;
  at1: string;
  at3: string;
  at4_99: string;
  at5: string;
  at10: string;
  at19_99: string;
  at20: string;
  at50: string;
  at1000: string;
}

interface RelativeSpeedResult {
  sameVel: number;
  opposite: number;
  orthogonal: number;
  oneMoving: number;
}

interface CatastrophicCollisionResult {
  crashedBefore: boolean;
  crashedAfter: boolean;
  partCountBefore: number;
  partCountAfter: number;
  collisionCount: number;
  damageLevel: string | null;
  relativeSpeed: number | null;
  hasImpactEvent: boolean;
}

interface MinorCollisionResult {
  crashed: boolean;
  partCountBefore: number;
  partCountAfter: number;
  collisionCount: number;
  damageLevel: string | null;
  relativeSpeed: number | null;
}

interface TransferPhaseState {
  phase: string;
  bodyId: string;
  altitude: number;
  hasActiveAsteroids: boolean;
}

interface RenderCondition {
  phase: string;
  isOrbit: boolean;
  isTransfer: boolean;
}

interface AsteroidCountState {
  activeCount: number;
  hasAsteroids: boolean;
}

interface CaptureResult {
  success: boolean;
  reason?: string | null;
  grabStateName?: string;
  grabbedAsteroidName?: string | null;
  massBefore?: number;
  massAfter?: number;
  thrustAligned?: boolean;
  error?: string;
}

interface CaptureSimpleResult {
  success: boolean;
  reason?: string | null;
  error?: string;
}

interface OrbitCheckResult {
  altitude: number;
  inDenseBelt: boolean;
  phase: string;
  bodyId: string;
  denseMin: number;
  denseMax: number;
  denseUnsafe: boolean;
}

interface OuterOrbitCheckResult {
  altitude: number;
  inOuterA: boolean;
  inDenseBelt: boolean;
  phase: string;
  bodyId: string;
  outerAUnsafe: boolean;
}

interface DenseBandResult {
  id: string;
  unsafe: boolean;
  min: number;
  max: number;
  beltZone: string;
}

interface OuterBandInfo {
  id: string;
  zone: string;
  unsafe: boolean;
}

interface NonBeltBandInfo {
  id: string;
  name: string;
  unsafe: boolean;
}

interface AlignmentResult {
  captureSuccess: boolean;
  alignSuccess: boolean;
  alignedBefore: boolean;
  alignedAfter: boolean;
  capturedMass: number;
  error?: string;
}

interface AlreadyAlignedResult {
  success: boolean;
  reason?: string;
  error?: string;
}

interface ReAlignResult {
  alignedAfterFirst: boolean;
  alignedAfterRotation: boolean;
  reAlignSuccess: boolean;
  alignedAfterReAlign: boolean;
  error?: string;
}

interface NoGrabAlignResult {
  success: boolean;
  reason?: string;
  error?: string;
}

interface PersistResult {
  releaseSuccess: boolean;
  persisted: boolean;
  countBefore: number;
  countAfter: number;
  newObject: {
    id: string;
    type: string;
    bodyId: string;
    name: string;
    hasElements: boolean;
    radius: number | undefined;
    mass: number | undefined;
  } | null;
  error?: string;
}

interface PersistInsideBeltResult {
  persisted: boolean;
  countBefore: number;
  countAfter: number;
  error?: string;
}

interface RenameResult {
  originalName: string;
  renamedName: string | undefined;
  matchesAST: boolean;
  error?: string;
}

interface MarsAndBeltResult {
  marsOrbitalDistance: number;
  minBeltAltitude: number;
}

interface ArmMassLimits {
  light: number | null;
  heavy: number | null;
  industrial: number | null;
  error?: string;
}

interface RangeCompareResult {
  success: boolean;
  reason: string | null;
  armReach?: number;
  error?: string;
}

interface CooldownResult {
  firstCallCount: number;
  firstDamage: string | null;
  secondCallCount: number;
  partCountBefore: number;
  partCountAfterFirst: number;
  partCountAfterSecond: number;
  crashedAfterFirst: boolean;
  crashedAfterSecond: boolean;
  noExtraDamage: boolean;
  error?: string;
}

interface ThrustAlignmentPhysicsResult {
  isUnalignedAfterCapture: boolean;
  isAlignedNow: boolean;
  angularVelUnaligned: number;
  angularVelAligned: number;
  unalignedHasRotation: boolean;
  alignedRotationSmaller: boolean;
  error?: string;
}

interface TechGateResult {
  hasStandardArm: boolean;
  hasHeavyArm: boolean;
  hasIndustrialArm: boolean;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ViteModule = Record<string, any>;

// ═══════════════════════════════════════════════════════════════════════════
// 1. BELT ZONE DATA VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — zone definitions', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ tutorialMode: false });
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('@smoke belt zones are defined on the Sun body with correct boundaries', async () => {
    await page.waitForFunction(
      () => window.__celestialBodies?.SUN?.altitudeBands?.length > 0,
      { timeout: 10_000 },
    );

    const beltInfo = await page.evaluate<BeltBandInfo[] | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands.filter((b: AltitudeBand) => b.beltZone);
      return beltBands.map((b: AltitudeBand) => ({
        id: b.id,
        name: b.name,
        min: b.min,
        max: b.max,
        beltZone: b.beltZone!,
        unsafe: b.unsafe || false,
      }));
    });

    expect(beltInfo).not.toBeNull();
    expect(beltInfo!.length).toBe(3);

    // Verify each zone exists with correct boundaries.
    for (const expected of EXPECTED_BELT_ZONES) {
      const actual = beltInfo!.find(b => b.beltZone === expected.beltZone);
      expect(actual, `Belt zone ${expected.beltZone} should exist`).toBeDefined();
      expect(actual!.id).toBe(expected.id);
      expect(actual!.name).toBe(expected.name);
      expect(actual!.min).toBe(expected.min);
      expect(actual!.max).toBe(expected.max);
    }
  });

  test('belt zones are contiguous (Outer A max === Dense min, Dense max === Outer B min)', async () => {
    const beltInfo = await page.evaluate<BeltBandMinimal[] | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands
        .filter((b: AltitudeBand) => b.beltZone)
        .sort((a: AltitudeBand, b: AltitudeBand) => a.min - b.min);
      return beltBands.map((b: AltitudeBand) => ({ beltZone: b.beltZone!, min: b.min, max: b.max }));
    });

    expect(beltInfo).not.toBeNull();
    expect(beltInfo!.length).toBe(3);

    // OUTER_A -> DENSE -> OUTER_B should be contiguous.
    const [outerA, dense, outerB] = beltInfo!;
    expect(outerA.beltZone).toBe('OUTER_A');
    expect(dense.beltZone).toBe('DENSE');
    expect(outerB.beltZone).toBe('OUTER_B');

    expect(outerA.max).toBe(dense.min);
    expect(dense.max).toBe(outerB.min);
  });

  test('dense belt zone is marked unsafe, outer zones are not', async () => {
    const unsafeStatus = await page.evaluate<UnsafeStatus[] | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands.filter((b: AltitudeBand) => b.beltZone);
      return beltBands.map((b: AltitudeBand) => ({ zone: b.beltZone!, unsafe: b.unsafe || false }));
    });

    expect(unsafeStatus).not.toBeNull();

    const dense = unsafeStatus!.find(b => b.zone === 'DENSE');
    const outerA = unsafeStatus!.find(b => b.zone === 'OUTER_A');
    const outerB = unsafeStatus!.find(b => b.zone === 'OUTER_B');

    expect(dense!.unsafe).toBe(true);
    expect(outerA!.unsafe).toBe(false);
    expect(outerB!.unsafe).toBe(false);
  });

  test('Sun has exactly 7 altitude bands (4 solar + 3 belt)', async () => {
    const bandCount = await page.evaluate<number>(() => {
      const sun = window.__celestialBodies?.SUN;
      return sun ? sun.altitudeBands.length : -1;
    });

    expect(bandCount).toBe(7);
  });

  test('belt zones sit beyond Mars orbital distance', async () => {
    const result = await page.evaluate<MarsAndBeltResult | null>(() => {
      const bodies = window.__celestialBodies;
      if (!bodies) return null;
      const mars = bodies.MARS;
      const sun = bodies.SUN;
      if (!mars || !sun) return null;
      const beltBands = sun.altitudeBands.filter((b: AltitudeBand) => b.beltZone);
      const minBeltAltitude = Math.min(...beltBands.map((b: AltitudeBand) => b.min));
      return {
        marsOrbitalDistance: mars.orbitalDistance!,
        minBeltAltitude,
      };
    });

    expect(result).not.toBeNull();
    // The innermost belt zone should start beyond Mars's orbital distance.
    expect(result!.minBeltAltitude).toBeGreaterThan(result!.marsOrbitalDistance);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. MAP RENDERING — BELT VISIBLE ON SOLAR SYSTEM MAP
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — solar system map visibility', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('Sun body definition includes belt data accessible from map', async () => {
    const hasBeltData = await page.evaluate<boolean>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return false;
      const beltBands = sun.altitudeBands.filter((b: AltitudeBand) => b.beltZone);
      return beltBands.length === 3;
    });

    expect(hasBeltData).toBe(true);
  });

  test('belt zone distance ranges are physically sensible (in metres, AU scale)', async () => {
    const ranges = await page.evaluate<BeltRangeInfo[] | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const AU = 149_597_870_700;
      const beltBands = sun.altitudeBands.filter((b: AltitudeBand) => b.beltZone);
      return beltBands.map((b: AltitudeBand) => ({
        zone: b.beltZone!,
        minAU: b.min / AU,
        maxAU: b.max / AU,
      }));
    });

    expect(ranges).not.toBeNull();
    for (const r of ranges!) {
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
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('asteroid count constants: dense zone spawns more than outer zones', async () => {
    await startTestFlight(page, PROBE, { bodyId: 'EARTH' });

    const counts = await page.evaluate<ZoneCountInfo[] | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands.filter((b: AltitudeBand) => b.beltZone);
      return beltBands.map((b: AltitudeBand) => ({
        zone: b.beltZone!,
        unsafe: b.unsafe || false,
        span: b.max - b.min,
      }));
    });

    expect(counts).not.toBeNull();
    expect(counts!.length).toBe(3);

    const dense = counts!.find(c => c.zone === 'DENSE');
    expect(dense).toBeDefined();
    expect(dense!.unsafe).toBe(true);

    const outerZones = counts!.filter(c => c.zone !== 'DENSE');
    for (const z of outerZones) {
      expect(z.unsafe).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. UNSAFE ORBIT HUB-RETURN BLOCK
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — unsafe orbit hub-return rules', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('dense belt zone unsafe flag blocks hub return logic', async () => {
    const result = await page.evaluate<DenseBandResult | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const denseBand = sun.altitudeBands.find((b: AltitudeBand) => b.beltZone === 'DENSE');
      if (!denseBand) return null;
      return {
        id: denseBand.id,
        unsafe: denseBand.unsafe!,
        min: denseBand.min,
        max: denseBand.max,
        beltZone: denseBand.beltZone!,
      };
    });

    expect(result).not.toBeNull();
    expect(result!.id).toBe('BELT_DENSE');
    expect(result!.beltZone).toBe('DENSE');
    expect(result!.unsafe).toBe(true);
  });

  test('outer belt zones allow hub return (no unsafe flag)', async () => {
    const outerBands = await page.evaluate<OuterBandInfo[] | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      return sun.altitudeBands
        .filter((b: AltitudeBand) => b.beltZone && b.beltZone !== 'DENSE')
        .map((b: AltitudeBand) => ({ id: b.id, zone: b.beltZone!, unsafe: !!b.unsafe }));
    });

    expect(outerBands).not.toBeNull();
    expect(outerBands!.length).toBe(2);
    for (const band of outerBands!) {
      expect(band.unsafe, `Zone ${band.zone} should not be unsafe`).toBe(false);
    }
  });

  test('non-belt altitude bands on Sun have no unsafe flag', async () => {
    const nonBeltBands = await page.evaluate<NonBeltBandInfo[] | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      return sun.altitudeBands
        .filter((b: AltitudeBand) => !b.beltZone)
        .map((b: AltitudeBand) => ({ id: b.id, name: b.name, unsafe: !!b.unsafe }));
    });

    expect(nonBeltBands).not.toBeNull();
    expect(nonBeltBands!.length).toBe(4);
    for (const band of nonBeltBands!) {
      expect(band.unsafe, `Non-belt band ${band.name} should not be unsafe`).toBe(false);
    }
  });

  test('teleporting to dense belt altitude while orbiting Sun is detected as unsafe @smoke', async () => {
    test.setTimeout(60_000);
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    // Wait for the altitude to settle within the dense belt band after
    // the worker has processed the orbital state.
    await page.waitForFunction(
      (mid: number) => {
        const ps = window.__flightPs;
        if (!ps) return false;
        const alt = Math.hypot(ps.posX, ps.posY);
        // Accept if altitude is within 20% of the dense belt midpoint
        return alt > mid * 0.8 && alt < mid * 1.2;
      },
      denseMidpoint,
      { timeout: 15_000 },
    );

    const orbitCheck = await page.evaluate<OrbitCheckResult | null>(() => {
      const w = window;
      const fs = w.__flightState;
      const ps = w.__flightPs;
      const sun = w.__celestialBodies?.SUN;
      if (!fs || !ps || !sun) return null;
      const altitude = Math.hypot(ps.posX, ps.posY);
      const denseBand = sun.altitudeBands.find((b: AltitudeBand) => b.beltZone === 'DENSE');
      if (!denseBand) return null;
      return {
        altitude,
        inDenseBelt: altitude >= denseBand.min && altitude < denseBand.max,
        phase: fs.phase,
        bodyId: fs.bodyId,
        denseMin: denseBand.min,
        denseMax: denseBand.max,
        denseUnsafe: denseBand.unsafe!,
      };
    });

    expect(orbitCheck).not.toBeNull();
    expect(orbitCheck!.bodyId).toBe('SUN');
    expect(orbitCheck!.inDenseBelt).toBe(true);
    expect(orbitCheck!.denseUnsafe).toBe(true);
  });

  test('teleporting to outer belt altitude while orbiting Sun is NOT unsafe', async () => {
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });
    const outerAMidpoint = 351_500_000_000;
    await teleportCraft(page, {
      posX: outerAMidpoint, posY: 0, velX: 0, velY: 19_500,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    // Wait for the altitude to settle within the outer-A belt band after
    // the worker has processed the orbital state.
    await page.waitForFunction(
      (mid: number) => {
        const ps = window.__flightPs;
        if (!ps) return false;
        const alt = Math.hypot(ps.posX, ps.posY);
        return alt > mid * 0.8 && alt < mid * 1.2;
      },
      outerAMidpoint,
      { timeout: 5_000 },
    );

    const orbitCheck = await page.evaluate<OuterOrbitCheckResult | null>(() => {
      const w = window;
      const fs = w.__flightState;
      const ps = w.__flightPs;
      const sun = w.__celestialBodies?.SUN;
      if (!fs || !ps || !sun) return null;
      const altitude = Math.hypot(ps.posX, ps.posY);
      const outerABand = sun.altitudeBands.find((b: AltitudeBand) => b.beltZone === 'OUTER_A');
      const denseBand = sun.altitudeBands.find((b: AltitudeBand) => b.beltZone === 'DENSE');
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
    expect(orbitCheck!.bodyId).toBe('SUN');
    expect(orbitCheck!.inOuterA).toBe(true);
    expect(orbitCheck!.inDenseBelt).toBe(false);
    expect(orbitCheck!.outerAUnsafe).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. ASTEROID SELECTION & TARGETING DATA
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — asteroid selection and targeting', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('belt zone configuration supports asteroid generation with correct zone counts', async () => {
    const zoneInfo = await page.evaluate<ZoneInfo[] | null>(() => {
      const sun = window.__celestialBodies?.SUN;
      if (!sun) return null;
      const beltBands = sun.altitudeBands.filter((b: AltitudeBand) => b.beltZone);
      return beltBands.map((b: AltitudeBand) => ({
        id: b.id,
        name: b.name,
        beltZone: b.beltZone!,
        min: b.min,
        max: b.max,
        span: b.max - b.min,
      }));
    });

    expect(zoneInfo).not.toBeNull();
    expect(zoneInfo!.length).toBe(3);
    const zoneIds = zoneInfo!.map(z => z.beltZone).sort();
    expect(zoneIds).toEqual(['DENSE', 'OUTER_A', 'OUTER_B']);
    for (const z of zoneInfo!) {
      expect(z.span).toBeGreaterThan(0);
    }
  });

  test('asteroid data model requires name, radius, mass, and position fields', async () => {
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });

    const asteroidData = await page.evaluate<AsteroidDataItem[] | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const mod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const playerX = 400_000_000_000;
        const playerY = 0;
        const asteroids = mod.generateBeltAsteroids(
          constants.BeltZone.DENSE, playerX, playerY, 50_000,
        );

        return asteroids.map((a: Record<string, unknown>) => ({
          id: a.id as string,
          name: a.name as string,
          type: a.type as string,
          radius: a.radius as number,
          mass: a.mass as number,
          posX: a.posX as number,
          posY: a.posY as number,
          velX: a.velX as number,
          velY: a.velY as number,
          shapeSeed: a.shapeSeed as number,
          hasName: typeof a.name === 'string' && (a.name as string).length > 0,
          hasRadius: typeof a.radius === 'number' && (a.radius as number) > 0,
          hasMass: typeof a.mass === 'number' && (a.mass as number) > 0,
        }));
      } catch {
        return null;
      }
    });

    expect(asteroidData).not.toBeNull();
    expect(asteroidData!.length).toBe(30);
    for (const a of asteroidData!) {
      expect(a.hasName).toBe(true);
      expect(a.hasRadius).toBe(true);
      expect(a.hasMass).toBe(true);
      expect(a.type).toBe('asteroid');
      expect(typeof a.posX).toBe('number');
      expect(typeof a.posY).toBe('number');
      expect(typeof a.velX).toBe('number');
      expect(typeof a.velY).toBe('number');
      expect(a.shapeSeed).toBeGreaterThanOrEqual(0);
    }
  });

  test('all generated asteroids have valid AST-XXXX name format @smoke', async () => {
    const names = await page.evaluate<string[] | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const mod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const allNames: string[] = [];
        for (const zone of [constants.BeltZone.OUTER_A, constants.BeltZone.DENSE, constants.BeltZone.OUTER_B]) {
          const asteroids = mod.generateBeltAsteroids(zone, 400_000_000_000, 0, 50_000);
          for (const a of asteroids) {
            allNames.push(a.name as string);
          }
        }
        return allNames;
      } catch {
        return null;
      }
    });

    expect(names).not.toBeNull();
    expect(names!.length).toBe(50);
    const namePattern = /^AST-\d{4}$/;
    for (const name of names!) {
      expect(name).toMatch(namePattern);
    }
  });

  test('asteroid radius and distance can be computed for targeting display', async () => {
    const targetInfo = await page.evaluate<TargetInfo[] | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const mod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const playerX = 400_000_000_000;
        const playerY = 0;
        const asteroids = mod.generateBeltAsteroids(
          constants.BeltZone.DENSE, playerX, playerY, 50_000,
        );
        return asteroids.map((a: Record<string, unknown>) => {
          const dist = Math.hypot((a.posX as number) - playerX, (a.posY as number) - playerY);
          const radius = a.radius as number;
          const sizeLabel = radius >= 500 ? 'Large' : radius >= 50 ? 'Medium' : 'Small';
          return { name: a.name as string, radius, distance: dist, sizeLabel };
        });
      } catch {
        return null;
      }
    });

    expect(targetInfo).not.toBeNull();
    expect(targetInfo!.length).toBe(30);
    for (const t of targetInfo!) {
      expect(t.name).toBeTruthy();
      expect(t.radius).toBeGreaterThanOrEqual(1);
      expect(t.radius).toBeLessThanOrEqual(1000);
      expect(t.distance).toBeLessThanOrEqual(50_000);
      expect(['Small', 'Medium', 'Large']).toContain(t.sizeLabel);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. COLLISION DAMAGE AT SPEED
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — collision damage at speed', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('relative velocity determines damage classification', async () => {
    const damage = await page.evaluate<DamageClassification | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const mod: ViteModule = await import('/src/core/collision.ts');
        return {
          at0: mod.classifyAsteroidDamage(0),
          at0_5: mod.classifyAsteroidDamage(0.5),
          at0_99: mod.classifyAsteroidDamage(0.99),
          at1: mod.classifyAsteroidDamage(1),
          at3: mod.classifyAsteroidDamage(3),
          at4_99: mod.classifyAsteroidDamage(4.99),
          at5: mod.classifyAsteroidDamage(5),
          at10: mod.classifyAsteroidDamage(10),
          at19_99: mod.classifyAsteroidDamage(19.99),
          at20: mod.classifyAsteroidDamage(20),
          at50: mod.classifyAsteroidDamage(50),
          at1000: mod.classifyAsteroidDamage(1000),
        };
      } catch {
        return null;
      }
    });

    expect(damage).not.toBeNull();
    expect(damage!.at0).toBe('NONE');
    expect(damage!.at0_5).toBe('NONE');
    expect(damage!.at0_99).toBe('NONE');
    expect(damage!.at1).toBe('MINOR');
    expect(damage!.at3).toBe('MINOR');
    expect(damage!.at4_99).toBe('MINOR');
    expect(damage!.at5).toBe('SIGNIFICANT');
    expect(damage!.at10).toBe('SIGNIFICANT');
    expect(damage!.at19_99).toBe('SIGNIFICANT');
    expect(damage!.at20).toBe('CATASTROPHIC');
    expect(damage!.at50).toBe('CATASTROPHIC');
    expect(damage!.at1000).toBe('CATASTROPHIC');
  });

  test('relative speed computation is correct for craft and asteroid velocities', async () => {
    const speeds = await page.evaluate<RelativeSpeedResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const mod: ViteModule = await import('/src/core/collision.ts');
        return {
          sameVel: mod.computeRelativeSpeed(100, 200, 100, 200),
          opposite: mod.computeRelativeSpeed(10, 0, -10, 0),
          orthogonal: mod.computeRelativeSpeed(3, 0, 0, 4),
          oneMoving: mod.computeRelativeSpeed(0, 0, 30, 40),
        };
      } catch {
        return null;
      }
    });

    expect(speeds).not.toBeNull();
    expect(speeds!.sameVel).toBeCloseTo(0, 5);
    expect(speeds!.opposite).toBeCloseTo(20, 5);
    expect(speeds!.orthogonal).toBeCloseTo(5, 5);
    expect(speeds!.oneMoving).toBeCloseTo(50, 5);
  });

  test('catastrophic collision destroys craft (crashed flag set) @smoke', async () => {
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate<CatastrophicCollisionResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const collision: ViteModule = await import('/src/core/collision.ts');
        const w = window;
        const ps = w.__flightPs;
        const fs = w.__flightState;
        const assembly = w.__flightAssembly;
        if (!ps || !fs || !assembly) return null;

        const fakeAsteroid = {
          id: 'AST-TEST-0', type: 'asteroid', name: 'AST-TEST',
          posX: ps.posX, posY: ps.posY,
          velX: ps.velX + 30, velY: ps.velY,
          radius: 100, mass: 2_000_000, shapeSeed: 42,
        };

        const crashedBefore = ps.crashed;
        const partCountBefore = ps.activeParts.size;
        const results = collision.checkAsteroidCollisions(ps, assembly, [fakeAsteroid], fs);

        return {
          crashedBefore,
          crashedAfter: ps.crashed,
          partCountBefore,
          partCountAfter: ps.activeParts.size,
          collisionCount: results.length,
          damageLevel: results.length > 0 ? results[0].damage : null,
          relativeSpeed: results.length > 0 ? results[0].relativeSpeed : null,
          hasImpactEvent: fs.events.some((e: { type: string }) => e.type === 'ASTEROID_IMPACT'),
        };
      } catch {
        return null;
      }
    });

    expect(result).not.toBeNull();
    expect(result!.crashedBefore).toBe(false);
    expect(result!.crashedAfter).toBe(true);
    expect(result!.collisionCount).toBe(1);
    expect(result!.damageLevel).toBe('CATASTROPHIC');
    expect(result!.relativeSpeed).toBeGreaterThanOrEqual(20);
    expect(result!.partCountAfter).toBe(0);
    expect(result!.hasImpactEvent).toBe(true);
  });

  test('low-speed collision causes minor damage (not catastrophic)', async () => {
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate<MinorCollisionResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const collision: ViteModule = await import('/src/core/collision.ts');
        const w = window;
        const ps = w.__flightPs;
        const fs = w.__flightState;
        const assembly = w.__flightAssembly;
        if (!ps || !fs || !assembly) return null;

        const fakeAsteroid = {
          id: 'AST-MINOR-0', type: 'asteroid', name: 'AST-MINOR',
          posX: ps.posX, posY: ps.posY,
          velX: ps.velX + 2, velY: ps.velY,
          radius: 50, mass: 500_000, shapeSeed: 99,
        };

        const partCountBefore = ps.activeParts.size;
        const results = collision.checkAsteroidCollisions(ps, assembly, [fakeAsteroid], fs);

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
    expect(result!.crashed).toBe(false);
    expect(result!.collisionCount).toBe(1);
    expect(result!.damageLevel).toBe('MINOR');
    expect(result!.relativeSpeed).toBeCloseTo(2, 0);
    expect(result!.partCountAfter).toBeGreaterThan(0);
    expect(result!.partCountAfter).toBeLessThanOrEqual(result!.partCountBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. TRANSFER PHASE — NO ASTEROIDS SPAWNED
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — transfer trajectory safety', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('no active asteroids during TRANSFER phase at belt altitude @smoke', async () => {
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 25_000,
      bodyId: 'SUN', phase: 'TRANSFER',
    });

    const state = await page.evaluate<TransferPhaseState | null>(async () => {
      const w = window;
      const fs = w.__flightState;
      const ps = w.__flightPs;
      if (!fs || !ps) return null;

      let hasActiveAsteroids = false;
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const mod: ViteModule = await import('/src/core/asteroidBelt.ts');
        hasActiveAsteroids = mod.hasAsteroids();
      } catch {
        // If import fails, we can't check.
      }

      return {
        phase: fs.phase,
        bodyId: fs.bodyId,
        altitude: Math.hypot(ps.posX, ps.posY),
        hasActiveAsteroids,
      };
    });

    expect(state).not.toBeNull();
    expect(state!.phase).toBe('TRANSFER');
    expect(state!.bodyId).toBe('SUN');
    expect(state!.altitude).toBeGreaterThan(329_000_000_000);
    expect(state!.altitude).toBeLessThan(479_000_000_000);
    expect(state!.hasActiveAsteroids).toBe(false);
  });

  test('flight render only shows belt asteroids during ORBIT phase (not TRANSFER)', async () => {
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 25_000,
      bodyId: 'SUN', phase: 'TRANSFER',
    });

    // Wait for the TRANSFER phase to persist through the worker round-trip.
    await page.waitForFunction(
      () => window.__flightState?.phase === 'TRANSFER',
      { timeout: 5_000 },
    );

    const renderCondition = await page.evaluate<RenderCondition | null>(() => {
      const fs = window.__flightState;
      if (!fs) return null;
      return {
        phase: fs.phase,
        isOrbit: fs.phase === 'ORBIT',
        isTransfer: fs.phase === 'TRANSFER',
      };
    });

    expect(renderCondition).not.toBeNull();
    expect(renderCondition!.isTransfer).toBe(true);
    expect(renderCondition!.isOrbit).toBe(false);
  });

  test('transitioning from ORBIT to TRANSFER clears asteroid state', async () => {
    await startTestFlight(page, PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const orbitState = await page.evaluate<AsteroidCountState | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const mod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const asteroids = mod.generateBeltAsteroids(
          constants.BeltZone.DENSE, 396_500_000_000, 0, 50_000,
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
    expect(orbitState!.activeCount).toBe(30);
    expect(orbitState!.hasAsteroids).toBe(true);

    const afterClear = await page.evaluate<AsteroidCountState | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const mod: ViteModule = await import('/src/core/asteroidBelt.ts');
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
    expect(afterClear!.activeCount).toBe(0);
    expect(afterClear!.hasAsteroids).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. ASTEROID CAPTURE WITH GRABBING ARM
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — asteroid capture with grabbing arm', () => {
  let page: Page;
  const GRAB_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];

  test.beforeEach(async ({ browser }) => {
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

  test.afterEach(async () => { await page.close(); });

  test('captureAsteroid succeeds when in range, velocity matched, and within mass limit @smoke', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate<CaptureResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const physics: ViteModule = await import('/src/core/physics.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window;
        const ps = w.__flightPs;
        const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(
          constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000,
        );
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX + 0.3;
        target.velY = ps.velY;
        target.mass = 50_000;

        const grabState = grabbing.createGrabState();
        const massBefore = ps.capturedBody ? ps.capturedBody.mass : 0;
        const captureResult = grabbing.captureAsteroid(grabState, target, ps, assembly);

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
      } catch (e: unknown) {
        return { error: String(e), success: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.success).toBe(true);
    expect(result!.grabStateName).toBe('GRABBED');
    expect(result!.grabbedAsteroidName).toBeTruthy();
    expect(result!.massBefore).toBe(0);
    expect(result!.massAfter).toBe(50_000);
    expect(result!.thrustAligned).toBe(false);
  });

  test('captureAsteroid fails when relative speed is too high', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate<CaptureSimpleResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window;
        const ps = w.__flightPs;
        const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10;
        target.posY = ps.posY;
        target.velX = ps.velX + 5;
        target.velY = ps.velY;
        target.mass = 50_000;

        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e: unknown) {
        return { error: String(e), success: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.reason).toContain('Relative speed too high');
  });

  test('captureAsteroid fails when asteroid is out of range', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, {
      posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300,
      bodyId: 'SUN', phase: 'ORBIT',
    });

    const result = await page.evaluate<CaptureSimpleResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window;
        const ps = w.__flightPs;
        const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 100;
        target.posY = ps.posY;
        target.velX = ps.velX;
        target.velY = ps.velY;
        target.mass = 50_000;

        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e: unknown) {
        return { error: String(e), success: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.reason).toContain('out of range');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. THRUST ALIGNMENT AFTER CAPTURE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — thrust alignment after capture', () => {
  let page: Page;
  const GRAB_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({
      parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'grabbing-arm', 'grabbing-arm-heavy', 'grabbing-arm-industrial'],
    });
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('alignThrustWithAsteroid succeeds after capture and sets thrustAligned @smoke', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, { posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<AlignmentResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const physics: ViteModule = await import('/src/core/physics.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window;
        const ps = w.__flightPs;
        const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY; target.mass = 80_000;

        const grabState = grabbing.createGrabState();
        const capture = grabbing.captureAsteroid(grabState, target, ps, assembly);
        if (!capture.success) return { error: 'capture failed: ' + capture.reason, captureSuccess: false, alignSuccess: false, alignedBefore: false, alignedAfter: false, capturedMass: 0 };

        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });
        const alignedBefore = ps.thrustAligned;
        const alignResult = grabbing.alignThrustWithAsteroid(grabState, ps);

        return { captureSuccess: capture.success, alignSuccess: alignResult.success, alignedBefore, alignedAfter: ps.thrustAligned, capturedMass: ps.capturedBody ? ps.capturedBody.mass : 0 };
      } catch (e: unknown) {
        return { error: String(e), captureSuccess: false, alignSuccess: false, alignedBefore: false, alignedAfter: false, capturedMass: 0 };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.captureSuccess).toBe(true);
    expect(result!.alignedBefore).toBe(false);
    expect(result!.alignSuccess).toBe(true);
    expect(result!.alignedAfter).toBe(true);
    expect(result!.capturedMass).toBe(80_000);
  });

  test('alignThrustWithAsteroid fails when already aligned', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<AlreadyAlignedResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const physics: ViteModule = await import('/src/core/physics.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window; const ps = w.__flightPs; const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY; target.mass = 40_000;

        const grabState = grabbing.createGrabState();
        grabbing.captureAsteroid(grabState, target, ps, assembly);
        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });
        grabbing.alignThrustWithAsteroid(grabState, ps);
        const secondAlign = grabbing.alignThrustWithAsteroid(grabState, ps);
        return { success: secondAlign.success, reason: secondAlign.reason };
      } catch (e: unknown) {
        return { error: String(e), success: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.reason).toContain('already aligned');
  });

  test('manual rotation breaks thrust alignment, re-align restores it', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<ReAlignResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const physics: ViteModule = await import('/src/core/physics.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window; const ps = w.__flightPs; const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY; target.mass = 60_000;

        const grabState = grabbing.createGrabState();
        grabbing.captureAsteroid(grabState, target, ps, assembly);
        physics.setCapturedBody(ps, { mass: target.mass, radius: target.radius || 15, offset: { x: 0, y: 0 }, name: target.name || 'AST-CAPTURED' });

        grabbing.alignThrustWithAsteroid(grabState, ps);
        const alignedAfterFirst = ps.thrustAligned;
        grabbing.breakThrustAlignment(ps);
        const alignedAfterRotation = ps.thrustAligned;
        const reAlignResult = grabbing.alignThrustWithAsteroid(grabState, ps);
        const alignedAfterReAlign = ps.thrustAligned;

        return { alignedAfterFirst, alignedAfterRotation, reAlignSuccess: reAlignResult.success, alignedAfterReAlign };
      } catch (e: unknown) {
        return { error: String(e), alignedAfterFirst: false, alignedAfterRotation: false, reAlignSuccess: false, alignedAfterReAlign: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.alignedAfterFirst).toBe(true);
    expect(result!.alignedAfterRotation).toBe(false);
    expect(result!.reAlignSuccess).toBe(true);
    expect(result!.alignedAfterReAlign).toBe(true);
  });

  test('alignThrustWithAsteroid fails when no asteroid is grabbed', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });

    const result = await page.evaluate<NoGrabAlignResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        const ps = window.__flightPs;
        if (!ps) return null;
        const grabState = grabbing.createGrabState();
        return grabbing.alignThrustWithAsteroid(grabState, ps);
      } catch (e: unknown) {
        return { error: String(e), success: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.reason).toContain('not grabbing');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. CAPTURED ASTEROID PERSISTENCE — RELEASE OUTSIDE BELT
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — captured asteroid persistence', () => {
  let page: Page;
  const GRAB_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({ parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'grabbing-arm', 'grabbing-arm-heavy'] });
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('released asteroid persists as OrbitalObject when outside belt zones @smoke', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 200_000_000_000, posY: 0, velX: 0, velY: 25_800, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<PersistResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window;
        const ps = w.__flightPs; const fs = w.__flightState; const assembly = w.__flightAssembly; const state = w.__gameState;
        if (!ps || !fs || !assembly || !state) return null;

        fs.altitude = Math.hypot(ps.posX, ps.posY);
        fs.timeElapsed = 1000;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.OUTER_A, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY;
        target.mass = 30_000; target.radius = 15;

        const grabState = grabbing.createGrabState();
        const capture = grabbing.captureAsteroid(grabState, target, ps, assembly);
        if (!capture.success) return { error: 'capture failed: ' + capture.reason, releaseSuccess: false, persisted: false, countBefore: 0, countAfter: 0, newObject: null };

        const release = grabbing.releaseGrabbedAsteroid(grabState, ps);
        if (!release.success || !release.asteroid) return { error: 'release failed', releaseSuccess: false, persisted: false, countBefore: 0, countAfter: 0, newObject: null };

        const countBefore = state.orbitalObjects.length;
        const persist = grabbing.persistReleasedAsteroid(release.asteroid, ps, fs, state);
        const countAfter = state.orbitalObjects.length;
        const persisted = persist.orbitalObject;

        return {
          releaseSuccess: release.success,
          persisted: persist.persisted,
          countBefore, countAfter,
          newObject: persisted ? { id: persisted.id, type: persisted.type, bodyId: persisted.bodyId, name: persisted.name, hasElements: !!persisted.elements, radius: persisted.radius, mass: persisted.mass } : null,
        };
      } catch (e: unknown) {
        return { error: String(e), releaseSuccess: false, persisted: false, countBefore: 0, countAfter: 0, newObject: null };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.releaseSuccess).toBe(true);
    expect(result!.persisted).toBe(true);
    expect(result!.countAfter).toBe(result!.countBefore + 1);
    expect(result!.newObject).not.toBeNull();
    expect(result!.newObject!.type).toBe('asteroid');
    expect(result!.newObject!.bodyId).toBe('SUN');
    expect(result!.newObject!.hasElements).toBe(true);
    expect(result!.newObject!.radius).toBe(15);
    expect(result!.newObject!.mass).toBe(30_000);
    expect(result!.newObject!.name).toBeTruthy();
  });

  test('released asteroid does NOT persist when inside a belt zone', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<PersistInsideBeltResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window;
        const ps = w.__flightPs; const fs = w.__flightState; const assembly = w.__flightAssembly; const state = w.__gameState;
        if (!ps || !fs || !assembly || !state) return null;

        fs.altitude = Math.hypot(ps.posX, ps.posY);
        fs.timeElapsed = 2000;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY; target.mass = 20_000;

        const grabState = grabbing.createGrabState();
        grabbing.captureAsteroid(grabState, target, ps, assembly);
        const release = grabbing.releaseGrabbedAsteroid(grabState, ps);
        if (!release.success || !release.asteroid) return { error: 'release failed', persisted: false, countBefore: 0, countAfter: 0 };

        const countBefore = state.orbitalObjects.length;
        const persist = grabbing.persistReleasedAsteroid(release.asteroid, ps, fs, state);
        const countAfter = state.orbitalObjects.length;
        return { persisted: persist.persisted, countBefore, countAfter };
      } catch (e: unknown) {
        return { error: String(e), persisted: false, countBefore: 0, countAfter: 0 };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.persisted).toBe(false);
    expect(result!.countAfter).toBe(result!.countBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. ASTEROID RENAME
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — asteroid rename', () => {
  let page: Page;
  const GRAB_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({ parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'grabbing-arm'] });
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('persistent asteroid can be renamed via orbitalObjects mutation', async () => {
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 200_000_000_000, posY: 0, velX: 0, velY: 25_800, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<RenameResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window;
        const ps = w.__flightPs; const fs = w.__flightState; const assembly = w.__flightAssembly; const state = w.__gameState;
        if (!ps || !fs || !assembly || !state) return null;

        fs.altitude = Math.hypot(ps.posX, ps.posY);
        fs.timeElapsed = 3000;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.OUTER_A, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY;
        target.mass = 5_000; target.radius = 8;

        const grabState = grabbing.createGrabState();
        grabbing.captureAsteroid(grabState, target, ps, assembly);
        const release = grabbing.releaseGrabbedAsteroid(grabState, ps);
        const persist = grabbing.persistReleasedAsteroid(release.asteroid, ps, fs, state);
        if (!persist.persisted || !persist.orbitalObject) return { error: 'persist failed', originalName: '', renamedName: undefined, matchesAST: false };

        const originalName = persist.orbitalObject.name;
        const obj = state.orbitalObjects.find((o: OrbitalObject) => o.id === persist.orbitalObject!.id);
        if (!obj) return { error: 'object not found in state', originalName: '', renamedName: undefined, matchesAST: false };

        obj.name = 'My Custom Asteroid';
        const renamedObj = state.orbitalObjects.find((o: OrbitalObject) => o.id === persist.orbitalObject!.id);
        return { originalName, renamedName: renamedObj?.name, matchesAST: /^AST-\d{4}$/.test(originalName) };
      } catch (e: unknown) {
        return { error: String(e), originalName: '', renamedName: undefined, matchesAST: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.matchesAST).toBe(true);
    expect(result!.renamedName).toBe('My Custom Asteroid');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. GRABBING ARM TIER MASS LIMIT ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — grabbing arm tier mass limits', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({ parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'grabbing-arm', 'grabbing-arm-heavy', 'grabbing-arm-industrial'] });
    await seedAndLoadSave(page, envelope);
  });

  test.afterEach(async () => { await page.close(); });

  test('standard arm rejects asteroid exceeding 100,000 kg mass limit @smoke', async () => {
    const LIGHT_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];
    await startTestFlight(page, LIGHT_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<CaptureSimpleResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window; const ps = w.__flightPs; const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY;
        target.mass = 200_000;
        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e: unknown) { return { error: String(e), success: false }; }
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.reason).toContain('too massive');
  });

  test('heavy arm accepts asteroid within its 100M kg limit', async () => {
    const HEAVY_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm-heavy', 'tank-small', 'engine-spark'];
    await startTestFlight(page, HEAVY_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<CaptureSimpleResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window; const ps = w.__flightPs; const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY;
        target.mass = 50_000_000;
        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e: unknown) { return { error: String(e), success: false }; }
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
  });

  test('heavy arm rejects asteroid exceeding 100M kg limit', async () => {
    const HEAVY_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm-heavy', 'tank-small', 'engine-spark'];
    await startTestFlight(page, HEAVY_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<CaptureSimpleResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window; const ps = w.__flightPs; const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY;
        target.mass = 500_000_000;
        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e: unknown) { return { error: String(e), success: false }; }
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.reason).toContain('too massive');
  });

  test('industrial arm accepts very large asteroids within its 2T kg limit', async () => {
    const INDUSTRIAL_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm-industrial', 'tank-small', 'engine-spark'];
    await startTestFlight(page, INDUSTRIAL_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<CaptureSimpleResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window; const ps = w.__flightPs; const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 10; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY;
        target.mass = 1_000_000_000_000;
        const grabState = grabbing.createGrabState();
        return grabbing.captureAsteroid(grabState, target, ps, assembly);
      } catch (e: unknown) { return { error: String(e), success: false }; }
    });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
  });

  test('arm tier mass limits match part definitions', async () => {
    const limits = await page.evaluate<ArmMassLimits | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const parts: ViteModule = await import('/src/data/parts.ts');
        const light = parts.getPartById('grabbing-arm');
        const heavy = parts.getPartById('grabbing-arm-heavy');
        const industrial = parts.getPartById('grabbing-arm-industrial');
        return {
          light: light?.properties?.maxCaptureMass ?? null,
          heavy: heavy?.properties?.maxCaptureMass ?? null,
          industrial: industrial?.properties?.maxCaptureMass ?? null,
        };
      } catch (e: unknown) { return { error: String(e), light: null, heavy: null, industrial: null }; }
    });

    expect(limits).not.toBeNull();
    expect(limits!.error).toBeUndefined();
    expect(limits!.light).toBe(100_000);
    expect(limits!.heavy).toBe(100_000_000);
    expect(limits!.industrial).toBe(2_000_000_000_000);
    expect(limits!.heavy!).toBeGreaterThan(limits!.light!);
    expect(limits!.industrial!).toBeGreaterThan(limits!.heavy!);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. EXTENDED ARM BEHAVIOUR, COOLDOWNS, ALIGNMENT PHYSICS, AND TECH GATING
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Asteroid Belt — heavy arm range, collision cooldown, alignment physics, and tech gating', () => {
  let page: Page;

  test.afterEach(async () => { await page.close(); });

  test('heavy arm grabs at 30m range where standard arm cannot reach @smoke', async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({ parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'grabbing-arm', 'grabbing-arm-heavy'] });
    await seedAndLoadSave(page, envelope);

    const STANDARD_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];
    await startTestFlight(page, STANDARD_PROBE, { bodyId: 'SUN' });
    const denseMidpoint = 396_500_000_000;
    await teleportCraft(page, { posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const standardResult = await page.evaluate<RangeCompareResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window; const ps = w.__flightPs; const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 30; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY; target.mass = 50_000;
        const grabState = grabbing.createGrabState();
        const result = grabbing.captureAsteroid(grabState, target, ps, assembly);
        return { success: result.success, reason: result.reason || null };
      } catch (e: unknown) { return { error: String(e), success: false, reason: null }; }
    });

    expect(standardResult).not.toBeNull();
    expect(standardResult!.error).toBeUndefined();
    expect(standardResult!.success).toBe(false);
    expect(standardResult!.reason).toContain('out of range');

    await seedAndLoadSave(page, envelope);

    const HEAVY_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm-heavy', 'tank-small', 'engine-spark'];
    await startTestFlight(page, HEAVY_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: denseMidpoint, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const heavyResult = await page.evaluate<RangeCompareResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');

        const w = window; const ps = w.__flightPs; const assembly = w.__flightAssembly;
        if (!ps || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 30; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY; target.mass = 50_000;
        const grabState = grabbing.createGrabState();
        const result = grabbing.captureAsteroid(grabState, target, ps, assembly);
        return { success: result.success, reason: result.reason || null, armReach: 35 };
      } catch (e: unknown) { return { error: String(e), success: false, reason: null }; }
    });

    expect(heavyResult).not.toBeNull();
    expect(heavyResult!.error).toBeUndefined();
    expect(heavyResult!.success).toBe(true);
  });

  test('slow-speed collision cooldown prevents repeated damage on same asteroid', async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture();
    await seedAndLoadSave(page, envelope);

    await startTestFlight(page, PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<CooldownResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const collision: ViteModule = await import('/src/core/collision.ts');
        const w = window;
        const ps = w.__flightPs; const fs = w.__flightState; const assembly = w.__flightAssembly;
        if (!ps || !fs || !assembly) return null;

        collision.resetAsteroidCollisionCooldowns();
        const fakeAsteroid = {
          id: 'AST-COOLDOWN-0', type: 'asteroid', name: 'AST-COOLDOWN',
          posX: ps.posX, posY: ps.posY, velX: ps.velX + 2, velY: ps.velY,
          radius: 50, mass: 500_000, shapeSeed: 77,
        };

        const partCountBefore = ps.activeParts.size;
        const results1 = collision.checkAsteroidCollisions(ps, assembly, [fakeAsteroid], fs);
        const partCountAfterFirst = ps.activeParts.size;
        const crashedAfterFirst = ps.crashed;

        const results2 = collision.checkAsteroidCollisions(ps, assembly, [fakeAsteroid], fs);
        const partCountAfterSecond = ps.activeParts.size;
        const crashedAfterSecond = ps.crashed;

        return {
          firstCallCount: results1.length,
          firstDamage: results1.length > 0 ? results1[0].damage : null,
          secondCallCount: results2.length,
          partCountBefore, partCountAfterFirst, partCountAfterSecond,
          crashedAfterFirst, crashedAfterSecond,
          noExtraDamage: partCountAfterFirst === partCountAfterSecond,
        };
      } catch (e: unknown) {
        return { error: String(e), firstCallCount: 0, firstDamage: null, secondCallCount: 0, partCountBefore: 0, partCountAfterFirst: 0, partCountAfterSecond: 0, crashedAfterFirst: false, crashedAfterSecond: false, noExtraDamage: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.firstCallCount).toBe(1);
    expect(result!.firstDamage).toBe('MINOR');
    expect(result!.secondCallCount).toBe(0);
    expect(result!.crashedAfterFirst).toBe(false);
    expect(result!.crashedAfterSecond).toBe(false);
    expect(result!.noExtraDamage).toBe(true);
    expect(result!.partCountAfterSecond).toBeGreaterThan(0);
  });

  test('unaligned thrust causes angular velocity change; aligned thrust does not @smoke', async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = orbitalFixture({ parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'grabbing-arm'] });
    await seedAndLoadSave(page, envelope);

    const GRAB_PROBE: string[] = ['probe-core-mk1', 'grabbing-arm', 'tank-small', 'engine-spark'];
    await startTestFlight(page, GRAB_PROBE, { bodyId: 'SUN' });
    await teleportCraft(page, { posX: 396_500_000_000, posY: 0, velX: 0, velY: 18_300, bodyId: 'SUN', phase: 'ORBIT' });

    const result = await page.evaluate<ThrustAlignmentPhysicsResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const grabbing: ViteModule = await import('/src/core/grabbing.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const physics: ViteModule = await import('/src/core/physics.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const beltMod: ViteModule = await import('/src/core/asteroidBelt.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const constants: ViteModule = await import('/src/core/constants.ts');
        // @ts-expect-error Vite dynamic import — browser only
        const partsData: ViteModule = await import('/src/data/parts.ts');

        const w = window;
        const ps = w.__flightPs; const fs = w.__flightState; const assembly = w.__flightAssembly;
        if (!ps || !fs || !assembly) return null;

        const asteroids = beltMod.generateBeltAsteroids(constants.BeltZone.DENSE, ps.posX, ps.posY, 50_000);
        const target = asteroids[0];
        target.posX = ps.posX + 15; target.posY = ps.posY; target.velX = ps.velX; target.velY = ps.velY; target.mass = 80_000;

        const grabState = grabbing.createGrabState();
        const capture = grabbing.captureAsteroid(grabState, target, ps, assembly);
        if (!capture.success) return { error: 'capture failed: ' + capture.reason, isUnalignedAfterCapture: false, isAlignedNow: false, angularVelUnaligned: 0, angularVelAligned: 0, unalignedHasRotation: false, alignedRotationSmaller: false };

        const isUnalignedAfterCapture = !ps.thrustAligned;
        ps.throttle = 1.0;
        ps.angularVelocity = 0;
        // Ensure grounded=false — physics worker may have re-set it
        // since posY=0 at this orbital position.
        ps.grounded = false;
        ps.landed = false;

        for (const instanceId of ps.activeParts) {
          const placed = assembly.parts.get(instanceId);
          if (!placed) continue;
          const partDef = partsData.getPartById(placed.partId);
          if (partDef && partDef.type === 'ENGINE') {
            ps.firingEngines.add(instanceId);
          }
        }

        const dt = 1 / 60;
        const stagingConfig = { stages: [] as unknown[] };
        for (let i = 0; i < 10; i++) {
          physics.tick(ps, assembly, stagingConfig, fs, dt, 1);
        }
        const angularVelUnaligned = ps.angularVelocity;

        grabbing.alignThrustWithAsteroid(grabState, ps);
        const isAlignedNow = ps.thrustAligned;
        ps.angularVelocity = 0;
        for (let i = 0; i < 10; i++) {
          physics.tick(ps, assembly, stagingConfig, fs, dt, 1);
        }
        const angularVelAligned = ps.angularVelocity;

        return {
          isUnalignedAfterCapture, isAlignedNow, angularVelUnaligned, angularVelAligned,
          unalignedHasRotation: Math.abs(angularVelUnaligned) > 1e-8,
          alignedRotationSmaller: Math.abs(angularVelAligned) < Math.abs(angularVelUnaligned),
        };
      } catch (e: unknown) {
        return { error: String(e), isUnalignedAfterCapture: false, isAlignedNow: false, angularVelUnaligned: 0, angularVelAligned: 0, unalignedHasRotation: false, alignedRotationSmaller: false };
      }
    });

    expect(result).not.toBeNull();
    expect(result!.error).toBeUndefined();
    expect(result!.isUnalignedAfterCapture).toBe(true);
    expect(result!.isAlignedNow).toBe(true);
    expect(result!.unalignedHasRotation).toBe(true);
    expect(Math.abs(result!.angularVelUnaligned)).toBeGreaterThan(0);
    expect(result!.alignedRotationSmaller).toBe(true);
  });

  test('heavy grabbing arm is gated behind struct-t5 research', async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelopeT4Only = buildSaveEnvelope({
      saveName: 'Tech T4 Only',
      agencyName: 'Tech Test Agency',
      money: 5_000_000,
      parts: ['probe-core-mk1', 'tank-small', 'engine-spark'],
      tutorialMode: false,
      facilities: {
        VAB: { tier: 3, built: true },
        LAUNCH_PAD: { tier: 3, built: true },
        MISSION_CONTROL: { tier: 2, built: true },
        RND_LAB: { tier: 2, built: true },
        TRACKING_STATION: { tier: 2, built: true },
        ASTRONAUT_COMPLEX: { tier: 2, built: true },
        ADMIN: { tier: 1, built: true },
      },
      techTree: {
        researched: ['struct-t1', 'struct-t2', 'struct-t3', 'struct-t4'],
        unlockedInstruments: [],
      },
      sciencePoints: 300,
    });
    await seedAndLoadSave(page, envelopeT4Only);

    const t4Result = await page.evaluate<TechGateResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const missions: ViteModule = await import('/src/core/missions.ts');
        const state = window.__gameState;
        if (!state) return null;
        const unlocked: string[] = missions.getUnlockedParts(state);
        return {
          hasStandardArm: unlocked.includes('grabbing-arm'),
          hasHeavyArm: unlocked.includes('grabbing-arm-heavy'),
          hasIndustrialArm: unlocked.includes('grabbing-arm-industrial'),
        };
      } catch (e: unknown) { return { error: String(e), hasStandardArm: false, hasHeavyArm: false, hasIndustrialArm: false }; }
    });

    expect(t4Result).not.toBeNull();
    expect(t4Result!.error).toBeUndefined();
    expect(t4Result!.hasStandardArm).toBe(true);
    expect(t4Result!.hasHeavyArm).toBe(false);
    expect(t4Result!.hasIndustrialArm).toBe(false);

    const envelopeT5 = buildSaveEnvelope({
      saveName: 'Tech T5',
      agencyName: 'Tech Test Agency',
      money: 5_000_000,
      parts: ['probe-core-mk1', 'tank-small', 'engine-spark'],
      tutorialMode: false,
      facilities: {
        VAB: { tier: 3, built: true },
        LAUNCH_PAD: { tier: 3, built: true },
        MISSION_CONTROL: { tier: 2, built: true },
        RND_LAB: { tier: 2, built: true },
        TRACKING_STATION: { tier: 2, built: true },
        ASTRONAUT_COMPLEX: { tier: 2, built: true },
        ADMIN: { tier: 1, built: true },
      },
      techTree: {
        researched: ['struct-t1', 'struct-t2', 'struct-t3', 'struct-t4', 'struct-t5'],
        unlockedInstruments: [],
      },
      sciencePoints: 300,
    });

    await seedAndLoadSave(page, envelopeT5);

    const t5Result = await page.evaluate<TechGateResult | null>(async () => {
      try {
        // @ts-expect-error Vite dynamic import — browser only
        const missions: ViteModule = await import('/src/core/missions.ts');
        const state = window.__gameState;
        if (!state) return null;
        const unlocked: string[] = missions.getUnlockedParts(state);
        return {
          hasStandardArm: unlocked.includes('grabbing-arm'),
          hasHeavyArm: unlocked.includes('grabbing-arm-heavy'),
          hasIndustrialArm: unlocked.includes('grabbing-arm-industrial'),
        };
      } catch (e: unknown) { return { error: String(e), hasStandardArm: false, hasHeavyArm: false, hasIndustrialArm: false }; }
    });

    expect(t5Result).not.toBeNull();
    expect(t5Result!.error).toBeUndefined();
    expect(t5Result!.hasStandardArm).toBe(true);
    expect(t5Result!.hasHeavyArm).toBe(true);
    expect(t5Result!.hasIndustrialArm).toBe(false);
  });
});

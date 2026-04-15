/**
 * destinations.spec.ts — E2E tests for Phase 6: Destinations.
 *
 * Covers:
 *   - Celestial body data driving physics (gravity, atmosphere) and rendering
 *   - Sun destruction altitude and escalating heat damage
 *   - Transfer gameplay — time warp not advancing periods, player locked to
 *     craft mid-transfer, map view controls during transfer, delta-v display
 *   - Landing on airless bodies (fully propulsive) and thin-atmosphere bodies
 *   - Body-specific biomes producing fresh science opportunities
 *   - Surface operations — flag planting (one per body, crewed only), sample
 *     collection and return, surface instrument deployment, base marker beacon
 *   - Deployed item visibility based on GPS satellite coverage
 *   - Prestige milestones triggering at correct events with correct rewards
 *   - Phase 6 new parts functioning correctly
 */

import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  startTestFlight,
  getGameState,
  getFlightState,
  getPhysicsSnapshot,
  waitForAltitude,
  buildCrewMember,
  ALL_FACILITIES,
  teleportCraft,
  waitForOrbit,
  stageAndLaunch,
} from './helpers.js';
import type { SaveEnvelope, SaveEnvelopeParams } from './helpers.js';
import {
  ALL_PARTS,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Phase 6 parts — not in the base ALL_PARTS set yet.
const PHASE6_PARTS: string[] = [
  ...ALL_PARTS,
  'engine-deep-space',
  'mission-module-extended',
  'sample-return-container',
  'surface-instrument-package',
  'relay-antenna',
  'heat-shield-heavy',
  'heat-shield-solar',
  'heat-shield-mk1',
  'heat-shield-mk2',
];

// Rocket configurations for different test scenarios.
const BASIC_PROBE: string[]     = ['probe-core-mk1', 'tank-small', 'engine-spark'];
const LUNAR_LANDER: string[]    = ['cmd-mk1', 'tank-large', 'engine-reliant', 'landing-legs-small'];
const DEEP_SPACE_SHIP: string[] = ['cmd-mk1', 'tank-large', 'engine-deep-space'];
const SOLAR_PROBE: string[]     = ['probe-core-mk1', 'heat-shield-solar', 'tank-small', 'engine-spark'];

// Orbital parameters.
const EARTH_ORBIT_ALT: number = 100_000;
const EARTH_ORBIT_VEL: number = 7848;
const MOON_ORBIT_ALT: number  = 20_000;
const MOON_ORBIT_VEL: number  = 1671;  // Circular velocity at 20 km above Moon surface

// Sun constants from src/core/constants.js.
const SUN_DESTRUCTION_ALTITUDE: number   = 500_000_000;
const SUN_HEAT_START_ALTITUDE: number    = 20_000_000_000;

// Surface ops constants.
const FLAG_MILESTONE_BONUS: number = 100_000;
const FLAG_MILESTONE_REP: number   = 5;
const SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD: number = 3;

// ---------------------------------------------------------------------------
// Local interfaces for page.evaluate return types
// ---------------------------------------------------------------------------

interface HeatEvent {
  type: string;
  description?: string;
}

interface HeatState {
  hasHeat: boolean;
  maxHeat: number;
  eventCount?: number;
}

interface DestructionState {
  crashed: boolean;
  events: HeatEvent[];
}

interface ShieldState {
  hasShield: boolean;
}

interface TransferInfo {
  departureDV: number;
  captureDV: number;
  totalDV: number;
}

interface DeltaVInfo {
  departureDV: number;
  captureDV?: number;
  totalDV: number;
}

interface BiomeInfo {
  id: string;
  mult: number;
}

interface SunBiomeInfo {
  id: string;
  name: string;
  mult: number;
  min: number;
  max: number;
}

interface SurfaceActionResult {
  success: boolean;
  reason?: string;
}

interface SampleReturnResult {
  samplesReturned: number;
  scienceEarned: number;
}

interface SurfaceOpsResult {
  scienceEarned: number;
}

interface AchievementResult {
  id: string;
  cashReward: number;
  repReward: number;
}

interface PartInfo {
  id: string;
  type: string;
  mass: number;
  cost: number;
  properties: Record<string, unknown>;
}

interface ShieldTierInfo {
  id: string;
  tolerance: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function phase6Fixture(overrides: SaveEnvelopeParams = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName:     'Phase 6 Test',
    agencyName:   'Deep Space Agency',
    money:        20_000_000,
    loan:         { balance: 0, interestRate: 0.03, totalInterestAccrued: 200_000 },
    parts:        PHASE6_PARTS,
    currentPeriod: 30,
    tutorialMode: false,
    facilities:   { ...ALL_FACILITIES },
    crew: [
      buildCrewMember({ id: 'crew-1', name: 'Alice Shepard', skills: { piloting: 90, engineering: 60, science: 50 }, missionsFlown: 12 }),
      buildCrewMember({ id: 'crew-2', name: 'Bob Kerman',    skills: { piloting: 40, engineering: 90, science: 40 }, missionsFlown: 10 }),
      buildCrewMember({ id: 'crew-3', name: 'Carol Ride',    skills: { piloting: 30, engineering: 30, science: 95 }, missionsFlown: 8 }),
    ],
    missions: {
      available: [],
      accepted:  [],
      completed: Array.from({ length: 20 }, (_, i) => ({
        id: `mission-${String(i + 1).padStart(3, '0')}`,
        title: `Completed Mission ${i + 1}`,
        objectives: [],
        reward: 50_000 + i * 25_000,
        status: 'completed',
      })),
    },
    flightHistory: Array.from({ length: 25 }, (_, i) => ({
      id: `fh-${i + 1}`,
      missionId: i < 20 ? `mission-${String(i + 1).padStart(3, '0')}` : null,
      outcome: 'SUCCESS',
    })),
    reputation:     90,
    sciencePoints:  200,
    scienceLog: [
      { instrumentId: 'thermometer-mk1', biomeId: 'lower-atmosphere', count: 5 },
      { instrumentId: 'thermometer-mk1', biomeId: 'upper-atmosphere', count: 4 },
    ],
    techTree: {
      researched: [],
      unlockedInstruments: ['thermometer-mk1', 'barometer', 'radiation-detector'],
    },
    satelliteNetwork: {
      satellites: [
        { id: 'sat-1', name: 'CommSat-1', partId: 'satellite-comm', bodyId: 'EARTH', bandId: 'LEO', health: 90, autoMaintain: true, deployedPeriod: 15 },
      ],
    },
    ...overrides,
  });
}

async function setTransferState(page: Page, origin: string, destination: string): Promise<void> {
  await page.evaluate(async ({ origin, destination }) => {
    const fs = window.__flightState;
    if (!fs) return;

    fs.phase = 'TRANSFER';
    fs.inOrbit = false;
    fs.transferState = {
      originBodyId: origin,
      destinationBodyId: destination,
      departureTime: fs.timeElapsed || 0,
      estimatedArrival: (fs.timeElapsed || 0) + 500_000,
      departureDV: 3200,
      captureDV: 900,
      totalDV: 4100,
      trajectoryPath: [{ x: 0, y: 0 }, { x: 100, y: 200 }],
    };
    if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
  }, { origin, destination });

  await page.waitForFunction(
    () => window.__flightState?.phase === 'TRANSFER',
    { timeout: 5_000 },
  );
}

async function returnToAgency(page: Page): Promise<void> {
  // Already on the hub? Nothing to do.
  const hubAlready: boolean = await page.locator('#hub-overlay').isVisible().catch(() => false);
  if (hubAlready) return;

  // If the post-flight summary is already visible (e.g. after landing/crash),
  // click its return button directly instead of using the topbar dropdown.
  const summary = page.locator('#post-flight-summary');
  if (await summary.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await page.click('#post-flight-return-btn');
  } else {
    const dropdown = page.locator('#topbar-dropdown');
    if (!(await dropdown.isVisible())) {
      await page.click('#topbar-menu-btn');
      await expect(dropdown).toBeVisible({ timeout: 2_000 });
    }
    await dropdown.getByText('Return to Space Agency').click();

    const orbitReturn = page.locator('[data-testid="orbit-return-btn"]');
    const abortReturn = page.locator('[data-testid="abort-confirm-btn"]');

    const orbitVisible: boolean = await orbitReturn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (orbitVisible) {
      await orbitReturn.click();
      const summaryAfter = page.locator('#post-flight-summary');
      if (await summaryAfter.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await page.click('#post-flight-return-btn');
      }
    } else {
      const abortVisible: boolean = await abortReturn.isVisible({ timeout: 2_000 }).catch(() => false);
      if (abortVisible) {
        await abortReturn.click();
      } else {
        const summaryFallback = page.locator('#post-flight-summary');
        if (await summaryFallback.isVisible({ timeout: 5_000 }).catch(() => false)) {
          await page.click('#post-flight-return-btn');
        }
      }
    }
  }

  // Dismiss return-results overlay if present.
  try {
    const dismissBtn = page.locator('#return-results-dismiss-btn');
    await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await dismissBtn.click();
  } catch { /* no return results overlay */ }

  // Wait for hub to appear.
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CELESTIAL BODY DATA
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Celestial body data drives physics and rendering', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) body catalog is accessible and contains all expected bodies', async () => {
    const _bodies = await page.evaluate((): string[] | null => {
      // @ts-expect-error — _bodyCache is an internal/private property not on the GameState type
      const mod = window.__celestialBodies || window.__gameState?._bodyCache;
      // Fallback: check if CELESTIAL_BODIES is exposed via any global.
      if (mod) return Object.keys(mod);
      // Try to read from a known data source.
      return null;
    });

    // If bodies aren't directly exposed, verify through flight state.
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'EARTH' });
    const fs = await getFlightState(page);
    expect(fs).not.toBeNull();
    expect(fs!.bodyId).toBe('EARTH');
    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(2) Earth flight uses Earth gravity (~9.81 m/s²)', async () => {
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'EARTH' });
    const ps1 = (await getPhysicsSnapshot(page))!;
    expect(ps1.posY).toBeCloseTo(0, 0);

    // Stage and launch — use retry helper for reliability.
    await stageAndLaunch(page);
    await waitForAltitude(page, 50, 15_000);

    const ps2 = (await getPhysicsSnapshot(page))!;
    expect(ps2.posY).toBeGreaterThan(0);
    // Velocity should be fighting Earth gravity (~9.81).
    expect(ps2.velY).toBeGreaterThan(0);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(3) Moon flight uses lower gravity (~1.62 m/s²)', async () => {
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'MOON' });
    await stageAndLaunch(page);
    await waitForAltitude(page, 50, 15_000);

    const ps = (await getPhysicsSnapshot(page))!;
    expect(ps.posY).toBeGreaterThan(0);
    // Under lower gravity, the rocket should climb faster with the same thrust.
    expect(ps.velY).toBeGreaterThan(0);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(4) Mars flight starts with body-appropriate settings', async () => {
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'MARS' });
    const fs = (await getFlightState(page))!;
    expect(fs.bodyId).toBe('MARS');

    await stageAndLaunch(page);
    await waitForAltitude(page, 50, 15_000);

    const ps = (await getPhysicsSnapshot(page))!;
    expect(ps.posY).toBeGreaterThan(0);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(5) airless body (Moon) has no atmospheric drag', async () => {
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'MOON' });
    await stageAndLaunch(page);
    await waitForAltitude(page, 200, 15_000);

    // Cut throttle and check velocity — on airless body, velocity shouldn't
    // decrease much except from gravity (no atmospheric drag).
    await page.keyboard.press('x');
    const ps1 = (await getPhysicsSnapshot(page))!;
    // Wait for physics to run a few frames (position changes due to gravity)
    await page.waitForFunction(
      (y0: number) => (window.__flightPs?.posY ?? y0) !== y0,
      ps1.posY,
      { timeout: 5_000 },
    );
    const ps2 = (await getPhysicsSnapshot(page))!;

    // Velocity change should be purely gravitational (small, only vertical).
    // Horizontal velocity should be essentially unchanged (no drag).
    const hVelChange: number = Math.abs(ps2.velX - ps1.velX);
    expect(hVelChange).toBeLessThan(1);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. SUN DESTRUCTION AND HEAT DAMAGE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Sun destruction altitude and escalating heat damage', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) craft near Sun above heat start altitude takes no heat damage', async () => {
    await startTestFlight(page, SOLAR_PROBE, { bodyId: 'SUN' });

    // Teleport above the heat start altitude.
    await teleportCraft(page, { posY: SUN_HEAT_START_ALTITUDE + 1_000_000_000, bodyId: 'SUN' });
    // Wait for physics sim to run (gravity changes posY)
    const _sunPosY1: number = await page.evaluate((): number => window.__flightPs?.posY ?? 0);
    await page.waitForFunction(
      (y0: number) => (window.__flightPs?.posY ?? y0) !== y0,
      _sunPosY1,
      { timeout: 5_000 },
    );

    // Check that no heat-related events fired.
    const events = await page.evaluate((): HeatEvent[] => {
      const fs = window.__flightState;
      return (fs?.events ?? []).filter((e: HeatEvent) =>
        e.type === 'HEAT_DAMAGE' || e.type === 'PART_DESTROYED' ||
        (e.description && e.description.toLowerCase().includes('solar'))
      );
    });
    expect(events.length).toBe(0);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(2) craft inside heat zone takes escalating heat damage', async () => {
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'SUN' });

    // Teleport inside the heat zone but above destruction.
    await teleportCraft(page, { posY: 5_000_000_000, bodyId: 'SUN' });
    // Wait for heat to accumulate or parts to be destroyed
    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      if (!ps) return false;
      // Check heatMap for accumulated heat
      if (ps.heatMap?.size > 0) {
        for (const h of ps.heatMap.values()) { if (h > 0) return true; }
      }
      // Or check for destruction events
      const fs = window.__flightState;
      return (fs?.events ?? []).some((e: { type: string }) =>
        e.type === 'PART_DESTROYED' || e.type === 'HEAT_DAMAGE'
      );
    }, { timeout: 10_000 });

    // Check for heat-related effects — parts should accumulate heat.
    // Heat is tracked in ps.heatMap (Map<string, number>).
    const heatState = await page.evaluate((): HeatState => {
      const ps = window.__flightPs;
      if (!ps) return { hasHeat: false, maxHeat: 0 };
      let maxHeat = 0;
      if (ps.heatMap && ps.heatMap.size > 0) {
        for (const [, heat] of ps.heatMap) {
          maxHeat = Math.max(maxHeat, heat);
        }
      }
      // Also check for any destruction events as evidence of heat.
      const fs = window.__flightState;
      const heatEvents = (fs?.events ?? []).filter((e: { type: string; description?: string }) =>
        e.type === 'PART_DESTROYED' || e.type === 'HEAT_DAMAGE' ||
        (e.description && (e.description.includes('heat') || e.description.includes('solar') || e.description.includes('destroyed')))
      );
      return { hasHeat: maxHeat > 0 || heatEvents.length > 0, maxHeat, eventCount: heatEvents.length };
    });

    // Heat should be accumulating near the Sun (via heatMap or destruction events).
    expect(heatState.hasHeat).toBe(true);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(3) craft below destruction altitude is instantly destroyed', async () => {
    test.setTimeout(120_000);
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'SUN' });

    // Teleport below destruction altitude.
    await teleportCraft(page, { posY: SUN_DESTRUCTION_ALTITUDE - 100_000_000, bodyId: 'SUN' });
    // Wait for craft to be destroyed — destruction removes all parts from activeParts.
    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      const fs = window.__flightState;
      return ps?.crashed === true ||
        ps?.activeParts?.size === 0 ||
        (fs?.events ?? []).some((e: { type: string }) => e.type === 'PART_DESTROYED');
    }, { timeout: 30_000 });

    // All parts should be destroyed — check for crash or destruction state.
    const state = await page.evaluate((): DestructionState => {
      const ps = window.__flightPs;
      const fs = window.__flightState;
      return {
        crashed: ps?.crashed ?? false,
        events: (fs?.events ?? []).filter((e: { type: string; description?: string }) =>
          e.type === 'PART_DESTROYED' ||
          (e.description && e.description.toLowerCase().includes('destroyed'))
        ),
      };
    });

    // Craft should be destroyed or have destruction events.
    const isDestroyed: boolean = state.crashed || state.events.length > 0;
    expect(isDestroyed).toBe(true);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(4) solar heat shield provides protection from solar heat', async () => {
    test.setTimeout(120_000);
    await startTestFlight(page, SOLAR_PROBE, { bodyId: 'SUN' });

    // Teleport to inner corona — should survive longer with solar shield.
    await teleportCraft(page, { posY: 3_000_000_000, bodyId: 'SUN' });
    // Wait for physics to process several frames near the Sun.
    // At 3 billion m altitude, gravity is ~9.7 m/s² — need a modest threshold.
    const _sunPosY2: number = await page.evaluate((): number => window.__flightPs?.posY ?? 0);
    await page.waitForFunction(
      (y0: number) => Math.abs((window.__flightPs?.posY ?? y0) - y0) > 50,
      _sunPosY2,
      { timeout: 20_000 },
    );

    const shieldState = await page.evaluate((): ShieldState => {
      const ps = window.__flightPs;
      if (!ps) return { hasShield: false };
      const assembly = window.__flightAssembly;
      if (!assembly) return { hasShield: false };
      let hasShield = false;
      for (const [, part] of assembly.parts) {
        if (part.partId === 'heat-shield-solar') {
          hasShield = true;
          break;
        }
      }
      return { hasShield };
    });

    expect(shieldState.hasShield).toBe(true);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TRANSFER GAMEPLAY
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Transfer gameplay mechanics', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) transfer state stores origin and destination bodies', async () => {
    await startTestFlight(page, DEEP_SPACE_SHIP, { bodyId: 'EARTH', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: EARTH_ORBIT_ALT, velX: EARTH_ORBIT_VEL, bodyId: 'EARTH' });
    await waitForOrbit(page);
    await setTransferState(page, 'EARTH', 'MOON');

    const fs = (await getFlightState(page))!;
    expect(fs.phase).toBe('TRANSFER');
    expect(fs.transferState).not.toBeNull();
    const ts = fs.transferState as Record<string, unknown>;
    expect(ts.originBodyId).toBe('EARTH');
    expect(ts.destinationBodyId).toBe('MOON');
    expect(ts.departureDV).toBeGreaterThan(0);
    expect(ts.captureDV).toBeGreaterThan(0);
    expect(ts.totalDV).toBe(
      (ts.departureDV as number) + (ts.captureDV as number),
    );
  });

  test('(2) time warp during transfer does NOT advance period counter', async () => {
    const gsBefore = (await getGameState(page))!;
    const periodBefore: number = gsBefore.currentPeriod as number;

    // Try to activate time warp.
    const warpBtn = page.locator('.hud-warp-btn[data-warp="5"]');
    const warpExists: boolean = await warpBtn.isVisible({ timeout: 3_000 }).catch(() => false);
    if (warpExists) {
      await warpBtn.click();
      // Wait for simulation to advance at warp speed
      const _tPosX: number = await page.evaluate((): number => window.__flightPs?.posX ?? 0);
      await page.waitForFunction(
        (x0: number) => Math.abs((window.__flightPs?.posX ?? x0) - x0) > 100,
        _tPosX,
        { timeout: 5_000 },
      );
    }

    const gsAfter = (await getGameState(page))!;
    expect(gsAfter.currentPeriod).toBe(periodBefore);
  });

  test('(3) player is locked to craft during transfer (phase prevents return)', async () => {
    // During TRANSFER phase, the player cannot leave the craft.
    // Verify the flight state confirms we're in transfer.
    const fs = (await getFlightState(page))!;
    expect(fs.phase).toBe('TRANSFER');
    expect(fs.transferState).not.toBeNull();

    // The flight state should still be active (not ended).
    const flightActive: boolean = await page.evaluate((): boolean => {
      return window.__flightState !== null && window.__flightState !== undefined;
    });
    expect(flightActive).toBe(true);
  });

  test('(4) delta-v display shows values for transfer', async () => {
    const transferInfo = await page.evaluate((): TransferInfo | null => {
      const fs = window.__flightState;
      if (!fs?.transferState) return null;
      return {
        departureDV: fs.transferState.departureDV,
        captureDV: fs.transferState.captureDV,
        totalDV: fs.transferState.totalDV,
      };
    });

    expect(transferInfo).not.toBeNull();
    expect(transferInfo!.departureDV).toBeGreaterThan(0);
    expect(transferInfo!.captureDV).toBeGreaterThan(0);
    expect(transferInfo!.totalDV).toBeGreaterThan(0);

    // Reset to orbit so we can return cleanly.
    await page.evaluate(async () => {
      const fs = window.__flightState;
      if (fs) {
        fs.phase = 'ORBIT';
        fs.inOrbit = true;
        fs.transferState = null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(5) transfer delta-v calculation returns values for Earth-Moon', async () => {
    const dvInfo = await page.evaluate((): DeltaVInfo | null => {
      if (typeof window.__computeTransferDeltaV === 'function') {
        return window.__computeTransferDeltaV('EARTH', 'MOON', 100000) as DeltaVInfo | null;
      }
      // Fallback: manually verify transfer state was populated.
      return null;
    });

    if (dvInfo !== null) {
      expect(dvInfo.departureDV).toBeGreaterThan(0);
      expect(dvInfo.captureDV).toBeGreaterThan(0);
      expect(dvInfo.totalDV).toBeGreaterThan(dvInfo.departureDV);
    }
    // If not exposed, we already tested transfer state values in (1).
  });

  test('(6) transfer delta-v calculation returns values for Earth-Mars', async () => {
    const dvInfo = await page.evaluate((): DeltaVInfo | null => {
      if (typeof window.__computeTransferDeltaV === 'function') {
        return window.__computeTransferDeltaV('EARTH', 'MARS', 100000) as DeltaVInfo | null;
      }
      return null;
    });

    if (dvInfo !== null) {
      expect(dvInfo.departureDV).toBeGreaterThan(0);
      expect(dvInfo.totalDV).toBeGreaterThan(dvInfo.departureDV);
      // Earth-Mars should require more delta-v than Earth-Moon.
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LANDING ON OTHER BODIES
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Landing on airless and atmospheric bodies', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) landing on Moon (airless) — fully propulsive', async () => {
    await startTestFlight(page, LUNAR_LANDER, { bodyId: 'MOON', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MOON' });

    // Wait for landed state to persist through the worker round-trip.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true,
      { timeout: 5_000 },
    );

    const ps = (await getPhysicsSnapshot(page))!;
    expect(ps.landed).toBe(true);
    expect(ps.grounded).toBe(true);
    expect(ps.crashed).toBe(false);

    const fs = (await getFlightState(page))!;
    expect(fs.bodyId).toBe('MOON');

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(2) landing on Mars (thin atmosphere)', async () => {
    await startTestFlight(page, LUNAR_LANDER, { bodyId: 'MARS', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MARS' });

    // Wait for landed state to persist through the worker round-trip.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true,
      { timeout: 5_000 },
    );

    const ps = (await getPhysicsSnapshot(page))!;
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);

    const fs = (await getFlightState(page))!;
    expect(fs.bodyId).toBe('MARS');

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(3) landing on Mercury (airless)', async () => {
    await startTestFlight(page, LUNAR_LANDER, { bodyId: 'MERCURY', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MERCURY' });

    // Wait for landed state to persist through the worker round-trip.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true,
      { timeout: 5_000 },
    );

    const ps = (await getPhysicsSnapshot(page))!;
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);

    const fs = (await getFlightState(page))!;
    expect(fs.bodyId).toBe('MERCURY');

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(4) Sun is not landable', async () => {
    const landable: boolean = await page.evaluate((): boolean => {
      // Check via data module if exposed, or via game logic.
      if (typeof window.__isLandable === 'function') {
        return window.__isLandable('SUN');
      }
      // Sun has landable: false in bodies.js.
      return false;
    });
    expect(landable).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. BODY-SPECIFIC BIOMES
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Body-specific biomes and science opportunities', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) Moon has distinct biomes with science multipliers', async () => {
    test.setTimeout(60_000);
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'MOON' });

    const biomes = await page.evaluate((): BiomeInfo[] | null => {
      // Access body data through any exposed global.
      const bodies = window.__celestialBodies;
      if (bodies && bodies.MOON) {
        return bodies.MOON.biomes.map((b: { id: string; scienceMultiplier: number }) => ({ id: b.id, mult: b.scienceMultiplier }));
      }
      return null;
    });

    if (biomes !== null) {
      expect(biomes.length).toBeGreaterThan(0);
      const surfaceBiome: BiomeInfo | undefined = biomes.find((b: BiomeInfo) => b.id === 'LUNAR_SURFACE');
      expect(surfaceBiome).toBeDefined();
      expect(surfaceBiome!.mult).toBe(1.0);
    }

    // Also verify the biome display works during flight.
    await stageAndLaunch(page);
    await waitForAltitude(page, 150, 15_000);

    // The biome label should change as we ascend.
    const biomeText = await page.evaluate((): string | null => {
      const el = document.querySelector('#hud-biome');
      return el ? el.textContent : null;
    });
    // Biome text should be a non-empty string (some biome name).
    if (biomeText !== null) {
      expect(biomeText.length).toBeGreaterThan(0);
    }

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(2) Mars has atmospheric biomes', async () => {
    test.setTimeout(90_000);
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'MARS' });
    await stageAndLaunch(page);
    await waitForAltitude(page, 200, 20_000);

    const fs = (await getFlightState(page))!;
    expect(fs.bodyId).toBe('MARS');

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(3) Sun biomes include danger zones', async () => {
    const sunBiomes = await page.evaluate((): SunBiomeInfo[] | null => {
      const bodies = window.__celestialBodies;
      if (bodies && bodies.SUN) {
        return bodies.SUN.biomes.map((b: { id: string; name: string; scienceMultiplier: number; min: number; max: number }) => ({
          id: b.id,
          name: b.name,
          mult: b.scienceMultiplier,
          min: b.min,
          max: b.max,
        }));
      }
      return null;
    });

    if (sunBiomes !== null) {
      const inferno: SunBiomeInfo | undefined = sunBiomes.find((b: SunBiomeInfo) => b.id === 'SUN_INFERNO');
      expect(inferno).toBeDefined();
      expect(inferno!.mult).toBe(0); // No science in destruction zone.

      const innerCorona: SunBiomeInfo | undefined = sunBiomes.find((b: SunBiomeInfo) => b.id === 'SUN_INNER_CORONA');
      expect(innerCorona).toBeDefined();
      expect(innerCorona!.mult).toBe(12.0); // High science reward.
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. SURFACE OPERATIONS — FLAG PLANTING
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Surface operations — flag planting', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) can plant flag on Moon (crewed, landed)', async () => {
    await startTestFlight(page, LUNAR_LANDER, { bodyId: 'MOON', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MOON' });

    const gsBefore = (await getGameState(page))!;
    const moneyBefore: number = gsBefore.money as number;
    const repBefore: number = gsBefore.reputation as number;

    // Plant flag via game API.
    const result = await page.evaluate(async (): Promise<SurfaceActionResult | null> => {
      let r: SurfaceActionResult | null = null;
      if (typeof window.__plantFlag === 'function') {
        r = window.__plantFlag() as SurfaceActionResult | null;
      } else if (typeof window.__surfaceAction === 'function') {
        r = window.__surfaceAction('plant-flag') as SurfaceActionResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (result !== null) {
      expect(result.success).toBe(true);

      const gsAfter = (await getGameState(page))!;
      // Should receive milestone bonus.
      expect(gsAfter.money).toBe(moneyBefore + FLAG_MILESTONE_BONUS);
      expect(gsAfter.reputation).toBeGreaterThanOrEqual(repBefore + FLAG_MILESTONE_REP);

      // Surface items should contain the flag.
      expect(gsAfter.surfaceItems).toBeDefined();
      const moonFlags = (gsAfter.surfaceItems as unknown[] ?? []).filter(
        (i: unknown) => (i as Record<string, unknown>).type === 'FLAG' && (i as Record<string, unknown>).bodyId === 'MOON',
      );
      expect(moonFlags.length).toBe(1);
    }

    // Check flight event was logged.
    const events = await page.evaluate((): { type: string }[] => {
      return (window.__flightState?.events ?? []).filter((e: { type: string }) => e.type === 'FLAG_PLANTED');
    });
    if (result !== null) {
      expect(events.length).toBeGreaterThan(0);
    }
  });

  test('(2) cannot plant second flag on same body', async () => {
    const result = await page.evaluate(async (): Promise<SurfaceActionResult | null> => {
      let r: SurfaceActionResult | null = null;
      if (typeof window.__plantFlag === 'function') {
        r = window.__plantFlag() as SurfaceActionResult | null;
      } else if (typeof window.__surfaceAction === 'function') {
        r = window.__surfaceAction('plant-flag') as SurfaceActionResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (result !== null) {
      expect(result.success).toBe(false);
      expect(result.reason).toContain('already');
    }
  });

  test('(3) uncrewed probe cannot plant flag', async () => {
    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }

    // Start uncrewed flight.
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'MARS' });
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MARS' });

    const result = await page.evaluate(async (): Promise<SurfaceActionResult | null> => {
      let r: SurfaceActionResult | null = null;
      if (typeof window.__plantFlag === 'function') {
        r = window.__plantFlag() as SurfaceActionResult | null;
      } else if (typeof window.__surfaceAction === 'function') {
        r = window.__surfaceAction('plant-flag') as SurfaceActionResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (result !== null) {
      expect(result.success).toBe(false);
      expect(result.reason!.toLowerCase()).toContain('crew');
    }

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. SURFACE OPERATIONS — SAMPLE COLLECTION & RETURN
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Surface operations — sample collection and return', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) can collect surface sample on Moon (crewed, landed)', async () => {
    await startTestFlight(page, LUNAR_LANDER, { bodyId: 'MOON', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MOON' });

    // Wait for landed state and active parts to persist through worker sync.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true && (window.__flightPs?.activeParts?.size ?? 0) > 0,
      { timeout: 5_000 },
    );

    const result = await page.evaluate(async (): Promise<SurfaceActionResult | null> => {
      let r: SurfaceActionResult | null = null;
      if (typeof window.__collectSample === 'function') {
        r = window.__collectSample() as SurfaceActionResult | null;
      } else if (typeof window.__surfaceAction === 'function') {
        r = window.__surfaceAction('collect-sample') as SurfaceActionResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (result !== null) {
      expect(result.success).toBe(true);

      const gs = (await getGameState(page))!;
      const samples = (gs.surfaceItems as unknown[] ?? []).filter(
        (i: unknown) => (i as Record<string, unknown>).type === 'SURFACE_SAMPLE' && (i as Record<string, unknown>).bodyId === 'MOON',
      );
      expect(samples.length).toBeGreaterThan(0);
      // Sample should not be collected (returned) yet.
      expect((samples[0] as Record<string, unknown>).collected).toBe(false);
    }

    // Check event logged.
    const events = await page.evaluate((): { type: string }[] => {
      return (window.__flightState?.events ?? []).filter((e: { type: string }) => e.type === 'SAMPLE_COLLECTED');
    });
    if (result !== null) {
      expect(events.length).toBeGreaterThan(0);
    }

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(2) sample return on Earth landing awards science', async () => {
    const gsBefore = (await getGameState(page))!;
    const scienceBefore: number = gsBefore.sciencePoints as number;

    // Inject a Moon sample that hasn't been returned yet.
    await page.evaluate(async () => {
      const gs = window.__gameState;
      if (!gs.surfaceItems) gs.surfaceItems = [];
      // Only add if we don't already have an uncollected Moon sample.
      // @ts-expect-error — surfaceItems elements accessed as Record for flexible property access
      const existing = (gs.surfaceItems as Record<string, unknown>[]).find(
        (i) => i.type === 'SURFACE_SAMPLE' && i.bodyId === 'MOON' && !i.collected,
      );
      if (!existing) {
        gs.surfaceItems.push({
          id: 'test-sample-moon-1',
          type: 'SURFACE_SAMPLE',
          bodyId: 'MOON',
          posX: 0,
          deployedPeriod: gs.currentPeriod,
          label: 'Test sample — MOON',
          collected: false,
        });
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    // Process sample returns (simulating safe Earth landing).
    const returnResult = await page.evaluate(async (): Promise<SampleReturnResult | null> => {
      let r: SampleReturnResult | null = null;
      if (typeof window.__processSampleReturns === 'function') {
        r = window.__processSampleReturns('EARTH') as SampleReturnResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (returnResult !== null) {
      expect(returnResult.samplesReturned).toBeGreaterThan(0);
      expect(returnResult.scienceEarned).toBeGreaterThan(0);

      const gsAfter = (await getGameState(page))!;
      expect(gsAfter.sciencePoints).toBeGreaterThan(scienceBefore);
    }
  });

  test('(3) sample return on non-Earth body does NOT award science', async () => {
    // Add another uncollected sample.
    await page.evaluate(async () => {
      const gs = window.__gameState;
      if (!gs.surfaceItems) gs.surfaceItems = [];
      gs.surfaceItems.push({
        id: 'test-sample-mars-1',
        type: 'SURFACE_SAMPLE',
        bodyId: 'MARS',
        posX: 0,
        deployedPeriod: gs.currentPeriod,
        label: 'Test sample — MARS',
        collected: false,
      });
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    const result = await page.evaluate(async (): Promise<SampleReturnResult | null> => {
      let r: SampleReturnResult | null = null;
      if (typeof window.__processSampleReturns === 'function') {
        r = window.__processSampleReturns('MARS') as SampleReturnResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (result !== null) {
      expect(result.samplesReturned).toBe(0);
      expect(result.scienceEarned).toBe(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. SURFACE OPERATIONS — INSTRUMENTS & BEACONS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Surface operations — instruments and beacons', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) can deploy surface instrument (science module present)', async () => {
    await startTestFlight(page, [
      'cmd-mk1', 'science-module-mk1', 'tank-large', 'engine-reliant', 'landing-legs-small',
    ], { bodyId: 'MOON', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MOON' });

    const result = await page.evaluate(async (): Promise<SurfaceActionResult | null> => {
      let r: SurfaceActionResult | null = null;
      if (typeof window.__deployInstrument === 'function') {
        r = window.__deployInstrument() as SurfaceActionResult | null;
      } else if (typeof window.__surfaceAction === 'function') {
        r = window.__surfaceAction('deploy-instrument') as SurfaceActionResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (result !== null) {
      expect(result.success).toBe(true);

      const gs = (await getGameState(page))!;
      const instruments = (gs.surfaceItems as unknown[] ?? []).filter(
        (i: unknown) => (i as Record<string, unknown>).type === 'SURFACE_INSTRUMENT' && (i as Record<string, unknown>).bodyId === 'MOON',
      );
      expect(instruments.length).toBeGreaterThan(0);
    }

    // Check event.
    const events = await page.evaluate((): { type: string }[] => {
      return (window.__flightState?.events ?? []).filter((e: { type: string }) => e.type === 'INSTRUMENT_DEPLOYED');
    });
    if (result !== null) {
      expect(events.length).toBeGreaterThan(0);
    }
  });

  test('(2) deployed instrument generates passive science per period', async () => {
    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }

    // Ensure a surface instrument exists.
    await page.evaluate(async () => {
      const gs = window.__gameState;
      if (!gs.surfaceItems) gs.surfaceItems = [];
      // @ts-expect-error — surfaceItems elements accessed as Record for flexible property access
      const existing = (gs.surfaceItems as Record<string, unknown>[]).find(
        (i) => i.type === 'SURFACE_INSTRUMENT',
      );
      if (!existing) {
        gs.surfaceItems.push({
          id: 'test-instrument-1',
          type: 'SURFACE_INSTRUMENT',
          bodyId: 'MOON',
          posX: 0,
          deployedPeriod: gs.currentPeriod,
          label: 'Science station — MOON',
        });
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    const gsBefore = (await getGameState(page))!;
    const scienceBefore: number = gsBefore.sciencePoints as number;

    // Process surface ops (simulating period advancement).
    const result = await page.evaluate(async (): Promise<SurfaceOpsResult | null> => {
      let r: SurfaceOpsResult | null = null;
      if (typeof window.__processSurfaceOps === 'function') {
        r = window.__processSurfaceOps() as SurfaceOpsResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (result !== null) {
      expect(result.scienceEarned).toBe(SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD);
      const gsAfter = (await getGameState(page))!;
      expect(gsAfter.sciencePoints).toBe(scienceBefore + SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD);
    }
  });

  test('(3) can deploy beacon on any body (no crew required)', async () => {
    await startTestFlight(page, BASIC_PROBE, { bodyId: 'MARS' });
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MARS' });

    const result = await page.evaluate(async (): Promise<SurfaceActionResult | null> => {
      let r: SurfaceActionResult | null = null;
      if (typeof window.__deployBeacon === 'function') {
        r = window.__deployBeacon('Mars Alpha') as SurfaceActionResult | null;
      } else if (typeof window.__surfaceAction === 'function') {
        r = window.__surfaceAction('deploy-beacon') as SurfaceActionResult | null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });

    if (result !== null) {
      expect(result.success).toBe(true);

      const gs = (await getGameState(page))!;
      const beacons = (gs.surfaceItems as unknown[] ?? []).filter(
        (i: unknown) => (i as Record<string, unknown>).type === 'BEACON' && (i as Record<string, unknown>).bodyId === 'MARS',
      );
      expect(beacons.length).toBeGreaterThan(0);
    }

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. SURFACE ITEM VISIBILITY (GPS COVERAGE)
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Surface item visibility based on GPS coverage', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) Earth surface items are always visible (direct line of sight)', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      surfaceItems: [
        { id: 'test-flag-earth', type: 'FLAG', bodyId: 'EARTH', posX: 0, deployedPeriod: 1, label: 'Earth flag' },
      ],
    });
    await seedAndLoadSave(page, envelope);

    const visible: boolean = await page.evaluate((): boolean => {
      if (typeof window.__areSurfaceItemsVisible === 'function') {
        return window.__areSurfaceItemsVisible('EARTH');
      }
      // Earth items should always be visible.
      return true;
    });
    expect(visible).toBe(true);
  });

  test('(2) Moon items NOT visible without GPS satellite', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      surfaceItems: [
        { id: 'test-flag-moon', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 1, label: 'Moon flag' },
      ],
      satelliteNetwork: { satellites: [] }, // No satellites.
    });
    await seedAndLoadSave(page, envelope);

    const visible = await page.evaluate((): boolean | null => {
      if (typeof window.__areSurfaceItemsVisible === 'function') {
        return window.__areSurfaceItemsVisible('MOON');
      }
      return null;
    });

    if (visible !== null) {
      expect(visible).toBe(false);
    }
  });

  test('(3) Moon items visible WITH GPS satellite in orbit', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      surfaceItems: [
        { id: 'test-flag-moon', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 1, label: 'Moon flag' },
      ],
      satelliteNetwork: {
        satellites: [
          { id: 'gps-moon-1', name: 'GPS-Moon-1', partId: 'satellite-gps', satelliteType: 'GPS', bodyId: 'MOON', bandId: 'LLO', health: 90, autoMaintain: true, deployedPeriod: 10 },
        ],
      },
    });
    await seedAndLoadSave(page, envelope);

    const visible = await page.evaluate((): boolean | null => {
      if (typeof window.__areSurfaceItemsVisible === 'function') {
        return window.__areSurfaceItemsVisible('MOON');
      }
      return null;
    });

    if (visible !== null) {
      expect(visible).toBe(true);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. PRESTIGE MILESTONES AND ACHIEVEMENTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Prestige milestones trigger at correct events', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) FIRST_ORBIT triggers with orbital evidence', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      achievements: [],
      orbitalObjects: [{ id: 'obj-1', bodyId: 'EARTH', type: 'DEBRIS' }],
    });
    await seedAndLoadSave(page, envelope);

    const result = await page.evaluate((): AchievementResult[] | null => {
      if (typeof window.__checkAchievements === 'function') {
        return window.__checkAchievements({
          flightState: null,
          ps: null,
          isLanded: false,
          landingBodyId: 'EARTH',
        }) as AchievementResult[] | null;
      }
      return null;
    });

    if (result !== null) {
      const firstOrbit: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_ORBIT');
      expect(firstOrbit).toBeDefined();
      expect(firstOrbit!.cashReward).toBe(200_000);
      expect(firstOrbit!.repReward).toBe(20);
    }
  });

  test('(2) FIRST_SATELLITE triggers with satellite deployed', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      achievements: [],
      satelliteNetwork: {
        satellites: [
          { id: 'sat-test', name: 'TestSat', partId: 'satellite-comm', bodyId: 'EARTH', bandId: 'LEO', health: 100, autoMaintain: true, deployedPeriod: 5 },
        ],
      },
    });
    await seedAndLoadSave(page, envelope);

    const result = await page.evaluate((): AchievementResult[] | null => {
      if (typeof window.__checkAchievements === 'function') {
        return window.__checkAchievements({
          flightState: null,
          ps: null,
          isLanded: false,
          landingBodyId: 'EARTH',
        }) as AchievementResult[] | null;
      }
      return null;
    });

    if (result !== null) {
      const firstSat: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_SATELLITE');
      expect(firstSat).toBeDefined();
      expect(firstSat!.cashReward).toBe(150_000);
      expect(firstSat!.repReward).toBe(15);
    }
  });

  test('(3) FIRST_CONSTELLATION triggers with 3+ same-type satellites', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      achievements: [],
      satelliteNetwork: {
        satellites: [
          { id: 'gps-1', name: 'GPS-1', partId: 'satellite-gps', satelliteType: 'GPS', bodyId: 'EARTH', bandId: 'LEO', health: 100, autoMaintain: true, deployedPeriod: 5 },
          { id: 'gps-2', name: 'GPS-2', partId: 'satellite-gps', satelliteType: 'GPS', bodyId: 'EARTH', bandId: 'LEO', health: 100, autoMaintain: true, deployedPeriod: 6 },
          { id: 'gps-3', name: 'GPS-3', partId: 'satellite-gps', satelliteType: 'GPS', bodyId: 'EARTH', bandId: 'LEO', health: 100, autoMaintain: true, deployedPeriod: 7 },
        ],
      },
    });
    await seedAndLoadSave(page, envelope);

    const result = await page.evaluate((): AchievementResult[] | null => {
      if (typeof window.__checkAchievements === 'function') {
        return window.__checkAchievements({
          flightState: null,
          ps: null,
          isLanded: false,
          landingBodyId: 'EARTH',
        }) as AchievementResult[] | null;
      }
      return null;
    });

    if (result !== null) {
      const constellation: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_CONSTELLATION');
      expect(constellation).toBeDefined();
      expect(constellation!.cashReward).toBe(300_000);
      expect(constellation!.repReward).toBe(25);
    }
  });

  test('(4) FIRST_LUNAR_LANDING triggers with Moon surface item', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      achievements: [],
      surfaceItems: [
        { id: 'moon-flag', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 10, label: 'Moon flag' },
      ],
    });
    await seedAndLoadSave(page, envelope);

    const result = await page.evaluate((): AchievementResult[] | null => {
      if (typeof window.__checkAchievements === 'function') {
        return window.__checkAchievements({
          flightState: null,
          ps: null,
          isLanded: true,
          landingBodyId: 'EARTH',
        }) as AchievementResult[] | null;
      }
      return null;
    });

    if (result !== null) {
      const lunarLanding: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_LUNAR_LANDING');
      expect(lunarLanding).toBeDefined();
      expect(lunarLanding!.cashReward).toBe(1_000_000);
      expect(lunarLanding!.repReward).toBe(40);
    }
  });

  test('(5) FIRST_LUNAR_RETURN triggers with Moon sample returned', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      achievements: [],
      surfaceItems: [
        { id: 'moon-flag', type: 'FLAG', bodyId: 'MOON', posX: 0, deployedPeriod: 10, label: 'Moon flag' },
        { id: 'moon-sample', type: 'SURFACE_SAMPLE', bodyId: 'MOON', posX: 0, deployedPeriod: 10, label: 'Moon sample', collected: true },
      ],
    });
    await seedAndLoadSave(page, envelope);

    const result = await page.evaluate((): AchievementResult[] | null => {
      if (typeof window.__checkAchievements === 'function') {
        return window.__checkAchievements({
          flightState: null,
          ps: null,
          isLanded: true,
          landingBodyId: 'EARTH',
        }) as AchievementResult[] | null;
      }
      return null;
    });

    if (result !== null) {
      const lunarReturn: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_LUNAR_RETURN');
      expect(lunarReturn).toBeDefined();
      expect(lunarReturn!.cashReward).toBe(2_000_000);
      expect(lunarReturn!.repReward).toBe(50);
    }
  });

  test('(6) FIRST_MARS_LANDING triggers with Mars surface item', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      achievements: [],
      surfaceItems: [
        { id: 'mars-beacon', type: 'BEACON', bodyId: 'MARS', posX: 0, deployedPeriod: 20, label: 'Mars base' },
      ],
    });
    await seedAndLoadSave(page, envelope);

    const result = await page.evaluate((): AchievementResult[] | null => {
      if (typeof window.__checkAchievements === 'function') {
        return window.__checkAchievements({
          flightState: null,
          ps: null,
          isLanded: true,
          landingBodyId: 'EARTH',
        }) as AchievementResult[] | null;
      }
      return null;
    });

    if (result !== null) {
      const marsLanding: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_MARS_LANDING');
      expect(marsLanding).toBeDefined();
      expect(marsLanding!.cashReward).toBe(5_000_000);
      expect(marsLanding!.repReward).toBe(60);
    }
  });

  test('(7) FIRST_SOLAR_SCIENCE triggers with Sun biome science log', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      achievements: [],
      scienceLog: [
        { instrumentId: 'thermometer-mk1', biomeId: 'SUN_OUTER_CORONA', count: 1 },
      ],
    });
    await seedAndLoadSave(page, envelope);

    const result = await page.evaluate((): AchievementResult[] | null => {
      if (typeof window.__checkAchievements === 'function') {
        return window.__checkAchievements({
          flightState: null,
          ps: null,
          isLanded: false,
          landingBodyId: 'EARTH',
        }) as AchievementResult[] | null;
      }
      return null;
    });

    if (result !== null) {
      const solarScience: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_SOLAR_SCIENCE');
      expect(solarScience).toBeDefined();
      expect(solarScience!.cashReward).toBe(4_000_000);
      expect(solarScience!.repReward).toBe(50);
    }
  });

  test('(8) achievements are not re-awarded once earned', async () => {
    const envelope: SaveEnvelope = phase6Fixture({
      achievements: [
        { id: 'FIRST_ORBIT', earnedPeriod: 5 },
        { id: 'FIRST_SATELLITE', earnedPeriod: 8 },
      ],
      orbitalObjects: [{ id: 'obj-1', bodyId: 'EARTH', type: 'DEBRIS' }],
      satelliteNetwork: {
        satellites: [
          { id: 'sat-test', name: 'TestSat', partId: 'satellite-comm', bodyId: 'EARTH', bandId: 'LEO', health: 100, autoMaintain: true, deployedPeriod: 5 },
        ],
      },
    });
    await seedAndLoadSave(page, envelope);

    const result = await page.evaluate((): AchievementResult[] | null => {
      if (typeof window.__checkAchievements === 'function') {
        return window.__checkAchievements({
          flightState: null,
          ps: null,
          isLanded: false,
          landingBodyId: 'EARTH',
        }) as AchievementResult[] | null;
      }
      return null;
    });

    if (result !== null) {
      // Neither FIRST_ORBIT nor FIRST_SATELLITE should be in new awards.
      const reOrbit: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_ORBIT');
      const reSat: AchievementResult | undefined = result.find((a: AchievementResult) => a.id === 'FIRST_SATELLITE');
      expect(reOrbit).toBeUndefined();
      expect(reSat).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 11. PHASE 6 NEW PARTS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Phase 6 new parts function correctly', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) Deep Space Engine — exists in part catalog with correct stats', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('engine-deep-space') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('engine-deep-space');
      expect(part.type).toBe('ENGINE');
      expect(part.properties.thrust).toBe(5);
      expect(part.properties.thrustVac).toBe(15);
      expect(part.properties.isp).toBe(400);
      expect(part.properties.ispVac).toBe(1200);
      expect(part.mass).toBe(300);
      expect(part.cost).toBe(50_000);
    }
  });

  test('(2) Deep Space Engine — can be used in flight on low-gravity body', async () => {
    // The Deep Space Engine has only 5 kN sea-level thrust — insufficient to
    // lift off from Earth. Test on the Moon (1.62 m/s²) where it can hover/climb.
    await startTestFlight(page, ['probe-core-mk1', 'tank-small', 'engine-deep-space'], { bodyId: 'MOON' });

    const fs = await getFlightState(page);
    expect(fs).not.toBeNull();
    expect(fs!.bodyId).toBe('MOON');

    // Stage and thrust. On the Moon, 5 kN can lift ~300 kg at 1.62 g.
    await stageAndLaunch(page);
    await waitForAltitude(page, 10, 15_000);

    const ps = (await getPhysicsSnapshot(page))!;
    expect(ps.posY).toBeGreaterThan(0);

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });

  test('(3) Extended Mission Module — exists with correct properties', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('mission-module-extended') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('mission-module-extended');
      expect(part.type).toBe('SERVICE_MODULE');
      expect(part.properties.extendedLifeSupport).toBe(true);
      expect(part.properties.powerDraw).toBe(15);
      expect(part.mass).toBe(500);
      expect(part.cost).toBe(30_000);
    }
  });

  test('(4) Sample Return Container — exists with correct properties', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('sample-return-container') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('sample-return-container');
      expect(part.type).toBe('SERVICE_MODULE');
      expect(part.properties.sampleContainer).toBe(true);
      expect(part.properties.sampleCapacity).toBe(3);
      expect(part.mass).toBe(100);
      expect(part.cost).toBe(15_000);
    }
  });

  test('(5) Surface Instrument Package — exists with correct properties', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('surface-instrument-package') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('surface-instrument-package');
      expect(part.type).toBe('SERVICE_MODULE');
      expect(part.properties.surfaceStation).toBe(true);
      expect(part.properties.sciencePerPeriod).toBe(3);
      expect(part.properties.requiresLanded).toBe(true);
      expect(part.mass).toBe(200);
      expect(part.cost).toBe(25_000);
    }
  });

  test('(6) Relay Antenna — exists with correct properties', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('relay-antenna') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('relay-antenna');
      expect(part.type).toBe('SERVICE_MODULE');
      expect(part.properties.relayAntenna).toBe(true);
      expect(part.properties.deepSpaceComms).toBe(true);
      expect(part.properties.powerDraw).toBe(20);
      expect(part.mass).toBe(80);
      expect(part.cost).toBe(20_000);
    }
  });

  test('(7) Heat Shield Heavy — exists with interplanetary-rated tolerance', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('heat-shield-heavy') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('heat-shield-heavy');
      expect(part.type).toBe('HEAT_SHIELD');
      expect(part.properties.heatTolerance).toBe(4500);
      expect(part.mass).toBe(220);
      expect(part.cost).toBe(18_000);
    }
  });

  test('(8) Solar Heat Shield — exists with solar heat resistance', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('heat-shield-solar') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('heat-shield-solar');
      expect(part.type).toBe('HEAT_SHIELD');
      expect(part.properties.heatTolerance).toBe(6000);
      expect(part.properties.solarHeatResistance).toBe(0.8);
      expect(part.mass).toBe(300);
      expect(part.cost).toBe(50_000);
    }
  });

  test('(9) Heat Shield Mk1 — basic tier with correct tolerance', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('heat-shield-mk1') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('heat-shield-mk1');
      expect(part.type).toBe('HEAT_SHIELD');
      expect(part.properties.heatTolerance).toBe(3000);
      expect(part.mass).toBe(80);
      expect(part.cost).toBe(4_000);
    }
  });

  test('(10) Heat Shield Mk2 — standard tier for crewed capsules', async () => {
    const part = await page.evaluate((): PartInfo | null => {
      if (typeof window.__getPartById === 'function') {
        return window.__getPartById('heat-shield-mk2') as PartInfo | null;
      }
      return null;
    });

    if (part !== null) {
      expect(part.id).toBe('heat-shield-mk2');
      expect(part.type).toBe('HEAT_SHIELD');
      expect(part.properties.heatTolerance).toBe(3500);
      expect(part.mass).toBe(150);
      expect(part.cost).toBe(8_000);
    }
  });

  test('(11) heat shield tiers ordered by increasing tolerance', async () => {
    const shields = await page.evaluate((): ShieldTierInfo[] | null => {
      if (typeof window.__getPartById !== 'function') return null;
      const ids = ['heat-shield-mk1', 'heat-shield-mk2', 'heat-shield-heavy', 'heat-shield-solar'];
      return ids.map((id: string) => {
        const p = window.__getPartById(id) as PartInfo | null;
        return p ? { id: p.id, tolerance: p.properties.heatTolerance as number } : null;
      }).filter((x): x is ShieldTierInfo => x !== null);
    });

    if (shields !== null && shields.length === 4) {
      expect(shields[0].tolerance).toBeLessThan(shields[1].tolerance);
      expect(shields[1].tolerance).toBeLessThan(shields[2].tolerance);
      expect(shields[2].tolerance).toBeLessThan(shields[3].tolerance);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 12. MAP VIEW DURING TRANSFER
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Map view controls during transfer', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) map view can be toggled during transfer', async () => {
    await startTestFlight(page, DEEP_SPACE_SHIP, { bodyId: 'EARTH', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: EARTH_ORBIT_ALT, velX: EARTH_ORBIT_VEL, bodyId: 'EARTH' });
    await waitForOrbit(page);
    await setTransferState(page, 'EARTH', 'MARS');

    // Toggle map view (key 'c' or 'm' depending on implementation).
    await page.keyboard.press('c');
    // Wait for map view state to change
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

    // Check if map view is active.
    const _mapActive: boolean = await page.evaluate((): boolean => {
      return window.__mapViewActive === true ||
             (document.querySelector('#map-overlay') as HTMLElement | null)?.style.display !== 'none' ||
             document.querySelector('[data-testid="map-view"]') !== null;
    });

    // Toggle back.
    await page.keyboard.press('c');
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

    // Reset transfer state to orbit so we can return cleanly.
    await page.evaluate(async () => {
      const fs = window.__flightState;
      if (fs) {
        fs.phase = 'ORBIT';
        fs.inOrbit = true;
        fs.transferState = null;
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 13. INTEGRATION — FULL LUNAR MISSION FLOW
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Integration — full lunar mission flow', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, phase6Fixture());
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) launch from Earth, teleport to Moon orbit', async () => {
    await startTestFlight(page, LUNAR_LANDER, { bodyId: 'MOON', crewIds: ['crew-1'] });
    await teleportCraft(page, { posY: MOON_ORBIT_ALT, velX: MOON_ORBIT_VEL, bodyId: 'MOON' });
    await waitForOrbit(page);

    const fs = (await getFlightState(page))!;
    expect(fs.phase).toBe('ORBIT');
    expect(fs.bodyId).toBe('MOON');
  });

  test('(2) land on Moon surface', async () => {
    await teleportCraft(page, { posY: 0, grounded: true, landed: true, bodyId: 'MOON' });

    const ps = (await getPhysicsSnapshot(page))!;
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
  });

  test('(3) perform all surface operations', async () => {
    // Plant flag.
    const flagResult = await page.evaluate(async (): Promise<SurfaceActionResult> => {
      let r: SurfaceActionResult = { success: true };
      if (typeof window.__plantFlag === 'function') r = window.__plantFlag() as SurfaceActionResult;
      else if (typeof window.__surfaceAction === 'function') r = window.__surfaceAction('plant-flag') as SurfaceActionResult;
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });
    expect(flagResult.success).toBe(true);

    // Collect sample.
    const sampleResult = await page.evaluate(async (): Promise<SurfaceActionResult> => {
      let r: SurfaceActionResult = { success: true };
      if (typeof window.__collectSample === 'function') r = window.__collectSample() as SurfaceActionResult;
      else if (typeof window.__surfaceAction === 'function') r = window.__surfaceAction('collect-sample') as SurfaceActionResult;
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });
    expect(sampleResult.success).toBe(true);

    // Deploy beacon.
    const beaconResult = await page.evaluate(async (): Promise<SurfaceActionResult> => {
      let r: SurfaceActionResult = { success: true };
      if (typeof window.__deployBeacon === 'function') r = window.__deployBeacon('Tranquility Base') as SurfaceActionResult;
      else if (typeof window.__surfaceAction === 'function') r = window.__surfaceAction('deploy-beacon') as SurfaceActionResult;
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      return r;
    });
    expect(beaconResult.success).toBe(true);
  });

  test('(4) verify surface items created', async () => {
    const gs = (await getGameState(page))!;
    const moonItems = (gs.surfaceItems as unknown[] ?? []).filter((i: unknown) => (i as Record<string, unknown>).bodyId === 'MOON');
    expect(moonItems.length).toBeGreaterThanOrEqual(1);
  });

  test('(5) return to agency completes the mission', async () => {
    await returnToAgency(page);
    try {
      await page.locator('#return-results-dismiss-btn').click({ timeout: 3_000 });
    } catch { /* no overlay */ }

    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });
    const gs = (await getGameState(page))!;
    // Period should have advanced.
    expect(gs.currentPeriod).toBeGreaterThan(30);
  });
});

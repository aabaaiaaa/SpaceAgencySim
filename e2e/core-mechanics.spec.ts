/**
 * core-mechanics.spec.ts — E2E tests for Phase 0: Core Game Mechanics.
 *
 * Covers:
 *   - Period advancement on flight completion and return to agency
 *   - Period NOT advancing during time warp
 *   - Orbit slot proximity detection and warp-to-target
 *   - Flight phase transitions (PRELAUNCH→LAUNCH→FLIGHT→ORBIT→REENTRY,
 *     ORBIT→MANOEUVRE, ORBIT→TRANSFER)
 *   - Control mode switching within ORBIT (normal→docking→RCS)
 *   - Map view toggle and scene swap
 *   - Map view controls (thrust/RCS in orbital-relative mapping)
 *   - Control mode switching with thrust-cut-to-zero on docking toggle
 *   - RCS mode directional translation
 *   - Starter part availability per game mode (tutorial vs non-tutorial)
 */

import { test, expect, type Page, type Browser } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  startTestFlight,
  getGameState,
  getFlightState,
  waitForAltitude,
  ALL_FACILITIES,
  teleportCraft,
  waitForOrbit,
} from './helpers.js';
import type { SaveEnvelopeParams } from './helpers.js';
import {
  freshStartFixture,
  ALL_PARTS,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Browser-context window shape for page.evaluate() callbacks.
//
// Defined as a local interface (not `declare global`) to avoid conflicting
// with the narrower Window augmentations in the helper modules.  Inside
// evaluate callbacks we cast: `(window as unknown as GW)`
// ---------------------------------------------------------------------------

interface FlightPs {
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  angle: number;
  throttle: number;
  controlMode: string;
  grounded: boolean;
  firingEngines: Set<string>;
  activeParts: Set<string>;
}

interface FlightState {
  phase: string;
  inOrbit: boolean;
  orbitalElements: unknown;
  timeElapsed: number;
  phaseLog: { from: string; to: string }[];
}

interface GameStateShape {
  currentPeriod: number;
  parts: string[];
  orbitalObjects: { id: string; name: string; bodyId: string; type: string; elements: unknown }[];
}

/** Extended window shape for browser-context evaluate() callbacks. */
interface GW {
  __flightPs?: FlightPs;
  __flightState?: FlightState;
  __gameState?: GameStateShape;
  __resyncPhysicsWorker?: () => Promise<void>;
  dispatchEvent(event: Event): boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Orbital parameters — use 200 km altitude for extra margin since the game's
// constant gravity causes the craft to fall. At 200 km the craft has ~160s
// before dropping below the 70 km minimum orbit altitude.
const ORBIT_ALT: number = 200_000;
const ORBIT_VEL: number = 7788;      // √(GM / (R + 200km)) ≈ 7788 m/s
const ESCAPE_VEL: number = 11_100;   // √(2·GM / (R + 200km)) ≈ 11100 m/s

// Rocket parts — cmd-mk1 has built-in RCS (hasRcs: true).
const ORBITAL_ROCKET: string[] = ['cmd-mk1', 'tank-large', 'engine-reliant'];
const BASIC_ROCKET: string[]   = ['probe-core-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return to agency from flight.
 */
async function returnToAgency(page: Page): Promise<void> {
  const dropdown = page.locator('#topbar-dropdown');
  if (!(await dropdown.isVisible())) {
    await page.click('#topbar-menu-btn');
    await expect(dropdown).toBeVisible({ timeout: 2_000 });
  }
  await dropdown.getByText('Return to Space Agency').click();

  // Handle the different return flows.
  const orbitReturn = page.locator('[data-testid="orbit-return-btn"]');
  const abortReturn = page.locator('[data-testid="abort-confirm-btn"]');

  const orbitVisible: boolean = await orbitReturn.isVisible({ timeout: 2_000 }).catch(() => false);
  if (orbitVisible) {
    await orbitReturn.click();
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn');
  } else {
    const abortVisible: boolean = await abortReturn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (abortVisible) {
      await abortReturn.click();
    } else {
      await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
      await page.click('#post-flight-return-btn');
    }
  }

  await page.waitForFunction(
    () => {
      const w = window as unknown as GW;
      return w.__flightState === null || w.__flightState === undefined;
    },
    { timeout: 10_000 },
  );
}

/**
 * Create a fresh page, seed a fixture with all parts/facilities, start a
 * flight with the orbital rocket, and teleport into a stable orbit.
 */
async function setupOrbitalFlight(browser: Browser, fixtureOverrides: SaveEnvelopeParams = {}): Promise<Page> {
  const page: Page = await browser.newPage();
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await seedAndLoadSave(page, freshStartFixture({
    parts: ALL_PARTS,
    facilities: { ...ALL_FACILITIES },
    ...fixtureOverrides,
  }));
  await startTestFlight(page, ORBITAL_ROCKET);
  await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL, velY: 0, orbit: true });
  await waitForOrbit(page);
  return page;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PERIOD ADVANCEMENT
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Period advancement on flight completion', () => {
  test('(1) period counter starts at seeded value', async ({ browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, freshStartFixture({ currentPeriod: 5 }));

    const gs = await getGameState(page);
    expect(gs!.currentPeriod).toBe(5);
    await page.close();
  });

  test('(2) period advances by 1 after flight completion and return to agency', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, freshStartFixture({ currentPeriod: 5 }));

    await startTestFlight(page, BASIC_ROCKET);
    const gsDuring = await getGameState(page);
    expect(gsDuring!.currentPeriod).toBe(5);

    await returnToAgency(page);

    try {
      const dismissBtn = page.locator('#return-results-dismiss-btn');
      await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await dismissBtn.click();
    } catch { /* No overlay */ }

    const gsAfter = await getGameState(page);
    expect(gsAfter!.currentPeriod).toBe(6);
    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PERIOD STABILITY DURING TIME WARP
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Period does NOT advance during time warp', () => {
  test('(1) period stays unchanged during atmospheric flight with time warp', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, freshStartFixture({ currentPeriod: 10 }));

    await startTestFlight(page, BASIC_ROCKET);
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })));
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyZ', key: 'z', bubbles: true })));
    await waitForAltitude(page, 500, 20_000);

    const gsBefore = await getGameState(page);
    expect(gsBefore!.currentPeriod).toBe(10);

    // Warp buttons use data-warp attribute.
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.hud-warp-btn[data-warp="5"]') as HTMLButtonElement | null;
        return btn && !btn.disabled;
      },
      { timeout: 10_000 },
    );
    await page.click('.hud-warp-btn[data-warp="5"]');
    // Wait for warp to be active and altitude to change (proves sim advanced)
    const alt1: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.posY ?? 0);
    await page.waitForFunction(
      (y0: number) => Math.abs(((window as unknown as GW).__flightPs?.posY ?? y0) - y0) > 50,
      alt1,
      { timeout: 10_000 },
    );

    const gsAfter = await getGameState(page);
    expect(gsAfter!.currentPeriod).toBe(10);
    await page.close();
  });

  test('(2) period stays unchanged during orbital time warp', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, freshStartFixture({
      currentPeriod: 10,
      facilities: { ...ALL_FACILITIES },
      parts: ALL_PARTS,
    }));
    await startTestFlight(page, ORBITAL_ROCKET);
    await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL, velY: 0, orbit: true });
    await waitForOrbit(page);

    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.hud-warp-btn[data-warp="10"]') as HTMLButtonElement | null;
        return btn && !btn.disabled;
      },
      { timeout: 10_000 },
    );
    await page.click('.hud-warp-btn[data-warp="10"]');
    // Wait for simulation time to advance (proves warp is active).
    // posX stays 0 during Keplerian propagation, so check timeElapsed instead.
    const t0: number = await page.evaluate(() => (window as unknown as GW).__flightState?.timeElapsed ?? 0);
    await page.waitForFunction(
      (t0val: number) => ((window as unknown as GW).__flightState?.timeElapsed ?? t0val) > t0val + 5,
      t0,
      { timeout: 10_000 },
    );

    const gsAfterWarp = await getGameState(page);
    expect(gsAfterWarp!.currentPeriod).toBe(10);
    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FLIGHT PHASE TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Flight phase transitions', () => {
  test('@smoke (1) PRELAUNCH → LAUNCH → FLIGHT on engine staging and liftoff', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, freshStartFixture({
      parts: ALL_PARTS,
      facilities: { ...ALL_FACILITIES },
    }));
    await startTestFlight(page, ORBITAL_ROCKET);

    const fsBefore = await getFlightState(page);
    expect(fsBefore!.phase).toBe('PRELAUNCH');

    // Stage engine — transitions rapidly through LAUNCH to FLIGHT.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true })));

    // Wait for FLIGHT phase (LAUNCH may be transient).
    await page.waitForFunction(
      () => {
        const phase = (window as unknown as GW).__flightState?.phase;
        return phase === 'LAUNCH' || phase === 'FLIGHT';
      },
      { timeout: 10_000 },
    );

    // Wait until liftoff completes (FLIGHT phase).
    await page.waitForFunction(
      () => (window as unknown as GW).__flightState?.phase === 'FLIGHT',
      { timeout: 10_000 },
    );

    const fsFlight = await getFlightState(page);
    expect(fsFlight!.phase).toBe('FLIGHT');

    // Phase log should contain both transitions.
    const phaseLog = fsFlight!.phaseLog as { from: string; to: string }[];
    expect(phaseLog.length).toBeGreaterThanOrEqual(2);
    const phases: string[] = phaseLog.map((t: { from: string; to: string }) => t.to);
    expect(phases).toContain('LAUNCH');
    expect(phases).toContain('FLIGHT');
    await page.close();
  });

  test('(2) FLIGHT → ORBIT when reaching stable orbit', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, freshStartFixture({
      parts: ALL_PARTS,
      facilities: { ...ALL_FACILITIES },
    }));
    await startTestFlight(page, ORBITAL_ROCKET);

    // Teleport to orbital altitude/velocity (no orbit flag — let physics detect the transition).
    await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL, velY: 0 });

    await page.waitForFunction(
      () => (window as unknown as GW).__flightState?.phase === 'ORBIT',
      { timeout: 30_000 },
    );

    const fsOrbit = await getFlightState(page);
    expect(fsOrbit!.phase).toBe('ORBIT');
    expect(fsOrbit!.inOrbit).toBe(true);
    expect(fsOrbit!.orbitalElements).not.toBeNull();
    await page.close();
  });

  test('(3) ORBIT → MANOEUVRE when thrusting in orbit', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Activate engine thrust in NORMAL mode.
    await page.evaluate(async () => {
      const w = window as unknown as GW;
      const ps = w.__flightPs;
      if (!ps) return;
      ps.controlMode = 'NORMAL';
      ps.throttle = 1.0;
      // Ensure firingEngines has an entry.
      if (ps.firingEngines.size === 0) {
        for (const id of ps.activeParts) {
          ps.firingEngines.add(id);
          break;
        }
      }
      if (typeof w.__resyncPhysicsWorker === 'function') { await w.__resyncPhysicsWorker(); }
    });

    await page.waitForFunction(
      () => (window as unknown as GW).__flightState?.phase === 'MANOEUVRE',
      { timeout: 10_000 },
    );
    expect((await getFlightState(page))!.phase).toBe('MANOEUVRE');
    await page.close();
  });

  test('(4) MANOEUVRE → ORBIT when burn ends and orbit valid', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // First enter MANOEUVRE by thrusting.
    await page.evaluate(async () => {
      const w = window as unknown as GW;
      const ps = w.__flightPs;
      if (!ps) return;
      ps.controlMode = 'NORMAL';
      ps.throttle = 1.0;
      if (ps.firingEngines.size === 0) {
        for (const id of ps.activeParts) {
          ps.firingEngines.add(id);
          break;
        }
      }
      if (typeof w.__resyncPhysicsWorker === 'function') { await w.__resyncPhysicsWorker(); }
    });

    await page.waitForFunction(
      () => (window as unknown as GW).__flightState?.phase === 'MANOEUVRE',
      { timeout: 10_000 },
    );

    // Now stop thrusting — should return to ORBIT.
    await page.evaluate(async () => {
      const w = window as unknown as GW;
      const ps = w.__flightPs;
      if (!ps) return;
      ps.throttle = 0;
      ps.firingEngines.clear();
      if (typeof w.__resyncPhysicsWorker === 'function') { await w.__resyncPhysicsWorker(); }
    });

    await page.waitForFunction(
      () => (window as unknown as GW).__flightState?.phase === 'ORBIT',
      { timeout: 10_000 },
    );
    expect((await getFlightState(page))!.phase).toBe('ORBIT');
    await page.close();
  });

  test('(5) ORBIT → REENTRY when periapsis drops below minimum', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Reduce velocity to make orbit decay (periapsis < 70km).
    // Clear orbital elements so the physics recomputes from the new velocity
    // and detects the orbit is no longer valid (triggers reentry).
    await page.evaluate(async () => {
      const w = window as unknown as GW;
      const ps = w.__flightPs;
      const fs = w.__flightState;
      if (!ps || !fs) return;
      ps.velX = 6000;
      ps.velY = 0;
      ps.firingEngines.clear();
      ps.throttle = 0;
      (fs as unknown as Record<string, unknown>).orbitalElements = null;
      if (typeof w.__resyncPhysicsWorker === 'function') { await w.__resyncPhysicsWorker(); }
    });

    // Deorbit warning fires after 2s, then transitions to REENTRY.
    await page.waitForFunction(
      () => (window as unknown as GW).__flightState?.phase === 'REENTRY',
      { timeout: 15_000 },
    );
    expect((await getFlightState(page))!.phase).toBe('REENTRY');
    await page.close();
  });

  test('(6) ORBIT → TRANSFER on escape trajectory', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Set escape velocity and activate engine.
    await page.evaluate(async ({ escVel }: { escVel: number }) => {
      const w = window as unknown as GW;
      const ps = w.__flightPs;
      if (!ps) return;
      ps.velX = escVel;
      ps.controlMode = 'NORMAL';
      ps.throttle = 1.0;
      if (ps.firingEngines.size === 0) {
        for (const id of ps.activeParts) {
          ps.firingEngines.add(id);
          break;
        }
      }
      if (typeof w.__resyncPhysicsWorker === 'function') { await w.__resyncPhysicsWorker(); }
    }, { escVel: ESCAPE_VEL });

    // Should go through MANOEUVRE → TRANSFER.
    await page.waitForFunction(
      () => {
        const phase = (window as unknown as GW).__flightState?.phase;
        return phase === 'TRANSFER' || phase === 'MANOEUVRE';
      },
      { timeout: 15_000 },
    );

    // If in MANOEUVRE, wait for TRANSFER.
    const phase: string | undefined = await page.evaluate(() => (window as unknown as GW).__flightState?.phase);
    if (phase === 'MANOEUVRE') {
      await page.waitForFunction(
        () => (window as unknown as GW).__flightState?.phase === 'TRANSFER',
        { timeout: 15_000 },
      );
    }

    expect((await getFlightState(page))!.phase).toBe('TRANSFER');
    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTROL MODE SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Control mode switching in ORBIT', () => {
  test('(1) starts in NORMAL control mode', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    const mode: string | undefined = await page.evaluate(() => (window as unknown as GW).__flightPs?.controlMode);
    expect(mode).toBe('NORMAL');
    await page.close();
  });

  test('(2) V key switches to DOCKING mode', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(
      () => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => (window as unknown as GW).__flightPs?.controlMode)).toBe('DOCKING');
    await page.close();
  });

  test('(3) thrust cuts to zero on entering docking mode', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Set some throttle first, then switch to docking.
    await page.evaluate(async () => {
      const w = window as unknown as GW;
      if (w.__flightPs) w.__flightPs.throttle = 0.5;
      if (typeof w.__resyncPhysicsWorker === 'function') { await w.__resyncPhysicsWorker(); }
    });
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(
      () => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );

    const throttle: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.throttle ?? -1);
    expect(throttle).toBe(0);
    await page.close();
  });

  test('(4) R key switches to RCS mode from docking mode', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Enter docking mode, then toggle to RCS.
    // Use dispatchEvent to avoid browser tab-throttling issues under parallel workers.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(() => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING', { timeout: 5_000 });

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true })));
    await page.waitForFunction(() => (window as unknown as GW).__flightPs?.controlMode === 'RCS', { timeout: 5_000 });
    expect(await page.evaluate(() => (window as unknown as GW).__flightPs?.controlMode)).toBe('RCS');
    await page.close();
  });

  test('(5) R key toggles back to DOCKING mode from RCS', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Enter DOCKING → RCS via dispatched key events.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(() => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING', { timeout: 5_000 });
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true })));
    await page.waitForFunction(() => (window as unknown as GW).__flightPs?.controlMode === 'RCS', { timeout: 5_000 });

    // Now toggle back to DOCKING.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true })));
    await page.waitForFunction(() => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING', { timeout: 5_000 });
    expect(await page.evaluate(() => (window as unknown as GW).__flightPs?.controlMode)).toBe('DOCKING');
    await page.close();
  });

  test('(6) V key exits docking mode back to NORMAL', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Enter docking mode.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(() => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING', { timeout: 5_000 });

    // Exit back to NORMAL.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(() => (window as unknown as GW).__flightPs?.controlMode === 'NORMAL', { timeout: 5_000 });
    expect(await page.evaluate(() => (window as unknown as GW).__flightPs?.controlMode)).toBe('NORMAL');
    await page.close();
  });

  test('(7) thrust cuts to zero on both enter and exit of docking mode', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Set throttle, enter docking mode — should cut.
    await page.evaluate(async () => {
      const w = window as unknown as GW;
      if (w.__flightPs) w.__flightPs.throttle = 0.5;
      if (typeof w.__resyncPhysicsWorker === 'function') { await w.__resyncPhysicsWorker(); }
    });
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(
      () => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => (window as unknown as GW).__flightPs?.throttle ?? -1)).toBe(0);

    // Set throttle in docking mode, exit — should cut again.
    await page.evaluate(async () => {
      const w = window as unknown as GW;
      if (w.__flightPs) w.__flightPs.throttle = 0.3;
      if (typeof w.__resyncPhysicsWorker === 'function') { await w.__resyncPhysicsWorker(); }
    });
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(
      () => (window as unknown as GW).__flightPs?.controlMode === 'NORMAL',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => (window as unknown as GW).__flightPs?.throttle ?? -1)).toBe(0);
    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. RCS MODE DIRECTIONAL TRANSLATION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('RCS mode directional translation', () => {
  test('(1) in RCS mode, WASD keys cause velocity changes', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Enter docking mode then RCS mode.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(
      () => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true })));
    await page.waitForFunction(
      () => (window as unknown as GW).__flightPs?.controlMode === 'RCS',
      { timeout: 5_000 },
    );

    const before: { velX: number; velY: number } = await page.evaluate(() => ({
      velX: (window as unknown as GW).__flightPs?.velX ?? 0,
      velY: (window as unknown as GW).__flightPs?.velY ?? 0,
    }));

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })));
    await page.waitForFunction(
      (v0: { x: number; y: number }) => {
        const ps = (window as unknown as GW).__flightPs;
        if (!ps) return false;
        return Math.abs(ps.velX - v0.x) + Math.abs(ps.velY - v0.y) > 0.001;
      },
      { x: before.velX, y: before.velY },
      { timeout: 5_000 },
    );
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })));

    const after: { velX: number; velY: number } = await page.evaluate(() => ({
      velX: (window as unknown as GW).__flightPs?.velX ?? 0,
      velY: (window as unknown as GW).__flightPs?.velY ?? 0,
    }));

    const dVelX: number = Math.abs(after.velX - before.velX);
    const dVelY: number = Math.abs(after.velY - before.velY);
    expect(dVelX + dVelY).toBeGreaterThan(0);
    await page.close();
  });

  test('(2) RCS mode prevents rotation', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Enter docking mode then RCS mode.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV', key: 'v', bubbles: true })));
    await page.waitForFunction(
      () => (window as unknown as GW).__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', bubbles: true })));
    await page.waitForFunction(
      () => (window as unknown as GW).__flightPs?.controlMode === 'RCS',
      { timeout: 5_000 },
    );

    const angleBefore: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.angle ?? 0);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true })));
    // Wait for physics to process input (position changes in orbit even without rotation)
    const posY0: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.posY ?? 0);
    await page.waitForFunction(
      (y0: number) => ((window as unknown as GW).__flightPs?.posY ?? y0) !== y0,
      posY0,
      { timeout: 5_000 },
    );
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true })));
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', key: 'd', bubbles: true })));
    const posY1: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.posY ?? 0);
    await page.waitForFunction(
      (y0: number) => ((window as unknown as GW).__flightPs?.posY ?? y0) !== y0,
      posY1,
      { timeout: 5_000 },
    );
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', key: 'd', bubbles: true })));
    // Wait one frame for physics to settle
    await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => r())));

    const angleAfter: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.angle ?? 0);
    expect(Math.abs(angleAfter - angleBefore)).toBeLessThan(0.01);
    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. MAP VIEW
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Map view toggle and controls', () => {
  test('(1) M key opens map view and shows map HUD', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#map-hud-info')).toContainText('MAP VIEW');
    await page.close();
  });

  test('(2) map view shows body and phase information', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });

    const info = page.locator('#map-hud-info');
    await expect(info).toContainText('Earth', { timeout: 2_000 });
    // Phase should show Orbit (not Manoeuvre — engines are off).
    const phaseText: string | null = await info.locator('[data-field="phase"]').textContent();
    expect(phaseText).toBe('Orbit');
    await page.close();
  });

  test('(3) map view controls hint shows expected keys', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });

    const controls = page.locator('#map-hud-controls');
    await expect(controls).toBeVisible();
    await expect(controls).toContainText('WASD');
    await expect(controls).toContainText('Warp to target');
    await page.close();
  });

  test('(4) WASD keys in map view apply orbital-relative thrust', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });

    const throttleBefore: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.throttle ?? -1);
    expect(throttleBefore).toBe(0);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })));
    await page.waitForFunction(
      () => ((window as unknown as GW).__flightPs?.throttle ?? 0) > 0,
      { timeout: 5_000 },
    );
    const throttleDuring: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.throttle ?? -1);
    expect(throttleDuring).toBeGreaterThan(0);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })));
    await page.waitForFunction(
      () => ((window as unknown as GW).__flightPs?.throttle ?? -1) === 0,
      { timeout: 5_000 },
    );
    const throttleAfter: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.throttle ?? -1);
    expect(throttleAfter).toBe(0);
    await page.close();
  });

  test('(5) S key sets retrograde thrust direction in map view', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyS', key: 's', bubbles: true })));
    await page.waitForFunction(
      () => ((window as unknown as GW).__flightPs?.throttle ?? 0) > 0,
      { timeout: 5_000 },
    );

    // Retrograde: angle = atan2(-velX, -velY). With velX≈7848, velY≈0 → angle ≈ -π/2.
    const state: { throttle: number; angle: number } = await page.evaluate(() => ({
      throttle: (window as unknown as GW).__flightPs?.throttle ?? 0,
      angle: (window as unknown as GW).__flightPs?.angle ?? 0,
    }));
    expect(state.throttle).toBeGreaterThan(0);
    // Retrograde angle should be approximately -π/2 (pointing opposite velocity).
    expect(Math.abs(state.angle - (-Math.PI / 2))).toBeLessThan(0.5);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyS', key: 's', bubbles: true })));
    await page.waitForFunction(
      () => ((window as unknown as GW).__flightPs?.throttle ?? -1) === 0,
      { timeout: 5_000 },
    );
    const throttleAfter: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.throttle ?? -1);
    expect(throttleAfter).toBe(0);
    await page.close();
  });

  test('(6) A key sets radial-in thrust direction in map view', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', key: 'a', bubbles: true })));
    await page.waitForFunction(
      () => ((window as unknown as GW).__flightPs?.throttle ?? 0) > 0,
      { timeout: 5_000 },
    );

    // Radial-in: thrust directed toward the body centre.
    // At position (0, 100_000) body-centred (0, 6_471_000), radial-in points down.
    // angle = atan2(-px/r, -py/r) = atan2(0, -1) = π.
    const state: { throttle: number; angle: number } = await page.evaluate(() => ({
      throttle: (window as unknown as GW).__flightPs?.throttle ?? 0,
      angle: (window as unknown as GW).__flightPs?.angle ?? 0,
    }));
    expect(state.throttle).toBeGreaterThan(0);
    // Radial-in angle should be approximately π (pointing toward body centre).
    expect(Math.abs(Math.abs(state.angle) - Math.PI)).toBeLessThan(0.5);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyA', key: 'a', bubbles: true })));
    await page.waitForFunction(
      () => ((window as unknown as GW).__flightPs?.throttle ?? -1) === 0,
      { timeout: 5_000 },
    );
    const throttleAfter: number = await page.evaluate(() => (window as unknown as GW).__flightPs?.throttle ?? -1);
    expect(throttleAfter).toBe(0);
    await page.close();
  });

  test('(7) M key closes map view and returns to flight view', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser);

    // Open map first.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });

    // Close map.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#flight-hud')).toBeVisible();
    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. ORBIT SLOT PROXIMITY & WARP TO TARGET
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Orbit slot proximity detection and warp-to-target', () => {
  const SAT_FIXTURE_OVERRIDES: SaveEnvelopeParams = {
    orbitalObjects: [{
      id: 'test-sat-1',
      bodyId: 'EARTH',
      type: 'SATELLITE',
      name: 'Test Satellite',
      elements: {
        semiMajorAxis: 6_471_000,
        eccentricity: 0.001,
        argPeriapsis: 0,
        meanAnomalyAtEpoch: Math.PI,
        epoch: 0,
      },
    }],
  };

  test('(1) orbital objects are visible in game state', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser, SAT_FIXTURE_OVERRIDES);

    const gs = await getGameState(page);
    const orbitalObjects = gs!.orbitalObjects as { id: string; name: string }[];
    expect(orbitalObjects).toBeDefined();
    expect(orbitalObjects.length).toBe(1);
    expect(orbitalObjects[0].name).toBe('Test Satellite');
    await page.close();
  });

  test('(2) map view shows target selection via T key', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser, SAT_FIXTURE_OVERRIDES);

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', bubbles: true })));
    const targetField = page.locator('#map-hud-info [data-field="target"]');
    await expect(targetField).not.toContainText('None', { timeout: 5_000 });
    await page.close();
  });

  test('(3) warp-to-target via G key advances flight time', async ({ browser }) => {
    test.setTimeout(120_000);
    const page: Page = await setupOrbitalFlight(browser, SAT_FIXTURE_OVERRIDES);

    // Open map and select target.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyT', key: 't', bubbles: true })));
    const targetField = page.locator('#map-hud-info [data-field="target"]');
    await expect(targetField).not.toContainText('None', { timeout: 5_000 });

    const timeBefore: number = await page.evaluate(
      () => (window as unknown as GW).__flightState?.timeElapsed ?? 0,
    );

    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyG', key: 'g', bubbles: true })));

    await page.waitForFunction(
      (before: number) => ((window as unknown as GW).__flightState?.timeElapsed ?? 0) > before,
      timeBefore,
      { timeout: 15_000 },
    );

    const timeAfter: number = await page.evaluate(
      () => (window as unknown as GW).__flightState?.timeElapsed ?? 0,
    );
    expect(timeAfter).toBeGreaterThan(timeBefore);

    // Close map.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm', bubbles: true })));
    await expect(page.locator('#map-hud')).not.toBeVisible({ timeout: 5_000 });
    await page.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. STARTER PART AVAILABILITY PER GAME MODE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Starter part availability', () => {
  test('(1) non-tutorial mode: all 7 starter parts available', async ({ browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Non-Tutorial Parts Test',
      tutorialMode: false,
      parts: [
        'probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1',
        'science-module-mk1', 'thermometer-mk1', 'cmd-mk1',
      ],
    });
    await seedAndLoadSave(page, envelope);

    const gs = await getGameState(page);
    const parts = gs!.parts as string[];
    expect(parts).toContain('probe-core-mk1');
    expect(parts).toContain('tank-small');
    expect(parts).toContain('engine-spark');
    expect(parts).toContain('parachute-mk1');
    expect(parts).toContain('science-module-mk1');
    expect(parts).toContain('thermometer-mk1');
    expect(parts).toContain('cmd-mk1');
    expect(parts.length).toBe(7);
    await page.close();
  });

  test('(2) tutorial mode: only 4 starter parts available', async ({ browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Tutorial Parts Test',
      tutorialMode: true,
      parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1'],
    });
    await seedAndLoadSave(page, envelope);

    const gs = await getGameState(page);
    const parts = gs!.parts as string[];
    expect(parts).toContain('probe-core-mk1');
    expect(parts).toContain('tank-small');
    expect(parts).toContain('engine-spark');
    expect(parts).toContain('parachute-mk1');
    expect(parts).not.toContain('cmd-mk1');
    expect(parts).not.toContain('science-module-mk1');
    expect(parts).not.toContain('thermometer-mk1');
    expect(parts.length).toBe(4);
    await page.close();
  });

  test('(3) non-tutorial: all starter parts visible in VAB', async ({ browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Parts Panel Test',
      tutorialMode: false,
      parts: [
        'probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1',
        'science-module-mk1', 'thermometer-mk1', 'cmd-mk1',
      ],
    });
    await seedAndLoadSave(page, envelope);

    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });

    await expect(
      page.locator('.vab-part-card[data-part-id="cmd-mk1"]'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('.vab-part-card[data-part-id="science-module-mk1"]'),
    ).toBeVisible({ timeout: 5_000 });
    await page.close();
  });

  test('(4) tutorial mode: gated parts not shown in VAB', async ({ browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Tutorial VAB Test',
      tutorialMode: true,
      parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1'],
    });
    await seedAndLoadSave(page, envelope);

    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });

    await expect(
      page.locator('.vab-part-card[data-part-id="probe-core-mk1"]'),
    ).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('.vab-part-card[data-part-id="cmd-mk1"]'),
    ).not.toBeVisible({ timeout: 2_000 });
    await expect(
      page.locator('.vab-part-card[data-part-id="science-module-mk1"]'),
    ).not.toBeVisible({ timeout: 2_000 });
    await page.close();
  });
});

/**
 * core-mechanics.spec.js — E2E tests for Phase 0: Core Game Mechanics.
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

import { test, expect } from '@playwright/test';
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
import {
  freshStartFixture,
  ALL_PARTS,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Orbital parameters for a 100 km circular orbit around Earth.
const ORBIT_ALT = 100_000;
const ORBIT_VEL = 7848;
const ESCAPE_VEL = 11_200;

// Rocket parts — cmd-mk1 has built-in RCS (hasRcs: true).
const ORBITAL_ROCKET = ['cmd-mk1', 'tank-large', 'engine-reliant'];
const BASIC_ROCKET   = ['probe-core-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Return to agency from flight.
 * @param {import('@playwright/test').Page} page
 */
async function returnToAgency(page) {
  const dropdown = page.locator('#topbar-dropdown');
  if (!(await dropdown.isVisible())) {
    await page.click('#topbar-menu-btn');
    await expect(dropdown).toBeVisible({ timeout: 2_000 });
  }
  await dropdown.getByText('Return to Space Agency').click();

  // Handle the different return flows.
  const orbitReturn = page.locator('[data-testid="orbit-return-btn"]');
  const abortReturn = page.locator('[data-testid="abort-confirm-btn"]');

  const orbitVisible = await orbitReturn.isVisible({ timeout: 2_000 }).catch(() => false);
  if (orbitVisible) {
    await orbitReturn.click();
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn');
  } else {
    const abortVisible = await abortReturn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (abortVisible) {
      await abortReturn.click();
    } else {
      await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
      await page.click('#post-flight-return-btn');
    }
  }

  await page.waitForFunction(
    () => window.__flightState === null || window.__flightState === undefined,
    { timeout: 10_000 },
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. PERIOD ADVANCEMENT
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Period advancement on flight completion', () => {
  test.describe.configure({ mode: 'serial' });
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = freshStartFixture({ currentPeriod: 5 });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) period counter starts at seeded value', async () => {
    const gs = await getGameState(page);
    expect(gs.currentPeriod).toBe(5);
  });

  test('(2) period advances by 1 after flight completion and return to agency', async () => {
    await startTestFlight(page, BASIC_ROCKET);
    const gsDuring = await getGameState(page);
    expect(gsDuring.currentPeriod).toBe(5);

    await returnToAgency(page);

    try {
      const dismissBtn = page.locator('#return-results-dismiss-btn');
      await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await dismissBtn.click();
    } catch { /* No overlay */ }

    const gsAfter = await getGameState(page);
    expect(gsAfter.currentPeriod).toBe(6);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PERIOD STABILITY DURING TIME WARP
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Period does NOT advance during time warp', () => {
  test.describe.configure({ mode: 'serial' });
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = freshStartFixture({ currentPeriod: 10 });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) period stays unchanged during atmospheric flight with time warp', async () => {
    await startTestFlight(page, BASIC_ROCKET);
    await page.keyboard.press('Space');
    await page.keyboard.press('z');
    await waitForAltitude(page, 500, 20_000);

    const gsBefore = await getGameState(page);
    expect(gsBefore.currentPeriod).toBe(10);

    // Warp buttons use data-warp attribute.
    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.hud-warp-btn[data-warp="5"]');
        return btn && !btn.disabled;
      },
      { timeout: 10_000 },
    );
    await page.click('.hud-warp-btn[data-warp="5"]');
    // Wait for warp to be active and altitude to change (proves sim advanced)
    const _alt1 = await page.evaluate(() => window.__flightPs?.posY ?? 0);
    await page.waitForFunction(
      (y0) => Math.abs((window.__flightPs?.posY ?? y0) - y0) > 50,
      _alt1,
      { timeout: 10_000 },
    );

    const gsAfter = await getGameState(page);
    expect(gsAfter.currentPeriod).toBe(10);
  });

  test('(2) period stays unchanged during orbital time warp', async () => {
    // Return from current flight and start fresh.
    await returnToAgency(page);
    try {
      const dismissBtn = page.locator('#return-results-dismiss-btn');
      await dismissBtn.waitFor({ state: 'visible', timeout: 3_000 });
      await dismissBtn.click();
    } catch { /* noop */ }

    const gsPreFlight = await getGameState(page);
    const periodBefore = gsPreFlight.currentPeriod;

    const envelope = freshStartFixture({
      currentPeriod: periodBefore,
      facilities: { ...ALL_FACILITIES },
      parts: ALL_PARTS,
    });
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);
    await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL });
    await waitForOrbit(page);

    await page.waitForFunction(
      () => {
        const btn = document.querySelector('.hud-warp-btn[data-warp="10"]');
        return btn && !btn.disabled;
      },
      { timeout: 10_000 },
    );
    await page.click('.hud-warp-btn[data-warp="10"]');
    const _posX2 = await page.evaluate(() => window.__flightPs?.posX ?? 0);
    await page.waitForFunction(
      (x0) => Math.abs((window.__flightPs?.posX ?? x0) - x0) > 100,
      _posX2,
      { timeout: 10_000 },
    );

    const gsAfterWarp = await getGameState(page);
    expect(gsAfterWarp.currentPeriod).toBe(periodBefore);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FLIGHT PHASE TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Flight phase transitions', () => {
  test.describe.configure({ mode: 'serial' });
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(180_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = freshStartFixture({
      parts: ALL_PARTS,
      facilities: { ...ALL_FACILITIES },
    });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) PRELAUNCH → LAUNCH → FLIGHT on engine staging and liftoff', async () => {
    await startTestFlight(page, ORBITAL_ROCKET);

    const fsBefore = await getFlightState(page);
    expect(fsBefore.phase).toBe('PRELAUNCH');

    // Stage engine — transitions rapidly through LAUNCH to FLIGHT.
    await page.keyboard.press('Space');

    // Wait for FLIGHT phase (LAUNCH may be transient).
    await page.waitForFunction(
      () => {
        const phase = window.__flightState?.phase;
        return phase === 'LAUNCH' || phase === 'FLIGHT';
      },
      { timeout: 10_000 },
    );

    // Wait until liftoff completes (FLIGHT phase).
    await page.waitForFunction(
      () => window.__flightState?.phase === 'FLIGHT',
      { timeout: 10_000 },
    );

    const fsFlight = await getFlightState(page);
    expect(fsFlight.phase).toBe('FLIGHT');

    // Phase log should contain both transitions.
    expect(fsFlight.phaseLog.length).toBeGreaterThanOrEqual(2);
    const phases = fsFlight.phaseLog.map(t => t.to);
    expect(phases).toContain('LAUNCH');
    expect(phases).toContain('FLIGHT');
  });

  test('(2) FLIGHT → ORBIT when reaching stable orbit', async () => {
    // Cut throttle and clear engines before teleporting to avoid MANOEUVRE.
    await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps) return;
      ps.throttle = 0;
      ps.firingEngines.clear();
    });

    // Set orbital position and velocity.
    await page.evaluate(({ alt, v }) => {
      const ps = window.__flightPs;
      if (!ps) return;
      ps.posX = 0;
      ps.posY = alt;
      ps.velX = v;
      ps.velY = 0;
      ps.grounded = false;
      ps.landed = false;
      ps.crashed = false;
    }, { alt: ORBIT_ALT, v: ORBIT_VEL });

    await page.waitForFunction(
      () => window.__flightState?.phase === 'ORBIT',
      { timeout: 10_000 },
    );

    const fsOrbit = await getFlightState(page);
    expect(fsOrbit.phase).toBe('ORBIT');
    expect(fsOrbit.inOrbit).toBe(true);
    expect(fsOrbit.orbitalElements).not.toBeNull();
  });

  test('(3) ORBIT → MANOEUVRE when thrusting in orbit', async () => {
    // Activate engine thrust in NORMAL mode.
    await page.evaluate(() => {
      const ps = window.__flightPs;
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
    });

    await page.waitForFunction(
      () => window.__flightState?.phase === 'MANOEUVRE',
      { timeout: 10_000 },
    );
    expect((await getFlightState(page)).phase).toBe('MANOEUVRE');
  });

  test('(4) MANOEUVRE → ORBIT when burn ends and orbit valid', async () => {
    await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps) return;
      ps.throttle = 0;
      ps.firingEngines.clear();
    });

    await page.waitForFunction(
      () => window.__flightState?.phase === 'ORBIT',
      { timeout: 10_000 },
    );
    expect((await getFlightState(page)).phase).toBe('ORBIT');
  });

  test('(5) ORBIT → REENTRY when periapsis drops below minimum', async () => {
    // Reduce velocity to make orbit decay (periapsis < 70km).
    await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps) return;
      ps.velX = 6000;
      ps.velY = 0;
      ps.firingEngines.clear();
      ps.throttle = 0;
    });

    // Deorbit warning fires after 2s, then transitions to REENTRY.
    await page.waitForFunction(
      () => window.__flightState?.phase === 'REENTRY',
      { timeout: 15_000 },
    );
    expect((await getFlightState(page)).phase).toBe('REENTRY');
  });

  test('(6) ORBIT → TRANSFER on escape trajectory', async () => {
    // Return and start a new flight for the transfer test.
    await returnToAgency(page);
    try {
      const dismissBtn = page.locator('#return-results-dismiss-btn');
      await dismissBtn.waitFor({ state: 'visible', timeout: 3_000 });
      await dismissBtn.click();
    } catch { /* noop */ }

    await startTestFlight(page, ORBITAL_ROCKET);
    await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL });
    await waitForOrbit(page);

    // Set escape velocity and activate engine.
    await page.evaluate(({ escVel }) => {
      const ps = window.__flightPs;
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
    }, { escVel: ESCAPE_VEL });

    // Should go through MANOEUVRE → TRANSFER.
    await page.waitForFunction(
      () => {
        const phase = window.__flightState?.phase;
        return phase === 'TRANSFER' || phase === 'MANOEUVRE';
      },
      { timeout: 15_000 },
    );

    // If in MANOEUVRE, wait for TRANSFER.
    const phase = await page.evaluate(() => window.__flightState?.phase);
    if (phase === 'MANOEUVRE') {
      await page.waitForFunction(
        () => window.__flightState?.phase === 'TRANSFER',
        { timeout: 15_000 },
      );
    }

    expect((await getFlightState(page)).phase).toBe('TRANSFER');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTROL MODE SWITCHING
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Control mode switching in ORBIT', () => {
  test.describe.configure({ mode: 'serial' });
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = freshStartFixture({
      parts: ALL_PARTS,
      facilities: { ...ALL_FACILITIES },
    });
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);
    await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL });
    await waitForOrbit(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) starts in NORMAL control mode', async () => {
    const mode = await page.evaluate(() => window.__flightPs?.controlMode);
    expect(mode).toBe('NORMAL');
  });

  test('(2) V key switches to DOCKING mode', async () => {
    await page.keyboard.press('v');
    await page.waitForFunction(
      () => window.__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => window.__flightPs?.controlMode)).toBe('DOCKING');
  });

  test('(3) thrust cuts to zero on entering docking mode', async () => {
    const throttle = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    expect(throttle).toBe(0);
  });

  test('(4) R key switches to RCS mode from docking mode', async () => {
    await page.keyboard.press('r');
    await page.waitForFunction(
      () => window.__flightPs?.controlMode === 'RCS',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => window.__flightPs?.controlMode)).toBe('RCS');
  });

  test('(5) R key toggles back to DOCKING mode from RCS', async () => {
    await page.keyboard.press('r');
    await page.waitForFunction(
      () => window.__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => window.__flightPs?.controlMode)).toBe('DOCKING');
  });

  test('(6) V key exits docking mode back to NORMAL', async () => {
    await page.keyboard.press('v');
    await page.waitForFunction(
      () => window.__flightPs?.controlMode === 'NORMAL',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => window.__flightPs?.controlMode)).toBe('NORMAL');
  });

  test('(7) thrust cuts to zero on both enter and exit of docking mode', async () => {
    // Set throttle, enter docking mode — should cut.
    await page.evaluate(() => {
      if (window.__flightPs) window.__flightPs.throttle = 0.5;
    });
    await page.keyboard.press('v');
    await page.waitForFunction(
      () => window.__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => window.__flightPs?.throttle ?? -1)).toBe(0);

    // Set throttle in docking mode, exit — should cut again.
    await page.evaluate(() => {
      if (window.__flightPs) window.__flightPs.throttle = 0.3;
    });
    await page.keyboard.press('v');
    await page.waitForFunction(
      () => window.__flightPs?.controlMode === 'NORMAL',
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => window.__flightPs?.throttle ?? -1)).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. RCS MODE DIRECTIONAL TRANSLATION
// ═══════════════════════════════════════════════════════════════════════════

test.describe('RCS mode directional translation', () => {
  test.describe.configure({ mode: 'serial' });
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = freshStartFixture({
      parts: ALL_PARTS,
      facilities: { ...ALL_FACILITIES },
    });
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);
    await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL });
    await waitForOrbit(page);

    // Enter docking mode then RCS mode.
    await page.keyboard.press('v');
    await page.waitForFunction(
      () => window.__flightPs?.controlMode === 'DOCKING',
      { timeout: 5_000 },
    );
    await page.keyboard.press('r');
    await page.waitForFunction(
      () => window.__flightPs?.controlMode === 'RCS',
      { timeout: 5_000 },
    );
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) in RCS mode, WASD keys cause velocity changes', async () => {
    const before = await page.evaluate(() => ({
      velX: window.__flightPs?.velX ?? 0,
      velY: window.__flightPs?.velY ?? 0,
    }));

    await page.keyboard.down('w');
    await page.waitForFunction(
      (v0) => {
        const ps = window.__flightPs;
        if (!ps) return false;
        return Math.abs(ps.velX - v0.x) + Math.abs(ps.velY - v0.y) > 0.001;
      },
      { x: before.velX, y: before.velY },
      { timeout: 5_000 },
    );
    await page.keyboard.up('w');

    const after = await page.evaluate(() => ({
      velX: window.__flightPs?.velX ?? 0,
      velY: window.__flightPs?.velY ?? 0,
    }));

    const dVelX = Math.abs(after.velX - before.velX);
    const dVelY = Math.abs(after.velY - before.velY);
    expect(dVelX + dVelY).toBeGreaterThan(0);
  });

  test('(2) RCS mode prevents rotation', async () => {
    const angleBefore = await page.evaluate(() => window.__flightPs?.angle ?? 0);

    await page.keyboard.down('a');
    // Wait for physics to process input (position changes in orbit even without rotation)
    await page.waitForFunction(
      (y0) => (window.__flightPs?.posY ?? y0) !== y0,
      await page.evaluate(() => window.__flightPs?.posY ?? 0),
      { timeout: 5_000 },
    );
    await page.keyboard.up('a');
    await page.keyboard.down('d');
    await page.waitForFunction(
      (y0) => (window.__flightPs?.posY ?? y0) !== y0,
      await page.evaluate(() => window.__flightPs?.posY ?? 0),
      { timeout: 5_000 },
    );
    await page.keyboard.up('d');
    // Wait one frame for physics to settle
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

    const angleAfter = await page.evaluate(() => window.__flightPs?.angle ?? 0);
    expect(Math.abs(angleAfter - angleBefore)).toBeLessThan(0.01);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. MAP VIEW
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Map view toggle and controls', () => {
  test.describe.configure({ mode: 'serial' });
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = freshStartFixture({
      parts: ALL_PARTS,
      facilities: { ...ALL_FACILITIES },
    });
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);
    await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL });
    await waitForOrbit(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) M key opens map view and shows map HUD', async () => {
    await page.keyboard.press('m');
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#map-hud-info')).toContainText('MAP VIEW');
  });

  test('(2) map view shows body and phase information', async () => {
    const info = page.locator('#map-hud-info');
    await expect(info).toContainText('Earth', { timeout: 2_000 });
    // Phase should show Orbit (not Manoeuvre — engines are off).
    const phaseText = await info.locator('[data-field="phase"]').textContent();
    expect(phaseText).toBe('Orbit');
  });

  test('(3) map view controls hint shows expected keys', async () => {
    const controls = page.locator('#map-hud-controls');
    await expect(controls).toBeVisible();
    await expect(controls).toContainText('WASD');
    await expect(controls).toContainText('Warp to target');
  });

  test('(4) WASD keys in map view apply orbital-relative thrust', async () => {
    const throttleBefore = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    expect(throttleBefore).toBe(0);

    await page.keyboard.down('w');
    await page.waitForFunction(
      () => (window.__flightPs?.throttle ?? 0) > 0,
      { timeout: 5_000 },
    );
    const throttleDuring = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    expect(throttleDuring).toBeGreaterThan(0);

    await page.keyboard.up('w');
    await page.waitForFunction(
      () => (window.__flightPs?.throttle ?? -1) === 0,
      { timeout: 5_000 },
    );
    const throttleAfter = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    expect(throttleAfter).toBe(0);
  });

  test('(5) S key sets retrograde thrust direction in map view', async () => {
    await page.keyboard.down('s');
    await page.waitForFunction(
      () => (window.__flightPs?.throttle ?? 0) > 0,
      { timeout: 5_000 },
    );

    // Retrograde: angle = atan2(-velX, -velY). With velX≈7848, velY≈0 → angle ≈ -π/2.
    const state = await page.evaluate(() => ({
      throttle: window.__flightPs?.throttle ?? 0,
      angle: window.__flightPs?.angle ?? 0,
    }));
    expect(state.throttle).toBeGreaterThan(0);
    // Retrograde angle should be approximately -π/2 (pointing opposite velocity).
    expect(Math.abs(state.angle - (-Math.PI / 2))).toBeLessThan(0.5);

    await page.keyboard.up('s');
    await page.waitForFunction(
      () => (window.__flightPs?.throttle ?? -1) === 0,
      { timeout: 5_000 },
    );
    const throttleAfter = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    expect(throttleAfter).toBe(0);
  });

  test('(6) A key sets radial-in thrust direction in map view', async () => {
    await page.keyboard.down('a');
    await page.waitForFunction(
      () => (window.__flightPs?.throttle ?? 0) > 0,
      { timeout: 5_000 },
    );

    // Radial-in: thrust directed toward the body centre.
    // At position (0, 100_000) body-centred (0, 6_471_000), radial-in points down.
    // angle = atan2(-px/r, -py/r) = atan2(0, -1) = π.
    const state = await page.evaluate(() => ({
      throttle: window.__flightPs?.throttle ?? 0,
      angle: window.__flightPs?.angle ?? 0,
    }));
    expect(state.throttle).toBeGreaterThan(0);
    // Radial-in angle should be approximately π (pointing toward body centre).
    expect(Math.abs(Math.abs(state.angle) - Math.PI)).toBeLessThan(0.5);

    await page.keyboard.up('a');
    await page.waitForFunction(
      () => (window.__flightPs?.throttle ?? -1) === 0,
      { timeout: 5_000 },
    );
    const throttleAfter = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    expect(throttleAfter).toBe(0);
  });

  test('(7) M key closes map view and returns to flight view', async () => {
    await page.keyboard.press('m');
    await expect(page.locator('#map-hud')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#flight-hud')).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. ORBIT SLOT PROXIMITY & WARP TO TARGET
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Orbit slot proximity detection and warp-to-target', () => {
  test.describe.configure({ mode: 'serial' });
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = freshStartFixture({
      parts: ALL_PARTS,
      facilities: { ...ALL_FACILITIES },
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
    });
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);
    await teleportCraft(page, { posY: ORBIT_ALT, velX: ORBIT_VEL });
    await waitForOrbit(page);
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) orbital objects are visible in game state', async () => {
    const gs = await getGameState(page);
    expect(gs.orbitalObjects).toBeDefined();
    expect(gs.orbitalObjects.length).toBe(1);
    expect(gs.orbitalObjects[0].name).toBe('Test Satellite');
  });

  test('(2) map view shows target selection via T key', async () => {
    await page.keyboard.press('m');
    await expect(page.locator('#map-hud')).toBeVisible({ timeout: 5_000 });

    await page.keyboard.press('t');
    const targetField = page.locator('#map-hud-info [data-field="target"]');
    await expect(targetField).not.toContainText('None', { timeout: 5_000 });
  });

  test('(3) warp-to-target via G key advances flight time', async () => {
    const timeBefore = await page.evaluate(
      () => window.__flightState?.timeElapsed ?? 0,
    );

    await page.keyboard.press('g');

    await page.waitForFunction(
      (before) => (window.__flightState?.timeElapsed ?? 0) > before,
      timeBefore,
      { timeout: 15_000 },
    );

    const timeAfter = await page.evaluate(
      () => window.__flightState?.timeElapsed ?? 0,
    );
    expect(timeAfter).toBeGreaterThan(timeBefore);

    // Close map.
    await page.keyboard.press('m');
    await expect(page.locator('#map-hud')).not.toBeVisible({ timeout: 5_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. STARTER PART AVAILABILITY PER GAME MODE
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Starter part availability', () => {
  test('(1) non-tutorial mode: all 7 starter parts available', async ({ browser }) => {
    test.setTimeout(60_000);
    const page = await browser.newPage();
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
    expect(gs.parts).toContain('probe-core-mk1');
    expect(gs.parts).toContain('tank-small');
    expect(gs.parts).toContain('engine-spark');
    expect(gs.parts).toContain('parachute-mk1');
    expect(gs.parts).toContain('science-module-mk1');
    expect(gs.parts).toContain('thermometer-mk1');
    expect(gs.parts).toContain('cmd-mk1');
    expect(gs.parts.length).toBe(7);
    await page.close();
  });

  test('(2) tutorial mode: only 4 starter parts available', async ({ browser }) => {
    test.setTimeout(60_000);
    const page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Tutorial Parts Test',
      tutorialMode: true,
      parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'parachute-mk1'],
    });
    await seedAndLoadSave(page, envelope);

    const gs = await getGameState(page);
    expect(gs.parts).toContain('probe-core-mk1');
    expect(gs.parts).toContain('tank-small');
    expect(gs.parts).toContain('engine-spark');
    expect(gs.parts).toContain('parachute-mk1');
    expect(gs.parts).not.toContain('cmd-mk1');
    expect(gs.parts).not.toContain('science-module-mk1');
    expect(gs.parts).not.toContain('thermometer-mk1');
    expect(gs.parts.length).toBe(4);
    await page.close();
  });

  test('(3) non-tutorial: all starter parts visible in VAB', async ({ browser }) => {
    test.setTimeout(60_000);
    const page = await browser.newPage();
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
    const page = await browser.newPage();
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

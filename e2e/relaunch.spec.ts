import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, startTestFlight, teleportCraft,
  pressStage, pressThrottleUp, pressThrottleCut,
} from './helpers.js';

/**
 * E2E — Relaunch (Takeoff → Land → Takeoff Again)
 *
 * Each test is independent — starts its own flight via startTestFlight.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UNLOCKED_PARTS: string[] = ['cmd-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupFlight(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
  });
  await seedAndLoadSave(page, envelope);
  await startTestFlight(page, UNLOCKED_PARTS);
}

async function stageAndThrottle(page: Page): Promise<void> {
  await pressStage(page);
  await pressThrottleUp(page);
}

test.describe('Relaunch — Takeoff, Land, Takeoff Again', () => {

  test('(1) rocket lifts off after staging and reaches altitude > 50 m', async ({ page }) => {
    await setupFlight(page);

    const grounded = await page.evaluate(() => window.__flightPs?.grounded);
    expect(grounded).toBe(true);

    await stageAndThrottle(page);

    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 50,
      undefined,
      { timeout: 5_000 },
    );

    const groundedAfter = await page.evaluate(() => window.__flightPs?.grounded);
    expect(groundedAfter).toBe(false);

    const alt = await page.evaluate(() => window.__flightPs?.posY ?? 0);
    expect(alt).toBeGreaterThan(50);
  });

  test('(2) rocket lands safely after a controlled descent', async ({ page }) => {
    await setupFlight(page);
    await stageAndThrottle(page);

    // Gain some altitude first.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 30,
      undefined,
      { timeout: 5_000 },
    );

    // Cut throttle and teleport near ground with gentle descent.
    await pressThrottleCut(page);
    await teleportCraft(page, { posY: 0.1, velX: 0, velY: -0.5, grounded: false, landed: false });

    // Wait for the teleported position to take effect before checking landing.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 999) < 5,
      undefined,
      { timeout: 5_000 },
    );

    await page.waitForFunction(
      () => window.__flightPs?.landed === true,
      undefined,
      { timeout: 5_000 },
    );

    // Wait for physics to settle position and velocity after landing.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true && window.__flightPs?.posY === 0 && window.__flightPs?.velY === 0,
      undefined,
      { timeout: 5_000 },
    );

    const state = await page.evaluate(() => ({
      landed:  window.__flightPs?.landed,
      posY:    window.__flightPs?.posY,
      velY:    window.__flightPs?.velY,
    }));
    expect(state.landed).toBe(true);
    expect(state.posY).toBe(0);
    expect(state.velY).toBe(0);
  });

  test('(3) rocket takes off again after landing when engines fire', async ({ page }) => {
    await setupFlight(page);
    await stageAndThrottle(page);

    // Gain altitude.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 30,
      undefined,
      { timeout: 5_000 },
    );

    // Cut throttle and land gently.
    await pressThrottleCut(page);
    await teleportCraft(page, { posY: 0.1, velX: 0, velY: -0.5, grounded: false, landed: false });

    // Wait for the teleported position to take effect before checking landing.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 999) < 5,
      undefined,
      { timeout: 5_000 },
    );

    await page.waitForFunction(
      () => window.__flightPs?.landed === true,
      undefined,
      { timeout: 5_000 },
    );

    // Verify landed.
    expect(await page.evaluate(() => window.__flightPs?.landed)).toBe(true);

    // Re-enable engine firing (teleportCraft clears firingEngines, but the
    // re-liftoff mechanic needs engines active).
    await page.evaluate(async () => {
      const ps = window.__flightPs;
      const assembly = window.__flightAssembly;
      if (ps && assembly) {
        for (const [id, p] of assembly.parts) {
          if (p.partId === 'engine-spark') ps.firingEngines.add(id);
        }
        if (typeof window.__resyncPhysicsWorker === 'function') {
          await window.__resyncPhysicsWorker();
        }
      }
    });

    // Full throttle to re-liftoff.
    await pressThrottleUp(page);

    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 5,
      undefined,
      { timeout: 5_000 },
    );

    const flying = await page.evaluate(() => ({
      posY:     window.__flightPs?.posY ?? 0,
      grounded: window.__flightPs?.grounded,
      landed:   window.__flightPs?.landed,
    }));
    expect(flying.posY).toBeGreaterThan(5);
    expect(flying.grounded).toBe(false);
    expect(flying.landed).toBe(false);
  });
});

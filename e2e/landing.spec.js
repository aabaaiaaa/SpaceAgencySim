import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, startTestFlight,
} from './helpers.js';

/**
 * E2E — Flight Landing
 *
 * Tests the complete landing sequence using a two-stage rocket.
 * Each test is independent and builds/launches its own rocket.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnvelope() {
  return buildSaveEnvelope({
    saveName: 'Landing E2E Test',
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: ['cmd-mk1', 'parachute-mk2', 'decoupler-stack-tr18', 'tank-small', 'engine-spark'],
  });
}

/** Build the 5-part rocket programmatically and start flight. */
async function buildAndLaunch(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await seedAndLoadSave(page, makeEnvelope());
  await startTestFlight(page,
    ['parachute-mk2', 'cmd-mk1', 'decoupler-stack-tr18', 'tank-small', 'engine-spark'],
    { staging: [
      { partIds: ['engine-spark'] },
      { partIds: ['decoupler-stack-tr18', 'parachute-mk2'] },
    ]}
  );
}

async function waitForWarpUnlocked(page) {
  await page.waitForFunction(
    () => !document.querySelector('.hud-warp-btn')?.disabled,
    { timeout: 10_000 },
  );
}

/** Fire Stage 1 and wait for liftoff. */
async function fireStage1(page) {
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window.__flightPs?.posY ?? 0) > 0,
    { timeout: 3_000 },
  );
}

/** Wait for warp lockout, then fire Stage 2 (decoupler + parachute). */
async function fireStage2(page) {
  await waitForWarpUnlocked(page);
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window.__flightPs?.debris?.length ?? 0) > 0,
    { timeout: 5_000 },
  );
}

/** Time warp and wait for landing. */
async function waitForLanding(page) {
  await waitForWarpUnlocked(page);
  await page.click('[data-warp="50"]');
  await page.waitForFunction(
    () => window.__flightPs?.landed === true || window.__flightPs?.crashed === true,
    { timeout: 30_000 },
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Landing', () => {

  test('(1) launching from the VAB loads the flight scene', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await expect(page.locator('#flight-hud')).toBeVisible();
    await expect(page.locator('#vab-btn-launch')).not.toBeVisible();
  });

  test('(2) pressing Space fires Stage 1 and the rocket lifts off', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);

    expect(await page.evaluate(() => window.__flightPs?.grounded ?? true)).toBe(true);
    await fireStage1(page);
    expect(await page.evaluate(() => window.__flightPs?.posY ?? 0)).toBeGreaterThan(0);
  });

  test('(3) pressing Space again separates the lower stage and deploys the parachute', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);

    // Parachute should be deploying or deployed.
    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      if (!ps?.parachuteStates) return false;
      for (const [, entry] of ps.parachuteStates) {
        if (entry.state === 'deploying' || entry.state === 'deployed') return true;
      }
      return false;
    }, { timeout: 5_000 });

    const chuteState = await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps?.parachuteStates) return 'none';
      for (const [, entry] of ps.parachuteStates) return entry.state;
      return 'none';
    });
    expect(['deploying', 'deployed']).toContain(chuteState);

    const activeParts = await page.evaluate(
      () => window.__flightPs?.activeParts?.size ?? -1,
    );
    expect(activeParts).toBeLessThanOrEqual(3);
  });

  test('(4) parachute slows the command module to a safe landing speed', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    const { landed, crashed } = await page.evaluate(() => ({
      landed:  window.__flightPs?.landed  ?? false,
      crashed: window.__flightPs?.crashed ?? false,
    }));

    expect(landed).toBe(true);
    expect(crashed).toBe(false);
  });

  test('(5) a LANDING event is recorded with impact speed well below safe threshold', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    const events = await page.evaluate(
      () => window.__gameState?.currentFlight?.events ?? [],
    );

    const landingEvent = events.find((e) => e.type === 'LANDING');
    expect(landingEvent).toBeTruthy();
    expect(landingEvent.partsDestroyed).toBe(false);
    expect(landingEvent.speed).toBeLessThan(7);
  });

  test('(6) clicking "Return to Space Agency" shows the post-flight summary', async ({ page }) => {
    test.setTimeout(120_000);
    await buildAndLaunch(page);
    await fireStage1(page);
    await fireStage2(page);
    await waitForLanding(page);

    const summaryAlreadyVisible = await page.locator('#post-flight-summary').isVisible();
    if (!summaryAlreadyVisible) {
      await page.click('#topbar-menu-btn', { force: true });
      const dropdown = page.locator('#topbar-dropdown');
      await expect(dropdown).toBeVisible();
      await dropdown.getByText('Return to Space Agency').click();
    }

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#post-flight-return-btn')).toBeVisible();
    await expect(page.locator('#flight-hud')).not.toBeVisible();
  });
});

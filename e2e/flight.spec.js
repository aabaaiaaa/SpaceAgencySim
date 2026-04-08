import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H, STARTING_MONEY,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
  startTestFlight,
} from './helpers.js';

/**
 * E2E — Flight Launch & Basic Flight
 *
 * Tests the full flight scene: launching a rocket from the VAB, verifying the
 * flight HUD, staging mechanics, throttle control, mission objectives display,
 * the in-flight menu, and the post-flight summary screen.
 *
 * Each test is independent and seeds its own state.
 */

// ---------------------------------------------------------------------------
// Drop positions (cmd-mk1 + tank-medium + engine-spark)
// ---------------------------------------------------------------------------

const CMD_DROP_Y    = CANVAS_CENTRE_Y;          // 386
const TANK_M_DROP_Y = CMD_DROP_Y   + 20 + 30;   // 436
const ENGINE_DROP_Y = TANK_M_DROP_Y + 30 + 15;   // 481

// Part costs (from src/data/parts.js)
const CMD_COST         = 8_000;
const TANK_MEDIUM_COST = 1_600;
const ENGINE_COST      = 6_000;

const UNLOCKED_PARTS = ['cmd-mk1', 'tank-medium', 'engine-spark'];
const FLIGHT_PARTS = ['cmd-mk1', 'tank-medium', 'engine-spark'];

// ---------------------------------------------------------------------------
// Helpers — seed a flight-ready state
// ---------------------------------------------------------------------------

function makeEnvelope(overrides = {}) {
  return buildSaveEnvelope({
    saveName: 'Flight E2E Test',
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
    ...overrides,
  });
}

/** Seed a save and start a flight programmatically (bypasses VAB). */
async function seedAndFly(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await seedAndLoadSave(page, makeEnvelope());
  await startTestFlight(page, FLIGHT_PARTS);
}

/** Seed a save, navigate to VAB, build the 3-part rocket, and launch. */
async function seedBuildAndLaunch(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await seedAndLoadSave(page, makeEnvelope());
  await navigateToVab(page);

  await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
  await placePart(page, 'tank-medium', CENTRE_X, TANK_M_DROP_Y, 2);
  await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);

  await page.click('#vab-btn-staging');
  await expect(page.locator('#vab-staging-panel')).toBeVisible();
  await expect(
    page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
  ).toBeVisible({ timeout: 5_000 });

  await launchFromVab(page);
}

/** Stage the rocket (press Space) and wait for liftoff. */
async function stageAndLiftoff(page) {
  await page.keyboard.press('Space');
  await page.waitForFunction(
    () => (window.__flightPs?.posY ?? 0) > 0,
    { timeout: 3_000 },
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Launch & Basic Flight', () => {

  // ── (1) Clicking Launch from the VAB loads the flight scene ──────────────

  test('@smoke (1) clicking Launch from the VAB loads the flight scene', async ({ page }) => {
    await seedBuildAndLaunch(page);

    await expect(page.locator('#flight-hud')).toBeVisible();
    await expect(page.locator('#vab-btn-launch')).not.toBeVisible();
  });

  // ── (2) HUD visible with altitude, vertical speed, and throttle ──────────

  test('(2) the flight HUD is visible with altitude, vertical speed, and throttle elements', async ({ page }) => {
    await seedAndFly(page);

    await expect(page.locator('#flight-hud')).toBeVisible();
    await expect(page.locator('#flight-left-panel')).toBeVisible();
    await expect(page.locator('#flight-hud-throttle-pct')).toBeVisible();
    await expect(page.locator('#hud-alt')).toBeVisible();
    await expect(page.locator('#hud-vely')).toBeVisible();
  });

  // ── (3) Before any input, rocket sits on the pad with altitude near 0 m ──

  test('(3) at launch (before staging), altitude is near 0 m', async ({ page }) => {
    await seedAndFly(page);

    const posY = await page.evaluate(() => window.__flightPs?.posY ?? -1);
    expect(posY).toBeGreaterThanOrEqual(0);
    expect(posY).toBeLessThan(5);

    const altText = await page.locator('#hud-alt').textContent();
    expect(altText).toBeTruthy();
    const altNum = parseFloat((altText ?? '').replace(/[^0-9.-]/g, ''));
    expect(altNum).toBeLessThan(5);
  });

  // ── (4) Pressing spacebar fires Stage 1 — altitude increases ─────────────

  test('@smoke (4) pressing spacebar activates Stage 1 — altitude begins increasing', async ({ page }) => {
    await seedAndFly(page);

    const groundedBefore = await page.evaluate(() => window.__flightPs?.grounded ?? true);
    expect(groundedBefore).toBe(true);

    await stageAndLiftoff(page);

    const altAfter = await page.evaluate(() => window.__flightPs?.posY ?? 0);
    expect(altAfter).toBeGreaterThan(0);
  });

  // ── (5) Throttle display reflects W / S key changes ──────────────────────

  test('(5) throttle display reflects keyboard throttle changes (W increases, S decreases)', async ({ page }) => {
    await seedAndFly(page);
    await stageAndLiftoff(page);

    await page.evaluate(async () => {
      if (window.__flightPs) {
        window.__flightPs.throttleMode = 'absolute';
        if (typeof window.__resyncPhysicsWorker === 'function') {
          await window.__resyncPhysicsWorker();
        }
      }
    });

    const initialThrottle = await page.evaluate(
      () => window.__flightPs?.throttle ?? 1,
    );
    const initialPct = Math.round(initialThrottle * 100);

    await page.keyboard.press('s');
    const decreasedPct = Math.max(0, initialPct - 5);

    await expect(page.locator('#flight-hud-throttle-pct')).toContainText(
      `${decreasedPct}%`,
      { timeout: 2_000 },
    );

    await page.keyboard.press('w');
    await expect(page.locator('#flight-hud-throttle-pct')).toContainText(
      `${initialPct}%`,
      { timeout: 2_000 },
    );
  });

  // ── (6) Mission objectives panel shows "First Flight" objective ───────────

  test('(6) mission objectives panel is visible and shows the First Flight objective', async ({ page }) => {
    await seedAndFly(page);

    const objPanel = page.locator('#flight-hud-objectives');
    await expect(objPanel).toBeVisible();
    await expect(objPanel).toContainText('Reach 100 m altitude', { timeout: 2_000 });
  });

  // ── (7) In-flight menu shows Save Game, Load Game, Return to Space Agency ─

  test('(7) in-flight menu button opens menu with Save Game, Load Game, and Return to Space Agency', async ({ page }) => {
    await seedAndFly(page);

    await page.click('#topbar-menu-btn');

    const dropdown = page.locator('#topbar-dropdown');
    await expect(dropdown).toBeVisible();
    await expect(dropdown).toContainText('Save Game');
    await expect(dropdown).toContainText('Load Game');
    await expect(dropdown).toContainText('Return to Space Agency');

    await page.click('#topbar-menu-btn');
  });

  // ── (8) TWR=1 button and ±0.1 throttle step buttons ─────────────────────

  test('(8) TWR=1 button sets throttle for unit thrust-to-weight ratio; ±0.1 buttons step throttle', async ({ page }) => {
    await seedAndFly(page);
    await stageAndLiftoff(page);

    await page.evaluate(async () => {
      if (window.__flightPs) {
        window.__flightPs.throttleMode = 'absolute';
        window.__flightPs.throttle = 1.0;
        if (typeof window.__resyncPhysicsWorker === 'function') {
          await window.__resyncPhysicsWorker();
        }
      }
    });
    await expect(page.locator('#flight-hud-throttle-pct')).toContainText('100%', { timeout: 2_000 });

    const twr1Btn = page.locator('.flight-lp-btn', { hasText: 'TWR=1' }).first();
    await expect(twr1Btn).toBeVisible({ timeout: 2_000 });
    await twr1Btn.click({ force: true });

    const throttleAfterTWR1 = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    expect(throttleAfterTWR1).toBeGreaterThan(0);
    expect(throttleAfterTWR1).toBeLessThan(1);

    const expectedPct = Math.round(throttleAfterTWR1 * 100);
    await expect(page.locator('#flight-hud-throttle-pct')).toContainText(
      `${expectedPct}%`,
      { timeout: 2_000 },
    );

    // +0.1 button
    const plusBtn = page.locator('.flight-lp-btn', { hasText: '+0.1' }).first();
    await expect(plusBtn).toBeVisible({ timeout: 2_000 });
    await plusBtn.click({ force: true });

    const throttleAfterPlus = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    const expectedAfterPlus = Math.min(1, Math.round((throttleAfterTWR1 + 0.1) * 10) / 10);
    expect(throttleAfterPlus).toBeCloseTo(expectedAfterPlus, 1);

    // −0.1 button (Unicode minus sign U+2212)
    const minusBtn = page.locator('.flight-lp-btn', { hasText: '−0.1' }).first();
    await expect(minusBtn).toBeVisible({ timeout: 2_000 });
    await minusBtn.click({ force: true });

    const throttleAfterMinus = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    const expectedAfterMinus = Math.round((expectedAfterPlus - 0.1) * 10) / 10;
    expect(throttleAfterMinus).toBeCloseTo(expectedAfterMinus, 1);
  });

  // ── (9) "Restart from Launch" restarts the flight with fresh state ────────

  test('(9) clicking "Restart from Launch" resets the flight to the launch pad', async ({ page }) => {
    await seedAndFly(page);
    await stageAndLiftoff(page);

    // Wait for some altitude
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 10,
      { timeout: 5_000 },
    );

    const altBefore = await page.evaluate(() => window.__flightPs?.posY ?? 0);
    expect(altBefore).toBeGreaterThan(0);

    // Open the topbar dropdown and click "Restart from Launch".
    const dropdown = page.locator('#topbar-dropdown');
    if (!(await dropdown.isVisible())) {
      await page.click('#topbar-menu-btn');
      await expect(dropdown).toBeVisible({ timeout: 2_000 });
    }
    await dropdown.getByText('Restart from Launch').click();

    // Confirm the restart in the confirmation modal.
    const restartBackdrop = page.locator('#restart-flight-backdrop');
    await expect(restartBackdrop).toBeVisible({ timeout: 2_000 });
    await restartBackdrop.getByRole('button', { name: 'Restart' }).click();

    await expect(page.locator('#flight-hud')).toBeVisible({ timeout: 10_000 });

    await page.waitForFunction(
      () => window.__flightPs !== null && window.__flightPs !== undefined,
      { timeout: 10_000 },
    );

    const altAfter = await page.evaluate(() => window.__flightPs?.posY ?? -1);
    expect(altAfter).toBeGreaterThanOrEqual(0);
    expect(altAfter).toBeLessThan(5);

    const grounded = await page.evaluate(() => window.__flightPs?.grounded ?? false);
    expect(grounded).toBe(true);
  });

  // ── (10) "Adjust Build" navigates to the VAB with the design loaded ─────

  test('(10) clicking "Adjust Build" returns to the VAB with parts loaded', async ({ page }) => {
    await seedBuildAndLaunch(page);

    await expect(page.locator('#flight-hud')).toBeVisible();

    const dropdown = page.locator('#topbar-dropdown');
    if (!(await dropdown.isVisible())) {
      await page.click('#topbar-menu-btn');
      await expect(dropdown).toBeVisible({ timeout: 2_000 });
    }
    await dropdown.getByText('Adjust Build').click();

    await expect(page.locator('#flight-hud')).not.toBeVisible({ timeout: 5_000 });

    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 10_000 },
    );

    const partCount = await page.evaluate(() => window.__vabAssembly?.parts?.size ?? 0);
    expect(partCount).toBe(3);
  });

  // ── (11) "Return to Space Agency" ends flight and returns to hub ─────────

  test('(11) clicking "Return to Space Agency" from the menu returns to hub', async ({ page }) => {
    await seedBuildAndLaunch(page);

    const dropdown = page.locator('#topbar-dropdown');
    if (!(await dropdown.isVisible())) {
      await page.click('#topbar-menu-btn');
      await expect(dropdown).toBeVisible({ timeout: 2_000 });
    }
    await dropdown.getByText('Return to Space Agency').click();

    const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
    const didAbort = await abortBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    if (didAbort) {
      await abortBtn.click();
    } else {
      await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 5_000 });
      await page.click('#post-flight-return-btn');
    }

    try {
      const dismissBtn = page.locator('#return-results-dismiss-btn');
      await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await dismissBtn.click();
    } catch {
      // No return results overlay — proceed.
    }

    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });
  });
});

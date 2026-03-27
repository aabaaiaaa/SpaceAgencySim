import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H, STARTING_MONEY,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — Flight Launch & Basic Flight
 *
 * Tests the full flight scene: launching a rocket from the VAB, verifying the
 * flight HUD, staging mechanics, throttle control, mission objectives display,
 * the in-flight menu, and the post-flight summary screen.
 *
 * Setup (beforeAll):
 *   1. Seed localStorage with a game save that has "First Flight" accepted.
 *   2. Load the save, navigate to the VAB.
 *   3. Build a rocket: Mk1 Command Module + Medium Tank + Spark Engine.
 *   4. Move the Spark Engine into Stage 1 via the staging panel.
 *   5. Click Launch → confirm crew dialog → flight scene loads.
 *
 * Tests run in serial order and share a single page/flight-scene instance.
 */

test.describe.configure({ mode: 'serial' });

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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Launch & Basic Flight', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Suite setup ───────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Flight E2E Test',
      missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
      parts: UNLOCKED_PARTS,
    });

    await seedAndLoadSave(page, envelope);
    await navigateToVab(page);

    // ── Build the rocket: Mk1 Command Module + Medium Tank + Spark Engine ──
    await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
    await placePart(page, 'tank-medium', CENTRE_X, TANK_M_DROP_Y, 2);
    await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);

    // ── Verify engine is auto-staged into Stage 1 ─────────────────────────
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // ── Launch ──────────────────────────────────────────────────────────────
    await launchFromVab(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Clicking Launch from the VAB loads the flight scene ──────────────

  test('(1) clicking Launch from the VAB loads the flight scene', async () => {
    // The flight HUD should already be visible (set up in beforeAll).
    await expect(page.locator('#flight-hud')).toBeVisible();

    // The VAB toolbar should no longer be visible (hidden at launch).
    await expect(page.locator('#vab-btn-launch')).not.toBeVisible();
  });

  // ── (2) HUD visible with altitude, vertical speed, and throttle ──────────

  test('(2) the flight HUD is visible with altitude, vertical speed, and throttle elements', async () => {
    // Root HUD overlay.
    await expect(page.locator('#flight-hud')).toBeVisible();

    // Unified left panel (replaces separate throttle + telemetry panels).
    await expect(page.locator('#flight-left-panel')).toBeVisible();
    await expect(page.locator('#flight-hud-throttle-pct')).toBeVisible();

    // Altitude and vertical speed are in the status section of the left panel.
    await expect(page.locator('#hud-alt')).toBeVisible();
    await expect(page.locator('#hud-vely')).toBeVisible();
  });

  // ── (3) Before any input, rocket sits on the pad with altitude near 0 m ──

  test('(3) at launch (before staging), altitude is near 0 m', async () => {
    // Physics posY starts at 0 and stays 0 while grounded with no thrust.
    const posY = await page.evaluate(() => window.__flightPs?.posY ?? -1);
    expect(posY).toBeGreaterThanOrEqual(0);
    expect(posY).toBeLessThan(5);  // less than 5 m — still on the pad

    // HUD altitude display should show something containing '0'.
    const altText = await page.locator('#hud-alt').textContent();
    // Altitude is formatted as "N m" where N is near 0 at this point.
    expect(altText).toBeTruthy();
    const altNum = parseFloat((altText ?? '').replace(/[^0-9.-]/g, ''));
    expect(altNum).toBeLessThan(5);
  });

  // ── (4) Pressing spacebar fires Stage 1 — altitude increases ─────────────

  test('(4) pressing spacebar activates Stage 1 — altitude begins increasing', async () => {
    // Confirm rocket is still grounded before staging.
    const groundedBefore = await page.evaluate(() => window.__flightPs?.grounded ?? true);
    expect(groundedBefore).toBe(true);

    // Press spacebar to fire Stage 1 (ignites the Spark Engine).
    await page.keyboard.press('Space');

    // Within 3 seconds the rocket should have lifted off (posY > 0).
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 0,
      { timeout: 3_000 },
    );

    const altAfter = await page.evaluate(() => window.__flightPs?.posY ?? 0);
    expect(altAfter).toBeGreaterThan(0);
  });

  // ── (5) Throttle display reflects W / S key changes ──────────────────────

  test('(5) throttle display reflects keyboard throttle changes (W increases, S decreases)', async () => {
    // Switch to absolute throttle mode so W/S directly change the throttle %.
    await page.evaluate(() => {
      if (window.__flightPs) window.__flightPs.throttleMode = 'absolute';
    });

    // Read current throttle from physics state (should be 1.0 = 100 %).
    const initialThrottle = await page.evaluate(
      () => window.__flightPs?.throttle ?? 1,
    );
    const initialPct = Math.round(initialThrottle * 100);

    // Press S to decrease throttle by 5 %.
    await page.keyboard.press('s');
    const decreasedPct = Math.max(0, initialPct - 5);

    // Wait for the HUD to reflect the new throttle.
    await expect(page.locator('#flight-hud-throttle-pct')).toContainText(
      `${decreasedPct}%`,
      { timeout: 2_000 },
    );

    // Press W to restore throttle.
    await page.keyboard.press('w');
    await expect(page.locator('#flight-hud-throttle-pct')).toContainText(
      `${initialPct}%`,
      { timeout: 2_000 },
    );
  });

  // ── (6) Mission objectives panel shows "First Flight" objective ───────────

  test('(6) mission objectives panel is visible and shows the First Flight objective', async () => {
    const objPanel = page.locator('#flight-hud-objectives');
    await expect(objPanel).toBeVisible();

    // The objectives panel should display the "Reach 100 m altitude" objective
    // because the seeded game state has First Flight in state.missions.accepted.
    await expect(objPanel).toContainText('Reach 100 m altitude', { timeout: 2_000 });
  });

  // ── (7) In-flight menu shows Save Game, Load Game, Return to Space Agency ─

  test('(7) in-flight menu button opens menu with Save Game, Load Game, and Return to Space Agency', async () => {
    // The flight menu is now consolidated into the top-bar hamburger dropdown.
    await page.click('#topbar-menu-btn');

    const dropdown = page.locator('#topbar-dropdown');
    await expect(dropdown).toBeVisible();

    // Standard items.
    await expect(dropdown).toContainText('Save Game');
    await expect(dropdown).toContainText('Load Game');

    // Flight-specific item injected while in flight.
    await expect(dropdown).toContainText('Return to Space Agency');

    // Close the dropdown by clicking the menu button again (toggle).
    await page.click('#topbar-menu-btn');
  });

  // ── (8) TWR=1 button and ±0.1 throttle step buttons ─────────────────────

  test('(8) TWR=1 button sets throttle for unit thrust-to-weight ratio; ±0.1 buttons step throttle', async () => {
    // Switch to absolute mode so buttons control throttle directly.
    await page.evaluate(() => {
      if (window.__flightPs) {
        window.__flightPs.throttleMode = 'absolute';
        window.__flightPs.throttle = 1.0;
      }
    });
    await expect(page.locator('#flight-hud-throttle-pct')).toContainText('100%', { timeout: 2_000 });

    // The TWR=1 button is in the left panel's throttle section.
    // Use { force: true } to click even if momentarily obscured by a dropdown, etc.
    const twr1Btn = page.locator('.flight-lp-btn', { hasText: 'TWR=1' }).first();
    await expect(twr1Btn).toBeVisible({ timeout: 2_000 });
    await twr1Btn.click({ force: true });

    // _setThrottleForTWR1 runs synchronously on click; read the result immediately.
    // Expected: throttle = weight / maxThrust ≈ 2161 kg × 9.81 / 60000 N ≈ 0.35.
    const throttleAfterTWR1 = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    expect(throttleAfterTWR1).toBeGreaterThan(0);
    expect(throttleAfterTWR1).toBeLessThan(1);

    // HUD should reflect the new throttle value on the next animation frame.
    const expectedPct = Math.round(throttleAfterTWR1 * 100);
    await expect(page.locator('#flight-hud-throttle-pct')).toContainText(
      `${expectedPct}%`,
      { timeout: 2_000 },
    );

    // ── +0.1 button ────────────────────────────────────────────────────────
    const plusBtn = page.locator('.flight-lp-btn', { hasText: '+0.1' }).first();
    await expect(plusBtn).toBeVisible({ timeout: 2_000 });
    await plusBtn.click({ force: true });

    const throttleAfterPlus = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    const expectedAfterPlus = Math.min(1, Math.round((throttleAfterTWR1 + 0.1) * 10) / 10);
    expect(throttleAfterPlus).toBeCloseTo(expectedAfterPlus, 1);

    // ── −0.1 button (uses Unicode minus sign U+2212) ───────────────────────
    const minusBtn = page.locator('.flight-lp-btn', { hasText: '−0.1' }).first();
    await expect(minusBtn).toBeVisible({ timeout: 2_000 });
    await minusBtn.click({ force: true });

    const throttleAfterMinus = await page.evaluate(() => window.__flightPs?.throttle ?? -1);
    const expectedAfterMinus = Math.round((expectedAfterPlus - 0.1) * 10) / 10;
    expect(throttleAfterMinus).toBeCloseTo(expectedAfterMinus, 1);
  });

  // ── (9) "Restart from Launch" restarts the flight with fresh state ────────

  test('(9) clicking "Restart from Launch" resets the flight to the launch pad', async () => {
    // The rocket is currently in flight (staged + throttle applied).
    // Record pre-restart altitude to prove the state resets.
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
    await restartBackdrop.getByText('Restart').click();

    // Flight HUD should still be visible (we're in a new flight, not the hub).
    await expect(page.locator('#flight-hud')).toBeVisible({ timeout: 10_000 });

    // Wait for the new physics state to be exposed.
    await page.waitForFunction(
      () => window.__flightPs !== null && window.__flightPs !== undefined,
      { timeout: 10_000 },
    );

    // Altitude should be back near 0 — the rocket is on the pad again.
    const altAfter = await page.evaluate(() => window.__flightPs?.posY ?? -1);
    expect(altAfter).toBeGreaterThanOrEqual(0);
    expect(altAfter).toBeLessThan(5);

    // The rocket should be grounded.
    const grounded = await page.evaluate(() => window.__flightPs?.grounded ?? false);
    expect(grounded).toBe(true);
  });

  // ── (10) "Adjust Build" navigates to the VAB with the design loaded ─────

  test('(10) clicking "Adjust Build" returns to the VAB with parts loaded', async () => {
    // We're on the launch pad from the restart in test (9).
    await expect(page.locator('#flight-hud')).toBeVisible();

    // Open the topbar dropdown and click "Adjust Build".
    const dropdown = page.locator('#topbar-dropdown');
    if (!(await dropdown.isVisible())) {
      await page.click('#topbar-menu-btn');
      await expect(dropdown).toBeVisible({ timeout: 2_000 });
    }
    await dropdown.getByText('Adjust Build').click();

    // Flight HUD should be gone.
    await expect(page.locator('#flight-hud')).not.toBeVisible({ timeout: 5_000 });

    // VAB should be visible with the rocket design loaded.
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 10_000 },
    );

    // The assembly should have all 3 parts from the original rocket.
    const partCount = await page.evaluate(() => window.__vabAssembly?.parts?.size ?? 0);
    expect(partCount).toBe(3);
  });

  // ── (11) "Return to Space Agency" ends flight and returns to hub ─────────

  test('(11) clicking "Return to Space Agency" from the menu returns to hub', async () => {
    // We're in the VAB from test (10). Ensure the launch button is ready
    // before attempting to launch (occasionally the VAB hasn't fully rendered
    // by the time this test begins).
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await launchFromVab(page);

    // Open the topbar dropdown and click "Return to Space Agency".
    const dropdown = page.locator('#topbar-dropdown');
    if (!(await dropdown.isVisible())) {
      await page.click('#topbar-menu-btn');
      await expect(dropdown).toBeVisible({ timeout: 2_000 });
    }
    await dropdown.getByText('Return to Space Agency').click();

    // If the rocket is still in flight, an abort confirmation dialog appears first.
    // Aborting skips the post-flight summary and goes straight to hub.
    const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
    const didAbort = await abortBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    if (didAbort) {
      await abortBtn.click();
    } else {
      // Landed/crashed — post-flight summary appears; click through it.
      await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 5_000 });
      await page.click('#post-flight-return-btn');
    }

    // Return results overlay may appear — dismiss it.
    try {
      const dismissBtn = page.locator('#return-results-dismiss-btn');
      await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
      await dismissBtn.click();
    } catch {
      // No return results overlay — proceed.
    }

    // Hub overlay should be visible — we're back at the Space Agency.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });
  });
});

import { test, expect } from '@playwright/test';

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
 *
 * Test list:
 *   (1) Clicking Launch from the VAB loads the flight scene.
 *   (2) The flight HUD is visible with altitude, vertical speed, and throttle.
 *   (3) At launch (before any input), altitude reads near 0 m.
 *   (4) Pressing spacebar fires Stage 1 — altitude increases within 2 s.
 *   (5) Throttle display updates when W / S keys are pressed.
 *   (6) Mission objectives panel is visible and shows the First Flight objective.
 *   (7) The in-flight menu (hamburger button) lists Save Game, Load Game, and
 *       Return to Space Agency.
 *   (8) Clicking "Return to Space Agency" shows the post-flight summary screen.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VP_W = 1280;
const VP_H = 720;

// VAB layout constants (must match src/render/vab.js / src/ui/vab.js).
const TOOLBAR_H     = 52;
const SCALE_BAR_W   = 50;
const PARTS_PANEL_W = 280;

const BUILD_X = SCALE_BAR_W;                          // 50
const BUILD_W = VP_W - PARTS_PANEL_W - SCALE_BAR_W;   // 950
const BUILD_H = VP_H - TOOLBAR_H;                     // 668

// Default camera: camX = BUILD_W/2 = 475, camY = BUILD_H * 0.85 ≈ 567.8
// Screen X of rocket centreline (world X = 0):
const CENTRE_X = BUILD_X + BUILD_W / 2;  // 525

// Canvas vertical centre (screen Y for cmd-mk1 drop):
const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;  // 386

// ── Drop positions (cmd-mk1 + tank-medium + engine-spark) ────────────────
//
// Part snap geometry:
//   cmd-mk1       : height 40, bottom snap offsetY +20
//   tank-medium   : height 60, top snap offsetY -30, bottom snap offsetY +30
//   engine-spark  : height 30, top snap offsetY -15
//
// cmd-mk1   centre → 386          bottom snap → 386 + 20 = 406
// tank-med  top snap matches   → centre = 406 + 30 = 436
//           bottom snap        → 436 + 30 = 466
// engine    top snap matches   → centre = 466 + 15 = 481

const CMD_DROP_Y    = CANVAS_CENTRE_Y;          // 386
const TANK_M_DROP_Y = CMD_DROP_Y   + 20 + 30;   // 436
const ENGINE_DROP_Y = TANK_M_DROP_Y + 30 + 15;   // 481

// ── Part costs (from src/data/parts.js) ──────────────────────────────────
const CMD_COST         = 8_000;
const TANK_MEDIUM_COST = 1_600;
const ENGINE_COST      = 6_000;
const STARTING_MONEY   = 2_000_000;

// ── Save / seed config ───────────────────────────────────────────────────
const SAVE_KEY   = 'spaceAgencySave_0';
const AGENCY_NAME = 'Test Agency';

/**
 * "First Flight" mission template mirrored from src/data/missions.js.
 * status is set to 'accepted' so the seeded save skips Mission Control.
 */
const ACCEPTED_FIRST_FLIGHT = {
  id:           'mission-001',
  title:        'First Flight',
  description:
    'Our engineers have assembled a basic sounding rocket. Your task is simple: ' +
    'get it off the pad and reach 100 metres altitude. This is the first step ' +
    'in what will become a legendary space programme.',
  location:     'desert',
  objectives: [
    {
      id:          'obj-001-1',
      type:        'REACH_ALTITUDE',
      target:      { altitude: 100 },
      completed:   false,
      description: 'Reach 100 m altitude',
    },
  ],
  reward:        15_000,
  unlocksAfter:  [],
  unlockedParts: [],
  status:        'accepted',
};

// ── Unlocked parts ───────────────────────────────────────────────────────────
// The save must have the three parts we need in the VAB parts panel.
const UNLOCKED_PARTS = ['cmd-mk1', 'tank-medium', 'engine-spark'];

/** Build a save-slot envelope to inject into localStorage. */
function buildSaveEnvelope(missionsState) {
  return {
    saveName:  'Flight E2E Test',
    timestamp: new Date().toISOString(),
    state: {
      agencyName:     AGENCY_NAME,
      money:          STARTING_MONEY,
      loan:           { balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 },
      missions:       missionsState,
      crew:           [],
      rockets:        [],
      parts:          UNLOCKED_PARTS,
      flightHistory:  [],
      playTimeSeconds: 0,
      currentFlight:  null,
    },
  };
}

/** Save envelope used for all tests: First Flight already accepted. */
const FLIGHT_ENVELOPE = buildSaveEnvelope({
  available: [],
  accepted:  [ACCEPTED_FIRST_FLIGHT],
  completed: [],
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Launch & Basic Flight', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Drag helper ───────────────────────────────────────────────────────────

  /**
   * Drag a part card from the parts panel and drop it at (targetX, targetY).
   *
   * @param {string} partId   data-part-id of the part card to drag.
   * @param {number} targetX  Drop screen X.
   * @param {number} targetY  Drop screen Y.
   */
  async function dragPartToCanvas(partId, targetX, targetY) {
    const card    = page.locator(`.vab-part-card[data-part-id="${partId}"]`);
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error(`Part card not visible: ${partId}`);

    const startX = cardBox.x + cardBox.width  / 2;
    const startY = cardBox.y + cardBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 30 });
    await page.mouse.up();
  }

  // ── Suite setup ───────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    // Seed localStorage with the pre-built save (First Flight accepted).
    await page.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: FLIGHT_ENVELOPE });

    // Navigate to app root — the init script has already written the save.
    await page.goto('/');

    // The seeded save appears in the load screen.
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // Load slot 0.
    await page.click('[data-action="load"][data-slot="0"]');

    // Hub overlay confirms the game has loaded.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Navigate to the Vehicle Assembly Building.
    await page.click('[data-building-id="vab"]');

    // Wait for the VAB to fully initialise.
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 15_000 },
    );

    // ── Build the rocket: Mk1 Command Module + Medium Tank + Spark Engine ──

    // Place the command module at the canvas centre.
    await dragPartToCanvas('cmd-mk1', CENTRE_X, CMD_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 5_000 },
    );

    // Place the medium tank below the command module.
    await dragPartToCanvas('tank-medium', CENTRE_X, TANK_M_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 2,
      { timeout: 5_000 },
    );

    // Place the Spark Engine below the medium tank.
    await dragPartToCanvas('engine-spark', CENTRE_X, ENGINE_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 3,
      { timeout: 5_000 },
    );

    // ── Open staging panel and move engine chip into Stage 1 ──────────────

    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();

    // Drag engine chip from Unstaged → Stage 1 (data-drop-zone="stage-0").
    await page.dragAndDrop(
      '[data-drop-zone="unstaged"] .vab-stage-chip:has-text("Spark Engine")',
      '[data-drop-zone="stage-0"]',
    );

    // Confirm the engine is now in Stage 1.
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible();

    // ── Click Launch ──────────────────────────────────────────────────────

    const launchBtn = page.locator('#vab-btn-launch');
    await expect(launchBtn).not.toBeDisabled({ timeout: 5_000 });
    await launchBtn.click();

    // Crew dialog appears (cmd-mk1 has 1 seat; no crew assigned → launches empty).
    await page.waitForSelector('#vab-crew-overlay', { state: 'visible', timeout: 5_000 });
    await page.click('#vab-crew-confirm');

    // ── Wait for flight scene ─────────────────────────────────────────────

    // The flight HUD is mounted by startFlightScene(); wait for it to appear.
    await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });

    // Wait for physics state to be exposed on window.__flightPs.
    await page.waitForFunction(
      () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
      { timeout: 10_000 },
    );
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
    // Ensure throttle is at 100% before testing (direct mutation of physics state).
    await page.evaluate(() => { if (window.__flightPs) window.__flightPs.throttle = 1.0; });
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

  // ── (9) "Return to Space Agency" brings up the post-flight summary ────────

  test('(9) clicking "Return to Space Agency" from the menu shows the post-flight summary', async () => {
    // Open the topbar dropdown (it was closed at the end of test 7).
    const dropdown = page.locator('#topbar-dropdown');
    if (!(await dropdown.isVisible())) {
      await page.click('#topbar-menu-btn');
      await expect(dropdown).toBeVisible({ timeout: 2_000 });
    }

    // Click "Return to Space Agency" in the dropdown.
    await dropdown.getByText('Return to Space Agency').click();

    // Post-flight summary overlay should appear.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 5_000 });

    // The summary should include a "Return to Space Agency" button.
    await expect(page.locator('#post-flight-return-btn')).toBeVisible();

    // The flight HUD should no longer be visible (torn down by stopFlightScene).
    await expect(page.locator('#flight-hud')).not.toBeVisible();
  });
});

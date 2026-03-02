import { test, expect } from '@playwright/test';

/**
 * E2E — Relaunch (Takeoff → Land → Takeoff Again)
 *
 * Tests that a rocket can take off, land safely, and take off again.
 * This verifies the re-liftoff mechanic: after ps.landed = true, firing
 * engines with throttle > 0 transitions the rocket back to ps.grounded,
 * and the existing liftoff detection (posY > 0) releases it into flight.
 *
 * Setup:
 *   1. Seed localStorage with a game save (First Flight accepted).
 *   2. Load save → navigate to VAB.
 *   3. Build a rocket: Mk1 Command Module + Small Tank + Spark Engine.
 *   4. Launch from VAB (engine auto-staged into Stage 1).
 *
 * Test flow:
 *   (1) Fire Stage 1 — rocket lifts off and reaches altitude > 50 m.
 *   (2) Simulate gentle descent — teleport near ground, land at < 5 m/s.
 *   (3) Full throttle after landing — rocket takes off again.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VP_W = 1280;
const VP_H = 720;

// VAB layout constants.
const TOOLBAR_H     = 52;
const SCALE_BAR_W   = 50;
const PARTS_PANEL_W = 280;
const BUILD_W       = VP_W - PARTS_PANEL_W - SCALE_BAR_W;   // 950
const BUILD_H       = VP_H - TOOLBAR_H;                      // 668

const CENTRE_X = SCALE_BAR_W + BUILD_W / 2;                 // 525
const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;            // 386

// Drop positions for cmd-mk1 + tank-small + engine-spark.
const CMD_DROP_Y    = CANVAS_CENTRE_Y;                       // 386
const TANK_DROP_Y   = CMD_DROP_Y   + 20 + 20;               // 426  (cmd bottom snap 20 + tank top snap 20)
const ENGINE_DROP_Y = TANK_DROP_Y  + 20 + 15;               // 461  (tank bottom snap 20 + engine top snap 15)

const SAVE_KEY       = 'spaceAgencySave_0';
const AGENCY_NAME    = 'Relaunch Test Agency';
const STARTING_MONEY = 2_000_000;
const UNLOCKED_PARTS = ['cmd-mk1', 'tank-small', 'engine-spark'];

/** "First Flight" mission — provides a reason for the launch. */
const ACCEPTED_MISSION = {
  id:           'mission-001',
  title:        'First Flight',
  description:  'Reach 100 metres altitude.',
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

/** Build a save-slot envelope. */
function buildSaveEnvelope() {
  return {
    saveName:  'Relaunch E2E Test',
    timestamp: new Date().toISOString(),
    state: {
      agencyName:      AGENCY_NAME,
      money:           STARTING_MONEY,
      loan:            { balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 },
      missions:        { available: [], accepted: [ACCEPTED_MISSION], completed: [] },
      crew:            [],
      rockets:         [],
      parts:           UNLOCKED_PARTS,
      flightHistory:   [],
      playTimeSeconds: 0,
      currentFlight:   null,
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Relaunch — Takeoff, Land, Takeoff Again', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  /**
   * Drag a part card from the parts panel and drop it at (targetX, targetY).
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

  // ── Suite setup — build rocket in VAB and launch ─────────────────────────

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    // Seed localStorage.
    await page.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: buildSaveEnvelope() });

    // Navigate to app root.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // Load the save.
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Navigate to the VAB.
    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 15_000 },
    );

    // ── Build the rocket: Mk1 Command Module + Small Tank + Spark Engine ──

    await dragPartToCanvas('cmd-mk1', CENTRE_X, CMD_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 5_000 },
    );

    await dragPartToCanvas('tank-small', CENTRE_X, TANK_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 2,
      { timeout: 5_000 },
    );

    await dragPartToCanvas('engine-spark', CENTRE_X, ENGINE_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 3,
      { timeout: 5_000 },
    );

    // Verify engine is auto-staged into Stage 1.
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // ── Click Launch ──────────────────────────────────────────────────────

    const launchBtn = page.locator('#vab-btn-launch');
    await expect(launchBtn).not.toBeDisabled({ timeout: 5_000 });
    await launchBtn.click();

    // Crew dialog appears (cmd-mk1 has 1 seat).
    await page.waitForSelector('#vab-crew-overlay', { state: 'visible', timeout: 5_000 });
    await page.click('#vab-crew-confirm');

    // Wait for flight scene.
    await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
      { timeout: 10_000 },
    );
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Rocket lifts off and reaches altitude > 50 m ──────────────────────

  test('(1) rocket lifts off after staging and reaches altitude > 50 m', async () => {
    // Verify rocket is grounded on the pad.
    const grounded = await page.evaluate(() => window.__flightPs?.grounded);
    expect(grounded).toBe(true);

    // Fire Stage 1 (spacebar) to ignite the Spark Engine.
    await page.keyboard.press('Space');

    // Full throttle.
    await page.keyboard.press('z');

    // Wait for the rocket to reach 50 m altitude.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 50,
      { timeout: 10_000 },
    );

    // Verify the rocket is no longer grounded.
    const groundedAfter = await page.evaluate(() => window.__flightPs?.grounded);
    expect(groundedAfter).toBe(false);

    const alt = await page.evaluate(() => window.__flightPs?.posY ?? 0);
    expect(alt).toBeGreaterThan(50);
  });

  // ── (2) Rocket lands safely ───────────────────────────────────────────────

  test('(2) rocket lands safely after a controlled descent', async () => {
    // Cut throttle.
    await page.keyboard.press('x');
    await page.waitForFunction(
      () => (window.__flightPs?.throttle ?? 1) === 0,
      { timeout: 2_000 },
    );

    // Teleport the rocket to just above the surface with a gentle descent
    // rate. From posY=0.1 and velY=-0.5, impact speed ≈ 1.5 m/s (< 5 m/s).
    await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps) return;
      ps.posY = 0.1;
      ps.velY = -0.5;
      ps.velX = 0;
    });

    // Wait for ps.landed = true.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true,
      { timeout: 5_000 },
    );

    // Verify landed state.
    const state = await page.evaluate(() => ({
      landed:  window.__flightPs?.landed,
      posY:    window.__flightPs?.posY,
      velY:    window.__flightPs?.velY,
    }));
    expect(state.landed).toBe(true);
    expect(state.posY).toBe(0);
    expect(state.velY).toBe(0);
  });

  // ── (3) Rocket takes off again after landing ──────────────────────────────

  test('(3) rocket takes off again after landing when engines fire', async () => {
    // Verify we're in a landed state with engines still in firingEngines.
    const preLaunch = await page.evaluate(() => ({
      landed:        window.__flightPs?.landed,
      firingEngines: window.__flightPs?.firingEngines?.size ?? 0,
    }));
    expect(preLaunch.landed).toBe(true);
    expect(preLaunch.firingEngines).toBeGreaterThan(0);

    // Full throttle — triggers re-liftoff transition (landed → grounded → airborne).
    // The transition happens within a single tick(), so we check the final state.
    await page.keyboard.press('z');

    // Wait for the rocket to lift off (posY > 5 m).
    // The landed → grounded → airborne transition is near-instant with high TWR.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 5,
      { timeout: 5_000 },
    );

    // Verify the rocket is flying again — not grounded, not landed.
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

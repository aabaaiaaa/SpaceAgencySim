import { test, expect } from '@playwright/test';

/**
 * E2E — Ground-Contact Rotation & Gravity Tipping
 *
 * Tests that rockets tip from their base contact point when A/D keys are
 * pressed on the ground, that gravity torque continues tipping after key
 * release, and that exceeding the topple angle triggers a crash.
 *
 * Setup:
 *   1. Seed a save with First Flight accepted and the required parts unlocked.
 *   2. Build a rocket in the VAB: Probe Core + Small Tank + Spark Engine.
 *   3. Stage the engine, click Launch, enter flight scene.
 *
 * Tests run in serial order on a shared page instance.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VP_W = 1280;
const VP_H = 720;

const TOOLBAR_H     = 52;
const SCALE_BAR_W   = 50;
const PARTS_PANEL_W = 280;
const BUILD_W = VP_W - PARTS_PANEL_W - SCALE_BAR_W;
const BUILD_H = VP_H - TOOLBAR_H;
const CENTRE_X = SCALE_BAR_W + BUILD_W / 2;
const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;

const CMD_DROP_Y    = CANVAS_CENTRE_Y;
const TANK_DROP_Y   = CMD_DROP_Y + 20 + 20;   // tank-small: half-height 20
const ENGINE_DROP_Y = TANK_DROP_Y + 20 + 15;   // engine-spark: half-height 15

const SAVE_KEY    = 'spaceAgencySave_0';
const AGENCY_NAME = 'Tipping Test';

const ACCEPTED_FIRST_FLIGHT = {
  id:           'mission-001',
  title:        'First Flight',
  description:  'Test tipping mission.',
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

const UNLOCKED_PARTS = ['probe-core-mk1', 'tank-small', 'engine-spark'];

function buildSaveEnvelope() {
  return {
    saveName:  'Tipping E2E Test',
    timestamp: new Date().toISOString(),
    state: {
      agencyName:     AGENCY_NAME,
      money:          2_000_000,
      loan:           { balance: 2_000_000, interestRate: 0.03, totalInterestAccrued: 0 },
      missions:       { available: [], accepted: [ACCEPTED_FIRST_FLIGHT], completed: [] },
      crew:           [],
      rockets:        [],
      parts:          UNLOCKED_PARTS,
      flightHistory:  [],
      playTimeSeconds: 0,
      currentFlight:  null,
    },
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Tipping physics — ground-contact rotation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

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

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope();
    await page.addInitScript(({ key, env }) => {
      localStorage.setItem(key, JSON.stringify(env));
    }, { key: SAVE_KEY, env: envelope });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 15_000 },
    );

    // Build rocket: Probe Core + Small Tank + Spark Engine.
    await dragPartToCanvas('probe-core-mk1', CENTRE_X, CMD_DROP_Y);
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

    // Stage the engine.
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // Launch.
    const launchBtn = page.locator('#vab-btn-launch');
    await expect(launchBtn).not.toBeDisabled({ timeout: 5_000 });
    await launchBtn.click();

    // Handle crew dialog if it appears.
    const crewOverlay = page.locator('#vab-crew-overlay');
    if (await crewOverlay.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.click('#vab-crew-confirm');
    }

    await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
      { timeout: 10_000 },
    );
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Rocket tips clockwise when D is held on the launch pad ──────────

  test('(1) rocket tips clockwise when D is held on the pad', async () => {
    // Verify we start grounded with angle ~0.
    const initAngle = await page.evaluate(() => window.__flightPs.angle);
    expect(initAngle).toBeCloseTo(0, 1);

    // Hold D key for ~1 second.
    await page.keyboard.down('d');
    await page.waitForTimeout(1000);
    await page.keyboard.up('d');

    const angle = await page.evaluate(() => window.__flightPs.angle);
    expect(angle).toBeGreaterThan(0); // Positive = clockwise tilt.
  });

  // ── (2) Tilted rocket continues toppling after key release ──────────────

  test('(2) tilted rocket continues toppling from gravity torque', async () => {
    // The rocket already has some tilt from test (1).
    const angleBefore = await page.evaluate(() => window.__flightPs.angle);

    // Wait without any key input — gravity should increase tilt.
    await page.waitForTimeout(1500);

    const angleAfter = await page.evaluate(() => window.__flightPs.angle);
    // Should have tilted further (or crashed).
    const crashed = await page.evaluate(() => window.__flightPs.crashed);
    if (!crashed) {
      expect(angleAfter).toBeGreaterThan(angleBefore);
    }
  });

  // ── (3) Toppling past threshold triggers crash ──────────────────────────

  test('(3) toppling past threshold triggers crash', async () => {
    // Wait for the gravity torque to tip the rocket past the crash angle.
    await page.waitForFunction(
      () => window.__flightPs.crashed === true,
      { timeout: 15_000 },
    );

    const crashed = await page.evaluate(() => window.__flightPs.crashed);
    expect(crashed).toBe(true);
  });
});

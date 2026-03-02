import { test, expect } from '@playwright/test';

/**
 * E2E — First Flight Mission Completion
 *
 * Tests that the First Flight mission completes when the rocket reaches 100 m
 * altitude and the player returns to the Space Agency.
 *
 * Setup (beforeAll):
 *   1. Seed localStorage with a game save that has "First Flight" accepted.
 *   2. Load the save, navigate to the VAB.
 *   3. Build a rocket: Mk1 Command Module + Medium Tank + Spark Engine.
 *   4. Engine is auto-staged into Stage 1.
 *   5. Click Launch → confirm crew dialog → flight scene loads.
 *
 * Test list:
 *   (1) Engine is auto-staged into Stage 1 (no manual drag needed).
 *   (2) Mission completes when rocket reaches 100 m: objective marked done,
 *       returning to Space Agency awards $15,000 and moves mission to completed.
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

const BUILD_W = VP_W - PARTS_PANEL_W - SCALE_BAR_W;   // 950
const BUILD_H = VP_H - TOOLBAR_H;                     // 668

// Screen X of rocket centreline (world X = 0):
const CENTRE_X = SCALE_BAR_W + BUILD_W / 2;  // 525

// Canvas vertical centre (screen Y for cmd-mk1 drop):
const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;  // 386

// Drop positions for a 3-part stack.
const CMD_DROP_Y    = CANVAS_CENTRE_Y;            // 386
const TANK_M_DROP_Y = CMD_DROP_Y   + 20 + 30;     // 436
const ENGINE_DROP_Y = TANK_M_DROP_Y + 30 + 15;     // 481

// Save / seed config
const SAVE_KEY    = 'spaceAgencySave_0';
const AGENCY_NAME = 'Mission Test Agency';
const STARTING_MONEY = 2_000_000;

/**
 * "First Flight" mission template — status set to 'accepted'.
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

const UNLOCKED_PARTS = ['cmd-mk1', 'tank-medium', 'engine-spark'];

/** Build a save-slot envelope to inject into localStorage. */
function buildSaveEnvelope() {
  return {
    saveName:  'Mission E2E Test',
    timestamp: new Date().toISOString(),
    state: {
      agencyName:      AGENCY_NAME,
      money:           STARTING_MONEY,
      loan:            { balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 },
      missions:        {
        available: [],
        accepted:  [ACCEPTED_FIRST_FLIGHT],
        completed: [],
      },
      crew:            [],
      rockets:         [],
      parts:           UNLOCKED_PARTS,
      flightHistory:   [],
      playTimeSeconds: 0,
      currentFlight:   null,
    },
  };
}

const SAVE_ENVELOPE = buildSaveEnvelope();

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — First Flight Mission Completion', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  /**
   * Drag a part card from the parts panel to a canvas position.
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

  // ── Suite setup ─────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    // Seed localStorage.
    await page.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: SAVE_ENVELOPE });

    // Navigate and load save.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Navigate to VAB.
    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 15_000 },
    );

    // ── Build rocket: Mk1 + Medium Tank + Spark Engine ──────────────────

    await dragPartToCanvas('cmd-mk1', CENTRE_X, CMD_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 5_000 },
    );

    await dragPartToCanvas('tank-medium', CENTRE_X, TANK_M_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 2,
      { timeout: 5_000 },
    );

    await dragPartToCanvas('engine-spark', CENTRE_X, ENGINE_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 3,
      { timeout: 5_000 },
    );
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Engine is auto-staged into Stage 1 ────────────────────────────

  test('(1) engine is auto-staged into Stage 1', async () => {
    // Open the staging panel.
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();

    // The Spark Engine should already be in Stage 1 (auto-staged).
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // Unstaged pool should NOT contain the engine.
    const unstagedEngines = page.locator('[data-drop-zone="unstaged"] .vab-stage-chip:has-text("Spark Engine")');
    await expect(unstagedEngines).toHaveCount(0);
  });

  // ── (2) Mission objective completes at 100 m altitude ─────────────────

  test('(2) First Flight mission completes when rocket reaches 100 m', async () => {
    test.setTimeout(90_000);

    // Launch the rocket.
    const launchBtn = page.locator('#vab-btn-launch');
    await expect(launchBtn).not.toBeDisabled({ timeout: 5_000 });
    await launchBtn.click();

    // Crew dialog (cmd-mk1 has 1 seat; launches empty).
    await page.waitForSelector('#vab-crew-overlay', { state: 'visible', timeout: 5_000 });
    await page.click('#vab-crew-confirm');

    // Wait for flight scene.
    await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
      { timeout: 10_000 },
    );

    // Record money before flight return.
    const moneyBefore = await page.evaluate(() => window.__gameState?.money ?? 0);

    // Fire Stage 1 (Space) and full throttle (Z).
    await page.keyboard.press('Space');
    await page.keyboard.press('z');

    // Wait for altitude to reach 100 m.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) >= 100,
      { timeout: 30_000 },
    );

    // Cut throttle immediately.
    await page.keyboard.press('x');

    // Verify the objective is now marked completed in game state.
    const objectiveCompleted = await page.evaluate(() => {
      const state = window.__gameState;
      if (!state) return false;
      const mission = state.missions.accepted.find(m => m.id === 'mission-001');
      if (!mission) return false;
      return mission.objectives.every(o => o.completed);
    });
    expect(objectiveCompleted).toBe(true);

    // ── Return to Space Agency and verify mission completion ─────────────

    // The rocket will eventually crash back to ground. Wait for the post-flight
    // summary to appear (auto-triggered by crash or landing).
    await page.waitForSelector('#post-flight-summary', { state: 'visible', timeout: 60_000 });

    // The summary should show the mission objective as completed.
    await expect(page.locator('.pf-obj-complete')).toBeVisible({ timeout: 5_000 });

    // Click "Return to Space Agency" button on the summary screen.
    await page.click('#post-flight-return-btn');

    // Hub should be visible again.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Verify the mission moved to the completed bucket.
    const missionCompleted = await page.evaluate(() => {
      const state = window.__gameState;
      if (!state) return false;
      return state.missions.completed.some(m => m.id === 'mission-001');
    });
    expect(missionCompleted).toBe(true);

    // Verify the reward was credited.
    const moneyAfter = await page.evaluate(() => window.__gameState?.money ?? 0);
    expect(moneyAfter).toBeGreaterThan(moneyBefore);
  });
});

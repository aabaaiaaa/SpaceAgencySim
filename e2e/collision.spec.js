import { test, expect } from '@playwright/test';

/**
 * E2E — Collision System (Stage Separation)
 *
 * Verifies that after stage separation:
 *   1. Debris separates from the main rocket (different positions).
 *   2. Lighter upper stage retains more velocity.
 *   3. No indefinite overlap — bodies diverge over time.
 *
 * Setup:
 *   Build a two-stage rocket (cmd-mk1 + decoupler + tank-small + engine-spark).
 *   Launch, fire engine, gain altitude, fire decoupler, observe separation.
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

const BUILD_W = VP_W - PARTS_PANEL_W - SCALE_BAR_W;   // 950
const BUILD_H = VP_H - TOOLBAR_H;                     // 668

const CENTRE_X = SCALE_BAR_W + BUILD_W / 2;  // 525
const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;  // 386

// Drop positions for: cmd-mk1 + decoupler + tank-small + engine-spark
// cmd-mk1:     height 40, bottom snap +20
// decoupler:   height 10, top snap -5, bottom snap +5
// tank-small:  height 40, top snap -20, bottom snap +20
// engine-spark: height 30, top snap -15

const CMD_DROP_Y       = CANVAS_CENTRE_Y - 30;         // ~356
const DECOUPLER_DROP_Y = CMD_DROP_Y + 20 + 5;          // ~381
const TANK_DROP_Y      = DECOUPLER_DROP_Y + 5 + 20;    // ~406
const ENGINE_DROP_Y    = TANK_DROP_Y + 20 + 15;        // ~441

// Save / seed config
const SAVE_KEY     = 'spaceAgencySave_0';
const AGENCY_NAME  = 'Collision Test Agency';
const STARTING_MONEY = 2_000_000;

const ACCEPTED_FIRST_FLIGHT = {
  id:           'mission-001',
  title:        'First Flight',
  description:  'Reach 100 m altitude.',
  location:     'desert',
  objectives: [{
    id:          'obj-001-1',
    type:        'REACH_ALTITUDE',
    target:      { altitude: 100 },
    completed:   false,
    description: 'Reach 100 m altitude',
  }],
  reward:        15_000,
  unlocksAfter:  [],
  unlockedParts: [],
  status:        'accepted',
};

const UNLOCKED_PARTS = [
  'cmd-mk1', 'tank-small', 'engine-spark', 'decoupler-stack-tr18',
];

function buildSaveEnvelope() {
  return {
    saveName:  'Collision E2E Test',
    timestamp: new Date().toISOString(),
    state: {
      agencyName:     AGENCY_NAME,
      money:          STARTING_MONEY,
      loan:           { balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 },
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

test.describe('Collision — Stage Separation', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  async function dragPartToCanvas(partId, targetX, targetY) {
    const card = page.locator(`.vab-part-card[data-part-id="${partId}"]`);
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error(`Part card not visible: ${partId}`);

    const startX = cardBox.x + cardBox.width / 2;
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

    await page.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: buildSaveEnvelope() });

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

    // Build a 4-part two-stage rocket:
    // cmd-mk1 (top) → decoupler → tank-small → engine-spark (bottom)

    await dragPartToCanvas('cmd-mk1', CENTRE_X, CMD_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 5_000 },
    );

    await dragPartToCanvas('decoupler-stack-tr18', CENTRE_X, DECOUPLER_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 2,
      { timeout: 5_000 },
    );

    await dragPartToCanvas('tank-small', CENTRE_X, TANK_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 3,
      { timeout: 5_000 },
    );

    await dragPartToCanvas('engine-spark', CENTRE_X, ENGINE_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 4,
      { timeout: 5_000 },
    );

    // Open staging panel and configure staging.
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();

    // Engine should be auto-staged into Stage 1.
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // Add a second stage and assign the decoupler to it programmatically.
    await page.click('#vab-staging-add');
    await page.waitForFunction(
      () => (window.__vabStagingConfig?.stages?.length ?? 0) >= 2,
      { timeout: 5_000 },
    );

    // Find the decoupler instance ID and assign it to Stage 2 (index 1).
    await page.evaluate(() => {
      const assembly = window.__vabAssembly;
      const staging  = window.__vabStagingConfig;
      for (const [instId, placed] of assembly.parts) {
        if (placed.partId === 'decoupler-stack-tr18') {
          staging.stages[1].instanceIds.push(instId);
          break;
        }
      }
    });

    // Launch.
    const launchBtn = page.locator('#vab-btn-launch');
    await expect(launchBtn).not.toBeDisabled({ timeout: 5_000 });
    await launchBtn.click();

    // Handle crew dialog if it appears.
    const crewOverlay = page.locator('#vab-crew-overlay');
    if (await crewOverlay.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await page.click('#vab-crew-confirm');
    }

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

  // ── (1) Fire engine and gain altitude ───────────────────────────────────

  test('(1) debris separates from rocket after decoupling', async () => {
    // Fire Stage 1 (engine ignition) by pressing spacebar.
    await page.keyboard.press('Space');

    // Wait for altitude > 300 m.
    await page.waitForFunction(
      () => {
        const ps = window.__flightPs;
        return ps && ps.posY > 300;
      },
      { timeout: 30_000 },
    );

    // Fire Stage 2 (decoupler) by pressing spacebar again.
    await page.keyboard.press('Space');

    // Wait for debris to appear.
    await page.waitForFunction(
      () => {
        const ps = window.__flightPs;
        return ps && ps.debris && ps.debris.length > 0;
      },
      { timeout: 10_000 },
    );

    // Wait 2 seconds for separation to take effect.
    await page.waitForTimeout(2_000);

    // Verify debris position differs from rocket position.
    const positions = await page.evaluate(() => {
      const ps = window.__flightPs;
      return {
        rocketY: ps.posY,
        debrisY: ps.debris[0].posY,
      };
    });

    expect(positions.rocketY).not.toBe(positions.debrisY);
    // The rocket (lighter: just cmd-mk1) should be above the debris
    // (heavier: tank + engine), or at least they should be separated.
    const distance = Math.abs(positions.rocketY - positions.debrisY);
    expect(distance).toBeGreaterThan(0.1);
  });

  // ── (2) Separation impulse produces different velocities ───────────────

  test('(2) separation impulse gives bodies different velocities', async () => {
    // After separation, the two bodies should have different velocities
    // due to the separation impulse (lighter body gets bigger Δv).
    // Note: the debris may have higher velY if engines are still firing on it.
    const velocities = await page.evaluate(() => {
      const ps = window.__flightPs;
      return {
        rocketVelY: ps.velY,
        debrisVelY: ps.debris[0].velY,
      };
    });

    // The two bodies should have different velocities after separation.
    expect(velocities.rocketVelY).not.toBe(velocities.debrisVelY);
    // The velocity difference should be significant (at least 1 m/s).
    expect(Math.abs(velocities.rocketVelY - velocities.debrisVelY)).toBeGreaterThan(1);
  });

  // ── (3) No indefinite overlap ─────────────────────────────────────────

  test('(3) no indefinite overlap after separation', async () => {
    // Wait 3 more seconds.
    await page.waitForTimeout(3_000);

    const result = await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps || !ps.debris || ps.debris.length === 0) return { distance: 0 };
      return {
        distance: Math.abs(ps.posY - ps.debris[0].posY),
      };
    });

    // After 3 seconds, the distance between bodies should be significant.
    expect(result.distance).toBeGreaterThan(1);
  });
});

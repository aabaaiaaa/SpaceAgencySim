import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — First Flight Mission Completion
 *
 * Each test is independent — builds its own rocket in the VAB.
 */

const CMD_DROP_Y    = CANVAS_CENTRE_Y;
const TANK_M_DROP_Y = CMD_DROP_Y   + 20 + 30;
const ENGINE_DROP_Y = TANK_M_DROP_Y + 30 + 15;

const UNLOCKED_PARTS = ['cmd-mk1', 'tank-medium', 'engine-spark'];

async function setupRocketInVab(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
    loan: { balance: 0, interestRate: 0.03, totalInterestAccrued: 0 },
  });
  await seedAndLoadSave(page, envelope);
  await navigateToVab(page);
  await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
  await placePart(page, 'tank-medium', CENTRE_X, TANK_M_DROP_Y, 2);
  await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);
}

test.describe('Flight — First Flight Mission Completion', () => {

  test('(1) engine is auto-staged into Stage 1', async ({ page }) => {
    test.setTimeout(120_000);
    await setupRocketInVab(page);

    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    const unstagedEngines = page.locator('[data-drop-zone="unstaged"] .vab-stage-chip:has-text("Spark Engine")');
    await expect(unstagedEngines).toHaveCount(0);
  });

  test('(2) First Flight mission completes when rocket reaches 100 m', async ({ page }) => {
    test.setTimeout(120_000);
    await setupRocketInVab(page);
    await launchFromVab(page);

    const moneyBefore = await page.evaluate(() => window.__gameState?.money ?? 0);

    await page.keyboard.press('Space');
    await page.keyboard.press('z');

    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) >= 100,
      { timeout: 30_000 },
    );

    await page.keyboard.press('x');

    const objectiveCompleted = await page.evaluate(() => {
      const state = window.__gameState;
      if (!state) return false;
      const mission = state.missions.accepted.find(m => m.id === 'mission-001');
      if (!mission) return false;
      return mission.objectives.every(o => o.completed);
    });
    expect(objectiveCompleted).toBe(true);

    await page.waitForSelector('#post-flight-summary', { state: 'visible', timeout: 60_000 });
    await expect(page.locator('.pf-obj-complete')).toBeVisible({ timeout: 5_000 });
    await page.click('#post-flight-return-btn');

    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    const missionCompleted = await page.evaluate(() => {
      const state = window.__gameState;
      if (!state) return false;
      return state.missions.completed.some(m => m.id === 'mission-001');
    });
    expect(missionCompleted).toBe(true);

    const moneyAfter = await page.evaluate(() => window.__gameState?.money ?? 0);
    const missionReward = 15_000;
    const facilityCount = await page.evaluate(
      () => Object.values(window.__gameState?.facilities ?? {}).filter(f => f.built).length,
    );
    const expectedUpkeep = 10_000 * facilityCount;
    expect(moneyAfter).toBeGreaterThanOrEqual(moneyBefore + missionReward - expectedUpkeep - 1_000);
  });
});

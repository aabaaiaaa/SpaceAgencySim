import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab,
  startTestFlight,
} from './helpers.js';

/**
 * E2E — First Flight Mission Completion
 *
 * Each test is fully independent with its own page, save seed, and setup.
 * Test 1 exercises VAB auto-staging. Tests 2+ use startTestFlight() to
 * bypass the VAB and test mission completion during flight directly.
 */

const CMD_DROP_Y: number    = CANVAS_CENTRE_Y;
const TANK_M_DROP_Y: number = CMD_DROP_Y   + 20 + 30;
const ENGINE_DROP_Y: number = TANK_M_DROP_Y + 30 + 15;

const UNLOCKED_PARTS: string[] = ['cmd-mk1', 'tank-medium', 'engine-spark'];
const FLIGHT_PARTS: string[]   = ['cmd-mk1', 'tank-medium', 'engine-spark'];

function makeMissionEnvelope(overrides: Record<string, unknown> = {}): ReturnType<typeof buildSaveEnvelope> {
  return buildSaveEnvelope({
    missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts: UNLOCKED_PARTS,
    loan: { balance: 0, interestRate: 0.03, totalInterestAccrued: 0 },
    ...overrides,
  });
}

test.describe('Flight — First Flight Mission Completion', () => {

  test('(1) engine is auto-staged into Stage 1', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, makeMissionEnvelope());
    await navigateToVab(page);

    await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
    await placePart(page, 'tank-medium', CENTRE_X, TANK_M_DROP_Y, 2);
    await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);

    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible({ timeout: 5_000 });
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    const unstagedEngines = page.locator('[data-drop-zone="unstaged"] .vab-stage-chip:has-text("Spark Engine")');
    await expect(unstagedEngines).toHaveCount(0, { timeout: 5_000 });
  });

  test('(2) First Flight mission completes when rocket reaches 100 m', async ({ page }) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, makeMissionEnvelope());
    await startTestFlight(page, FLIGHT_PARTS, {
      staging: [{ partIds: ['engine-spark'] }],
    });

    const moneyBefore: number = await page.evaluate((): number => window.__gameState?.money ?? 0);

    await page.keyboard.press('Space');
    await page.keyboard.press('z');

    await page.waitForFunction(
      (): boolean => (window.__flightPs?.posY ?? 0) >= 100,
      { timeout: 15_000 },
    );

    await page.keyboard.press('x');

    const objectiveCompleted: boolean = await page.evaluate((): boolean => {
      const state = window.__gameState;
      if (!state) return false;
      const mission = state.missions.accepted.find(
        (m: { id: string }) => m.id === 'mission-001',
      );
      if (!mission) return false;
      return mission.objectives!.every((o: { completed: boolean }) => o.completed);
    });
    expect(objectiveCompleted).toBe(true);

    await page.waitForSelector('#post-flight-summary', { state: 'visible', timeout: 60_000 });
    await expect(page.locator('.pf-obj-complete')).toBeVisible({ timeout: 5_000 });
    await page.click('#post-flight-return-btn');

    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    const missionCompleted: boolean = await page.evaluate((): boolean => {
      const state = window.__gameState;
      if (!state) return false;
      return state.missions.completed.some(
        (m: { id: string }) => m.id === 'mission-001',
      );
    });
    expect(missionCompleted).toBe(true);

    const moneyAfter: number = await page.evaluate((): number => window.__gameState?.money ?? 0);
    const missionReward: number = 15_000;
    const facilityCount: number = await page.evaluate(
      (): number => Object.values(window.__gameState?.facilities ?? {}).filter(
        (f: { built: boolean }) => f.built,
      ).length,
    );
    const expectedUpkeep: number = 10_000 * facilityCount;
    expect(moneyAfter).toBeGreaterThanOrEqual(moneyBefore + missionReward - expectedUpkeep - 1_000);
  });
});

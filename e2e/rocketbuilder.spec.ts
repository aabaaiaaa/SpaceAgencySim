import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H, STARTING_MONEY,
  CENTRE_X, CANVAS_CENTRE_Y,
  buildSaveEnvelope, seedAndLoadSave, navigateToVab,
  dragPartToCanvas, placePart, dismissWelcomeModal,
} from './helpers.js';
import type { SaveEnvelopeParams } from './helpers.js';

/**
 * E2E — Rocket Builder Flow
 * Each test is independent — seeds its own state and builds its own rocket.
 */

const CMD_DROP_Y    = CANVAS_CENTRE_Y;
const TANK_DROP_Y   = CMD_DROP_Y + 20 + 20;
const ENGINE_DROP_Y = TANK_DROP_Y + 20 + 15;

const CMD_COST    = 8_000;
const TANK_COST   = 800;
const ENGINE_COST = 6_000;

const ALL_VAB_PARTS: string[] = [
  'cmd-mk1', 'probe-core-mk1', 'tank-small', 'tank-medium', 'tank-large',
  'engine-spark', 'engine-reliant', 'engine-poodle', 'engine-nerv',
  'srb-small', 'srb-large', 'parachute-mk1', 'parachute-mk2',
  'decoupler-stack-tr18', 'decoupler-radial', 'landing-legs-small',
  'landing-legs-large', 'science-module-mk1', 'thermometer-mk1',
  'satellite-mk1', 'satellite-comm', 'satellite-weather', 'satellite-science',
  'satellite-gps', 'satellite-relay', 'docking-port-std', 'docking-port-small',
];

async function seedAndOpenVab(page: Page, opts: SaveEnvelopeParams = {}): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({ gameMode: 'freeplay', parts: ALL_VAB_PARTS, ...opts });
  await seedAndLoadSave(page, envelope);
  await dismissWelcomeModal(page);
  await navigateToVab(page);
}

async function buildThreePartRocket(page: Page): Promise<void> {
  await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
  await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 2);
  await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);
}

test.describe('VAB — Rocket Builder Flow', () => {

  test('(1) parts panel shows at least one part per category', async ({ page }) => {
    await seedAndOpenVab(page);

    const list = page.locator('#vab-parts-list');
    await expect(list).toBeVisible({ timeout: 5_000 });

    const headers = list.locator('.vab-parts-group-hdr');
    const headerTexts = await headers.allTextContents();
    expect(headerTexts.some((h: string) => /command modules/i.test(h))).toBe(true);
    expect(headerTexts.some((h: string) => /engines/i.test(h))).toBe(true);
    expect(headerTexts.some((h: string) => /fuel tanks/i.test(h))).toBe(true);

    await expect(page.locator('.vab-part-card[data-part-id="cmd-mk1"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.vab-part-card[data-part-id="engine-spark"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.vab-part-card[data-part-id="tank-small"]')).toBeVisible({ timeout: 5_000 });
  });

  test('(2) scale bar is visible on build canvas', async ({ page }) => {
    await seedAndOpenVab(page);

    const scaleBar = page.locator('#vab-scale-bar');
    await expect(scaleBar).toBeVisible({ timeout: 5_000 });

    const tickCount = await page.evaluate(
      () => document.querySelectorAll('#vab-scale-ticks .vab-tick').length,
    );
    expect(tickCount).toBeGreaterThan(0);

    const labelCount = await page.evaluate(
      () => document.querySelectorAll('#vab-scale-ticks .vab-tick-label').length,
    );
    expect(labelCount).toBeGreaterThan(0);
  });

  test('(3) dragging command module to canvas places it (label visible on canvas)', async ({ page }) => {
    await seedAndOpenVab(page);

    const cashBefore = await page.evaluate(() => window.__gameState?.money ?? 0);
    await dragPartToCanvas(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y);
    await page.waitForFunction(() => (window.__vabAssembly?.parts?.size ?? 0) >= 1, undefined, { timeout: 3_000 });

    const cashAfter = await page.evaluate(() => window.__gameState?.money ?? 0);
    expect(cashAfter).toBe(cashBefore - CMD_COST);

    const partsCount = await page.evaluate(() => window.__vabAssembly?.parts?.size ?? 0);
    expect(partsCount).toBeGreaterThanOrEqual(1);
  });

  test('@smoke (4) placing tank + engine produces a connected rocket', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    const partsCount = await page.evaluate(() => window.__vabAssembly?.parts?.size ?? 0);
    expect(partsCount).toBe(3);

    const connCount = await page.evaluate(() => window.__vabAssembly?.connections?.length ?? 0);
    expect(connCount).toBe(2);
  });

  test('(5) staging panel shows engine auto-staged in Stage 1', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible({ timeout: 5_000 });

    const stage1Zone = page.locator('[data-drop-zone="stage-0"]');
    await expect(stage1Zone.getByText('Spark Engine')).toBeVisible({ timeout: 5_000 });

    const unstagedZone = page.locator('[data-drop-zone="unstaged"]');
    await expect(unstagedZone.getByText('Spark Engine')).not.toBeVisible({ timeout: 5_000 });
  });

  test('(6) engine appears in Stage 1 slot via auto-staging', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible({ timeout: 5_000 });

    await expect(page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-drop-zone="unstaged"]').getByText('Spark Engine')).not.toBeVisible({ timeout: 5_000 });
  });

  test('(7) Rocket Engineer shows passing validation when engine is auto-staged', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    await page.click('#vab-btn-engineer');
    await expect(page.locator('#vab-engineer-panel')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#vab-btn-launch')).not.toBeDisabled({ timeout: 5_000 });
  });

  test('(8) Launch button becomes enabled after valid rocket is built', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    await expect(page.locator('#vab-btn-launch')).not.toBeDisabled({ timeout: 5_000 });
  });

  test('(9) cash display updates when parts are placed (cost deducted)', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    const expectedCash = STARTING_MONEY - CMD_COST - TANK_COST - ENGINE_COST;
    const actualCash = await page.evaluate(() => window.__gameState?.money ?? -1);
    expect(actualCash).toBe(expectedCash);

    const cashEl = page.locator('#topbar-cash');
    await expect(cashEl).toBeVisible({ timeout: 5_000 });
    await expect(cashEl).toContainText('1,985,200', { timeout: 5_000 });
  });

  test('(10) off-screen indicator appears when parts are panned out of view, disappears when visible', async ({ page }) => {
    test.setTimeout(60_000);
    await seedAndOpenVab(page);
    await buildThreePartRocket(page);

    // Close side panels.
    const stagingClose = page.locator('#vab-staging-close');
    const engineerClose = page.locator('#vab-engineer-close');
    if (await stagingClose.isVisible()) await stagingClose.click();
    if (await engineerClose.isVisible()) await engineerClose.click();

    const initialCount = await page.locator('.vab-offscreen-indicator').count();
    expect(initialCount).toBe(0);

    // Pan camera right to push parts off-screen.
    const startX = 200, startY = 200, panDist = 600;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + panDist, startY, { steps: 20 });
    await page.mouse.up();

    await page.waitForFunction(
      () => document.querySelectorAll('.vab-offscreen-indicator').length > 0,
      undefined,
      { timeout: 2_000 },
    );
    expect(await page.locator('.vab-offscreen-indicator').count()).toBeGreaterThanOrEqual(1);

    // Pan back.
    await page.mouse.move(startX + panDist, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY, { steps: 20 });
    await page.mouse.up();

    await page.waitForFunction(
      () => document.querySelectorAll('.vab-offscreen-indicator').length === 0,
      undefined,
      { timeout: 2_000 },
    );
  });
});

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  navigateToVab,
  startTestFlight,
} from './helpers.js';

/**
 * E2E — Scene Cleanup on Exit to Menu
 *
 * Verifies that exiting to the main menu from various screens and then
 * loading a game results in a clean hub with no PixiJS scene remnants.
 */

const UNLOCKED_PARTS: string[] = ['cmd-mk1', 'tank-small', 'engine-spark'];
const envelope: ReturnType<typeof buildSaveEnvelope> = buildSaveEnvelope({ parts: UNLOCKED_PARTS });

// -- Helper: open hamburger and click "Exit to Menu", then confirm -----------

async function exitToMenu(page: Page): Promise<void> {
  await page.click('#topbar-menu-btn');
  await page.waitForSelector('#topbar-dropdown', { state: 'visible', timeout: 5_000 });
  await page.click('.topbar-dropdown-item.danger');
  await page.waitForSelector('[data-testid="exit-confirm-btn"]', { state: 'visible', timeout: 5_000 });
  await page.click('[data-testid="exit-confirm-btn"]');
  await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
}

// -- Helper: load slot 0 and wait for hub ------------------------------------

async function loadSaveSlot0(page: Page): Promise<void> {
  await page.click('[data-action="load"][data-slot="0"]');
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
}

// -- Helper: assert hub is clean ---------------------------------------------

async function assertCleanHub(page: Page): Promise<void> {
  await expect(page.locator('#hub-overlay')).toBeVisible();
  await expect(page.locator('#vab-root')).toHaveCount(0);
  await expect(page.locator('#flight-hud')).toHaveCount(0);
  await expect(page.locator('#flight-overlay')).toHaveCount(0);

  // PixiJS: VAB container should not be visible.
  const vabContainerVisible: boolean = await page.evaluate(() => {
    const app = window.__pixiApp as
      { stage: { children: { label: string; visible: boolean }[] } } | undefined;
    if (!app) return false;
    for (const child of app.stage.children) {
      if (child.label === 'vabRoot' && child.visible) return true;
    }
    return false;
  });
  expect(vabContainerVisible).toBe(false);
}

// -- (1) From VAB -> exit to menu -> load game -------------------------------

test('VAB scene is hidden after exit-to-menu and reload', async ({ page }) => {
  await page.setViewportSize({ width: VP_W, height: VP_H });

  await seedAndLoadSave(page, envelope);
  await navigateToVab(page);
  await expect(page.locator('#vab-root')).toBeVisible();

  await exitToMenu(page);
  await loadSaveSlot0(page);

  await assertCleanHub(page);
});

// -- (2) From flight -> exit to menu -> load game ----------------------------

test('flight scene is cleaned up after exit-to-menu and reload', async ({ page }) => {
  await page.setViewportSize({ width: VP_W, height: VP_H });

  await seedAndLoadSave(page, envelope);

  await startTestFlight(page, ['cmd-mk1', 'tank-small', 'engine-spark']);
  await expect(page.locator('#flight-hud')).toBeVisible();

  await exitToMenu(page);
  await loadSaveSlot0(page);

  await assertCleanHub(page);

  const flightPs: unknown = await page.evaluate(
    () => window.__flightPs
  );
  expect(flightPs).toBeNull();
});

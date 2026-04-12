import { test, expect } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  VP_W, VP_H, SAVE_KEY, STARTING_MONEY,
  buildSaveEnvelope, seedAndLoadSave, dismissWelcomeModal,
} from './helpers.js';
import type { SaveEnvelope } from './helpers.js';

/**
 * E2E — App Load & New Game Flow
 *
 * Each test is independent — seeds its own state and gets a fresh page.
 */

test.describe('App Load & New Game Flow', () => {

  // ── (1) Page loads without console errors ───────────────────────────────

  test('(1) navigating to app root loads the page without console errors', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const consoleErrors: string[] = [];
    page.on('pageerror', (err: Error) => consoleErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.waitForSelector('#mm-agency-name-input', { state: 'visible', timeout: 10_000 });
    expect(consoleErrors).toHaveLength(0);
  });

  // ── (2) No saves → New Game screen is shown ─────────────────────────────

  test('(2) with no saves present, the New Game screen is shown (not the load screen)', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await page.goto('/');
    await page.waitForSelector('#mm-agency-name-input', { state: 'visible', timeout: 10_000 });

    await expect(page.locator('#mm-newgame-screen')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('[data-screen="newgame"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#mm-load-screen')).toHaveCount(0, { timeout: 5_000 });
  });

  // ── (3) Start a new game → hub appears ──────────────────────────────────

  test('(3) entering an agency name and clicking "Start Game" navigates to the space agency hub', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await page.goto('/');
    await page.waitForSelector('#mm-agency-name-input', { state: 'visible', timeout: 10_000 });

    await page.fill('#mm-agency-name-input', 'Galaxy Explorers');
    await page.click('#mm-start-btn');

    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#welcome-modal')).toBeVisible({ timeout: 5_000 });
    await dismissWelcomeModal(page);
    await expect(page.locator('#welcome-modal')).toHaveCount(0, { timeout: 5_000 });
  });

  // ── (4) Hub top bar shows correct starting cash ──────────────────────────

  test('(4) the hub shows the correct starting cash ($2,000,000) in the top bar', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    // Seed a save and load directly to hub instead of going through new game flow.
    const envelope: SaveEnvelope = buildSaveEnvelope({ agencyName: 'Galaxy Explorers', money: STARTING_MONEY });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await expect(page.locator('#game-topbar')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#topbar-cash')).toContainText('2,000,000', { timeout: 5_000 });
  });

  // ── (5) Hub shows starter buildings ─────────────────────────────────────

  test('(5) the hub shows only the starter buildings (tutorial mode hides unbuilt facilities)', async ({ page }: { page: Page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope: SaveEnvelope = buildSaveEnvelope({ agencyName: 'Galaxy Explorers', tutorialMode: true });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    const starterBuildings: { id: string; label: string }[] = [
      { id: 'launch-pad',      label: 'Launch Pad' },
      { id: 'vab',             label: 'Vehicle Assembly Building' },
      { id: 'mission-control', label: 'Mission Control Centre' },
    ];

    for (const { id, label } of starterBuildings) {
      const bld = page.locator(`[data-building-id="${id}"]`);
      await expect(bld).toBeVisible({ timeout: 5_000 });
      await expect(bld).toContainText(label, { timeout: 5_000 });
    }

    const unbuiltIds: string[] = ['crew-admin', 'tracking-station', 'rd-lab', 'satellite-ops', 'library'];
    for (const id of unbuiltIds) {
      await expect(page.locator(`[data-building-id="${id}"]`)).toHaveCount(0, { timeout: 5_000 });
    }
  });

  // ── (6) Existing save → load screen shown by default ────────────────────

  test('(6) with a save present in localStorage, the app shows the load screen and lists the save stats', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const SAVE_NAME: string   = 'Test Save';
    const AGENCY_NAME: string = 'Stardust Corp';
    const MONEY: number       = 2_000_000;

    const ctx: BrowserContext = await browser.newContext();
    const p: Page             = await ctx.newPage();

    await p.addInitScript(({ key, envelope }: { key: string; envelope: SaveEnvelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, {
      key: SAVE_KEY,
      envelope: buildSaveEnvelope({ saveName: SAVE_NAME, agencyName: AGENCY_NAME, money: MONEY }),
    });

    await p.goto('/');
    await p.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    await expect(p.locator('[data-screen="load"]')).toBeVisible({ timeout: 5_000 });

    const card = p.locator('.mm-save-card[data-slot="0"]:not(.mm-empty-slot)');
    await expect(card).toBeVisible({ timeout: 5_000 });
    await expect(card).toContainText(SAVE_NAME, { timeout: 5_000 });
    await expect(card).toContainText(AGENCY_NAME, { timeout: 5_000 });
    await expect(card).toContainText('2,000,000', { timeout: 5_000 });

    const missionsStat = card.locator('.mm-stat').filter({ hasText: /missions done/i });
    await expect(missionsStat).toContainText('0', { timeout: 5_000 });

    await p.close();
    await ctx.close();
  });
});

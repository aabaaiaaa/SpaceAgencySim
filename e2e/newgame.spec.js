import { test, expect } from '@playwright/test';
import { SAVE_KEY, buildSaveEnvelope } from './helpers.js';

/**
 * E2E — App Load & New Game Flow
 *
 * Covers the entry path from a fresh browser context through to the hub
 * screen, plus the load-screen path when a save already exists.
 *
 * Tests (1)–(5) run in serial order on a shared page instance (no saves
 * present).  Test (6) creates its own isolated browser context and injects
 * a save into localStorage before navigating, so the load screen is shown.
 *
 * Execution order:
 *   beforeAll : Create page, attach error listeners, navigate to '/'
 *   (1)       : Page loads without console errors
 *   (2)       : New Game screen is shown (no saves present)
 *   (3)       : Enter agency name → click Start Game → hub appears
 *   (4)       : Hub top bar shows $2,000,000
 *   (5)       : Hub has all four clickable buildings
 *   (6)       : Isolated context with a pre-seeded save shows load screen
 */

test.describe.configure({ mode: 'serial' });

test.describe('App Load & New Game Flow', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  /** Console errors collected during the initial page load. */
  const consoleErrors = [];

  // ── Setup ────────────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();

    // Capture console errors and uncaught exceptions that occur during load.
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');

    // A fresh context has no saves, so the New Game screen should appear.
    await page.waitForSelector('#mm-agency-name-input', {
      state:   'visible',
      timeout: 15_000,
    });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Page loads without console errors ───────────────────────────────

  test('(1) navigating to app root loads the page without console errors', async () => {
    expect(consoleErrors).toHaveLength(0);
  });

  // ── (2) No saves → New Game screen is shown ─────────────────────────────

  test('(2) with no saves present, the New Game screen is shown (not the load screen)', async () => {
    // New Game screen must be visible.
    await expect(page.locator('#mm-newgame-screen')).toBeVisible();
    await expect(page.locator('[data-screen="newgame"]')).toBeVisible();

    // The load screen must not be present.
    await expect(page.locator('#mm-load-screen')).toHaveCount(0);
  });

  // ── (3) Start a new game → hub appears ──────────────────────────────────

  test('(3) entering an agency name and clicking "Start Game" navigates to the space agency hub', async () => {
    await page.fill('#mm-agency-name-input', 'Galaxy Explorers');
    await page.click('#mm-start-btn');

    // Hub overlay must appear after the menu fade-out animation.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    await expect(page.locator('#hub-overlay')).toBeVisible();
  });

  // ── (4) Hub top bar shows correct starting cash ──────────────────────────

  test('(4) the hub shows the correct starting cash ($2,000,000) in the top bar', async () => {
    await expect(page.locator('#game-topbar')).toBeVisible();

    // Cash readout must contain "2,000,000" (formatted with commas).
    await expect(page.locator('#topbar-cash')).toContainText('2,000,000');
  });

  // ── (5) Hub shows all four clickable buildings ───────────────────────────

  test('(5) the hub shows all four clickable buildings with the correct labels', async () => {
    const buildings = [
      { id: 'launch-pad',      label: 'Launch Pad' },
      { id: 'vab',             label: 'Vehicle Assembly Building' },
      { id: 'mission-control', label: 'Mission Control Centre' },
      { id: 'crew-admin',      label: 'Crew Administration' },
    ];

    for (const { id, label } of buildings) {
      const bld = page.locator(`[data-building-id="${id}"]`);
      await expect(bld).toBeVisible();
      await expect(bld).toContainText(label);
    }
  });

  // ── (6) Existing save → load screen shown by default ────────────────────

  test('(6) with a save present in localStorage, the app shows the load screen and lists the save stats', async ({ browser }) => {
    test.setTimeout(60_000);
    const SAVE_NAME   = 'Test Save';
    const AGENCY_NAME = 'Stardust Corp';
    const MONEY       = 2_000_000;

    // Create an isolated browser context so this test does not share
    // localStorage with the page used by tests (1)–(5).
    const ctx = await browser.newContext();
    const p   = await ctx.newPage();

    // Inject a save into localStorage before the page boots so that
    // listSaves() finds it immediately and shows the load screen.
    await p.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, {
      key: SAVE_KEY,
      envelope: buildSaveEnvelope({ saveName: SAVE_NAME, agencyName: AGENCY_NAME, money: MONEY }),
    });

    await p.goto('/');
    await p.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // Load screen (not New Game screen) must be the active view.
    await expect(p.locator('[data-screen="load"]')).toBeVisible();

    // The save card for slot 0 must be a populated (non-empty) card.
    const card = p.locator('.mm-save-card[data-slot="0"]:not(.mm-empty-slot)');
    await expect(card).toBeVisible();

    // Card must display the save name, agency name, and cash balance.
    await expect(card).toContainText(SAVE_NAME);
    await expect(card).toContainText(AGENCY_NAME);
    await expect(card).toContainText('2,000,000');

    // Missions completed should show as 0.
    const missionsStat = card.locator('.mm-stat').filter({ hasText: /missions done/i });
    await expect(missionsStat).toContainText('0');

    await p.close();
    await ctx.close();
  });
});

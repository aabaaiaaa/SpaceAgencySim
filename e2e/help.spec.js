import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, navigateToVab, placePart, launchFromVab,
  ALL_FACILITIES,
} from './helpers.js';

/**
 * E2E — Help Panel Accessibility
 *
 * Verifies the help panel is accessible from every unique game screen and
 * opens to the correct default section based on context.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openHelp(page) {
  await page.click('#topbar-menu-btn');
  const helpBtn = page.locator('.topbar-dropdown-item', { hasText: 'Help' });
  await helpBtn.click();
  await expect(page.locator('#help-panel')).toBeVisible({ timeout: 3_000 });
}

async function closeHelp(page) {
  await page.click('.help-close-x');
  await expect(page.locator('#help-panel')).toHaveCount(0, { timeout: 3_000 });
}

function activeSection(page) {
  return page.locator('.help-sidebar-item.active').getAttribute('data-section');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Help Panel Accessibility', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Help E2E Test',
      missions: {
        available: [],
        accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }],
        completed: [],
      },
      parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'cmd-mk1'],
      facilities: ALL_FACILITIES,
    });

    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Help from Hub ───────────────────────────────────────────────────

  test('(1) help is accessible from the Hub with default section "overview"', async () => {
    await expect(page.locator('#hub-overlay')).toBeVisible();
    await openHelp(page);
    expect(await activeSection(page)).toBe('overview');
    await closeHelp(page);
  });

  // ── (2) Help from VAB ──────────────────────────────────────────────────

  test('(2) help is accessible from the VAB with default section "vab"', async () => {
    await navigateToVab(page);
    await openHelp(page);
    expect(await activeSection(page)).toBe('vab');
    await closeHelp(page);

    // Return to hub.
    await page.click('#vab-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
  });

  // ── (3) Help from Mission Control ──────────────────────────────────────

  test('(3) help is accessible from Mission Control with default section "missions"', async () => {
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('missions');
    await closeHelp(page);

    // Return to hub.
    await page.click('#mission-control-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
  });

  // ── (4) Help from Crew Admin ───────────────────────────────────────────

  test('(4) help is accessible from Crew Admin with default section "crew"', async () => {
    await page.click('[data-building-id="crew-admin"]');
    await page.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('crew');
    await closeHelp(page);

    // Return to hub.
    await page.click('#crew-admin-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
  });

  // ── (5) Help from Launch Pad ───────────────────────────────────────────

  test('(5) help is accessible from Launch Pad with default section "vab"', async () => {
    await page.click('[data-building-id="launch-pad"]');
    await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('vab');
    await closeHelp(page);

    // Return to hub.
    await page.click('#launch-pad-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
  });

  // ── (6) Help from Tracking Station ─────────────────────────────────────

  test('(6) help is accessible from Tracking Station with default section "orbit"', async () => {
    await page.click('[data-building-id="tracking-station"]');
    await page.waitForSelector('#ts-overlay', { state: 'visible', timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('orbit');
    await closeHelp(page);

    // Exit to menu (avoids PixiJS hub re-init crash) and reload the save
    // so subsequent tests start from a clean hub.
    await page.click('#topbar-menu-btn');
    const exitBtn = page.locator('.topbar-dropdown-item.danger', { hasText: 'Exit to Menu' });
    await exitBtn.click();
    await page.locator('[data-testid="exit-confirm-btn"]').click({ timeout: 5_000 });
    await page.waitForSelector('#mm-load-screen, #mm-newgame-screen', {
      state: 'visible',
      timeout: 15_000,
    });
    const loadBtn = page.locator('[data-action="load"][data-slot="0"]');
    if (await loadBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await loadBtn.click();
      await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    }
  });

  // ── (7) Help during Flight ─────────────────────────────────────────────
  // NOTE: This test exits to menu and reloads, so it must run last before
  // the sidebar test.

  test('(7) help is accessible during flight with default section "flight"', async () => {
    test.setTimeout(90_000);

    // Ensure we're on the hub (test 6 reloads save).
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 15_000 });

    await navigateToVab(page);

    // Wait for parts panel to be ready.
    await page.waitForSelector('.vab-part-card[data-part-id="probe-core-mk1"]', {
      state: 'visible',
      timeout: 10_000,
    });

    // Build a simple probe rocket.
    await placePart(page, 'probe-core-mk1', CENTRE_X, CANVAS_CENTRE_Y, 1);
    await placePart(page, 'tank-small', CENTRE_X, CANVAS_CENTRE_Y + 25, 2);
    await placePart(page, 'engine-spark', CENTRE_X, CANVAS_CENTRE_Y + 50, 3);

    await launchFromVab(page);
    await expect(page.locator('#flight-hud')).toBeVisible({ timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('flight');
    await closeHelp(page);

    // Exit to menu and reload the save to get back to the hub for remaining tests.
    await page.click('#topbar-menu-btn');
    const exitBtn = page.locator('.topbar-dropdown-item.danger', { hasText: 'Exit to Menu' });
    await exitBtn.click();

    // Confirm exit dialog.
    const confirmBtn = page.locator('[data-testid="exit-confirm-btn"]');
    await confirmBtn.click({ timeout: 5_000 });

    // Wait for main menu, then reload the save.
    await page.waitForSelector('#mm-load-screen, #mm-newgame-screen', {
      state: 'visible',
      timeout: 15_000,
    });

    // Reload the seeded save.
    const loadBtn = page.locator('[data-action="load"][data-slot="0"]');
    if (await loadBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await loadBtn.click();
      await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    }
  });

  // ── (8) Sidebar navigation ─────────────────────────────────────────────

  test('(8) clicking sidebar sections switches the content area', async () => {
    await openHelp(page);

    // Click a few sections and verify the active state changes.
    const sections = ['flight', 'finance', 'advanced', 'overview'];
    for (const sectionId of sections) {
      await page.click(`.help-sidebar-item[data-section="${sectionId}"]`);
      expect(await activeSection(page)).toBe(sectionId);

      // Verify content area has an h2 (section heading rendered).
      await expect(page.locator('.help-content h2')).toBeVisible();
    }

    await closeHelp(page);
  });
});

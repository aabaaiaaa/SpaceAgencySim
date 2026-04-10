import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  seedAndLoadSave, navigateToVab, placePart, launchFromVab,
  ALL_FACILITIES,
} from './helpers.js';
import type { SaveEnvelope } from './helpers.js';

/**
 * E2E — Help Panel Accessibility
 *
 * Verifies the help panel is accessible from every unique game screen and
 * opens to the correct default section based on context.
 *
 * Each test receives its own Playwright page fixture. `beforeEach` sets the
 * viewport and seeds a fresh save, so every test starts from the hub
 * independently.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function openHelp(page: Page): Promise<void> {
  await page.click('#topbar-menu-btn');
  const helpBtn = page.locator('.topbar-dropdown-item', { hasText: 'Help' });
  await helpBtn.click();
  await expect(page.locator('#help-panel')).toBeVisible({ timeout: 3_000 });
}

async function closeHelp(page: Page): Promise<void> {
  await page.click('.help-close-x');
  await expect(page.locator('#help-panel')).toHaveCount(0, { timeout: 3_000 });
}

function activeSection(page: Page): Promise<string | null> {
  return page.locator('.help-sidebar-item.active').getAttribute('data-section');
}

function helpEnvelope(): SaveEnvelope {
  return buildSaveEnvelope({
    saveName: 'Help E2E Test',
    missions: {
      available: [],
      accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }],
      completed: [],
    },
    parts: ['probe-core-mk1', 'tank-small', 'engine-spark', 'cmd-mk1'],
    facilities: ALL_FACILITIES,
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Help Panel Accessibility', () => {

  // ── Per-test setup: seed save and set viewport ────────────────────────────

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, helpEnvelope());
  });

  // ── (1) Help from Hub ───────────────────────────────────────────────────

  test('(1) help is accessible from the Hub with default section "overview"', async ({ page }) => {
    await expect(page.locator('#hub-overlay')).toBeVisible();
    await openHelp(page);
    expect(await activeSection(page)).toBe('overview');
    await closeHelp(page);
  });

  // ── (2) Help from VAB ──────────────────────────────────────────────────

  test('(2) help is accessible from the VAB with default section "vab"', async ({ page }) => {
    await navigateToVab(page);
    await openHelp(page);
    expect(await activeSection(page)).toBe('vab');
    await closeHelp(page);
  });

  // ── (3) Help from Mission Control ──────────────────────────────────────

  test('(3) help is accessible from Mission Control with default section "missions"', async ({ page }) => {
    await page.click('[data-building-id="mission-control"]');
    await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('missions');
    await closeHelp(page);
  });

  // ── (4) Help from Crew Admin ───────────────────────────────────────────

  test('(4) help is accessible from Crew Admin with default section "crew"', async ({ page }) => {
    await page.click('[data-building-id="crew-admin"]');
    await page.waitForSelector('#crew-admin-overlay', { state: 'visible', timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('crew');
    await closeHelp(page);
  });

  // ── (5) Help from Launch Pad ───────────────────────────────────────────

  test('(5) help is accessible from Launch Pad with default section "vab"', async ({ page }) => {
    await page.click('[data-building-id="launch-pad"]');
    await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('vab');
    await closeHelp(page);
  });

  // ── (6) Help from Tracking Station ─────────────────────────────────────

  test('(6) help is accessible from Tracking Station with default section "orbit"', async ({ page }) => {
    await page.click('[data-building-id="tracking-station"]');
    await page.waitForSelector('#ts-overlay', { state: 'visible', timeout: 10_000 });

    await openHelp(page);
    expect(await activeSection(page)).toBe('orbit');
    await closeHelp(page);
  });

  // ── (7) Help during Flight ─────────────────────────────────────────────

  test('(7) help is accessible during flight with default section "flight"', async ({ page }) => {
    test.setTimeout(90_000);

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
  });

  // ── (8) Sidebar navigation ─────────────────────────────────────────────

  test('(8) clicking sidebar sections switches the content area', async ({ page }) => {
    await openHelp(page);

    // Click a few sections and verify the active state changes.
    const sections: string[] = ['flight', 'finance', 'advanced', 'overview'];
    for (const sectionId of sections) {
      await page.click(`.help-sidebar-item[data-section="${sectionId}"]`);
      expect(await activeSection(page)).toBe(sectionId);

      // Verify content area has an h2 (section heading rendered).
      await expect(page.locator('.help-content h2')).toBeVisible();
    }

    await closeHelp(page);
  });
});

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope, seedAndLoadSave, dismissWelcomeModal,
  startTestFlight,
} from './helpers.js';

/**
 * E2E — Debug FPS/Frame-Time Monitor
 *
 * Verifies:
 *   (1) FPS monitor is NOT visible during flight when debug mode is off
 *   (2) FPS monitor IS visible during flight when debug mode is on
 *   (3) window.__perfStats contains fps and frameTime values
 */

test.describe.configure({ mode: 'serial' });

/** Return to agency from flight via hamburger menu. */
async function returnToAgency(page) {
  const dropdown = page.locator('#topbar-dropdown');
  if (!(await dropdown.isVisible())) {
    await page.click('#topbar-menu-btn');
    await expect(dropdown).toBeVisible({ timeout: 2_000 });
  }
  await dropdown.getByText('Return to Space Agency').click();

  // Handle abort confirmation if it appears.
  const abortConfirm = page.locator('[data-testid="abort-confirm-btn"]');
  const abortVisible = await abortConfirm.isVisible({ timeout: 2_000 }).catch(() => false);
  if (abortVisible) {
    await abortConfirm.click();
  }

  // Handle post-flight summary if it appears.
  const summary = page.locator('#post-flight-summary');
  const summaryVisible = await summary.isVisible({ timeout: 5_000 }).catch(() => false);
  if (summaryVisible) {
    await page.click('#post-flight-return-btn');
  }

  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
}

test.describe('FPS Monitor', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();

    // Seed a save with debug mode OFF (default).
    const envelope = buildSaveEnvelope({
      saveName: 'FPS Monitor Test',
      gameMode: 'sandbox',
      debugMode: false,
      parts: ['cmd-mk1', 'tank-small', 'engine-spark'],
    });

    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) FPS monitor not visible with debug mode off ────────────────────

  test('(1) FPS monitor is not visible during flight with debug mode off', async () => {
    // Start a flight.
    await startTestFlight(page, ['cmd-mk1', 'tank-small', 'engine-spark']);

    // Let a few frames run.
    await page.waitForTimeout(600);

    // FPS monitor should NOT be visible.
    const monitor = page.locator('#fps-monitor');
    await expect(monitor).not.toBeVisible();

    // Return to hub for next test.
    await returnToAgency(page);
    await dismissWelcomeModal(page);
  });

  // ── (2) FPS monitor visible with debug mode on ─────────────────────────

  test('(2) FPS monitor is visible during flight with debug mode on', async () => {
    // Enable debug mode before starting a flight.
    await page.evaluate(() => window.__enableDebugMode());

    // Start a new flight with debug mode on.
    await startTestFlight(page, ['cmd-mk1', 'tank-small', 'engine-spark']);

    // Let a few frames run so the display updates at least once.
    await page.waitForTimeout(600);

    // FPS monitor should be visible.
    const monitor = page.locator('#fps-monitor');
    await expect(monitor).toBeVisible({ timeout: 5_000 });

    // Verify it shows FPS and frame time text.
    const fpsText = await page.locator('#fps-monitor-fps').textContent();
    expect(fpsText).toMatch(/FPS:\s*\d+/);

    const ftText = await page.locator('#fps-monitor-ft').textContent();
    expect(ftText).toMatch(/Frame:\s*[\d.]+\s*ms/);
  });

  // ── (3) window.__perfStats contains fps and frameTime ──────────────────

  test('(3) window.__perfStats contains fps and frameTime values', async () => {
    const stats = await page.evaluate(() => window.__perfStats);
    expect(stats).toBeTruthy();
    expect(typeof stats.fps).toBe('number');
    expect(stats.fps).toBeGreaterThan(0);
    expect(typeof stats.frameTime).toBe('number');
    expect(stats.frameTime).toBeGreaterThan(0);
  });
});

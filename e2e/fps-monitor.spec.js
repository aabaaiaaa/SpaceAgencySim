import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope, seedAndLoadSave, dismissWelcomeModal,
  startTestFlight,
} from './helpers.js';

/**
 * E2E — Debug FPS/Frame-Time Monitor
 * Each test is fully self-contained — seeds its own state and gets a fresh page.
 */

const FLIGHT_PARTS = ['cmd-mk1', 'tank-small', 'engine-spark'];

test.describe('FPS Monitor', () => {

  test('(1) FPS monitor is not visible during flight with debug mode off', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false, parts: FLIGHT_PARTS });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, FLIGHT_PARTS);
    await page.waitForTimeout(600);
    await expect(page.locator('#fps-monitor')).not.toBeVisible();
  });

  test('(2) FPS monitor is visible during flight with debug mode on', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false, parts: FLIGHT_PARTS });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    await startTestFlight(page, FLIGHT_PARTS);
    await page.waitForTimeout(600);

    await expect(page.locator('#fps-monitor')).toBeVisible({ timeout: 5_000 });
    const fpsText = await page.locator('#fps-monitor-fps').textContent();
    expect(fpsText).toMatch(/FPS:\s*\d+/);
    const ftText = await page.locator('#fps-monitor-ft').textContent();
    expect(ftText).toMatch(/Frame:\s*[\d.]+\s*ms/);
  });

  test('(3) window.__perfStats contains fps and frameTime values', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false, parts: FLIGHT_PARTS });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    await startTestFlight(page, FLIGHT_PARTS);
    await page.waitForTimeout(600);

    const stats = await page.evaluate(() => window.__perfStats);
    expect(stats).toBeTruthy();
    expect(typeof stats.fps).toBe('number');
    expect(stats.fps).toBeGreaterThan(0);
    expect(typeof stats.frameTime).toBe('number');
    expect(stats.frameTime).toBeGreaterThan(0);
  });
});

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

// ---------------------------------------------------------------------------
// (window.d.ts augments the global Window interface with game properties)
// ---------------------------------------------------------------------------

/** Shape of the perf stats object (matches window.__perfStats). */
interface PerfStats {
  fps: number;
  frameTime: number;
  minFrameTime: number;
  maxFrameTime: number;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

const FLIGHT_PARTS: string[] = ['cmd-mk1', 'tank-small', 'engine-spark'];

test.describe('FPS Monitor', () => {

  test('(1) FPS monitor is not visible during flight with debug mode off', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false, parts: FLIGHT_PARTS });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await startTestFlight(page, FLIGHT_PARTS);
    // FPS monitor should not appear with debug mode off — no hard wait needed
    await expect(page.locator('#fps-monitor')).not.toBeVisible({ timeout: 2_000 });
  });

  test('(2) FPS monitor is visible during flight with debug mode on', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false, parts: FLIGHT_PARTS });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    await startTestFlight(page, FLIGHT_PARTS);

    await expect(page.locator('#fps-monitor')).toBeVisible({ timeout: 5_000 });
    const fpsText: string | null = await page.locator('#fps-monitor-fps').textContent();
    expect(fpsText).toMatch(/FPS:\s*\d+/);
    const ftText: string | null = await page.locator('#fps-monitor-ft').textContent();
    expect(ftText).toMatch(/Frame:\s*-?[\d.]+\s*ms/);
  });

  test('(3) window.__perfStats contains fps and frameTime values', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false, parts: FLIGHT_PARTS });
    await seedAndLoadSave(page, envelope);
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    await startTestFlight(page, FLIGHT_PARTS);

    // Wait for perf stats to be populated (requires at least one render frame)
    await page.waitForFunction(
      () => window.__perfStats?.fps != null && window.__perfStats.fps > 0,
      undefined,
      { timeout: 5_000 },
    );

    const stats = await page.evaluate((): PerfStats | null =>
      window.__perfStats
    );
    expect(stats).toBeTruthy();
    expect(typeof stats!.fps).toBe('number');
    expect(stats!.fps).toBeGreaterThan(0);
    expect(typeof stats!.frameTime).toBe('number');
    expect(stats!.frameTime).toBeGreaterThan(0);
  });
});

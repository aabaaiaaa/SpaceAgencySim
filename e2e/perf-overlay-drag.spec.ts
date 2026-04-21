import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope, seedAndLoadSave, dismissWelcomeModal,
  startTestFlight,
  readIdb,
} from './helpers.js';

/**
 * E2E — Draggable perf overlays
 *
 * The FPS monitor (debug-mode) and perf dashboard both default to the
 * top-right corner, where they overlap with the mission objectives panel.
 * Players can drag them to a new position; the position persists via the
 * dedicated settingsStore.
 */

const FLIGHT_PARTS: string[] = ['cmd-mk1', 'tank-small', 'engine-spark'];
const SETTINGS_KEY: string = 'spaceAgency_settings';

/** Seed a save, reload, and start a flight with the FPS monitor visible. */
async function launchWithFpsMonitor(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({ gameMode: 'sandbox', debugMode: false, parts: FLIGHT_PARTS });
  await seedAndLoadSave(page, envelope);
  await dismissWelcomeModal(page);

  // Enabling debug mode causes startFlightScene to show the FPS monitor.
  await page.evaluate(() => window.__enableDebugMode());
  await startTestFlight(page, FLIGHT_PARTS);
  await expect(page.locator('#fps-monitor')).toBeVisible({ timeout: 5_000 });
}

/** Read the persisted fpsMonitorPosition (if any) from settingsStore. */
async function readFpsMonitorPosition(page: Page): Promise<{ x: number; y: number } | null> {
  const raw = await readIdb(page, SETTINGS_KEY);
  if (raw === null) return null;
  const envelope = JSON.parse(raw) as {
    settings: { fpsMonitorPosition: { x: number; y: number } | null };
  };
  return envelope.settings.fpsMonitorPosition;
}

test.describe('Perf overlay — drag and persistence', () => {

  test('fps monitor moves when dragged and persists across reload @smoke', async ({ page }) => {
    await launchWithFpsMonitor(page);

    // Measure starting position.
    const before = await page.locator('#fps-monitor').boundingBox();
    expect(before).not.toBeNull();

    // Drag it down-and-left by ~200 px.
    const startX = before!.x + before!.width / 2;
    const startY = before!.y + before!.height / 2;
    const targetX = startX - 400;
    const targetY = startY + 200;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Multi-step move so the hysteresis threshold is crossed and the
    // pointermove handler runs its clamp update per step.
    await page.mouse.move(startX - 20, startY + 10, { steps: 3 });
    await page.mouse.move(targetX, targetY, { steps: 10 });
    await page.mouse.up();

    // New position must differ from the original.
    const after = await page.locator('#fps-monitor').boundingBox();
    expect(after).not.toBeNull();
    expect(Math.abs(after!.x - before!.x)).toBeGreaterThan(50);
    expect(Math.abs(after!.y - before!.y)).toBeGreaterThan(50);

    // The settingsStore should now have a non-null fpsMonitorPosition.
    const saved = await readFpsMonitorPosition(page);
    expect(saved).not.toBeNull();
    expect(typeof saved!.x).toBe('number');
    expect(typeof saved!.y).toBe('number');

    // Reload, start a fresh flight, and confirm the FPS monitor respawns
    // at the previously saved position (within 4px — the CSS margin).
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
    await dismissWelcomeModal(page);

    await page.evaluate(() => window.__enableDebugMode());
    await startTestFlight(page, FLIGHT_PARTS);
    await expect(page.locator('#fps-monitor')).toBeVisible({ timeout: 5_000 });

    const reloadedBox = await page.locator('#fps-monitor').boundingBox();
    expect(reloadedBox).not.toBeNull();
    expect(Math.abs(reloadedBox!.x - saved!.x)).toBeLessThanOrEqual(4);
    expect(Math.abs(reloadedBox!.y - saved!.y)).toBeLessThanOrEqual(4);
  });

  test('clicking on the fps monitor without moving does not persist a position', async ({ page }) => {
    await launchWithFpsMonitor(page);
    const before = await page.locator('#fps-monitor').boundingBox();
    expect(before).not.toBeNull();

    const cx = before!.x + before!.width / 2;
    const cy = before!.y + before!.height / 2;

    // A click that stays below the 8px hysteresis threshold — should NOT
    // commit to a drag or fire the persistence callback.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 2, cy + 2);
    await page.mouse.up();

    // Give the persistence pipeline a tick; nothing should have been written.
    await page.waitForTimeout(200);
    const saved = await readFpsMonitorPosition(page);
    expect(saved).toBeNull();
  });
});

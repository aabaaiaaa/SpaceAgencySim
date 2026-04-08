import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave, startTestFlight,
} from './helpers.js';

/**
 * E2E — Flight Part Context Menu
 *
 * Each test is independent — starts its own flight with an unstaged parachute.
 */

const UNLOCKED_PARTS = ['cmd-mk1', 'parachute-mk2', 'tank-medium', 'engine-spark'];
const FLIGHT_PARTS = ['parachute-mk2', 'cmd-mk1', 'tank-medium', 'engine-spark'];

async function setupFlightWithParachute(page) {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const envelope = buildSaveEnvelope({ parts: UNLOCKED_PARTS });
  await seedAndLoadSave(page, envelope);
  await startTestFlight(page, FLIGHT_PARTS);
  // Stage engine and lift off.
  await page.keyboard.press('Space');
  await page.waitForFunction(() => (window.__flightPs?.posY ?? 0) > 5, { timeout: 5_000 });
}

/** Sweep right-clicks to find the parachute and open context menu. */
async function openParachuteContextMenu(page) {
  const menu = page.locator('#flight-part-ctx-menu');
  const centreX = VP_W / 2;
  const centreY = VP_H / 2;
  let menuOpened = false;
  for (let dy = -60; dy <= 60 && !menuOpened; dy += 5) {
    await page.mouse.click(centreX, centreY + dy, { button: 'right' });
    const visible = await menu.evaluate(
      (el) => !el.hasAttribute('hidden') && el.textContent.includes('Mk2 Parachute'),
    ).catch(() => false);
    if (visible) menuOpened = true;
  }
  return menuOpened;
}

test.describe('Flight — Part Context Menu', () => {

  test('(1) right-clicking the parachute part opens the context menu with "Deploy Parachute"', async ({ page }) => {
    await setupFlightWithParachute(page);

    const menu = page.locator('#flight-part-ctx-menu');
    await expect(menu).toBeHidden();

    const menuOpened = await openParachuteContextMenu(page);
    expect(menuOpened).toBe(true);
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Mk2 Parachute');
    await expect(menu).toContainText('Deploy Parachute');
  });

  test('(2) clicking "Deploy Parachute" deploys the chute and closes the menu', async ({ page }) => {
    await setupFlightWithParachute(page);

    const menu = page.locator('#flight-part-ctx-menu');
    const menuOpened = await openParachuteContextMenu(page);
    expect(menuOpened).toBe(true);

    await menu.locator('.fctx-item', { hasText: 'Deploy Parachute' }).click();
    await expect(menu).toBeHidden({ timeout: 2_000 });

    const chuteState = await page.evaluate(() => {
      const ps       = window.__flightPs;
      const assembly = window.__flightAssembly;
      if (!ps || !assembly) return null;
      for (const [id, placed] of assembly.parts) {
        if (placed.partId === 'parachute-mk2') {
          const entry = ps.parachuteStates?.get(id);
          return entry?.state ?? null;
        }
      }
      return null;
    });
    expect(['deploying', 'deployed']).toContain(chuteState);
  });

  test('(3) after deployment, re-opening the context menu shows parachute status instead of deploy button', async ({ page }) => {
    await setupFlightWithParachute(page);

    // Open menu and deploy.
    const menu = page.locator('#flight-part-ctx-menu');
    const opened = await openParachuteContextMenu(page);
    expect(opened).toBe(true);
    await menu.locator('.fctx-item', { hasText: 'Deploy Parachute' }).click();
    await expect(menu).toBeHidden({ timeout: 2_000 });

    // Re-open menu.
    const reopened = await openParachuteContextMenu(page);
    expect(reopened).toBe(true);

    await expect(menu).toContainText(/Parachute: (Deploying|Deployed)/);
    const deployBtnCount = await menu.locator('.fctx-item', { hasText: 'Deploy Parachute' }).count();
    expect(deployBtnCount).toBe(0);
  });
});

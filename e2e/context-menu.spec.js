import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — Flight Part Context Menu
 *
 * Tests right-clicking a rocket part during flight to open the context menu
 * and activate it directly (bypassing staging).
 *
 * Scenario: deploy an unstaged parachute via the right-click context menu.
 *
 * Setup (beforeAll):
 *   1. Seed a save with parachute-mk2, cmd-mk1, and engine-spark unlocked.
 *   2. Build a 3-part rocket: parachute on top, cmd in the middle, engine below.
 *   3. Launch and fire Stage 1 (engine only) so the rocket lifts off.
 *      The parachute remains unstaged.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Drop positions (parachute-mk2 + cmd-mk1 + tank-medium + engine-spark)
// ---------------------------------------------------------------------------

const CMD_DROP_Y    = CANVAS_CENTRE_Y;              // 386
const CHUTE_DROP_Y  = CMD_DROP_Y    - 20 - 8;       // above cmd
const TANK_DROP_Y   = CMD_DROP_Y    + 20 + 30;      // below cmd
const ENGINE_DROP_Y = TANK_DROP_Y   + 30 + 15;      // below tank

const UNLOCKED_PARTS = ['cmd-mk1', 'parachute-mk2', 'tank-medium', 'engine-spark'];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Part Context Menu', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Suite setup ───────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Context Menu E2E',
      parts: UNLOCKED_PARTS,
    });

    await seedAndLoadSave(page, envelope);
    await navigateToVab(page);

    // ── Build: cmd-mk1 → parachute-mk2 (above) → tank-medium (below) → engine-spark
    await placePart(page, 'cmd-mk1',       CENTRE_X, CMD_DROP_Y,    1);
    await placePart(page, 'parachute-mk2', CENTRE_X, CHUTE_DROP_Y,  2);
    await placePart(page, 'tank-medium',   CENTRE_X, TANK_DROP_Y,   3);
    await placePart(page, 'engine-spark',  CENTRE_X, ENGINE_DROP_Y, 4);

    // ── Verify only the engine is staged (parachute should be unstaged) ────
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // ── Launch and fire Stage 1 so the rocket lifts off ────────────────────
    await launchFromVab(page);
    await page.keyboard.press('Space');
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 5,
      { timeout: 5_000 },
    );
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Right-clicking the parachute opens the context menu ───────────────

  test('(1) right-clicking the parachute part opens the context menu with "Deploy Parachute"', async () => {
    // Compute the parachute's screen position from the assembly and physics state.
    const coords = await page.evaluate(() => {
      const ps       = window.__flightPs;
      const assembly = window.__flightAssembly;
      if (!ps || !assembly) return null;

      // Find the parachute instance.
      let chuteInstanceId = null;
      for (const [id, placed] of assembly.parts) {
        if (placed.partId === 'parachute-mk2') {
          chuteInstanceId = id;
          break;
        }
      }
      if (!chuteInstanceId) return null;

      const placed = assembly.parts.get(chuteInstanceId);
      return { instanceId: chuteInstanceId, x: placed.x, y: placed.y };
    });

    expect(coords).not.toBeNull();

    // The rocket renders centered on screen (camera follows CoM).
    // Use the canvas element to get the rendering bounds.
    // We dispatch the contextmenu event at screen centre offset by the part's
    // relative position.  The hit-test in the render module uses _worldToScreen
    // which positions the rocket container roughly at viewport centre.
    //
    // At default zoom (PPM = 20), the container-local coordinates map 1:1 to
    // screen pixels.  The hit-test works in container-local space where
    // partCY = -placed.y, so screen offset from container origin = -placed.y.
    //
    // Rather than replicating the full camera transform, we sweep a small
    // vertical strip at viewport centre-X to reliably hit the parachute.

    const menu = page.locator('#flight-part-ctx-menu');

    // Ensure the menu starts hidden.
    await expect(menu).toBeHidden();

    // Try right-clicking at several Y positions near the top of the rocket.
    // The rocket is roughly centered; the parachute sits above the CoM.
    let menuOpened = false;
    const centreX = VP_W / 2;
    const centreY = VP_H / 2;

    // Sweep from 60px above centre to 60px below centre in 5px steps.
    for (let dy = -60; dy <= 60 && !menuOpened; dy += 5) {
      await page.mouse.click(centreX, centreY + dy, { button: 'right' });

      // Check if the menu appeared with a parachute option.
      const visible = await menu.evaluate(
        (el) => !el.hasAttribute('hidden') && el.textContent.includes('Deploy Parachute'),
      ).catch(() => false);

      if (visible) {
        menuOpened = true;
      }
    }

    expect(menuOpened).toBe(true);

    // Assert menu content.
    await expect(menu).toBeVisible();
    await expect(menu).toContainText('Mk2 Parachute');
    await expect(menu).toContainText('Deploy Parachute');
  });

  // ── (2) Clicking "Deploy Parachute" deploys the chute and closes the menu ─

  test('(2) clicking "Deploy Parachute" deploys the chute and closes the menu', async () => {
    const menu = page.locator('#flight-part-ctx-menu');

    // Menu should still be visible from the previous test.
    await expect(menu).toBeVisible();

    // Click the "Deploy Parachute" button.
    await menu.locator('.fctx-item', { hasText: 'Deploy Parachute' }).click();

    // Menu should close after the action.
    await expect(menu).toBeHidden({ timeout: 2_000 });

    // Parachute state should transition to deploying or deployed.
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

  // ── (3) Re-opening the menu shows the parachute status (not the button) ───

  test('(3) after deployment, re-opening the context menu shows parachute status instead of deploy button', async () => {
    const menu = page.locator('#flight-part-ctx-menu');
    const centreX = VP_W / 2;
    const centreY = VP_H / 2;

    // Right-click to reopen the menu on the parachute.
    let menuOpened = false;
    for (let dy = -60; dy <= 60 && !menuOpened; dy += 5) {
      await page.mouse.click(centreX, centreY + dy, { button: 'right' });

      const visible = await menu.evaluate(
        (el) => !el.hasAttribute('hidden') && el.textContent.includes('Mk2 Parachute'),
      ).catch(() => false);

      if (visible) {
        menuOpened = true;
      }
    }

    expect(menuOpened).toBe(true);

    // The menu should show a status label, not the deploy button.
    await expect(menu).toContainText(/Parachute: (Deploying|Deployed)/);

    // The "Deploy Parachute" action button should NOT be present.
    const deployBtnCount = await menu.locator('.fctx-item', { hasText: 'Deploy Parachute' }).count();
    expect(deployBtnCount).toBe(0);
  });
});

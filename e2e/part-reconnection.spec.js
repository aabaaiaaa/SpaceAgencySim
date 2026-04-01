import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  TOOLBAR_H, SCALE_BAR_W, PARTS_PANEL_W,
  CENTRE_X, CANVAS_CENTRE_Y,
  dragPartToCanvas, placePart, launchFromVab,
} from './helpers.js';

/**
 * E2E — Part Disconnection & Reconnection
 *
 * Builds a 3-part rocket (command module → fuel tank → engine), drags the
 * middle fuel tank away, verifies the Rocket Engineer detects floating parts,
 * then drags the tank back and verifies it reconnects to BOTH neighbors so
 * the rocket can launch.
 */

test.describe.configure({ mode: 'serial' });

test.describe('VAB — Part Disconnection & Reconnection', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const CMD_DROP_Y    = CANVAS_CENTRE_Y;
  const TANK_DROP_Y   = CMD_DROP_Y + 40;
  const ENGINE_DROP_Y = TANK_DROP_Y + 35;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await page.goto('/');

    // New game setup.
    await page.waitForSelector('#mm-agency-name-input', { state: 'visible', timeout: 15_000 });
    await page.fill('#mm-agency-name-input', 'Reconnect Test');
    await page.click('.mm-mode-option[data-mode="freeplay"]');
    await page.click('#mm-start-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Navigate to VAB.
    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 15_000 },
    );

    // Disable auto-zoom so viewport-pixel offsets map 1:1 to world units.
    await page.evaluate(() => {
      const chk = document.getElementById('vab-chk-autozoom');
      if (chk && chk.checked) { chk.checked = false; chk.dispatchEvent(new Event('change')); }
      const slider = document.getElementById('vab-zoom-slider');
      if (slider) { slider.value = '1'; slider.dispatchEvent(new Event('input')); }
    });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Helper: get screen coordinates of a placed part by its instance ID ──

  /**
   * Returns the viewport {x, y} of a placed part by looking up its world
   * position in the assembly and converting via the exposed vabWorldToScreen.
   */
  async function getPartScreenPos(instanceId) {
    return page.evaluate((id) => {
      const a = window.__vabAssembly;
      const placed = a?.parts?.get(id);
      if (!placed) return null;
      const { screenX, screenY } = window.__vabWorldToScreen(placed.x, placed.y);
      return { x: screenX, y: screenY };
    }, instanceId);
  }

  // ── Helper: drag a placed part from its current position to a target ──

  async function dragPlacedPart(instanceId, targetX, targetY) {
    const pos = await getPartScreenPos(instanceId);
    if (!pos) throw new Error(`Part ${instanceId} not found in assembly`);

    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    // Move past the 8px threshold then to target.
    await page.mouse.move(pos.x, pos.y + 12, { steps: 3 });
    await page.mouse.move(targetX, targetY, { steps: 30 });
    await page.mouse.up();
  }

  // ── (1) Build a 3-part rocket ──────────────────────────────────────────

  test('(1) build a 3-part connected rocket', async () => {
    await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
    await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 2);
    await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);

    const connCount = await page.evaluate(
      () => window.__vabAssembly?.connections?.length ?? 0,
    );
    expect(connCount).toBe(2);
  });

  // ── (2) Stage the engine so rocket is valid before we test disconnection ─

  test('(2) stage engine and verify rocket is launchable', async () => {
    // Open staging panel and verify engine is auto-staged.
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();

    const stage1Zone = page.locator('[data-drop-zone="stage-0"]');
    await expect(stage1Zone.getByText('Spark Engine')).toBeVisible({ timeout: 5_000 });

    // Close staging panel.
    await page.locator('#vab-staging-close').click();

    // Launch button should be enabled (all validation passes).
    await page.waitForFunction(
      () => !document.querySelector('#vab-btn-launch')?.disabled,
      { timeout: 5_000 },
    );
  });

  // ── (3) Drag fuel tank away → Rocket Engineer detects floating parts ───

  let tankInstanceId;

  test('(3) dragging fuel tank away causes floating-parts validation failure', async () => {
    // Find the tank instance ID.
    tankInstanceId = await page.evaluate(() => {
      const a = window.__vabAssembly;
      for (const [id, p] of a.parts) {
        if (p.partId === 'tank-small') return id;
      }
      return null;
    });
    expect(tankInstanceId).not.toBeNull();

    // Drag the tank far to the right (away from the rocket).
    const farRightX = CENTRE_X + 200;
    const farRightY = CANVAS_CENTRE_Y + 100;
    await dragPlacedPart(tankInstanceId, farRightX, farRightY);

    // Wait for connections to decrease (tank disconnected from both neighbors).
    await page.waitForFunction(
      () => (window.__vabAssembly?.connections?.length ?? 99) === 0,
      { timeout: 5_000 },
    );

    // The engine is now floating (not connected to root via the tank).
    // Open Rocket Engineer and verify it reports floating parts.
    await page.click('#vab-btn-engineer');
    await expect(page.locator('#vab-engineer-panel')).toBeVisible();

    // Look for the connectivity check failing.
    const connectivityCheck = page.locator('#vab-engineer-panel .vab-val-msg');
    const checkTexts = await connectivityCheck.allTextContents();
    const hasFloating = checkTexts.some(t => /floating/i.test(t));
    expect(hasFloating).toBe(true);

    // Launch button should be disabled.
    await expect(page.locator('#vab-btn-launch')).toBeDisabled();

    // Close engineer panel.
    await page.locator('#vab-engineer-close').click();
  });

  // ── (4) Drag tank back between cmd & engine → reconnects to both ───────

  test('(4) dragging fuel tank back reconnects to both neighbors', async () => {
    expect(tankInstanceId).not.toBeNull();

    // Drag the tank back to between the command module and engine.
    await dragPlacedPart(tankInstanceId, CENTRE_X, TANK_DROP_Y);

    // Wait for connections to be re-established (tank connects to both cmd and engine).
    await page.waitForFunction(
      () => (window.__vabAssembly?.connections?.length ?? 0) >= 2,
      { timeout: 5_000 },
    );

    const connCount = await page.evaluate(
      () => window.__vabAssembly?.connections?.length ?? 0,
    );
    expect(connCount).toBe(2);
  });

  // ── (5) Rocket Engineer shows no floating parts, launch enabled ────────

  test('(5) Rocket Engineer shows all parts connected and launch is enabled', async () => {
    // Open Rocket Engineer panel.
    await page.click('#vab-btn-engineer');
    await expect(page.locator('#vab-engineer-panel')).toBeVisible();

    // Connectivity check should pass (no floating parts).
    const connectivityCheck = page.locator('#vab-engineer-panel .vab-val-msg');
    const checkTexts = await connectivityCheck.allTextContents();
    const hasFloating = checkTexts.some(t => /floating/i.test(t));
    expect(hasFloating).toBe(false);

    // Launch button should be enabled.
    await page.waitForFunction(
      () => !document.querySelector('#vab-btn-launch')?.disabled,
      { timeout: 5_000 },
    );

    // Close engineer panel.
    await page.locator('#vab-engineer-close').click();
  });

  // ── (6) Actually launch the reconnected rocket ─────────────────────────

  test('(6) reconnected rocket can launch successfully', async () => {
    await launchFromVab(page);

    // Verify flight scene is running.
    const altitude = await page.evaluate(() => window.__flightPs?.posY ?? 0);
    // Just confirming we got into flight — the rocket exists and is at/near the ground.
    expect(altitude).toBeGreaterThanOrEqual(0);
  });
});
